"""cash_requests: penerima dana di luar pengguna aplikasi (pengajuan kas lewat WA).

Revision ID: t3b9c5e1a7d4
Revises: s5a1d7c3e8f2
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "t3b9c5e1a7d4"
down_revision: str | Sequence[str] | None = "s5a1d7c3e8f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("cash_requests", sa.Column("penerima_nama", sa.String(length=200), nullable=True))
    op.add_column("cash_requests", sa.Column("penerima_wa", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("cash_requests", "penerima_wa")
    op.drop_column("cash_requests", "penerima_nama")
