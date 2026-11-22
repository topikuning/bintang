"""wa_pesan_masuk: penyaring pesan WA ganda (kiriman ulang WAHA, foto HD).

Revision ID: w2c8e4a6b1d9
Revises: v4e7a1c9d3b6
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "w2c8e4a6b1d9"
down_revision: str | Sequence[str] | None = "v4e7a1c9d3b6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "wa_pesan_masuk",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("msg_id", sa.String(length=160), nullable=True, unique=True),
        sa.Column("chat_id", sa.String(length=64), nullable=False),
        sa.Column("sidik", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_wa_pesan_masuk_chat_sidik", "wa_pesan_masuk", ["chat_id", "sidik"])


def downgrade() -> None:
    op.drop_index("ix_wa_pesan_masuk_chat_sidik", table_name="wa_pesan_masuk")
    op.drop_table("wa_pesan_masuk")
