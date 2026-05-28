"""Budget Pengeluaran exclude marketing.

User lapor: bar Budget Pengeluaran masih hitung marketing → overbudget
salah. Audit 2026-05-23.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.core.security import hash_password
from app.models.models import (
    Category,
    CategoryType,
    Company,
    PaymentMethod,
    Project,
    ProjectKind,
    ProjectStatus,
    Transaction,
    TxnKind,
    TxnStatus,
    TxnType,
    User,
    UserRole,
)
from app.services.budget import (
    budget_status,
    project_marketing_actual,
)


async def _seed(db, *, budget=1000000):
    co = Company(name="C"); db.add(co); await db.flush()
    p = Project(
        code="P", name="P", company_id=co.id,
        status=ProjectStatus.AKTIF, kind=ProjectKind.REGULAR.value,
        budget_amount=Decimal(budget),
    )
    db.add(p); await db.flush()
    u = User(email="u@x", name="U", password_hash=hash_password("x"),
             role=UserRole.SUPERADMIN)
    db.add(u); await db.flush()
    return co, p, u


def test_budget_status_with_marketing_excludes():
    """Marketing 200 + non-marketing 700 = 900 total. Budget 1000.
    Sebelum: 900/1000 = 90% (warning). Sesudah: 700/1000 = 70% (aman)."""
    from datetime import date
    p = Project(
        code="X", name="X", company_id=1,
        status=ProjectStatus.AKTIF, budget_amount=Decimal("1000"),
        kind=ProjectKind.REGULAR.value,
    )
    bs = budget_status(p, total_out=Decimal("900"),
                       marketing_actual=Decimal("200"))
    assert bs["spent"] == Decimal("700")  # non-marketing
    assert bs["spent_total"] == Decimal("900")
    assert bs["marketing_actual"] == Decimal("200")
    assert bs["usage_pct"] == Decimal("70.00")
    assert bs["status"] == "aman"


def test_budget_status_no_marketing_backward_compat():
    """marketing_actual default 0 -> behaviour lama."""
    p = Project(
        code="X", name="X", company_id=1,
        status=ProjectStatus.AKTIF, budget_amount=Decimal("1000"),
        kind=ProjectKind.REGULAR.value,
    )
    bs = budget_status(p, total_out=Decimal("900"))
    assert bs["spent"] == Decimal("900")
    assert bs["usage_pct"] == Decimal("90.00")


def test_budget_status_overbudget_only_if_non_marketing_exceeds():
    """User scenario: 7.873 (incl 1.309 mkt) vs 6.762 budget.
    Sebelum: overbudget 116%. Sesudah: 6.564 / 6.762 = 97% (warning)."""
    p = Project(
        code="X", name="X", company_id=1,
        status=ProjectStatus.AKTIF,
        budget_amount=Decimal("6762681560"),
        kind=ProjectKind.REGULAR.value,
    )
    bs = budget_status(
        p,
        total_out=Decimal("7873345582"),
        marketing_actual=Decimal("1309182745"),
    )
    expected_non_mkt = 7873345582 - 1309182745
    assert bs["spent"] == Decimal(expected_non_mkt)
    expected_pct = (Decimal(expected_non_mkt) / Decimal("6762681560") * 100).quantize(Decimal("0.01"))
    assert bs["usage_pct"] == expected_pct
    # ~97% -> mendekati_batas (not overbudget)
    assert bs["status"] == "mendekati_batas"


@pytest.mark.asyncio
async def test_project_marketing_actual_aggregates(db):
    from datetime import date
    co, p, u = await _seed(db)
    cat_mkt = Category(name="Komisi", type=CategoryType.OUT, is_marketing=True)
    cat_op = Category(name="Material", type=CategoryType.OUT, is_marketing=False)
    db.add_all([cat_mkt, cat_op]); await db.flush()
    # 3 tx marketing VERIFIED, 2 non-marketing, 1 marketing DRAFT (ignored)
    db.add_all([
        Transaction(
            project_id=p.id, tx_date=date(2026, 5, 1), type=TxnType.OUT,
            kind=TxnKind.DIRECT_EXPENSE.value, amount=Decimal("100"),
            category_id=cat_mkt.id, payment_method=PaymentMethod.CASH,
            status=TxnStatus.VERIFIED, created_by_id=u.id,
        ),
        Transaction(
            project_id=p.id, tx_date=date(2026, 5, 2), type=TxnType.OUT,
            kind=TxnKind.DIRECT_EXPENSE.value, amount=Decimal("200"),
            category_id=cat_mkt.id, payment_method=PaymentMethod.CASH,
            status=TxnStatus.VERIFIED, created_by_id=u.id,
        ),
        Transaction(
            project_id=p.id, tx_date=date(2026, 5, 3), type=TxnType.OUT,
            kind=TxnKind.DIRECT_EXPENSE.value, amount=Decimal("50"),
            category_id=cat_mkt.id, payment_method=PaymentMethod.CASH,
            status=TxnStatus.VERIFIED, created_by_id=u.id,
        ),
        Transaction(
            project_id=p.id, tx_date=date(2026, 5, 4), type=TxnType.OUT,
            kind=TxnKind.DIRECT_EXPENSE.value, amount=Decimal("500"),
            category_id=cat_op.id, payment_method=PaymentMethod.CASH,
            status=TxnStatus.VERIFIED, created_by_id=u.id,
        ),
        Transaction(
            project_id=p.id, tx_date=date(2026, 5, 5), type=TxnType.OUT,
            kind=TxnKind.DIRECT_EXPENSE.value, amount=Decimal("999"),
            category_id=cat_mkt.id, payment_method=PaymentMethod.CASH,
            status=TxnStatus.DRAFT, created_by_id=u.id,  # DRAFT, di-include di ACTIVE
        ),
    ])
    await db.commit()
    # ACTIVE statuses: DRAFT + SUBMITTED + VERIFIED. So marketing = 100+200+50+999 = 1349
    mkt = await project_marketing_actual(db, p.id)
    assert mkt == Decimal("1349")
