"""Generate / consume kode 6 digit untuk meng-link user ke chat Telegram."""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import TelegramLinkCode, User

LINK_TTL_MINUTES = 10


def _generate_code() -> str:
    """6 digit, jangan dimulai 0, mudah diketik."""
    return f"{secrets.randbelow(900_000) + 100_000}"


async def issue_code(db: AsyncSession, user: User) -> TelegramLinkCode:
    """Bersihkan kode lama user yang belum dipakai, terbitkan kode baru."""
    # invalidate kode aktif sebelumnya milik user
    existing_q = select(TelegramLinkCode).where(
        TelegramLinkCode.user_id == user.id,
        TelegramLinkCode.used_at.is_(None),
    )
    for old in (await db.execute(existing_q)).scalars().all():
        old.expires_at = datetime.now(timezone.utc)
    expires = datetime.now(timezone.utc) + timedelta(minutes=LINK_TTL_MINUTES)
    # tabrakan kode kecil kemungkinan; coba ulang sekali
    for _ in range(5):
        code = _generate_code()
        if not (await db.execute(
            select(TelegramLinkCode).where(TelegramLinkCode.code == code)
        )).scalar_one_or_none():
            break
    row = TelegramLinkCode(user_id=user.id, code=code, expires_at=expires)
    db.add(row)
    await db.flush()
    return row


async def consume_code(db: AsyncSession, code: str, chat_id: str) -> User | None:
    """Cocokkan kode -> set telegram_chat_id pada user. Return user kalau sukses."""
    q = select(TelegramLinkCode).where(TelegramLinkCode.code == code)
    row = (await db.execute(q)).scalar_one_or_none()
    if not row:
        return None
    if row.used_at is not None:
        return None
    if row.expires_at < datetime.now(timezone.utc):
        return None
    user = await db.get(User, row.user_id)
    if not user or not user.is_active:
        return None
    # kalau chat_id ini sudah dipakai user lain, lepaskan dulu untuk menghindari
    # benturan unique constraint.
    other_q = select(User).where(User.telegram_chat_id == chat_id, User.id != user.id)
    for other in (await db.execute(other_q)).scalars().all():
        other.telegram_chat_id = None
    user.telegram_chat_id = chat_id
    row.used_at = datetime.now(timezone.utc)
    await db.flush()
    return user
