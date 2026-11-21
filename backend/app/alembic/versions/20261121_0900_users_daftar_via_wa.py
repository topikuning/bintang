"""users: pendaftaran otomatis lewat WhatsApp.

- daftar_via_wa: akun dibuat otomatis saat nomor tak dikenal mengirim /po.
  Akun ini tanpa kata sandi (tidak bisa masuk web) dan tanpa anggota proyek;
  hanya bisa mengajukan pesanan material lewat WA.
- wa_tunda: bila terisi (boleh string kosong), sistem sedang menunggu nama
  pengguna; isinya pesan /po yang diproses setelah nama diterima.

Revision ID: s5a1d7c3e8f2
Revises: r7c3e9a1f2b4
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "s5a1d7c3e8f2"
down_revision: str | Sequence[str] | None = "r7c3e9a1f2b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("daftar_via_wa", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("users", sa.Column("wa_tunda", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "wa_tunda")
    op.drop_column("users", "daftar_via_wa")
