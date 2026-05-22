"""invoice_number_unique

Add UNIQUE constraint to invoices.number. Sebelumnya hanya index biasa
-> bug data integrity (nomor invoice bisa duplikat). Per audit
diagnosis 2026-05-22 #C1.

Strategi:
1. Defensive dedup: cari row dengan nomor sama (soft-deleted included),
   rename row kedua dst dengan suffix '-DUP{id}'. Aman & traceable.
2. ADD UNIQUE constraint via unique index.

Revision ID: a5c7e9d2b3f4
Revises: f3a7b9c5d2e8
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a5c7e9d2b3f4'
down_revision: Union[str, Sequence[str], None] = 'f3a7b9c5d2e8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    # Step 1: dedup. Cari row id grouped per number, kalau >1 -> rename
    # row dengan id terbesar (kedua dst) supaya yang TER-RECENT (yg
    # biasanya correct) yg keep nomor asli. Rule arbitrary -- yg penting
    # deterministic & non-destructive (data tetap ada, hanya nomor di-suffix).
    dups = conn.execute(sa.text("""
        SELECT number FROM invoices
        WHERE number IS NOT NULL
        GROUP BY number
        HAVING COUNT(*) > 1
    """)).fetchall()
    for (num,) in dups:
        rows = conn.execute(
            sa.text("SELECT id FROM invoices WHERE number = :n ORDER BY id ASC"),
            {"n": num},
        ).fetchall()
        # Keep yg paling lama (id terkecil) -- asumsi yg pertama dibuat
        # adalah yg "asli" & sudah referenced di laporan/allocations.
        for (rid,) in rows[1:]:
            new_num = f"{num}-DUP{rid}"
            conn.execute(
                sa.text("UPDATE invoices SET number = :nn WHERE id = :id"),
                {"nn": new_num, "id": rid},
            )

    # Step 2: drop old index (kalau ada) + create unique index.
    # Pakai try/except utk SQLite vs Postgres compat. Index name dari
    # `index=True` di model lama auto = ix_invoices_number.
    try:
        op.drop_index('ix_invoices_number', table_name='invoices')
    except Exception:
        pass
    op.create_index('ix_invoices_number', 'invoices', ['number'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_invoices_number', table_name='invoices')
    op.create_index('ix_invoices_number', 'invoices', ['number'], unique=False)
