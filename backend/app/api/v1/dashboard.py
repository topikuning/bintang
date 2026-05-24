from datetime import date as date_type
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
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
    InvoiceAllocation,
    InvoiceStatus,
    InvoiceType,
    Project,
    ProjectKind,
    ProjectStatus,
    Transaction,
    TxnStatus,
    TxnType,
    User,
    UserRole,
)
from app.services.budget import (
    budget_status,
    health_status,
    project_expense_breakdown,
    project_marketing_actual,
    project_totals,
)
from app.services.non_project import transaction_eligibility_clause

router = APIRouter()


def _txn_alloc_subq():
    """Subquery: total alokasi aktif per transaction_id."""
    return (
        select(
            InvoiceAllocation.transaction_id.label("txn_id"),
            func.coalesce(func.sum(InvoiceAllocation.allocated_amount), 0).label("alloc_sum"),
        )
        .where(InvoiceAllocation.deleted_at.is_(None))
        .group_by(InvoiceAllocation.transaction_id)
        .subquery()
    )


def _project_finance_breakdown(
    *,
    nilai_kontrak: Decimal,
    ppn_pct: Decimal,
    pph_pct: Decimal,
    marketing_pct: Decimal,
    biaya_aktual: Decimal,
    biaya_proyeksi: Decimal,
    marketing_aktual: Decimal = Decimal("0"),
    profit_share_actual: Decimal = Decimal("0"),
) -> dict:
    """Hitung DPP, PPn, PPh, Nilai Cair, Marketing, dan profit.

    Rumus (Indonesia):
        DPP = Nilai Kontrak / (1 + PPn%)
        PPn = DPP * PPn%
        PPh = DPP * PPh%
        Nilai Cair = Nilai Kontrak - (PPn + PPh)
        Marketing Budget = Nilai Cair * Marketing%

    Audit 2026-05-23 fix:
        * Marketing aktual sudah include di Biaya Aktual (no double count).
        * Bagi hasil (profit_share) = DISTRIBUSI profit, BUKAN expense.
          Profit operating display = SEBELUM dikurangi bagi hasil
          (user req: 'TX bagi hasil cuma sync, tdk kurangi profit').

    Profit:
        biaya_excl_share = biaya_aktual - profit_share_actual
            (expense yg kurangi profit operasi: marketing + denda + operating).
        profit_now (OPERATING)   = Nilai Cair - biaya_excl_share
            -- profit sebelum distribusi ke mitra.
        profit_net (AFTER SHARE) = Nilai Cair - biaya_aktual
            -- laba akhir setelah bagi hasil dibayar.
        profit_proj (TARGET)     = Nilai Cair - max(marketing_budget,
                                    marketing_actual) - biaya_proyeksi.
    """
    one = Decimal("1")
    hundred = Decimal("100")
    ppn_rate = ppn_pct / hundred
    pph_rate = pph_pct / hundred
    mkt_rate = marketing_pct / hundred
    dpp = nilai_kontrak / (one + ppn_rate) if (one + ppn_rate) != 0 else Decimal("0")
    ppn = dpp * ppn_rate
    pph = dpp * pph_rate
    cair = nilai_kontrak - (ppn + pph)
    marketing_budget = cair * mkt_rate
    marketing_used = max(marketing_aktual, Decimal("0"))
    profit_share_used = max(profit_share_actual, Decimal("0"))
    biaya_aktual_non_marketing = max(biaya_aktual - marketing_used, Decimal("0"))
    # Bagi hasil JANGAN kurangi profit operating (audit user req).
    biaya_excl_share = max(biaya_aktual - profit_share_used, Decimal("0"))

    profit_now = cair - biaya_excl_share          # operating, sebelum bagi hasil
    profit_net = cair - biaya_aktual              # net, setelah bagi hasil
    marketing_reserve = max(marketing_budget, marketing_used)
    profit_proj = cair - marketing_reserve - biaya_proyeksi

    return {
        "nilai_kontrak": float(nilai_kontrak),
        "ppn_pct": float(ppn_pct),
        "pph_pct": float(pph_pct),
        "marketing_pct": float(marketing_pct),
        "dpp": float(dpp),
        "ppn": float(ppn),
        "pph": float(pph),
        "nilai_cair": float(cair),
        # Backward-compat alias.
        "marketing": float(marketing_budget),
        "marketing_budget": float(marketing_budget),
        "marketing_aktual": float(marketing_used),
        "marketing_variance": float(marketing_used - marketing_budget),
        "biaya_aktual": float(biaya_aktual),
        "biaya_aktual_non_marketing": float(biaya_aktual_non_marketing),
        "biaya_proyeksi": float(biaya_proyeksi),
        # Profit fields:
        "profit_now": float(profit_now),                # operating
        "profit_net": float(profit_net),                # after profit_share
        "profit_share_paid": float(profit_share_used),  # info distribusi
        "profit_proj": float(profit_proj),
    }


def _ym_expr():
    """Dialect-aware month expression. SQLite uses strftime, others use to_char."""
    if settings.is_sqlite:
        return func.strftime("%Y-%m", Transaction.tx_date)
    return func.to_char(Transaction.tx_date, "YYYY-MM")


@router.get("/global")
async def global_dashboard(
    q: str | None = None,
    company_id: int | None = None,
    # Multi-value filters. FastAPI parse repeated ?location=A&location=B -> list.
    # Case-insensitive match (lowercase). Pendana = User(EXECUTIVE) JOIN
    # lewat project_users (sebelumnya project_funders, lihat migration
    # 20260518_1400).
    location: list[str] | None = Query(None),
    client_name: list[str] | None = Query(None),
    funder_id: list[int] | None = Query(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    pids = await user_project_ids(db, user)  # None=all, []=no access, [..]=scoped
    # Hub proyek operasional -- exclude bucket NON_PROJECT (punya halaman
    # sendiri di /catatan-non-proyek). Kontribusi NP ke totals/cashflow
    # ditambahkan terpisah di bawah, hormati year toggle.
    proj_q = select(Project).where(
        Project.deleted_at.is_(None),
        Project.kind != ProjectKind.NON_PROJECT.value,
    )

    # Shape default utk early-return (user tanpa proyek / setelah filter
    # tdk ada proyek). Wajib include SEMUA field yg dipakai FE supaya tdk
    # crash di Dashboard.tsx (mis. spending_by_project.length).
    def _empty_global() -> dict:
        return {
            "totals": {"in": 0, "out": 0, "balance": 0, "pending_in": 0, "pending_out": 0},
            "active_projects": 0,
            "total_projects": 0,
            "minus_projects": 0,
            "pending_count": 0,
            "pending_total": 0,
            "unlinked_out_count": 0,
            "unlinked_out_total": 0,
            "overdue_invoices": 0,
            "biggest_project": None,
            "top_spender": None,
            "spending_by_project": [],
            "spending_by_category": [],
            "monthly_cashflow": [],
            "projects": [],
            "warnings": [],
            "non_project": {"eligible_in": 0, "eligible_out": 0, "accessible_count": 0},
        }

    if pids is not None:
        if not pids:
            return _empty_global()
        proj_q = proj_q.where(Project.id.in_(pids))
    if q:
        like = f"%{q}%"
        proj_q = proj_q.where((Project.name.ilike(like)) | (Project.code.ilike(like)))
    if company_id:
        proj_q = proj_q.where(Project.company_id == company_id)
    if location:
        proj_q = proj_q.where(func.lower(Project.location).in_([s.lower() for s in location]))
    if client_name:
        proj_q = proj_q.where(func.lower(Project.client_name).in_([s.lower() for s in client_name]))
    if funder_id:
        # Pendana sekarang = User(role=EXECUTIVE) ter-link via project_users.
        # JOIN ke users supaya filter role-nya benar (jangan ke-include
        # PROJECT_ADMIN yg kebetulan user_id-nya match).
        from app.models.models import ProjectUser as _PU
        from app.models.models import User as _User
        from app.models.models import UserRole as _UR
        proj_q = proj_q.join(_PU, _PU.project_id == Project.id).join(
            _User, _User.id == _PU.user_id
        ).where(
            _PU.user_id.in_(funder_id),
            _User.role == _UR.EXECUTIVE,
        ).distinct()
    projects = (await db.execute(proj_q)).scalars().all()
    project_ids = [p.id for p in projects]

    if not project_ids:
        return _empty_global()

    # NON_PROJECT pids accessible ke user. Cuma muncul di agregat
    # (totals, monthly_cashflow) -- dgn year toggle dr NonProjectYearSetting.
    np_pids_q = select(Project.id).where(
        Project.deleted_at.is_(None),
        Project.kind == ProjectKind.NON_PROJECT.value,
    )
    if pids is not None:
        np_pids_q = np_pids_q.where(Project.id.in_(pids))
    np_pids = list((await db.execute(np_pids_q)).scalars().all())
    elig_clause = await transaction_eligibility_clause(db) if np_pids else None

    # totals_in/out dihitung lewat proj_summary di bawah agar konsisten

    # monthly cashflow last 12 months. Gabungan tx REGULAR (semua di
    # project_ids) + tx NON_PROJECT (eligible per year toggle).
    monthly_pids = project_ids + np_pids
    monthly_filters = [
        Transaction.project_id.in_(monthly_pids),
        Transaction.status == TxnStatus.VERIFIED,
        Transaction.deleted_at.is_(None),
    ]
    if elig_clause is not None:
        # JOIN Project supaya klausa eligibility bisa baca kind/company_id
        monthly_q = (
            select(
                _ym_expr().label("ym"),
                func.coalesce(func.sum(case((Transaction.type == TxnType.IN, Transaction.amount), else_=0)), 0).label("in_"),
                func.coalesce(func.sum(case((Transaction.type == TxnType.OUT, Transaction.amount), else_=0)), 0).label("out_"),
            )
            .select_from(Transaction)
            .join(Project, Project.id == Transaction.project_id)
            .where(*monthly_filters, elig_clause)
            .group_by("ym").order_by("ym")
        )
    else:
        monthly_q = (
            select(
                _ym_expr().label("ym"),
                func.coalesce(func.sum(case((Transaction.type == TxnType.IN, Transaction.amount), else_=0)), 0).label("in_"),
                func.coalesce(func.sum(case((Transaction.type == TxnType.OUT, Transaction.amount), else_=0)), 0).label("out_"),
            )
            .where(*monthly_filters)
            .group_by("ym").order_by("ym")
        )
    rows = (await db.execute(monthly_q)).all()
    monthly = [{"month": r.ym, "in": float(r.in_), "out": float(r.out_)} for r in rows[-12:]]

    overdue_count_q = select(func.count()).select_from(Invoice).where(
        Invoice.project_id.in_(project_ids),
        Invoice.status == InvoiceStatus.OVERDUE,
        Invoice.deleted_at.is_(None),
    )
    overdue_count = (await db.execute(overdue_count_q)).scalar_one()

    # Pending verifikasi (DRAFT + SUBMITTED)
    pending_q = select(
        func.count(),
        func.coalesce(func.sum(Transaction.amount), 0),
    ).where(
        Transaction.project_id.in_(project_ids),
        Transaction.status.in_([TxnStatus.DRAFT, TxnStatus.SUBMITTED]),
        Transaction.deleted_at.is_(None),
    )
    pending_count, pending_total = (await db.execute(pending_q)).one()

    # Transaksi OUT yang masih punya remaining_amount > 0 (belum sepenuhnya
    # dialokasikan ke invoice manapun lewat tabel invoice_allocations).
    alloc_sub = _txn_alloc_subq()
    remaining_expr = Transaction.amount - func.coalesce(alloc_sub.c.alloc_sum, 0)
    unlinked_out_q = (
        select(
            func.count(),
            func.coalesce(func.sum(remaining_expr), 0),
        )
        .select_from(Transaction)
        .outerjoin(alloc_sub, alloc_sub.c.txn_id == Transaction.id)
    ).where(
        Transaction.project_id.in_(project_ids),
        Transaction.type == TxnType.OUT,
        Transaction.status.in_([TxnStatus.DRAFT, TxnStatus.SUBMITTED, TxnStatus.VERIFIED]),
        remaining_expr > 0,
        Transaction.deleted_at.is_(None),
    )
    unlinked_out_count, unlinked_out_total = (await db.execute(unlinked_out_q)).one()

    proj_summary: list[dict] = []
    minus_count = 0
    biggest = {"id": None, "name": None, "total": Decimal("0")}
    company_map = {c.id: c for c in (await db.execute(select(Company))).scalars().all()}

    for p in projects:
        totals = await project_totals(db, p.id)
        # Audit 2026-05-23: budget pengeluaran exclude marketing +
        # bagi hasil (keduanya bukan biaya operasi).
        exp_brk = await project_expense_breakdown(db, p.id)
        bs = budget_status(
            p, totals["total_out"],
            marketing_actual=exp_brk["marketing"],
            profit_share_actual=exp_brk["profit_share"],
        )
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
            "pending_in": float(totals["pending_in"]),
            "pending_out": float(totals["pending_out"]),
            "budget": {
                "amount": float(bs["budget_amount"]),
                "spent": float(bs["spent"]),
                "spent_total": float(bs.get("spent_total", bs["spent"])),
                "marketing_actual": float(bs.get("marketing_actual", 0)),
                "remaining": float(bs["remaining"]),
                "usage_pct": float(bs["usage_pct"]),
                "status": bs["status"],
            },
            "health": hs,
        })

    proj_summary.sort(key=lambda x: x["balance"])

    # spending by category (OUT, verified)
    cat_q = (
        select(Category.name, func.coalesce(func.sum(Transaction.amount), 0))
        .join(Category, Category.id == Transaction.category_id, isouter=True)
        .where(
            Transaction.project_id.in_(project_ids),
            Transaction.type == TxnType.OUT,
            Transaction.status == TxnStatus.VERIFIED,
            Transaction.deleted_at.is_(None),
        )
        .group_by(Category.name)
        .order_by(func.sum(Transaction.amount).desc())
    )
    cat_rows = (await db.execute(cat_q)).all()
    spending_by_category = [
        {"category": (r[0] or "Tanpa Kategori"), "total": float(r[1])} for r in cat_rows
    ]

    # spending by project (OUT, verified) -- already collected via proj_summary
    spending_by_project = sorted(
        [
            {"project_id": p["id"], "name": p["name"], "total": p["total_out"]}
            for p in proj_summary
            if p["total_out"] > 0
        ],
        key=lambda x: x["total"],
        reverse=True,
    )
    top_spender = spending_by_project[0] if spending_by_project else None

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
    if pending_count:
        warnings.append(f"{pending_count} transaksi belum diverifikasi")
    if unlinked_out_count:
        warnings.append(f"{unlinked_out_count} pengeluaran masih punya sisa belum dialokasi (Rp{unlinked_out_total:,.0f})".replace(",", "."))

    active = sum(1 for p in projects if p.status == ProjectStatus.AKTIF)

    # totals_in/out di global juga ikut termasuk pending sekarang, jadi recompute
    sum_in_total = sum((Decimal(str(p["total_in"])) for p in proj_summary), Decimal("0"))
    sum_out_total = sum((Decimal(str(p["total_out"])) for p in proj_summary), Decimal("0"))
    sum_pending_in = sum((Decimal(str(p["pending_in"])) for p in proj_summary), Decimal("0"))
    sum_pending_out = sum((Decimal(str(p["pending_out"])) for p in proj_summary), Decimal("0"))

    # Kontribusi NON_PROJECT (year toggle = ON) ke totals.
    np_in_eligible = Decimal("0")
    np_out_eligible = Decimal("0")
    if np_pids and elig_clause is not None:
        np_totals_q = (
            select(
                func.coalesce(func.sum(case((Transaction.type == TxnType.IN, Transaction.amount), else_=0)), 0),
                func.coalesce(func.sum(case((Transaction.type == TxnType.OUT, Transaction.amount), else_=0)), 0),
            )
            .select_from(Transaction)
            .join(Project, Project.id == Transaction.project_id)
            .where(
                Transaction.project_id.in_(np_pids),
                Project.kind == ProjectKind.NON_PROJECT.value,
                elig_clause,
                Transaction.status == TxnStatus.VERIFIED,
                Transaction.deleted_at.is_(None),
            )
        )
        np_in_raw, np_out_raw = (await db.execute(np_totals_q)).one()
        np_in_eligible = Decimal(np_in_raw or 0)
        np_out_eligible = Decimal(np_out_raw or 0)
        sum_in_total += np_in_eligible
        sum_out_total += np_out_eligible

    return {
        "totals": {
            "in": float(sum_in_total),
            "out": float(sum_out_total),
            "balance": float(sum_in_total - sum_out_total),
            "pending_in": float(sum_pending_in),
            "pending_out": float(sum_pending_out),
        },
        "active_projects": active,
        "total_projects": len(projects),
        "minus_projects": minus_count,
        "pending_count": int(pending_count),
        "pending_total": float(pending_total),
        "unlinked_out_count": int(unlinked_out_count),
        "unlinked_out_total": float(unlinked_out_total),
        "overdue_invoices": int(overdue_count),
        "biggest_project": {"id": biggest["id"], "name": biggest["name"], "total": float(biggest["total"])} if biggest["id"] else None,
        "top_spender": top_spender,
        "spending_by_project": spending_by_project,
        "spending_by_category": spending_by_category,
        "monthly_cashflow": monthly,
        "projects": proj_summary,
        "warnings": warnings,
        # Ringkasan kontribusi Catatan Non-Proyek (year toggle = ON).
        # FE pakai utk banner di dashboard ("Catatan Non-Proyek 2025
        # ikut dihitung: -Rp X").
        "non_project": {
            "eligible_in": float(np_in_eligible),
            "eligible_out": float(np_out_eligible),
            "accessible_count": len(np_pids),
        },
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
    # Audit 2026-05-23: breakdown biaya per peran akuntansi.
    expense_breakdown = await project_expense_breakdown(db, pid)
    mkt_actual_for_budget = expense_breakdown["marketing"]
    bs = budget_status(
        p, totals["total_out"],
        marketing_actual=mkt_actual_for_budget,
        profit_share_actual=expense_breakdown["profit_share"],
    )

    # Pending dan unlinked di proyek ini
    pending_q = select(
        func.count(),
        func.coalesce(func.sum(Transaction.amount), 0),
    ).where(
        Transaction.project_id == pid,
        Transaction.status.in_([TxnStatus.DRAFT, TxnStatus.SUBMITTED]),
        Transaction.deleted_at.is_(None),
    )
    pending_count, pending_total = (await db.execute(pending_q)).one()

    # Transaksi OUT dengan remaining_amount > 0 (belum semua nilainya
    # dialokasikan ke invoice). Yang ditampilkan adalah jumlah txn dan
    # nominal sisa yang belum terpetakan, BUKAN total nominal txn.
    alloc_sub = _txn_alloc_subq()
    remaining_expr = Transaction.amount - func.coalesce(alloc_sub.c.alloc_sum, 0)
    unlinked_out_q = (
        select(
            func.count(),
            func.coalesce(func.sum(remaining_expr), 0),
        )
        .select_from(Transaction)
        .outerjoin(alloc_sub, alloc_sub.c.txn_id == Transaction.id)
    ).where(
        Transaction.project_id == pid,
        Transaction.type == TxnType.OUT,
        Transaction.status.in_([TxnStatus.DRAFT, TxnStatus.SUBMITTED, TxnStatus.VERIFIED]),
        Transaction.deleted_at.is_(None),
        remaining_expr > 0,
    )
    unlinked_out_count, unlinked_out_total = (await db.execute(unlinked_out_q)).one()

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

    # AR/AP aging breakdown utk invoice open (bucket 0-30 / 31-60 / 61-90 / >90)
    # Pakai tx_date (invoice_date) sebagai basis aging karena Invoice.due_date
    # bisa null. Kalau due_date tersedia, pakai due_date. Compute di Python
    # supaya portable (SQLite/Postgres).
    from datetime import date as _date_type
    aging_q = select(Invoice).where(
        Invoice.project_id == pid,
        Invoice.status.in_([InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE]),
        Invoice.deleted_at.is_(None),
    )
    aging_invs = (await db.execute(aging_q)).scalars().all()
    today = _date_type.today()
    # Format: per-direction (IN=hutang/AP, OUT=piutang/AR), 4 bucket
    def _empty_aging():
        return {"b0_30": 0.0, "b31_60": 0.0, "b61_90": 0.0, "b90_plus": 0.0, "total": 0.0, "count": 0}
    ap_aging = _empty_aging()  # IN -> hutang ke vendor
    ar_aging = _empty_aging()  # OUT -> piutang dr klien
    for inv in aging_invs:
        ref_date = inv.due_date or inv.invoice_date
        if ref_date:
            age = (today - ref_date).days
        else:
            age = 0
        # Outstanding = total - paid_amount (kalau ada). Pakai 'remaining'
        # langsung dr Invoice kalau ada method, atau hitung manual.
        outstanding = float(inv.total or 0)  # konservatif: pakai total
        bucket = (
            "b0_30" if age <= 30
            else "b31_60" if age <= 60
            else "b61_90" if age <= 90
            else "b90_plus"
        )
        if inv.type == InvoiceType.IN:
            ap_aging[bucket] += outstanding
            ap_aging["total"] += outstanding
            ap_aging["count"] += 1
        else:
            ar_aging[bucket] += outstanding
            ar_aging["total"] += outstanding
            ar_aging["count"] += 1

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
    cash_q = (
        select(
            _ym_expr().label("ym"),
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

    # Daftar invoice proyek (terbaru di atas) lengkap dengan paid /
    # outstanding hasil agregasi alokasi.
    inv_alloc_sub = (
        select(
            InvoiceAllocation.invoice_id.label("inv_id"),
            func.coalesce(func.sum(InvoiceAllocation.allocated_amount), 0).label("paid"),
        )
        .where(InvoiceAllocation.deleted_at.is_(None))
        .group_by(InvoiceAllocation.invoice_id)
        .subquery()
    )
    inv_q = (
        select(Invoice, func.coalesce(inv_alloc_sub.c.paid, 0))
        .outerjoin(inv_alloc_sub, inv_alloc_sub.c.inv_id == Invoice.id)
        .where(Invoice.project_id == pid, Invoice.deleted_at.is_(None))
        .order_by(Invoice.invoice_date.desc(), Invoice.id.desc())
        .limit(15)
    )
    inv_rows = (await db.execute(inv_q)).all()
    invoices_list = []
    for inv, paid in inv_rows:
        total = float(inv.total or 0)
        paid_f = float(paid or 0)
        invoices_list.append({
            "id": inv.id,
            "number": inv.number,
            "type": inv.type.value,
            "invoice_date": inv.invoice_date.isoformat(),
            "due_date": inv.due_date.isoformat() if inv.due_date else None,
            "party_name": inv.party_name,
            "total": total,
            "paid_amount": paid_f,
            "outstanding_amount": max(total - paid_f, 0.0),
            "status": inv.status.value,
        })

    # PO list utk section "Purchase Order" di project dashboard
    from app.models.models import PurchaseOrder
    po_q = (
        select(PurchaseOrder)
        .where(PurchaseOrder.project_id == pid, PurchaseOrder.deleted_at.is_(None))
        .order_by(PurchaseOrder.po_date.desc(), PurchaseOrder.id.desc())
        .limit(15)
    )
    po_rows = (await db.execute(po_q)).scalars().all()
    pos_list = [
        {
            "id": po.id,
            "number": po.number,
            "po_date": po.po_date.isoformat() if po.po_date else None,
            "needed_date": po.needed_date.isoformat() if po.needed_date else None,
            "vendor_name": po.vendor_name,
            "total": float(po.total or 0),
            "status": po.status.value if hasattr(po.status, "value") else str(po.status),
        }
        for po in po_rows
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
    if pending_count:
        warnings.append(f"{pending_count} transaksi belum diverifikasi")
    if unlinked_out_count:
        warnings.append(f"{unlinked_out_count} pengeluaran masih punya sisa belum dialokasi (Rp{unlinked_out_total:,.0f})".replace(",", "."))

    # Audit 2026-05-23: marketing_aktual reuse expense_breakdown supaya
    # konsisten dgn Biaya Aktual (sama-sama ACTIVE statuses, bukan
    # VERIFIED-only seperti sebelumnya).
    finance = _project_finance_breakdown(
        nilai_kontrak=Decimal(p.project_value or 0),
        ppn_pct=Decimal(p.tax_ppn_pct or 0),
        pph_pct=Decimal(p.tax_pph_pct or 0),
        marketing_pct=Decimal(p.marketing_pct or 0),
        biaya_aktual=Decimal(totals["total_out"] or 0),
        biaya_proyeksi=Decimal(p.budget_amount or 0),
        marketing_aktual=expense_breakdown["marketing"],
        profit_share_actual=expense_breakdown["profit_share"],
    )
    # Tambah breakdown komposisi biaya utk transparansi distribusi
    # (denda + bagi hasil + operating + marketing).
    finance["expense_breakdown"] = {
        "marketing": float(expense_breakdown["marketing"]),
        "penalty": float(expense_breakdown["penalty"]),
        "profit_share": float(expense_breakdown["profit_share"]),
        "operating": float(expense_breakdown["operating"]),
        "total": float(expense_breakdown["total"]),
    }

    return {
        "project": {
            "id": p.id, "code": p.code, "name": p.name, "status": p.status.value,
            "company_id": p.company_id, "currency": p.currency,
        },
        "totals": {
            "in": float(totals["total_in"]),
            "out": float(totals["total_out"]),
            "balance": float(totals["balance"]),
            "pending_in": float(totals["pending_in"]),
            "pending_out": float(totals["pending_out"]),
        },
        "budget": {
            "amount": float(bs["budget_amount"]),
            "spent": float(bs["spent"]),
            "spent_total": float(bs.get("spent_total", bs["spent"])),
            "marketing_actual": float(bs.get("marketing_actual", 0)),
            "remaining": float(bs["remaining"]),
            "usage_pct": float(bs["usage_pct"]),
            "status": bs["status"],
        },
        "finance": finance,
        "health": hs,
        "expense_to_income_ratio_pct": ratio,
        "invoice_open_total": inv_open,
        "invoice_paid_total": inv_paid,
        # AR/AP aging breakdown: bucket 0-30 / 31-60 / 61-90 / >90 hari
        # AR = piutang (invoice OUT yg blm dibayar klien)
        # AP = hutang (invoice IN yg blm dibayar ke vendor)
        "ap_aging": ap_aging,
        "ar_aging": ar_aging,
        "pending_count": int(pending_count),
        "pending_total": float(pending_total),
        "unlinked_out_count": int(unlinked_out_count),
        "unlinked_out_total": float(unlinked_out_total),
        "by_category": by_category,
        "monthly_cashflow": monthly,
        "recent_transactions": recent,
        "invoices": invoices_list,
        "purchase_orders": pos_list,
        "warnings": warnings,
    }
