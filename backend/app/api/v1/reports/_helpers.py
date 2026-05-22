"""Helper bersama utk semua endpoint reports.

Audit 2026-05-22 #M2: ekstraksi dari reports.py (1290 baris) supaya
endpoint files lebih fokus & helpers reusable.
"""
from datetime import datetime
from pathlib import Path

from fastapi import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import Company, Project
from app.services.excel.builder import build_xlsx
from app.services.pdf.render import html_to_pdf_async, inline_image, render_html


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
        return [project_id] if project_id else None
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
    base_css = (Path(__file__).parent.parent.parent.parent / "services/pdf/templates/_base.css").read_text(encoding="utf-8")
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
