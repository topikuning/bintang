from __future__ import annotations

import secrets
from datetime import datetime
from pathlib import Path

import aiofiles
from fastapi import HTTPException, UploadFile

from app.core.config import settings

ALLOWED_MIME = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/heic",
    "image/heif",
    "application/pdf",
}

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


async def save_upload(file: UploadFile, subdir: str) -> dict:
    if file.content_type not in ALLOWED_MIME:
        raise HTTPException(415, f"unsupported_media_type: {file.content_type}")
    base = Path(settings.UPLOAD_DIR) / subdir / datetime.utcnow().strftime("%Y/%m")
    base.mkdir(parents=True, exist_ok=True)

    suffix = Path(file.filename or "").suffix.lower() or ".bin"
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
