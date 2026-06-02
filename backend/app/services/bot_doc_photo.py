"""Helper untuk webhook handler: detect command photo /invoice atau /po
dari caption + extract hints (proyek, vendor), lalu route ke assistant
yg sesuai.

Audit 2026-06-02: dipanggil dari api/v1/telegram.py & whatsapp.py saat
foto + caption command terdeteksi. Mengisolasi logic supaya kedua
webhook handler tipis & symmetric.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import InvoiceType, User

logger = logging.getLogger(__name__)


# Pola command yg trigger OCR doc flow.
_DOC_CMDS: dict[str, dict] = {
    "/po":          {"entity": "PO"},
    "/buatpo":      {"entity": "PO"},
    "/buat-po":     {"entity": "PO"},
    "/invoice":     {"entity": "INVOICE", "type": "IN"},
    "/invoice-in":  {"entity": "INVOICE", "type": "IN"},
    "/invoiceIn":   {"entity": "INVOICE", "type": "IN"},
    "/invoice-out": {"entity": "INVOICE", "type": "OUT"},
    "/invoiceOut":  {"entity": "INVOICE", "type": "OUT"},
    "/inv":         {"entity": "INVOICE", "type": "IN"},
}

_PROJ_HINT_RE = re.compile(r"\bproyek\s*[:\-]?\s*([A-Za-z0-9_\-\.]{2,40})", re.IGNORECASE)
_VENDOR_HINT_RE = re.compile(r"\bvendor\s*[:\-]?\s*([^\n]{2,80})", re.IGNORECASE)


@dataclass
class DocCmdSpec:
    entity: str                    # "PO" | "INVOICE"
    invoice_type: InvoiceType | None
    project_hint: str | None
    vendor_hint: str | None
    notes: str | None


def parse_doc_cmd(caption: str) -> DocCmdSpec | None:
    """Detect doc-command dari caption foto. Return None kalau bukan
    /po atau /invoice variant."""
    if not caption:
        return None
    stripped = caption.strip()
    if not stripped.startswith("/"):
        return None
    # First token (case-insensitive).
    head_end = len(stripped)
    for i, ch in enumerate(stripped):
        if ch in (" ", "\n", "\t"):
            head_end = i
            break
    head = stripped[:head_end].split("@", 1)[0].lower()
    spec = _DOC_CMDS.get(head)
    if spec is None:
        return None
    rest = stripped[head_end:].strip()
    proj_match = _PROJ_HINT_RE.search(rest)
    vendor_match = _VENDOR_HINT_RE.search(rest)
    project_hint = proj_match.group(1).strip() if proj_match else None
    vendor_hint = vendor_match.group(1).strip() if vendor_match else None
    # notes = caption tanpa command head + tanpa hints (kalau ada sisa).
    notes_text = rest
    if proj_match:
        notes_text = notes_text.replace(proj_match.group(0), "")
    if vendor_match:
        notes_text = notes_text.replace(vendor_match.group(0), "")
    notes = notes_text.strip() or None
    return DocCmdSpec(
        entity=spec["entity"],
        invoice_type=(
            InvoiceType.IN if spec.get("type") == "IN"
            else InvoiceType.OUT if spec.get("type") == "OUT"
            else None
        ),
        project_hint=project_hint,
        vendor_hint=vendor_hint,
        notes=notes,
    )


async def handle_doc_photo(
    db: AsyncSession,
    *,
    user: User | None,
    channel: str,
    chat_id: str,
    content: bytes,
    media_type: str,
    source_url: str | None,
    spec: DocCmdSpec,
) -> str:
    """Dispatch foto + spec ke assistant yg sesuai (PO atau Invoice).
    Return reply text utk dikirim ke user."""
    if user is None:
        return "Akun belum ter-link. Pakai /link <kode> dulu."
    try:
        if spec.entity == "PO":
            from app.services.bot_po_assistant import parse_photo_and_save
            return await parse_photo_and_save(
                db,
                user=user,
                channel=channel,
                chat_id=chat_id,
                content=content,
                media_type=media_type,
                source_url=source_url,
                project_hint=spec.project_hint,
                vendor_hint_override=spec.vendor_hint,
                notes=spec.notes,
            )
        elif spec.entity == "INVOICE":
            from app.services.bot_invoice_assistant import parse_photo_and_save
            return await parse_photo_and_save(
                db,
                user=user,
                channel=channel,
                chat_id=chat_id,
                content=content,
                media_type=media_type,
                source_url=source_url,
                invoice_type=spec.invoice_type or InvoiceType.IN,
                project_hint=spec.project_hint,
                notes=spec.notes,
            )
    except Exception as e:  # noqa: BLE001
        # BotDocError + lainnya. Logged untuk debug.
        from app.services.bot_doc_session import BotDocError
        if isinstance(e, BotDocError):
            return f"❌ {e}"
        logger.exception("handle_doc_photo failed")
        return f"⚠️ Gagal proses foto: {e}"
    return ""


async def handle_session_reply(
    db: AsyncSession,
    *,
    user: User,
    channel: str,
    chat_id: str,
    text: str,
) -> str:
    """Handle balasan ya/batal saat ada session aktif. Dispatch berdasarkan
    entity_type. Return "" kalau tdk ada session."""
    from app.services.bot_doc_session import (
        BotDocError,
        delete_session,
        load_active_session,
    )
    session = await load_active_session(db, channel=channel, chat_id=chat_id)
    if session is None:
        return ""
    t = text.strip().lower()
    if t in ("ya", "yes", "ok", "y", "✓"):
        try:
            if session.entity_type == "PO":
                from app.services.bot_po_assistant import confirm_create as create_po
                po = await create_po(db, user=user, session=session)
                return (
                    f"✅ PO dibuat sbg DRAFT: `{po.number}`\n"
                    f"Total: Rp {po.total or 0:,.0f}\n".replace(",", ".")
                    + "Lengkapi/edit di web kalau perlu, lalu submit utk approve."
                )
            elif session.entity_type == "INVOICE":
                from app.services.bot_invoice_assistant import confirm_create as create_inv
                inv = await create_inv(db, user=user, session=session)
                return (
                    f"✅ Invoice dibuat sbg DRAFT: `{inv.number}`\n"
                    f"Total: Rp {inv.total or 0:,.0f}\n".replace(",", ".")
                    + "Lengkapi/edit di web (nomor invoice resmi, kategori "
                    "item, dst), lalu Issue & verifikasi."
                )
        except BotDocError as e:
            return f"❌ {e}"
    if t in ("batal", "cancel", "no", "tidak"):
        await delete_session(db, session)
        return f"Dibatalkan. Session {session.entity_type.lower()} dihapus."
    return (
        f"⏳ Ada draf {session.entity_type.lower()} menunggu konfirmasi. "
        "Balas *ya* untuk simpan atau *batal* untuk batalkan."
    )
