"""ai_feature_settings

Per-feature AI settings (provider, model, max_tokens, web_search, dst).
Default selalu di code. Override per feature kalau row exist.

Audit 2026-05-24 user req: SUPERADMIN atur per fitur, sistem tdk hardcode.

Revision ID: k6e3f9b2d5a8
Revises: j5d2e8a1c4f7
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'k6e3f9b2d5a8'
down_revision: Union[str, Sequence[str], None] = 'j5d2e8a1c4f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'ai_feature_settings',
        sa.Column('feature_key', sa.String(64), primary_key=True),
        sa.Column(
            'provider', sa.String(32), nullable=True,
            comment="'claude' | 'mistral' | NULL (pakai AI_DEFAULT_PROVIDER)",
        ),
        sa.Column(
            'model', sa.String(80), nullable=True,
            comment="Nama model lengkap, NULL = pakai resolve via hint",
        ),
        sa.Column('max_tokens', sa.Integer, nullable=True),
        sa.Column('cache_ttl_days', sa.Integer, nullable=True),
        sa.Column('rate_limit_per_min', sa.Integer, nullable=True),
        sa.Column(
            'web_search_enabled', sa.Boolean, nullable=True,
            comment="Override agentic tool web search per fitur",
        ),
        sa.Column(
            'monthly_budget_usd', sa.Numeric(10, 4), nullable=True,
            comment="Hard cap spending bulanan. NULL = unlimited.",
        ),
        sa.Column(
            'updated_by_id', sa.Integer, sa.ForeignKey('users.id'),
            nullable=True,
        ),
        sa.Column(
            'updated_at', sa.DateTime(timezone=True),
            server_default=sa.func.now(), onupdate=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table('ai_feature_settings')
