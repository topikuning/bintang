"""Field-level encryption helper utk data sensitive (bank account, etc).

Pattern: gradual rollout.
- write(): selalu encrypt sblm store.
- read(): coba decrypt; kalau gagal -> assume legacy plain text, return as-is.

Marker prefix `enc:v1:` di-prepend ke ciphertext supaya read() bisa cepat
dispatch tanpa coba decrypt setiap string. Plain-text legacy tdk punya
prefix ini.

Pakai Fernet key yg sama dgn app_settings (derived dr SECRET_KEY).
Konsekuensi: rotasi SECRET_KEY = data sensitive tdk bisa di-decrypt
lagi. Harus dokumentasi & migration plan kalau key rotation.

Audit 2026-05-22 #C3.
"""
from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings


_PREFIX = "enc:v1:"


def _fernet() -> Fernet:
    """Re-derive key dr SECRET_KEY tiap call -- cheap, hindari race kalau
    SECRET_KEY berubah at runtime (jarang). Bisa di-cache nanti."""
    digest = hashlib.sha256(settings.SECRET_KEY.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_field(value: str | None) -> str | None:
    """Encrypt + prepend marker. None/empty -> None."""
    if value is None:
        return None
    v = value.strip()
    if not v:
        return None
    # Idempoten: kalau sudah ter-encrypt, jangan encrypt lagi.
    if v.startswith(_PREFIX):
        return v
    token = _fernet().encrypt(v.encode("utf-8")).decode("ascii")
    return _PREFIX + token


def decrypt_field(value: str | None) -> str | None:
    """Decrypt kalau ada marker, else return as-is (legacy plain)."""
    if value is None:
        return None
    if not value.startswith(_PREFIX):
        return value  # legacy plain text, pass-through
    token = value[len(_PREFIX):]
    try:
        return _fernet().decrypt(token.encode("ascii")).decode("utf-8")
    except InvalidToken:
        # Decrypt gagal (SECRET_KEY rotated tanpa re-encrypt?). Return
        # marker placeholder supaya UI tdk crash, tapi jelas ada masalah.
        return "[DECRYPT_FAILED]"


def is_encrypted(value: str | None) -> bool:
    """True kalau value sudah punya encryption marker."""
    return value is not None and value.startswith(_PREFIX)


# ---------- SQLAlchemy TypeDecorator ----------
# Transparent encrypt/decrypt at ORM layer. Pakai sbg pengganti
# String(N) di mapped_column.
from sqlalchemy.types import String, TypeDecorator


class EncryptedString(TypeDecorator):
    """String column yg auto-encrypt saat write & auto-decrypt saat read.

    Backward-compatible: row lama (plain text, no marker) di-pass-through
    saat read. Saat next write, ter-encrypt.

    Length default 500 -- cukup utk plaintext sampai ~120 char (Fernet
    ciphertext + base64 ~ 3x plaintext + 7-char prefix).
    """
    impl = String
    cache_ok = True

    def __init__(self, length: int = 500, **kw):
        super().__init__(length, **kw)

    def process_bind_param(self, value, dialect):  # type: ignore[override]
        return encrypt_field(value)

    def process_result_value(self, value, dialect):  # type: ignore[override]
        return decrypt_field(value)
