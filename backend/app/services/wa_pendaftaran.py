"""Pendaftaran otomatis peminta material lewat WhatsApp.

Nomor yang belum tertaut lalu mengirim `/po` TIDAK ditolak:
- Nomor itu sudah ada di data pengguna (kolom telepon) -> langsung ditautkan
  ke akun tersebut, lalu /po diproses seperti biasa.
- Nomor baru -> akun dibuat otomatis (tanpa kata sandi, tanpa anggota
  proyek; hanya bisa mengajukan pesanan material), lalu sistem menanyakan
  nama. Setelah nama dibalas, /po yang tertunda langsung diproses dan
  keuangan/pimpinan diberi tahu ada pengguna baru.
"""

from __future__ import annotations

import logging
import re
import secrets
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.models.models import User, UserRole
from app.services.whatsapp.phone import normalisasi_wa, tampil_nomor

logger = logging.getLogger(__name__)

_RE_PO = re.compile(r"^\s*/(po|kas|dana)\b", re.I)
_RE_NAMA = re.compile(r"^[^\W\d_][\w .,'-]{1,59}$", re.U)


def minta_po(teks: str | None) -> bool:
    return bool(_RE_PO.match(teks or ""))


@dataclass
class HasilDaftar:
    user: User | None
    baru: bool  # True = akun baru, sedang menunggu nama
    pesan: str = ""  # balasan untuk pengirim (bila tidak lanjut)


async def _cari_berdasar_telepon(db: AsyncSession, nomor: str) -> User | None:
    res = await db.execute(select(User).where(User.phone.is_not(None)))
    for u in res.scalars().all():
        if normalisasi_wa(u.phone) == nomor:
            return u
    return None


async def _email_unik(db: AsyncSession, digit: str) -> str:
    dasar = f"wa{digit}"
    calon, n = f"{dasar}@pengguna-wa.bintang", 1
    while (await db.execute(select(User.id).where(User.email == calon))).first():
        n += 1
        calon = f"{dasar}-{n}@pengguna-wa.bintang"
    return calon


async def tautkan_atau_daftar(
    db: AsyncSession,
    *,
    chat_id: str,
    nomor: str | None,
    teks: str,
    ada_foto: bool = False,
) -> HasilDaftar:
    """Dipanggil saat nomor tak tertaut mengirim /po."""
    if nomor:
        lama = await _cari_berdasar_telepon(db, nomor)
        if lama is not None:
            if not lama.is_active:
                return HasilDaftar(
                    None,
                    False,
                    "Nomor ini terdaftar atas akun yang dinonaktifkan. Hubungi admin.",
                )
            lama.whatsapp_chat_id = chat_id
            await db.flush()
            return HasilDaftar(lama, False)

    digit = re.sub(r"\D", "", (nomor or chat_id).split("@", 1)[0])
    u = User(
        email=await _email_unik(db, digit),
        name=f"Pengguna {tampil_nomor(nomor) if nomor else digit}",
        # Kata sandi acak yang tidak diketahui siapa pun: akun ini tidak bisa
        # masuk web sampai admin mengaturnya.
        password_hash=hash_password(secrets.token_urlsafe(32)),
        role=UserRole.PROJECT_ADMIN,
        phone=tampil_nomor(nomor) if nomor else None,
        whatsapp_chat_id=chat_id,
        daftar_via_wa=True,
        # Foto tidak bisa ditunda: minta dikirim ulang setelah nama.
        wa_tunda="" if ada_foto else teks,
    )
    db.add(u)
    await db.flush()
    pesan = (
        "Halo! Nomor ini belum terdaftar, jadi kami daftarkan sekarang.\n"
        "*Siapa nama Anda?* Balas dengan nama saja."
    )
    if ada_foto:
        pesan += "\nSetelah itu, kirim ulang fotonya dengan keterangan /po."
    return HasilDaftar(u, True, pesan)


async def terima_nama(db: AsyncSession, user: User, teks: str) -> tuple[str, str | None]:
    """Simpan nama dari balasan. Return (balasan, pesan /po tertunda atau None)."""
    nama = " ".join((teks or "").split())
    if minta_po(nama):
        # Mengirim /po lagi sebelum menjawab nama: simpan yang terbaru.
        user.wa_tunda = teks
        return "Sebelum lanjut, *siapa nama Anda?* Balas dengan nama saja.", None
    if not _RE_NAMA.match(nama):
        return "Mohon balas dengan nama Anda saja (huruf, 2-60 karakter).", None
    tunda = user.wa_tunda or None
    user.name = nama.title() if nama.islower() or nama.isupper() else nama
    user.wa_tunda = None
    await _kabari_penyetuju(db, user)
    return f"Terima kasih, {user.name}. Nomor Anda sudah terdaftar.", tunda


async def _kabari_penyetuju(db: AsyncSession, user: User) -> None:
    from app.services import wa_po_flow

    teks = (
        f"👤 *Pengguna baru lewat WhatsApp*: {user.name} ({user.phone or '-'}).\n"
        "Akun ini hanya bisa mengajukan pesanan material (/po) dan pengajuan kas "
        "(/kas), dan tidak bisa melihat data lain. Bila tidak dikenal, nonaktifkan di menu Pengguna."
    )
    for u in await wa_po_flow._penyetuju(db, kecuali_id=user.id):
        wa_po_flow._antre(u.whatsapp_chat_id, teks)
