"""category_penalty_profit_share

Tambah Category.is_penalty + is_profit_share. Audit 2026-05-23 user req.

Revision ID: i3a8b5c7e9d2
Revises: h9e4b2d6f3a8
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'i3a8b5c7e9d2'
down_revision: Union[str, Sequence[str], None] = 'h9e4b2d6f3a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'categories',
        sa.Column('is_penalty', sa.Boolean, nullable=False, server_default=sa.text('FALSE')),
    )
    op.add_column(
        'categories',
        sa.Column('is_profit_share', sa.Boolean, nullable=False, server_default=sa.text('FALSE')),
    )


def downgrade() -> None:
    op.drop_column('categories', 'is_profit_share')
    op.drop_column('categories', 'is_penalty')
