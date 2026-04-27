from __future__ import annotations

from io import BytesIO
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

TEMPLATE_DIR = Path(__file__).parent / "templates"
TEMPLATE_DIR.mkdir(parents=True, exist_ok=True)

env = Environment(
    loader=FileSystemLoader(str(TEMPLATE_DIR)),
    autoescape=select_autoescape(["html", "xml"]),
)


def _format_idr(value) -> str:
    try:
        n = float(value or 0)
    except (TypeError, ValueError):
        return "0"
    s = f"{n:,.2f}"
    # Indonesian: dot as thousand sep, comma as decimal
    s = s.replace(",", "X").replace(".", ",").replace("X", ".")
    return s


env.filters["idr"] = _format_idr


def render_html(template: str, **ctx) -> str:
    tmpl = env.get_template(template)
    return tmpl.render(**ctx)


def html_to_pdf(html: str) -> bytes:
    # Lazy import: weasyprint pulls native deps which may not exist at import time.
    from weasyprint import HTML

    buf = BytesIO()
    HTML(string=html).write_pdf(buf)
    return buf.getvalue()
