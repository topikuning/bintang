"""Orkestrator notifikasi multi-channel (Telegram + WhatsApp).

Tugasnya tipis: untuk satu event (transaksi disubmit/verifikasi/ditolak),
kirim ke semua channel yang (a) di-aktifkan di MessagingConfig dan (b)
user-nya sudah link.

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
    notify_transaction_rejected as tg_notify_rejected,
    notify_transaction_submitted as tg_notify_submitted,
    notify_transaction_verified as tg_notify_verified,
)
from app.services.whatsapp import client as wa
from app.services.whatsapp import commands as wa_cmds

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
# WhatsApp notifier (ringkas, di sini saja supaya sub-paket wa/ tetap fokus
# ke command + transport)
# ---------------------------------------------------------------------------

def _fmt_idr(n) -> str:
    n = float(n or 0)
    return f"{n:,.0f}".replace(",", ".")


async def _wa_admins_for_project(db: AsyncSession, project_id: int) -> list[User]:
    rows: list[User] = []
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
            ProjectUser.project_id == project_id,
            User.role == UserRole.PROJECT_ADMIN,
            User.is_active.is_(True),
            User.whatsapp_chat_id.is_not(None),
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


async def _wa_notify_submitted(db: AsyncSession, tx: Transaction) -> None:
    try:
        proj = await db.get(Project, tx.project_id)
        creator = await db.get(User, tx.created_by_id)
        admins = await _wa_admins_for_project(db, tx.project_id)
        if not admins:
            return
        sym = "−" if tx.type == TxnType.OUT else "+"
        desc = (tx.description or tx.party_name or "-")[:100]
        text = (
            "🔔 *Transaksi menunggu verifikasi*\n"
            f"#{tx.id} `{proj.code if proj else '-'}` "
            f"{sym}Rp {_fmt_idr(tx.amount)}\n"
            f"_{desc}_\n"
            f"Dibuat oleh: {creator.name if creator else '-'}\n"
        )
        for a in admins:
            await wa.send_text(a.whatsapp_chat_id, text)
    except Exception:
        logger.exception("wa notify_transaction_submitted failed")


async def _wa_notify_verified(db: AsyncSession, tx: Transaction) -> None:
    try:
        creator = await db.get(User, tx.created_by_id)
        if not creator or not creator.whatsapp_chat_id:
            return
        proj = await db.get(Project, tx.project_id)
        sym = "−" if tx.type == TxnType.OUT else "+"
        desc = (tx.description or "-")[:100]
        text = (
            "✅ *Transaksi diverifikasi*\n"
            f"#{tx.id} `{proj.code if proj else '-'}` "
            f"{sym}Rp {_fmt_idr(tx.amount)}\n"
            f"_{desc}_"
        )
        await wa.send_text(creator.whatsapp_chat_id, text)
    except Exception:
        logger.exception("wa notify_transaction_verified failed")


async def _wa_notify_rejected(db: AsyncSession, tx: Transaction) -> None:
    try:
        creator = await db.get(User, tx.created_by_id)
        if not creator or not creator.whatsapp_chat_id:
            return
        proj = await db.get(Project, tx.project_id)
        text = (
            "❌ *Transaksi ditolak*\n"
            f"#{tx.id} `{proj.code if proj else '-'}` "
            f"Rp {_fmt_idr(tx.amount)}\n"
            f"_Alasan:_ {tx.cancel_reason or '-'}"
        )
        await wa.send_text(creator.whatsapp_chat_id, text)
    except Exception:
        logger.exception("wa notify_transaction_rejected failed")


# ---------------------------------------------------------------------------
# Public API: dipanggil dari endpoint transactions.py
# ---------------------------------------------------------------------------

async def notify_transaction_submitted(db: AsyncSession, tx: Transaction) -> None:
    if await telegram_active(db):
        await tg_notify_submitted(db, tx)
    if await whatsapp_active(db):
        await _wa_notify_submitted(db, tx)


async def notify_transaction_verified(db: AsyncSession, tx: Transaction) -> None:
    if await telegram_active(db):
        await tg_notify_verified(db, tx)
    if await whatsapp_active(db):
        await _wa_notify_verified(db, tx)


async def notify_transaction_rejected(db: AsyncSession, tx: Transaction) -> None:
    if await telegram_active(db):
        await tg_notify_rejected(db, tx)
    if await whatsapp_active(db):
        await _wa_notify_rejected(db, tx)
