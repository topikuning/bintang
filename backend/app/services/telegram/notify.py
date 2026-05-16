"""Notifikasi keluar dari sistem -> Telegram.

Audience-based broadcast (kerangka 4-eyes):
- creator (tx.created_by_id) + admin proyek (SUPERADMIN/CENTRAL_ADMIN/
  PROJECT_ADMIN linked) menerima setiap perubahan state.
- actor (orang yg trigger event) DI-EXCLUDE supaya tdk echo ke diri sendiri.

Best-effort: tidak boleh menggagalkan transaksi DB. Semua call di-wrap
try/except dan dijalankan setelah commit.
"""
from __future__ import annotations

import html
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


def _esc(s) -> str:
    if s is None:
        return "-"
    return html.escape(str(s), quote=False)


async def _audience_for_tx(
    db: AsyncSession,
    tx: Transaction,
    *,
    exclude_user_id: int | None = None,
) -> list[User]:
    """Stakeholder Telegram untuk satu tx:

    - **creator** (tx.created_by_id) — pembuat tx
    - **central admins** (SUPERADMIN, CENTRAL_ADMIN) aktif
    - **project admins** (PROJECT_ADMIN ditugaskan ke proyek tsb) aktif

    Filter: hanya user yg sudah link `telegram_chat_id`. Dedup by user.id.
    Exclude `exclude_user_id` (actor yg trigger event) supaya tdk dpt
    notif echo ke diri sendiri.
    """
    rows: list[User] = []

    # 1. Creator
    if tx.created_by_id:
        creator = await db.get(User, tx.created_by_id)
        if creator and creator.is_active and creator.telegram_chat_id:
            rows.append(creator)

    # 2. Central admins
    q = select(User).where(
        User.role.in_([UserRole.SUPERADMIN, UserRole.CENTRAL_ADMIN]),
        User.is_active.is_(True),
        User.telegram_chat_id.is_not(None),
    )
    rows.extend((await db.execute(q)).scalars().all())

    # 3. Project admins linked ke proyek
    pq = (
        select(User)
        .join(ProjectUser, ProjectUser.user_id == User.id)
        .where(
            ProjectUser.project_id == tx.project_id,
            User.role == UserRole.PROJECT_ADMIN,
            User.is_active.is_(True),
            User.telegram_chat_id.is_not(None),
        )
    )
    rows.extend((await db.execute(pq)).scalars().all())

    seen: set[int] = set()
    out: list[User] = []
    for u in rows:
        if u.id == exclude_user_id:
            continue
        if u.id in seen:
            continue
        seen.add(u.id)
        out.append(u)
    return out


def _role_label(u: User) -> str:
    if u.role == UserRole.SUPERADMIN:
        return "Superadmin"
    if u.role == UserRole.CENTRAL_ADMIN:
        return "Admin Pusat"
    if u.role == UserRole.PROJECT_ADMIN:
        return "Admin Proyek"
    return "User"


async def _actor_name(db: AsyncSession, actor_id: int | None) -> str:
    if not actor_id:
        return "-"
    u = await db.get(User, actor_id)
    return u.name if u else "-"


async def notify_transaction_submitted(
    db: AsyncSession,
    tx: Transaction,
    *,
    actor_id: int | None = None,
) -> None:
    """Notif saat tx disubmit utk validasi.

    Audience: admin proyek + creator (kalau ada). Exclude submitter actor
    -- biasanya = creator, jadi creator tdk dpt echo, tapi admin tetap dpt.
    """
    try:
        proj = await db.get(Project, tx.project_id)
        audience = await _audience_for_tx(db, tx, exclude_user_id=actor_id)
        if not audience:
            return
        actor_name = await _actor_name(db, actor_id) if actor_id else "-"
        sym = "−" if tx.type == TxnType.OUT else "+"
        desc = (tx.description or tx.party_name or "-")[:100]
        text = (
            "🔔 <b>Transaksi menunggu verifikasi</b>\n"
            f"#{tx.id} <code>{_esc(proj.code if proj else '-')}</code> "
            f"{sym}Rp {_fmt_idr(tx.amount)}\n"
            f"<i>{_esc(desc)}</i>\n"
            f"Disubmit oleh: {_esc(actor_name)}"
        )
        for a in audience:
            await tg.send_message(a.telegram_chat_id, text)
    except Exception:
        logger.exception("notify_transaction_submitted failed")


async def notify_transaction_verified(
    db: AsyncSession,
    tx: Transaction,
    *,
    actor_id: int | None = None,
) -> None:
    """Notif saat tx diverifikasi.

    Audience: creator + admin proyek (PROJECT_ADMIN + central admin).
    Exclude verifier (actor) supaya admin yg verify tdk dpt echo notif
    ke diri sendiri.
    """
    try:
        # fallback ke verified_by_id kalau actor_id tdk dipass
        if actor_id is None:
            actor_id = tx.verified_by_id
        proj = await db.get(Project, tx.project_id)
        audience = await _audience_for_tx(db, tx, exclude_user_id=actor_id)
        if not audience:
            return
        actor_name = await _actor_name(db, actor_id)
        sym = "−" if tx.type == TxnType.OUT else "+"
        desc = (tx.description or "-")[:100]
        text = (
            "✅ <b>Transaksi diverifikasi</b>\n"
            f"#{tx.id} <code>{_esc(proj.code if proj else '-')}</code> "
            f"{sym}Rp {_fmt_idr(tx.amount)}\n"
            f"<i>{_esc(desc)}</i>\n"
            f"Diverifikasi oleh: {_esc(actor_name)}"
        )
        for a in audience:
            await tg.send_message(a.telegram_chat_id, text)
    except Exception:
        logger.exception("notify_transaction_verified failed")


async def notify_transaction_rejected(
    db: AsyncSession,
    tx: Transaction,
    *,
    actor_id: int | None = None,
) -> None:
    """Notif saat tx ditolak admin.

    Audience: creator + admin proyek. Exclude rejecter (actor).
    """
    try:
        proj = await db.get(Project, tx.project_id)
        audience = await _audience_for_tx(db, tx, exclude_user_id=actor_id)
        if not audience:
            return
        actor_name = await _actor_name(db, actor_id) if actor_id else "-"
        text = (
            "❌ <b>Transaksi ditolak</b>\n"
            f"#{tx.id} <code>{_esc(proj.code if proj else '-')}</code> "
            f"Rp {_fmt_idr(tx.amount)}\n"
            f"<i>Alasan:</i> {_esc(tx.cancel_reason or '-')}\n"
            f"Ditolak oleh: {_esc(actor_name)}"
        )
        for a in audience:
            await tg.send_message(a.telegram_chat_id, text)
    except Exception:
        logger.exception("notify_transaction_rejected failed")


async def notify_transaction_cancelled(
    db: AsyncSession,
    tx: Transaction,
    *,
    actor_id: int | None = None,
) -> None:
    """Notif saat tx dibatalkan.

    Audience: creator + admin proyek. Exclude pelaku cancel (actor).
    """
    try:
        proj = await db.get(Project, tx.project_id)
        audience = await _audience_for_tx(db, tx, exclude_user_id=actor_id)
        if not audience:
            return
        actor_name = await _actor_name(db, actor_id) if actor_id else "-"
        text = (
            "🚫 <b>Transaksi dibatalkan</b>\n"
            f"#{tx.id} <code>{_esc(proj.code if proj else '-')}</code> "
            f"Rp {_fmt_idr(tx.amount)}\n"
            f"<i>Alasan:</i> {_esc(tx.cancel_reason or '-')}\n"
            f"Dibatalkan oleh: {_esc(actor_name)}"
        )
        for a in audience:
            await tg.send_message(a.telegram_chat_id, text)
    except Exception:
        logger.exception("notify_transaction_cancelled failed")
