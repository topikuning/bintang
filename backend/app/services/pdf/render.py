from __future__ import annotations

import asyncio
import base64
import mimetypes
from io import BytesIO
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

from app.services.storage.paths import (
    UnsafeUploadPath,
    is_local_file_url,
    resolve_upload_path,
)

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


# Data lama memakai em dash (U+2014) sebagai pemisah "nama <pemisah> spesifikasi"
# pada uraian barang. Kode aplikasi tidak menulis karakter itu lagi; filter ini
# hanya membacanya supaya PDF lama tetap memisahkan nama dan spesifikasi.
_PEMISAH_LAMA = "\u2014"


def _pisah_uraian(teks: str | None) -> tuple[str, str]:
    teks = teks or ""
    if _PEMISAH_LAMA not in teks:
        return teks.strip(), ""
    nama, spek = teks.split(_PEMISAH_LAMA, 1)
    return nama.strip(), spek.split(_PEMISAH_LAMA, 1)[0].strip()


env.filters["pisah_uraian"] = _pisah_uraian


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
    if not is_local_file_url(url):
        return url
    # Audit #S-01: logo_url tersimpan di DB dan bisa di-set admin, jadi
    # tetap lewat resolver yang menolak path keluar UPLOAD_DIR.
    try:
        p = resolve_upload_path(url)
    except (UnsafeUploadPath, FileNotFoundError):
        return None
    mime, _ = mimetypes.guess_type(p.name)
    if not mime or not mime.startswith("image/"):
        # default ke jpeg agar browser/WeasyPrint tetap mau render
        mime = "image/jpeg"
    b64 = base64.b64encode(p.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{b64}"


def _html_to_pdf_sync(html: str) -> bytes:
    # Lazy import: weasyprint pulls native deps which may not exist at import time.
    from weasyprint import HTML

    buf = BytesIO()
    HTML(string=html).write_pdf(buf)
    return buf.getvalue()


def html_to_pdf(html: str) -> bytes:
    """Render PDF di event-loop saat ini. Sync API yg tetap dipertahankan
    utk pemanggil non-async (CLI, test). Untuk endpoint async pakai
    `html_to_pdf_async()` -- ia melepas event loop selama WeasyPrint
    bekerja sehingga request lain tidak terblok.
    """
    return _html_to_pdf_sync(html)


async def html_to_pdf_async(html: str) -> bytes:
    """Async wrapper -- jalankan WeasyPrint di threadpool default.

    WeasyPrint adalah pure-Python yg CPU-heavy (bisa 200ms-2s untuk
    laporan multi-halaman). Kalau dijalankan langsung di event loop,
    seluruh proses tidak bisa melayani request lain selama itu.
    """
    return await asyncio.to_thread(_html_to_pdf_sync, html)
