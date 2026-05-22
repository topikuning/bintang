"""Endpoint reports: invoices + debts + purchase_orders.

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


# ---------- Invoices ----------
@router.get("/invoices")
async def report_invoices(
    format: str = Query("pdf", pattern="^(pdf|xlsx)$"),
    type: InvoiceType | None = None,
    project_id: int | None = None,
    status: InvoiceStatus | None = None,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    ids = await user_project_ids(db, user)
    pids = _accessible_pids(ids, project_id)
    if pids is not None and not pids:
        raise HTTPException(403, "no_project_access")

    stmt = select(Invoice).where(Invoice.deleted_at.is_(None))
    if type:
        stmt = stmt.where(Invoice.type == type)
    if pids is not None:
        stmt = stmt.where(Invoice.project_id.in_(pids))
    if status:
        stmt = stmt.where(Invoice.status == status)
    if date_from:
        stmt = stmt.where(Invoice.invoice_date >= date_from)
    if date_to:
        stmt = stmt.where(Invoice.invoice_date <= date_to)
    stmt = stmt.order_by(Invoice.invoice_date.asc())
    rows_inv = (await db.execute(stmt)).scalars().all()

    proj_ids = {inv.project_id for inv in rows_inv}
    if project_id:
        proj_ids.add(project_id)
    proj_map = await _project_map_for_ids(db, proj_ids)
    headers = ["No Invoice", "Tanggal", "Jatuh Tempo", "Proyek", "Pihak", "Total (Rp)", "Status"]
    cols = [
        {"align": "left",   "width": "120px"},
        {"align": "center", "width": "78px"},
        {"align": "center", "width": "78px"},
        {"align": "left",   "width": "16%"},
        {"align": "left"},
        {"align": "num",    "width": "100px"},
        {"align": "center", "width": "82px"},
    ]
    rows: list[list] = []
    total = Decimal("0")
    n_paid = n_open = 0
    for inv in rows_inv:
        total += Decimal(inv.total or 0)
        if inv.status == InvoiceStatus.PAID:
            n_paid += 1
        elif inv.status in (InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE):
            n_open += 1
        rows.append([
            inv.number, _fmt_date(inv.invoice_date), _fmt_date(inv.due_date),
            proj_map.get(inv.project_id).name if proj_map.get(inv.project_id) else "-",
            inv.party_name or "-", _fmt_idr(inv.total), inv.status.value,
        ])
    arah = (
        "Hutang" if type == InvoiceType.IN else
        "Piutang" if type == InvoiceType.OUT else
        "Invoice"
    )
    summary = [
        {"label": f"Total Nilai {arah}", "value": f"Rp {_fmt_idr(total)}",
         "sub": f"{len(rows_inv)} invoice"},
        {"label": "Sudah Lunas", "value": str(n_paid),
         "sub": f"{(n_paid/len(rows_inv)*100 if rows_inv else 0):.0f}% dari total"},
        {"label": "Belum Tertutup", "value": str(n_open), "sub": "Issued / Partial / Overdue"},
        {"label": "Periode", "value": _fmt_date(date_to or date_from) if (date_to or date_from) else "—",
         "sub": f"sejak {_fmt_date(date_from)}" if date_from else "tanpa batas"},
    ]
    proj_label = (proj_map.get(project_id).name
                  if project_id and proj_map.get(project_id) else "Semua proyek")
    period_label = f"{_fmt_date(date_from) if date_from else 'awal'} s/d {_fmt_date(date_to) if date_to else 'sekarang'}"
    status_label = status.value if status else "semua status"
    scope_line = f"Periode {period_label} · {proj_label} · {arah} · {status_label}"
    filters = {
        "Tipe Invoice": f"{type.value} ({arah})" if type else "Semua (Hutang + Piutang)",
        "Periode": period_label,
        "Proyek": proj_label,
        "Status": status.value if status else "Semua",
    }
    footer_row = ["TOTAL", "", "", "", "", _fmt_idr(total), ""]
    company = await _resolve_company(db, project_id)
    if type == InvoiceType.IN:
        title = "Laporan Invoice Masuk (Hutang)"
    elif type == InvoiceType.OUT:
        title = "Laporan Invoice Keluar (Piutang)"
    else:
        title = "Laporan Invoice (Hutang + Piutang)"
    doc_suffix = type.value if type else "ALL"
    return await _output(
        format, title=title, headers=headers, rows=rows, cols=cols,
        filters=filters, totals={}, company=company,
        printed_by=user.name, landscape=True,
        summary=summary, scope_line=scope_line,
        detail_label="Daftar Invoice", footer_row=footer_row,
        doc_no=f"INV-{doc_suffix}-{datetime.now().strftime('%Y%m%d%H%M')}",
    )




# ---------- Hutang/Piutang (open invoices) ----------
@router.get("/debts")
async def report_debts(
    format: str = Query("pdf", pattern="^(pdf|xlsx)$"),
    project_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    ids = await user_project_ids(db, user)
    pids = _accessible_pids(ids, project_id)
    if pids is not None and not pids:
        raise HTTPException(403, "no_project_access")

    stmt = select(Invoice).where(
        Invoice.deleted_at.is_(None),
        Invoice.status.in_([InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE]),
    )
    if pids is not None:
        stmt = stmt.where(Invoice.project_id.in_(pids))
    stmt = stmt.order_by(Invoice.due_date.asc().nulls_last())
    invs = (await db.execute(stmt)).scalars().all()

    proj_ids = {inv.project_id for inv in invs}
    if project_id:
        proj_ids.add(project_id)
    proj_map = await _project_map_for_ids(db, proj_ids)
    headers = ["No Invoice", "Tipe", "Jatuh Tempo", "Proyek", "Pihak",
               "Total (Rp)", "Dibayar (Rp)", "Sisa (Rp)", "Status"]
    cols = [
        {"align": "left",   "width": "110px"},
        {"align": "center", "width": "65px"},
        {"align": "center", "width": "78px"},
        {"align": "left",   "width": "13%"},
        {"align": "left"},
        {"align": "num",    "width": "85px"},
        {"align": "num",    "width": "85px"},
        {"align": "num",    "width": "85px"},
        {"align": "center", "width": "82px"},
    ]
    rows: list[list] = []
    sum_total_in = sum_total_out = Decimal("0")
    sum_paid_in = sum_paid_out = Decimal("0")
    sum_remaining_in = sum_remaining_out = Decimal("0")
    # Bulk paid_amount per invoice -- SUM Transaction.amount GROUP BY invoice_id
    # menghindari N query (1 per invoice) di loop bawah.
    inv_ids = [inv.id for inv in invs]
    paid_map_debts: dict[int, Decimal] = {}
    if inv_ids:
        bulk_q = (
            select(
                Transaction.invoice_id,
                func.coalesce(func.sum(Transaction.amount), 0),
            )
            .where(
                Transaction.invoice_id.in_(inv_ids),
                Transaction.status == TxnStatus.VERIFIED,
                Transaction.deleted_at.is_(None),
            )
            .group_by(Transaction.invoice_id)
        )
        paid_map_debts = {
            iid: Decimal(amt or 0)
            for iid, amt in (await db.execute(bulk_q)).all()
        }
    for inv in invs:
        paid = paid_map_debts.get(inv.id, Decimal("0"))
        total_inv = Decimal(inv.total or 0)
        remaining = max(total_inv - paid, Decimal("0"))
        if inv.type == InvoiceType.IN:
            sum_total_in += total_inv
            sum_paid_in += paid
            sum_remaining_in += remaining
        else:
            sum_total_out += total_inv
            sum_paid_out += paid
            sum_remaining_out += remaining
        rows.append([
            inv.number, "Hutang" if inv.type == InvoiceType.IN else "Piutang",
            _fmt_date(inv.due_date),
            proj_map.get(inv.project_id).name if proj_map.get(inv.project_id) else "-",
            inv.party_name or "-",
            _fmt_idr(inv.total), _fmt_idr(paid), _fmt_idr(remaining), inv.status.value,
        ])
    summary = [
        {"label": "Sisa Hutang", "value": f"Rp {_fmt_idr(sum_remaining_in)}",
         "sub": f"dari Rp {_fmt_idr(sum_total_in)} ({len([i for i in invs if i.type == InvoiceType.IN])} invoice)"},
        {"label": "Sisa Piutang", "value": f"Rp {_fmt_idr(sum_remaining_out)}",
         "sub": f"dari Rp {_fmt_idr(sum_total_out)} ({len([i for i in invs if i.type == InvoiceType.OUT])} invoice)"},
        {"label": "Net Position", "value": f"Rp {_fmt_idr(sum_remaining_out - sum_remaining_in)}",
         "sub": "Piutang minus Hutang"},
        {"label": "Total Invoice Aktif", "value": str(len(invs)),
         "sub": "Issued / Partial / Overdue"},
    ]
    proj_label = (proj_map.get(project_id).name
                  if project_id and proj_map.get(project_id) else "Semua proyek")
    scope_line = f"{proj_label} · Per tanggal {_fmt_date(datetime.now().date())} · Status aktif (Issued, Partial, Overdue)"
    footer_row = [
        "TOTAL", "", "", "", "",
        _fmt_idr(sum_total_in + sum_total_out),
        _fmt_idr(sum_paid_in + sum_paid_out),
        _fmt_idr(sum_remaining_in + sum_remaining_out),
        "",
    ]
    company = await _resolve_company(db, project_id)
    return await _output(
        format, title="Laporan Hutang & Piutang", headers=headers, rows=rows, cols=cols,
        filters={"Proyek": proj_label, "Status": "Aktif (Issued, Partial, Overdue)"},
        totals={}, company=company, printed_by=user.name, landscape=True,
        summary=summary, scope_line=scope_line,
        detail_label="Daftar Invoice Aktif", footer_row=footer_row,
        doc_no=f"AGE-{datetime.now().strftime('%Y%m%d%H%M')}",
    )




# ---------- Purchase Orders ----------
@router.get("/purchase-orders")
async def report_pos(
    format: str = Query("pdf", pattern="^(pdf|xlsx)$"),
    project_id: int | None = None,
    status: POStatus | None = None,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    ids = await user_project_ids(db, user)
    pids = _accessible_pids(ids, project_id)
    if pids is not None and not pids:
        raise HTTPException(403, "no_project_access")
    stmt = select(PurchaseOrder).where(PurchaseOrder.deleted_at.is_(None))
    if pids is not None:
        stmt = stmt.where(PurchaseOrder.project_id.in_(pids))
    if status:
        stmt = stmt.where(PurchaseOrder.status == status)
    if date_from:
        stmt = stmt.where(PurchaseOrder.po_date >= date_from)
    if date_to:
        stmt = stmt.where(PurchaseOrder.po_date <= date_to)
    stmt = stmt.order_by(PurchaseOrder.po_date.asc())
    pos = (await db.execute(stmt)).scalars().all()

    proj_ids = {po.project_id for po in pos}
    if project_id:
        proj_ids.add(project_id)
    proj_map = await _project_map_for_ids(db, proj_ids)
    headers = ["No PO", "Tanggal", "Proyek", "Vendor", "Total (Rp)", "Status"]
    cols = [
        {"align": "left",   "width": "125px"},
        {"align": "center", "width": "78px"},
        {"align": "left",   "width": "20%"},
        {"align": "left"},
        {"align": "num",    "width": "105px"},
        {"align": "center", "width": "90px"},
    ]
    rows: list[list] = []
    total = Decimal("0")
    n_approved = n_open = 0
    for po in pos:
        total += Decimal(po.total or 0)
        if po.status == POStatus.APPROVED:
            n_approved += 1
        elif po.status in (POStatus.ISSUED, POStatus.DRAFT):
            n_open += 1
        rows.append([
            po.number, _fmt_date(po.po_date),
            proj_map.get(po.project_id).name if proj_map.get(po.project_id) else "-",
            po.vendor_name or "-", _fmt_idr(po.total), po.status.value,
        ])
    summary = [
        {"label": "Total Nilai PO", "value": f"Rp {_fmt_idr(total)}",
         "sub": f"{len(pos)} dokumen"},
        {"label": "Disetujui", "value": str(n_approved),
         "sub": f"{(n_approved/len(pos)*100 if pos else 0):.0f}% dari total"},
        {"label": "Belum Diproses", "value": str(n_open), "sub": "Draft / Issued"},
        {"label": "Periode", "value": _fmt_date(date_to or date_from) if (date_to or date_from) else "—",
         "sub": f"sejak {_fmt_date(date_from)}" if date_from else "tanpa batas"},
    ]
    proj_label = (proj_map.get(project_id).name
                  if project_id and proj_map.get(project_id) else "Semua proyek")
    period_label = f"{_fmt_date(date_from) if date_from else 'awal'} s/d {_fmt_date(date_to) if date_to else 'sekarang'}"
    status_label = status.value if status else "semua status"
    scope_line = f"Periode {period_label} · {proj_label} · {status_label}"
    company = await _resolve_company(db, project_id)
    return await _output(
        format, title="Laporan Purchase Order", headers=headers, rows=rows, cols=cols,
        filters={
            "Periode": period_label,
            "Proyek": proj_label,
            "Status": status.value if status else "Semua",
        },
        totals={}, company=company, printed_by=user.name, landscape=True,
        summary=summary, scope_line=scope_line,
        detail_label="Daftar Purchase Order",
        footer_row=["TOTAL", "", "", "", _fmt_idr(total), ""],
        doc_no=f"PO-RPT-{datetime.now().strftime('%Y%m%d%H%M')}",
    )


