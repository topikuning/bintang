from __future__ import annotations

from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import Project, Transaction, TxnStatus, TxnType

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


def budget_status(project: Project, total_out: Decimal) -> dict:
    budget = Decimal(project.budget_amount or 0)
    if budget <= 0:
        return {
            "budget_amount": budget,
            "spent": total_out,
            "remaining": Decimal("0"),
            "usage_pct": Decimal("0"),
            "status": "no_budget",
        }
    pct = (total_out / budget) * Decimal("100")
    remaining = budget - total_out
    if pct <= Decimal("80"):
        status = "aman"
    elif pct <= Decimal("100"):
        status = "mendekati_batas"
    else:
        status = "overbudget"
    return {
        "budget_amount": budget,
        "spent": total_out,
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
