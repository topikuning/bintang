"""Halaman isi harga untuk pemasok, TANPA login.

Pemasok menerima tautan `/penawaran/<token>` di pesan WhatsApp pesanan.
Token ditandatangani (HMAC, kunci khusus "penawaran"), hanya berlaku untuk
satu PO, kedaluwarsa 30 hari, dan hanya bisa dipakai selama PO masih
menunggu jawaban pemasok. Hasilnya sama persis dengan membalas UBAH/SETUJU/
TOLAK di WhatsApp (lihat `wa_po_flow.terapkan_balasan`).
"""

from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.services import wa_po_flow

router = APIRouter()


class BarangOut(BaseModel):
    no: int
    uraian: str
    jumlah: Decimal
    satuan: str | None
    harga: Decimal


class PenawaranOut(BaseModel):
    kode: str
    nomor: str
    perusahaan: str
    proyek: str | None
    pemasok: str
    barang: list[BarangOut]
    tempo_hari: int | None
    terbuka: bool
    keadaan: str


class PenawaranIn(BaseModel):
    aksi: str = Field(pattern="^(kirim|tolak)$")
    # Harga per nomor barang (1..n). Kunci string karena JSON.
    harga: dict[str, Decimal] = Field(default_factory=dict)
    tempo_hari: int | None = Field(default=None, ge=0, le=365)
    alasan: str | None = Field(default=None, max_length=500)


class HasilOut(BaseModel):
    ok: bool
    pesan: str


async def _po_dari_token(db: AsyncSession, token: str):
    po_id = wa_po_flow.baca_token_penawaran(token)
    po = await wa_po_flow.ambil_po(db, po_id) if po_id else None
    if po is None or po.deleted_at is not None or not po.supplier_wa:
        raise HTTPException(404, "tautan_tidak_berlaku")
    return po


def _tanpa_tembolok(response: Response) -> None:
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["Referrer-Policy"] = "no-referrer"


@router.get("/{token}", response_model=PenawaranOut)
async def lihat_penawaran(
    token: str, response: Response, db: AsyncSession = Depends(get_db)
) -> PenawaranOut:
    _tanpa_tembolok(response)
    po = await _po_dari_token(db, token)
    proyek = await wa_po_flow._proyek(db, po)
    terbuka = po.wa_tahap == wa_po_flow.MENUNGGU_PEMASOK
    return PenawaranOut(
        kode=wa_po_flow.kode(po),
        nomor=po.number,
        perusahaan=await wa_po_flow._nama_perusahaan(db, po),
        proyek=proyek.name if proyek else None,
        pemasok=await wa_po_flow._nama_pemasok(db, po),
        barang=[
            BarangOut(
                no=i,
                uraian=it.description,
                jumlah=Decimal(it.quantity or 0),
                satuan=it.unit,
                harga=Decimal(it.unit_price or 0),
            )
            for i, it in enumerate(po.items, start=1)
        ],
        tempo_hari=po.tempo_days,
        terbuka=terbuka,
        keadaan="menunggu jawaban Anda"
        if terbuka
        else wa_po_flow.LABEL_TAHAP.get(po.wa_tahap or "", "sudah diproses"),
    )


@router.post("/{token}", response_model=HasilOut)
async def kirim_penawaran(
    token: str,
    payload: PenawaranIn,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> HasilOut:
    _tanpa_tembolok(response)
    po = await _po_dari_token(db, token)
    if po.wa_tahap != wa_po_flow.MENUNGGU_PEMASOK:
        raise HTTPException(409, "sudah_dijawab")

    if payload.aksi == "tolak":
        b = wa_po_flow.BalasanPemasok("tolak", alasan=(payload.alasan or "").strip())
    else:
        try:
            harga = {int(k): v for k, v in payload.harga.items()}
        except ValueError:
            raise HTTPException(422, "nomor_barang_tidak_sah") from None
        if any(v < 0 for v in harga.values()):
            raise HTTPException(422, "harga_tidak_boleh_negatif")
        b = wa_po_flow.BalasanPemasok(
            "ubah", harga={k: v for k, v in harga.items() if v > 0}, tempo=payload.tempo_hari
        )

    wa_po_flow.buka_kotak()
    hasil = await wa_po_flow.terapkan_balasan(db, po, b)
    if not hasil.ok:
        await db.rollback()
        raise HTTPException(422, hasil.pesan.replace("*", ""))
    # Salinan jawaban juga dikirim ke WA pemasok sebagai tanda terima.
    wa_po_flow._antre(po.supplier_wa, hasil.pesan)
    await db.commit()
    await wa_po_flow.kirim_kotak()
    return HasilOut(ok=True, pesan=hasil.pesan.replace("*", ""))
