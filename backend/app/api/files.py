"""Penyajian berkas upload dengan autentikasi + cek akses proyek.

Audit 2026-06-13 #S-03. Sebelumnya `main.py` memasang:

    app.mount("/files", StaticFiles(directory=UPLOAD_DIR))

-- seluruh bukti transaksi, lampiran invoice, dan dokumen proyek
terbuka untuk siapa pun yang tahu URL-nya, tanpa login. Nama berkas
memang mengandung token acak, tapi itu keamanan lewat URL rahasia:
URL bocor lewat riwayat browser, log proxy, dan forward chat, lalu
berlaku selamanya.

Router ini menggantikannya di prefix yang SAMA (`/files/...`) supaya
URL yang sudah tersimpan di DB dan sudah beredar tetap bekerja.

Dua tingkat otorisasi:

1. Berkas yang terdaftar sebagai lampiran (transaksi / invoice / proyek)
   -> resolve ke project_id, lalu `ensure_project_access()`. User yang
   tidak berhak dapat 404, konsisten dengan kerahasiaan bucket
   Non-Proyek di endpoint lain.
2. Berkas lain (logo perusahaan, hasil OCR sementara, dokumen kontrak
   yang belum ter-attach) -> cukup wajib login. Ini tetap menutup akses
   anonim, tanpa memblokir alur yang belum punya baris lampiran.

Autentikasi menerima dua sumber, karena `<img src="...">` tidak bisa
mengirim header Authorization:

- Header `Authorization: Bearer <jwt>` -- dipakai fetch/XHR.
- Cookie HttpOnly `bintang_files` -- di-set saat login, dibaca oleh tag
  <img>/<a> di SPA. Cookie ini `SameSite=Strict` sehingga TIDAK PERNAH
  ikut pada request lintas-situs, dan hanya berlaku di path `/files`
  sehingga tidak menambah permukaan CSRF pada endpoint API yang mengubah
  data (API tetap Bearer-only). Lihat `_set_file_cookie()` di
  api/v1/auth.py untuk alasan Strict dipilih di atas Lax.
"""

from __future__ import annotations

import mimetypes

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import ensure_project_access, resolve_user_from_token
from app.db.session import get_db
from app.models.models import (
    Invoice,
    InvoiceAttachment,
    ProjectAttachment,
    Transaction,
    TransactionAttachment,
    User,
)
from app.services.storage.paths import (
    FILES_PREFIX,
    UnsafeUploadPath,
    resolve_upload_path,
)

router = APIRouter()

FILE_COOKIE_NAME = "bintang_files"

# Tipe yang aman di-render inline di browser. Sisanya dipaksa download
# supaya berkas apa pun yang lolos ke storage tidak bisa dieksekusi
# sebagai halaman di origin kita (audit #S-05).
INLINE_SAFE_MIME = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "application/pdf",
}


async def _authenticate(request: Request, db: AsyncSession) -> User:
    """Ambil user dari header Bearer atau cookie berkas."""
    token: str | None = None
    header = request.headers.get("authorization")
    if header and header.lower().startswith("bearer "):
        token = header[7:].strip()
    if not token:
        token = request.cookies.get(FILE_COOKIE_NAME)
    if not token:
        raise HTTPException(401, "not_authenticated")
    return await resolve_user_from_token(db, token)


async def _project_id_for(db: AsyncSession, url: str) -> int | None:
    """project_id pemilik berkas, atau None kalau tidak terdaftar."""
    row = (await db.execute(
        select(Transaction.project_id)
        .join(TransactionAttachment, TransactionAttachment.transaction_id == Transaction.id)
        .where(TransactionAttachment.url == url)
        .limit(1)
    )).scalar_one_or_none()
    if row is not None:
        return row

    row = (await db.execute(
        select(Invoice.project_id)
        .join(InvoiceAttachment, InvoiceAttachment.invoice_id == Invoice.id)
        .where(InvoiceAttachment.url == url)
        .limit(1)
    )).scalar_one_or_none()
    if row is not None:
        return row

    return (await db.execute(
        select(ProjectAttachment.project_id)
        .where(ProjectAttachment.url == url)
        .limit(1)
    )).scalar_one_or_none()


@router.get("/files/{file_path:path}")
async def serve_upload(
    file_path: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> FileResponse:
    user = await _authenticate(request, db)

    try:
        target = resolve_upload_path(file_path)
    except UnsafeUploadPath:
        # Jangan bedakan "path jahat" dari "tidak ada" -- keduanya 404.
        raise HTTPException(404, "not_found") from None
    except FileNotFoundError:
        raise HTTPException(404, "not_found") from None

    url = FILES_PREFIX + file_path
    project_id = await _project_id_for(db, url)
    if project_id is not None:
        # ensure_project_access sudah balas 404 (bukan 403) utk proyek
        # yang tidak boleh diketahui keberadaannya.
        await ensure_project_access(db, user, project_id)

    mime = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    disposition = "inline" if mime in INLINE_SAFE_MIME else "attachment"
    return FileResponse(
        target,
        media_type=mime,
        headers={
            "Content-Disposition": f'{disposition}; filename="{target.name}"',
            # Berkas keuangan: jangan pernah masuk cache bersama.
            "Cache-Control": "private, max-age=300",
            "X-Content-Type-Options": "nosniff",
        },
    )
