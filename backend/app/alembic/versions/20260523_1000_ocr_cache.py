"""ocr_cache table

Cache hasil OCR by sha256(file_bytes). Audit 2026-05-23 OCR opt #T1.2.

Revision ID: e6b9d3a8c2f1
Revises: d4f8a2e7c1b5
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e6b9d3a8c2f1'
down_revision: Union[str, Sequence[str], None] = 'd4f8a2e7c1b5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'ocr_cache',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('file_hash', sa.String(64), nullable=False),
        sa.Column('source_engine', sa.String(80), nullable=False),
        sa.Column('media_type', sa.String(40), nullable=False),
        sa.Column('size_bytes', sa.Integer, nullable=False),
        sa.Column('extracted_data', sa.JSON, nullable=False),
        sa.Column('hits', sa.Integer, nullable=False, server_default='0'),
        sa.Column('last_hit_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True),
                  server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
    )
    op.create_index(
        'ix_ocr_cache_file_hash', 'ocr_cache', ['file_hash'], unique=True,
    )


def downgrade() -> None:
    op.drop_index('ix_ocr_cache_file_hash', table_name='ocr_cache')
    op.drop_table('ocr_cache')
