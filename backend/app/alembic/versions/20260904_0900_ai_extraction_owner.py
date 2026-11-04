"""Record the owner of OCR and contract uploads.

Revision ID: p4e8b2a6d1f9
Revises: n9c7e2f4d6a3
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "p4e8b2a6d1f9"
down_revision: str | Sequence[str] | None = "n9c7e2f4d6a3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "ai_extractions",
        sa.Column("user_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_ai_extractions_user_id_users",
        "ai_extractions",
        "users",
        ["user_id"],
        ["id"],
    )
    op.create_index(
        "ix_ai_extractions_user_id",
        "ai_extractions",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_ai_extractions_user_id", table_name="ai_extractions")
    op.drop_constraint(
        "fk_ai_extractions_user_id_users",
        "ai_extractions",
        type_="foreignkey",
    )
    op.drop_column("ai_extractions", "user_id")
