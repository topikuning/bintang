"""add_username_to_users

Tambah kolom `username` di tabel users -- opsional, lowercase, unique.
Pakai utk login alternatif selain email (auto-detect '@' di input
form login). User lama tdk perlu backfill; mereka tetap login via email.

Revision ID: f3a7b9c5d2e8
Revises: e8f1a2c3d4b5
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f3a7b9c5d2e8'
down_revision: Union[str, Sequence[str], None] = 'e8f1a2c3d4b5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'users',
        sa.Column('username', sa.String(length=50), nullable=True),
    )
    op.create_index(op.f('ix_users_username'), 'users', ['username'], unique=True)


def downgrade() -> None:
    op.drop_index(op.f('ix_users_username'), table_name='users')
    op.drop_column('users', 'username')
