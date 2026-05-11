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
from app.services.pdf.render import html_to_pdf_async, inline_image, render_html

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


_BULAN_ID_SHORT = (
    "", "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
    "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
)
_BULAN_ID_FULL = (
    "", "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember",
)


def _fmt_date(d, *, full_month: bool = False) -> str:
    """Format tanggal Indonesia: '01 Sep 2026' (default) atau
    '01 September 2026' (full_month=True). Toleran terhadap None."""
    if not d:
        return "-"
    months = _BULAN_ID_FULL if full_month else _BULAN_ID_SHORT
    return f"{d.day:02d} {months[d.month]} {d.year:04d}"


def _fmt_datetime(dt) -> str:
    """Format '01 Sep 2026 14:35' utk audit-log dll."""
    if not dt:
        return "-"
    return f"{_fmt_date(dt)} {dt.hour:02d}:{dt.minute:02d}"


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


async def _project_map_for_ids(
    db: AsyncSession, project_ids: set[int]
) -> dict[int, Project]:
    """Hanya load Project yang id-nya ada di set; hindari SELECT * di reports."""
    if not project_ids:
        return {}
    res = await db.execute(
        select(Project).where(Project.id.in_(project_ids))
    )
    return {p.id: p for p in res.scalars().all()}


_REPORT_PAGE_CSS_TEMPLATE = """
@page {{
  size: A4 {orientation};
  margin: 9mm 10mm 11mm 10mm;
  @bottom-left {{
    content: "Dokumen rahasia. Untuk penggunaan internal & pihak yang berwenang.";
    font-size: 7px;
    color: #737373;
    font-style: italic;
  }}
  @bottom-right {{
    content: "Halaman " counter(page) " dari " counter(pages);
    font-size: 7px;
    color: #525252;
  }}
}}
"""


async def _output(
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
    summary: list[dict] | None = None,
    scope_line: str | None = None,
    detail_label: str | None = None,
    footer_row: list | None = None,
    doc_no: str | None = None,
    diagnostic: dict | None = None,
) -> Response:
    """Render laporan ke PDF/XLSX (enterprise / minimalist style).

    Parameter:
      cols        list paralel dgn headers; {"align": "...", "width": "..."}.
      subtitle    teks subjudul opsional.
      landscape   True utk A4 landscape (default portrait).
      summary     list[{"label","value","sub"}] -- executive summary cards
                  di atas tabel detail.
      scope_line  satu baris ringkasan periode/scope di bawah judul.
      detail_label  judul section tabel utama (default "Detail").
      footer_row  list cell utk tfoot tabel (Total row di tabel itu sendiri).
      doc_no      nomor referensi dokumen utk header kanan-atas.
    """
    if format == "xlsx":
        data = build_xlsx(
            title, headers, rows,
            filters=filters, totals=totals, cols=cols,
        )
        return Response(
            data,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{title}.xlsx"'},
        )
    base_css = (Path(__file__).parent.parent.parent / "services/pdf/templates/_base.css").read_text(encoding="utf-8")
    # Override @page utk laporan saja (page-numbering + confidential footer).
    base_css += _REPORT_PAGE_CSS_TEMPLATE.format(
        orientation="landscape" if landscape else "portrait"
    )
    logo_data = inline_image(company.logo_url) if company else None
    html = render_html(
        "report.html",
        title=title, subtitle=subtitle,
        headers=headers, rows=rows, cols=cols or [],
        filters=filters, totals=totals,
        summary=summary or [], scope_line=scope_line,
        detail_label=detail_label, footer_row=footer_row,
        doc_no=doc_no, diagnostic=diagnostic,
        company=company, app_name="Bintang",
        logo_data=logo_data,
        printed_at=_fmt_datetime(datetime.now()),
        printed_by=printed_by,
        base_css=base_css,
    )
    pdf = await html_to_pdf_async(html)
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

    base_filters = [Transaction.deleted_at.is_(None)]
    if pids is not None:
        base_filters.append(Transaction.project_id.in_(pids))
    if date_from:
        base_filters.append(Transaction.tx_date >= date_from)
    if date_to:
        base_filters.append(Transaction.tx_date <= date_to)

    # Diagnostik: hitung jumlah & nominal per (type, status) tanpa filter
    # status -- agar user bisa lihat kalau IN-nya masih SUBMITTED/DRAFT,
    # bukan VERIFIED, sehingga tidak masuk ke arus kas.
    diag_q = select(
        Transaction.type, Transaction.status,
        func.count(Transaction.id), func.coalesce(func.sum(Transaction.amount), 0),
    ).where(*base_filters).group_by(Transaction.type, Transaction.status)
    diag_rows = (await db.execute(diag_q)).all()

    # Data utama: hanya VERIFIED
    stmt = select(Transaction).where(*base_filters,
                                     Transaction.status == TxnStatus.VERIFIED
                                     ).order_by(Transaction.tx_date.asc())
    txs = (await db.execute(stmt)).scalars().all()

    proj_ids = {t.project_id for t in txs}
    if project_id:
        proj_ids.add(project_id)
    proj_map = await _project_map_for_ids(db, proj_ids)
    headers = ["Tanggal", "Proyek", "Pihak", "Deskripsi", "Masuk (Rp)", "Keluar (Rp)"]
    cols = [
        {"align": "center", "width": "78px"},
        {"align": "left",   "width": "20%"},
        {"align": "left",   "width": "18%"},
        {"align": "left"},
        {"align": "num",    "width": "100px"},
        {"align": "num",    "width": "100px"},
    ]
    rows: list[list] = []
    sum_in = Decimal("0")
    sum_out = Decimal("0")
    n_in = n_out = 0
    for t in txs:
        proj_name = proj_map.get(t.project_id).name if proj_map.get(t.project_id) else "-"
        is_in = (t.type == TxnType.IN) or (getattr(t.type, "value", t.type) == "IN")
        if is_in:
            sum_in += Decimal(t.amount or 0)
            n_in += 1
            rows.append([_fmt_date(t.tx_date), proj_name,
                         t.party_name or "-", t.description or "-", _fmt_idr(t.amount), ""])
        else:
            sum_out += Decimal(t.amount or 0)
            n_out += 1
            rows.append([_fmt_date(t.tx_date), proj_name,
                         t.party_name or "-", t.description or "-", "", _fmt_idr(t.amount)])

    saldo = sum_in - sum_out
    summary = [
        {"label": "Total Pemasukan", "value": f"Rp {_fmt_idr(sum_in)}", "sub": f"{n_in} transaksi"},
        {"label": "Total Pengeluaran", "value": f"Rp {_fmt_idr(sum_out)}", "sub": f"{n_out} transaksi"},
        {"label": "Saldo Bersih", "value": f"Rp {_fmt_idr(saldo)}",
         "sub": "Surplus" if saldo >= 0 else "Defisit"},
        {"label": "Total Transaksi", "value": str(n_in + n_out), "sub": "Tervalidasi"},
    ]
    proj_label = (proj_map.get(project_id).name
                  if project_id and proj_map.get(project_id) else "Semua proyek")
    period_label = f"{_fmt_date(date_from) if date_from else 'awal'} s/d {_fmt_date(date_to) if date_to else 'sekarang'}"
    scope_line = f"Periode {period_label} · {proj_label} · Hanya transaksi terverifikasi"
    filters = {
        "Periode": period_label,
        "Proyek": proj_label,
        "Status": "VERIFIED (terverifikasi)",
    }
    # Diagnostik per (type, status) -- supaya user lihat kalau ada IN
    # yang masih DRAFT/SUBMITTED dan oleh sebab itu tidak masuk laporan.
    diag_in: dict[str, tuple[int, Decimal]] = {}
    diag_out: dict[str, tuple[int, Decimal]] = {}
    for tp, st, cnt, total in diag_rows:
        bucket = diag_in if (tp == TxnType.IN or getattr(tp, "value", tp) == "IN") else diag_out
        sv = st.value if hasattr(st, "value") else str(st)
        bucket[sv] = (int(cnt), Decimal(total or 0))
    diag = {
        "in_total": sum(c for c, _ in diag_in.values()),
        "in_per_status": diag_in,
        "out_total": sum(c for c, _ in diag_out.values()),
        "out_per_status": diag_out,
    }
    footer_row = [
        "TOTAL", "", "", "",
        _fmt_idr(sum_in), _fmt_idr(sum_out),
    ]
    company = await _resolve_company(db, project_id)
    title = "Laporan Arus Kas"
    return await _output(
        format, title=title, headers=headers, rows=rows, cols=cols,
        filters=filters, totals={}, company=company,
        printed_by=user.name, landscape=True,
        summary=summary, scope_line=scope_line,
        detail_label="Detail Transaksi", footer_row=footer_row,
        doc_no=f"AKAS-{datetime.now().strftime('%Y%m%d%H%M')}",
        diagnostic=diag,
    )


# ---------- Transactions IN/OUT ----------
@router.get("/transactions")
async def report_transactions(
    format: str = Query("pdf", pattern="^(pdf|xlsx)$"),
    type: TxnType | None = None,
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

    stmt = select(Transaction).where(Transaction.deleted_at.is_(None))
    if type:
        stmt = stmt.where(Transaction.type == type)
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

    proj_ids = {t.project_id for t in txs}
    if project_id:
        proj_ids.add(project_id)
    proj_map = await _project_map_for_ids(db, proj_ids)
    cat_ids = {t.category_id for t in txs if t.category_id}
    cat_map: dict[int, Category] = {}
    if cat_ids:
        cat_map = {c.id: c for c in
                   (await db.execute(select(Category).where(Category.id.in_(cat_ids))))
                   .scalars().all()}
    headers = ["Tanggal", "Proyek", "Kategori", "Pihak", "Metode", "Status", "Nominal (Rp)"]
    cols = [
        {"align": "center", "width": "78px"},
        {"align": "left",   "width": "17%"},
        {"align": "left",   "width": "12%"},
        {"align": "left"},
        {"align": "center", "width": "72px"},
        {"align": "center", "width": "82px"},
        {"align": "num",    "width": "100px"},
    ]
    rows: list[list] = []
    total = Decimal("0")
    n_verified = 0
    for t in txs:
        total += Decimal(t.amount or 0)
        if t.status == TxnStatus.VERIFIED:
            n_verified += 1
        rows.append([
            _fmt_date(t.tx_date),
            proj_map.get(t.project_id).name if proj_map.get(t.project_id) else "-",
            cat_map.get(t.category_id).name if cat_map.get(t.category_id) else "-",
            t.party_name or "-",
            t.payment_method.value,
            t.status.value,
            _fmt_idr(t.amount),
        ])
    avg = (total / len(txs)) if txs else Decimal("0")
    # Label adaptive ke pilihan `type`. None -> "Transaksi" (gabungan IN+OUT).
    arah_label = (
        "Pemasukan" if type == TxnType.IN else
        "Pengeluaran" if type == TxnType.OUT else
        "Transaksi"
    )
    summary = [
        {"label": f"Total {arah_label}", "value": f"Rp {_fmt_idr(total)}",
         "sub": f"{len(txs)} transaksi"},
        {"label": "Rata-rata / Transaksi", "value": f"Rp {_fmt_idr(avg)}", "sub": ""},
        {"label": "Status Tervalidasi", "value": str(n_verified),
         "sub": f"dari {len(txs)} transaksi"},
        {"label": "Periode", "value": _fmt_date(date_to or date_from) if (date_to or date_from) else "—",
         "sub": f"sejak {_fmt_date(date_from)}" if date_from else "tanpa batas"},
    ]
    proj_label = (proj_map.get(project_id).name
                  if project_id and proj_map.get(project_id) else "Semua proyek")
    period_label = f"{_fmt_date(date_from) if date_from else 'awal'} s/d {_fmt_date(date_to) if date_to else 'sekarang'}"
    status_label = status.value if status else "semua status"
    scope_line = f"Periode {period_label} · {proj_label} · {arah_label} · {status_label}"
    filters = {
        "Arah Kas": f"{type.value} ({arah_label})" if type else "Semua (IN+OUT)",
        "Periode": period_label,
        "Proyek": proj_label,
        "Status": status.value if status else "Semua",
    }
    footer_row = ["TOTAL", "", "", "", "", "", _fmt_idr(total)]
    company = await _resolve_company(db, project_id)
    if type == TxnType.IN:
        title = "Laporan Transaksi Masuk"
    elif type == TxnType.OUT:
        title = "Laporan Transaksi Keluar"
    else:
        title = "Laporan Transaksi (Semua)"
    doc_suffix = type.value if type else "ALL"
    return await _output(
        format, title=title, headers=headers, rows=rows, cols=cols,
        filters=filters, totals={}, company=company,
        printed_by=user.name, landscape=True,
        summary=summary, scope_line=scope_line,
        detail_label="Detail Transaksi", footer_row=footer_row,
        doc_no=f"TXN-{doc_suffix}-{datetime.now().strftime('%Y%m%d%H%M')}",
    )


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
    co_ids = {p.company_id for p in projects if p.company_id}
    company_map: dict[int, Company] = {}
    if co_ids:
        company_map = {c.id: c for c in
                       (await db.execute(select(Company).where(Company.id.in_(co_ids))))
                       .scalars().all()}

    headers = ["Kode", "Proyek", "Perusahaan", "Budget (Rp)", "Pemakaian (Rp)",
               "Pakai", "Sisa (Rp)", "Status"]
    cols = [
        {"align": "center", "width": "72px"},
        {"align": "left",   "width": "20%"},
        {"align": "left",   "width": "18%"},
        {"align": "num",    "width": "95px"},
        {"align": "num",    "width": "95px"},
        {"align": "num",    "width": "58px"},
        {"align": "num",    "width": "95px"},
        {"align": "center", "width": "85px"},
    ]
    rows: list[list] = []
    total_budget = Decimal("0")
    total_spent = Decimal("0")
    n_aman = n_warn = n_over = n_no = 0
    # Bulk-load realisasi (SUM amount) per proyek -- ganti 1 query per project.
    proj_ids_list = [p.id for p in projects]
    spent_map: dict[int, Decimal] = {}
    if proj_ids_list:
        bulk = (
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
            for pid, amt in (await db.execute(bulk)).all()
        }
    for p in projects:
        spent = spent_map.get(p.id, Decimal("0"))
        budget = Decimal(p.budget_amount or 0)
        pct = (spent / budget * 100) if budget > 0 else Decimal("0")
        remaining = budget - spent
        total_budget += budget
        total_spent += spent
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
            _fmt_idr(budget), _fmt_idr(spent), f"{pct:.1f}%",
            _fmt_idr(remaining), status,
        ])
    overall_pct = (total_spent / total_budget * 100) if total_budget > 0 else Decimal("0")
    summary = [
        {"label": "Total Anggaran", "value": f"Rp {_fmt_idr(total_budget)}",
         "sub": f"{len(projects)} proyek"},
        {"label": "Pemakaian", "value": f"Rp {_fmt_idr(total_spent)}",
         "sub": f"{overall_pct:.1f}% dari anggaran"},
        {"label": "Sisa Anggaran", "value": f"Rp {_fmt_idr(total_budget - total_spent)}", "sub": ""},
        {"label": "Status Risiko", "value": f"{n_over} overbudget",
         "sub": f"{n_warn} waspada · {n_aman} aman · {n_no} tanpa budget"},
    ]
    scope_line = f"Snapshot per {_fmt_date(datetime.now().date())} · Realisasi VERIFIED saja · Semua proyek"
    company = await _resolve_company(db, None)
    return await _output(
        format, title="Laporan Budget Control", headers=headers, rows=rows, cols=cols,
        filters={}, totals={}, company=company, printed_by=user.name, landscape=True,
        summary=summary, scope_line=scope_line,
        detail_label="Detail per Proyek",
        footer_row=[
            "TOTAL", "", "",
            _fmt_idr(total_budget), _fmt_idr(total_spent),
            f"{overall_pct:.1f}%",
            _fmt_idr(total_budget - total_spent), "",
        ],
        doc_no=f"BGT-{datetime.now().strftime('%Y%m%d%H%M')}",
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
