"""Bot WA/Telegram -> PO assistant.

Audit 2026-05-30: text-based parser (/po + multi-line body).
Audit 2026-06-02: tambah photo-based (/po + foto -> OCR INVOICE_SCHEMA
dipakai sbg sumber items, vendor_name jadi vendor hint).

Flow:
1. parse_text_and_save  -- AI parser (po_chat_parser).
2. parse_photo_and_save -- OCR pipeline (services/ocr).
3. confirm_create -- create PO DRAFT + delete session.

Session pakai BotPendingDocSession (entity_type="PO"), shared dgn
Invoice assistant via bot_doc_session module.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import (
    BotPendingDocSession,
    POStatus,
    Project,
    PurchaseOrder,
    POItem,
    User,
)
from app.services.ai.features.po_chat_parser import parse as ai_parse
from app.services.bot_doc_session import (
    BotDocError,
    delete_session,
    first_accessible_project,
    load_active_session,
    parse_payload,
    resolve_project,
    resolve_vendor,
    save_session,
)


# Backward-compat alias.
BotPOError = BotDocError

ENTITY_TYPE = "PO"


# ---------- Text path (AI parser) ----------

async def parse_text_and_save(
    db: AsyncSession, *, user: User, channel: str, chat_id: str, text: str,
) -> str:
    """Audit 2026-05-30: /po + multi-line text body."""
    parsed = await ai_parse(db, user_id=user.id, text=text)
    items: list[dict] = parsed.get("items") or []
    if not items:
        raise BotDocError(
            "Tidak terbaca daftar item dari pesanmu. Contoh format:\n"
            "Besi 10 polos = 270 lonjor\n"
            "Wiremesh M8 bulat = 228 lembar\n"
            "proyek BMJ1\n"
            "vendor PT Sumber Besi",
        )

    project = await resolve_project(db, user, parsed.get("project_hint"))
    if project is None:
        hint = parsed.get("project_hint")
        if hint:
            raise BotDocError(
                f"Proyek '{hint}' tidak ketemu atau kamu tidak punya akses. "
                f"Cek /proyek utk daftar proyek aktif yg bisa kamu akses.",
            )
        raise BotDocError(
            "Belum sebutkan proyeknya. Tambahkan baris seperti:\n"
            "proyek BMJ1\n"
            "atau\n"
            "proyek: Rekonstruksi Pucuk",
        )

    vendor_id, vendor_name = await resolve_vendor(db, parsed.get("vendor_hint"))

    payload = await _build_payload(
        project=project,
        items=items,
        vendor_id=vendor_id,
        vendor_name=vendor_name,
        notes=parsed.get("notes"),
        source="chat_text",
    )
    session_id = await save_session(
        db, channel=channel, chat_id=chat_id, user_id=user.id,
        entity_type=ENTITY_TYPE, payload=payload,
    )
    # Reminder 1 menit sebelum expired (fire-and-forget).
    from app.services.bot_doc_session import schedule_reminder
    schedule_reminder(channel=channel, chat_id=chat_id, session_id=session_id)
    return _format_preview(payload)


# ---------- Photo path (OCR) ----------

async def parse_photo_and_save(
    db: AsyncSession, *,
    user: User,
    channel: str,
    chat_id: str,
    content: bytes,
    media_type: str,
    source_url: str | None,
    project_hint: str | None,
    vendor_hint_override: str | None = None,
    notes: str | None = None,
) -> str:
    """Audit 2026-06-02: /po + foto. OCR pakai INVOICE_SCHEMA (sama utk
    invoice + po -- struktur items + total mirip). project_hint dari
    caption user; vendor dari OCR vendor_name (atau override caption)."""
    from app.services.ocr.pipeline import run_extraction
    ocr = await run_extraction(
        db, content=content, media_type=media_type,
        source_url=source_url, engine=None,
        # Audit 2026-06-02: user context (caption "konteks: ...") di-inject
        # ke OCR system prompt utk disambiguasi handwriting/items.
        user_context=notes,
    )
    items = _ocr_items_to_payload(ocr.get("items") or [])
    if not items:
        raise BotDocError(
            "OCR tidak menemukan item di foto. Pastikan foto jelas "
            "(tidak buram, tidak terpotong), lalu coba lagi.",
        )

    project = None
    if project_hint:
        project = await resolve_project(db, user, project_hint)
        if project is None:
            raise BotDocError(
                f"Proyek '{project_hint}' tidak ketemu atau kamu tidak "
                f"punya akses. Cek /proyek.",
            )
    if project is None:
        project = await first_accessible_project(db, user)
    if project is None:
        raise BotDocError(
            "Tidak ada proyek aktif yg bisa kamu akses -- minta admin "
            "tambahkan akses dulu.",
        )

    vendor_hint = vendor_hint_override or (ocr.get("vendor_name") or None)
    vendor_id, vendor_name = await resolve_vendor(db, vendor_hint)

    payload = await _build_payload(
        project=project,
        items=items,
        vendor_id=vendor_id,
        vendor_name=vendor_name,
        notes=notes or ocr.get("notes") or None,
        source="ocr_photo",
        ocr_meta={
            "confidence_score": float(ocr.get("confidence_score") or 0),
            "is_handwritten": bool(ocr.get("is_handwritten") or False),
            "ocr_total": float(ocr.get("total") or 0),
            "engine": (ocr.get("raw_response") or {}).get("engine"),
        },
    )
    session_id = await save_session(
        db, channel=channel, chat_id=chat_id, user_id=user.id,
        entity_type=ENTITY_TYPE, payload=payload,
    )
    # Reminder 1 menit sebelum expired (fire-and-forget).
    from app.services.bot_doc_session import schedule_reminder
    schedule_reminder(channel=channel, chat_id=chat_id, session_id=session_id)
    return _format_preview(payload)


# ---------- Helpers ----------

def _ocr_items_to_payload(ocr_items: list[dict]) -> list[dict]:
    """Normalisasi OCR items ke format payload (description, quantity, unit,
    unit_price). OCR field: qty/price/amount."""
    out: list[dict] = []
    for it in ocr_items:
        desc = (it.get("description") or "").strip()
        if not desc:
            continue
        qty_raw = it.get("qty")
        qty = float(qty_raw) if qty_raw not in (None, "") else 1.0
        price_raw = it.get("price")
        unit_price: float | None
        if price_raw not in (None, "", 0):
            unit_price = float(price_raw)
        else:
            # Fallback: kalau ada `amount` tapi tdk ada `price`, dan qty>0,
            # derive unit_price = amount/qty.
            amount_raw = it.get("amount")
            if amount_raw not in (None, "", 0) and qty > 0:
                unit_price = float(amount_raw) / qty
            else:
                unit_price = None
        out.append({
            "description": desc,
            "quantity": qty,
            "unit": (it.get("unit") or None),
            "unit_price": unit_price,
        })
    return out


async def _build_payload(
    *, project: Project, items: list[dict],
    vendor_id: int | None, vendor_name: str | None,
    notes: str | None, source: str,
    ocr_meta: dict | None = None,
) -> dict:
    return {
        "project_id": project.id,
        "project_code": project.code,
        "project_name": project.name,
        "company_id": project.company_id,
        "vendor_client_id": vendor_id,
        "vendor_name": vendor_name,
        "items": items,
        "notes": notes,
        "source": source,
        "ocr_meta": ocr_meta,
    }


def _format_preview(payload: dict) -> str:
    items: list[dict] = payload["items"]
    total_est = Decimal("0")
    has_any_price = False
    for it in items:
        if it.get("unit_price"):
            has_any_price = True
            total_est += Decimal(str(it["unit_price"])) * Decimal(str(it.get("quantity") or 1))
    lines: list[str] = []
    lines.append("📋 *Preview PO*")
    lines.append(f"Proyek: {payload['project_name']} ({payload['project_code']})")
    vendor_label = payload["vendor_name"] or "(belum diisi)"
    if payload.get("vendor_client_id"):
        vendor_label = f"{vendor_label} ✓"
    lines.append(f"Vendor: {vendor_label}")
    lines.append(f"Items ({len(items)}):")
    for i, it in enumerate(items[:10], start=1):
        qty = it.get("quantity") or 1
        unit = it.get("unit") or ""
        price = it.get("unit_price")
        suffix = ""
        if price:
            suffix = f" @ Rp {Decimal(str(price)):,.0f}".replace(",", ".")
        lines.append(f"  {i}. {it['description']} · {qty} {unit}{suffix}".rstrip())
    if len(items) > 10:
        lines.append(f"  ... +{len(items) - 10} item lainnya")
    if has_any_price:
        lines.append(f"Estimasi total (sub): Rp {total_est:,.0f}".replace(",", "."))
    else:
        lines.append("Estimasi total: belum diisi (harga kosong)")
    if payload.get("notes"):
        lines.append(f"💬 Konteks: _{payload['notes']}_")
    meta = payload.get("ocr_meta")
    if meta:
        conf = meta.get("confidence_score")
        if conf is not None:
            lines.append(f"_OCR confidence: {conf:.0%}_")
    lines.append("")
    lines.append("Balas *ya* untuk simpan sebagai DRAFT, *batal* untuk batal.")
    return "\n".join(lines)


# ---------- Confirm create ----------

async def confirm_create(
    db: AsyncSession, *, user: User, session: BotPendingDocSession,
) -> PurchaseOrder:
    """Create PO DRAFT dari session payload. Caller harus commit."""
    from app.api.v1.purchase_orders import _compute_totals, _next_po_number

    payload = parse_payload(session)
    project = await db.get(Project, payload["project_id"])
    if project is None:
        raise BotDocError("Proyek tidak ditemukan (mungkin sudah dihapus).")

    po_date = datetime.now(timezone.utc).date()
    items_payload: list[dict] = payload.get("items") or []
    if not items_payload:
        raise BotDocError("Session tidak punya item -- silakan /po ulang.")

    MAX_ATTEMPTS = 5
    po: PurchaseOrder | None = None
    for attempt in range(MAX_ATTEMPTS):
        number = await _next_po_number(
            db, payload["company_id"], project.code, po_date,
        )
        po = PurchaseOrder(
            number=number,
            project_id=project.id,
            company_id=payload["company_id"],
            vendor_client_id=payload.get("vendor_client_id"),
            vendor_name=payload.get("vendor_name"),
            po_date=po_date,
            tax=Decimal("0"),
            discount=Decimal("0"),
            payment_terms=None,
            notes=payload.get("notes"),
            status=POStatus.DRAFT,
            created_by_id=user.id,
        )
        for it in items_payload:
            qty = Decimal(str(it.get("quantity") or 1))
            price = Decimal(str(it.get("unit_price") or 0))
            po.items.append(POItem(
                description=it["description"],
                quantity=qty,
                unit=it.get("unit"),
                unit_price=price,
                subtotal=qty * price,
            ))
        subtotal, total = _compute_totals(po.items, po.tax, po.discount)
        po.subtotal = subtotal
        po.total = total
        db.add(po)
        try:
            await db.flush()
            break
        except Exception as e:
            await db.rollback()
            project = await db.get(Project, payload["project_id"])
            if attempt == MAX_ATTEMPTS - 1:
                raise BotDocError(
                    "Gagal generate nomor PO unik. Coba ulang sebentar lagi.",
                ) from e
    assert po is not None
    await delete_session(db, session)
    return po


# Backward-compat alias utk file lama yg import nama lama.
parse_and_save = parse_text_and_save
