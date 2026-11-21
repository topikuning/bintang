"""Alur PO lewat WhatsApp.

1. Pengguna mengirim kebutuhan material (`/po` + daftar barang, proyek,
   pemasok, nomor WA pemasok). Sistem membalas ringkasan, pengguna "ya".
2. Sistem mengirim pesanan ke WA pemasok. Pemasok membalas langsung di WA:
   `SETUJU 30` (harga sesuai, tempo 30 hari) atau `UBAH` + harga baru,
   atau `TOLAK`.
3. Penawaran pemasok diteruskan ke pengguna; pengguna membalas
   `AJUKAN PO12` untuk meneruskan ke keuangan/pimpinan.
4. Keuangan/pimpinan membalas `SETUJUI PO12` (atau menyetujui di aplikasi).
   PO final dikirim ke pemasok.
5. Barang datang: pengguna mengirim foto surat jalan dengan keterangan
   `TERIMA PO12`. Tagihan (invoice hutang) dibuat, jatuh tempo = hari ini
   + tempo yang disepakati.
6. Setiap pagi keuangan menerima daftar tagihan jatuh tempo hari ini &
   besok (serta yang sudah lewat).
7. Keuangan mengirim foto bukti transfer dengan keterangan `BAYAR PO12`
   (atau dari aplikasi). Pembayaran tercatat sebagai kas keluar, bukti
   dikirim ke pemasok, pengguna diberi tahu.

Kode pendek `PO12` = `PO` + id PO, supaya mudah diketik di WhatsApp. Nomor
resmi PO tetap ditampilkan di setiap pesan.

Pesan keluar dikumpulkan dulu di "kotak" dan baru dikirim setelah data
tersimpan (`buka_kotak()` ... commit ... `kirim_kotak()`), supaya pemasok
tidak pernah menerima pesanan yang gagal disimpan.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import re
import time
from collections.abc import Awaitable, Callable
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.models import (
    AppSetting,
    AuditAction,
    Company,
    Invoice,
    InvoiceAttachment,
    InvoiceItem,
    InvoiceStatus,
    InvoiceType,
    POStatus,
    Project,
    PurchaseOrder,
    Transaction,
    TransactionAttachment,
    User,
    UserRole,
    VendorClient,
)
from app.services.audit import log
from app.services.whatsapp import client as wa
from app.services.whatsapp.phone import normalisasi_wa, tampil_nomor

logger = logging.getLogger(__name__)

# Indonesia tidak memakai musim panas; offset tetap lebih aman daripada
# bergantung pada data zona waktu di image.
WITA = timezone(timedelta(hours=8), "WITA")

MENUNGGU_PEMASOK = "MENUNGGU_PEMASOK"
MENUNGGU_PENGAJU = "MENUNGGU_PENGAJU"
MENUNGGU_PERSETUJUAN = "MENUNGGU_PERSETUJUAN"
FINAL = "FINAL"
DITERIMA = "DITERIMA"
LUNAS = "LUNAS"
DITOLAK_PEMASOK = "DITOLAK_PEMASOK"
DIBATALKAN = "DIBATALKAN"

LABEL_TAHAP = {
    MENUNGGU_PEMASOK: "menunggu jawaban pemasok",
    MENUNGGU_PENGAJU: "penawaran pemasok menunggu diajukan",
    MENUNGGU_PERSETUJUAN: "menunggu persetujuan keuangan/pimpinan",
    FINAL: "disetujui, menunggu barang datang",
    DITERIMA: "barang diterima, menunggu pembayaran",
    LUNAS: "sudah dibayar",
    DITOLAK_PEMASOK: "ditolak pemasok",
    DIBATALKAN: "dibatalkan",
}

PENYETUJU = (UserRole.SUPERADMIN, UserRole.CENTRAL_ADMIN)

_BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]
_HARI = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"]


# ---------------------------------------------------------------------------
# Kotak pesan keluar
# ---------------------------------------------------------------------------


@dataclass
class Pesan:
    chat_id: str
    teks: str
    # Berkas yang ikut dikirim (url `/files/...` hasil simpan). Isi berkasnya
    # dikirim langsung ke WA, `teks` jadi keterangannya.
    berkas_url: str | None = None
    berkas_mime: str | None = None
    berkas_nama: str | None = None
    # Ditambahkan ke teks bila berkas gagal terkirim.
    cadangan: str = ""


_kotak: ContextVar[list[Pesan] | None] = ContextVar("wa_po_kotak", default=None)


def buka_kotak() -> None:
    """Mulai mengumpulkan pesan keluar untuk request ini."""
    _kotak.set([])


def isi_kotak() -> list[Pesan]:
    return list(_kotak.get() or [])


def _antre(
    chat_id: str | None,
    teks: str,
    *,
    berkas: dict | None = None,
    cadangan: str = "",
) -> None:
    """Antrekan pesan. `berkas` = dict hasil simpan file (url, mime_type, file_name)."""
    if not chat_id:
        return
    pesan = Pesan(chat_id, teks, cadangan=cadangan)
    if berkas:
        pesan.berkas_url = berkas.get("url")
        pesan.berkas_mime = berkas.get("mime_type")
        pesan.berkas_nama = berkas.get("file_name")
    box = _kotak.get()
    if box is None:
        # Tanpa kotak (mis. skrip): kirim di latar.
        try:
            asyncio.get_running_loop().create_task(_kirim(pesan))
        except RuntimeError:
            logger.warning("wa_po_flow: tidak ada event loop, pesan ke %s dibuang", chat_id)
        return
    box.append(pesan)


async def _kirim(p: Pesan) -> None:
    if p.berkas_url:
        from app.services.storage.paths import resolve_upload_path

        try:
            path = resolve_upload_path(p.berkas_url)
            isi = await asyncio.to_thread(path.read_bytes)
        except Exception:
            logger.exception("wa_po_flow: berkas %s tidak terbaca", p.berkas_url)
            isi = None
        if isi is not None:
            hasil = await wa.send_media(
                p.chat_id,
                isi,
                p.berkas_mime or "application/octet-stream",
                p.berkas_nama or path.name,
                caption=p.teks,
            )
            if hasil is not None:
                return
        await wa.send_text(p.chat_id, p.teks + p.cadangan)
        return
    await wa.send_text(p.chat_id, p.teks)


async def kirim_kotak() -> None:
    """Kirim semua pesan yang terkumpul. Panggil SETELAH commit."""
    box = _kotak.get() or []
    _kotak.set([])
    for p in box:
        try:
            await _kirim(p)
        except Exception:
            logger.exception("wa_po_flow: gagal kirim WA ke %s", p.chat_id)


# ---------------------------------------------------------------------------
# Format
# ---------------------------------------------------------------------------


def rp(n) -> str:
    return f"Rp {Decimal(n or 0):,.0f}".replace(",", ".")


def kode(po: PurchaseOrder) -> str:
    return f"PO{po.id}"


def tgl(d: date) -> str:
    return f"{d.day} {_BULAN[d.month - 1]} {d.year}"


def _qty(q) -> str:
    d = Decimal(q or 0).normalize()
    s = f"{d:f}"
    return s.replace(".", ",")


def teks_tempo(hari: int | None) -> str:
    if hari is None:
        return "tempo belum disepakati"
    if hari == 0:
        return "tunai saat barang diterima"
    return f"tempo {hari} hari setelah barang diterima"


def hari_ini() -> date:
    return datetime.now(WITA).date()


def _daftar_barang(po: PurchaseOrder, harga_lama: dict[int, Decimal] | None = None) -> list[str]:
    baris = []
    for i, it in enumerate(po.items, start=1):
        teks = f"{i}. {it.description} — {_qty(it.quantity)} {it.unit or ''}".rstrip()
        harga = Decimal(it.unit_price or 0)
        if harga > 0:
            lama = (harga_lama or {}).get(i)
            if lama is not None and lama > 0 and lama != harga:
                label = f"~{rp(lama)}~ {rp(harga)}"
            else:
                label = rp(harga)
            teks += f" × {label} = {rp(it.subtotal)}"
        else:
            teks += " (harga belum diisi)"
        baris.append(teks)
    return baris


async def ambil_po(db: AsyncSession, po_id: int) -> PurchaseOrder | None:
    res = await db.execute(
        select(PurchaseOrder)
        .options(selectinload(PurchaseOrder.items))
        .where(PurchaseOrder.id == po_id, PurchaseOrder.deleted_at.is_(None))
    )
    return res.scalar_one_or_none()


async def _nama_pemasok(db: AsyncSession, po: PurchaseOrder) -> str:
    if po.vendor_client_id:
        v = await db.get(VendorClient, po.vendor_client_id)
        if v is not None:
            return v.name
    return po.vendor_name or "Pemasok"


async def _proyek(db: AsyncSession, po: PurchaseOrder) -> Project | None:
    return await db.get(Project, po.project_id)


async def _nama_perusahaan(db: AsyncSession, po: PurchaseOrder) -> str:
    c = await db.get(Company, po.company_id)
    return c.name if c is not None else "kami"


async def _pengaju(db: AsyncSession, po: PurchaseOrder) -> User | None:
    return await db.get(User, po.created_by_id)


async def _penyetuju(db: AsyncSession, kecuali_id: int | None = None) -> list[User]:
    res = await db.execute(
        select(User).where(
            User.role.in_(PENYETUJU),
            User.is_active.is_(True),
            User.whatsapp_chat_id.is_not(None),
        )
    )
    return [u for u in res.scalars().all() if u.id != kecuali_id]


async def _boleh_akses(db: AsyncSession, user: User, po: PurchaseOrder) -> bool:
    from app.core.deps import ensure_project_access

    try:
        await ensure_project_access(db, user, po.project_id)
    except HTTPException:
        return False
    return True


async def _catat(db: AsyncSession, user: User | None, po: PurchaseOrder, catatan: str) -> None:
    await log(
        db,
        user_id=user.id if user else None,
        entity="purchase_order",
        entity_id=po.id,
        action=AuditAction.UPDATE,
        note=f"[WA] {catatan}",
    )


# ---------------------------------------------------------------------------
# Langkah 1–2: kirim ke pemasok
# ---------------------------------------------------------------------------


async def _pesan_ke_pemasok(db: AsyncSession, po: PurchaseOrder) -> str:
    proyek = await _proyek(db, po)
    perusahaan = await _nama_perusahaan(db, po)
    baris = [
        f"📦 *Pesanan Barang {kode(po)}*",
        f"Dari: {perusahaan}" + (f" — proyek {proyek.name}" if proyek else ""),
        f"No. PO: {po.number}",
        "",
        *_daftar_barang(po),
    ]
    if Decimal(po.total or 0) > 0:
        baris.append(f"Total: {rp(po.total)}")
    baris += [
        "",
        "Mohon balas pesan ini:",
        "• *SETUJU 30* → harga sesuai, tempo pembayaran 30 hari",
        "• *SETUJU TUNAI* → harga sesuai, dibayar saat barang diterima",
        "• Ubah harga dan/atau tempo, contoh:",
        "*UBAH*",
        "1 = 53000",
        "TEMPO 30",
        "• *TOLAK* bila tidak bisa memenuhi",
        "",
        f"Kalau Anda menerima lebih dari satu pesanan dari kami, sertakan kode *{kode(po)}*.",
    ]
    return "\n".join(baris)


async def kirim_ke_pemasok(db: AsyncSession, po: PurchaseOrder, aktor: User) -> str:
    """Kirim (atau kirim ulang) pesanan ke WA pemasok. Return balasan untuk aktor."""
    if not po.supplier_wa:
        return (
            f"Nomor WA pemasok untuk {kode(po)} belum ada. Kirim:\n*KIRIM {kode(po)} 0812xxxxxxx*"
        )
    if po.status not in (POStatus.DRAFT, POStatus.ISSUED) or po.wa_tahap not in (
        None,
        MENUNGGU_PEMASOK,
        DITOLAK_PEMASOK,
    ):
        label = LABEL_TAHAP.get(po.wa_tahap or "", po.status.value)
        return f"{kode(po)} sudah {label}; tidak bisa dikirim ulang ke pemasok."
    po.status = POStatus.ISSUED
    po.wa_tahap = MENUNGGU_PEMASOK
    _antre(po.supplier_wa, await _pesan_ke_pemasok(db, po))
    await _catat(db, aktor, po, f"dikirim ke pemasok {tampil_nomor(po.supplier_wa)}")
    nama = await _nama_pemasok(db, po)
    return (
        f"📤 {kode(po)} ({po.number}) dikirim ke {nama} ({tampil_nomor(po.supplier_wa)}). "
        "Saya kabari begitu pemasok membalas."
    )


# ---------------------------------------------------------------------------
# Langkah 2: balasan pemasok
# ---------------------------------------------------------------------------

_KATA_SETUJU = {
    "setuju",
    "ok",
    "oke",
    "okey",
    "okay",
    "sepakat",
    "deal",
    "siap",
    "iya",
    "ya",
    "baik",
    "bisa",
}
_RE_PO = re.compile(r"\bpo\s*#?\s*(\d+)\b", re.I)
_RE_TEMPO = re.compile(r"\btempo\s*[:=]?\s*(\d{1,3})", re.I)
_RE_TUNAI = re.compile(r"\b(tunai|cash|cod)\b", re.I)
_RE_HARGA = re.compile(
    r"(?<![\w.,])(\d{1,3})\s*[.)]?\s*[=:]\s*(?:rp\.?\s*)?(\d[\d.,]*)\s*(rb|ribu|k|jt|juta)?(?!\w)",
    re.I,
)


@dataclass
class BalasanPemasok:
    aksi: str  # setuju | ubah | tolak | tidak_dikenal
    harga: dict[int, Decimal] = field(default_factory=dict)
    tempo: int | None = None
    po_id: int | None = None
    alasan: str = ""


def _angka(teks: str, satuan: str | None) -> Decimal | None:
    s = teks.strip()
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        s = (
            s.replace(",", ".")
            if (s.count(",") == 1 and len(s.split(",")[1]) <= 2)
            else s.replace(",", "")
        )
    elif "." in s and all(len(p) == 3 for p in s.split(".")[1:]):
        s = s.replace(".", "")
    try:
        nilai = Decimal(s)
    except InvalidOperation:
        return None
    pengali = {"rb": 1000, "ribu": 1000, "k": 1000, "jt": 1_000_000, "juta": 1_000_000}
    if satuan:
        nilai *= pengali[satuan.lower()]
    return nilai


def parse_balasan_pemasok(teks: str) -> BalasanPemasok:
    t = (teks or "").strip()
    po_id = None
    m = _RE_PO.search(t)
    if m:
        po_id = int(m.group(1))
        t = (t[: m.start()] + " " + t[m.end() :]).strip()
    low = t.lower()

    tempo = None
    mt = _RE_TEMPO.search(low)
    if mt:
        tempo = int(mt.group(1))
    elif _RE_TUNAI.search(low):
        tempo = 0

    harga: dict[int, Decimal] = {}
    for mh in _RE_HARGA.finditer(_RE_TEMPO.sub(" ", t)):
        nilai = _angka(mh.group(2), mh.group(3))
        if nilai is not None and nilai > 0:
            harga[int(mh.group(1))] = nilai

    kata = low.split()[0].strip(".,!:*") if low.split() else ""
    if kata == "tolak" or low.startswith(("tidak bisa", "tidak sanggup", "maaf tidak")):
        alasan = (
            t.split(None, 1)[1].strip() if kata == "tolak" and len(t.split(None, 1)) > 1 else ""
        )
        return BalasanPemasok("tolak", po_id=po_id, alasan=alasan or t)
    if kata == "ubah" or harga:
        return BalasanPemasok("ubah", harga=harga, tempo=tempo, po_id=po_id)
    if kata in _KATA_SETUJU:
        if tempo is None:
            m2 = re.match(r"^\W*\w+\W+(\d{1,3})\b", low)
            if m2:
                tempo = int(m2.group(1))
        return BalasanPemasok("setuju", tempo=tempo, po_id=po_id)
    return BalasanPemasok("tidak_dikenal", po_id=po_id)


def _petunjuk_pemasok(po: PurchaseOrder) -> str:
    return (
        f"Maaf, balasan untuk {kode(po)} belum bisa saya baca. Balas salah satu:\n"
        "• *SETUJU 30* (harga sesuai, tempo 30 hari)\n"
        "• *SETUJU TUNAI*\n"
        "• *UBAH* lalu per baris: nomor barang = harga, dan TEMPO jumlah hari\n"
        "• *TOLAK*"
    )


async def tangani_balasan_pemasok(db: AsyncSession, chat_id: str, teks: str) -> str | None:
    """Balasan pemasok. Return None kalau nomor ini tidak sedang ditunggu."""
    res = await db.execute(
        select(PurchaseOrder)
        .options(selectinload(PurchaseOrder.items))
        .where(
            PurchaseOrder.supplier_wa == chat_id,
            PurchaseOrder.wa_tahap == MENUNGGU_PEMASOK,
            PurchaseOrder.deleted_at.is_(None),
        )
        .order_by(PurchaseOrder.id)
    )
    terbuka = list(res.scalars().all())
    if not terbuka:
        return None

    b = parse_balasan_pemasok(teks)
    if b.po_id is not None:
        po = next((p for p in terbuka if p.id == b.po_id), None)
        if po is None:
            daftar = ", ".join(kode(p) for p in terbuka)
            return f"Kode PO{b.po_id} tidak sedang menunggu balasan Anda. Pesanan yang menunggu: {daftar}."
    elif len(terbuka) == 1:
        po = terbuka[0]
    else:
        daftar = ", ".join(kode(p) for p in terbuka)
        return (
            f"Ada beberapa pesanan yang menunggu balasan Anda: {daftar}. "
            f"Mohon sertakan kodenya, contoh: *SETUJU {kode(terbuka[0])} 30*"
        )

    if b.aksi == "tidak_dikenal":
        return _petunjuk_pemasok(po)

    pengaju = await _pengaju(db, po)
    nama = await _nama_pemasok(db, po)

    if b.aksi == "tolak":
        po.wa_tahap = DITOLAK_PEMASOK
        po.status = POStatus.CANCELLED
        po.cancel_reason = f"Ditolak pemasok: {b.alasan}"[:1000]
        await _catat(db, None, po, f"ditolak pemasok: {b.alasan}")
        _antre(
            pengaju.whatsapp_chat_id if pengaju else None,
            f"❌ {nama} menolak {kode(po)} ({po.number}).\nAlasan: {b.alasan or '-'}\n"
            "PO dibatalkan. Kirim /po baru dengan pemasok lain.",
        )
        return f"Baik, {kode(po)} kami catat tidak bisa dipenuhi. Terima kasih atas jawabannya."

    harga_lama = {i: Decimal(it.unit_price or 0) for i, it in enumerate(po.items, start=1)}
    if b.aksi == "ubah":
        salah = sorted(n for n in b.harga if n < 1 or n > len(po.items))
        if salah:
            return (
                f"Nomor barang {', '.join(map(str, salah))} tidak ada. "
                f"{kode(po)} berisi {len(po.items)} barang (nomor 1–{len(po.items)})."
            )
        for n, h in b.harga.items():
            po.items[n - 1].unit_price = h

    tempo = b.tempo if b.tempo is not None else po.tempo_days
    kosong = [i for i, it in enumerate(po.items, start=1) if Decimal(it.unit_price or 0) <= 0]
    if kosong:
        contoh = "\n".join(f"{i} = harga" for i in kosong)
        return f"Harga barang nomor {', '.join(map(str, kosong))} belum ada. Mohon balas:\n*UBAH*\n{contoh}"
    if tempo is None:
        return (
            "Mohon sertakan tempo pembayaran (jumlah hari setelah barang diterima), "
            "contoh: *SETUJU 30* atau *SETUJU TUNAI*."
        )
    if tempo > 365:
        return "Tempo pembayaran maksimal 365 hari."

    from app.api.v1.purchase_orders import _compute_totals

    po.subtotal, po.total = _compute_totals(po.items, po.tax, po.discount)
    po.tempo_days = tempo
    po.payment_terms = teks_tempo(tempo)
    po.wa_tahap = MENUNGGU_PENGAJU
    berubah = b.aksi == "ubah" and any(
        Decimal(it.unit_price) != harga_lama[i] for i, it in enumerate(po.items, start=1)
    )
    await _catat(
        db,
        None,
        po,
        f"penawaran pemasok: total {rp(po.total)}, {teks_tempo(tempo)}"
        + (" (harga diubah)" if berubah else ""),
    )
    _antre(
        pengaju.whatsapp_chat_id if pengaju else None,
        "\n".join(
            [
                f"📨 *Penawaran pemasok untuk {kode(po)}*",
                f"{nama} ({tampil_nomor(po.supplier_wa)})"
                + (" — *harga diubah*" if berubah else ""),
                f"No. PO: {po.number}",
                "",
                *_daftar_barang(po, harga_lama),
                f"Total: {rp(po.total)}",
                f"Pembayaran: {teks_tempo(tempo)}",
                "",
                f"Balas *AJUKAN {kode(po)}* untuk diteruskan ke keuangan, atau *BATAL {kode(po)}*.",
            ]
        ),
    )
    return (
        f"Terima kasih. Penawaran {kode(po)} kami terima: total {rp(po.total)}, "
        f"{teks_tempo(tempo)}. Kami kabari setelah disetujui."
    )


# ---------------------------------------------------------------------------
# Langkah 3–4: ajukan, setujui, tolak, batal
# ---------------------------------------------------------------------------


async def ajukan(db: AsyncSession, user: User, po: PurchaseOrder) -> str:
    if user.role == UserRole.EXECUTIVE or not await _boleh_akses(db, user, po):
        return f"Anda tidak punya akses untuk mengajukan {kode(po)}."
    if po.wa_tahap != MENUNGGU_PENGAJU:
        return f"{kode(po)} tidak bisa diajukan: {LABEL_TAHAP.get(po.wa_tahap or '', 'bukan alur WA')}."
    po.wa_tahap = MENUNGGU_PERSETUJUAN
    await _catat(db, user, po, "diajukan untuk persetujuan")
    proyek = await _proyek(db, po)
    nama = await _nama_pemasok(db, po)
    teks = "\n".join(
        [
            f"🧾 *{kode(po)} menunggu persetujuan*",
            f"Pengaju: {user.name}"
            + (f" — proyek {proyek.name} ({proyek.code})" if proyek else ""),
            f"Pemasok: {nama}",
            f"No. PO: {po.number}",
            "",
            *_daftar_barang(po),
            f"Total: {rp(po.total)}",
            f"Pembayaran: {teks_tempo(po.tempo_days)}",
            "",
            f"Balas *SETUJUI {kode(po)}* atau *TOLAK {kode(po)} alasan*. "
            "Bisa juga disetujui di aplikasi (Purchase Order).",
        ]
    )
    penyetuju = await _penyetuju(db, kecuali_id=user.id)
    for u in penyetuju:
        _antre(u.whatsapp_chat_id, teks)
    if not penyetuju:
        return (
            f"{kode(po)} diajukan. Belum ada akun keuangan/pimpinan yang menautkan WhatsApp, "
            "jadi persetujuan dilakukan dari aplikasi."
        )
    return f"✅ {kode(po)} diteruskan ke keuangan/pimpinan untuk disetujui."


async def _kabari_final(db: AsyncSession, po: PurchaseOrder, penyetuju: User) -> None:
    proyek = await _proyek(db, po)
    perusahaan = await _nama_perusahaan(db, po)
    _antre(
        po.supplier_wa,
        "\n".join(
            [
                f"✅ *{kode(po)} DISETUJUI* — {po.number}",
                f"Dari: {perusahaan}",
                "",
                *_daftar_barang(po),
                f"Total: {rp(po.total)}",
                f"Pembayaran: {teks_tempo(po.tempo_days)}.",
                "",
                "Mohon kirim barang"
                + (f" ke proyek {proyek.name}" if proyek else "")
                + ". Terima kasih.",
            ]
        ),
    )
    pengaju = await _pengaju(db, po)
    _antre(
        pengaju.whatsapp_chat_id if pengaju else None,
        f"✅ {kode(po)} disetujui oleh {penyetuju.name} dan sudah dikirim ke pemasok.\n"
        f"Setelah barang datang, kirim *foto surat jalan* dengan keterangan *TERIMA {kode(po)}*.",
    )


async def setujui(db: AsyncSession, penyetuju: User, po: PurchaseOrder) -> str:
    if penyetuju.role not in PENYETUJU:
        return "Hanya keuangan/pimpinan yang bisa menyetujui PO."
    if po.wa_tahap != MENUNGGU_PERSETUJUAN:
        return f"{kode(po)} tidak menunggu persetujuan ({LABEL_TAHAP.get(po.wa_tahap or '', '-')})."
    po.status = POStatus.APPROVED
    po.approved_by_id = penyetuju.id
    po.approved_at = datetime.now(UTC)
    po.wa_tahap = FINAL
    await _catat(db, penyetuju, po, "disetujui")
    await _kabari_final(db, po, penyetuju)
    return f"✅ {kode(po)} disetujui ({rp(po.total)}). PO final dikirim ke pemasok."


async def setelah_disetujui_aplikasi(db: AsyncSession, po: PurchaseOrder, penyetuju: User) -> None:
    """Dipanggil endpoint approve di aplikasi. Lanjutkan alur WA bila PO-nya dari WA."""
    if po.wa_tahap != MENUNGGU_PERSETUJUAN:
        return
    from app.services import messaging

    po.wa_tahap = FINAL
    # Muat ulang lewat selectinload: akses po.items yang belum dimuat akan
    # memicu lazy-load yang tidak didukung di sesi async.
    po = await ambil_po(db, po.id) or po
    if await messaging.whatsapp_active(db):
        await _kabari_final(db, po, penyetuju)


async def tolak(db: AsyncSession, penyetuju: User, po: PurchaseOrder, alasan: str) -> str:
    if penyetuju.role not in PENYETUJU:
        return "Hanya keuangan/pimpinan yang bisa menolak PO."
    if po.wa_tahap != MENUNGGU_PERSETUJUAN:
        return f"{kode(po)} tidak menunggu persetujuan ({LABEL_TAHAP.get(po.wa_tahap or '', '-')})."
    alasan = alasan.strip() or "-"
    po.status = POStatus.CANCELLED
    po.cancel_reason = f"Ditolak {penyetuju.name}: {alasan}"[:1000]
    po.wa_tahap = DIBATALKAN
    await _catat(db, penyetuju, po, f"ditolak: {alasan}")
    pengaju = await _pengaju(db, po)
    _antre(
        pengaju.whatsapp_chat_id if pengaju else None,
        f"❌ {kode(po)} ditolak oleh {penyetuju.name}.\nAlasan: {alasan}",
    )
    _antre(
        po.supplier_wa, f"Mohon maaf, pesanan {kode(po)} ({po.number}) dibatalkan. Terima kasih."
    )
    return f"{kode(po)} ditolak. Pengaju dan pemasok sudah diberi tahu."


async def batal(db: AsyncSession, user: User, po: PurchaseOrder) -> str:
    boleh = user.id == po.created_by_id or user.role in PENYETUJU
    if not boleh:
        return f"Hanya pengaju atau keuangan/pimpinan yang bisa membatalkan {kode(po)}."
    if po.wa_tahap not in (MENUNGGU_PEMASOK, MENUNGGU_PENGAJU, MENUNGGU_PERSETUJUAN):
        return f"{kode(po)} tidak bisa dibatalkan lewat WA ({LABEL_TAHAP.get(po.wa_tahap or '', '-')})."
    po.status = POStatus.CANCELLED
    po.cancel_reason = f"Dibatalkan {user.name} lewat WhatsApp"
    po.wa_tahap = DIBATALKAN
    await _catat(db, user, po, "dibatalkan")
    _antre(
        po.supplier_wa, f"Mohon maaf, pesanan {kode(po)} ({po.number}) dibatalkan. Terima kasih."
    )
    return f"{kode(po)} dibatalkan. Pemasok sudah diberi tahu."


async def setelah_dibatalkan_aplikasi(db: AsyncSession, po: PurchaseOrder, aktor: User) -> None:
    """Dipanggil endpoint cancel di aplikasi: hentikan alur WA & kabari pemasok."""
    if po.wa_tahap not in (MENUNGGU_PEMASOK, MENUNGGU_PENGAJU, MENUNGGU_PERSETUJUAN, FINAL):
        return
    from app.services import messaging

    po.wa_tahap = DIBATALKAN
    if not await messaging.whatsapp_active(db):
        return
    _antre(
        po.supplier_wa, f"Mohon maaf, pesanan {kode(po)} ({po.number}) dibatalkan. Terima kasih."
    )
    pengaju = await _pengaju(db, po)
    if pengaju is not None and pengaju.id != aktor.id:
        _antre(pengaju.whatsapp_chat_id, f"❌ {kode(po)} dibatalkan oleh {aktor.name}.")


# ---------------------------------------------------------------------------
# Langkah 5: barang diterima -> tagihan
# ---------------------------------------------------------------------------


async def _nomor_tagihan(db: AsyncSession, po: PurchaseOrder) -> str:
    dasar = f"TAG/{po.number}"[:76]
    nomor = dasar
    n = 1
    while (await db.execute(select(Invoice.id).where(Invoice.number == nomor))).first() is not None:
        n += 1
        nomor = f"{dasar}-{n}"
    return nomor


async def terima(db: AsyncSession, user: User, po: PurchaseOrder, berkas: dict) -> str:
    """Foto surat jalan masuk. `berkas` = hasil save_bytes/save_upload."""
    if user.role == UserRole.EXECUTIVE or not await _boleh_akses(db, user, po):
        return f"Anda tidak punya akses ke {kode(po)}."
    if po.wa_tahap != FINAL:
        return f"{kode(po)} belum bisa diterima: {LABEL_TAHAP.get(po.wa_tahap or '', 'bukan alur WA')}."
    tgl_terima = hari_ini()
    jatuh_tempo = tgl_terima + timedelta(days=po.tempo_days or 0)
    nama = await _nama_pemasok(db, po)
    inv = Invoice(
        number=await _nomor_tagihan(db, po),
        project_id=po.project_id,
        type=InvoiceType.IN,
        invoice_date=tgl_terima,
        due_date=jatuh_tempo,
        vendor_client_id=po.vendor_client_id,
        party_name=nama,
        purchase_order_id=po.id,
        subtotal=Decimal(po.subtotal or 0),
        tax=Decimal(po.tax or 0),
        total=Decimal(po.total or 0),
        status=InvoiceStatus.ISSUED,
        notes=f"Tagihan dari {po.number} ({kode(po)}); surat jalan via WhatsApp.",
        created_by_id=user.id,
    )
    for it in po.items:
        inv.items.append(
            InvoiceItem(
                description=it.description,
                quantity=it.quantity,
                unit=it.unit,
                unit_price=it.unit_price,
                subtotal=it.subtotal,
            )
        )
    db.add(inv)
    await db.flush()
    db.add(InvoiceAttachment(invoice_id=inv.id, uploaded_by_id=user.id, **berkas))
    po.status = POStatus.FULFILLED
    po.diterima_at = tgl_terima
    po.wa_tahap = DITERIMA
    await _catat(db, user, po, f"barang diterima; tagihan {inv.number} jatuh tempo {jatuh_tempo}")

    if jatuh_tempo <= tgl_terima + timedelta(days=1):
        for u in await _penyetuju(db, kecuali_id=user.id):
            _antre(
                u.whatsapp_chat_id,
                f"🔔 Tagihan baru {kode(po)} ke {nama}: {rp(inv.total)}, jatuh tempo "
                f"*{tgl(jatuh_tempo)}*.\nKirim foto bukti transfer dengan keterangan *BAYAR {kode(po)}*.",
            )
    return (
        f"📥 Surat jalan {kode(po)} dicatat. Tagihan {rp(inv.total)} ke {nama} "
        f"jatuh tempo *{tgl(jatuh_tempo)}* ({teks_tempo(po.tempo_days)})."
    )


# ---------------------------------------------------------------------------
# Langkah 7: bayar
# ---------------------------------------------------------------------------


async def _tagihan_po(db: AsyncSession, po: PurchaseOrder) -> Invoice | None:
    res = await db.execute(
        select(Invoice)
        .where(
            Invoice.purchase_order_id == po.id,
            Invoice.deleted_at.is_(None),
            Invoice.status != InvoiceStatus.CANCELLED,
        )
        .order_by(Invoice.id.desc())
    )
    return res.scalars().first()


def _kunci_tautan() -> bytes:
    return hashlib.sha256(f"bukti-v1:{settings.SECRET_KEY}".encode()).digest()


def token_bukti(
    attachment_id: int, *, berlaku_hari: int = 60, sekarang: float | None = None
) -> str:
    exp = int((sekarang or time.time()) + berlaku_hari * 86400)
    isi = f"{attachment_id}.{exp}"
    sig = hmac.new(_kunci_tautan(), isi.encode(), hashlib.sha256).hexdigest()[:32]
    return f"{isi}.{sig}"


def baca_token_bukti(token: str, *, sekarang: float | None = None) -> int | None:
    """Return id lampiran transaksi kalau token sah & belum kedaluwarsa."""
    try:
        att, exp, sig = token.split(".")
        att_id, exp_i = int(att), int(exp)
    except ValueError:
        return None
    benar = hmac.new(_kunci_tautan(), f"{att_id}.{exp_i}".encode(), hashlib.sha256).hexdigest()[:32]
    if not hmac.compare_digest(benar, sig):
        return None
    if exp_i < (sekarang or time.time()):
        return None
    return att_id


def tautan_bukti(attachment_id: int) -> str | None:
    from app.services.app_settings import get_cached

    dasar = (get_cached("PUBLIC_BASE_URL") or settings.PUBLIC_BASE_URL or "").strip().rstrip("/")
    if not dasar:
        return None
    return f"{dasar}/bukti/{token_bukti(attachment_id)}"


async def bayar(db: AsyncSession, aktor: User, po: PurchaseOrder, berkas: dict) -> str:
    """Catat pembayaran PO + bukti, kirim bukti ke pemasok. `berkas` = hasil simpan file."""
    from app.services.invoice_payment import lunasi_invoice

    if aktor.role not in PENYETUJU:
        return "Hanya keuangan/pimpinan yang bisa mencatat pembayaran."
    if po.wa_tahap != DITERIMA:
        return (
            f"{kode(po)} belum bisa dibayar: {LABEL_TAHAP.get(po.wa_tahap or '', 'bukan alur WA')}."
        )
    inv = await _tagihan_po(db, po)
    if inv is None:
        return f"Tagihan untuk {kode(po)} tidak ditemukan."
    tx, sisa = await lunasi_invoice(
        db,
        inv,
        aktor,
        catatan_audit=f"Pembayaran {kode(po)} ({po.number})",
        catatan_alokasi=f"bayar {kode(po)}",
        keterangan=f"Pembayaran {kode(po)} {po.number}",
        tx_date=hari_ini(),
    )
    if tx is None:
        po.wa_tahap = LUNAS
        return f"Tagihan {kode(po)} sudah lunas sebelumnya."
    tx.purchase_order_id = po.id
    lampiran = TransactionAttachment(transaction_id=tx.id, uploaded_by_id=aktor.id, **berkas)
    db.add(lampiran)
    await db.flush()
    po.wa_tahap = LUNAS
    await _catat(db, aktor, po, f"dibayar {rp(sisa)} (transaksi #{tx.id})")

    nama = await _nama_pemasok(db, po)
    perusahaan = await _nama_perusahaan(db, po)
    teks_pemasok = (
        f"💸 Pembayaran {kode(po)} ({po.number}) sebesar *{rp(sisa)}* sudah kami transfer "
        f"pada {tgl(hari_ini())}. Terima kasih. — {perusahaan}"
    )
    # Bukti dikirim sebagai foto/berkas langsung ke WA pemasok. Tautan hanya
    # cadangan kalau WAHA menolak mengirim berkas.
    tautan = tautan_bukti(lampiran.id)
    cadangan = (
        f"\n\nBukti transfer: {tautan}" if tautan else "\n\nBukti transfer menyusul dari kami."
    )
    _antre(po.supplier_wa, teks_pemasok, berkas=berkas, cadangan=cadangan)
    pengaju = await _pengaju(db, po)
    if pengaju is not None and pengaju.id != aktor.id:
        _antre(
            pengaju.whatsapp_chat_id,
            f"💸 {kode(po)} sudah dibayar {rp(sisa)} oleh {aktor.name}. Bukti terkirim ke pemasok.",
        )
    return (
        f"💸 Pembayaran {kode(po)} {rp(sisa)} dicatat sebagai kas keluar; bukti dikirim ke {nama}."
    )


async def setelah_invoice_lunas(
    db: AsyncSession, inv: Invoice, tx: Transaction, aktor: User
) -> None:
    """Dipanggil 'Tandai lunas' di aplikasi. Kalau tagihannya dari PO alur WA,
    tandai PO lunas dan kabari pemasok + pengaju (tanpa bukti)."""
    if not inv.purchase_order_id:
        return
    po = await ambil_po(db, inv.purchase_order_id)
    if po is None or po.wa_tahap != DITERIMA:
        return
    from app.services import messaging

    tx.purchase_order_id = po.id
    po.wa_tahap = LUNAS
    await _catat(db, aktor, po, f"ditandai lunas dari aplikasi (transaksi #{tx.id})")
    if not await messaging.whatsapp_active(db):
        return
    perusahaan = await _nama_perusahaan(db, po)
    _antre(
        po.supplier_wa,
        f"💸 Pembayaran {kode(po)} ({po.number}) sebesar *{rp(tx.amount)}* sudah kami transfer "
        f"pada {tgl(hari_ini())}. Terima kasih. — {perusahaan}",
    )
    pengaju = await _pengaju(db, po)
    if pengaju is not None and pengaju.id != aktor.id:
        _antre(
            pengaju.whatsapp_chat_id,
            f"💸 {kode(po)} sudah dibayar {rp(tx.amount)} oleh {aktor.name}.",
        )


# ---------------------------------------------------------------------------
# Langkah 6: ringkasan tagihan pagi
# ---------------------------------------------------------------------------

_KUNCI_TERAKHIR = "_WA_RINGKASAN_TERAKHIR"
_JAM_BAWAAN = (7, 0)


async def ringkasan_tagihan(db: AsyncSession, tanggal: date | None = None) -> str:
    from app.services.invoice_status import paid_amount

    h = tanggal or hari_ini()
    besok = h + timedelta(days=1)
    res = await db.execute(
        select(Invoice)
        .where(
            Invoice.type == InvoiceType.IN,
            Invoice.status.in_(
                (InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE)
            ),
            Invoice.deleted_at.is_(None),
            Invoice.due_date.is_not(None),
            Invoice.due_date <= besok,
        )
        .order_by(Invoice.due_date, Invoice.id)
    )
    kelompok: dict[str, list[tuple[Invoice, Decimal]]] = {"lewat": [], "hari_ini": [], "besok": []}
    for inv in res.scalars().all():
        sisa = Decimal(inv.total or 0) - await paid_amount(db, inv.id)
        if sisa <= 0:
            continue
        kunci = "lewat" if inv.due_date < h else ("hari_ini" if inv.due_date == h else "besok")
        kelompok[kunci].append((inv, sisa))

    judul = f"🌅 *Tagihan jatuh tempo — {_HARI[h.weekday()]}, {tgl(h)}*"
    if not any(kelompok.values()):
        return f"{judul}\n\n✅ Tidak ada tagihan jatuh tempo hari ini dan besok."

    proyek_ids = {inv.project_id for daftar in kelompok.values() for inv, _ in daftar}
    proyek = {
        p.id: p.code
        for p in (await db.execute(select(Project).where(Project.id.in_(proyek_ids)))).scalars()
    }
    baris = [judul]
    total_semua = Decimal("0")
    for kunci, label in (
        ("lewat", "⚠️ *Lewat jatuh tempo*"),
        ("hari_ini", "*Hari ini*"),
        ("besok", "*Besok*"),
    ):
        daftar = kelompok[kunci]
        if kunci == "lewat" and not daftar:
            continue
        jumlah = sum((s for _, s in daftar), Decimal("0"))
        total_semua += jumlah
        baris.append("")
        baris.append(f"{label} ({len(daftar)}) — {rp(jumlah)}")
        for inv, sisa in daftar:
            ref = f"PO{inv.purchase_order_id}" if inv.purchase_order_id else inv.number
            tambahan = f" · jatuh tempo {tgl(inv.due_date)}" if kunci == "lewat" else ""
            baris.append(
                f"• {ref} · {inv.party_name or '-'} · {rp(sisa)} · {proyek.get(inv.project_id, '-')}{tambahan}"
            )
    contoh = next(
        (
            f"PO{inv.purchase_order_id}"
            for daftar in kelompok.values()
            for inv, _ in daftar
            if inv.purchase_order_id
        ),
        None,
    )
    baris += ["", f"*Total: {rp(total_semua)}*"]
    if contoh:
        baris.append(
            f"Cara bayar: kirim foto bukti transfer dengan keterangan *BAYAR {contoh}* "
            "(ganti dengan kode tagihannya)."
        )
    if any(not inv.purchase_order_id for daftar in kelompok.values() for inv, _ in daftar):
        baris.append("Tagihan tanpa kode PO dibayar dari aplikasi.")
    return "\n".join(baris)


def _jam_ringkasan() -> tuple[int, int] | None:
    """Jam kirim ringkasan (WITA) dari pengaturan WA_RINGKASAN_JAM. "mati" = tidak dikirim."""
    from app.services.app_settings import get_cached

    raw = (get_cached("WA_RINGKASAN_JAM") or "").strip().lower()
    if not raw:
        return _JAM_BAWAAN
    if raw in ("mati", "off", "-", "tidak"):
        return None
    m = re.fullmatch(r"(\d{1,2})[:.](\d{2})", raw)
    if not m or int(m.group(1)) > 23 or int(m.group(2)) > 59:
        return _JAM_BAWAAN
    return int(m.group(1)), int(m.group(2))


async def kirim_ringkasan_bila_waktunya(db: AsyncSession, sekarang: datetime | None = None) -> bool:
    """Kirim ringkasan pagi sekali sehari. Return True kalau baru saja dikirim."""
    from app.services import messaging

    if not await messaging.whatsapp_active(db):
        return False
    jam = _jam_ringkasan()
    if jam is None:
        return False
    now = (sekarang or datetime.now(WITA)).astimezone(WITA)
    if (now.hour, now.minute) < jam:
        return False
    hari = now.date().isoformat()
    row = (
        await db.execute(select(AppSetting).where(AppSetting.key == _KUNCI_TERAKHIR))
    ).scalar_one_or_none()
    if row is not None and row.value == hari:
        return False
    # Tandai dulu, baru kirim: kalau proses mati di tengah, lebih baik
    # ringkasan hari itu terlewat daripada terkirim berkali-kali.
    if row is None:
        db.add(AppSetting(key=_KUNCI_TERAKHIR, value=hari, is_secret=False, group_key="internal"))
    else:
        row.value = hari
    await db.commit()
    teks = await ringkasan_tagihan(db, now.date())
    for u in await _penyetuju(db):
        await wa.send_text(u.whatsapp_chat_id, teks)
    return True


async def penjadwal_ringkasan() -> None:
    """Loop latar (dijalankan di lifespan app): cek tiap menit."""
    from app.db.session import SessionLocal

    while True:
        try:
            async with SessionLocal() as db:
                await kirim_ringkasan_bila_waktunya(db)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("wa_po_flow: ringkasan tagihan gagal")
        await asyncio.sleep(60)


# ---------------------------------------------------------------------------
# Router pesan WA dari pengguna yang tertaut
# ---------------------------------------------------------------------------

_RE_PERINTAH = re.compile(
    r"^\s*/?(kirim|ajukan|setujui|tolak|terima|bayar|batal)\s+po\s*#?\s*(\d+)\b[ \t]*(.*)$",
    re.I | re.S,
)
_RE_TAGIHAN = re.compile(r"^\s*/?tagihan\s*$", re.I)

AmbilMedia = Callable[[], Awaitable[tuple[bytes, str] | None]]


async def _simpan_foto(ambil_media: AmbilMedia | None, subdir: str, nama: str) -> dict | str:
    """Unduh & simpan foto dari pesan WA. Return meta berkas, atau pesan galat (str)."""
    from app.services.storage.local import save_bytes

    if ambil_media is None:
        return ""
    unduh = await ambil_media()
    if unduh is None:
        return "Gagal mengunduh foto dari WhatsApp. Coba kirim ulang."
    konten, mime = unduh
    try:
        return await save_bytes(konten, original_name=nama, subdir=subdir, mime_hint=mime)
    except HTTPException as e:
        return f"Berkas tidak bisa disimpan ({e.detail}). Kirim sebagai foto atau PDF."


async def tangani_perintah(
    db: AsyncSession,
    *,
    user: User | None,
    teks: str,
    ambil_media: AmbilMedia | None = None,
) -> str | None:
    """Perintah alur PO dari pengguna tertaut. Return None kalau bukan perintah alur PO."""
    if user is None:
        # Nomor tak tertaut (pemasok) ditangani tangani_balasan_pemasok.
        return None
    if _RE_TAGIHAN.match(teks or ""):
        if user.role not in PENYETUJU:
            return "Ringkasan tagihan hanya untuk keuangan/pimpinan."
        return await ringkasan_tagihan(db)

    m = _RE_PERINTAH.match(teks or "")
    if not m:
        return None
    aksi, po_id, sisa = m.group(1).lower(), int(m.group(2)), (m.group(3) or "").strip()
    po = await ambil_po(db, po_id)
    if po is None or not await _boleh_akses(db, user, po):
        return f"PO{po_id} tidak ditemukan."

    if aksi == "kirim":
        if user.role == UserRole.EXECUTIVE:
            return "Akun Anda hanya bisa melihat."
        if sisa:
            nomor = normalisasi_wa(sisa.split()[0])
            if not nomor:
                return f"Nomor WA pemasok tidak terbaca. Contoh: *KIRIM {kode(po)} 08123456789*"
            po.supplier_wa = nomor
        return await kirim_ke_pemasok(db, po, user)
    if aksi == "ajukan":
        return await ajukan(db, user, po)
    if aksi == "setujui":
        return await setujui(db, user, po)
    if aksi == "tolak":
        return await tolak(db, user, po, sisa)
    if aksi == "batal":
        return await batal(db, user, po)
    if aksi == "terima":
        if ambil_media is None:
            return f"Kirim *foto surat jalan* dengan keterangan *TERIMA {kode(po)}*."
        if po.wa_tahap != FINAL:
            return f"{kode(po)} belum bisa diterima: {LABEL_TAHAP.get(po.wa_tahap or '', 'bukan alur WA')}."
        berkas = await _simpan_foto(
            ambil_media, f"invoices/po-{po.id}", f"surat-jalan-{kode(po)}.jpg"
        )
        if isinstance(berkas, str):
            return berkas
        return await terima(db, user, po, berkas)
    if aksi == "bayar":
        if ambil_media is None:
            return f"Kirim *foto bukti transfer* dengan keterangan *BAYAR {kode(po)}*."
        if user.role not in PENYETUJU:
            return "Hanya keuangan/pimpinan yang bisa mencatat pembayaran."
        if po.wa_tahap != DITERIMA:
            return f"{kode(po)} belum bisa dibayar: {LABEL_TAHAP.get(po.wa_tahap or '', 'bukan alur WA')}."
        berkas = await _simpan_foto(
            ambil_media, f"transactions/po-{po.id}", f"bukti-{kode(po)}.jpg"
        )
        if isinstance(berkas, str):
            return berkas
        return await bayar(db, user, po, berkas)
    return None
