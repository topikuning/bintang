"""Aturan pemilik: aplikasi TIDAK boleh memakai em dash (U+2014) atau en dash
(U+2013). Pakai tanda hubung biasa "-".

Berlaku untuk kode, teks tampilan, pesan WhatsApp/Telegram, templat PDF, dan
dokumentasi. Karakter ditulis sebagai escape supaya berkas ini sendiri bersih.
"""

from pathlib import Path

AKAR = Path(__file__).resolve().parents[2]
TERLARANG = (chr(0x2014), chr(0x2013))  # em dash, en dash
FOLDER = ["backend/app", "backend/tests", "frontend-v2/src", "web/src", "web/prisma", "docs"]
BERKAS = ["README.md", "RAILWAY.md"]
AKHIRAN = {".py", ".ts", ".tsx", ".js", ".css", ".html", ".md", ".prisma", ".sql", ".json", ".txt"}


def _berkas_diperiksa():
    for f in FOLDER:
        d = AKAR / f
        if d.is_dir():
            yield from (p for p in d.rglob("*") if p.is_file() and p.suffix in AKHIRAN)
    for b in BERKAS:
        if (AKAR / b).is_file():
            yield AKAR / b


def test_tidak_ada_em_dash_atau_en_dash():
    temuan = []
    for p in _berkas_diperiksa():
        if "node_modules" in p.parts or "__pycache__" in p.parts:
            continue
        try:
            teks = p.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for no, baris in enumerate(teks.splitlines(), start=1):
            if any(c in baris for c in TERLARANG):
                temuan.append(f"{p.relative_to(AKAR)}:{no}")
    assert temuan == [], "Ganti em/en dash dengan '-': " + ", ".join(temuan[:20])
