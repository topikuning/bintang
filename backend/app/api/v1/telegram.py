"""Endpoint Telegram bot:
  GET  /api/v1/telegram/health      — status integrasi
  POST /api/v1/telegram/webhook     — receiver update dari Telegram
  POST /api/v1/me/telegram/link     — generate kode 6 digit untuk /link

Catatan: webhook diset dengan secret_token; Telegram mengirim header
`X-Telegram-Bot-Api-Secret-Token`. Selain header, kita juga dukung
query string `?secret=` agar bisa dites dengan curl manual.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.models import TelegramLinkCode, User
from app.services.telegram import client as tg
from app.services.telegram.commands import dispatch_command, handle_photo
from app.services.telegram.linking import LINK_TTL_MINUTES, issue_code

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/health")
async def health() -> dict:
    return {
        "enabled": tg.is_enabled(),
        "webhook_secret_set": bool(settings.TELEGRAM_WEBHOOK_SECRET),
    }


@router.post("/webhook")
async def webhook(
    request: Request,
    secret: str | None = None,
    x_telegram_bot_api_secret_token: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if not tg.is_enabled():
        raise HTTPException(503, "telegram_disabled")
    expected = settings.TELEGRAM_WEBHOOK_SECRET
    if expected:
        provided = x_telegram_bot_api_secret_token or secret
        if provided != expected:
            raise HTTPException(401, "bad_secret")

    update = await request.json()
    message = update.get("message") or update.get("edited_message")
    if not message:
        return {"ok": True, "skipped": "non-message update"}

    chat = message.get("chat") or {}
    chat_id = str(chat.get("id") or "")
    if not chat_id:
        return {"ok": True, "skipped": "no chat_id"}

    # cari user berdasarkan chat_id (kalau sudah link)
    user = (await db.execute(
        select(User).where(User.telegram_chat_id == chat_id)
    )).scalar_one_or_none()

    text: str = message.get("text") or message.get("caption") or ""
    reply: str = ""

    if text.startswith("/"):
        reply = await dispatch_command(db, user, chat_id, text, message)
    photos = message.get("photo")
    if photos:
        # Telegram kirim multiple resolusi; ambil yang paling besar (terakhir)
        biggest = photos[-1]
        file_id = biggest.get("file_id")
        cap = message.get("caption") or ""
        # kalau caption-nya juga command (/keluar dst), proses command dulu,
        # baru photo handler nempel ke transaksi yang baru dibuat.
        photo_reply = await handle_photo(db, user, chat_id, file_id, cap)
        if reply and photo_reply:
            reply = f"{reply}\n\n{photo_reply}"
        else:
            reply = reply or photo_reply

    # commit perubahan DB (link, create transaksi, attach foto, dst)
    await db.commit()

    if reply:
        await tg.send_message(chat_id, reply, reply_to=message.get("message_id"))
    return {"ok": True}


# --- Linking endpoint untuk web (perlu auth) -------------------------------

@router.post("/me/link-code")
async def issue_my_link_code(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Generate kode 6 digit; user ketik `/link <kode>` di bot Telegram."""
    if not tg.is_enabled():
        raise HTTPException(503, "telegram_disabled")
    row = await issue_code(db, user)
    await db.commit()
    return {
        "code": row.code,
        "expires_at": row.expires_at.isoformat(),
        "ttl_minutes": LINK_TTL_MINUTES,
        "already_linked": bool(user.telegram_chat_id),
    }


@router.post("/me/unlink")
async def unlink_me(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    user.telegram_chat_id = None
    await db.commit()
    return {"ok": True}


@router.get("/me/status")
async def my_telegram_status(
    user: User = Depends(get_current_user),
) -> dict:
    return {
        "linked": bool(user.telegram_chat_id),
        "enabled": tg.is_enabled(),
    }
