"""add_project_kind_non_project_bucket

Tambah klasifikasi proyek (REGULAR/NON_PROJECT) + bucket "Catatan
Non-Proyek" per company + tabel toggle inklusi per-tahun.

Konteks:
- Catatan Non-Proyek = side ledger utk pencatatan OUT yg tidak terkait
  proyek (mis. pengeluaran pribadi pemilik, ops global).
- 1 system project per company (kind=NON_PROJECT).
- Inklusi ke laporan global dikontrol per-tahun via
  NonProjectYearSetting. Default OFF -- tahun yg belum di-setel sama
  sekali tidak menyentuh dashboard/cashflow/laporan.

Skema:
- ALTER projects ADD COLUMN kind VARCHAR(20) DEFAULT 'REGULAR' NOT NULL
- CREATE TABLE non_project_year_settings
- SEED: 1 baris di projects per company (idempotent).

Revision ID: c4d2a9e1f7b8
Revises: a7e9f3c8b2d1
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c4d2a9e1f7b8'
down_revision: Union[str, Sequence[str], None] = 'a7e9f3c8b2d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Tambah kolom kind ke projects (default REGULAR utk legacy data)
    op.add_column(
        'projects',
        sa.Column(
            'kind',
            sa.String(length=20),
            nullable=False,
            server_default='REGULAR',
        ),
    )
    op.create_index(op.f('ix_projects_kind'), 'projects', ['kind'], unique=False)

    # 2. Tabel toggle inklusi per-tahun
    op.create_table(
        'non_project_year_settings',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('company_id', sa.Integer(), nullable=False),
        sa.Column('year', sa.Integer(), nullable=False),
        sa.Column('include_in_global', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('updated_by_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['company_id'], ['companies.id'], name=op.f('fk_non_project_year_settings_company_id_companies'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['updated_by_id'], ['users.id'], name=op.f('fk_non_project_year_settings_updated_by_id_users')),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_non_project_year_settings')),
        sa.UniqueConstraint('company_id', 'year', name='uq_non_project_year'),
    )
    op.create_index(
        'ix_non_project_year_company_year',
        'non_project_year_settings',
        ['company_id', 'year'],
        unique=False,
    )

    # 3. Seed system project per company. Idempotent: skip kalau sudah
    # ada project kind=NON_PROJECT utk company itu.
    conn = op.get_bind()
    companies = conn.execute(sa.text("SELECT id FROM companies")).fetchall()
    for c in companies:
        cid = c[0]
        existing = conn.execute(
            sa.text("""
                SELECT id FROM projects
                WHERE company_id = :cid AND kind = 'NON_PROJECT'
                LIMIT 1
            """),
            {"cid": cid},
        ).fetchone()
        if existing:
            continue
        # Code unique -- pakai prefix + company_id. Format akhir mis.
        # "NON-PROJECT-1" -- non-collision dgn kode proyek user.
        code = f"NON-PROJECT-{cid}"
        conn.execute(
            sa.text("""
                INSERT INTO projects (
                    code, name, company_id, status, kind,
                    project_value, budget_amount, currency,
                    overbudget_tolerance_pct, tax_ppn_pct, tax_pph_pct, marketing_pct,
                    created_at, updated_at
                ) VALUES (
                    :code, :name, :cid, 'AKTIF', 'NON_PROJECT',
                    0, 0, 'IDR',
                    0, 0, 0, 0,
                    NOW(), NOW()
                )
            """),
            {"code": code, "name": "Catatan Non-Proyek", "cid": cid},
        )


def downgrade() -> None:
    # WARNING: destructive. Tx di proyek NON_PROJECT akan ikut hilang
    # (FK projects.id tdk pakai ondelete CASCADE, jadi harus dihapus
    # manual dulu). Hanya jalankan downgrade kalau data NON_PROJECT
    # sengaja mau dihapus permanen.
    conn = op.get_bind()
    conn.execute(sa.text("""
        DELETE FROM transactions
        WHERE project_id IN (
            SELECT id FROM projects WHERE kind = 'NON_PROJECT'
        )
    """))
    conn.execute(sa.text("DELETE FROM projects WHERE kind = 'NON_PROJECT'"))

    op.drop_index('ix_non_project_year_company_year', table_name='non_project_year_settings')
    op.drop_table('non_project_year_settings')

    op.drop_index(op.f('ix_projects_kind'), table_name='projects')
    op.drop_column('projects', 'kind')
