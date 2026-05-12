"""Runtime app settings (DB > env fallback) yg di-manage SUPERADMIN via UI.

Strategi:
- Tabel AppSetting (key/value/is_secret/group_key/updated_by).
- Secret values di-encrypt at rest dgn Fernet (master key derived dr
  settings.SECRET_KEY env). Plaintext setting (mis. BOT username) saved
  apa adanya.
- In-process cache (dict) dgn TTL ringan -- refresh on PATCH atau setelah
  TTL detik. Multi-replica: max delay = TTL detik (eventual consistency).
- API publik:
    get_setting(key) -> str | None    # DB cache > env fallback
    set_setting(key, value, ...)       # encrypt + write + invalidate cache
    list_by_group(group) -> [dict]     # utk UI

Bootstrap: kalau DB kosong utk suatu key, fallback ke env vars (sesuai
spelling key yg sama). Kalau env juga kosong -> None / "".
"""

from __future__ import annotations

import base64
import hashlib
import logging
import time
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.models import AppSetting

log = logging.getLogger(__name__)

# Cache TTL detik -- balance antara responsive change & DB load.
_CACHE_TTL = 60
# Dict cache: key -> (value_or_none, expires_at).
_cache: dict[str, tuple[str | None, float]] = {}

# Whitelist key yg di-manage via UI + metadata (group + is_secret + label).
# Hanya key di whitelist yg boleh di-set/lihat lewat API utk keamanan.
SETTING_REGISTRY: dict[str, dict[str, Any]] = {
    # OCR
    "ANTHROPIC_API_KEY": {
        "group": "ocr", "secret": True,
        "label": "Anthropic API Key",
        "hint": "Generate di console.anthropic.com. Wajib utk engine Claude.",
    },
    "MISTRAL_API_KEY": {
        "group": "ocr", "secret": True,
        "label": "Mistral API Key",
        "hint": "Generate di console.mistral.ai. Wajib utk engine Mistral.",
    },
    "OCR_ENGINE": {
        "group": "ocr", "secret": False,
        "label": "Engine OCR Default",
        "hint": "claude / mistral / stub. Hanya jadi default awal di dropdown.",
    },
    "OCR_MODEL_CLAUDE": {
        "group": "ocr", "secret": False,
        "label": "Model Claude (opsional override)",
        "hint": "Default claude-haiku-4-5. Kosongkan utk pakai default.",
    },
    "OCR_MODEL_MISTRAL": {
        "group": "ocr", "secret": False,
        "label": "Model Mistral (opsional override)",
        "hint": "Default mistral-ocr-latest. Kosongkan utk pakai default.",
    },
    # Telegram
    "TELEGRAM_BOT_TOKEN": {
        "group": "telegram", "secret": True,
        "label": "Telegram Bot Token",
        "hint": "Dari @BotFather. Kosong = integrasi off.",
    },
    "TELEGRAM_WEBHOOK_SECRET": {
        "group": "telegram", "secret": True,
        "label": "Webhook Secret",
        "hint": "Random string utk verifikasi webhook dr Telegram.",
    },
    # WhatsApp / WAHA
    "WHATSAPP_BASE_URL": {
        "group": "whatsapp", "secret": False,
        "label": "WAHA Base URL",
        "hint": "Mis. http://waha.example.com:3000 (tanpa trailing slash).",
    },
    "WHATSAPP_SESSION": {
        "group": "whatsapp", "secret": False,
        "label": "Session Name",
        "hint": "Default 'default'. WAHA Core hanya 1 session.",
    },
    "WHATSAPP_API_KEY": {
        "group": "whatsapp", "secret": True,
        "label": "WAHA API Key",
        "hint": "Header X-Api-Key. Boleh kosong utk WAHA Core tanpa auth.",
    },
    # System
    "PUBLIC_BASE_URL": {
        "group": "system", "secret": False,
        "label": "Public Base URL",
        "hint": "URL backend yg accessible dari Telegram/WAHA webhook.",
    },
}


def _fernet() -> Fernet:
    """Derive Fernet key dr SECRET_KEY env (stable per deploy).

    SHA256(SECRET_KEY) -> 32 bytes -> urlsafe-b64 encode = valid Fernet key.
    Ganti SECRET_KEY = semua secret yg sdh di-encrypt jadi invalid (perlu
    re-set manual). Wajib pakai SECRET_KEY yg kuat di prod.
    """
    digest = hashlib.sha256(settings.SECRET_KEY.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def _encrypt(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def _decrypt(token: str) -> str | None:
    try:
        return _fernet().decrypt(token.encode("ascii")).decode("utf-8")
    except InvalidToken:
        log.warning("app_settings.decrypt_failed -- SECRET_KEY rotated?")
        return None


def _env_fallback(key: str) -> str:
    """Ambil nilai dr env settings sbg fallback kalau DB kosong."""
    return str(getattr(settings, key, "") or "")


def _invalidate(key: str | None = None) -> None:
    """Hapus 1 key (kalau diisi) atau seluruh cache."""
    if key is None:
        _cache.clear()
    else:
        _cache.pop(key, None)


async def get_setting(db: AsyncSession, key: str) -> str:
    """Get nilai effective utk key (DB > env > "").

    Cache hit short-circuit. Cache miss: query DB, decrypt jika secret,
    fallback ke env kalau row tdk ada.
    """
    now = time.monotonic()
    cached = _cache.get(key)
    if cached and cached[1] > now:
        return cached[0] or ""
    if key not in SETTING_REGISTRY:
        # Bukan setting yg di-manage -- selalu env.
        v = _env_fallback(key)
        _cache[key] = (v, now + _CACHE_TTL)
        return v
    res = await db.execute(select(AppSetting).where(AppSetting.key == key))
    row = res.scalar_one_or_none()
    if row is None or not row.value:
        v = _env_fallback(key)
    elif row.is_secret:
        decrypted = _decrypt(row.value)
        v = decrypted if decrypted is not None else _env_fallback(key)
    else:
        v = row.value
    _cache[key] = (v, now + _CACHE_TTL)
    return v


async def set_setting(
    db: AsyncSession,
    key: str,
    value: str | None,
    *,
    user_id: int | None = None,
    commit: bool = True,
) -> None:
    """Set nilai key. None / "" = hapus (set NULL di DB).

    Reject key tdk di-whitelist. Encrypt kalau secret. Invalidate cache.
    """
    meta = SETTING_REGISTRY.get(key)
    if meta is None:
        raise ValueError(f"setting_not_whitelisted: {key}")
    res = await db.execute(select(AppSetting).where(AppSetting.key == key))
    row = res.scalar_one_or_none()
    stored: str | None = None
    if value:
        stored = _encrypt(value) if meta["secret"] else value
    if row is None:
        db.add(AppSetting(
            key=key,
            value=stored,
            is_secret=meta["secret"],
            group_key=meta["group"],
            updated_by_id=user_id,
        ))
    else:
        row.value = stored
        row.is_secret = meta["secret"]
        row.group_key = meta["group"]
        row.updated_by_id = user_id
    if commit:
        await db.commit()
    _invalidate(key)


async def list_settings(db: AsyncSession) -> list[dict]:
    """List SEMUA setting di registry utk UI.

    Return: [{key, group, label, hint, is_secret, has_value, value (kalau
    not secret), env_value (kalau ada, untuk transparansi fallback)}].
    Secret value TIDAK di-return -- hanya boolean 'has_value'.
    """
    res = await db.execute(select(AppSetting))
    rows = {r.key: r for r in res.scalars().all()}
    out: list[dict] = []
    for key, meta in SETTING_REGISTRY.items():
        row = rows.get(key)
        has_value = bool(row and row.value)
        env_value = _env_fallback(key)
        item: dict[str, Any] = {
            "key": key,
            "group": meta["group"],
            "label": meta["label"],
            "hint": meta.get("hint"),
            "is_secret": meta["secret"],
            "has_value": has_value,
            "from_env": (not has_value) and bool(env_value),
        }
        if not meta["secret"]:
            # Non-secret: tampilkan value effective (DB > env)
            if row and row.value is not None:
                item["value"] = row.value
            elif env_value:
                item["value"] = env_value
            else:
                item["value"] = ""
        else:
            # Secret: hanya tunjukkan "set" (preview 4 char terakhir kalau ada)
            if has_value and row is not None:
                dec = _decrypt(row.value or "")
                item["preview"] = ("•" * 4 + (dec[-4:] if dec else "")) if dec else None
            elif env_value:
                item["preview"] = "•" * 4 + env_value[-4:]
            else:
                item["preview"] = None
        out.append(item)
    return out


def invalidate_all() -> None:
    """Hapus cache (panggil dari endpoint bulk update atau test)."""
    _invalidate(None)


def get_cached(key: str) -> str:
    """Sync read dari cache. Fallback ke env kalau cache miss.

    Dipakai oleh callsite SYNC (mis. service Telegram/WAHA client yg ada
    function helper non-async). Cache di-warm via bootstrap_cache() di
    startup app + auto-populated saat get_setting() async dipanggil.

    Kalau cache miss & ada env value -> return env (transparent fallback).
    Cache stale max _CACHE_TTL detik setelah PATCH.
    """
    cached = _cache.get(key)
    if cached and cached[1] > time.monotonic():
        return cached[0] or ""
    return _env_fallback(key)


async def bootstrap_cache(db: AsyncSession) -> None:
    """Warm cache dgn SEMUA registry key dari DB.

    Panggil di startup app supaya sync readers (get_cached) langsung
    dapat nilai DB. Tanpa ini, callsite sync pertama bakal pakai env
    (kemudian baru populated saat ada async get_setting call).
    """
    for key in SETTING_REGISTRY.keys():
        try:
            await get_setting(db, key)
        except Exception as e:  # noqa: BLE001
            log.warning("app_settings.bootstrap_cache.failed key=%s err=%s", key, e)
