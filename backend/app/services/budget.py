from __future__ import annotations

from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import (
    Category,
    Project,
    Transaction,
    TxnStatus,
    TxnType,
)

# Status yang dihitung dalam total proyek. REJECTED & CANCELLED dikeluarkan.
ACTIVE_STATUSES = (TxnStatus.DRAFT, TxnStatus.SUBMITTED, TxnStatus.VERIFIED)
PENDING_STATUSES = (TxnStatus.DRAFT, TxnStatus.SUBMITTED)


async def project_totals(db: AsyncSession, project_id: int) -> dict[str, Decimal]:
    """Total IN, OUT (semua active), pending breakdown, dan saldo proyek."""

    def _sum_q(ttype: TxnType, statuses):
        return select(func.coalesce(func.sum(Transaction.amount), 0)).where(
            Transaction.project_id == project_id,
            Transaction.type == ttype,
            Transaction.status.in_(statuses),
            Transaction.deleted_at.is_(None),
        )

    total_in = Decimal((await db.execute(_sum_q(TxnType.IN, ACTIVE_STATUSES))).scalar_one() or 0)
    total_out = Decimal((await db.execute(_sum_q(TxnType.OUT, ACTIVE_STATUSES))).scalar_one() or 0)
    pending_in = Decimal((await db.execute(_sum_q(TxnType.IN, PENDING_STATUSES))).scalar_one() or 0)
    pending_out = Decimal((await db.execute(_sum_q(TxnType.OUT, PENDING_STATUSES))).scalar_one() or 0)

    return {
        "total_in": total_in,
        "total_out": total_out,
        "balance": total_in - total_out,
        "pending_in": pending_in,
        "pending_out": pending_out,
    }


async def project_marketing_actual(
    db: AsyncSession, project_id: int,
    *, statuses: tuple = ACTIVE_STATUSES,
) -> Decimal:
    """SUM TX OUT (statuses) di proyek yg category.is_marketing=True.

    Audit 2026-05-23: dipakai utk exclude marketing dr Budget Pengeluaran
    bar (budget di-set sbg target non-marketing; marketing reservasi
    formula terpisah).
    """
    res = await db.execute(
        select(func.coalesce(func.sum(Transaction.amount), 0))
        .join(Category, Category.id == Transaction.category_id)
        .where(
            Transaction.project_id == project_id,
            Transaction.type == TxnType.OUT,
            Transaction.status.in_(statuses),
            Transaction.deleted_at.is_(None),
            Category.is_marketing.is_(True),
        )
    )
    return Decimal(res.scalar_one() or 0)


def budget_status(
    project: Project,
    total_out: Decimal,
    *,
    marketing_actual: Decimal = Decimal("0"),
) -> dict:
    """Status budget pengeluaran proyek (NON-MARKETING).

    Audit 2026-05-23 user req: exclude marketing dr perhitungan budget.
    Project.budget_amount adalah target pengeluaran OPERASIONAL (tanpa
    marketing -- marketing punya reservasi formula sendiri). Spending
    yg dibandingkan = total_out - marketing_actual.

    Backward-compat: marketing_actual default 0 -> behaviour lama
    (semua callers yg blm di-update tetap jalan tapi mungkin overstate).
    """
    budget = Decimal(project.budget_amount or 0)
    mkt = max(Decimal("0"), marketing_actual)
    spent_non_marketing = max(Decimal("0"), total_out - mkt)
    if budget <= 0:
        return {
            "budget_amount": budget,
            "spent": spent_non_marketing,
            "spent_total": total_out,
            "marketing_actual": mkt,
            "remaining": Decimal("0"),
            "usage_pct": Decimal("0"),
            "status": "no_budget",
        }
    pct = (spent_non_marketing / budget) * Decimal("100")
    remaining = budget - spent_non_marketing
    if pct <= Decimal("80"):
        status = "aman"
    elif pct <= Decimal("100"):
        status = "mendekati_batas"
    else:
        status = "overbudget"
    return {
        "budget_amount": budget,
        # 'spent' = non-marketing (utk perbandingan budget). Backward
        # callers yg pakai field 'spent' otomatis ke-update.
        "spent": spent_non_marketing,
        "spent_total": total_out,
        "marketing_actual": mkt,
        "remaining": remaining,
        "usage_pct": pct.quantize(Decimal("0.01")),
        "status": status,
    }


def health_status(balance: Decimal, has_overdue: bool) -> str:
    if balance < 0:
        return "minus"
    if has_overdue or balance == 0:
        return "waspada"
    return "sehat"
