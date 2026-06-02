"""bot_pending_doc_sessions

Audit 2026-06-02: rename bot_pending_po_sessions -> bot_pending_doc_sessions.
Tambah kolom entity_type ("PO" | "INVOICE") supaya pattern session
dipakai juga utk OCR-based draft Invoice dari foto WA/Telegram.

Naikkan payload_json max length 8192 -> 16384 utk mengakomodasi OCR
output yg bisa banyak items.

Revision ID: n9c7e2f4d6a3
Revises: m8b5d1c7a2e4
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'n9c7e2f4d6a3'
down_revision: Union[str, Sequence[str], None] = 'm8b5d1c7a2e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop & recreate sebagai bot_pending_doc_sessions. Tabel session
    # ephemeral (TTL 10 min) -- data loss saat migration acceptable.
    # Pakai inspector supaya tolerant kalau prior migration tdk dijalankan
    # (mis. fresh test DB tanpa rev m8b5d1c7a2e4).
    from sqlalchemy import inspect
    bind = op.get_bind()
    inspector = inspect(bind)
    if 'bot_pending_po_sessions' in inspector.get_table_names():
        existing_idx = {i['name'] for i in inspector.get_indexes('bot_pending_po_sessions')}
        if 'ix_bot_pending_po_sessions_chat' in existing_idx:
            op.drop_index(
                'ix_bot_pending_po_sessions_chat',
                table_name='bot_pending_po_sessions',
            )
        op.drop_table('bot_pending_po_sessions')
    op.create_table(
        'bot_pending_doc_sessions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('channel', sa.String(length=16), nullable=False),
        sa.Column('chat_id', sa.String(length=64), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('entity_type', sa.String(length=16), nullable=False),
        sa.Column('payload_json', sa.String(length=16384), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('channel', 'chat_id', name='uq_bot_pending_doc_chat'),
    )
    op.create_index(
        'ix_bot_pending_doc_sessions_chat',
        'bot_pending_doc_sessions',
        ['channel', 'chat_id'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        'ix_bot_pending_doc_sessions_chat',
        table_name='bot_pending_doc_sessions',
    )
    op.drop_table('bot_pending_doc_sessions')
    # Re-create old table sbg revert (kosong)
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
