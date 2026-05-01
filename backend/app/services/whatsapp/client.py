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

import base64
import logging
from typing import Any
from urllib.parse import urlparse, urlunparse

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


def _rewrite_to_external(url: str) -> str:
    """WAHA sering kirim URL versi internal-nya sendiri (mis.
    `http://localhost:3000/api/files/...`) yang tidak resolvable dari
    backend kita. Kalau host URL adalah localhost/127.0.0.1 -- atau
    sama persis dengan host WAHA yg kita kenal -- timpa dengan
    WHATSAPP_BASE_URL biar request keluar ke alamat yg benar.

    Path + query dipertahankan apa adanya.
    """
    if not url or not url.startswith(("http://", "https://")):
        return url
    try:
        u = urlparse(url)
    except Exception:
        return url
    host = (u.hostname or "").lower()
    if host in {"localhost", "127.0.0.1", "0.0.0.0", "host.docker.internal"}:
        base = urlparse(_base_url())
        return urlunparse(u._replace(scheme=base.scheme, netloc=base.netloc))
    return url


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
    """Download file yang dirujuk webhook WAHA. Mendukung 3 bentuk:
    1) URL absolut http(s) — di-fetch apa adanya (dengan API key kalau set).
    2) Path relatif "/api/files/..." — di-prefiks base URL WAHA.
    3) data URI "data:image/...;base64,..." — di-decode langsung.
    Return (bytes, mime) atau None kalau gagal.
    """
    if not is_enabled():
        return None
    if media_url.startswith("data:"):
        try:
            header, b64 = media_url.split(",", 1)
            mime = header.split(":", 1)[1].split(";", 1)[0] or "application/octet-stream"
            return base64.b64decode(b64), mime
        except Exception as e:
            logger.warning("whatsapp data URI parse failed: %s", e)
            return None
    url = media_url
    if url.startswith("/"):
        url = _base_url() + url
    url = _rewrite_to_external(url)
    try:
        async with httpx.AsyncClient(timeout=30.0) as cli:
            r = await cli.get(url, headers=_headers())
            if r.status_code >= 400:
                logger.warning(
                    "WAHA download_media %s url=%s body=%s",
                    r.status_code, url, r.text[:300],
                )
            r.raise_for_status()
            return r.content, r.headers.get("content-type")
    except Exception as e:
        logger.warning("whatsapp download_media failed url=%s err=%s", url, e)
        return None


async def download_message_media(message_id: str) -> tuple[bytes, str | None, str | None] | None:
    """Fallback: kalau payload webhook tidak punya URL media (mis. WAHA
    Core dengan auto-download dimatikan), kita minta WAHA mengambilkan
    file-nya berdasarkan message id.

    Return (bytes, mime, filename) atau None.
    """
    if not is_enabled():
        return None
    # Variasi path tergantung versi/engine WAHA. Coba GET dulu, lalu POST.
    base = _base_url()
    sess = _session()
    get_urls = [
        f"{base}/api/{sess}/messages/{message_id}/download",
        f"{base}/api/messages/{message_id}/download",
        f"{base}/api/{sess}/messages/{message_id}/media",
    ]
    post_urls = [
        f"{base}/api/{sess}/files/{message_id}/download",
        f"{base}/api/files/{sess}/{message_id}/download",
    ]
    async with httpx.AsyncClient(timeout=30.0) as cli:
        for url in get_urls:
            try:
                r = await cli.get(url, headers=_headers())
                if r.status_code == 404:
                    continue
                if r.status_code >= 400:
                    logger.warning(
                        "WAHA GET %s -> %s body=%s",
                        url, r.status_code, r.text[:300],
                    )
                    continue
                return _parse_download_response(r)
            except Exception as e:
                logger.warning("whatsapp GET %s err=%s", url, e)
        for url in post_urls:
            try:
                r = await cli.post(url, headers=_headers())
                if r.status_code == 404:
                    continue
                if r.status_code >= 400:
                    logger.warning(
                        "WAHA POST %s -> %s body=%s",
                        url, r.status_code, r.text[:300],
                    )
                    continue
                return _parse_download_response(r)
            except Exception as e:
                logger.warning("whatsapp POST %s err=%s", url, e)
    return None


def _parse_download_response(r: httpx.Response) -> tuple[bytes, str | None, str | None]:
    disp = r.headers.get("content-disposition", "")
    fname = None
    if "filename=" in disp:
        fname = disp.split("filename=", 1)[1].strip("\"' ;")
    return r.content, r.headers.get("content-type"), fname


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
