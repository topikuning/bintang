"""projects.approved_at jadi TIMESTAMP WITH TIME ZONE.

Kolom ini satu-satunya DateTime tanpa zona waktu, padahal kode mengisinya
dengan `datetime.now(UTC)` (punya zona waktu). PostgreSQL + asyncpg menolak
nilai itu ("can't subtract offset-naive and offset-aware datetimes"), sehingga
setujui/tolak proposal proyek dan buat proyek oleh admin gagal 500.

Nilai lama dianggap UTC (dulu diisi `now()` server PostgreSQL yang ber-zona UTC).

Revision ID: r7c3e9a1f2b4
Revises: q2d8f4b7c1e5
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "r7c3e9a1f2b4"
down_revision: str | Sequence[str] | None = "q2d8f4b7c1e5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "projects",
        "approved_at",
        type_=sa.DateTime(timezone=True),
        existing_type=sa.DateTime(),
        existing_nullable=True,
        postgresql_using="approved_at AT TIME ZONE 'UTC'",
    )


def downgrade() -> None:
    op.alter_column(
        "projects",
        "approved_at",
        type_=sa.DateTime(),
        existing_type=sa.DateTime(timezone=True),
        existing_nullable=True,
        postgresql_using="approved_at AT TIME ZONE 'UTC'",
    )
