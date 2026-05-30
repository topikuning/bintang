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
from app.core.rate_limit import telegram_link_limiter
from app.db.session import get_db
from app.models.models import TelegramLinkCode, User
from app.services import messaging
from app.services.telegram import client as tg
from app.services.telegram.commands import dispatch_command, handle_photo
from app.services.telegram.linking import LINK_TTL_MINUTES, issue_code

logger = logging.getLogger(__name__)

router = APIRouter()


async def _handle_po_session_reply(
    db: AsyncSession, user: User, chat_id: str, text: str,
) -> str:
    """Handle balasan "ya"/"batal" utk PO session aktif. Return "" kalau
    tdk ada session aktif (caller akan lanjut ke command dispatcher /
    skip). Audit 2026-05-30."""
    from app.services.bot_po_assistant import (
        BotPOError, confirm_create, delete_session, load_active_session,
    )
    session = await load_active_session(db, channel="telegram", chat_id=chat_id)
    if session is None:
        return ""
    t = text.strip().lower()
    if t in ("ya", "yes", "ok", "y", "✓"):
        try:
            po = await confirm_create(db, user=user, session=session)
        except BotPOError as e:
            return f"❌ {e}"
        return (
            f"✅ PO dibuat sebagai <b>DRAFT</b>: <code>{po.number}</code>\n"
            f"Total: Rp {po.total or 0:,.0f}\n".replace(",", ".")
            + "Lengkapi/edit di web kalau perlu (harga, vendor, dst), "
            "lalu submit utk approve."
        )
    if t in ("batal", "cancel", "no", "tidak"):
        await delete_session(db, session)
        return "Dibatalkan. Session PO dihapus."
    # Balasan lain saat session aktif: jangan paksa ya/batal -- kasih hint
    # lalu fall-through (kalau text bukan /command -> tetap reply hint).
    return (
        "⏳ Ada draf PO menunggu konfirmasi. Balas <b>ya</b> untuk simpan "
        "atau <b>batal</b> untuk batalkan."
    )


@router.get("/health")
async def health(db: AsyncSession = Depends(get_db)) -> dict:
    cfg = await messaging.get_config(db)
    await db.commit()
    return {
        "configured": tg.is_enabled(),
        "enabled_toggle": cfg.telegram_enabled,
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
    cfg = await messaging.get_config(db)
    if not cfg.telegram_enabled:
        # toggle dimatikan admin: terima 200 supaya Telegram tidak retry
        return {"ok": True, "skipped": "telegram_disabled_via_toggle"}
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

    # Audit 2026-05-30: intercept "ya"/"batal" kalau ada PO session aktif.
    # User flow: /po -> bot preview -> user balas "ya" (plain text, no /).
    if user and text.strip() and not text.startswith("/"):
        reply = await _handle_po_session_reply(db, user, chat_id, text)

    if not reply and text.startswith("/"):
        reply = await dispatch_command(db, user, chat_id, text, message)

    # Lampiran: foto, dokumen (PDF/dll), atau video. Telegram membungkus
    # masing-masing tipe di field berbeda; semua punya `file_id` yg bisa
    # di-download dengan endpoint yg sama.
    file_id: str | None = None
    file_name: str | None = None
    photos = message.get("photo")
    document = message.get("document")
    video = message.get("video")
    if photos:
        biggest = photos[-1]  # resolusi tertinggi
        file_id = biggest.get("file_id")
    elif isinstance(document, dict):
        file_id = document.get("file_id")
        file_name = document.get("file_name")
    elif isinstance(video, dict):
        file_id = video.get("file_id")
        file_name = video.get("file_name")

    if file_id:
        cap = message.get("caption") or ""
        # Kalau caption-nya juga command (/keluar dst), command sudah
        # diproses di atas — di sini kita tinggal nempel attachment ke
        # transaksi pending (baru dibuat oleh command, atau dibuka oleh
        # /buktitx sebelumnya).
        photo_reply = await handle_photo(db, user, chat_id, file_id, cap, file_name=file_name)
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
    # Audit #H10: rate-limit per user supaya tdk bisa spam regenerate code
    # (yg akan invalidate code aktif sebelumnya -> potensi DoS internal).
    allowed, _ = telegram_link_limiter.check(f"tglink:{user.id}")
    if not allowed:
        raise HTTPException(429, "rate_limited: tunggu sebentar sebelum generate ulang kode link.")
    if not tg.is_enabled():
        raise HTTPException(503, "telegram_disabled")
    cfg = await messaging.get_config(db)
    if not cfg.telegram_enabled:
        raise HTTPException(503, "telegram_disabled_by_admin")
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
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    cfg = await messaging.get_config(db)
    await db.commit()
    return {
        "linked": bool(user.telegram_chat_id),
        "enabled": tg.is_enabled() and cfg.telegram_enabled,
        "configured": tg.is_enabled(),
    }
