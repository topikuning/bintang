"""Bulk kategorisasi semua item invoice dalam 1 proyek -- SATU AI call.

Audit 2026-05-24 user req: "kirim sekali dari semua data invoice di
proyek itu, agar tidak terlalu banyak transaksi".

Strategi v2 (revisi setelah 429 Too Many Requests):
- SATU prompt AI berisi SEMUA invoice + SEMUA item dalam proyek itu
  (default cap 500 item / call -- AI context window).
- Item dipakai item_id sebagai identifier dlm prompt + di output schema.
- Vendor history per-vendor di-fetch sekali (deduplicated), embed di
  prompt sbg reference pattern.
- AI return: flat array of {item_id, category_id, confidence, reason}.

Hasil per invoice di-aggregate kembali utk FE display.

Apply endpoint sama spt sebelumnya: bulk update + audit log.
"""
from __future__ import annotations

from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import require_admin
from app.db.session import get_db
from app.models.models import (
    AuditAction, Category, CategoryType, Invoice, InvoiceItem,
    InvoiceStatus, InvoiceType, Project, Transaction, TxnStatus, User,
)
from app.services.ai import chat
from app.services.ai.prompt_registry import get_prompt
from app.services.audit import log

router = APIRouter()


class BatchProjectScanIn(BaseModel):
    project_id: int
    statuses: list[str] | None = None
    only_uncategorized: bool = True
    # Cap TOTAL items (bukan invoice) per 1 AI call. AI context 32K
    # token (Mistral) cukup utk ~500 item dgn vendor history.
    max_items: int = Field(default=500, ge=1, le=1000)


class ItemSuggestion(BaseModel):
    item_id: int
    description: str
    quantity: str | float | None = None
    unit: str | None = None
    unit_price: str | float | None = None
    current_category_id: int | None = None
    current_category_name: str | None = None
    suggested_category_id: int | None = None
    suggested_category_name: str | None = None
    confidence: float = 0
    reason: str = ""


class InvoiceSuggestion(BaseModel):
    invoice_id: int
    invoice_number: str
    invoice_type: str
    party_name: str | None
    items: list[ItemSuggestion]
    high_confidence_count: int = 0


class BatchScanResp(BaseModel):
    project_id: int
    invoices: list[InvoiceSuggestion]
    invoices_scanned: int
    invoices_skipped: int
    items_scanned: int
    summary: str
    ai_calls: int  # NEW: berapa kali AI dipanggil (target = 1)


_DEFAULT_STATUSES = (
    InvoiceStatus.DRAFT,
    InvoiceStatus.ISSUED,
    InvoiceStatus.PARTIALLY_PAID,
    InvoiceStatus.OVERDUE,
)


_AI_SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "item_id": {"type": "integer"},
                    "category_id": {"type": ["integer", "null"]},
                    "confidence": {"type": "number"},
                    "reason": {"type": "string"},
                },
                "required": ["item_id", "confidence", "reason"],
            },
        },
    },
    "required": ["items"],
}


_BATCH_SYSTEM_PROMPT = (
    "Kamu asisten finansial perusahaan konstruksi Indonesia. Tugasmu: "
    "kategorikan item-item belanja yg datang dari MULTIPLE invoice "
    "dalam satu proyek. Tiap invoice punya vendor + tipe (hutang/piutang) "
    "yg berbeda. Item dikelompokkan per invoice di prompt user.\n\n"
    "Aturan:\n"
    "1. PRIORITAS: konsistensi dgn pattern history vendor (kalau ada).\n"
    "2. BACA deskripsi item -- jangan paksa semua item 1 invoice ke 1 "
    "kategori. Item bisa beda jenis walau 1 vendor.\n"
    "3. Perhatikan tipe invoice:\n"
    "   - Invoice HUTANG (vendor->kita): items = pengeluaran -> "
    "kategori tipe OUT.\n"
    "   - Invoice PIUTANG (kita->klien): items = pemasukan -> "
    "kategori tipe IN.\n"
    "4. Output WAJIB return entry utk SEMUA item_id input. Jangan skip.\n"
    "5. Kalau tdk ada kategori cocok, category_id=null + reason.\n"
    "6. confidence: 0.9+ kalau yakin (history mendukung), 0.6-0.85 "
    "plausible, <0.6 ragu.\n"
    "7. reason: 1 kalimat singkat per item."
)


async def _fetch_vendor_patterns(
    db: AsyncSession,
    vendor_names: set[str],
    limit_per_vendor: int = 15,
) -> dict[str, list[tuple[str, str]]]:
    """Return dict vendor_lower -> list (description, category_name)."""
    out: dict[str, list[tuple[str, str]]] = {}
    for v in vendor_names:
        v_clean = (v or "").strip()
        if not v_clean:
            continue
        stmt = (
            select(Transaction.description, Category.name)
            .join(Category, Category.id == Transaction.category_id, isouter=True)
            .where(
                Transaction.deleted_at.is_(None),
                Transaction.party_name.ilike(f"%{v_clean}%"),
                Transaction.category_id.is_not(None),
                Transaction.status == TxnStatus.VERIFIED,
            )
            .order_by(Transaction.tx_date.desc())
            .limit(limit_per_vendor)
        )
        rows = (await db.execute(stmt)).all()
        if rows:
            out[v_clean.lower()] = [
                ((d or "")[:50], c or "—") for d, c in rows
            ]
    return out


async def _ai_categorize_chunk(
    *,
    db: AsyncSession,
    admin: User,
    chunk: list[tuple[Invoice, InvoiceItem]],
    cats_rows: list,
    proj_label: str,
    vendor_patterns: dict[str, list[tuple[str, str]]],
    unique_vendors: set[str],
) -> dict[int, dict]:
    """Build prompt + panggil AI utk 1 chunk. Return dict {item_id: entry}."""
    # Group chunk by invoice utk prompt readability
    grouped: dict[int, list[InvoiceItem]] = defaultdict(list)
    inv_by_id: dict[int, Invoice] = {}
    for inv, it in chunk:
        grouped[inv.id].append(it)
        inv_by_id[inv.id] = inv

    # Section 1: invoices + items
    lines_invoices: list[str] = []
    for inv_id, items in grouped.items():
        inv = inv_by_id[inv_id]
        inv_kind = (
            "HUTANG (vendor->kita = pengeluaran)" if inv.type == InvoiceType.IN
            else "PIUTANG (kita->klien = pemasukan)"
        )
        lines_invoices.append(
            f"\n[Invoice {inv.number}] · Vendor: {inv.party_name or '-'} · "
            f"Tipe: {inv_kind}"
        )
        for it in items:
            qty = f" qty={it.quantity}" if it.quantity else ""
            unit = f" {it.unit}" if it.unit else ""
            price = f" @Rp{it.unit_price}" if it.unit_price else ""
            lines_invoices.append(
                f"  item_id={it.id}: {it.description}{qty}{unit}{price}"
            )

    # Section 2: vendor history (filter ke vendor yg ada di chunk ini)
    chunk_vendors = {
        (inv.party_name or "").strip().lower()
        for inv, _ in chunk if inv.party_name
    }
    lines_history: list[str] = []
    relevant_patterns = {
        k: v for k, v in vendor_patterns.items() if k in chunk_vendors
    }
    if relevant_patterns:
        lines_history.append(
            "\nHISTORY VENDOR (referensi pattern -- 15 tx terakhir per vendor):"
        )
        for vname_lower, rows in relevant_patterns.items():
            display_name = next(
                (v for v in unique_vendors if v.lower() == vname_lower),
                vname_lower,
            )
            lines_history.append(f"\nVendor '{display_name}':")
            for desc, cat in rows:
                lines_history.append(f"  - {desc} -> {cat}")

    # Section 3: kategori. Filter berdasar arah invoice di chunk:
    # - Invoice IN (hutang) -> items pengeluaran -> kategori CategoryType.OUT
    # - Invoice OUT (piutang) -> items pemasukan -> kategori CategoryType.IN
    # Audit 2026-05-24: sebelumnya kirim SEMUA kategori (IN+OUT)
    # walaupun chunk cuma invoice IN. Buang token + risk AI pilih arah
    # salah. Sekarang determine direction per chunk, filter cats.
    chunk_invoice_types = {inv.type for inv in inv_by_id.values()}
    if chunk_invoice_types == {InvoiceType.IN}:
        # all hutang -> hanya kategori pengeluaran
        relevant_cats = [
            (cid, name, ctype) for cid, name, ctype in cats_rows
            if ctype == CategoryType.OUT
        ]
        cat_section_header = (
            "\nKATEGORI VALID (hanya tipe PENGELUARAN -- semua invoice "
            "di chunk ini adalah HUTANG):"
        )
    elif chunk_invoice_types == {InvoiceType.OUT}:
        # all piutang -> hanya kategori pemasukan
        relevant_cats = [
            (cid, name, ctype) for cid, name, ctype in cats_rows
            if ctype == CategoryType.IN
        ]
        cat_section_header = (
            "\nKATEGORI VALID (hanya tipe PEMASUKAN -- semua invoice "
            "di chunk ini adalah PIUTANG):"
        )
    else:
        # mixed -> kirim semua dgn tag jelas
        relevant_cats = list(cats_rows)
        cat_section_header = (
            "\nKATEGORI VALID (campuran -- pilih sesuai tipe invoice "
            "per item):"
        )

    lines_cats: list[str] = [cat_section_header]
    for cid, name, ctype in relevant_cats:
        tag = "PEMASUKAN" if ctype == CategoryType.IN else "PENGELUARAN"
        lines_cats.append(f"  ID {cid}: {name} [{tag}]")

    prompt_body = (
        f"Proyek: {proj_label}\n"
        f"Total invoice di chunk: {len(grouped)}\n"
        f"Total item perlu dikategori: {len(chunk)}\n"
        + "\n".join(lines_invoices)
        + "\n"
        + "\n".join(lines_history)
        + "\n"
        + "\n".join(lines_cats)
        + "\n\nKategorikan SEMUA item di atas. Wajib return entry per item_id."
    )

    # Prompt registry override-aware
    try:
        p = await get_prompt(db, "categorize_items")
        sys_prompt = p.system + (
            "\n\nMODE BATCH: input punya MULTIPLE invoice + item_id "
            "sbg identifier. Output WAJIB pakai item_id (bukan index)."
        )
    except Exception:  # noqa: BLE001
        sys_prompt = _BATCH_SYSTEM_PROMPT

    # Audit 2026-05-24: timeout naik ke 180s utk batch besar (Mistral
    # output 150 item JSON bisa 30-60 detik). Default 30s tdk cukup.
    try:
        resp = await chat(
            db, user_id=admin.id, feature="ai:categorize_items_batch",
            system=sys_prompt, prompt=prompt_body, json_schema=_AI_SCHEMA,
            feature_key="categorize_items",
            max_tokens=8192,  # 150 item ~ 5K token output, buffer aman
            timeout=180.0,
        )
    except RuntimeError as e:
        if "ai_rate_limited" in str(e):
            raise HTTPException(429, "ai_rate_limited") from e
        if "BudgetExceeded" in type(e).__name__:
            raise HTTPException(402, "ai_budget_exceeded") from e
        raise HTTPException(502, f"ai_failed: {e}") from e

    structured = resp.structured or {"items": []}
    out: dict[int, dict] = {}
    for entry in structured.get("items", []):
        iid = entry.get("item_id")
        if isinstance(iid, int):
            out[iid] = entry
    return out


@router.post("/categorize-project", response_model=BatchScanResp)
async def batch_categorize_project_invoices(
    payload: BatchProjectScanIn,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> BatchScanResp:
    if payload.statuses:
        try:
            statuses = [InvoiceStatus(s) for s in payload.statuses]
        except ValueError:
            raise HTTPException(400, "invalid_status")
    else:
        statuses = list(_DEFAULT_STATUSES)

    # Load ALL invoices in project (tdk di-cap di sini, cap di item level
    # supaya budget AI context predictable).
    stmt = (
        select(Invoice)
        .options(selectinload(Invoice.items))
        .where(
            Invoice.deleted_at.is_(None),
            Invoice.project_id == payload.project_id,
            Invoice.status.in_(statuses),
        )
        .order_by(Invoice.invoice_date.desc(), Invoice.id.desc())
    )
    invoices = list((await db.execute(stmt)).scalars().all())

    # Collect target items + invoice context. Cap pada max_items.
    target_pairs: list[tuple[Invoice, InvoiceItem]] = []
    invoices_with_items: dict[int, list[InvoiceItem]] = defaultdict(list)
    invoices_skipped = 0
    for inv in invoices:
        candidates = [
            it for it in (inv.items or [])
            if not payload.only_uncategorized or it.category_id is None
        ]
        if not candidates:
            invoices_skipped += 1
            continue
        for it in candidates:
            if len(target_pairs) >= payload.max_items:
                break
            target_pairs.append((inv, it))
            invoices_with_items[inv.id].append(it)
        if len(target_pairs) >= payload.max_items:
            break

    # Build cat name lookup
    cats_rows = (await db.execute(
        select(Category.id, Category.name, Category.type).where(
            Category.deleted_at.is_(None),
        )
    )).all()
    cat_name_by_id = {cid: name for cid, name, _ in cats_rows}
    # valid_ids: cek per-direction di response loop (audit 2026-05-24).

    project = await db.get(Project, payload.project_id)
    proj_label = f"{project.name} ({project.code})" if project else f"#{payload.project_id}"

    # Early-return kalau tdk ada item perlu di-kategori
    if not target_pairs:
        return BatchScanResp(
            project_id=payload.project_id,
            invoices=[],
            invoices_scanned=0,
            invoices_skipped=invoices_skipped,
            items_scanned=0,
            summary="Tidak ada item perlu dikategori (semua sudah punya kategori, atau tidak ada invoice di status terpilih).",
            ai_calls=0,
        )

    # Audit 2026-05-24: chunk items per direction supaya prompt
    # homogeneous (cat filter pas + AI tdk bingung campur direction).
    # Per chunk 150 item supaya respond < 60s.
    CHUNK_SIZE = 150
    pairs_in = [(inv, it) for inv, it in target_pairs if inv.type == InvoiceType.IN]
    pairs_out = [(inv, it) for inv, it in target_pairs if inv.type == InvoiceType.OUT]
    pair_chunks: list[list[tuple[Invoice, InvoiceItem]]] = []
    for bucket in (pairs_in, pairs_out):
        for i in range(0, len(bucket), CHUNK_SIZE):
            chunk = bucket[i : i + CHUNK_SIZE]
            if chunk:
                pair_chunks.append(chunk)

    # Fetch vendor patterns sekali utk SEMUA vendor di batch
    unique_vendors = {(inv.party_name or "").strip()
                      for inv, _ in target_pairs if inv.party_name}
    vendor_patterns = await _fetch_vendor_patterns(db, unique_vendors)

    # Aggregate result across chunks
    ai_by_item_id: dict[int, dict] = {}
    ai_calls = 0
    for chunk in pair_chunks:
        chunk_response = await _ai_categorize_chunk(
            db=db, admin=admin, chunk=chunk,
            cats_rows=cats_rows, proj_label=proj_label,
            vendor_patterns=vendor_patterns,
            unique_vendors=unique_vendors,
        )
        ai_calls += 1
        ai_by_item_id.update(chunk_response)

    # Group by invoice utk response shape
    grouped_by_inv: dict[int, list[InvoiceItem]] = defaultdict(list)
    inv_by_id: dict[int, Invoice] = {}
    for inv, it in target_pairs:
        grouped_by_inv[inv.id].append(it)
        inv_by_id[inv.id] = inv

    # Build response: group by invoice, items dgn enriched suggestion
    result_invoices: list[InvoiceSuggestion] = []
    # Per-direction valid sets utk validate suggestion sesuai arah.
    valid_ids_out = {cid for cid, _, ctype in cats_rows if ctype == CategoryType.OUT}
    valid_ids_in = {cid for cid, _, ctype in cats_rows if ctype == CategoryType.IN}

    items_scanned = 0
    for inv_id, items in grouped_by_inv.items():
        inv = inv_by_id[inv_id]
        # Expected direction utk item-item invoice ini.
        expected_ids = (
            valid_ids_out if inv.type == InvoiceType.IN else valid_ids_in
        )
        item_suggestions: list[ItemSuggestion] = []
        high_conf = 0
        for it in items:
            items_scanned += 1
            s = ai_by_item_id.get(it.id, {})
            sug_cid = s.get("category_id")
            # Strict: cek harus ada di valid set sesuai direction
            # (audit 2026-05-24 -- AI kadang salah pilih arah).
            if sug_cid is not None and sug_cid not in expected_ids:
                sug_cid = None
            conf = float(s.get("confidence") or 0)
            if conf >= 0.7 and sug_cid is not None:
                high_conf += 1
            item_suggestions.append(ItemSuggestion(
                item_id=it.id,
                description=it.description,
                quantity=str(it.quantity) if it.quantity is not None else None,
                unit=it.unit,
                unit_price=str(it.unit_price) if it.unit_price is not None else None,
                current_category_id=it.category_id,
                current_category_name=cat_name_by_id.get(it.category_id) if it.category_id else None,
                suggested_category_id=sug_cid,
                suggested_category_name=cat_name_by_id.get(sug_cid) if sug_cid else None,
                confidence=conf,
                reason=s.get("reason") or (
                    "AI tdk return suggestion utk item ini."
                    if it.id not in ai_by_item_id else ""
                ),
            ))
        result_invoices.append(InvoiceSuggestion(
            invoice_id=inv.id, invoice_number=inv.number,
            invoice_type=inv.type.value,
            party_name=inv.party_name, items=item_suggestions,
            high_confidence_count=high_conf,
        ))

    await db.commit()

    total_high = sum(r.high_confidence_count for r in result_invoices)
    summary = (
        f"{len(result_invoices)} invoice ({items_scanned} item) di-proses "
        f"dlm {ai_calls} panggilan AI (chunk size 150 item/call). "
        f"{total_high} item dgn confidence >=70% siap auto-apply. "
        f"{invoices_skipped} invoice di-skip (semua item sudah ber-kategori)."
    )
    return BatchScanResp(
        project_id=payload.project_id,
        invoices=result_invoices,
        invoices_scanned=len(result_invoices),
        invoices_skipped=invoices_skipped,
        items_scanned=items_scanned,
        summary=summary,
        ai_calls=ai_calls,
    )


# ---------- Apply (sama spt sebelumnya, unchanged) ----------

class ApplyItem(BaseModel):
    item_id: int
    new_category_id: int


class BatchApplyIn(BaseModel):
    items: list[ApplyItem]


class BatchApplyOut(BaseModel):
    total_requested: int
    success_count: int
    success: list[int]
    skipped: list[dict]


@router.post("/apply", response_model=BatchApplyOut)
async def apply_item_categories(
    payload: BatchApplyIn,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> BatchApplyOut:
    if not payload.items:
        raise HTTPException(400, "no_items")
    if len(payload.items) > 2000:
        raise HTTPException(400, "max_2000_per_batch")

    item_ids = [it.item_id for it in payload.items]
    new_cat_by_id = {it.item_id: it.new_category_id for it in payload.items}

    cat_ids = set(new_cat_by_id.values())
    valid_cats = {
        c for (c,) in (await db.execute(
            select(Category.id).where(
                Category.id.in_(cat_ids),
                Category.deleted_at.is_(None),
            )
        )).all()
    }
    invalid = cat_ids - valid_cats
    if invalid:
        raise HTTPException(400, f"invalid_category_ids: {sorted(invalid)}")

    res = await db.execute(
        select(InvoiceItem).where(InvoiceItem.id.in_(item_ids))
    )
    items_map = {it.id: it for it in res.scalars().all()}
    by_invoice: dict[int, list[tuple[int, int | None, int]]] = defaultdict(list)
    success: list[int] = []
    skipped: list[dict] = []
    for iid in item_ids:
        it = items_map.get(iid)
        if it is None:
            skipped.append({"item_id": iid, "reason": "not_found"})
            continue
        new_cat = new_cat_by_id[iid]
        if it.category_id == new_cat:
            skipped.append({"item_id": iid, "reason": "unchanged"})
            continue
        by_invoice[it.invoice_id].append((iid, it.category_id, new_cat))
        it.category_id = new_cat
        success.append(iid)

    for inv_id, changes in by_invoice.items():
        note = f"AI bulk categorize: {len(changes)} item updated"
        await log(
            db, user_id=admin.id, entity="invoice", entity_id=inv_id,
            action=AuditAction.UPDATE, note=note,
        )

    await db.commit()
    return BatchApplyOut(
        total_requested=len(item_ids),
        success_count=len(success),
        success=success,
        skipped=skipped,
    )
