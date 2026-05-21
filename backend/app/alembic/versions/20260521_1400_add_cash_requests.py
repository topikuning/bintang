"""add_cash_requests

Tambah tabel pengajuan dana operasional internal (CashRequest +
CashRequestItem). Workflow:
  PENDING -> APPROVED (auto-create tx CASH_ADVANCE DRAFT) | REJECTED | CANCELLED

Skema:
- CREATE TABLE cash_requests (header)
- CREATE TABLE cash_request_items (line items)

Tdk ada ALTER ke tabel existing. Tdk perlu seed.

Revision ID: e8f1a2c3d4b5
Revises: c4d2a9e1f7b8
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e8f1a2c3d4b5'
down_revision: Union[str, Sequence[str], None] = 'c4d2a9e1f7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'cash_requests',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('number', sa.String(length=40), nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=False),
        sa.Column('requester_id', sa.Integer(), nullable=False),
        sa.Column('recipient_user_id', sa.Integer(), nullable=True),
        sa.Column('request_date', sa.Date(), nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('total_amount', sa.Numeric(precision=18, scale=2), nullable=False, server_default='0'),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='PENDING'),
        sa.Column('approved_by_id', sa.Integer(), nullable=True),
        sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('rejected_by_id', sa.Integer(), nullable=True),
        sa.Column('rejected_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('rejection_reason', sa.Text(), nullable=True),
        sa.Column('disbursement_tx_id', sa.Integer(), nullable=True),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], name=op.f('fk_cash_requests_project_id_projects')),
        sa.ForeignKeyConstraint(['requester_id'], ['users.id'], name=op.f('fk_cash_requests_requester_id_users')),
        sa.ForeignKeyConstraint(['recipient_user_id'], ['users.id'], name=op.f('fk_cash_requests_recipient_user_id_users')),
        sa.ForeignKeyConstraint(['approved_by_id'], ['users.id'], name=op.f('fk_cash_requests_approved_by_id_users')),
        sa.ForeignKeyConstraint(['rejected_by_id'], ['users.id'], name=op.f('fk_cash_requests_rejected_by_id_users')),
        sa.ForeignKeyConstraint(
            ['disbursement_tx_id'], ['transactions.id'],
            name=op.f('fk_cash_requests_disbursement_tx_id_transactions'),
            ondelete='SET NULL',
        ),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_cash_requests')),
        sa.UniqueConstraint('number', name=op.f('uq_cash_requests_number')),
        sa.UniqueConstraint('disbursement_tx_id', name=op.f('uq_cash_requests_disbursement_tx_id')),
    )
    op.create_index(op.f('ix_cash_requests_project_id'), 'cash_requests', ['project_id'], unique=False)
    op.create_index(op.f('ix_cash_requests_requester_id'), 'cash_requests', ['requester_id'], unique=False)
    op.create_index(op.f('ix_cash_requests_status'), 'cash_requests', ['status'], unique=False)
    op.create_index('ix_cash_requests_project_status', 'cash_requests', ['project_id', 'status'], unique=False)
    op.create_index('ix_cash_requests_requester', 'cash_requests', ['requester_id'], unique=False)
    op.create_index('ix_cash_requests_deleted_at', 'cash_requests', ['deleted_at'], unique=False)

    op.create_table(
        'cash_request_items',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('request_id', sa.Integer(), nullable=False),
        sa.Column('category_id', sa.Integer(), nullable=True),
        sa.Column('description', sa.String(length=300), nullable=False),
        sa.Column('quantity', sa.Numeric(precision=12, scale=3), nullable=True),
        sa.Column('unit_price', sa.Numeric(precision=18, scale=2), nullable=True),
        sa.Column('amount', sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(
            ['request_id'], ['cash_requests.id'],
            name=op.f('fk_cash_request_items_request_id_cash_requests'),
            ondelete='CASCADE',
        ),
        sa.ForeignKeyConstraint(['category_id'], ['categories.id'], name=op.f('fk_cash_request_items_category_id_categories')),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_cash_request_items')),
    )
    op.create_index(op.f('ix_cash_request_items_request_id'), 'cash_request_items', ['request_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_cash_request_items_request_id'), table_name='cash_request_items')
    op.drop_table('cash_request_items')

    op.drop_index('ix_cash_requests_deleted_at', table_name='cash_requests')
    op.drop_index('ix_cash_requests_requester', table_name='cash_requests')
    op.drop_index('ix_cash_requests_project_status', table_name='cash_requests')
    op.drop_index(op.f('ix_cash_requests_status'), table_name='cash_requests')
    op.drop_index(op.f('ix_cash_requests_requester_id'), table_name='cash_requests')
    op.drop_index(op.f('ix_cash_requests_project_id'), table_name='cash_requests')
    op.drop_table('cash_requests')
