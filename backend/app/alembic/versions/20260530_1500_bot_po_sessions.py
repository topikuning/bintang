"""bot_pending_po_sessions

Audit 2026-05-30: session sementara utk konfirmasi pembuatan PO via bot
WA/Telegram. Free-text user -> AI parse -> preview -> user balas "ya"
utk simpan DRAFT.

Revision ID: m8b5d1c7a2e4
Revises: l7f4a0c3e6b9
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'm8b5d1c7a2e4'
down_revision: Union[str, Sequence[str], None] = 'l7f4a0c3e6b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'bot_pending_po_sessions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('channel', sa.String(length=16), nullable=False),
        sa.Column('chat_id', sa.String(length=64), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('payload_json', sa.String(length=8192), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('channel', 'chat_id', name='uq_bot_pending_po_chat'),
    )
    op.create_index(
        'ix_bot_pending_po_sessions_chat',
        'bot_pending_po_sessions',
        ['channel', 'chat_id'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index('ix_bot_pending_po_sessions_chat', table_name='bot_pending_po_sessions')
    op.drop_table('bot_pending_po_sessions')
