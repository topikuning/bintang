from __future__ import annotations

import secrets
from datetime import datetime
from pathlib import Path

import aiofiles
from fastapi import HTTPException, UploadFile

from app.core.config import settings

# Ekstensi kanonik per MIME. Audit 2026-06-13 #S-05: ekstensi berkas
# TIDAK BOLEH diambil dari nama kiriman user -- lampiran bot dulu
# memakai `Path(original_name).suffix`, sehingga dokumen bernama
# "x.html" tersimpan sbg .html lalu disajikan sbg text/html di origin
# API kita.
#
# Daftar MIME yang diizinkan DITURUNKAN dari tabel ini, bukan ditulis
# terpisah. Kalau keduanya jadi dua daftar yang harus dijaga sinkron,
# cepat atau lambat ada MIME yang lolos whitelist tapi tidak punya
# ekstensi -> KeyError saat upload.
_EXT_BY_MIME = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/heic": ".heic",
    "image/heif": ".heif",
    "application/pdf": ".pdf",
    # Video hanya untuk lampiran bot -- lihat BOT_ALLOWED_MIME.
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
}

_VIDEO_MIME = {"video/mp4", "video/quicktime"}

# Whitelist form web: gambar + PDF.
ALLOWED_MIME = set(_EXT_BY_MIME) - _VIDEO_MIME

# Lampiran dari bot (Telegram/WhatsApp) boleh sedikit lebih luas: video
# pendek dipakai sbg bukti lapangan dan sudah didukung sebelum audit.
# Aman karena `/files` menyajikan apa pun di luar INLINE_SAFE_MIME sbg
# `Content-Disposition: attachment`, jadi tidak ada konten aktif yang
# bisa dieksekusi di origin kita.
BOT_ALLOWED_MIME = set(_EXT_BY_MIME)

# Resize batas dimensi maksimal: cocok untuk bukti transaksi -- masih jelas
# saat di-zoom tapi tidak boros space.
IMAGE_MAX_DIM = 2000
IMAGE_QUALITY = 82


def _optimize_image(target: Path, content_type: str) -> int:
    """Resize + recompress gambar di tempat. Return ukuran final (bytes).
    Kalau optimasi gagal (misal HEIC tanpa pillow-heif), pertahankan file asli.
    """
    try:
        from PIL import Image, ImageOps
    except Exception:
        return target.stat().st_size

    try:
        with Image.open(target) as img:
            img = ImageOps.exif_transpose(img)  # apply EXIF orientation
            fmt = (img.format or "").upper()

            # tentukan target format & save kwargs
            if fmt in ("JPEG", "MPO"):
                save_fmt = "JPEG"
                save_kwargs = {"quality": IMAGE_QUALITY, "optimize": True, "progressive": True}
                if img.mode != "RGB":
                    img = img.convert("RGB")
            elif fmt == "PNG":
                save_fmt = "PNG"
                save_kwargs = {"optimize": True}
            elif fmt == "WEBP":
                save_fmt = "WEBP"
                save_kwargs = {"quality": IMAGE_QUALITY, "method": 6}
            elif fmt == "GIF":
                # animated GIF: jangan diutak-atik
                return target.stat().st_size
            else:
                # HEIC/HEIF/lainnya yang Pillow bisa baca -> konversi ke JPEG
                save_fmt = "JPEG"
                save_kwargs = {"quality": IMAGE_QUALITY, "optimize": True, "progressive": True}
                if img.mode != "RGB":
                    img = img.convert("RGB")

            # resize kalau lebih besar dari batas (preserve aspect ratio)
            if img.size[0] > IMAGE_MAX_DIM or img.size[1] > IMAGE_MAX_DIM:
                img.thumbnail((IMAGE_MAX_DIM, IMAGE_MAX_DIM), Image.LANCZOS)

            img.save(target, format=save_fmt, **save_kwargs)
    except Exception as e:  # noqa: BLE001
        # jangan blok upload kalau optimasi gagal
        print(f"[storage] image optimize skipped for {target.name}: {e}")

    return target.stat().st_size


async def save_bytes(
    content: bytes,
    *,
    original_name: str,
    subdir: str,
    mime_hint: str | None = None,
) -> dict:
    """Simpan bytes mentah ke uploads. Dipakai mis. oleh integrasi
    Telegram yang sudah pegang file dari Bot API.

    Skema penyimpanan & optimasi gambar identik dengan save_upload --
    termasuk whitelist MIME (audit #S-05).

    Raises:
        HTTPException 415: `mime_hint` (atau tebakan dari ekstensi asal)
            tidak ada di ALLOWED_MIME.
        HTTPException 413: melebihi MAX_UPLOAD_MB.
    """
    # Tentukan MIME dulu -- ia yang menentukan ekstensi, bukan sebaliknya.
    mime = (mime_hint or "").split(";")[0].strip().lower()
    if not mime:
        # Tidak ada hint (mis. foto Telegram tanpa nama) -> tebak dari
        # ekstensi asal, tapi hasil tebakan tetap harus lolos whitelist.
        guessed = Path(original_name or "").suffix.lower()
        mime = {
            ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".png": "image/png", ".webp": "image/webp",
            ".gif": "image/gif", ".heic": "image/heic", ".heif": "image/heif",
            ".pdf": "application/pdf",
            ".mp4": "video/mp4", ".mov": "video/quicktime",
        }.get(guessed, "")
    if mime not in BOT_ALLOWED_MIME:
        raise HTTPException(415, f"unsupported_media_type: {mime or '(tidak dikenal)'}")

    max_bytes = settings.MAX_UPLOAD_MB * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(413, f"file_too_large_max_{settings.MAX_UPLOAD_MB}_mb")

    base = Path(settings.UPLOAD_DIR) / subdir / datetime.utcnow().strftime("%Y/%m")
    base.mkdir(parents=True, exist_ok=True)

    suffix = _EXT_BY_MIME[mime]
    safe_name = f"{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{secrets.token_hex(6)}{suffix}"
    target = base / safe_name

    async with aiofiles.open(target, "wb") as out:
        await out.write(content)

    size = target.stat().st_size
    if mime.startswith("image/"):
        size = _optimize_image(target, mime)

    rel = target.relative_to(Path(settings.UPLOAD_DIR)).as_posix()
    return {
        "file_name": original_name or safe_name,
        "file_size": size,
        "mime_type": mime,
        "url": f"/files/{rel}",
    }


async def save_upload(file: UploadFile, subdir: str) -> dict:
    if file.content_type not in ALLOWED_MIME:
        raise HTTPException(415, f"unsupported_media_type: {file.content_type}")
    base = Path(settings.UPLOAD_DIR) / subdir / datetime.utcnow().strftime("%Y/%m")
    base.mkdir(parents=True, exist_ok=True)

    # Ekstensi dari MIME yg sudah lolos whitelist di atas, bukan dari
    # nama kiriman user (audit #S-05).
    suffix = _EXT_BY_MIME[file.content_type]
    safe_name = f"{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{secrets.token_hex(6)}{suffix}"
    target = base / safe_name

    max_bytes = settings.MAX_UPLOAD_MB * 1024 * 1024
    size = 0
    async with aiofiles.open(target, "wb") as out:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > max_bytes:
                await out.close()
                target.unlink(missing_ok=True)
                raise HTTPException(413, f"file_too_large_max_{settings.MAX_UPLOAD_MB}_mb")
            await out.write(chunk)

    # Optimasi gambar (PDF dilewatkan)
    if file.content_type and file.content_type.startswith("image/"):
        size = _optimize_image(target, file.content_type)

    rel = target.relative_to(Path(settings.UPLOAD_DIR)).as_posix()
    url = f"/files/{rel}"
    return {
        "file_name": file.filename or safe_name,
        "file_size": size,
        "mime_type": file.content_type,
        "url": url,
    }
