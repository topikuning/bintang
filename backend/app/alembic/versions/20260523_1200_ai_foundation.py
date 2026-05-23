"""ai_cache + ai_call_logs tables

Foundation untuk fitur AI broader (chat features, justifier, dll).
Audit 2026-05-23 AI foundation.

Revision ID: g8d3e1a5c7f2
Revises: f7c2a9e4b8d3
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'g8d3e1a5c7f2'
down_revision: Union[str, Sequence[str], None] = 'f7c2a9e4b8d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'ai_cache',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('namespace', sa.String(80), nullable=False),
        sa.Column('cache_key', sa.String(128), nullable=False),
        sa.Column('value', sa.JSON, nullable=False),
        sa.Column('source_info', sa.JSON, nullable=True),
        sa.Column('hits', sa.Integer, nullable=False, server_default='0'),
        sa.Column('last_hit_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True),
                  server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.UniqueConstraint('namespace', 'cache_key', name='uq_ai_cache_ns_key'),
    )
    op.create_index('ix_ai_cache_namespace', 'ai_cache', ['namespace'])
    op.create_index('ix_ai_cache_cache_key', 'ai_cache', ['cache_key'])

    op.create_table(
        'ai_call_logs',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('user_id', sa.Integer, sa.ForeignKey('users.id'), nullable=True),
        sa.Column('feature', sa.String(80), nullable=False),
        sa.Column('model', sa.String(80), nullable=False),
        sa.Column('input_tokens', sa.Integer, nullable=False, server_default='0'),
        sa.Column('output_tokens', sa.Integer, nullable=False, server_default='0'),
        sa.Column('cost_usd', sa.String(20), nullable=False, server_default='0'),
        sa.Column('latency_ms', sa.Integer, nullable=False, server_default='0'),
        sa.Column('cached', sa.Boolean, nullable=False, server_default=sa.text('FALSE')),
        sa.Column('success', sa.Boolean, nullable=False, server_default=sa.text('TRUE')),
        sa.Column('error', sa.Text, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True),
                  server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
    )
    op.create_index('ix_ai_call_logs_user_id', 'ai_call_logs', ['user_id'])
    op.create_index('ix_ai_call_logs_feature', 'ai_call_logs', ['feature'])


def downgrade() -> None:
    op.drop_index('ix_ai_call_logs_feature', table_name='ai_call_logs')
    op.drop_index('ix_ai_call_logs_user_id', table_name='ai_call_logs')
    op.drop_table('ai_call_logs')
    op.drop_index('ix_ai_cache_cache_key', table_name='ai_cache')
    op.drop_index('ix_ai_cache_namespace', table_name='ai_cache')
    op.drop_table('ai_cache')
