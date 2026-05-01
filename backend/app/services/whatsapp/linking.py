"""Generate / consume kode 6 digit untuk meng-link user ke nomor WhatsApp.
Mirror dari telegram/linking.py.
"""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import User, WhatsAppLinkCode

LINK_TTL_MINUTES = 10


def _generate_code() -> str:
    return f"{secrets.randbelow(900_000) + 100_000}"


async def issue_code(db: AsyncSession, user: User) -> WhatsAppLinkCode:
    existing_q = select(WhatsAppLinkCode).where(
        WhatsAppLinkCode.user_id == user.id,
        WhatsAppLinkCode.used_at.is_(None),
    )
    for old in (await db.execute(existing_q)).scalars().all():
        old.expires_at = datetime.now(timezone.utc)
    expires = datetime.now(timezone.utc) + timedelta(minutes=LINK_TTL_MINUTES)
    for _ in range(5):
        code = _generate_code()
        if not (await db.execute(
            select(WhatsAppLinkCode).where(WhatsAppLinkCode.code == code)
        )).scalar_one_or_none():
            break
    row = WhatsAppLinkCode(user_id=user.id, code=code, expires_at=expires)
    db.add(row)
    await db.flush()
    return row


async def consume_code(db: AsyncSession, code: str, chat_id: str) -> User | None:
    q = select(WhatsAppLinkCode).where(WhatsAppLinkCode.code == code)
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
    other_q = select(User).where(User.whatsapp_chat_id == chat_id, User.id != user.id)
    for other in (await db.execute(other_q)).scalars().all():
        other.whatsapp_chat_id = None
    user.whatsapp_chat_id = chat_id
    row.used_at = datetime.now(timezone.utc)
    await db.flush()
    return user
