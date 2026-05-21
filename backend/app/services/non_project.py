"""Service helpers untuk bucket Catatan Non-Proyek.

Konsep singkat:
- Project.kind=NON_PROJECT = 1 system project per company (seed migrasi)
- Tx di bucket ini by default tdk masuk agregat global (default OFF).
- NonProjectYearSetting(company_id, year, include_in_global) bisa
  meng-_opt-in_ tahun tertentu utk ikut hitungan global.

Modul ini menyediakan helper SQL utk inject klausa eligibility di
query agregat (dashboard, laporan arus kas, dll).
"""
from __future__ import annotations

from sqlalchemy import and_, extract, false, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import ColumnElement

from app.models.models import (
    NonProjectYearSetting,
    Project,
    ProjectKind,
    Transaction,
)


async def transaction_eligibility_clause(db: AsyncSession) -> ColumnElement[bool]:
    """Klausa WHERE utk Transaction queries yg JOIN Project, sehingga
    tx di NON_PROJECT cuma ikut bila (company, year) sudah opt-in.

    Caller WAJIB melakukan JOIN/select dari Project ke Transaction
    sebelum apply klausa ini, mis:

        stmt = (
            select(...)
            .join(Project, Project.id == Transaction.project_id)
            .where(await transaction_eligibility_clause(db))
        )

    Semantik:
    - Project.kind=REGULAR -> selalu eligible (klausa = True)
    - Project.kind=NON_PROJECT -> eligible HANYA jika
      (Project.company_id, year(tx_date)) muncul di NonProjectYearSetting
      dgn include_in_global=True. Tahun yg tdk ada baris di setting =
      default OFF -> NOT eligible.

    Notes:
    - Pakai SQLAlchemy `extract('year', ...)` -- works di Postgres &
      SQLite (compile-time dialect dispatch).
    - Kalau belum ada satupun setting=True, return clause yg sederhana
      (skip NON_PROJECT seluruhnya) -- optimasi minor.
    """
    rows = (
        await db.execute(
            select(NonProjectYearSetting.company_id, NonProjectYearSetting.year).where(
                NonProjectYearSetting.include_in_global.is_(True)
            )
        )
    ).all()

    regular_clause = Project.kind != ProjectKind.NON_PROJECT.value

    if not rows:
        # Belum ada tahun yg di-opt-in -> NON_PROJECT seluruhnya di-skip.
        return regular_clause

    # Build OR clauses utk (company, year) pairs yg di-opt-in.
    np_pair_clauses = [
        and_(
            Project.company_id == cid,
            extract("year", Transaction.tx_date) == year,
        )
        for cid, year in rows
    ]
    np_eligible = and_(
        Project.kind == ProjectKind.NON_PROJECT.value,
        or_(*np_pair_clauses) if np_pair_clauses else false(),
    )
    return or_(regular_clause, np_eligible)


async def get_company_non_project_id(db: AsyncSession, company_id: int) -> int | None:
    """Ambil ID system project NON_PROJECT utk company tertentu.
    Return None kalau belum ada (mis. company baru sebelum seed migrasi
    re-run).
    """
    row = (
        await db.execute(
            select(Project.id).where(
                Project.company_id == company_id,
                Project.kind == ProjectKind.NON_PROJECT.value,
                Project.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    return row


async def get_or_create_non_project(db: AsyncSession, company_id: int) -> int:
    """Sama dgn get_company_non_project_id, tapi auto-create kalau belum
    ada (utk safety: company yg ditambah setelah migrasi awal).
    Caller TIDAK perlu commit -- caller wajib commit nanti.
    """
    pid = await get_company_non_project_id(db, company_id)
    if pid is not None:
        return pid

    from decimal import Decimal

    p = Project(
        code=f"NON-PROJECT-{company_id}",
        name="Catatan Non-Proyek",
        company_id=company_id,
        kind=ProjectKind.NON_PROJECT.value,
        project_value=Decimal("0"),
        budget_amount=Decimal("0"),
        currency="IDR",
        overbudget_tolerance_pct=Decimal("0"),
        tax_ppn_pct=Decimal("0"),
        tax_pph_pct=Decimal("0"),
        marketing_pct=Decimal("0"),
    )
    db.add(p)
    await db.flush()
    return p.id
