"""Nomor WhatsApp: normalisasi ke format WAHA dan sebaliknya."""

from __future__ import annotations

import re


def normalisasi_wa(raw: str | None) -> str:
    """Ubah nomor ke format WAHA `<msisdn>@c.us`.

    Menerima '0812xxxx', '+62812xxxx', '812xxxx', '0812-3456-7890', dan
    '62812xxxx@c.us' (sudah format WAHA, dilewatkan apa adanya).
    """
    raw = (raw or "").strip()
    if not raw:
        return ""
    if "@" in raw:
        return raw
    digits = "".join(c for c in raw if c.isdigit())
    if not digits:
        return ""
    # Indonesia: awalan 0 -> 62, awalan 8 -> 62 + 8, awalan 62 tetap.
    if digits.startswith("0"):
        digits = "62" + digits[1:]
    elif digits.startswith("8"):
        digits = "62" + digits
    return f"{digits}@c.us"


_RE_JID_NOMOR = re.compile(r"^(\d{8,15})(?::\d+)?@(?:c\.us|s\.whatsapp\.net)$")


def jid_nomor(nilai: object) -> str | None:
    """ID WhatsApp berbasis nomor -> `<nomor>@c.us`.

    '62812..@c.us', '62812..@s.whatsapp.net', '62812..:5@s.whatsapp.net'
    -> '62812..@c.us'. ID lain (mis. '…@lid', grup) -> None.
    """
    if not isinstance(nilai, str):
        return None
    m = _RE_JID_NOMOR.match(nilai.strip())
    return f"{m.group(1)}@c.us" if m else None


def nomor_dari_payload(payload: dict) -> str | None:
    """Cari nomor asli pengirim di payload WAHA saat `from` berupa '…@lid'.

    WhatsApp kini sering menyembunyikan nomor di balik ID '@lid'. Sebagian
    mesin WAHA tetap menyertakan nomornya di `_data` dengan nama kolom
    berakhiran Alt / Pn (remoteJidAlt, senderPn, SenderAlt, …). Hanya
    kolom seperti itu yang dibaca, supaya nomor kita sendiri (`to`) tidak
    ikut terambil.
    """
    data = payload.get("_data")
    if not isinstance(data, dict):
        return None
    antre: list[dict] = [data]
    while antre:
        d = antre.pop(0)
        for kunci, nilai in d.items():
            if isinstance(nilai, dict):
                antre.append(nilai)
                continue
            k = str(kunci).lower()
            if k.endswith(("alt", "pn")) and "recipient" not in k:
                nomor = jid_nomor(nilai)
                if nomor:
                    return nomor
    return None


def tampil_nomor(chat_id: str | None) -> str:
    """'62812xxxx@c.us' -> '0812xxxx' untuk ditampilkan ke manusia."""
    if not chat_id:
        return "-"
    digits = chat_id.split("@", 1)[0]
    if digits.startswith("62"):
        return "0" + digits[2:]
    return digits


# Nomor HP Indonesia di tengah teks: 0812..., +62 812..., 62812...,
# boleh dipisah spasi/strip/titik. 10-15 digit.
_RE_NOMOR = re.compile(r"(?<![\d])(?:\+?62|0)\s?8[\d \-.]{7,16}\d(?![\d])")
_LABEL_NOMOR = {
    "wa",
    "no wa",
    "nomor wa",
    "no. wa",
    "whatsapp",
    "hp",
    "no hp",
    "no. hp",
    "telp",
    "telepon",
    "kontak",
    "nomor",
    "no",
}


def ambil_nomor_wa(teks: str) -> tuple[str | None, str]:
    """Cari nomor WA pertama di teks bebas.

    Return `(nomor_waha | None, teks_tanpa_nomor)`. Baris yang tinggal
    berisi label saja ("wa:", "no hp") ikut dibuang supaya tidak terbaca
    sebagai barang oleh pembaca PO.
    """
    m = _RE_NOMOR.search(teks or "")
    if not m:
        return None, teks
    digits = re.sub(r"\D", "", m.group(0))
    if not 10 <= len(digits) <= 15:
        return None, teks
    sisa = teks[: m.start()] + teks[m.end() :]
    baris_bersih = []
    for baris in sisa.splitlines():
        inti = baris.strip().lower().strip(":=-.").strip()
        if inti in _LABEL_NOMOR:
            continue
        baris_bersih.append(baris)
    return normalisasi_wa(digits), "\n".join(baris_bersih).strip()
