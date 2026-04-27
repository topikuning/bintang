from io import BytesIO
from typing import Any

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter


def build_xlsx(
    title: str,
    headers: list[str],
    rows: list[list[Any]],
    *,
    subtitle: str | None = None,
    filters: dict | None = None,
    totals: dict | None = None,
    sheet_name: str = "Report",
) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = sheet_name[:31]

    bold = Font(bold=True)
    header_fill = PatternFill("solid", fgColor="E5E7EB")

    ws.append([title])
    ws[ws.max_row][0].font = Font(bold=True, size=14)
    if subtitle:
        ws.append([subtitle])
    if filters:
        ws.append([
            "Filter: "
            + " | ".join(f"{k}: {v}" for k, v in filters.items())
        ])
    ws.append([])
    header_row_idx = ws.max_row + 1
    ws.append(headers)
    for cell in ws[header_row_idx]:
        cell.font = bold
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center")

    for row in rows:
        ws.append(row)

    if totals:
        ws.append([])
        for k, v in totals.items():
            ws.append([k, v])
            ws[ws.max_row][0].font = bold

    for col_idx in range(1, len(headers) + 1):
        col_letter = get_column_letter(col_idx)
        max_len = len(str(headers[col_idx - 1]))
        for r in rows:
            try:
                max_len = max(max_len, len(str(r[col_idx - 1])))
            except IndexError:
                pass
        ws.column_dimensions[col_letter].width = min(max(12, max_len + 2), 50)

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()
