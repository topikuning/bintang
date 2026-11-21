"""Pembaca pasti (tanpa AI) untuk pesan /po.

AI tidak andal untuk format singkat lapangan seperti:

    proyek klbrt
    vendor Tedi Yulianto Prabowo
    Material 11jt
    Kasbon Pekerja 1 ls 70jt

Jadi baris kunci (proyek, vendor/pemasok, catatan) dan baris barang yang
memuat nominal (11jt, 300rb, Rp 1.500.000, @ 95000) dibaca di sini dulu.
AI hanya dipakai untuk baris barang tanpa nominal (mis. "Besi 10 = 270 lonjor").
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation

_RE_KUNCI = re.compile(
    r"^\s*(proyek|project|vendor|pemasok|supplier|toko|catatan|note|ket|keterangan)\s*[:=\-]?\s*(.+?)\s*$",
    re.I,
)
_KUNCI = {
    "proyek": "proyek",
    "project": "proyek",
    "vendor": "vendor",
    "pemasok": "vendor",
    "supplier": "vendor",
    "toko": "vendor",
    "catatan": "catatan",
    "note": "catatan",
    "ket": "catatan",
    "keterangan": "catatan",
}

# Nominal: "11jt", "1,5 jt", "300rb", "95k", "Rp 1.500.000", "@ 95000", "@95rb"
_RE_NOMINAL = re.compile(
    r"(?:(?P<at>@)\s*|(?P<rp>rp\.?)\s*)?(?P<angka>\d[\d.,]*)\s*(?P<satuan>jt|juta|rb|ribu|k)?\b",
    re.I,
)
# "<jumlah> <satuan>" di akhir uraian, mis. "1 ls", "200 sak", "5 m3"
_RE_JUMLAH = re.compile(r"(?:^|\s)(\d+(?:[.,]\d+)?)\s*([a-zA-Z][a-zA-Z0-9]{0,9})\s*$")
_PENGALI = {"jt": 1_000_000, "juta": 1_000_000, "rb": 1_000, "ribu": 1_000, "k": 1_000}


def _angka(teks: str) -> Decimal | None:
    s = teks.strip().rstrip(".,")
    if "," in s and "." in s:
        s = (
            s.replace(".", "").replace(",", ".")
            if s.rfind(",") > s.rfind(".")
            else s.replace(",", "")
        )
    elif "," in s:
        s = s.replace(",", ".") if len(s.split(",")[-1]) <= 2 else s.replace(",", "")
    elif s.count(".") >= 1 and all(len(p) == 3 for p in s.split(".")[1:]):
        s = s.replace(".", "")
    try:
        return Decimal(s)
    except InvalidOperation:
        return None


def _nominal_di_akhir(baris: str) -> tuple[Decimal, int] | None:
    """Nominal uang terakhir di baris (harus ber-satuan rb/jt, ber-Rp, atau ber-@).

    Return (nilai, posisi awal) atau None.
    """
    hasil = None
    for m in _RE_NOMINAL.finditer(baris):
        if not (m.group("at") or m.group("rp") or m.group("satuan")):
            continue
        nilai = _angka(m.group("angka"))
        if nilai is None:
            continue
        if m.group("satuan"):
            nilai *= _PENGALI[m.group("satuan").lower()]
        hasil = (nilai, m.start())
    if hasil is None:
        return None
    nilai, awal = hasil
    # Nominal harus di bagian akhir baris (sisanya hanya "/ls", "per sak", dsb.)
    sisa = baris[awal:]
    m = _RE_NOMINAL.search(sisa)
    ekor = sisa[m.end() :].strip() if m else ""
    if len(ekor) > 12:
        return None
    return nilai, awal


@dataclass
class HasilBaca:
    proyek: str | None = None
    vendor: str | None = None
    catatan: str | None = None
    barang: list[dict] = field(default_factory=list)
    # (nomor baris, teks) barang tanpa nominal, untuk dibaca AI
    sisa: list[tuple[int, str]] = field(default_factory=list)


def baca(teks: str) -> HasilBaca:
    h = HasilBaca()
    for no, baris in enumerate((teks or "").splitlines()):
        b = baris.strip().lstrip("-•*").strip()
        if not b:
            continue
        m = _RE_KUNCI.match(b)
        if m:
            kunci = _KUNCI[m.group(1).lower()]
            nilai = m.group(2).strip()
            if kunci == "proyek" and not h.proyek:
                h.proyek = nilai
            elif kunci == "vendor" and not h.vendor:
                h.vendor = nilai
            elif kunci == "catatan":
                h.catatan = f"{h.catatan}; {nilai}" if h.catatan else nilai
            continue
        nom = _nominal_di_akhir(b)
        if nom is None:
            h.sisa.append((no, b))
            continue
        harga, awal = nom
        uraian = b[:awal].strip().rstrip("=:@-,").strip()
        jumlah, satuan = Decimal("1"), "ls"
        mj = _RE_JUMLAH.search(uraian)
        if mj and mj.start() > 0:
            q = _angka(mj.group(1))
            if q and q > 0:
                jumlah, satuan = q, mj.group(2).lower()
                uraian = uraian[: mj.start()].strip().rstrip("=:,").strip()
        if not uraian or harga <= 0:
            h.sisa.append((no, b))
            continue
        h.barang.append(
            {
                "description": uraian,
                "quantity": float(jumlah),
                "unit": satuan,
                # Nominal di baris dibaca sebagai harga satuan; untuk "1 ls"
                # sama dengan totalnya.
                "unit_price": float(harga),
                "_baris": no,
            }
        )
    return h
