"""Endpoint WhatsApp via WAHA:
  GET  /api/v1/whatsapp/health           — status integrasi
  GET  /api/v1/whatsapp/session          — status session WAHA (admin)
  GET  /api/v1/whatsapp/qr               — PNG QR code untuk pairing (admin)
  POST /api/v1/whatsapp/restart          — restart session (admin)
  POST /api/v1/whatsapp/logout           — logout/unpair (admin)
  POST /api/v1/whatsapp/webhook          — receiver event dari WAHA
  POST /api/v1/whatsapp/me/link-code     — terbitkan kode 6 digit utk user
  POST /api/v1/whatsapp/me/unlink        — putuskan tautan
  GET  /api/v1/whatsapp/me/status        — status link user

Integrasi config (toggle):
  GET  /api/v1/messaging/config          — baca toggle TG/WA
  PATCH /api/v1/messaging/config         — ubah toggle (admin)
"""
from __future__ import annotations

import hashlib
import hmac
import logging

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.deps import get_current_user, require_superadmin
from app.db.session import get_db
from app.models.models import MessagingConfig, User
from app.services import messaging
from app.services.whatsapp import client as wa
from app.services.whatsapp.commands import dispatch_command, handle_media
from app.services.whatsapp.linking import LINK_TTL_MINUTES, issue_code

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Health & session admin endpoints
# ---------------------------------------------------------------------------

@router.get("/health")
async def health(db: AsyncSession = Depends(get_db)) -> dict:
    cfg = await messaging.get_config(db)
    await db.commit()
    return {
        "configured": wa.is_enabled(),
        "enabled_toggle": cfg.whatsapp_enabled,
        "webhook_secret_set": bool(settings.WHATSAPP_WEBHOOK_SECRET),
        "base_url": settings.WHATSAPP_BASE_URL or None,
        "session": settings.WHATSAPP_SESSION,
    }


@router.get("/session")
async def whatsapp_session(_: User = Depends(require_superadmin)) -> dict:
    if not wa.is_enabled():
        raise HTTPException(503, "whatsapp_not_configured")
    info = await wa.session_status()
    if info is None:
        raise HTTPException(502, "waha_unreachable")
    return info


@router.get("/qr")
async def whatsapp_qr(_: User = Depends(require_superadmin)) -> Response:
    if not wa.is_enabled():
        raise HTTPException(503, "whatsapp_not_configured")
    payload = await wa.fetch_qr()
    if payload is None:
        raise HTTPException(502, "qr_unavailable")
    content, mime = payload
    return Response(content, media_type=mime or "image/png")


@router.post("/restart")
async def whatsapp_restart(_: User = Depends(require_superadmin)) -> dict:
    if not wa.is_enabled():
        raise HTTPException(503, "whatsapp_not_configured")
    ok = await wa.restart_session()
    return {"ok": ok}


@router.post("/logout")
async def whatsapp_logout(_: User = Depends(require_superadmin)) -> dict:
    if not wa.is_enabled():
        raise HTTPException(503, "whatsapp_not_configured")
    ok = await wa.logout_session()
    return {"ok": ok}


@router.post("/test")
async def whatsapp_test(
    _: User = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Cek koneksi WhatsApp end-to-end: konfigurasi → toggle → WAHA session."""
    cfg = await messaging.get_config(db)
    await db.commit()

    configured = wa.is_enabled()
    info = wa.config_info()

    result: dict = {
        "configured": configured,
        "toggle_enabled": cfg.whatsapp_enabled,
        "waha_reachable": False,
        "session_status": None,
        "session_name": info["session"],
        "waha_url": info["base_url"],
        "engine": None,
    }

    if configured:
        session_data = await wa.session_status()
        if session_data is not None:
            result["waha_reachable"] = True
            result["session_status"] = (
                session_data.get("status")
                or session_data.get("state")
            )
            result["engine"] = session_data.get("engine") or (
                (session_data.get("config") or {}).get("engine")
            )

    return result


# ---------------------------------------------------------------------------
# Webhook receiver
# ---------------------------------------------------------------------------

def _verify_webhook_signature(raw_body: bytes, header: str | None) -> bool:
    """WAHA mengirim signature HMAC-SHA512 di header `X-Webhook-Hmac` saat
    `WAHA_HMAC_*` env diset di sisi WAHA. Kalau secret kita kosong, skip
    verifikasi (mode dev). Kalau header juga kosong padahal kita set
    secret -> tolak.
    """
    if not settings.WHATSAPP_WEBHOOK_SECRET:
        return True
    if not header:
        return False
    digest = hmac.new(
        settings.WHATSAPP_WEBHOOK_SECRET.encode("utf-8"),
        raw_body,
        hashlib.sha512,
    ).hexdigest()
    return hmac.compare_digest(digest, header)


def _extract_text(message: dict) -> str:
    """WAHA payload bisa beda-beda per engine (WEBJS/NOWEB). Coba beberapa
    field umum.
    """
    if not isinstance(message, dict):
        return ""
    body = message.get("body")
    if isinstance(body, str):
        return body
    text_obj = message.get("text")
    if isinstance(text_obj, dict):
        b = text_obj.get("body")
        if isinstance(b, str):
            return b
    if isinstance(text_obj, str):
        return text_obj
    cap = message.get("caption")
    if isinstance(cap, str):
        return cap
    return ""


def _sanitize_for_log(obj, max_len: int = 80):
    """Versi ringkas dict/list utk logging: string base64 panjang dipotong."""
    if isinstance(obj, str):
        return obj if len(obj) <= max_len else f"<str len={len(obj)}>"
    if isinstance(obj, dict):
        return {k: _sanitize_for_log(v, max_len) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_for_log(x, max_len) for x in obj[:5]]
    return obj


def _extract_media(message: dict) -> tuple[str, str | None, str | None] | None:
    """Cari sumber media di payload WAHA. Return (source, mime, filename).

    `source` bisa berupa URL HTTP, path relatif "/api/...", atau data URI
    `data:image/...;base64,...` -- semua ditangani oleh `download_media`.
    """
    if not isinstance(message, dict):
        return None

    media = message.get("media")
    if isinstance(media, dict):
        url = media.get("url") or media.get("link")
        if url:
            return url, media.get("mimetype"), media.get("filename")
        # base64 inline (WAHA dengan downloadMedia=false bisa pakai data)
        b64 = media.get("data") or media.get("body")
        if isinstance(b64, str) and b64:
            mime = media.get("mimetype") or "application/octet-stream"
            return f"data:{mime};base64,{b64}", mime, media.get("filename")

    # Field-field alternatif tergantung engine WAHA
    if message.get("hasMedia") or message.get("type") in ("image", "video", "document", "audio"):
        url = message.get("mediaUrl") or message.get("downloadUrl") or message.get("url")
        if url:
            return url, message.get("mimetype"), message.get("filename")

    return None


@router.post("/webhook")
async def webhook(
    request: Request,
    x_webhook_hmac: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if not wa.is_enabled():
        raise HTTPException(503, "whatsapp_disabled")

    raw = await request.body()
    if not _verify_webhook_signature(raw, x_webhook_hmac):
        raise HTTPException(401, "bad_signature")

    try:
        event = await request.json()
    except Exception:
        raise HTTPException(400, "invalid_json")

    # Cek toggle MessagingConfig: kalau dimatikan dari UI, abaikan.
    cfg = await messaging.get_config(db)
    if not cfg.whatsapp_enabled:
        return {"ok": True, "skipped": "whatsapp_disabled_via_toggle"}

    # WAHA membungkus dalam { event: "message", session, payload: {...} } atau
    # langsung object pesan bergantung versi. Kita support keduanya.
    event_name = event.get("event")
    payload = event.get("payload") if "payload" in event else event
    if event_name and event_name != "message":
        # event lain (session.status dll) belum kita pakai
        return {"ok": True, "skipped": event_name}

    if not isinstance(payload, dict):
        return {"ok": True, "skipped": "no payload"}

    # Hanya proses pesan masuk dari user (bukan echo dari kita sendiri)
    if payload.get("fromMe") or payload.get("from_me"):
        return {"ok": True, "skipped": "fromMe"}

    chat_id = payload.get("from") or payload.get("chatId") or ""
    chat_id = str(chat_id)
    if not chat_id:
        return {"ok": True, "skipped": "no chat_id"}

    user = (await db.execute(
        select(User).where(User.whatsapp_chat_id == chat_id)
    )).scalar_one_or_none()

    text = _extract_text(payload)
    reply: str = ""
    if text.startswith("/"):
        reply = await dispatch_command(db, user, chat_id, text, payload)

    msg_id = (
        payload.get("id")
        or payload.get("messageId")
        or (payload.get("key") or {}).get("id")
        if isinstance(payload, dict)
        else None
    )
    media = _extract_media(payload)
    is_media_msg = bool(media or payload.get("hasMedia") or payload.get("type") in (
        "image", "video", "document", "audio"
    ))
    if is_media_msg:
        url, mime, fname = (media if media else (None, None, None))
        if not media:
            # Tidak ada URL/data di payload, tapi ada indikasi media. Log
            # struktur payload supaya bisa di-debug, lalu coba fallback
            # download via message id.
            logger.warning(
                "WAHA webhook media without url; msg_id=%s payload=%s",
                msg_id, _sanitize_for_log(payload),
            )
        media_reply = await handle_media(
            db, user, chat_id, url, mime, fname, message_id=str(msg_id) if msg_id else None
        )
        if reply and media_reply:
            reply = f"{reply}\n\n{media_reply}"
        else:
            reply = reply or media_reply

    await db.commit()

    if reply:
        await wa.send_text(chat_id, reply)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Linking (per-user)
# ---------------------------------------------------------------------------

@router.post("/me/link-code")
async def issue_my_link_code(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    if not wa.is_enabled():
        raise HTTPException(503, "whatsapp_disabled")
    cfg = await messaging.get_config(db)
    if not cfg.whatsapp_enabled:
        raise HTTPException(503, "whatsapp_disabled_by_admin")
    row = await issue_code(db, user)
    await db.commit()
    return {
        "code": row.code,
        "expires_at": row.expires_at.isoformat(),
        "ttl_minutes": LINK_TTL_MINUTES,
        "already_linked": bool(user.whatsapp_chat_id),
    }


@router.post("/me/unlink")
async def unlink_me(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    user.whatsapp_chat_id = None
    await db.commit()
    return {"ok": True}


@router.get("/me/status")
async def my_whatsapp_status(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    cfg = await messaging.get_config(db)
    await db.commit()
    return {
        "linked": bool(user.whatsapp_chat_id),
        "enabled": wa.is_enabled() and cfg.whatsapp_enabled,
        "configured": wa.is_enabled(),
    }
