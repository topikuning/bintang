"""Budget vs Actual endpoint.

Tampilkan realisasi anggaran per-proyek (+ optional per-category
breakdown). Pakai `services.budget.budget_status` supaya threshold
status (aman/mendekati_batas/overbudget) konsisten dgn Dashboard.
"""
from __future__ import annotations

from datetime import date as date_type
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import (
    ensure_project_access,
    get_current_user,
    user_project_ids,
)
from app.db.session import get_db
from app.models.models import (
    Category,
    Project,
    ProjectKind,
    ProjectStatus,
    Transaction,
    TxnType,
    User,
)
from app.services.budget import ACTIVE_STATUSES, budget_status

router = APIRouter()


class BudgetRow(BaseModel):
    project_id: int
    project_code: str
    project_name: str
    company_name: str | None = None
    budget_amount: Decimal
    spent: Decimal
    remaining: Decimal
    usage_pct: Decimal
    status: str  # aman / mendekati_batas / overbudget / no_budget


class BudgetCategoryRow(BaseModel):
    """Spending per kategori (untuk drilldown 1 proyek)."""
    project_id: int
    category_id: int | None
    category_name: str
    spent: Decimal
    pct_of_project_spent: Decimal  # 0..100


class BudgetTotals(BaseModel):
    budget: Decimal
    spent: Decimal
    remaining: Decimal
    usage_pct: Decimal
    n_aman: int
    n_mendekati: int
    n_overbudget: int
    n_no_budget: int


class BudgetSummaryResponse(BaseModel):
    rows: list[BudgetRow]
    totals: BudgetTotals
    by_category: list[BudgetCategoryRow] = []


@router.get("/summary", response_model=BudgetSummaryResponse)
async def budget_summary(
    project_id: list[int] | None = Query(None),
    date_from: date_type | None = None,
    date_to: date_type | None = None,
    include_no_budget: bool = False,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> BudgetSummaryResponse:
    """Ringkasan budget vs actual.

    - **rows**: per project (1 row per proyek aktif yg user-accessible).
    - **totals**: agregat (budget, spent, remaining, %, count per status).
    - **by_category**: kalau filter ke 1 project saja, return breakdown
      spending per kategori (untuk drilldown). Multi-project: kosong.

    Query:
    - `project_id`: filter multi (acessible-only, role-aware)
    - `date_from`/`date_to`: window tx (inklusif). Default: semua waktu.
    - `include_no_budget`: kalau false (default), proyek tanpa budget
      di-exclude. Set true untuk audit "proyek yg belum di-set budget".
    """
    # 1) Resolve accessible projects
    pids = await user_project_ids(db, user)
    stmt = select(Project).where(
        Project.deleted_at.is_(None),
        Project.status == ProjectStatus.AKTIF,
        # Exclude Catatan Non-Proyek -- bucket SUPERADMIN-only di luar
        # konsep budget operasional. NP tdk punya budget_amount realistis
        # dan kebocorannya ke halaman Budget akan reveal keberadaannya
        # ke role lain.
        Project.kind != ProjectKind.NON_PROJECT.value,
    )
    if pids is not None:
        if not pids:
            return BudgetSummaryResponse(
                rows=[],
                totals=BudgetTotals(
                    budget=Decimal("0"), spent=Decimal("0"),
                    remaining=Decimal("0"), usage_pct=Decimal("0"),
                    n_aman=0, n_mendekati=0, n_overbudget=0, n_no_budget=0,
                ),
            )
        stmt = stmt.where(Project.id.in_(pids))
    if project_id:
        for pid in project_id:
            await ensure_project_access(db, user, pid)
        stmt = stmt.where(Project.id.in_(project_id))
    if not include_no_budget:
        stmt = stmt.where(Project.budget_amount > 0)
    stmt = stmt.order_by(Project.name.asc())

    projects = (await db.execute(stmt)).scalars().all()

    # 2) Compute spend per project (1 query per project; bisa di-batch
    #    via JOIN/GROUP BY tapi N proyek biasanya <100, OK utk now).
    rows: list[BudgetRow] = []
    company_cache: dict[int, str] = {}

    for p in projects:
        spend_q = select(func.coalesce(func.sum(Transaction.amount), 0)).where(
            Transaction.project_id == p.id,
            Transaction.type == TxnType.OUT,
            Transaction.status.in_(ACTIVE_STATUSES),
            Transaction.deleted_at.is_(None),
        )
        if date_from:
            spend_q = spend_q.where(Transaction.tx_date >= date_from)
        if date_to:
            spend_q = spend_q.where(Transaction.tx_date <= date_to)
        spent = Decimal((await db.execute(spend_q)).scalar_one() or 0)
        bs = budget_status(p, spent)

        # Company name (cached)
        company_name = None
        if p.company_id:
            if p.company_id in company_cache:
                company_name = company_cache[p.company_id]
            else:
                from app.models.models import Company
                co = await db.get(Company, p.company_id)
                if co:
                    company_name = co.name
                    company_cache[p.company_id] = co.name

        rows.append(BudgetRow(
            project_id=p.id,
            project_code=p.code,
            project_name=p.name,
            company_name=company_name,
            budget_amount=bs["budget_amount"],
            spent=bs["spent"],
            remaining=bs["remaining"],
            usage_pct=bs["usage_pct"],
            status=bs["status"],
        ))

    # 3) Totals
    total_budget = sum((r.budget_amount for r in rows), Decimal("0"))
    total_spent = sum((r.spent for r in rows), Decimal("0"))
    total_remaining = total_budget - total_spent
    total_pct = (
        (total_spent / total_budget * Decimal("100")).quantize(Decimal("0.01"))
        if total_budget > 0 else Decimal("0")
    )
    totals = BudgetTotals(
        budget=total_budget,
        spent=total_spent,
        remaining=total_remaining,
        usage_pct=total_pct,
        n_aman=sum(1 for r in rows if r.status == "aman"),
        n_mendekati=sum(1 for r in rows if r.status == "mendekati_batas"),
        n_overbudget=sum(1 for r in rows if r.status == "overbudget"),
        n_no_budget=sum(1 for r in rows if r.status == "no_budget"),
    )

    # 4) Per-category breakdown (hanya kalau filter ke 1 project)
    by_category: list[BudgetCategoryRow] = []
    if project_id and len(project_id) == 1:
        pid = project_id[0]
        cat_q = (
            select(
                Transaction.category_id,
                func.coalesce(func.sum(Transaction.amount), 0).label("spent"),
            )
            .where(
                Transaction.project_id == pid,
                Transaction.type == TxnType.OUT,
                Transaction.status.in_(ACTIVE_STATUSES),
                Transaction.deleted_at.is_(None),
            )
            .group_by(Transaction.category_id)
        )
        if date_from:
            cat_q = cat_q.where(Transaction.tx_date >= date_from)
        if date_to:
            cat_q = cat_q.where(Transaction.tx_date <= date_to)
        cat_rows = (await db.execute(cat_q)).all()

        # Fetch cat names
        cat_ids = [cid for cid, _ in cat_rows if cid]
        cat_names: dict[int, str] = {}
        if cat_ids:
            cn_q = await db.execute(select(Category).where(Category.id.in_(cat_ids)))
            for c in cn_q.scalars().all():
                cat_names[c.id] = c.name

        project_spent = next((r.spent for r in rows if r.project_id == pid), Decimal("0"))
        for cid, spent_val in cat_rows:
            sval = Decimal(spent_val or 0)
            pct = (
                (sval / project_spent * Decimal("100")).quantize(Decimal("0.01"))
                if project_spent > 0 else Decimal("0")
            )
            by_category.append(BudgetCategoryRow(
                project_id=pid,
                category_id=cid,
                category_name=cat_names.get(cid, "(Tanpa kategori)") if cid else "(Tanpa kategori)",
                spent=sval,
                pct_of_project_spent=pct,
            ))
        # Sort desc by spent
        by_category.sort(key=lambda x: x.spent, reverse=True)

    return BudgetSummaryResponse(
        rows=rows, totals=totals, by_category=by_category,
    )
