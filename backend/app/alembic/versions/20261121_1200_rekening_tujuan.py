"""Rekening tujuan pembayaran di PO dan pengajuan kas (terenkripsi, seperti bank_account).

Revision ID: v4e7a1c9d3b6
Revises: u8d2f6a4b9c1
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "v4e7a1c9d3b6"
down_revision: str | Sequence[str] | None = "u8d2f6a4b9c1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "purchase_orders", sa.Column("rekening_tujuan", sa.String(length=500), nullable=True)
    )
    op.add_column(
        "cash_requests", sa.Column("rekening_tujuan", sa.String(length=500), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("cash_requests", "rekening_tujuan")
    op.drop_column("purchase_orders", "rekening_tujuan")
