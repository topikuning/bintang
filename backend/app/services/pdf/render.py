from __future__ import annotations

import base64
import mimetypes
from io import BytesIO
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

from app.core.config import settings

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


def inline_image(url: str | None) -> str | None:
    """Konversi URL gambar ke `data:image/...;base64,...`.

    WeasyPrint merender PDF di server dan butuh sumber yang resolvable.
    Untuk URL relatif `/files/...` (yang dipakai logo perusahaan dan kop
    surat), kita baca file-nya langsung dari `UPLOAD_DIR` lalu inline
    sebagai data URI -- bebas dari ketergantungan HTTP base_url.

    URL yang sudah berupa http/https/data: dilewatkan apa adanya.
    Return None kalau gambar tidak ditemukan.
    """
    if not url:
        return None
    if url.startswith(("http://", "https://", "data:")):
        return url
    if not url.startswith("/files/"):
        return url
    rel = url[len("/files/"):]
    p = Path(settings.UPLOAD_DIR) / rel
    if not p.exists() or not p.is_file():
        return None
    mime, _ = mimetypes.guess_type(p.name)
    if not mime or not mime.startswith("image/"):
        # default ke jpeg agar browser/WeasyPrint tetap mau render
        mime = "image/jpeg"
    b64 = base64.b64encode(p.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{b64}"


def html_to_pdf(html: str) -> bytes:
    # Lazy import: weasyprint pulls native deps which may not exist at import time.
    from weasyprint import HTML

    buf = BytesIO()
    HTML(string=html).write_pdf(buf)
    return buf.getvalue()
