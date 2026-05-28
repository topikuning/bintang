"""Konsistensi budget spent calc lintas endpoint.

Audit 2026-05-23 user lapor: Hub Proyek bar masih 130% overbudget,
sementara detail proyek sudah 91%. Inkonsistensi.

Fix: list_projects_with_stats juga exclude marketing + profit_share
dari spent. Test ini verify semua jalur (project_dashboard,
list_projects_with_stats, budget_status helper) hasilkan angka sama.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app.api.v1.dashboard import _project_finance_breakdown
from app.api.v1.projects import list_projects_with_stats
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
    project_expense_breakdown,
)


@pytest.mark.asyncio
async def test_consistent_spent_calc_across_endpoints(db):
    """Setup proyek dgn marketing + bagi hasil + operating tx.
    Verify SEMUA jalur (helper budget_status + list_projects_with_stats
    inline calc + project_dashboard finance breakdown) menghasilkan
    usage_pct yg sama."""
    co = Company(name="C"); db.add(co); await db.flush()
    p = Project(
        code="KP1", name="KNMP Tuban", company_id=co.id,
        status=ProjectStatus.AKTIF, kind=ProjectKind.REGULAR.value,
        project_value=Decimal("10000"),
        budget_amount=Decimal("6000"),
        marketing_pct=Decimal("15"),
    )
    db.add(p); await db.flush()
    u = User(
        email="u@x", name="U", password_hash=hash_password("x"),
        role=UserRole.SUPERADMIN, scope_all_projects=True,
    )
    db.add(u); await db.flush()
    cat_mkt = Category(name="Komisi", type=CategoryType.OUT, is_marketing=True)
    cat_ps = Category(name="Bagi Hasil", type=CategoryType.OUT, is_profit_share=True)
    cat_op = Category(name="Material", type=CategoryType.OUT)
    db.add_all([cat_mkt, cat_ps, cat_op]); await db.flush()

    # 3 tx VERIFIED OUT: marketing 1000, bagi hasil 500, operating 3000.
    # Total OUT = 4500. Budget = 6000.
    # Spent for budget = 4500 - 1000 - 500 = 3000. Usage = 50%.
    for cat, amt in [(cat_mkt, "1000"), (cat_ps, "500"), (cat_op, "3000")]:
        db.add(Transaction(
            project_id=p.id, tx_date=date(2026, 5, 22), type=TxnType.OUT,
            kind=TxnKind.DIRECT_EXPENSE.value, amount=Decimal(amt),
            category_id=cat.id, payment_method=PaymentMethod.CASH,
            status=TxnStatus.VERIFIED, created_by_id=u.id,
        ))
    await db.commit()

    # === Jalur 1: helper budget_status ===
    exp = await project_expense_breakdown(db, p.id)
    bs = budget_status(
        p, total_out=Decimal("4500"),
        marketing_actual=exp["marketing"],
        profit_share_actual=exp["profit_share"],
    )
    assert bs["spent"] == Decimal("3000")
    assert bs["usage_pct"] == Decimal("50.00")
    assert bs["status"] == "aman"

    # === Jalur 2: project_dashboard finance breakdown ===
    finance = _project_finance_breakdown(
        nilai_kontrak=Decimal("10000"),
        ppn_pct=Decimal("11"),
        pph_pct=Decimal("2.65"),
        marketing_pct=Decimal("15"),
        biaya_aktual=Decimal("4500"),
        biaya_proyeksi=Decimal("6000"),
        marketing_aktual=exp["marketing"],
        profit_share_actual=exp["profit_share"],
    )
    # profit_now = cair - (biaya_aktual - profit_share)
    # = cair - (4500 - 500) = cair - 4000
    cair = finance["nilai_cair"]
    assert finance["profit_now"] == pytest.approx(cair - 4000, rel=0.001)

    # === Jalur 3: list_projects_with_stats inline calc ===
    rows = await list_projects_with_stats(
        status=None, q=None,
        location=None, client_name=None, funder_id=None,
        db=db, user=u,
    )
    row = next(r for r in rows if r["code"] == "KP1")
    # Spent dr endpoint ini juga exclude marketing + bagi hasil
    assert row["budget"]["spent"] == 3000.0
    # Usage pct sama dgn helper (50%)
    assert row["budget"]["usage_pct"] == pytest.approx(50.0, rel=0.001)
    assert row["budget"]["status"] == "aman"
