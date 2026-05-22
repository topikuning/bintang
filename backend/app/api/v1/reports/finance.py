"""Endpoint reports: cashflow + transactions + direct_expenses.

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

    # Eligibility utk bucket NON_PROJECT (year toggle). Tx di Catatan
    # Non-Proyek hanya muncul di laporan arus kas kalau (company, year)
    # punya setting include_in_global=True. JOIN Project utk kondisi.
    elig_clause = await transaction_eligibility_clause(db)
    base_filters_with_join = base_filters + [elig_clause]

    # Diagnostik: hitung jumlah & nominal per (type, status) tanpa filter
    # status -- agar user bisa lihat kalau IN-nya masih SUBMITTED/DRAFT,
    # bukan VERIFIED, sehingga tidak masuk ke arus kas.
    diag_q = (
        select(
            Transaction.type, Transaction.status,
            func.count(Transaction.id), func.coalesce(func.sum(Transaction.amount), 0),
        )
        .select_from(Transaction)
        .join(Project, Project.id == Transaction.project_id)
        .where(*base_filters_with_join)
        .group_by(Transaction.type, Transaction.status)
    )
    diag_rows = (await db.execute(diag_q)).all()

    # Data utama: hanya VERIFIED
    stmt = (
        select(Transaction)
        .join(Project, Project.id == Transaction.project_id)
        .where(*base_filters_with_join, Transaction.status == TxnStatus.VERIFIED)
        .order_by(Transaction.tx_date.asc())
    )
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
    kind: str | None = None,                # TxnKind value (string)
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
    if kind:
        # TxnKind disimpan sbg VARCHAR di DB -- filter string langsung.
        stmt = stmt.where(Transaction.kind == kind)
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
    _KIND_NICE = {
        "INVOICE_PAYMENT": "Bayar Invoice",
        "CASH_ADVANCE": "Dana Operasional",
        "DIRECT_EXPENSE": "Beban Langsung",
    }
    filters = {
        "Arah Kas": f"{type.value} ({arah_label})" if type else "Semua (IN+OUT)",
        "Jenis": _KIND_NICE.get(kind, kind) if kind else "Semua",
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





# ============================================================
# Direct Expense (Beban Langsung) report
# ============================================================
@router.get("/direct-expenses")
async def report_direct_expenses(
    format: str = Query("pdf", pattern="^(pdf|xlsx)$"),
    project_id: int | None = None,
    category_id: int | None = None,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    """Laporan Beban Langsung (DIRECT_EXPENSE) -- breakdown per line item.

    Kolom: Tanggal | Proyek | Deskripsi Item | Kategori | Nominal Item
    Summary: total beban, jumlah tx, jumlah item, kategori terbanyak.
    """
    from decimal import Decimal as _D
    ids = await user_project_ids(db, user)
    pids = _accessible_pids(ids, project_id)
    if pids is not None and not pids:
        raise HTTPException(403, "no_project_access")
    stmt = (
        select(Transaction)
        .options(selectinload(Transaction.items))
        .where(
            Transaction.deleted_at.is_(None),
            Transaction.kind == TxnKind.DIRECT_EXPENSE.value,
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

    proj_ids = {t.project_id for t in txs}
    if project_id:
        proj_ids.add(project_id)
    proj_map = await _project_map_for_ids(db, proj_ids)
    # Category map (line items + tx category fallback)
    cat_ids: set[int] = set()
    for t in txs:
        if t.category_id:
            cat_ids.add(t.category_id)
        for it in (t.items or []):
            if it.category_id:
                cat_ids.add(it.category_id)
    cat_map: dict[int, Category] = {}
    if cat_ids:
        cat_map = {
            c.id: c for c in (
                await db.execute(select(Category).where(Category.id.in_(cat_ids)))
            ).scalars().all()
        }

    headers = ["Tanggal", "Proyek", "Deskripsi", "Kategori", "Nominal"]
    cols = [
        {"align": "center", "width": "78px"},
        {"align": "left", "width": "20%"},
        {"align": "left"},
        {"align": "left", "width": "20%"},
        {"align": "num", "width": "110px"},
    ]
    rows: list[list] = []
    total = _D("0")
    cat_count: dict[str, int] = {}
    n_items = 0
    for t in txs:
        items = t.items or []
        # Filter by category jika diset (filter di line item level)
        if category_id is not None:
            items = [i for i in items if i.category_id == category_id]
            if not items and t.category_id != category_id:
                continue
        if items:
            for it in items:
                amt = _D(it.amount or 0)
                total += amt
                n_items += 1
                cat_name = (
                    cat_map.get(it.category_id).name if it.category_id
                    and cat_map.get(it.category_id) else "-"
                )
                cat_count[cat_name] = cat_count.get(cat_name, 0) + 1
                rows.append([
                    _fmt_date(t.tx_date),
                    proj_map.get(t.project_id).name if proj_map.get(t.project_id) else "-",
                    it.description,
                    cat_name,
                    _fmt_idr(amt),
                ])
        else:
            # Fallback: tx tanpa items (legacy / korupsi data) -> 1 baris pakai amount tx
            amt = _D(t.amount or 0)
            total += amt
            cat_name = (
                cat_map.get(t.category_id).name if t.category_id
                and cat_map.get(t.category_id) else "-"
            )
            cat_count[cat_name] = cat_count.get(cat_name, 0) + 1
            rows.append([
                _fmt_date(t.tx_date),
                proj_map.get(t.project_id).name if proj_map.get(t.project_id) else "-",
                t.description or "(tanpa rincian)",
                cat_name,
                _fmt_idr(amt),
            ])
    top_cat = max(cat_count, key=cat_count.get) if cat_count else "—"
    summary = [
        {"label": "Total Beban Langsung", "value": f"Rp {_fmt_idr(total)}",
         "sub": f"{len(txs)} tx"},
        {"label": "Jumlah Item", "value": str(n_items),
         "sub": "rincian per kategori"},
        {"label": "Kategori Terbanyak", "value": top_cat,
         "sub": f"{cat_count.get(top_cat, 0)}× tercatat" if top_cat != "—" else ""},
        {"label": "Periode", "value": _fmt_date(date_to or date_from) if (date_to or date_from) else "—",
         "sub": f"sejak {_fmt_date(date_from)}" if date_from else "tanpa batas"},
    ]
    proj_label = (proj_map.get(project_id).name
                  if project_id and proj_map.get(project_id) else "Semua proyek")
    cat_label = (cat_map.get(category_id).name
                 if category_id and cat_map.get(category_id) else "Semua kategori")
    period_label = (
        f"{_fmt_date(date_from) if date_from else 'awal'} s/d "
        f"{_fmt_date(date_to) if date_to else 'sekarang'}"
    )
    scope_line = f"Periode {period_label} · {proj_label} · {cat_label}"
    filters = {
        "Periode": period_label,
        "Proyek": proj_label,
        "Kategori": cat_label,
    }
    footer_row = ["TOTAL", "", "", "", _fmt_idr(total)]
    company = await _resolve_company(db, project_id)
    return await _output(
        format, title="Laporan Beban Langsung",
        headers=headers, rows=rows, cols=cols,
        filters=filters, totals={}, company=company,
        printed_by=user.name, landscape=True,
        summary=summary, scope_line=scope_line,
        detail_label="Detail Beban Langsung", footer_row=footer_row,
        doc_no=f"DEXP-{datetime.now().strftime('%Y%m%d%H%M')}",
    )
