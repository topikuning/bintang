"""Regression test PO numbering: cross-company collision + race retry.

Audit 2026-05-23: bug user lapor -- `PO/2026/05/GEO1/0001 already exists`
saat scan-and-save di company B karena company A pernah pakai number itu.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app.api.v1.purchase_orders import _next_po_number
from app.core.security import hash_password
from app.models.models import (
    Company,
    POItem,
    Project,
    ProjectKind,
    ProjectStatus,
    POStatus,
    PurchaseOrder,
    User,
    UserRole,
)


async def _make_user(db):
    u = User(email="x@x", name="X", password_hash=hash_password("x"),
             role=UserRole.SUPERADMIN)
    db.add(u); await db.flush()
    return u


@pytest.mark.asyncio
async def test_next_po_number_starts_at_0001(db):
    u = await _make_user(db)
    co = Company(name="C1"); db.add(co); await db.flush()
    n = await _next_po_number(db, co.id, "PRJ1", date(2026, 5, 22))
    assert n == "PO/2026/05/PRJ1/0001"


@pytest.mark.asyncio
async def test_next_po_number_increments_max_sequence(db):
    u = await _make_user(db)
    co = Company(name="C1"); db.add(co); await db.flush()
    p = Project(code="PRJ", name="P", company_id=co.id,
                status=ProjectStatus.AKTIF, kind=ProjectKind.REGULAR.value)
    db.add(p); await db.flush()
    # Buat 3 PO
    for seq in (1, 2, 3):
        db.add(PurchaseOrder(
            number=f"PO/2026/05/PRJ/{seq:04d}",
            project_id=p.id, company_id=co.id,
            po_date=date(2026, 5, 22), total=Decimal("100"),
            status=POStatus.DRAFT, created_by_id=u.id,
        ))
    await db.commit()
    n = await _next_po_number(db, co.id, "PRJ", date(2026, 5, 22))
    assert n == "PO/2026/05/PRJ/0004"


@pytest.mark.asyncio
async def test_next_po_number_skips_gaps(db):
    """Kalau PO/0001 di-hard-delete (rare), max=0003 -> next=0004 (bukan 0002)."""
    u = await _make_user(db)
    co = Company(name="C1"); db.add(co); await db.flush()
    p = Project(code="PRJ", name="P", company_id=co.id,
                status=ProjectStatus.AKTIF, kind=ProjectKind.REGULAR.value)
    db.add(p); await db.flush()
    # PO 0002 & 0003 exist (anggap 0001 dihapus)
    for seq in (2, 3):
        db.add(PurchaseOrder(
            number=f"PO/2026/05/PRJ/{seq:04d}",
            project_id=p.id, company_id=co.id,
            po_date=date(2026, 5, 22), total=Decimal("100"),
            status=POStatus.DRAFT, created_by_id=u.id,
        ))
    await db.commit()
    n = await _next_po_number(db, co.id, "PRJ", date(2026, 5, 22))
    assert n == "PO/2026/05/PRJ/0004"


@pytest.mark.asyncio
async def test_next_po_number_handles_cross_company_collision(db):
    """BUG FIX (user lapor 2026-05-23): PO bisa dibuat dgn company_id !=
    project.company_id (form allow). Sequence numbering yg scoped per
    company_id MISS PO existing -> generate nomor yg sudah ada -> 500.

    Scenario: project GEO1 milik company A. User bikin PO #1 dgn
    company_id=A. Lalu user lain bikin PO baru utk project GEO1 tapi
    pilih company_id=B di form. Old code: COUNT(company=B)=0 ->
    PO/.../GEO1/0001 -> UNIQUE VIOLATION.
    Fix: scan lintas-company.
    """
    u = await _make_user(db)
    co_a = Company(name="A"); co_b = Company(name="B")
    db.add_all([co_a, co_b]); await db.flush()
    p = Project(code="GEO1", name="Geo", company_id=co_a.id,
                status=ProjectStatus.AKTIF, kind=ProjectKind.REGULAR.value)
    db.add(p); await db.flush()
    # PO existing dibuat dgn company A
    db.add(PurchaseOrder(
        number="PO/2026/05/GEO1/0001",
        project_id=p.id, company_id=co_a.id,
        po_date=date(2026, 5, 22), total=Decimal("100"),
        status=POStatus.DRAFT, created_by_id=u.id,
    ))
    await db.commit()

    # User submit PO baru dgn company B (project sama)
    n = await _next_po_number(db, co_b.id, "GEO1", date(2026, 5, 22))
    # Sebelum fix: '0001' -> collision.
    # Sesudah fix: scan lintas-company, return '0002'.
    assert n == "PO/2026/05/GEO1/0002"


@pytest.mark.asyncio
async def test_next_po_number_includes_soft_deleted(db):
    """Soft-deleted PO tetap counted (number tdk recycled)."""
    u = await _make_user(db)
    co = Company(name="C"); db.add(co); await db.flush()
    p = Project(code="PRJ", name="P", company_id=co.id,
                status=ProjectStatus.AKTIF, kind=ProjectKind.REGULAR.value)
    db.add(p); await db.flush()
    from datetime import datetime, timezone
    db.add(PurchaseOrder(
        number="PO/2026/05/PRJ/0001",
        project_id=p.id, company_id=co.id,
        po_date=date(2026, 5, 22), total=Decimal("100"),
        status=POStatus.CANCELLED, created_by_id=u.id,
        deleted_at=datetime.now(timezone.utc),
    ))
    await db.commit()
    n = await _next_po_number(db, co.id, "PRJ", date(2026, 5, 22))
    assert n == "PO/2026/05/PRJ/0002"
