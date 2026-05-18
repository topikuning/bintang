"""fix_funder_user_email_domain

Migration sebelumnya (f1a2b3c4d5e6) pakai placeholder email
`funder-{id}@bintang.local`. Tapi `.local` adalah special-use TLD
(RFC 6762, multicast DNS) yg di-reject pydantic EmailStr -> GET
/api/v1/users crash 500.

Fix: UPDATE email pendana ke `funder-{id}@noreply.cvbintang.local.invalid`?
No -- `.invalid` juga reserved. Pakai `.example` (RFC 2606 reserved
khusus utk documentation/examples) -- di-accept email_validator.

Update DULU, lalu (untuk konsistensi forward) update juga migration
sebelumnya supaya kalau ada fresh deploy di env lain langsung pakai
domain valid (cosmetic, krn migration sebelumnya sudah immutable di
prod yg sudah migrate).

Revision ID: a7e9f3c8b2d1
Revises: f1a2b3c4d5e6
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a7e9f3c8b2d1'
down_revision: Union[str, Sequence[str], None] = 'f1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Replace `.local` domain ke `.example` di placeholder email
    pendana. Match prefix `funder-` saja supaya tdk affect email user
    lain yg kebetulan punya `.local` suffix (extremely unlikely tapi
    safe-guard)."""
    op.execute(
        sa.text("""
            UPDATE users
            SET email = REPLACE(email, '@bintang.local', '@bintang.example')
            WHERE email LIKE 'funder-%@bintang.local'
        """)
    )


def downgrade() -> None:
    op.execute(
        sa.text("""
            UPDATE users
            SET email = REPLACE(email, '@bintang.example', '@bintang.local')
            WHERE email LIKE 'funder-%@bintang.example'
        """)
    )
