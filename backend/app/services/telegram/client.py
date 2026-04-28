"""HTTP client tipis untuk Bot API Telegram."""
from __future__ import annotations

import logging

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

API_BASE = "https://api.telegram.org"


def is_enabled() -> bool:
    return bool(settings.TELEGRAM_BOT_TOKEN)


def _api_url(method: str) -> str:
    return f"{API_BASE}/bot{settings.TELEGRAM_BOT_TOKEN}/{method}"


def _file_url(file_path: str) -> str:
    return f"{API_BASE}/file/bot{settings.TELEGRAM_BOT_TOKEN}/{file_path}"


async def send_message(
    chat_id: int | str,
    text: str,
    *,
    parse_mode: str | None = "HTML",
    disable_preview: bool = True,
    reply_to: int | None = None,
) -> dict | None:
    """Kirim pesan teks. Return body dari Telegram, atau None kalau gagal/disabled."""
    if not is_enabled():
        logger.debug("Telegram disabled (no token); skip send_message")
        return None
    payload: dict = {"chat_id": chat_id, "text": text}
    if parse_mode:
        payload["parse_mode"] = parse_mode
    if disable_preview:
        payload["disable_web_page_preview"] = True
    if reply_to:
        payload["reply_to_message_id"] = reply_to
    try:
        async with httpx.AsyncClient(timeout=10.0) as cli:
            r = await cli.post(_api_url("sendMessage"), json=payload)
            r.raise_for_status()
            return r.json()
    except Exception as e:
        logger.warning("telegram send_message failed: %s", e)
        return None


async def get_file_path(file_id: str) -> str | None:
    """Tukar file_id -> file_path (path relatif di server file Telegram)."""
    if not is_enabled():
        return None
    try:
        async with httpx.AsyncClient(timeout=10.0) as cli:
            r = await cli.post(_api_url("getFile"), json={"file_id": file_id})
            r.raise_for_status()
            data = r.json()
            return data.get("result", {}).get("file_path")
    except Exception as e:
        logger.warning("telegram getFile failed: %s", e)
        return None


async def download_file(file_id: str) -> tuple[bytes, str] | None:
    """Download isi file. Return (bytes, file_path) atau None.
    file_path ada nama file aslinya di akhir; caller bisa pakai untuk extension.
    """
    file_path = await get_file_path(file_id)
    if not file_path:
        return None
    try:
        async with httpx.AsyncClient(timeout=30.0) as cli:
            r = await cli.get(_file_url(file_path))
            r.raise_for_status()
            return r.content, file_path
    except Exception as e:
        logger.warning("telegram download_file failed: %s", e)
        return None


async def set_webhook(url: str, secret: str | None = None) -> bool:
    if not is_enabled():
        return False
    payload: dict = {
        "url": url,
        "allowed_updates": ["message", "edited_message"],
        "drop_pending_updates": True,
    }
    if secret:
        payload["secret_token"] = secret
    try:
        async with httpx.AsyncClient(timeout=10.0) as cli:
            r = await cli.post(_api_url("setWebhook"), json=payload)
            r.raise_for_status()
            data = r.json()
            ok = bool(data.get("ok"))
            if not ok:
                logger.warning("setWebhook returned !ok: %s", data)
            return ok
    except Exception as e:
        logger.warning("telegram setWebhook failed: %s", e)
        return False


async def delete_webhook() -> bool:
    if not is_enabled():
        return False
    try:
        async with httpx.AsyncClient(timeout=10.0) as cli:
            r = await cli.post(_api_url("deleteWebhook"))
            r.raise_for_status()
            return True
    except Exception:
        return False
