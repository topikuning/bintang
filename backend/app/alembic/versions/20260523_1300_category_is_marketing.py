"""category_is_marketing

Tambah Category.is_marketing utk pisahkan TX OUT marketing dari biaya
non-marketing di rincian keuangan -- cegah double-count dgn reservasi
Marketing % (per-project, Project.marketing_pct).

Audit 2026-05-23 user req.

Revision ID: h9e4b2d6f3a8
Revises: g8d3e1a5c7f2
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "h9e4b2d6f3a8"
down_revision: str | Sequence[str] | None = "g8d3e1a5c7f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "categories",
        sa.Column("is_marketing", sa.Boolean, nullable=False, server_default=sa.text("FALSE")),
    )


def downgrade() -> None:
    op.drop_column("categories", "is_marketing")
