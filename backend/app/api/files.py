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
2. Upload OCR/kontrak -> hanya pemilik upload atau admin.
3. Logo/kop perusahaan dan berkas legacy tanpa metadata pemilik -> admin.
   Berkas yang sama sekali tidak dikenal ditolak untuk non-admin.

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
from dataclasses import dataclass

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import ensure_project_access, resolve_user_from_token
from app.db.session import get_db
from app.models.models import (
    AIExtraction,
    Company,
    Invoice,
    InvoiceAttachment,
    OCRJob,
    ProjectAttachment,
    Transaction,
    TransactionAttachment,
    User,
    UserRole,
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
    # Varian non-standar yang dipakai sebagian klien; ada di
    # ALLOWED_MIME storage, jadi harus ikut boleh inline.
    "image/jpg",
    "image/png",
    "image/webp",
    "image/gif",
    # Foto dari iPhone. Tidak semua browser bisa merendernya, tapi itu
    # keputusan browser -- memaksanya jadi unduhan menjamin gagal.
    "image/heic",
    "image/heif",
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


@dataclass(frozen=True)
class FileAccess:
    project_id: int | None = None
    owner_id: int | None = None
    admin_only: bool = False
    mime_type: str | None = None


async def _attachment_meta(db: AsyncSession, url: str) -> FileAccess | None:
    """Metadata otorisasi dan MIME untuk URL berkas tersimpan.

    `mime_type` diambil dari DB, BUKAN ditebak dari nama berkas.
    Alasannya: upload lama menyimpan ekstensi dari nama kiriman user,
    sehingga foto dari kamera yang tidak punya ekstensi tersimpan sbg
    `.bin`. Menebak dari nama itu menghasilkan
    `application/octet-stream` -> disajikan sbg unduhan -> gambar tidak
    pernah tampil. Kolom `mime_type` sudah menyimpan nilai yang benar
    sejak awal, jadi itu yang dipakai.

    Mengembalikan None kalau URL tidak direferensikan tabel mana pun.
    """
    for stmt in (
        select(Transaction.project_id, TransactionAttachment.mime_type)
        .join(TransactionAttachment, TransactionAttachment.transaction_id == Transaction.id)
        .where(TransactionAttachment.url == url)
        .limit(1),
        select(Invoice.project_id, InvoiceAttachment.mime_type)
        .join(InvoiceAttachment, InvoiceAttachment.invoice_id == Invoice.id)
        .where(InvoiceAttachment.url == url)
        .limit(1),
        select(ProjectAttachment.project_id, ProjectAttachment.mime_type)
        .where(ProjectAttachment.url == url)
        .limit(1),
    ):
        row = (await db.execute(stmt)).first()
        if row is not None:
            return FileAccess(project_id=row[0], mime_type=row[1])

    owner_id = (
        await db.execute(select(OCRJob.user_id).where(OCRJob.source_url == url).limit(1))
    ).scalar_one_or_none()
    if owner_id is not None:
        return FileAccess(owner_id=owner_id)

    extraction = (
        await db.execute(
            select(AIExtraction.user_id).where(AIExtraction.source_url == url).limit(1)
        )
    ).first()
    if extraction is not None:
        owner_id = extraction[0]
        return FileAccess(owner_id=owner_id, admin_only=owner_id is None)

    company_asset = (
        await db.execute(
            select(Company.id)
            .where(or_(Company.logo_url == url, Company.letterhead_url == url))
            .limit(1)
        )
    ).scalar_one_or_none()
    if company_asset is not None:
        return FileAccess(admin_only=True)

    return None


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
    access = await _attachment_meta(db, url)
    is_admin = user.role in (UserRole.SUPERADMIN, UserRole.CENTRAL_ADMIN)
    if access is None and not is_admin:
        raise HTTPException(404, "not_found")
    if access and access.project_id is not None:
        # ensure_project_access sudah balas 404 (bukan 403) utk proyek
        # yang tidak boleh diketahui keberadaannya.
        await ensure_project_access(db, user, access.project_id)
    if access and access.owner_id is not None and access.owner_id != user.id and not is_admin:
        raise HTTPException(404, "not_found")
    if access and access.admin_only and not is_admin:
        raise HTTPException(404, "not_found")

    # MIME tersimpan menang atas tebakan dari nama berkas -- lihat
    # catatan di _attachment_meta().
    mime = (
        (access.mime_type if access else None)
        or mimetypes.guess_type(target.name)[0]
        or "application/octet-stream"
    )
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
