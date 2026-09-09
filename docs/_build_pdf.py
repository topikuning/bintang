"""Convert manual-penggunaan.md ke PDF dgn WeasyPrint.

Pakai 'markdown' lib utk parse MD -> HTML, lalu WeasyPrint -> PDF.
CSS minimal supaya hasil terbaca rapi: heading hierarchy, table, code.
"""
from pathlib import Path

import markdown
from weasyprint import HTML, CSS

ROOT = Path(__file__).parent
MD = ROOT / "manual-penggunaan.md"
PDF = ROOT / "manual-penggunaan.pdf"

md_text = MD.read_text(encoding="utf-8")
html_body = markdown.markdown(
    md_text,
    extensions=["tables", "fenced_code", "toc", "sane_lists"],
)

CSS_STYLE = """
@page {
    size: A4;
    margin: 18mm 16mm 18mm 16mm;
    @bottom-right {
        content: "Hal. " counter(page) " / " counter(pages);
        font-size: 9pt;
        color: #888;
    }
    @bottom-left {
        content: "CACAK — Manual Penggunaan";
        font-size: 9pt;
        color: #888;
    }
}
body {
    font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 10.5pt;
    line-height: 1.5;
    color: #222;
}
h1 { font-size: 22pt; color: #1e40af; border-bottom: 2px solid #1e40af; padding-bottom: 6pt; margin-top: 0; }
h2 { font-size: 16pt; color: #1e40af; margin-top: 22pt; border-bottom: 1px solid #d1d5db; padding-bottom: 3pt; }
h3 { font-size: 13pt; color: #1f2937; margin-top: 16pt; }
h4 { font-size: 11pt; color: #374151; margin-top: 12pt; }
p { margin: 6pt 0; }
ul, ol { margin: 6pt 0; padding-left: 22pt; }
li { margin: 2pt 0; }
table {
    width: 100%;
    border-collapse: collapse;
    margin: 8pt 0;
    font-size: 9.5pt;
}
th {
    background: #f3f4f6;
    text-align: left;
    padding: 6pt 8pt;
    border: 1px solid #d1d5db;
    font-weight: 600;
}
td {
    padding: 5pt 8pt;
    border: 1px solid #e5e7eb;
    vertical-align: top;
}
tr:nth-child(even) td { background: #fafafa; }
code {
    background: #f3f4f6;
    padding: 1pt 4pt;
    border-radius: 3pt;
    font-family: "SF Mono", "Consolas", monospace;
    font-size: 9pt;
}
pre {
    background: #f3f4f6;
    border-left: 3pt solid #1e40af;
    padding: 8pt 10pt;
    overflow-x: auto;
    font-size: 9pt;
    line-height: 1.4;
    border-radius: 3pt;
}
pre code { background: transparent; padding: 0; }
blockquote {
    border-left: 3pt solid #d1d5db;
    margin: 8pt 0;
    padding-left: 10pt;
    color: #6b7280;
    font-style: italic;
}
strong { color: #111827; }
em { color: #4b5563; }
a { color: #1e40af; text-decoration: none; }
a:hover { text-decoration: underline; }
hr {
    border: none;
    border-top: 1px solid #d1d5db;
    margin: 14pt 0;
}
h2 { page-break-before: auto; }
h2.section-break { page-break-before: always; }
table, pre { page-break-inside: avoid; }
"""

html_full = f"""<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<title>Manual Penggunaan — CACAK</title>
</head>
<body>
{html_body}
</body>
</html>
"""

# Write debug HTML supaya user bisa cek output kalau perlu
(ROOT / "manual-penggunaan.html").write_text(html_full, encoding="utf-8")

HTML(string=html_full).write_pdf(
    str(PDF), stylesheets=[CSS(string=CSS_STYLE)],
)
print(f"OK -> {PDF} ({PDF.stat().st_size // 1024} KB)")
