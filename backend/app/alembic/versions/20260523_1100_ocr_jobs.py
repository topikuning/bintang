"""ocr_jobs table

Async OCR job. Audit 2026-05-23 OCR opt #T3.8.

Revision ID: f7c2a9e4b8d3
Revises: e6b9d3a8c2f1
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f7c2a9e4b8d3'
down_revision: Union[str, Sequence[str], None] = 'e6b9d3a8c2f1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'ocr_jobs',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('user_id', sa.Integer,
                  sa.ForeignKey('users.id'), nullable=False),
        sa.Column('entity', sa.String(40), nullable=False, server_default='invoice'),
        sa.Column('source_url', sa.String(500), nullable=False),
        sa.Column('file_size_bytes', sa.Integer, nullable=False),
        sa.Column('engine_requested', sa.String(40), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='PENDING'),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('result', sa.JSON, nullable=True),
        sa.Column('error', sa.Text, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True),
                  server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
    )
    op.create_index('ix_ocr_jobs_user_id', 'ocr_jobs', ['user_id'])
    op.create_index('ix_ocr_jobs_status', 'ocr_jobs', ['status'])


def downgrade() -> None:
    op.drop_index('ix_ocr_jobs_status', table_name='ocr_jobs')
    op.drop_index('ix_ocr_jobs_user_id', table_name='ocr_jobs')
    op.drop_table('ocr_jobs')
