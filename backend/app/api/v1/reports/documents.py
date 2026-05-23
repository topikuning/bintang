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
    include_drafts: bool = Query(
        False,
        description="Default False: exclude DRAFT/CANCELLED. True utk include semua status.",
    ),
    date_from: date_type | None = None,
    date_to: date_type | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    """Laporan invoice.

    Audit 2026-05-23 perbaikan finance reporting:
    - Default filter: DRAFT & CANCELLED di-exclude (toggle include_drafts).
    - Type=None (gabungan): TIDAK lagi total H+P agregat (Hutang dan
      Piutang adalah akun neraca berlawanan, mustahil dijumlah). Tampilkan
      pisah total Hutang & total Piutang di summary, tabel tampilkan
      kolom "Tipe", footer tampilkan subtotal per-arah.
    """
    ids = await user_project_ids(db, user)
    pids = _accessible_pids(ids, project_id)
    if pids is not None and not pids:
        raise HTTPException(403, "no_project_access")

    stmt = select(Invoice).where(Invoice.deleted_at.is_(None))
    if type:
        stmt = stmt.where(Invoice.type == type)
    if pids is not None:
        stmt = stmt.where(Invoice.project_id.in_(pids))
    if status is not None:
        stmt = stmt.where(Invoice.status == status)
    elif not include_drafts:
        # Exclude DRAFT (belum issued) & CANCELLED (bukan financial obligation).
        stmt = stmt.where(
            Invoice.status.in_([
                InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID,
                InvoiceStatus.OVERDUE, InvoiceStatus.PAID,
            ])
        )
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

    period_label = f"{_fmt_date(date_from) if date_from else 'awal'} s/d {_fmt_date(date_to) if date_to else 'sekarang'}"
    proj_label = (proj_map.get(project_id).name
                  if project_id and proj_map.get(project_id) else "Semua proyek")
    status_disp = status.value if status else (
        "Semua aktif (excl. DRAFT/CANCELLED)" if not include_drafts else "Semua"
    )
    company = await _resolve_company(db, project_id)
    rows: list[list] = []

    if type is None:
        # ----- Mode gabungan: pisah Hutang vs Piutang, JANGAN agregat -----
        headers = ["No Invoice", "Tipe", "Tanggal", "Jatuh Tempo", "Proyek",
                   "Pihak", "Total (Rp)", "Status"]
        cols = [
            {"align": "left",   "width": "115px"},
            {"align": "center", "width": "62px"},
            {"align": "center", "width": "78px"},
            {"align": "center", "width": "78px"},
            {"align": "left",   "width": "14%"},
            {"align": "left"},
            {"align": "num",    "width": "100px"},
            {"align": "center", "width": "82px"},
        ]
        total_in = total_out = Decimal("0")
        n_in = n_out = 0
        n_paid_in = n_paid_out = n_open_in = n_open_out = 0
        for inv in rows_inv:
            tval = Decimal(inv.total or 0)
            if inv.type == InvoiceType.IN:
                total_in += tval; n_in += 1
                if inv.status == InvoiceStatus.PAID: n_paid_in += 1
                elif inv.status in (InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE):
                    n_open_in += 1
                tipe_disp = "Hutang"
            else:
                total_out += tval; n_out += 1
                if inv.status == InvoiceStatus.PAID: n_paid_out += 1
                elif inv.status in (InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE):
                    n_open_out += 1
                tipe_disp = "Piutang"
            rows.append([
                inv.number, tipe_disp,
                _fmt_date(inv.invoice_date), _fmt_date(inv.due_date),
                proj_map.get(inv.project_id).name if proj_map.get(inv.project_id) else "-",
                inv.party_name or "-", _fmt_idr(tval), inv.status.value,
            ])
        summary = [
            {"label": "Total Hutang (Invoice Masuk)",
             "value": f"Rp {_fmt_idr(total_in)}",
             "sub": f"{n_in} invoice · {n_paid_in} lunas · {n_open_in} aktif"},
            {"label": "Total Piutang (Invoice Keluar)",
             "value": f"Rp {_fmt_idr(total_out)}",
             "sub": f"{n_out} invoice · {n_paid_out} lunas · {n_open_out} aktif"},
            {"label": "Periode",
             "value": _fmt_date(date_to or date_from) if (date_to or date_from) else "—",
             "sub": f"sejak {_fmt_date(date_from)}" if date_from else "tanpa batas"},
            {"label": "Status", "value": status_disp, "sub": ""},
        ]
        # Footer: 2 subtotal terpisah; TIDAK ada single TOTAL agregat.
        footer_row = [
            "SUBTOTAL Hutang+Piutang", "", "", "", "", "",
            f"{_fmt_idr(total_in)} | {_fmt_idr(total_out)}", "",
        ]
        title = "Laporan Invoice (Hutang & Piutang)"
        scope_line = (
            f"Periode {period_label} · {proj_label} · Pisah Hutang vs Piutang · "
            f"{status_disp}"
        )
    else:
        # ----- Mode single-tipe: H atau P saja, total bermakna -----
        arah = "Hutang" if type == InvoiceType.IN else "Piutang"
        headers = ["No Invoice", "Tanggal", "Jatuh Tempo", "Proyek", "Pihak",
                   "Total (Rp)", "Status"]
        cols = [
            {"align": "left",   "width": "120px"},
            {"align": "center", "width": "78px"},
            {"align": "center", "width": "78px"},
            {"align": "left",   "width": "16%"},
            {"align": "left"},
            {"align": "num",    "width": "100px"},
            {"align": "center", "width": "82px"},
        ]
        total = Decimal("0")
        n_paid = n_open = 0
        for inv in rows_inv:
            total += Decimal(inv.total or 0)
            if inv.status == InvoiceStatus.PAID: n_paid += 1
            elif inv.status in (InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE):
                n_open += 1
            rows.append([
                inv.number, _fmt_date(inv.invoice_date), _fmt_date(inv.due_date),
                proj_map.get(inv.project_id).name if proj_map.get(inv.project_id) else "-",
                inv.party_name or "-", _fmt_idr(inv.total), inv.status.value,
            ])
        summary = [
            {"label": f"Total Nilai {arah}", "value": f"Rp {_fmt_idr(total)}",
             "sub": f"{len(rows_inv)} invoice"},
            {"label": "Sudah Lunas", "value": str(n_paid),
             "sub": f"{(n_paid/len(rows_inv)*100 if rows_inv else 0):.0f}% dari total"},
            {"label": "Belum Tertutup", "value": str(n_open),
             "sub": "Issued / Partial / Overdue"},
            {"label": "Periode",
             "value": _fmt_date(date_to or date_from) if (date_to or date_from) else "—",
             "sub": f"sejak {_fmt_date(date_from)}" if date_from else "tanpa batas"},
        ]
        footer_row = ["TOTAL", "", "", "", "", _fmt_idr(total), ""]
        title = f"Laporan Invoice {arah}"
        scope_line = f"Periode {period_label} · {proj_label} · {arah} · {status_disp}"

    filters = {
        "Tipe Invoice": f"{type.value}" if type else "Hutang + Piutang (pisah)",
        "Periode": period_label,
        "Proyek": proj_label,
        "Status": status_disp,
    }
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
    as_of: date_type | None = Query(
        None, description="As-of date untuk aging. Default: hari ini.",
    ),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    """Laporan Hutang & Piutang dgn aging bucket.

    Audit 2026-05-23 perbaikan finance reporting:
    - HAPUS footer "TOTAL = Hutang + Piutang" -- penjumlahan dua akun
      neraca berlawanan tdk bermakna secara akuntansi.
    - Tambah aging bucket 0-30, 31-60, 61-90, >90 hari per tipe
      (industry-standard AP/AR aging).
    - Tambah kolom "Umur (hari)" di tabel.
    - Param `as_of` (default today) supaya bisa snapshot tanggal apapun.
    """
    ids = await user_project_ids(db, user)
    pids = _accessible_pids(ids, project_id)
    if pids is not None and not pids:
        raise HTTPException(403, "no_project_access")

    today = as_of or datetime.now().date()

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
    headers = ["No Invoice", "Tipe", "Jatuh Tempo", "Umur (hari)", "Proyek", "Pihak",
               "Total (Rp)", "Dibayar (Rp)", "Sisa (Rp)", "Status"]
    cols = [
        {"align": "left",   "width": "100px"},
        {"align": "center", "width": "62px"},
        {"align": "center", "width": "74px"},
        {"align": "center", "width": "64px"},
        {"align": "left",   "width": "12%"},
        {"align": "left"},
        {"align": "num",    "width": "78px"},
        {"align": "num",    "width": "78px"},
        {"align": "num",    "width": "78px"},
        {"align": "center", "width": "78px"},
    ]
    rows: list[list] = []
    sum_total_in = sum_total_out = Decimal("0")
    sum_paid_in = sum_paid_out = Decimal("0")
    sum_remaining_in = sum_remaining_out = Decimal("0")

    # Aging bucket: keyed by tipe ("IN"/"OUT"), bucket label -> Decimal sisa
    AGING_BUCKETS = ["Belum Jatuh Tempo", "0-30 hari", "31-60 hari", "61-90 hari", ">90 hari"]
    def _bucket(days_overdue: int | None) -> str:
        if days_overdue is None or days_overdue < 0:
            return "Belum Jatuh Tempo"
        if days_overdue <= 30: return "0-30 hari"
        if days_overdue <= 60: return "31-60 hari"
        if days_overdue <= 90: return "61-90 hari"
        return ">90 hari"
    aging_in: dict[str, Decimal] = {b: Decimal("0") for b in AGING_BUCKETS}
    aging_out: dict[str, Decimal] = {b: Decimal("0") for b in AGING_BUCKETS}

    # Bulk paid_amount per invoice -- SUM Transaction.amount GROUP BY invoice_id
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
        days_overdue = (today - inv.due_date).days if inv.due_date else None
        umur_disp = (
            "-" if days_overdue is None else
            (str(days_overdue) if days_overdue >= 0 else f"({-days_overdue})")
        )
        bucket = _bucket(days_overdue)
        if inv.type == InvoiceType.IN:
            sum_total_in += total_inv
            sum_paid_in += paid
            sum_remaining_in += remaining
            aging_in[bucket] += remaining
        else:
            sum_total_out += total_inv
            sum_paid_out += paid
            sum_remaining_out += remaining
            aging_out[bucket] += remaining
        rows.append([
            inv.number, "Hutang" if inv.type == InvoiceType.IN else "Piutang",
            _fmt_date(inv.due_date), umur_disp,
            proj_map.get(inv.project_id).name if proj_map.get(inv.project_id) else "-",
            inv.party_name or "-",
            _fmt_idr(inv.total), _fmt_idr(paid), _fmt_idr(remaining), inv.status.value,
        ])
    # Aging summary string -- format "0-30: Rp X · 31-60: Rp Y · ..."
    def _aging_str(d: dict[str, Decimal]) -> str:
        parts = []
        for b in AGING_BUCKETS:
            if d[b] > 0:
                parts.append(f"{b}: Rp {_fmt_idr(d[b])}")
        return " · ".join(parts) if parts else "—"

    n_in = len([i for i in invs if i.type == InvoiceType.IN])
    n_out = len([i for i in invs if i.type == InvoiceType.OUT])
    summary = [
        {"label": "Sisa Hutang", "value": f"Rp {_fmt_idr(sum_remaining_in)}",
         "sub": f"dari Rp {_fmt_idr(sum_total_in)} ({n_in} invoice)"},
        {"label": "Sisa Piutang", "value": f"Rp {_fmt_idr(sum_remaining_out)}",
         "sub": f"dari Rp {_fmt_idr(sum_total_out)} ({n_out} invoice)"},
        {"label": "Net Position", "value": f"Rp {_fmt_idr(sum_remaining_out - sum_remaining_in)}",
         "sub": "Piutang − Hutang"},
        {"label": "Aging Hutang", "value": "lihat detail",
         "sub": _aging_str(aging_in)},
        {"label": "Aging Piutang", "value": "lihat detail",
         "sub": _aging_str(aging_out)},
        {"label": "Total Invoice Aktif", "value": str(len(invs)),
         "sub": "Issued / Partial / Overdue"},
    ]
    proj_label = (proj_map.get(project_id).name
                  if project_id and proj_map.get(project_id) else "Semua proyek")
    scope_line = (
        f"{proj_label} · As-of {_fmt_date(today)} · "
        "Status aktif (Issued, Partial, Overdue)"
    )
    # Footer: 2 baris subtotal terpisah -- pakai delimiter " | " utk render
    # 2 nilai dalam 1 cell tanpa pretending agregat.
    footer_row = [
        "SUBTOTAL Hutang | Piutang", "", "", "", "", "",
        f"{_fmt_idr(sum_total_in)} | {_fmt_idr(sum_total_out)}",
        f"{_fmt_idr(sum_paid_in)} | {_fmt_idr(sum_paid_out)}",
        f"{_fmt_idr(sum_remaining_in)} | {_fmt_idr(sum_remaining_out)}",
        "",
    ]
    company = await _resolve_company(db, project_id)
    return await _output(
        format, title="Laporan Hutang & Piutang (Aging)",
        headers=headers, rows=rows, cols=cols,
        filters={"Proyek": proj_label, "As-of": _fmt_date(today),
                 "Status": "Aktif (Issued, Partial, Overdue)"},
        totals={}, company=company, printed_by=user.name, landscape=True,
        summary=summary, scope_line=scope_line,
        detail_label="Daftar Invoice Aktif (urut jatuh tempo)", footer_row=footer_row,
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


