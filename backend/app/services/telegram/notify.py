"""Notifikasi keluar dari sistem -> Telegram.

Best-effort: tidak boleh menggagalkan transaksi DB. Semua call di-wrap
try/except dan dijalankan setelah commit.
"""
from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import (
    Project,
    ProjectUser,
    Transaction,
    TxnType,
    User,
    UserRole,
)
from app.services.telegram import client as tg

logger = logging.getLogger(__name__)


def _fmt_idr(n) -> str:
    n = float(n or 0)
    return f"{n:,.0f}".replace(",", ".")


async def _admins_for_project(db: AsyncSession, project_id: int) -> list[User]:
    """User yang bisa verif transaksi di proyek tsb dan punya chat_id.
    SUPERADMIN/CENTRAL_ADMIN selalu masuk; PROJECT_ADMIN hanya yang di-link
    ke proyek tsb.
    """
    rows: list[User] = []
    # global admins
    q = select(User).where(
        User.role.in_([UserRole.SUPERADMIN, UserRole.CENTRAL_ADMIN]),
        User.is_active.is_(True),
        User.telegram_chat_id.is_not(None),
    )
    rows.extend((await db.execute(q)).scalars().all())
    # project admins yang ada di project_users
    pq = (
        select(User)
        .join(ProjectUser, ProjectUser.user_id == User.id)
        .where(
            ProjectUser.project_id == project_id,
            User.role == UserRole.PROJECT_ADMIN,
            User.is_active.is_(True),
            User.telegram_chat_id.is_not(None),
        )
    )
    rows.extend((await db.execute(pq)).scalars().all())
    seen: set[int] = set()
    out: list[User] = []
    for u in rows:
        if u.id not in seen:
            seen.add(u.id)
            out.append(u)
    return out


async def notify_transaction_submitted(db: AsyncSession, tx: Transaction) -> None:
    """Ping admin saat transaksi disubmit untuk diverifikasi."""
    try:
        proj = await db.get(Project, tx.project_id)
        creator = await db.get(User, tx.created_by_id)
        admins = await _admins_for_project(db, tx.project_id)
        if not admins:
            return
        sym = "−" if tx.type == TxnType.OUT else "+"
        text = (
            "🔔 <b>Transaksi menunggu verifikasi</b>\n"
            f"#{tx.id} <code>{proj.code if proj else '-'}</code> "
            f"{sym}Rp {_fmt_idr(tx.amount)}\n"
            f"<i>{(tx.description or tx.party_name or '-')[:100]}</i>\n"
            f"Dibuat oleh: {creator.name if creator else '-'}\n"
        )
        for a in admins:
            await tg.send_message(a.telegram_chat_id, text)
    except Exception:
        logger.exception("notify_transaction_submitted failed")


async def notify_transaction_verified(db: AsyncSession, tx: Transaction) -> None:
    try:
        creator = await db.get(User, tx.created_by_id)
        if not creator or not creator.telegram_chat_id:
            return
        proj = await db.get(Project, tx.project_id)
        sym = "−" if tx.type == TxnType.OUT else "+"
        text = (
            "✅ <b>Transaksi diverifikasi</b>\n"
            f"#{tx.id} <code>{proj.code if proj else '-'}</code> "
            f"{sym}Rp {_fmt_idr(tx.amount)}\n"
            f"<i>{(tx.description or '-')[:100]}</i>"
        )
        await tg.send_message(creator.telegram_chat_id, text)
    except Exception:
        logger.exception("notify_transaction_verified failed")


async def notify_transaction_rejected(db: AsyncSession, tx: Transaction) -> None:
    try:
        creator = await db.get(User, tx.created_by_id)
        if not creator or not creator.telegram_chat_id:
            return
        proj = await db.get(Project, tx.project_id)
        text = (
            "❌ <b>Transaksi ditolak</b>\n"
            f"#{tx.id} <code>{proj.code if proj else '-'}</code> "
            f"Rp {_fmt_idr(tx.amount)}\n"
            f"<i>Alasan:</i> {tx.cancel_reason or '-'}"
        )
        await tg.send_message(creator.telegram_chat_id, text)
    except Exception:
        logger.exception("notify_transaction_rejected failed")
