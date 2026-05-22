"""encrypt_bank_accounts

Encrypt existing values di kolom sensitive (bank_account & party_account)
pakai Fernet (services/field_crypto.encrypt_field). Field type berubah
String(200) -> String(500) supaya cukup utk Fernet ciphertext.

Backward-compat di read: decrypt_field() pass-through kalau tdk ada
marker `enc:v1:` (legacy plain text). Migrasi ini encrypt SEMUA row
existing -- setelah jalan, semua row marked encrypted.

Audit 2026-05-22 #C3.

PENTING: SECRET_KEY harus stabil. Kalau di-rotate setelah migrasi ini,
decrypt akan fail (return '[DECRYPT_FAILED]' placeholder). Dokumentasi
key rotation: re-encrypt manual via script.

Revision ID: d4f8a2e7c1b5
Revises: c8e1d4f2a6b9
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd4f8a2e7c1b5'
down_revision: Union[str, Sequence[str], None] = 'c8e1d4f2a6b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_PREFIX = "enc:v1:"


def _encrypt_value(value):
    """Standalone encrypt -- tdk import services di runtime migration
    supaya migrasi tdk depends pada app code yg evolving."""
    if value is None:
        return None
    v = str(value).strip()
    if not v:
        return None
    if v.startswith(_PREFIX):
        return v  # already encrypted
    import base64
    import hashlib
    import os
    from cryptography.fernet import Fernet
    secret = os.environ.get("SECRET_KEY", "dev-secret-change-me-please-rotate-in-prod")
    digest = hashlib.sha256(secret.encode("utf-8")).digest()
    f = Fernet(base64.urlsafe_b64encode(digest))
    token = f.encrypt(v.encode("utf-8")).decode("ascii")
    return _PREFIX + token


_TARGETS = [
    ("companies", "bank_account"),
    ("vendors_clients", "bank_account"),
    ("transactions", "party_account"),
]


def upgrade() -> None:
    # 1. Widen column types (200 -> 500) supaya cukup utk ciphertext.
    for table, col in _TARGETS:
        with op.batch_alter_table(table) as batch:
            batch.alter_column(col, type_=sa.String(length=500))

    # 2. Encrypt existing values.
    conn = op.get_bind()
    for table, col in _TARGETS:
        rows = conn.execute(
            sa.text(f"SELECT id, {col} FROM {table} WHERE {col} IS NOT NULL")
        ).fetchall()
        for rid, raw in rows:
            encrypted = _encrypt_value(raw)
            if encrypted == raw:
                continue  # already encrypted, skip
            conn.execute(
                sa.text(f"UPDATE {table} SET {col} = :v WHERE id = :id"),
                {"v": encrypted, "id": rid},
            )


def downgrade() -> None:
    # WARNING: decrypt back ke plaintext (re-introducing security risk).
    # Hanya dipakai kalau rollback emergency.
    import base64
    import hashlib
    import os
    from cryptography.fernet import Fernet, InvalidToken
    secret = os.environ.get("SECRET_KEY", "dev-secret-change-me-please-rotate-in-prod")
    digest = hashlib.sha256(secret.encode("utf-8")).digest()
    f = Fernet(base64.urlsafe_b64encode(digest))

    conn = op.get_bind()
    for table, col in _TARGETS:
        rows = conn.execute(
            sa.text(f"SELECT id, {col} FROM {table} WHERE {col} IS NOT NULL")
        ).fetchall()
        for rid, val in rows:
            if not val or not str(val).startswith(_PREFIX):
                continue
            token = str(val)[len(_PREFIX):]
            try:
                plain = f.decrypt(token.encode("ascii")).decode("utf-8")
            except InvalidToken:
                continue
            conn.execute(
                sa.text(f"UPDATE {table} SET {col} = :v WHERE id = :id"),
                {"v": plain, "id": rid},
            )

    # Revert column widths.
    for table, col in _TARGETS:
        with op.batch_alter_table(table) as batch:
            batch.alter_column(col, type_=sa.String(length=200))
