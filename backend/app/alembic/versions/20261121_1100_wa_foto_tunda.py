"""wa_foto_tunda: foto WA tanpa keterangan yang ditahan untuk BAYAR/TERIMA.

Revision ID: u8d2f6a4b9c1
Revises: t3b9c5e1a7d4
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "u8d2f6a4b9c1"
down_revision: str | Sequence[str] | None = "t3b9c5e1a7d4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "wa_foto_tunda",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("chat_id", sa.String(length=64), nullable=False),
        sa.Column("url", sa.String(length=500), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=True),
        sa.Column("file_size", sa.Integer(), nullable=True),
        sa.Column("mime_type", sa.String(length=120), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_wa_foto_tunda_chat_id", "wa_foto_tunda", ["chat_id"])


def downgrade() -> None:
    op.drop_index("ix_wa_foto_tunda_chat_id", table_name="wa_foto_tunda")
    op.drop_table("wa_foto_tunda")
