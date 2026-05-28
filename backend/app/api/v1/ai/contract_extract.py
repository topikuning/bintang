"""Endpoint AI-7: contract/SPK/BAST extraction."""
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.models import User
from app.services.ai.features.contract_extract import run as run_extract
from app.services.ocr.preprocess import preprocess_for_ocr
from app.services.storage.local import ALLOWED_MIME, save_upload

router = APIRouter()


@router.post("/extract-contract")
async def extract_contract(
    file: UploadFile = File(...),
    save_attachment: bool = Form(False),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Extract kontrak/SPK/BAST/perjanjian via Claude vision.

    Output: struktur dokumen (doc_type, parties, contract_value,
    key_clauses, key_dates, dst).

    save_attachment=true: simpan file ke /uploads (returnkan URL),
    selain extract. Default False (extract only, file di-discard).
    """
    if file.content_type not in ALLOWED_MIME:
        raise HTTPException(415, f"unsupported_media_type: {file.content_type}")

    if save_attachment:
        saved = await save_upload(file, subdir="contracts")
        # Re-read content dari saved file
        from pathlib import Path
        from app.core.config import settings
        rel = saved["url"][len("/files/"):]
        p = Path(settings.UPLOAD_DIR) / rel
        content = p.read_bytes()
        media_type = saved["mime_type"]
        source_url = saved["url"]
    else:
        content = await file.read()
        media_type = file.content_type
        source_url = None

    # Preprocess (resize image; PDF passthrough)
    processed, processed_mime = preprocess_for_ocr(content, media_type)

    try:
        result = await run_extract(
            db, user_id=user.id, content=processed, media_type=processed_mime,
        )
    except RuntimeError as e:
        if "ai_rate_limited" in str(e):
            raise HTTPException(429, "rate_limited") from e
        raise HTTPException(502, f"ai_failed: {e}") from e
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    await db.commit()
    result["source_url"] = source_url
    return result
