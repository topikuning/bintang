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


async def project_expense_breakdown(
    db: AsyncSession, project_id: int,
    *, statuses: tuple = ACTIVE_STATUSES,
) -> dict[str, Decimal]:
    """Komposisi biaya OUT proyek per peran akuntansi.

    Audit 2026-05-23 user req: transparansi Rincian Keuangan. Pecah
    Biaya Aktual ke 4 bucket berdasar Category flag:
    - marketing (is_marketing=True)
    - penalty (is_penalty=True)
    - profit_share (is_profit_share=True)
    - operating (none of above, OR tx tanpa category)

    Catatan: marketing di-EXCLUDE dari budget bar (formula terpisah).
    Penalty + profit_share + operating SEMUA masuk budget bar.

    Return: {marketing, penalty, profit_share, operating, total}.
    Sum 4 buckets = total (kecuali bug data).
    """
    from sqlalchemy import case
    # Single GROUP BY w/ CASE: efisien 1 query.
    flag_expr = case(
        (Category.is_marketing.is_(True), "marketing"),
        (Category.is_penalty.is_(True), "penalty"),
        (Category.is_profit_share.is_(True), "profit_share"),
        else_="operating",
    )
    rows = (await db.execute(
        select(
            flag_expr.label("bucket"),
            func.coalesce(func.sum(Transaction.amount), 0).label("amt"),
        )
        .outerjoin(Category, Category.id == Transaction.category_id)
        .where(
            Transaction.project_id == project_id,
            Transaction.type == TxnType.OUT,
            Transaction.status.in_(statuses),
            Transaction.deleted_at.is_(None),
        )
        .group_by("bucket")
    )).all()
    out = {
        "marketing": Decimal("0"),
        "penalty": Decimal("0"),
        "profit_share": Decimal("0"),
        "operating": Decimal("0"),
    }
    for bucket, amt in rows:
        if bucket in out:
            out[bucket] = Decimal(amt or 0)
        else:
            # 'operating' bucket bisa muncul sbg None kalau tx tanpa category
            out["operating"] += Decimal(amt or 0)
    out["total"] = sum(out.values(), Decimal("0"))
    return out


def budget_status(
    project: Project,
    total_out: Decimal,
    *,
    marketing_actual: Decimal = Decimal("0"),
    profit_share_actual: Decimal = Decimal("0"),
) -> dict:
    """Status budget pengeluaran proyek (OPERASIONAL + DENDA).

    Audit 2026-05-23 user req: exclude marketing + bagi hasil dr
    perhitungan budget. Project.budget_amount = target pengeluaran
    OPERASIONAL (tanpa marketing & bagi hasil -- keduanya bukan biaya
    operasi):
      - Marketing punya reservasi formula sendiri (% dari Nilai Cair).
      - Bagi hasil = distribusi profit ke mitra, BUKAN biaya operasi
        (standar akuntansi: below-the-line).
    Denda TETAP masuk (biaya operasi non-finansial).

    Spending yg dibandingkan budget = total_out - marketing - profit_share.

    Backward-compat: kedua param default 0 -> behaviour lama.
    """
    budget = Decimal(project.budget_amount or 0)
    mkt = max(Decimal("0"), marketing_actual)
    ps = max(Decimal("0"), profit_share_actual)
    spent_for_budget = max(Decimal("0"), total_out - mkt - ps)
    if budget <= 0:
        return {
            "budget_amount": budget,
            "spent": spent_for_budget,
            "spent_total": total_out,
            "marketing_actual": mkt,
            "profit_share_actual": ps,
            "remaining": Decimal("0"),
            "usage_pct": Decimal("0"),
            "status": "no_budget",
        }
    pct = (spent_for_budget / budget) * Decimal("100")
    remaining = budget - spent_for_budget
    if pct <= Decimal("80"):
        status = "aman"
    elif pct <= Decimal("100"):
        status = "mendekati_batas"
    else:
        status = "overbudget"
    return {
        "budget_amount": budget,
        # 'spent' = utk perbandingan budget (operasional + denda).
        # Marketing + profit_share di-exclude.
        "spent": spent_for_budget,
        "spent_total": total_out,
        "marketing_actual": mkt,
        "profit_share_actual": ps,
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
