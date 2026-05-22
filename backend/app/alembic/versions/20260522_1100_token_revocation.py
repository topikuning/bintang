"""token_revocation

Tambah users.tokens_revoked_after utk server-side JWT revocation.
Logout endpoint set kolom ini ke now() supaya token dgn iat <= cutoff
di-anggap revoked di get_current_user.

Audit 2026-05-22 #C5.

Revision ID: c8e1d4f2a6b9
Revises: b7e2f4a8c9d1
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c8e1d4f2a6b9'
down_revision: Union[str, Sequence[str], None] = 'b7e2f4a8c9d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'users',
        sa.Column('tokens_revoked_after', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('users', 'tokens_revoked_after')
