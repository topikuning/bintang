from datetime import date as date_type
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import (
    ensure_project_access,
    get_current_user,
    user_project_ids,
)
from app.db.session import get_db
from app.models.models import (
    Category,
    Company,
    Invoice,
    InvoiceStatus,
    Project,
    ProjectStatus,
    Transaction,
    TxnStatus,
    TxnType,
    User,
    UserRole,
)
from app.services.budget import budget_status, health_status, project_totals

router = APIRouter()


def _accessible_filter(stmt, user: User, ids: list[int]):
    if user.role != UserRole.SUPERADMIN:
        if not ids:
            return None
        return stmt.where(Project.id.in_(ids))
    return stmt


@router.get("/global")
async def global_dashboard(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    ids = await user_project_ids(db, user)
    proj_q = select(Project).where(Project.deleted_at.is_(None))
    proj_q = _accessible_filter(proj_q, user, ids)
    if proj_q is None:
        return {
            "totals": {"in": 0, "out": 0, "balance": 0},
            "active_projects": 0,
            "minus_projects": 0,
            "biggest_project": None,
            "monthly_cashflow": [],
            "projects": [],
            "warnings": [],
        }
    projects = (await db.execute(proj_q)).scalars().all()
    project_ids = [p.id for p in projects]

    if not project_ids:
        return {
            "totals": {"in": 0, "out": 0, "balance": 0},
            "active_projects": 0,
            "minus_projects": 0,
            "biggest_project": None,
            "monthly_cashflow": [],
            "projects": [],
            "warnings": [],
        }

    sum_in_q = select(func.coalesce(func.sum(Transaction.amount), 0)).where(
        Transaction.project_id.in_(project_ids),
        Transaction.type == TxnType.IN,
        Transaction.status == TxnStatus.VERIFIED,
        Transaction.deleted_at.is_(None),
    )
    sum_out_q = select(func.coalesce(func.sum(Transaction.amount), 0)).where(
        Transaction.project_id.in_(project_ids),
        Transaction.type == TxnType.OUT,
        Transaction.status == TxnStatus.VERIFIED,
        Transaction.deleted_at.is_(None),
    )
    total_in = Decimal((await db.execute(sum_in_q)).scalar_one() or 0)
    total_out = Decimal((await db.execute(sum_out_q)).scalar_one() or 0)

    # monthly cashflow last 12 months
    monthly_q = (
        select(
            func.strftime("%Y-%m", Transaction.tx_date).label("ym"),
            func.coalesce(func.sum(case((Transaction.type == TxnType.IN, Transaction.amount), else_=0)), 0).label("in_"),
            func.coalesce(func.sum(case((Transaction.type == TxnType.OUT, Transaction.amount), else_=0)), 0).label("out_"),
        )
        .where(
            Transaction.project_id.in_(project_ids),
            Transaction.status == TxnStatus.VERIFIED,
            Transaction.deleted_at.is_(None),
        )
        .group_by("ym").order_by("ym")
    )
    try:
        rows = (await db.execute(monthly_q)).all()
        monthly = [{"month": r.ym, "in": float(r.in_), "out": float(r.out_)} for r in rows[-12:]]
    except Exception:
        # fallback for non-sqlite (postgres): use date_trunc
        monthly_q2 = (
            select(
                func.to_char(Transaction.tx_date, "YYYY-MM").label("ym"),
                func.coalesce(func.sum(case((Transaction.type == TxnType.IN, Transaction.amount), else_=0)), 0).label("in_"),
                func.coalesce(func.sum(case((Transaction.type == TxnType.OUT, Transaction.amount), else_=0)), 0).label("out_"),
            )
            .where(
                Transaction.project_id.in_(project_ids),
                Transaction.status == TxnStatus.VERIFIED,
                Transaction.deleted_at.is_(None),
            )
            .group_by("ym").order_by("ym")
        )
        rows = (await db.execute(monthly_q2)).all()
        monthly = [{"month": r.ym, "in": float(r.in_), "out": float(r.out_)} for r in rows[-12:]]

    overdue_count_q = select(func.count()).select_from(Invoice).where(
        Invoice.project_id.in_(project_ids),
        Invoice.status == InvoiceStatus.OVERDUE,
        Invoice.deleted_at.is_(None),
    )
    overdue_count = (await db.execute(overdue_count_q)).scalar_one()

    proj_summary: list[dict] = []
    minus_count = 0
    biggest = {"id": None, "name": None, "total": Decimal("0")}
    company_map = {c.id: c for c in (await db.execute(select(Company))).scalars().all()}

    for p in projects:
        totals = await project_totals(db, p.id)
        bs = budget_status(p, totals["total_out"])
        # any overdue invoice for this project?
        ovq = select(func.count()).select_from(Invoice).where(
            Invoice.project_id == p.id,
            Invoice.status == InvoiceStatus.OVERDUE,
            Invoice.deleted_at.is_(None),
        )
        has_overdue = ((await db.execute(ovq)).scalar_one() or 0) > 0
        hs = health_status(totals["balance"], has_overdue)
        if hs == "minus":
            minus_count += 1
        engaged = totals["total_in"] + totals["total_out"]
        if engaged > biggest["total"]:
            biggest = {"id": p.id, "name": p.name, "total": engaged}

        proj_summary.append({
            "id": p.id,
            "code": p.code,
            "name": p.name,
            "company": company_map.get(p.company_id).name if company_map.get(p.company_id) else None,
            "status": p.status.value,
            "currency": p.currency,
            "total_in": float(totals["total_in"]),
            "total_out": float(totals["total_out"]),
            "balance": float(totals["balance"]),
            "budget": {
                "amount": float(bs["budget_amount"]),
                "spent": float(bs["spent"]),
                "remaining": float(bs["remaining"]),
                "usage_pct": float(bs["usage_pct"]),
                "status": bs["status"],
            },
            "health": hs,
        })

    proj_summary.sort(key=lambda x: x["balance"])

    warnings: list[str] = []
    if minus_count:
        warnings.append(f"{minus_count} proyek bersaldo minus")
    if overdue_count:
        warnings.append(f"{overdue_count} invoice overdue")
    over_budget = [p for p in proj_summary if p["budget"]["status"] == "overbudget"]
    if over_budget:
        warnings.append(f"{len(over_budget)} proyek overbudget")
    near_budget = [p for p in proj_summary if p["budget"]["status"] == "mendekati_batas"]
    if near_budget:
        warnings.append(f"{len(near_budget)} proyek mendekati batas budget")

    active = sum(1 for p in projects if p.status == ProjectStatus.AKTIF)

    return {
        "totals": {"in": float(total_in), "out": float(total_out), "balance": float(total_in - total_out)},
        "active_projects": active,
        "total_projects": len(projects),
        "minus_projects": minus_count,
        "biggest_project": {"id": biggest["id"], "name": biggest["name"], "total": float(biggest["total"])} if biggest["id"] else None,
        "monthly_cashflow": monthly,
        "projects": proj_summary,
        "warnings": warnings,
    }


@router.get("/project/{pid}")
async def project_dashboard(
    pid: int,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    p = await db.get(Project, pid)
    if not p or p.deleted_at is not None:
        raise HTTPException(404, "not_found")
    await ensure_project_access(db, user, pid)
    totals = await project_totals(db, pid)
    bs = budget_status(p, totals["total_out"])

    # invoice aggregates
    inv_open_q = select(func.coalesce(func.sum(Invoice.total), 0)).where(
        Invoice.project_id == pid,
        Invoice.status.in_([InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE]),
        Invoice.deleted_at.is_(None),
    )
    inv_paid_q = select(func.coalesce(func.sum(Invoice.total), 0)).where(
        Invoice.project_id == pid,
        Invoice.status == InvoiceStatus.PAID,
        Invoice.deleted_at.is_(None),
    )
    inv_open = float((await db.execute(inv_open_q)).scalar_one() or 0)
    inv_paid = float((await db.execute(inv_paid_q)).scalar_one() or 0)

    # by category (OUT)
    cat_q = (
        select(Category.name, func.coalesce(func.sum(Transaction.amount), 0))
        .join(Category, Category.id == Transaction.category_id, isouter=True)
        .where(
            Transaction.project_id == pid,
            Transaction.type == TxnType.OUT,
            Transaction.status == TxnStatus.VERIFIED,
            Transaction.deleted_at.is_(None),
        )
        .group_by(Category.name)
        .order_by(func.sum(Transaction.amount).desc())
    )
    if date_from:
        cat_q = cat_q.where(Transaction.tx_date >= date_from)
    if date_to:
        cat_q = cat_q.where(Transaction.tx_date <= date_to)
    cat_rows = (await db.execute(cat_q)).all()
    by_category = [{"category": (r[0] or "Tanpa Kategori"), "total": float(r[1])} for r in cat_rows]

    # cashflow monthly
    try:
        cash_q = (
            select(
                func.strftime("%Y-%m", Transaction.tx_date).label("ym"),
                func.coalesce(func.sum(case((Transaction.type == TxnType.IN, Transaction.amount), else_=0)), 0).label("in_"),
                func.coalesce(func.sum(case((Transaction.type == TxnType.OUT, Transaction.amount), else_=0)), 0).label("out_"),
            )
            .where(
                Transaction.project_id == pid,
                Transaction.status == TxnStatus.VERIFIED,
                Transaction.deleted_at.is_(None),
            )
            .group_by("ym").order_by("ym")
        )
        rows = (await db.execute(cash_q)).all()
        monthly = [{"month": r.ym, "in": float(r.in_), "out": float(r.out_)} for r in rows[-12:]]
    except Exception:
        monthly = []

    recent_q = (
        select(Transaction)
        .where(Transaction.project_id == pid, Transaction.deleted_at.is_(None))
        .order_by(Transaction.tx_date.desc(), Transaction.id.desc())
        .limit(10)
    )
    recent_rows = (await db.execute(recent_q)).scalars().all()
    recent = [
        {
            "id": t.id, "date": t.tx_date.isoformat(), "type": t.type.value,
            "amount": float(t.amount), "party": t.party_name,
            "description": t.description, "status": t.status.value,
        }
        for t in recent_rows
    ]

    has_overdue = inv_open > 0 and (
        await db.execute(
            select(func.count()).select_from(Invoice).where(
                Invoice.project_id == pid,
                Invoice.status == InvoiceStatus.OVERDUE,
                Invoice.deleted_at.is_(None),
            )
        )
    ).scalar_one() > 0
    hs = health_status(totals["balance"], has_overdue)
    ratio = float(totals["total_out"] / totals["total_in"] * 100) if totals["total_in"] > 0 else None

    warnings: list[str] = []
    if totals["balance"] < 0:
        warnings.append("Saldo proyek minus")
    if bs["status"] == "overbudget":
        warnings.append("Pemakaian budget melebihi 100%")
    elif bs["status"] == "mendekati_batas":
        warnings.append("Pemakaian budget di atas 80%")
    if has_overdue:
        warnings.append("Ada invoice overdue")

    return {
        "project": {
            "id": p.id, "code": p.code, "name": p.name, "status": p.status.value,
            "company_id": p.company_id, "currency": p.currency,
        },
        "totals": {
            "in": float(totals["total_in"]),
            "out": float(totals["total_out"]),
            "balance": float(totals["balance"]),
        },
        "budget": {
            "amount": float(bs["budget_amount"]),
            "spent": float(bs["spent"]),
            "remaining": float(bs["remaining"]),
            "usage_pct": float(bs["usage_pct"]),
            "status": bs["status"],
        },
        "health": hs,
        "expense_to_income_ratio_pct": ratio,
        "invoice_open_total": inv_open,
        "invoice_paid_total": inv_paid,
        "by_category": by_category,
        "monthly_cashflow": monthly,
        "recent_transactions": recent,
        "warnings": warnings,
    }
