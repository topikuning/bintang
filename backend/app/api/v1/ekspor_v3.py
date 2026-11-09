"""Ekspor seluruh data + berkas ke Bintang v3 (sekali pakai saat pindahan).

Bintang v3 berjalan di server lain (Lenovo) dan MENARIK data dari sini lewat
API ini – bukan sebaliknya – karena volume Railway tempat lampiran disimpan
tidak bisa dijangkau dari luar, dan satu arsip raksasa tidak bisa dilanjutkan
bila unduhannya putus. Dengan API per-tabel dan per-berkas, importer v3 bisa
mengulang dari titik putus dan memeriksa ukuran tiap berkas.

KEAMANAN – baca sebelum mengaktifkan:
- Mati secara bawaan. Aktif hanya bila env `EKSPOR_V3_TOKEN` diisi (minimal
  32 karakter). Selama mati, semua rute membalas 404 seolah tidak ada.
- Token ini membuka SELURUH data, termasuk hash password dan nomor rekening
  yang sudah didekripsi. Isi hanya selama pindahan, lalu kosongkan lagi dan
  redeploy.
- Sengaja tidak memakai JWT pengguna: importer berjalan tanpa orang yang
  login, dan hak sebesar ini tidak boleh menempel pada akun siapa pun.
- Setiap akses manifest dicatat di log aplikasi.
"""

from __future__ import annotations

import logging
import os
import secrets
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import get_db
from app.services.field_crypto import decrypt_field
from app.services.storage.paths import UnsafeUploadPath, resolve_upload_path, upload_root

router = APIRouter()
log = logging.getLogger("bintang.ekspor_v3")

VERSI_FORMAT = 1
TOKEN_MIN = 32
BATAS_HALAMAN = 2000

# Tabel yang diekspor. Daftar putih: nama tabel tidak pernah datang dari
# pengguna mentah-mentah ke SQL.
TABEL: tuple[str, ...] = (
    "users",
    "companies",
    "projects",
    "project_users",
    "project_attachments",
    "categories",
    "vendors_clients",
    "transactions",
    "transaction_items",
    "transaction_attachments",
    "cash_advance_settlements",
    "cash_advance_settlement_items",
    "cash_requests",
    "cash_request_items",
    "invoices",
    "invoice_items",
    "invoice_allocations",
    "invoice_attachments",
    "purchase_orders",
    "po_items",
)

# Kolom tersandi (Fernet, lihat services/field_crypto.py) – dibuka di sini
# supaya v3 tidak perlu tahu SECRET_KEY aplikasi lama.
KOLOM_TERSANDI: dict[str, tuple[str, ...]] = {
    "companies": ("bank_account",),
    "vendors_clients": ("bank_account",),
    "transactions": ("party_account",),
}


def _token_aktif() -> str | None:
    t = (getattr(settings, "EKSPOR_V3_TOKEN", "") or "").strip()
    return t if len(t) >= TOKEN_MIN else None


def wajib_token(x_ekspor_token: str | None = Header(default=None)) -> None:
    """Mati = 404 (tidak membocorkan keberadaan); token salah = 401."""
    aktif = _token_aktif()
    if aktif is None:
        raise HTTPException(404, "Not Found")
    if not x_ekspor_token or not secrets.compare_digest(x_ekspor_token, aktif):
        raise HTTPException(401, "token_ekspor_salah")


def _json_aman(v: Any) -> Any:
    if isinstance(v, Decimal):
        return str(v)
    # SQLite mengembalikan NUMERIC sebagai float; kirim sebagai teks supaya
    # penerima tidak membaca angka uang lewat float JSON.
    if isinstance(v, float):
        return repr(v)
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, bytes):
        return None
    return v


def _daftar_berkas() -> list[dict[str, Any]]:
    root = upload_root()
    if not root.exists():
        return []
    out: list[dict[str, Any]] = []
    for dirpath, dirnames, filenames in os.walk(root):
        # Lewati direktori tersembunyi (.tmp, .cache, dsb.).
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for name in filenames:
            if name.startswith("."):
                continue
            p = os.path.join(dirpath, name)
            try:
                st = os.stat(p)
            except OSError:
                continue
            rel = os.path.relpath(p, root).replace(os.sep, "/")
            out.append({"path": rel, "size": st.st_size, "mtime": int(st.st_mtime)})
    out.sort(key=lambda x: x["path"])
    return out


@router.get("/manifest", dependencies=[Depends(wajib_token)])
async def manifest(db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    jumlah: dict[str, int] = {}
    for t in TABEL:
        jumlah[t] = int((await db.execute(text(f'SELECT COUNT(*) FROM "{t}"'))).scalar_one())
    berkas = _daftar_berkas()
    log.warning(
        "Manifest ekspor v3 diakses: %s baris, %s berkas.",
        sum(jumlah.values()),
        len(berkas),
    )
    return {
        "versi": VERSI_FORMAT,
        "aplikasi": settings.APP_NAME,
        "dibuat": datetime.now().astimezone().isoformat(),
        "tabel": jumlah,
        "berkas": {"jumlah": len(berkas), "total_bytes": sum(b["size"] for b in berkas)},
    }


@router.get("/tabel/{nama}", dependencies=[Depends(wajib_token)])
async def tabel(
    nama: str,
    offset: int = Query(0, ge=0),
    limit: int = Query(BATAS_HALAMAN, ge=1, le=BATAS_HALAMAN),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    if nama not in TABEL:
        raise HTTPException(404, "tabel_tidak_dikenal")
    res = await db.execute(
        text(f'SELECT * FROM "{nama}" ORDER BY id LIMIT :limit OFFSET :offset'),
        {"limit": limit, "offset": offset},
    )
    kolom = list(res.keys())
    tersandi = KOLOM_TERSANDI.get(nama, ())
    rows: list[dict[str, Any]] = []
    for r in res.all():
        d = dict(zip(kolom, r, strict=True))
        for k in tersandi:
            if d.get(k):
                d[k] = decrypt_field(d[k])
        rows.append({k: _json_aman(v) for k, v in d.items()})
    return {"tabel": nama, "offset": offset, "rows": rows, "lanjut": len(rows) == limit}


@router.get("/berkas", dependencies=[Depends(wajib_token)])
async def daftar_berkas() -> dict[str, Any]:
    return {"berkas": _daftar_berkas()}


@router.get("/berkas/{path:path}", dependencies=[Depends(wajib_token)])
async def unduh_berkas(path: str) -> FileResponse:
    try:
        p = resolve_upload_path(path, must_exist=True)
    except (UnsafeUploadPath, FileNotFoundError) as e:
        raise HTTPException(404, "berkas_tidak_ada") from e
    # FileResponse melayani header Range – unduhan besar bisa dilanjutkan.
    return FileResponse(p, media_type="application/octet-stream")
