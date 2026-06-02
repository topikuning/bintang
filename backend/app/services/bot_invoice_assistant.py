"""Bot WA/Telegram -> Invoice assistant (audit 2026-06-02).

User flow:
  /invoice + foto invoice/struk -> bot OCR -> preview -> "ya" -> DRAFT.

Default Invoice.type = IN (Hutang/tagihan dari vendor). Variants
`/invoice-in` / `/invoice-out` boleh override. project_id opsional --
kalau caption tdk sebut, fallback ke proyek aktif pertama yg user
punya akses (preview kasih note "default ke proyek X").
"""
from __future__ import annotations

from datetime import date as _date, datetime, timezone
from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import (
    BotPendingDocSession,
    Invoice,
    InvoiceItem,
    InvoiceStatus,
    InvoiceType,
    Project,
    User,
)
from app.services.bot_doc_session import (
    BotDocError,
    delete_session,
    first_accessible_project,
    parse_payload,
    resolve_project,
    resolve_vendor,
    save_session,
)


ENTITY_TYPE = "INVOICE"


# ---------- Photo path (OCR) ----------

async def parse_photo_and_save(
    db: AsyncSession, *,
    user: User,
    channel: str,
    chat_id: str,
    content: bytes,
    media_type: str,
    source_url: str | None,
    invoice_type: InvoiceType = InvoiceType.IN,
    project_hint: str | None = None,
    notes: str | None = None,
) -> str:
    """OCR foto -> Invoice draft session preview.

    Project hint opsional. Kalau hilang, fallback ke first accessible
    project (warning di preview).
    """
    from app.services.ocr.pipeline import run_extraction
    ocr = await run_extraction(
        db, content=content, media_type=media_type,
        source_url=source_url, engine=None,
    )
    items = _ocr_items_to_payload(ocr.get("items") or [])
    if not items and not (ocr.get("total") or 0):
        raise BotDocError(
            "OCR tidak menemukan data tagihan di foto. Pastikan foto "
            "jelas (tidak buram, tidak terpotong), lalu coba lagi.",
        )

    # Resolve project: caption hint > fallback first accessible.
    project = None
    project_default = False
    if project_hint:
        project = await resolve_project(db, user, project_hint)
        if project is None:
            raise BotDocError(
                f"Proyek '{project_hint}' tidak ketemu atau kamu tidak "
                f"punya akses. Cek /proyek.",
            )
    if project is None:
        project = await first_accessible_project(db, user)
        project_default = True
    if project is None:
        raise BotDocError(
            "Tidak ada proyek aktif yg bisa kamu akses -- minta admin "
            "tambahkan akses dulu.",
        )

    vendor_id, vendor_name = await resolve_vendor(
        db, ocr.get("vendor_name") or None,
    )

    payload = {
        "project_id": project.id,
        "project_code": project.code,
        "project_name": project.name,
        "project_default": project_default,
        "type": invoice_type.value if hasattr(invoice_type, "value") else str(invoice_type),
        "number": (ocr.get("invoice_number") or "").strip() or None,
        "invoice_date": _normalize_date(ocr.get("invoice_date")),
        "due_date": _normalize_date(ocr.get("due_date")),
        "vendor_client_id": vendor_id,
        "party_name": vendor_name or (ocr.get("vendor_name") or None),
        "tax": float(ocr.get("tax") or 0),
        "items": items,
        "notes": notes or ocr.get("notes") or None,
        "source": "ocr_photo",
        "ocr_meta": {
            "confidence_score": float(ocr.get("confidence_score") or 0),
            "is_handwritten": bool(ocr.get("is_handwritten") or False),
            "ocr_total": float(ocr.get("total") or 0),
            "ocr_subtotal": float(ocr.get("subtotal") or 0),
            "engine": (ocr.get("raw_response") or {}).get("engine"),
        },
    }
    session_id = await save_session(
        db, channel=channel, chat_id=chat_id, user_id=user.id,
        entity_type=ENTITY_TYPE, payload=payload,
    )
    from app.services.bot_doc_session import schedule_reminder
    schedule_reminder(channel=channel, chat_id=chat_id, session_id=session_id)
    return _format_preview(payload)


# ---------- Helpers ----------

def _normalize_date(s: str | None) -> str | None:
    """OCR kasih YYYY-MM-DD or empty string. Return ISO or None."""
    if not s:
        return None
    s = s.strip()
    if not s:
        return None
    # Basic validation.
    try:
        _date.fromisoformat(s)
        return s
    except ValueError:
        return None


def _ocr_items_to_payload(ocr_items: list[dict]) -> list[dict]:
    """Normalize OCR items: description, quantity, unit, unit_price."""
    out: list[dict] = []
    for it in ocr_items:
        desc = (it.get("description") or "").strip()
        if not desc:
            continue
        qty_raw = it.get("qty")
        qty = float(qty_raw) if qty_raw not in (None, "") else 1.0
        price_raw = it.get("price")
        unit_price: float
        if price_raw not in (None, "", 0):
            unit_price = float(price_raw)
        else:
            amount_raw = it.get("amount")
            if amount_raw not in (None, "", 0) and qty > 0:
                unit_price = float(amount_raw) / qty
            else:
                unit_price = 0.0
        out.append({
            "description": desc,
            "quantity": qty,
            "unit": (it.get("unit") or None),
            "unit_price": unit_price,
        })
    return out


def _format_preview(payload: dict) -> str:
    items: list[dict] = payload.get("items") or []
    inv_type = payload.get("type") or "IN"
    type_label = "Hutang/Tagihan dr Vendor (IN)" if inv_type == "IN" else "Piutang ke Customer (OUT)"
    total_est = Decimal("0")
    for it in items:
        total_est += Decimal(str(it.get("unit_price") or 0)) * Decimal(str(it.get("quantity") or 1))

    lines: list[str] = []
    lines.append("📄 *Preview Invoice*")
    lines.append(f"Tipe: {type_label}")
    lines.append(f"Proyek: {payload['project_name']} ({payload['project_code']})")
    if payload.get("project_default"):
        lines.append("  ⚠️ _Proyek default (kamu tdk sebut). Edit di web kalau salah._")
    party_label = payload.get("party_name") or "(tdk terbaca)"
    if payload.get("vendor_client_id"):
        party_label = f"{party_label} ✓"
    lines.append(f"Pihak: {party_label}")
    if payload.get("number"):
        lines.append(f"No. Invoice: {payload['number']}")
    if payload.get("invoice_date"):
        lines.append(f"Tanggal: {payload['invoice_date']}")
    if payload.get("due_date"):
        lines.append(f"Jatuh tempo: {payload['due_date']}")
    lines.append(f"Items ({len(items)}):")
    for i, it in enumerate(items[:10], start=1):
        qty = it.get("quantity") or 1
        unit = it.get("unit") or ""
        price = it.get("unit_price") or 0
        suffix = ""
        if price:
            suffix = f" @ Rp {Decimal(str(price)):,.0f}".replace(",", ".")
        lines.append(f"  {i}. {it['description']} · {qty} {unit}{suffix}".rstrip())
    if len(items) > 10:
        lines.append(f"  ... +{len(items) - 10} item lainnya")
    lines.append(f"Estimasi total: Rp {total_est:,.0f}".replace(",", "."))
    meta = payload.get("ocr_meta") or {}
    if meta.get("confidence_score") is not None:
        lines.append(f"_OCR confidence: {meta['confidence_score']:.0%}_")
    if meta.get("is_handwritten"):
        lines.append("_OCR detect tulisan tangan -- mohon verifikasi angka._")
    if payload.get("notes"):
        lines.append(f"Catatan: {payload['notes']}")
    lines.append("")
    lines.append("Balas *ya* untuk simpan sbg DRAFT, *batal* untuk batal.")
    return "\n".join(lines)


# ---------- Confirm create ----------

async def confirm_create(
    db: AsyncSession, *, user: User, session: BotPendingDocSession,
) -> Invoice:
    """Create Invoice DRAFT dari session payload. Caller harus commit."""
    payload = parse_payload(session)
    project = await db.get(Project, payload["project_id"])
    if project is None:
        raise BotDocError("Proyek tidak ditemukan (mungkin sudah dihapus).")

    inv_type_str = payload.get("type") or "IN"
    inv_type = InvoiceType.IN if inv_type_str == "IN" else InvoiceType.OUT

    invoice_date_s = payload.get("invoice_date")
    invoice_date = (
        _date.fromisoformat(invoice_date_s)
        if invoice_date_s else datetime.now(timezone.utc).date()
    )
    due_date_s = payload.get("due_date")
    due_date = _date.fromisoformat(due_date_s) if due_date_s else None

    # Number: pakai hasil OCR kalau ada & belum dipakai. Kalau dupe / kosong,
    # generate placeholder DRAFT-INV-{epoch}{user_id} -- user rename di web.
    raw_number = (payload.get("number") or "").strip()
    number = raw_number or _placeholder_number(user.id)
    # Dedup check + retry kalau collision.
    from sqlalchemy import select as _sel
    dup = (await db.execute(
        _sel(Invoice).where(Invoice.number == number)
    )).scalar_one_or_none()
    if dup is not None:
        # Nomor sudah dipakai -- generate placeholder unik.
        number = _placeholder_number(user.id, suffix=str(dup.id))

    items_payload: list[dict] = payload.get("items") or []
    if not items_payload:
        raise BotDocError("Session tidak punya item -- silakan /invoice ulang.")

    inv = Invoice(
        number=number,
        project_id=project.id,
        type=inv_type,
        invoice_date=invoice_date,
        due_date=due_date,
        vendor_client_id=payload.get("vendor_client_id"),
        party_name=payload.get("party_name"),
        tax=Decimal(str(payload.get("tax") or 0)),
        notes=payload.get("notes"),
        status=InvoiceStatus.DRAFT,
        created_by_id=user.id,
    )
    for it in items_payload:
        qty = Decimal(str(it.get("quantity") or 1))
        price = Decimal(str(it.get("unit_price") or 0))
        inv.items.append(InvoiceItem(
            description=it["description"],
            quantity=qty,
            unit=it.get("unit"),
            unit_price=price,
            subtotal=qty * price,
            category_id=None,
        ))
    # Compute totals (reuse helper kalau ada; otherwise inline).
    from app.api.v1.invoices import _compute_totals
    sub, tot = _compute_totals(inv.items, inv.tax)
    inv.subtotal = sub
    inv.total = tot
    db.add(inv)
    try:
        await db.flush()
    except Exception as e:
        await db.rollback()
        raise BotDocError(
            "Gagal simpan invoice (mungkin nomor duplikat). Edit dulu di web.",
        ) from e
    await delete_session(db, session)
    return inv


def _placeholder_number(user_id: int, suffix: str = "") -> str:
    """Format: DRAFT-INV-{YYMMDD}-{epoch_last5}{user_id}{suffix}."""
    now = datetime.now(timezone.utc)
    epoch = int(now.timestamp()) % 100000
    base = f"DRAFT-INV-{now.strftime('%y%m%d')}-{epoch}{user_id}"
    return f"{base}{suffix}" if suffix else base
