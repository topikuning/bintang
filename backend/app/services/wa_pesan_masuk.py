"""Penyaring pesan WA ganda.

Dua sumber pesan ganda yang pernah terjadi di produksi (KAS1, 22 Nov 2026):

1. WAHA mengirim ulang webhook yang sama bila balasan kami lambat (BAYAR
   mengunduh foto lalu meneruskannya ke penerima dana). `msg_id` sama.
2. WhatsApp mengirim foto HD sebagai pesan kedua dengan keterangan yang
   sama. `msg_id` berbeda, isi teks sama, selang beberapa detik.

Akibatnya pesan kedua dibalas "KAS1 sudah tercatat ditransfer sebelumnya".
"""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import WaPesanMasuk

# Teks yang sama dari chat yang sama dalam selang ini dianggap pesan ganda.
DETIK_ULANG = 90
_SIMPAN_HARI = 7


def sidik(teks: str | None) -> str | None:
    norm = " ".join((teks or "").lower().split())
    if not norm:
        return None
    return hashlib.sha256(norm.encode()).hexdigest()


async def catat(
    db: AsyncSession, *, chat_id: str, msg_id: str | None, teks: str | None
) -> tuple[int | None, str | None]:
    """Catat pesan masuk. Return (id baris, alasan_lewati).

    alasan_lewati berisi "duplikat" (msg_id sama) atau "ulang" (teks sama
    dalam DETIK_ULANG detik; isi `teks` hanya untuk pesan berfoto); None bila
    pesan baru dan harus diproses.
    Baris di-commit segera supaya kiriman ulang yang datang bersamaan
    langsung tertolak.
    """
    s = sidik(teks)
    sekarang = datetime.now(UTC)
    if s is not None:
        ada = (
            await db.execute(
                select(WaPesanMasuk.id)
                .where(
                    WaPesanMasuk.chat_id == chat_id,
                    WaPesanMasuk.sidik == s,
                    WaPesanMasuk.created_at >= sekarang - timedelta(seconds=DETIK_ULANG),
                )
                .limit(1)
            )
        ).scalar_one_or_none()
        if ada is not None:
            return None, "ulang"
    baris = WaPesanMasuk(msg_id=msg_id or None, chat_id=chat_id, sidik=s, created_at=sekarang)
    db.add(baris)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        return None, "duplikat"
    # Bersihkan catatan lama sesekali (murah: berbasis indeks waktu).
    if baris.id % 50 == 0:
        await db.execute(
            delete(WaPesanMasuk).where(
                WaPesanMasuk.created_at < sekarang - timedelta(days=_SIMPAN_HARI)
            )
        )
        await db.commit()
    return baris.id, None


async def lupakan(db: AsyncSession, baris_id: int | None) -> None:
    """Hapus catatan bila pemrosesan gagal, supaya kiriman ulang WAHA tetap
    diproses."""
    if baris_id is None:
        return
    await db.rollback()
    await db.execute(delete(WaPesanMasuk).where(WaPesanMasuk.id == baris_id))
    await db.commit()
