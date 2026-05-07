from datetime import date as date_type, datetime
from decimal import Decimal
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import (
    ensure_project_access,
    get_current_user,
    user_project_ids,
)
from app.db.session import get_db
from app.models.models import (
    AuditLog,
    Category,
    Company,
    Invoice,
    InvoiceStatus,
    InvoiceType,
    POStatus,
    Project,
    PurchaseOrder,
    Transaction,
    TxnStatus,
    TxnType,
    User,
    UserRole,
    VendorClient,
)
from app.services.excel.builder import build_xlsx
from app.services.pdf.render import html_to_pdf, inline_image, render_html

router = APIRouter()


def _accessible_pids(
    user_pids: list[int] | None,
    project_id: int | None,
) -> list[int] | None:
    """Hitung filter project_id untuk laporan.

    Args:
        user_pids: hasil `user_project_ids(db, user)` --
            None = akses semua proyek, [] = no access, [...] = scoped.
        project_id: filter laporan ke 1 proyek (opsional).

    Returns:
        None = tidak perlu filter (semua proyek)
        []   = tidak boleh akses (caller harus 403)
        [...] = list project_id yang harus difilter
    """
    if user_pids is None:
        # User punya akses ke semua proyek
        return [project_id] if project_id else None
    # User restricted
    if not user_pids:
        return []
    if project_id is not None:
        return [project_id] if project_id in user_pids else []
    return user_pids


def _fmt_idr(v) -> str:
    try:
        n = float(v or 0)
    except (TypeError, ValueError):
        return "0"
    s = f"{n:,.2f}"
    return s.replace(",", "X").replace(".", ",").replace("X", ".")


async def _company_for_project(db: AsyncSession, pid: int | None) -> Company | None:
    if not pid:
        return None
    p = await db.get(Project, pid)
    if not p:
        return None
    return await db.get(Company, p.company_id)


async def _resolve_company(db: AsyncSession, project_id: int | None) -> Company | None:
    """Pilih company untuk header laporan.

    1. Kalau ada filter project_id -> pakai company milik proyek tsb.
    2. Kalau tidak, ambil company pertama (kebanyakan tenant punya 1
       perusahaan utama; pakai yang punya logo lebih dulu).
    """
    if project_id:
        return await _company_for_project(db, project_id)
    res = await db.execute(
        select(Company)
        .where(Company.deleted_at.is_(None))
        .order_by(Company.logo_url.is_(None), Company.id)
        .limit(1)
    )
    return res.scalar_one_or_none()


def _output(
    format: str,
    *,
    title: str,
    headers: list[str],
    rows: list[list],
    filters: dict,
    totals: dict,
    company: Company | None,
    printed_by: str,
    cols: list[dict] | None = None,
    subtitle: str | None = None,
    landscape: bool = False,
) -> Response:
    """Render laporan ke PDF/XLSX.

    `cols` adalah list paralel dgn `headers`; tiap dict bisa berisi:
      - "align": "left" | "right" | "center" | "num"
      - "width": CSS width (mis. "70px", "10%")
    `landscape=True` membuat halaman A4 landscape (utk tabel banyak kolom).
    """
    if format == "xlsx":
        data = build_xlsx(title, headers, rows, filters=filters, totals=totals)
        return Response(
            data,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{title}.xlsx"'},
        )
    base_css = (Path(__file__).parent.parent.parent / "services/pdf/templates/_base.css").read_text(encoding="utf-8")
    if landscape:
        # Override @page utk halaman ini saja; aturan terakhir menang di WeasyPrint.
        base_css = base_css + "\n@page { size: A4 landscape; margin: 12mm 12mm 14mm 12mm; }\n"
    logo_data = inline_image(company.logo_url) if company else None
    html = render_html(
        "report.html",
        title=title, subtitle=subtitle,
        headers=headers, rows=rows, cols=cols or [],
        filters=filters, totals=totals,
        company=company, app_name="Bintang",
        logo_data=logo_data,
        printed_at=datetime.now().strftime("%Y-%m-%d %H:%M"),
        printed_by=printed_by,
        base_css=base_css,
    )
    pdf = html_to_pdf(html)
    return Response(
        pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{title}.pdf"'},
    )


# ---------- Cashflow ----------
@router.get("/cashflow")
async def cashflow(
    format: str = Query("pdf", pattern="^(pdf|xlsx)$"),
    project_id: int | None = None,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    ids = await user_project_ids(db, user)
    pids = _accessible_pids(ids, project_id)
    if pids is not None and not pids:
        raise HTTPException(403, "no_project_access")

    stmt = select(Transaction).where(
        Transaction.deleted_at.is_(None),
        Transaction.status == TxnStatus.VERIFIED,
    )
    if pids is not None:
        stmt = stmt.where(Transaction.project_id.in_(pids))
    if date_from:
        stmt = stmt.where(Transaction.tx_date >= date_from)
    if date_to:
        stmt = stmt.where(Transaction.tx_date <= date_to)
    stmt = stmt.order_by(Transaction.tx_date.asc())
    txs = (await db.execute(stmt)).scalars().all()

    proj_map = {p.id: p for p in (await db.execute(select(Project))).scalars().all()}
    headers = ["Tanggal", "Proyek", "Tipe", "Pihak", "Deskripsi", "Masuk (Rp)", "Keluar (Rp)"]
    cols = [
        {"align": "center", "width": "60px"},
        {"align": "left",   "width": "18%"},
        {"align": "center", "width": "55px"},
        {"align": "left",   "width": "18%"},
        {"align": "left"},
        {"align": "num",    "width": "85px"},
        {"align": "num",    "width": "85px"},
    ]
    rows: list[list] = []
    sum_in = Decimal("0")
    sum_out = Decimal("0")
    for t in txs:
        proj_name = proj_map.get(t.project_id).name if proj_map.get(t.project_id) else "-"
        if t.type == TxnType.IN:
            sum_in += Decimal(t.amount)
            rows.append([t.tx_date.isoformat(), proj_name, "MASUK",
                         t.party_name or "-", t.description or "-", _fmt_idr(t.amount), ""])
        else:
            sum_out += Decimal(t.amount)
            rows.append([t.tx_date.isoformat(), proj_name, "KELUAR",
                         t.party_name or "-", t.description or "-", "", _fmt_idr(t.amount)])

    totals = {
        "Total Masuk": _fmt_idr(sum_in),
        "Total Keluar": _fmt_idr(sum_out),
        "Saldo": _fmt_idr(sum_in - sum_out),
    }
    filters = {
        "Periode": f"{date_from or '-'} s/d {date_to or '-'}",
        "Proyek": proj_map.get(project_id).name if project_id and proj_map.get(project_id) else "Semua",
    }
    company = await _resolve_company(db, project_id)
    title = "Laporan Arus Kas"
    return _output(format, title=title, headers=headers, rows=rows, cols=cols,
                   filters=filters, totals=totals, company=company,
                   printed_by=user.name, landscape=True)


# ---------- Transactions IN/OUT ----------
@router.get("/transactions")
async def report_transactions(
    format: str = Query("pdf", pattern="^(pdf|xlsx)$"),
    type: TxnType = Query(...),
    project_id: int | None = None,
    category_id: int | None = None,
    status: TxnStatus | None = None,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    ids = await user_project_ids(db, user)
    pids = _accessible_pids(ids, project_id)
    if pids is not None and not pids:
        raise HTTPException(403, "no_project_access")

    stmt = select(Transaction).where(Transaction.deleted_at.is_(None), Transaction.type == type)
    if pids is not None:
        stmt = stmt.where(Transaction.project_id.in_(pids))
    if status:
        stmt = stmt.where(Transaction.status == status)
    if category_id:
        stmt = stmt.where(Transaction.category_id == category_id)
    if date_from:
        stmt = stmt.where(Transaction.tx_date >= date_from)
    if date_to:
        stmt = stmt.where(Transaction.tx_date <= date_to)
    stmt = stmt.order_by(Transaction.tx_date.asc())
    txs = (await db.execute(stmt)).scalars().all()

    proj_map = {p.id: p for p in (await db.execute(select(Project))).scalars().all()}
    cat_map = {c.id: c for c in (await db.execute(select(Category))).scalars().all()}
    headers = ["Tanggal", "Proyek", "Kategori", "Pihak", "Metode", "Status", "Nominal (Rp)"]
    cols = [
        {"align": "center", "width": "60px"},
        {"align": "left",   "width": "18%"},
        {"align": "left",   "width": "13%"},
        {"align": "left"},
        {"align": "center", "width": "65px"},
        {"align": "center", "width": "70px"},
        {"align": "num",    "width": "95px"},
    ]
    rows: list[list] = []
    total = Decimal("0")
    for t in txs:
        total += Decimal(t.amount)
        rows.append([
            t.tx_date.isoformat(),
            proj_map.get(t.project_id).name if proj_map.get(t.project_id) else "-",
            cat_map.get(t.category_id).name if cat_map.get(t.category_id) else "-",
            t.party_name or "-",
            t.payment_method.value,
            t.status.value,
            _fmt_idr(t.amount),
        ])
    totals = {"Total": _fmt_idr(total), "Jumlah Transaksi": str(len(txs))}
    filters = {
        "Tipe": type.value,
        "Periode": f"{date_from or '-'} s/d {date_to or '-'}",
        "Proyek": proj_map.get(project_id).name if project_id and proj_map.get(project_id) else "Semua",
        "Status": status.value if status else "Semua",
    }
    company = await _resolve_company(db, project_id)
    title = f"Laporan Transaksi {'Masuk' if type == TxnType.IN else 'Keluar'}"
    return _output(format, title=title, headers=headers, rows=rows, cols=cols,
                   filters=filters, totals=totals, company=company,
                   printed_by=user.name, landscape=True)


# ---------- Invoices ----------
@router.get("/invoices")
async def report_invoices(
    format: str = Query("pdf", pattern="^(pdf|xlsx)$"),
    type: InvoiceType = Query(...),
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

    stmt = select(Invoice).where(Invoice.deleted_at.is_(None), Invoice.type == type)
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

    proj_map = {p.id: p for p in (await db.execute(select(Project))).scalars().all()}
    headers = ["No Invoice", "Tanggal", "Jatuh Tempo", "Proyek", "Pihak", "Total (Rp)", "Status"]
    cols = [
        {"align": "left",   "width": "120px"},
        {"align": "center", "width": "60px"},
        {"align": "center", "width": "65px"},
        {"align": "left",   "width": "18%"},
        {"align": "left"},
        {"align": "num",    "width": "95px"},
        {"align": "center", "width": "75px"},
    ]
    rows: list[list] = []
    total = Decimal("0")
    for inv in rows_inv:
        total += Decimal(inv.total or 0)
        rows.append([
            inv.number, inv.invoice_date.isoformat(), inv.due_date.isoformat() if inv.due_date else "-",
            proj_map.get(inv.project_id).name if proj_map.get(inv.project_id) else "-",
            inv.party_name or "-", _fmt_idr(inv.total), inv.status.value,
        ])
    totals = {"Total Nilai": _fmt_idr(total), "Jumlah Invoice": str(len(rows_inv))}
    filters = {
        "Tipe": type.value,
        "Periode": f"{date_from or '-'} s/d {date_to or '-'}",
        "Proyek": proj_map.get(project_id).name if project_id and proj_map.get(project_id) else "Semua",
        "Status": status.value if status else "Semua",
    }
    company = await _resolve_company(db, project_id)
    title = f"Laporan Invoice {'Masuk' if type == InvoiceType.IN else 'Keluar'}"
    return _output(format, title=title, headers=headers, rows=rows, cols=cols,
                   filters=filters, totals=totals, company=company,
                   printed_by=user.name, landscape=True)


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

    proj_map = {p.id: p for p in (await db.execute(select(Project))).scalars().all()}
    headers = ["No Invoice", "Tipe", "Jatuh Tempo", "Proyek", "Pihak",
               "Total (Rp)", "Dibayar (Rp)", "Sisa (Rp)", "Status"]
    cols = [
        {"align": "left",   "width": "105px"},
        {"align": "center", "width": "55px"},
        {"align": "center", "width": "65px"},
        {"align": "left",   "width": "14%"},
        {"align": "left"},
        {"align": "num",    "width": "82px"},
        {"align": "num",    "width": "82px"},
        {"align": "num",    "width": "82px"},
        {"align": "center", "width": "70px"},
    ]
    rows: list[list] = []
    sum_remaining_in = Decimal("0")
    sum_remaining_out = Decimal("0")
    for inv in invs:
        paid_q = select(func.coalesce(func.sum(Transaction.amount), 0)).where(
            Transaction.invoice_id == inv.id,
            Transaction.status == TxnStatus.VERIFIED,
            Transaction.deleted_at.is_(None),
        )
        paid = Decimal((await db.execute(paid_q)).scalar_one() or 0)
        remaining = max(Decimal(inv.total or 0) - paid, Decimal("0"))
        if inv.type == InvoiceType.IN:
            sum_remaining_in += remaining
        else:
            sum_remaining_out += remaining
        rows.append([
            inv.number, "Hutang" if inv.type == InvoiceType.IN else "Piutang",
            inv.due_date.isoformat() if inv.due_date else "-",
            proj_map.get(inv.project_id).name if proj_map.get(inv.project_id) else "-",
            inv.party_name or "-",
            _fmt_idr(inv.total), _fmt_idr(paid), _fmt_idr(remaining), inv.status.value,
        ])
    totals = {
        "Total Hutang (sisa)": _fmt_idr(sum_remaining_in),
        "Total Piutang (sisa)": _fmt_idr(sum_remaining_out),
    }
    company = await _resolve_company(db, project_id)
    return _output(format, title="Laporan Hutang & Piutang", headers=headers, rows=rows, cols=cols,
                   filters={"Proyek": proj_map.get(project_id).name if project_id and proj_map.get(project_id) else "Semua"},
                   totals=totals, company=company, printed_by=user.name, landscape=True)


# ---------- Budget control ----------
@router.get("/budget")
async def report_budget(
    format: str = Query("pdf", pattern="^(pdf|xlsx)$"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    ids = await user_project_ids(db, user)
    stmt = select(Project).where(Project.deleted_at.is_(None))
    if ids is not None:
        if not ids:
            raise HTTPException(403, "no_project_access")
        stmt = stmt.where(Project.id.in_(ids))
    projects = (await db.execute(stmt)).scalars().all()
    company_map = {c.id: c for c in (await db.execute(select(Company))).scalars().all()}

    headers = ["Kode", "Proyek", "Perusahaan", "Budget (Rp)", "Pemakaian (Rp)",
               "Pakai", "Sisa (Rp)", "Status"]
    cols = [
        {"align": "center", "width": "70px"},
        {"align": "left",   "width": "20%"},
        {"align": "left",   "width": "18%"},
        {"align": "num",    "width": "90px"},
        {"align": "num",    "width": "90px"},
        {"align": "num",    "width": "55px"},
        {"align": "num",    "width": "90px"},
        {"align": "center", "width": "80px"},
    ]
    rows: list[list] = []
    total_budget = Decimal("0")
    total_spent = Decimal("0")
    for p in projects:
        out_q = select(func.coalesce(func.sum(Transaction.amount), 0)).where(
            Transaction.project_id == p.id,
            Transaction.type == TxnType.OUT,
            Transaction.status == TxnStatus.VERIFIED,
            Transaction.deleted_at.is_(None),
        )
        spent = Decimal((await db.execute(out_q)).scalar_one() or 0)
        budget = Decimal(p.budget_amount or 0)
        pct = (spent / budget * 100) if budget > 0 else Decimal("0")
        remaining = budget - spent
        total_budget += budget
        total_spent += spent
        if budget <= 0:
            status = "no_budget"
        elif pct <= 80:
            status = "aman"
        elif pct <= 100:
            status = "mendekati_batas"
        else:
            status = "overbudget"
        rows.append([
            p.code, p.name,
            company_map.get(p.company_id).name if company_map.get(p.company_id) else "-",
            _fmt_idr(budget), _fmt_idr(spent), f"{pct:.1f}%",
            _fmt_idr(remaining), status,
        ])
    totals = {
        "Total Budget": _fmt_idr(total_budget),
        "Total Pemakaian": _fmt_idr(total_spent),
        "Total Sisa": _fmt_idr(total_budget - total_spent),
    }
    company = await _resolve_company(db, None)
    return _output(format, title="Laporan Budget Control", headers=headers, rows=rows, cols=cols,
                   filters={}, totals=totals, company=company,
                   printed_by=user.name, landscape=True)


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

    proj_map = {p.id: p for p in (await db.execute(select(Project))).scalars().all()}
    headers = ["No PO", "Tanggal", "Proyek", "Vendor", "Total (Rp)", "Status"]
    cols = [
        {"align": "left",   "width": "120px"},
        {"align": "center", "width": "65px"},
        {"align": "left",   "width": "20%"},
        {"align": "left"},
        {"align": "num",    "width": "100px"},
        {"align": "center", "width": "85px"},
    ]
    rows: list[list] = []
    total = Decimal("0")
    for po in pos:
        total += Decimal(po.total or 0)
        rows.append([
            po.number, po.po_date.isoformat(),
            proj_map.get(po.project_id).name if proj_map.get(po.project_id) else "-",
            po.vendor_name or "-", _fmt_idr(po.total), po.status.value,
        ])
    company = await _resolve_company(db, project_id)
    return _output(format, title="Laporan Purchase Order", headers=headers, rows=rows, cols=cols,
                   filters={
                       "Periode": f"{date_from or '-'} s/d {date_to or '-'}",
                       "Proyek": proj_map.get(project_id).name if project_id and proj_map.get(project_id) else "Semua",
                       "Status": status.value if status else "Semua",
                   },
                   totals={"Total Nilai PO": _fmt_idr(total), "Jumlah PO": str(len(pos))},
                   company=company, printed_by=user.name, landscape=True)


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

    user_map = {u.id: u for u in (await db.execute(select(User))).scalars().all()}
    headers = ["Waktu", "User", "Entity", "ID", "Aksi", "Catatan"]
    cols = [
        {"align": "center", "width": "110px"},
        {"align": "left",   "width": "18%"},
        {"align": "left",   "width": "13%"},
        {"align": "center", "width": "55px"},
        {"align": "center", "width": "75px"},
        {"align": "left"},
    ]
    rows: list[list] = []
    for l in logs:
        rows.append([
            l.created_at.strftime("%Y-%m-%d %H:%M:%S"),
            user_map.get(l.user_id).name if user_map.get(l.user_id) else "-",
            l.entity, str(l.entity_id), l.action.value, l.note or "-",
        ])
    company = await _resolve_company(db, None)
    return _output(format, title="Laporan Audit Log", headers=headers, rows=rows, cols=cols,
                   filters={
                       "Periode": f"{date_from or '-'} s/d {date_to or '-'}",
                       "Entity": entity or "Semua",
                   },
                   totals={"Jumlah Entri": str(len(rows))},
                   company=company, printed_by=admin.name)
