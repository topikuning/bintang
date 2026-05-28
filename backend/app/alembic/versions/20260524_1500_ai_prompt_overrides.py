"""ai_prompt_overrides

Tambah tabel ai_prompt_overrides utk SUPERADMIN custom prompt per
feature. Default selalu di code (services/ai/prompt_registry.py),
override hanya kalau ada row di tabel ini.

Audit 2026-05-24 user req: admin menu untuk sesuaikan prompt AI.

Revision ID: j5d2e8a1c4f7
Revises: i3a8b5c7e9d2
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'j5d2e8a1c4f7'
down_revision: Union[str, Sequence[str], None] = 'i3a8b5c7e9d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'ai_prompt_overrides',
        sa.Column('feature_key', sa.String(64), nullable=False),
        sa.Column(
            'field', sa.String(32), nullable=False,
            comment="'system' atau 'user_template'",
        ),
        sa.Column('content', sa.Text, nullable=False),
        sa.Column(
            'updated_by_id', sa.Integer, sa.ForeignKey('users.id'),
            nullable=True,
        ),
        sa.Column(
            'updated_at', sa.DateTime(timezone=True),
            server_default=sa.func.now(), onupdate=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint(
            'feature_key', 'field', name='pk_ai_prompt_overrides',
        ),
    )


def downgrade() -> None:
    op.drop_table('ai_prompt_overrides')
