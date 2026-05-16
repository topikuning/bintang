"""Orkestrator notifikasi multi-channel (Telegram + WhatsApp).

Tugasnya tipis: untuk satu event (transaksi disubmit/verifikasi/ditolak/
cancel), kirim ke semua channel yang (a) di-aktifkan di MessagingConfig
dan (b) user-nya sudah link.

Audience policy (sama di TG & WA, lihat docstring `_audience_for_tx`):
- creator + admin proyek (central + project_admin linked)
- exclude actor yg trigger event (no echo)

Detil format pesan & transport ada di sub-paket `telegram/` dan
`whatsapp/`. Modul ini hanya merangkai keduanya.
"""
from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import (
    MessagingConfig,
    Project,
    ProjectUser,
    Transaction,
    TxnType,
    User,
    UserRole,
)
from app.services.telegram import client as tg
from app.services.telegram.notify import (
    notify_transaction_cancelled as tg_notify_cancelled,
    notify_transaction_rejected as tg_notify_rejected,
    notify_transaction_submitted as tg_notify_submitted,
    notify_transaction_verified as tg_notify_verified,
)
from app.services.whatsapp import client as wa

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Config helpers
# ---------------------------------------------------------------------------

async def get_config(db: AsyncSession) -> MessagingConfig:
    """Ambil singleton config (id=1). Buat default kalau belum ada."""
    cfg = await db.get(MessagingConfig, 1)
    if cfg is None:
        cfg = MessagingConfig(id=1, telegram_enabled=True, whatsapp_enabled=True)
        db.add(cfg)
        await db.flush()
    return cfg


async def telegram_active(db: AsyncSession) -> bool:
    """Telegram aktif kalau env-token ada DAN toggle MessagingConfig on."""
    if not tg.is_enabled():
        return False
    cfg = await get_config(db)
    return cfg.telegram_enabled


async def whatsapp_active(db: AsyncSession) -> bool:
    if not wa.is_enabled():
        return False
    cfg = await get_config(db)
    return cfg.whatsapp_enabled


# ---------------------------------------------------------------------------
# WhatsApp audience + notifier
# ---------------------------------------------------------------------------

def _fmt_idr(n) -> str:
    n = float(n or 0)
    return f"{n:,.0f}".replace(",", ".")


async def _wa_audience_for_tx(
    db: AsyncSession,
    tx: Transaction,
    *,
    exclude_user_id: int | None = None,
) -> list[User]:
    """Stakeholder WhatsApp untuk satu tx: creator + admin proyek (central
    + project_admin linked). Dedup + filter `whatsapp_chat_id` non-null +
    exclude actor.
    """
    rows: list[User] = []
    if tx.created_by_id:
        creator = await db.get(User, tx.created_by_id)
        if creator and creator.is_active and creator.whatsapp_chat_id:
            rows.append(creator)
    q = select(User).where(
        User.role.in_([UserRole.SUPERADMIN, UserRole.CENTRAL_ADMIN]),
        User.is_active.is_(True),
        User.whatsapp_chat_id.is_not(None),
    )
    rows.extend((await db.execute(q)).scalars().all())
    pq = (
        select(User)
        .join(ProjectUser, ProjectUser.user_id == User.id)
        .where(
            ProjectUser.project_id == tx.project_id,
            User.role == UserRole.PROJECT_ADMIN,
            User.is_active.is_(True),
            User.whatsapp_chat_id.is_not(None),
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


async def _actor_name(db: AsyncSession, actor_id: int | None) -> str:
    if not actor_id:
        return "-"
    u = await db.get(User, actor_id)
    return u.name if u else "-"


async def _wa_notify_submitted(
    db: AsyncSession, tx: Transaction, actor_id: int | None
) -> None:
    try:
        proj = await db.get(Project, tx.project_id)
        audience = await _wa_audience_for_tx(db, tx, exclude_user_id=actor_id)
        if not audience:
            return
        actor_name = await _actor_name(db, actor_id) if actor_id else "-"
        sym = "−" if tx.type == TxnType.OUT else "+"
        desc = (tx.description or tx.party_name or "-")[:100]
        text = (
            "🔔 *Transaksi menunggu verifikasi*\n"
            f"#{tx.id} `{proj.code if proj else '-'}` "
            f"{sym}Rp {_fmt_idr(tx.amount)}\n"
            f"_{desc}_\n"
            f"Disubmit oleh: {actor_name}"
        )
        for a in audience:
            await wa.send_text(a.whatsapp_chat_id, text)
    except Exception:
        logger.exception("wa notify_transaction_submitted failed")


async def _wa_notify_verified(
    db: AsyncSession, tx: Transaction, actor_id: int | None
) -> None:
    try:
        if actor_id is None:
            actor_id = tx.verified_by_id
        audience = await _wa_audience_for_tx(db, tx, exclude_user_id=actor_id)
        if not audience:
            return
        actor_name = await _actor_name(db, actor_id)
        proj = await db.get(Project, tx.project_id)
        sym = "−" if tx.type == TxnType.OUT else "+"
        desc = (tx.description or "-")[:100]
        text = (
            "✅ *Transaksi diverifikasi*\n"
            f"#{tx.id} `{proj.code if proj else '-'}` "
            f"{sym}Rp {_fmt_idr(tx.amount)}\n"
            f"_{desc}_\n"
            f"Diverifikasi oleh: {actor_name}"
        )
        for a in audience:
            await wa.send_text(a.whatsapp_chat_id, text)
    except Exception:
        logger.exception("wa notify_transaction_verified failed")


async def _wa_notify_rejected(
    db: AsyncSession, tx: Transaction, actor_id: int | None
) -> None:
    try:
        audience = await _wa_audience_for_tx(db, tx, exclude_user_id=actor_id)
        if not audience:
            return
        actor_name = await _actor_name(db, actor_id) if actor_id else "-"
        proj = await db.get(Project, tx.project_id)
        text = (
            "❌ *Transaksi ditolak*\n"
            f"#{tx.id} `{proj.code if proj else '-'}` "
            f"Rp {_fmt_idr(tx.amount)}\n"
            f"_Alasan:_ {tx.cancel_reason or '-'}\n"
            f"Ditolak oleh: {actor_name}"
        )
        for a in audience:
            await wa.send_text(a.whatsapp_chat_id, text)
    except Exception:
        logger.exception("wa notify_transaction_rejected failed")


async def _wa_notify_cancelled(
    db: AsyncSession, tx: Transaction, actor_id: int | None
) -> None:
    try:
        audience = await _wa_audience_for_tx(db, tx, exclude_user_id=actor_id)
        if not audience:
            return
        actor_name = await _actor_name(db, actor_id) if actor_id else "-"
        proj = await db.get(Project, tx.project_id)
        text = (
            "🚫 *Transaksi dibatalkan*\n"
            f"#{tx.id} `{proj.code if proj else '-'}` "
            f"Rp {_fmt_idr(tx.amount)}\n"
            f"_Alasan:_ {tx.cancel_reason or '-'}\n"
            f"Dibatalkan oleh: {actor_name}"
        )
        for a in audience:
            await wa.send_text(a.whatsapp_chat_id, text)
    except Exception:
        logger.exception("wa notify_transaction_cancelled failed")


# ---------------------------------------------------------------------------
# Public API: dipanggil dari endpoint transactions.py + chat_workflow.py
# ---------------------------------------------------------------------------

async def notify_transaction_submitted(
    db: AsyncSession, tx: Transaction, *, actor_id: int | None = None,
) -> None:
    if await telegram_active(db):
        await tg_notify_submitted(db, tx, actor_id=actor_id)
    if await whatsapp_active(db):
        await _wa_notify_submitted(db, tx, actor_id)


async def notify_transaction_verified(
    db: AsyncSession, tx: Transaction, *, actor_id: int | None = None,
) -> None:
    if await telegram_active(db):
        await tg_notify_verified(db, tx, actor_id=actor_id)
    if await whatsapp_active(db):
        await _wa_notify_verified(db, tx, actor_id)


async def notify_transaction_rejected(
    db: AsyncSession, tx: Transaction, *, actor_id: int | None = None,
) -> None:
    if await telegram_active(db):
        await tg_notify_rejected(db, tx, actor_id=actor_id)
    if await whatsapp_active(db):
        await _wa_notify_rejected(db, tx, actor_id)


async def notify_transaction_cancelled(
    db: AsyncSession, tx: Transaction, *, actor_id: int | None = None,
) -> None:
    if await telegram_active(db):
        await tg_notify_cancelled(db, tx, actor_id=actor_id)
    if await whatsapp_active(db):
        await _wa_notify_cancelled(db, tx, actor_id)
