"""M3 (audit 2026-05-22): regression test bulk-load di list endpoint
yg sebelumnya N+1.

Tujuan: verify hasil endpoint setelah refactor TETAP sama secara
semantik. Performance benefit tdk di-assert di sini (butuh query
counter); cuma correctness output.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app.api.v1.cash_requests import list_cash_requests
from app.api.v1.projects import list_projects_with_stats
from app.core.security import hash_password
from app.models.models import (
    CashRequest,
    CashRequestItem,
    CashRequestStatus,
    Category,
    Company,
    Project,
    ProjectKind,
    ProjectStatus,
    User,
    UserRole,
)


async def _seed_super(db):
    u = User(
        email="super@x", name="Super",
        password_hash=hash_password("x"),
        role=UserRole.SUPERADMIN,
    )
    db.add(u); await db.flush()
    return u


@pytest.mark.asyncio
async def test_cash_requests_list_returns_hydrated_fields(db):
    """Bulk-load refactor harus hasilkan output identik dgn versi lama:
    project_name, requester_name, approver_name, category_name semua
    ke-populate utk multi-row.
    """
    user = await _seed_super(db)
    co = Company(name="C"); db.add(co); await db.flush()
    p1 = Project(code="P1", name="Proyek Satu", company_id=co.id, status=ProjectStatus.AKTIF, kind=ProjectKind.REGULAR.value)
    p2 = Project(code="P2", name="Proyek Dua", company_id=co.id, status=ProjectStatus.AKTIF, kind=ProjectKind.REGULAR.value)
    db.add_all([p1, p2]); await db.flush()
    from app.models.models import CategoryType
    cat = Category(name="Material", type=CategoryType.OUT)
    db.add(cat); await db.flush()

    approver = User(email="ap@x", name="Approver", password_hash="x", role=UserRole.CENTRAL_ADMIN)
    db.add(approver); await db.flush()

    # 3 cash requests di 2 project, dgn berbagai relationship
    cr1 = CashRequest(
        number="CR-001", project_id=p1.id, requester_id=user.id,
        request_date=date(2026, 5, 22), title="Beli kabel",
        total_amount=Decimal("100"), status=CashRequestStatus.PENDING,
    )
    cr2 = CashRequest(
        number="CR-002", project_id=p2.id, requester_id=user.id,
        request_date=date(2026, 5, 22), title="Beli paku",
        total_amount=Decimal("50"), status=CashRequestStatus.APPROVED,
        approved_by_id=approver.id,
    )
    cr3 = CashRequest(
        number="CR-003", project_id=p1.id, requester_id=user.id,
        request_date=date(2026, 5, 22), title="Lain",
        total_amount=Decimal("75"), status=CashRequestStatus.PENDING,
    )
    db.add_all([cr1, cr2, cr3]); await db.flush()
    db.add_all([
        CashRequestItem(request_id=cr1.id, category_id=cat.id, description="kabel 10m", amount=Decimal("100")),
        CashRequestItem(request_id=cr2.id, category_id=cat.id, description="paku", amount=Decimal("50")),
        CashRequestItem(request_id=cr3.id, description="lain-lain no category", amount=Decimal("75")),
    ])
    await db.commit()

    result = await list_cash_requests(
        status=None, project_id=None, requester_id=None,
        date_from=None, date_to=None, q=None,
        page=1, size=50,
        db=db, user=user,
    )
    assert result.total == 3
    by_num = {r.number: r for r in result.items}
    # Project name terisi via project_map
    assert by_num["CR-001"].project_name == "Proyek Satu"
    assert by_num["CR-002"].project_name == "Proyek Dua"
    # Requester name terisi via user_map
    assert by_num["CR-001"].requester_name == "Super"
    # Approver terisi utk APPROVED
    assert by_num["CR-002"].approved_by_name == "Approver"
    assert by_num["CR-001"].approved_by_name is None
    # Category name terisi via cat_map
    cr1_item = by_num["CR-001"].items[0]
    assert cr1_item.category_name == "Material"
    # Item tanpa category -> category_name None (tdk crash)
    cr3_item = by_num["CR-003"].items[0]
    assert cr3_item.category_id is None
    assert cr3_item.category_name is None


@pytest.mark.asyncio
async def test_projects_stats_bulk_aggregate(db):
    """3 GROUP BY query (in_map, out_map, inv_open_map) gantikan
    3 query per project. Verify output identik."""
    user = await _seed_super(db)
    co = Company(name="C"); db.add(co); await db.flush()
    p1 = Project(code="P1", name="P1", company_id=co.id, status=ProjectStatus.AKTIF, kind=ProjectKind.REGULAR.value, budget_amount=Decimal("1000"))
    p2 = Project(code="P2", name="P2", company_id=co.id, status=ProjectStatus.AKTIF, kind=ProjectKind.REGULAR.value, budget_amount=Decimal("500"))
    db.add_all([p1, p2]); await db.flush()

    from app.models.models import PaymentMethod, Transaction, TxnKind, TxnStatus, TxnType
    # P1: 1 IN 300, 1 OUT 200
    db.add(Transaction(
        project_id=p1.id, tx_date=date(2026, 5, 22), type=TxnType.IN,
        kind=TxnKind.INVOICE_PAYMENT.value, amount=Decimal("300"),
        payment_method=PaymentMethod.TRANSFER, status=TxnStatus.VERIFIED,
        created_by_id=user.id,
    ))
    db.add(Transaction(
        project_id=p1.id, tx_date=date(2026, 5, 22), type=TxnType.OUT,
        kind=TxnKind.DIRECT_EXPENSE.value, amount=Decimal("200"),
        payment_method=PaymentMethod.CASH, status=TxnStatus.VERIFIED,
        created_by_id=user.id,
    ))
    # P2: 1 OUT 100
    db.add(Transaction(
        project_id=p2.id, tx_date=date(2026, 5, 22), type=TxnType.OUT,
        kind=TxnKind.DIRECT_EXPENSE.value, amount=Decimal("100"),
        payment_method=PaymentMethod.CASH, status=TxnStatus.VERIFIED,
        created_by_id=user.id,
    ))
    await db.commit()

    rows = await list_projects_with_stats(
        status=None, q=None,
        location=None, client_name=None, funder_id=None,
        db=db, user=user,
    )
    by_code = {r["code"]: r for r in rows}
    assert by_code["P1"]["total_in"] == 300.0
    assert by_code["P1"]["total_out"] == 200.0
    assert by_code["P2"]["total_in"] == 0.0
    assert by_code["P2"]["total_out"] == 100.0
