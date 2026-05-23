"""Endpoint reports: budget + cash_advances + audit.

Audit 2026-05-22 #M2: split dari reports.py.
"""
from datetime import date as date_type, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import (
    ensure_project_access,
    get_current_user,
    user_project_ids,
)
from app.db.session import get_db
from app.models.models import (
    AuditLog,
    CashAdvanceSettlement,
    CashAdvanceSettlementItem,
    Category,
    Company,
    Invoice,
    InvoiceStatus,
    InvoiceType,
    POStatus,
    Project,
    ProjectKind,
    PurchaseOrder,
    Transaction,
    TransactionItem,
    TxnKind,
    TxnStatus,
    TxnType,
    User,
    UserRole,
    VendorClient,
)
from app.services.non_project import transaction_eligibility_clause

from ._helpers import (
    _accessible_pids,
    _fmt_date,
    _fmt_datetime,
    _fmt_idr,
    _output,
    _project_map_for_ids,
    _resolve_company,
)

router = APIRouter()


# ---------- Budget control ----------
@router.get("/budget")
async def report_budget(
    format: str = Query("pdf", pattern="^(pdf|xlsx)$"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    ids = await user_project_ids(db, user)
    # Audit 2026-05-23: budget control hanya utk proyek konstruksi
    # (REGULAR). NON_PROJECT = side ledger tanpa budget kontrak --
    # tampil sbg "Tanpa Budget" hanya bikin noise.
    stmt = select(Project).where(
        Project.deleted_at.is_(None),
        Project.kind != ProjectKind.NON_PROJECT.value,
    )
    if ids is not None:
        if not ids:
            raise HTTPException(403, "no_project_access")
        stmt = stmt.where(Project.id.in_(ids))
    projects = (await db.execute(stmt)).scalars().all()
    co_ids = {p.company_id for p in projects if p.company_id}
    company_map: dict[int, Company] = {}
    if co_ids:
        company_map = {c.id: c for c in
                       (await db.execute(select(Company).where(Company.id.in_(co_ids))))
                       .scalars().all()}

    headers = ["Kode", "Proyek", "Perusahaan", "Budget (Rp)", "Realisasi (Rp)",
               "Committed PO (Rp)", "Pakai", "Sisa Real (Rp)", "Status"]
    cols = [
        {"align": "center", "width": "62px"},
        {"align": "left",   "width": "18%"},
        {"align": "left",   "width": "16%"},
        {"align": "num",    "width": "92px"},
        {"align": "num",    "width": "92px"},
        {"align": "num",    "width": "95px"},
        {"align": "num",    "width": "52px"},
        {"align": "num",    "width": "92px"},
        {"align": "center", "width": "82px"},
    ]
    rows: list[list] = []
    total_budget = Decimal("0")
    total_spent = Decimal("0")
    total_committed = Decimal("0")
    n_aman = n_warn = n_over = n_no = 0
    # Bulk-load realisasi (SUM amount) per proyek -- ganti 1 query per project.
    proj_ids_list = [p.id for p in projects]
    spent_map: dict[int, Decimal] = {}
    committed_map: dict[int, Decimal] = {}
    if proj_ids_list:
        spent_q = (
            select(
                Transaction.project_id,
                func.coalesce(func.sum(Transaction.amount), 0),
            )
            .where(
                Transaction.project_id.in_(proj_ids_list),
                Transaction.type == TxnType.OUT,
                Transaction.status == TxnStatus.VERIFIED,
                Transaction.deleted_at.is_(None),
            )
            .group_by(Transaction.project_id)
        )
        spent_map = {
            pid: Decimal(amt or 0)
            for pid, amt in (await db.execute(spent_q)).all()
        }
        # Audit 2026-05-23: Committed PO = PO terbit/disetujui tapi blm
        # ter-realisasi sbg tx OUT. Mencegah overstate sisa anggaran.
        #   committed_per_po = po.total - SUM(tx.amount WHERE tx.po_id=po, VERIFIED)
        # SUM committed_per_po per proyek = total committed.
        # PO yg sudah CANCELLED/FULFILLED tdk dianggap committed lg.
        po_rows = (await db.execute(
            select(PurchaseOrder.id, PurchaseOrder.project_id, PurchaseOrder.total)
            .where(
                PurchaseOrder.project_id.in_(proj_ids_list),
                PurchaseOrder.deleted_at.is_(None),
                PurchaseOrder.status.in_([
                    POStatus.ISSUED, POStatus.APPROVED, POStatus.PARTIALLY_FULFILLED,
                ]),
            )
        )).all()
        # paid-per-po: tx VERIFIED yg link ke po
        po_ids = [pid for pid, _proj, _tot in po_rows]
        paid_per_po: dict[int, Decimal] = {}
        if po_ids:
            paid_q = (
                select(
                    Transaction.purchase_order_id,
                    func.coalesce(func.sum(Transaction.amount), 0),
                )
                .where(
                    Transaction.purchase_order_id.in_(po_ids),
                    Transaction.status == TxnStatus.VERIFIED,
                    Transaction.deleted_at.is_(None),
                )
                .group_by(Transaction.purchase_order_id)
            )
            paid_per_po = {
                pid: Decimal(amt or 0)
                for pid, amt in (await db.execute(paid_q)).all()
            }
        for po_id, proj_id_p, po_total in po_rows:
            outstanding_po = max(
                Decimal("0"),
                Decimal(po_total or 0) - paid_per_po.get(po_id, Decimal("0")),
            )
            committed_map[proj_id_p] = committed_map.get(proj_id_p, Decimal("0")) + outstanding_po

    for p in projects:
        spent = spent_map.get(p.id, Decimal("0"))
        committed = committed_map.get(p.id, Decimal("0"))
        budget = Decimal(p.budget_amount or 0)
        # Pemakaian real = spent + committed (krn committed pasti
        # ter-realisasi kalau PO diselesaikan).
        usage_real = spent + committed
        pct = (usage_real / budget * 100) if budget > 0 else Decimal("0")
        remaining = budget - usage_real
        total_budget += budget
        total_spent += spent
        total_committed += committed
        if budget <= 0:
            status = "Tanpa Budget"; n_no += 1
        elif pct <= 80:
            status = "Aman"; n_aman += 1
        elif pct <= 100:
            status = "Waspada"; n_warn += 1
        else:
            status = "Overbudget"; n_over += 1
        rows.append([
            p.code, p.name,
            company_map.get(p.company_id).name if company_map.get(p.company_id) else "-",
            _fmt_idr(budget), _fmt_idr(spent), _fmt_idr(committed),
            f"{pct:.1f}%", _fmt_idr(remaining), status,
        ])
    overall_usage = total_spent + total_committed
    overall_pct = (overall_usage / total_budget * 100) if total_budget > 0 else Decimal("0")
    summary = [
        {"label": "Total Anggaran", "value": f"Rp {_fmt_idr(total_budget)}",
         "sub": f"{len(projects)} proyek"},
        {"label": "Realisasi (VERIFIED)", "value": f"Rp {_fmt_idr(total_spent)}",
         "sub": "tx OUT terverifikasi"},
        {"label": "Committed (PO Open)",
         "value": f"Rp {_fmt_idr(total_committed)}",
         "sub": "PO terbit/disetujui blm tertagih"},
        {"label": "Sisa Real", "value": f"Rp {_fmt_idr(total_budget - overall_usage)}",
         "sub": f"{overall_pct:.1f}% terpakai"},
        {"label": "Status Risiko", "value": f"{n_over} overbudget",
         "sub": f"{n_warn} waspada · {n_aman} aman · {n_no} tanpa budget"},
    ]
    scope_line = (
        f"Snapshot per {_fmt_date(datetime.now().date())} · "
        "Pemakaian = Realisasi (VERIFIED OUT) + Committed (PO Open)"
    )
    company = await _resolve_company(db, None)
    return await _output(
        format, title="Laporan Budget Control", headers=headers, rows=rows, cols=cols,
        filters={}, totals={}, company=company, printed_by=user.name, landscape=True,
        summary=summary, scope_line=scope_line,
        detail_label="Detail per Proyek",
        footer_row=[
            "TOTAL", "", "",
            _fmt_idr(total_budget), _fmt_idr(total_spent), _fmt_idr(total_committed),
            f"{overall_pct:.1f}%",
            _fmt_idr(total_budget - overall_usage), "",
        ],
        doc_no=f"BGT-{datetime.now().strftime('%Y%m%d%H%M')}",
    )




@router.get("/cash-advances")
async def report_cash_advances(
    format: str = Query("pdf", pattern="^(pdf|xlsx)$"),
    project_id: int | None = None,
    settlement_status: str | None = Query(
        None, pattern="^(SETTLED|OUTSTANDING)$",
        description="Filter status pertanggungjawaban",
    ),
    date_from: date_type | None = None,
    date_to: date_type | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    """Laporan Dana Operasional (CASH_ADVANCE).

    Kolom: Tanggal | Penerima | Proyek | Pengeluaran | Status Settle |
           Sudah Lapor | Sisa Outstanding
    Summary: total disbursed, outstanding total, age rata-rata, % settled.
    """
    from decimal import Decimal as _D
    ids = await user_project_ids(db, user)
    pids = _accessible_pids(ids, project_id)
    if pids is not None and not pids:
        raise HTTPException(403, "no_project_access")
    # Audit 2026-05-23: hormati NonProjectYearSetting.
    elig_clause = await transaction_eligibility_clause(db)
    stmt = (
        select(Transaction)
        .join(Project, Project.id == Transaction.project_id)
        .options(
            selectinload(Transaction.settlement).selectinload(
                CashAdvanceSettlement.items
            ),
        )
        .where(
            Transaction.deleted_at.is_(None),
            Transaction.kind == TxnKind.CASH_ADVANCE.value,
            elig_clause,
        )
    )
    if pids is not None:
        stmt = stmt.where(Transaction.project_id.in_(pids))
    if date_from:
        stmt = stmt.where(Transaction.tx_date >= date_from)
    if date_to:
        stmt = stmt.where(Transaction.tx_date <= date_to)
    res = await db.execute(stmt.order_by(Transaction.tx_date.desc()))
    txs = list(res.scalars().all())
    # Filter by settlement_status post-load (sederhana)
    if settlement_status == "SETTLED":
        txs = [t for t in txs if t.settlement is not None]
    elif settlement_status == "OUTSTANDING":
        txs = [t for t in txs if t.settlement is None]

    proj_ids = {t.project_id for t in txs}
    if project_id:
        proj_ids.add(project_id)
    proj_map = await _project_map_for_ids(db, proj_ids)
    user_ids = {t.recipient_user_id for t in txs if t.recipient_user_id}
    user_map: dict[int, User] = {}
    if user_ids:
        user_map = {
            u.id: u for u in (
                await db.execute(select(User).where(User.id.in_(user_ids)))
            ).scalars().all()
        }

    headers = [
        "Tanggal", "Penerima", "Proyek", "Pengeluaran",
        "Status", "Sudah Lapor", "Outstanding",
    ]
    cols = [
        {"align": "center", "width": "78px"},
        {"align": "left", "width": "20%"},
        {"align": "left"},
        {"align": "num", "width": "110px"},
        {"align": "center", "width": "82px"},
        {"align": "num", "width": "110px"},
        {"align": "num", "width": "110px"},
    ]
    rows: list[list] = []
    total_disbursed = _D("0")
    total_settled = _D("0")
    total_outstanding = _D("0")
    n_settled = 0
    today = datetime.now().date()
    # Audit 2026-05-23: tambah aging bucket utk outstanding cash advance
    # (industry-standard 0-30, 31-60, 61-90, >90).
    AGING_BUCKETS = ["0-30 hari", "31-60 hari", "61-90 hari", ">90 hari"]
    aging_out: dict[str, _D] = {b: _D("0") for b in AGING_BUCKETS}
    aging_count: dict[str, int] = {b: 0 for b in AGING_BUCKETS}
    age_days_sum = 0

    def _bucket_for(days: int) -> str:
        if days <= 30: return "0-30 hari"
        if days <= 60: return "31-60 hari"
        if days <= 90: return "61-90 hari"
        return ">90 hari"

    for t in txs:
        amt = _D(t.amount or 0)
        total_disbursed += amt
        recipient = t.recipient_name or (
            user_map.get(t.recipient_user_id).name
            if t.recipient_user_id and user_map.get(t.recipient_user_id)
            else "?"
        )
        sett = t.settlement
        if sett:
            n_settled += 1
            settled_amt = _D(sett.returned_to_kas or 0) + sum(
                (_D(i.amount) for i in (sett.items or [])), start=_D("0")
            )
            total_settled += settled_amt
            # Audit 2026-05-23: outstanding tdk boleh negatif. Kalau
            # settled > disbursed (top-up scenario yg sudah create tx
            # tambahan), outstanding = 0 -- artinya advance ini sudah
            # tertutup sepenuhnya. Sebelumnya bisa minus = misleading.
            outstanding = max(_D("0"), amt - settled_amt)
            status_str = "SETTLED"
        else:
            settled_amt = _D("0")
            outstanding = amt
            status_str = "OUTSTANDING"
            if t.tx_date:
                d = max(0, (today - t.tx_date).days)
                age_days_sum += d
                bucket = _bucket_for(d)
                aging_out[bucket] += outstanding
                aging_count[bucket] += 1
        total_outstanding += outstanding
        rows.append([
            _fmt_date(t.tx_date),
            recipient,
            proj_map.get(t.project_id).name if proj_map.get(t.project_id) else "-",
            _fmt_idr(amt),
            status_str,
            _fmt_idr(settled_amt),
            _fmt_idr(outstanding),
        ])
    n_outstanding = len(txs) - n_settled
    avg_age = (age_days_sum / n_outstanding) if n_outstanding else 0
    # Aging summary string utk card -- skip bucket kosong.
    aging_parts = []
    for b in AGING_BUCKETS:
        if aging_count[b] > 0:
            aging_parts.append(f"{b}: Rp {_fmt_idr(aging_out[b])} ({aging_count[b]})")
    aging_disp = " · ".join(aging_parts) if aging_parts else "—"
    summary = [
        {"label": "Total Disbursed", "value": f"Rp {_fmt_idr(total_disbursed)}",
         "sub": f"{len(txs)} tx"},
        {"label": "Sudah Settled", "value": f"Rp {_fmt_idr(total_settled)}",
         "sub": f"{n_settled} / {len(txs)} tx"},
        {"label": "Outstanding", "value": f"Rp {_fmt_idr(total_outstanding)}",
         "sub": f"{n_outstanding} blm lapor"},
        {"label": "Avg Age Outstanding", "value": f"{avg_age:.0f} hari",
         "sub": "rata-rata umur"},
        {"label": "Aging Outstanding", "value": "lihat detail",
         "sub": aging_disp},
    ]
    proj_label = (proj_map.get(project_id).name
                  if project_id and proj_map.get(project_id) else "Semua proyek")
    period_label = (
        f"{_fmt_date(date_from) if date_from else 'awal'} s/d "
        f"{_fmt_date(date_to) if date_to else 'sekarang'}"
    )
    scope_line = (
        f"Periode {period_label} · {proj_label} · "
        f"{settlement_status or 'semua status'}"
    )
    filters = {
        "Periode": period_label,
        "Proyek": proj_label,
        "Status Settle": settlement_status or "Semua",
    }
    footer_row = [
        "TOTAL", "", "", _fmt_idr(total_disbursed),
        "", _fmt_idr(total_settled), _fmt_idr(total_outstanding),
    ]
    company = await _resolve_company(db, project_id)
    return await _output(
        format, title="Laporan Dana Operasional",
        headers=headers, rows=rows, cols=cols,
        filters=filters, totals={}, company=company,
        printed_by=user.name, landscape=True,
        summary=summary, scope_line=scope_line,
        detail_label="Detail Dana Operasional", footer_row=footer_row,
        doc_no=f"DOPS-{datetime.now().strftime('%Y%m%d%H%M')}",
    )


# ============================================================
# Direct Expense (Beban Langsung) report
# ============================================================


# ---------- Audit log ----------
@router.get("/audit-logs")
async def report_audit(
    format: str = Query("pdf", pattern="^(pdf|xlsx)$"),
    entity: str | None = None,
    user_id: int | None = None,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_user),
) -> Response:
    if admin.role not in (UserRole.SUPERADMIN, UserRole.CENTRAL_ADMIN):
        raise HTTPException(403, "superadmin_only")
    stmt = select(AuditLog)
    if entity:
        stmt = stmt.where(AuditLog.entity == entity)
    if user_id:
        stmt = stmt.where(AuditLog.user_id == user_id)
    if date_from:
        stmt = stmt.where(AuditLog.created_at >= date_from)
    if date_to:
        stmt = stmt.where(AuditLog.created_at <= date_to)
    stmt = stmt.order_by(AuditLog.id.desc()).limit(2000)
    logs = (await db.execute(stmt)).scalars().all()

    user_ids = {l.user_id for l in logs if l.user_id}
    if user_id:
        user_ids.add(user_id)
    user_map: dict[int, User] = {}
    if user_ids:
        user_map = {u.id: u for u in
                    (await db.execute(select(User).where(User.id.in_(user_ids))))
                    .scalars().all()}
    headers = ["Waktu", "User", "Entity", "ID", "Aksi", "Catatan"]
    cols = [
        {"align": "center", "width": "115px"},
        {"align": "left",   "width": "18%"},
        {"align": "left",   "width": "13%"},
        {"align": "center", "width": "55px"},
        {"align": "center", "width": "78px"},
        {"align": "left"},
    ]
    rows: list[list] = []
    actions_count: dict[str, int] = {}
    for l in logs:
        actions_count[l.action.value] = actions_count.get(l.action.value, 0) + 1
        rows.append([
            _fmt_datetime(l.created_at),
            user_map.get(l.user_id).name if user_map.get(l.user_id) else "-",
            l.entity, str(l.entity_id), l.action.value, l.note or "-",
        ])
    summary = [
        {"label": "Total Entri", "value": str(len(rows)),
         "sub": "max 2.000 entri terbaru"},
        {"label": "User Unik", "value": str(len({l.user_id for l in logs})), "sub": ""},
        {"label": "Entity Unik", "value": str(len({l.entity for l in logs})), "sub": ""},
        {"label": "Aksi Terbanyak",
         "value": (max(actions_count, key=actions_count.get) if actions_count else "—"),
         "sub": (f"{max(actions_count.values())}× tercatat" if actions_count else "")},
    ]
    period_label = f"{_fmt_date(date_from) if date_from else 'awal'} s/d {_fmt_date(date_to) if date_to else 'sekarang'}"
    user_label = user_map.get(user_id).name if user_id and user_map.get(user_id) else "semua user"
    entity_label = entity or "semua entity"
    scope_line = f"Periode {period_label} · {entity_label} · {user_label}"
    company = await _resolve_company(db, None)
    return await _output(
        format, title="Laporan Audit Log", headers=headers, rows=rows, cols=cols,
        filters={
            "Periode": period_label,
            "Entity": entity or "Semua",
            "User": user_map.get(user_id).name if user_id and user_map.get(user_id) else "Semua",
        },
        totals={}, company=company, printed_by=admin.name,
        summary=summary, scope_line=scope_line,
        detail_label="Riwayat Aktivitas",
        doc_no=f"AUD-{datetime.now().strftime('%Y%m%d%H%M')}",
    )



# ============================================================
# Cash Advance (Dana Operasional) report
# ============================================================
