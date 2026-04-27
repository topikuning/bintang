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

    rel = target.relative_to(Path(settings.UPLOAD_DIR)).as_posix()
    url = f"/files/{rel}"
    return {
        "file_name": file.filename or safe_name,
        "file_size": size,
        "mime_type": file.content_type,
        "url": url,
    }
