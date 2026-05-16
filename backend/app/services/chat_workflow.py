"""Shared chat command handlers untuk workflow transaksi & dana ops.

Dipakai oleh Telegram + WhatsApp service supaya logic tidak duplicate.
Tiap handler return string siap kirim (plain text -- HTML escape dilakukan
caller kalau perlu, tg pakai <code>, wa biasa).

Convention parameter:
- db: AsyncSession (sudah open)
- user: User object (sudah ter-authenticate via chat_id link)
- args: list[str] dari split message text
- channel: "tg" | "wa" (untuk format diff yg tipis)

Return: str -- pesan utk dikirim balik ke chat.
"""

from __future__ import annotations

import logging
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import user_project_ids
from app.models.models import (
    AuditAction,
    Transaction,
    TxnKind,
    TxnStatus,
    TxnType,
    User,
    UserRole,
)
from app.services.audit import log

logger = logging.getLogger(__name__)


def _fmt_tx_line(t: Transaction, *, with_status: bool = True) -> str:
    """Single-line summary tx utk list view."""
    arrow = "⬆" if t.type == TxnType.IN else "⬇"
    kind_emoji = {
        "INVOICE_PAYMENT": "🧾",
        "CASH_ADVANCE": "💼",
        "DIRECT_EXPENSE": "🧮",
    }.get(t.kind if isinstance(t.kind, str) else t.kind.value, "")
    status = f" [{t.status.value}]" if with_status else ""
    return (
        f"#{t.id} {arrow} {kind_emoji} Rp {float(t.amount):,.0f}"
        f"{status} -- {t.description or '-'}"
    ).replace(",", ".")


async def _get_tx_with_access(
    db: AsyncSession, user: User, tx_id: int
) -> Transaction | None:
    """Load tx + cek user punya akses proyeknya. Return None kalau tdk
    boleh atau tdk ada."""
    t = await db.get(Transaction, tx_id)
    if not t or t.deleted_at is not None:
        return None
    pids = await user_project_ids(db, user)
    if pids is not None and t.project_id not in pids:
        return None
    return t


# ============================================================
# Workflow commands: submit / verify / reject / cancel
# ============================================================

async def cmd_submit(
    db: AsyncSession, user: User, args: list[str], **_
) -> str:
    """Submit tx DRAFT/REJECTED -> SUBMITTED (siap di-verifikasi admin)."""
    if not args:
        return "Format: /submit <tx_id>\nMis: /submit 123"
    try:
        tx_id = int(args[0])
    except ValueError:
        return f"ID transaksi harus angka, dapat '{args[0]}'."
    t = await _get_tx_with_access(db, user, tx_id)
    if t is None:
        return f"Tx #{tx_id} tidak ditemukan atau bukan akses Anda."
    if t.status not in (TxnStatus.DRAFT, TxnStatus.REJECTED):
        return (
            f"Tx #{tx_id} status {t.status.value} -- tdk bisa di-submit. "
            f"Hanya DRAFT/REJECTED yg boleh."
        )
    t.status = TxnStatus.SUBMITTED
    await log(
        db, user_id=user.id, entity="transaction", entity_id=t.id,
        action=AuditAction.SUBMIT, note="via chat bot",
    )
    await db.commit()
    from app.services.messaging import notify_transaction_submitted
    await notify_transaction_submitted(db, t, actor_id=user.id)
    return (
        f"✓ Tx #{tx_id} di-submit utk validasi.\n"
        f"{_fmt_tx_line(t, with_status=True)}\n"
        f"Admin akan verify atau reject."
    )


async def cmd_verify(
    db: AsyncSession, user: User, args: list[str], **_
) -> str:
    """Verify tx SUBMITTED -> VERIFIED. Hanya CENTRAL_ADMIN+SUPERADMIN."""
    if user.role not in (UserRole.SUPERADMIN, UserRole.CENTRAL_ADMIN):
        return "Hanya admin (CENTRAL_ADMIN/SUPERADMIN) yg bisa verify."
    if not args:
        return "Format: /verify <tx_id>\nMis: /verify 123"
    try:
        tx_id = int(args[0])
    except ValueError:
        return f"ID transaksi harus angka, dapat '{args[0]}'."
    t = await _get_tx_with_access(db, user, tx_id)
    if t is None:
        return f"Tx #{tx_id} tidak ditemukan atau bukan akses Anda."
    if t.status != TxnStatus.SUBMITTED:
        return (
            f"Tx #{tx_id} status {t.status.value} -- tdk bisa verify. "
            f"Hanya SUBMITTED yg boleh."
        )
    t.status = TxnStatus.VERIFIED
    t.verified_by_id = user.id
    t.verified_at = datetime.utcnow()
    await log(
        db, user_id=user.id, entity="transaction", entity_id=t.id,
        action=AuditAction.VERIFY, note="via chat bot",
    )
    await db.commit()
    from app.services.messaging import notify_transaction_verified
    await notify_transaction_verified(db, t, actor_id=user.id)
    return (
        f"✓ Tx #{tx_id} ter-VERIFIED.\n"
        f"{_fmt_tx_line(t, with_status=False)}\n"
        f"Audit lock aktif -- hanya SUPERADMIN yg bisa edit lagi."
    )


async def cmd_reject(
    db: AsyncSession, user: User, args: list[str], **_
) -> str:
    """Reject tx SUBMITTED -> REJECTED dgn alasan. Admin only."""
    if user.role not in (UserRole.SUPERADMIN, UserRole.CENTRAL_ADMIN):
        return "Hanya admin (CENTRAL_ADMIN/SUPERADMIN) yg bisa reject."
    if len(args) < 2:
        return (
            "Format: /tolak <tx_id> <alasan>\n"
            "Mis: /tolak 123 nominal tidak match dgn struk"
        )
    try:
        tx_id = int(args[0])
    except ValueError:
        return f"ID transaksi harus angka, dapat '{args[0]}'."
    reason = " ".join(args[1:]).strip()
    if not reason:
        return "Alasan wajib diisi."
    t = await _get_tx_with_access(db, user, tx_id)
    if t is None:
        return f"Tx #{tx_id} tidak ditemukan atau bukan akses Anda."
    if t.status != TxnStatus.SUBMITTED:
        return f"Tx #{tx_id} status {t.status.value} -- hanya SUBMITTED yg bisa di-reject."
    t.status = TxnStatus.REJECTED
    t.cancel_reason = reason
    await log(
        db, user_id=user.id, entity="transaction", entity_id=t.id,
        action=AuditAction.REJECT, note=f"via chat bot: {reason}",
    )
    await db.commit()
    from app.services.messaging import notify_transaction_rejected
    await notify_transaction_rejected(db, t, actor_id=user.id)
    return (
        f"⨯ Tx #{tx_id} di-REJECT.\n"
        f"Alasan: {reason}\n"
        f"Submitter bisa edit + /submit ulang."
    )


async def cmd_cancel(
    db: AsyncSession, user: User, args: list[str], **_
) -> str:
    """Cancel tx (DRAFT/SUBMITTED/REJECTED) -> CANCELLED."""
    if len(args) < 2:
        return (
            "Format: /batal <tx_id> <alasan>\n"
            "Mis: /batal 123 dobel input"
        )
    try:
        tx_id = int(args[0])
    except ValueError:
        return f"ID transaksi harus angka, dapat '{args[0]}'."
    reason = " ".join(args[1:]).strip()
    if not reason:
        return "Alasan wajib diisi."
    t = await _get_tx_with_access(db, user, tx_id)
    if t is None:
        return f"Tx #{tx_id} tidak ditemukan atau bukan akses Anda."
    if t.status == TxnStatus.VERIFIED and user.role != UserRole.SUPERADMIN:
        return "Tx sudah VERIFIED -- hanya SUPERADMIN yg bisa cancel."
    if t.status == TxnStatus.CANCELLED:
        return f"Tx #{tx_id} sudah CANCELLED."
    t.status = TxnStatus.CANCELLED
    t.cancel_reason = reason
    await log(
        db, user_id=user.id, entity="transaction", entity_id=t.id,
        action=AuditAction.CANCEL, note=f"via chat bot: {reason}",
    )
    await db.commit()
    from app.services.messaging import notify_transaction_cancelled
    await notify_transaction_cancelled(db, t, actor_id=user.id)
    return f"⨯ Tx #{tx_id} di-CANCEL.\nAlasan: {reason}"


# ============================================================
# View / list commands
# ============================================================

async def cmd_lihat(
    db: AsyncSession, user: User, args: list[str], **_
) -> str:
    """Detail satu tx by ID."""
    if not args:
        return "Format: /lihat <tx_id>"
    try:
        tx_id = int(args[0])
    except ValueError:
        return f"ID harus angka, dapat '{args[0]}'."
    t = await _get_tx_with_access(db, user, tx_id)
    if t is None:
        return f"Tx #{tx_id} tidak ditemukan atau bukan akses Anda."
    kind_label = {
        "INVOICE_PAYMENT": "Bayar Invoice",
        "CASH_ADVANCE": "Dana Operasional",
        "DIRECT_EXPENSE": "Beban Langsung",
    }.get(t.kind if isinstance(t.kind, str) else t.kind.value, "—")
    arrow = "Pemasukan" if t.type == TxnType.IN else "Pengeluaran"
    lines = [
        f"📄 Tx #{t.id}",
        f"Tipe: {arrow}" + (f" ({kind_label})" if t.type == TxnType.OUT else ""),
        f"Status: {t.status.value}",
        f"Tanggal: {t.tx_date.isoformat() if t.tx_date else '-'}",
        f"Nominal: Rp {float(t.amount):,.0f}".replace(",", "."),
        f"Proyek ID: {t.project_id}",
        f"Pihak: {t.party_name or '-'}",
        f"Deskripsi: {t.description or '-'}",
    ]
    if t.recipient_name or t.recipient_user_id:
        lines.append(f"Penerima: {t.recipient_name or f'User #{t.recipient_user_id}'}")
    if t.cancel_reason:
        lines.append(f"Alasan batal: {t.cancel_reason}")
    return "\n".join(lines)


async def cmd_draft(
    db: AsyncSession, user: User, args: list[str], **_
) -> str:
    """List tx draft milik user (yg perlu di-submit)."""
    stmt = (
        select(Transaction)
        .where(
            Transaction.created_by_id == user.id,
            Transaction.status == TxnStatus.DRAFT,
            Transaction.deleted_at.is_(None),
        )
        .order_by(Transaction.tx_date.desc(), Transaction.id.desc())
        .limit(20)
    )
    txs = (await db.execute(stmt)).scalars().all()
    if not txs:
        return "Tidak ada transaksi DRAFT Anda saat ini."
    lines = [f"📝 {len(txs)} tx DRAFT milik Anda (max 20 terbaru):"]
    for t in txs:
        lines.append("  " + _fmt_tx_line(t, with_status=False))
    lines.append("\nSubmit utk validasi: /submit <id>")
    return "\n".join(lines)


# ============================================================
# Help text utk command baru
# ============================================================

WORKFLOW_HELP_LINES = [
    "",
    "Workflow validasi:",
    "  /submit <id>           — kirim tx draft utk validasi",
    "  /verify <id>           — admin verify tx submitted",
    "  /tolak <id> <alasan>   — admin reject tx",
    "  /batal <id> <alasan>   — cancel tx",
    "",
    "View & list:",
    "  /lihat <id>            — detail satu tx",
    "  /draft                 — tx draft milik Anda",
    "  /pending               — tx submitted siap verify (admin)",
]
