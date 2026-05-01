"""HTTP client tipis untuk WAHA (WhatsApp HTTP API).

WAHA Core endpoints yang dipakai:
  POST /api/sendText         { session, chatId, text }
  POST /api/sendImage        { session, chatId, file: {url|data}, caption }
  GET  /api/files/...        download media yang dilampirkan webhook
  GET  /api/sessions/{name}  status sesi -> { engine, status, ... }
  GET  /api/{name}/auth/qr   PNG QR code untuk pairing baru
  POST /api/sessions/{name}/restart
  POST /api/sessions/{name}/logout

Auth: kalau WAHA dijalankan dengan WHATSAPP_API_KEY, kirim header X-Api-Key.
WAHA Core tanpa auth: header dilewati saja.

Disabled (tidak dikonfigurasi) -> semua fungsi return None secara aman.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


def is_enabled() -> bool:
    return bool(settings.WHATSAPP_BASE_URL)


def _base_url() -> str:
    return settings.WHATSAPP_BASE_URL.rstrip("/")


def _headers() -> dict[str, str]:
    h = {"Accept": "application/json"}
    if settings.WHATSAPP_API_KEY:
        h["X-Api-Key"] = settings.WHATSAPP_API_KEY
    return h


def _session() -> str:
    return settings.WHATSAPP_SESSION or "default"


async def send_text(chat_id: str, text: str) -> dict | None:
    """Kirim pesan teks ke chat WhatsApp (chat_id format `<msisdn>@c.us`)."""
    if not is_enabled():
        logger.debug("whatsapp disabled; skip send_text")
        return None
    payload = {
        "session": _session(),
        "chatId": chat_id,
        "text": text,
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as cli:
            r = await cli.post(
                f"{_base_url()}/api/sendText",
                json=payload,
                headers=_headers(),
            )
            if r.status_code >= 400:
                logger.warning(
                    "WAHA sendText %s body=%s", r.status_code, r.text[:500]
                )
            r.raise_for_status()
            return r.json()
    except Exception as e:
        logger.warning("whatsapp send_text failed: %s", e)
        return None


async def send_image_url(chat_id: str, url: str, caption: str | None = None) -> dict | None:
    """Kirim gambar dengan URL publik (mis. URL /files/... yg sudah live)."""
    if not is_enabled():
        return None
    payload: dict[str, Any] = {
        "session": _session(),
        "chatId": chat_id,
        "file": {"url": url},
    }
    if caption:
        payload["caption"] = caption
    try:
        async with httpx.AsyncClient(timeout=30.0) as cli:
            r = await cli.post(
                f"{_base_url()}/api/sendImage",
                json=payload,
                headers=_headers(),
            )
            if r.status_code >= 400:
                logger.warning(
                    "WAHA sendImage %s body=%s", r.status_code, r.text[:500]
                )
            r.raise_for_status()
            return r.json()
    except Exception as e:
        logger.warning("whatsapp send_image_url failed: %s", e)
        return None


async def download_media(media_url: str) -> tuple[bytes, str | None] | None:
    """Download file yang dirujuk webhook WAHA (`message.media.url`).
    Return (bytes, mime). WAHA biasa kasih URL absolut yang nunjuk ke
    dirinya sendiri, jadi kita pakai apa adanya.
    """
    if not is_enabled():
        return None
    # URL kadang relatif ("/api/files/..."); prefiks dengan base URL.
    url = media_url
    if url.startswith("/"):
        url = _base_url() + url
    try:
        async with httpx.AsyncClient(timeout=30.0) as cli:
            r = await cli.get(url, headers=_headers())
            r.raise_for_status()
            return r.content, r.headers.get("content-type")
    except Exception as e:
        logger.warning("whatsapp download_media failed: %s", e)
        return None


async def session_status() -> dict | None:
    """Ambil status session: WORKING / SCAN_QR_CODE / FAILED / STOPPED / ..."""
    if not is_enabled():
        return None
    try:
        async with httpx.AsyncClient(timeout=10.0) as cli:
            r = await cli.get(
                f"{_base_url()}/api/sessions/{_session()}",
                headers=_headers(),
            )
            r.raise_for_status()
            return r.json()
    except Exception as e:
        logger.warning("whatsapp session_status failed: %s", e)
        return None


async def fetch_qr() -> tuple[bytes, str] | None:
    """Ambil QR code PNG untuk pairing. Return (bytes, content-type)."""
    if not is_enabled():
        return None
    try:
        async with httpx.AsyncClient(timeout=15.0) as cli:
            r = await cli.get(
                f"{_base_url()}/api/{_session()}/auth/qr",
                headers={**_headers(), "Accept": "image/png"},
                params={"format": "image"},
            )
            r.raise_for_status()
            return r.content, r.headers.get("content-type", "image/png")
    except Exception as e:
        logger.warning("whatsapp fetch_qr failed: %s", e)
        return None


async def restart_session() -> bool:
    if not is_enabled():
        return False
    try:
        async with httpx.AsyncClient(timeout=15.0) as cli:
            r = await cli.post(
                f"{_base_url()}/api/sessions/{_session()}/restart",
                headers=_headers(),
            )
            r.raise_for_status()
            return True
    except Exception as e:
        logger.warning("whatsapp restart_session failed: %s", e)
        return False


async def logout_session() -> bool:
    if not is_enabled():
        return False
    try:
        async with httpx.AsyncClient(timeout=15.0) as cli:
            r = await cli.post(
                f"{_base_url()}/api/sessions/{_session()}/logout",
                headers=_headers(),
            )
            r.raise_for_status()
            return True
    except Exception as e:
        logger.warning("whatsapp logout_session failed: %s", e)
        return False


async def set_webhook(url: str) -> bool:
    """Daftarkan webhook ke WAHA agar event `message` di-push ke kita.

    WAHA mendukung config webhook saat session dibuat / di-start. Untuk
    sesi yang sudah jalan, kita pakai PUT /api/sessions/{name} (atau
    POST /start) tergantung versi. Best-effort: log saja kalau gagal,
    user bisa set manual via WAHA dashboard.
    """
    if not is_enabled():
        return False
    payload = {
        "name": _session(),
        "config": {
            "webhooks": [
                {
                    "url": url,
                    "events": ["message", "session.status"],
                }
            ]
        },
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as cli:
            # PUT idempotent untuk session config yg sudah ada
            r = await cli.put(
                f"{_base_url()}/api/sessions/{_session()}",
                json=payload,
                headers=_headers(),
            )
            if r.status_code >= 400:
                logger.warning(
                    "WAHA setWebhook %s body=%s", r.status_code, r.text[:500]
                )
                return False
            return True
    except Exception as e:
        logger.warning("whatsapp set_webhook failed: %s", e)
        return False
