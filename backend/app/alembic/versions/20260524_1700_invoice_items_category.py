"""invoice_items_category

Tambah `category_id` ke `invoice_items` supaya per-item bisa di-kategori
(prev: cuma invoice level). Audit 2026-05-24 user req: item-item invoice
campur aduk, rincian per-kategori tdk akurat.

Revision ID: l7f4a0c3e6b9
Revises: k6e3f9b2d5a8
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'l7f4a0c3e6b9'
down_revision: Union[str, Sequence[str], None] = 'k6e3f9b2d5a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'invoice_items',
        sa.Column(
            'category_id', sa.Integer,
            sa.ForeignKey('categories.id'), nullable=True,
        ),
    )
    op.create_index(
        'ix_invoice_items_category_id',
        'invoice_items', ['category_id'],
    )


def downgrade() -> None:
    op.drop_index('ix_invoice_items_category_id', table_name='invoice_items')
    op.drop_column('invoice_items', 'category_id')
