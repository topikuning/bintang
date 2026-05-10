from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_admin, require_superadmin
from app.db.session import get_db
from app.models.models import (
    AIExtraction,
    AIExtractionStatus,
    AuditAction,
    User,
)
from app.services.audit import log
from app.services.ocr.adapter import get_ocr_adapter
from app.services.storage.local import ALLOWED_MIME, save_upload

router = APIRouter()


class ExtractIn(BaseModel):
    file_url: str
    entity: str = "invoice"


class ReviewIn(BaseModel):
    approved: bool
    note: str | None = None


@router.get("/test-connection")
async def test_connection(
    user: User = Depends(require_admin),
) -> dict:
    """Verifikasi koneksi ke Anthropic API tanpa upload file.

    Pakai untuk:
    - Cek apakah ANTHROPIC_API_KEY valid setelah set di Railway
    - Cek apakah OCR_MODEL bisa di-akses (404 = model name salah)
    - Ukur latency baseline Railway -> api.anthropic.com
    - Diagnose timeout: kalau test-connection sukses tapi /extract timeout,
      problemnya di image/payload, bukan auth/network
    """
    from app.core.config import settings

    engine = (settings.OCR_ENGINE or "stub").lower()
    if engine != "claude":
        return {
            "ok": False,
            "engine": engine,
            "error": "engine_not_claude",
            "hint": "Set OCR_ENGINE=claude di Railway env vars dulu.",
        }
    if not settings.ANTHROPIC_API_KEY:
        return {
            "ok": False,
            "engine": "claude",
            "error": "missing_api_key",
            "hint": "Set ANTHROPIC_API_KEY di Railway env vars.",
        }

    # Lazy import (sama dgn factory) -- supaya error import muncul jelas
    try:
        from app.services.ocr.claude_adapter import ClaudeVisionOCRAdapter
    except ImportError as e:
        return {
            "ok": False,
            "error": "anthropic_not_installed",
            "detail": str(e),
            "hint": "Restart deploy supaya pip install anthropic dijalankan.",
        }

    adapter = ClaudeVisionOCRAdapter(
        api_key=settings.ANTHROPIC_API_KEY,
        model=settings.OCR_MODEL,
    )
    result = await adapter.test_connection()
    return {
        "engine": "claude",
        "model": settings.OCR_MODEL,
        **result,
    }


def _persist_extraction(
    *, entity: str, source_url: str, result: dict[str, Any]
) -> AIExtraction:
    """Bangun row AIExtraction dari hasil adapter -- kompatibel dgn URL dan
    upload path. Decimal di-stringify agar JSON-serializable.
    """
    extracted = {
        k: (str(v) if hasattr(v, "is_finite") else v)
        for k, v in result.items()
        if k != "raw_response"
    }
    return AIExtraction(
        entity=entity,
        source_url=source_url,
        status=AIExtractionStatus.DONE,
        extracted_data=extracted,
        confidence_score=result.get("confidence_score"),
        raw_response=result.get("raw_response"),
    )


@router.post("/extract")
async def extract(
    payload: ExtractIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Ekstrak dokumen dari URL (eksternal atau path lokal /files/...).

    Untuk upload langsung dari browser, pakai POST /ocr/extract-upload.
    """
    adapter = get_ocr_adapter()
    try:
        result = await adapter.extract_invoice(payload.file_url)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"ocr_failed: {e}") from e
    rec = _persist_extraction(
        entity=payload.entity, source_url=payload.file_url, result=result
    )
    db.add(rec)
    await db.flush()
    await log(
        db,
        user_id=user.id,
        entity="ai_extraction",
        entity_id=rec.id,
        action=AuditAction.CREATE,
        note=f"ocr extract url engine={result.get('raw_response', {}).get('engine', '?')}",
    )
    await db.commit()
    await db.refresh(rec)
    return {
        "id": rec.id,
        "status": rec.status.value,
        "confidence_score": float(rec.confidence_score or 0),
        "extracted_data": rec.extracted_data,
        "needs_review": True,
    }


@router.post("/extract-upload")
async def extract_upload(
    file: UploadFile = File(...),
    entity: str = Form("invoice"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Upload langsung gambar/PDF -> simpan ke storage -> jalankan OCR.

    File disimpan permanent (sama seperti attachment lain), URL relatif
    dipakai sebagai source_url. Kalau adapter mendukung
    extract_from_bytes (Claude Vision), pakai byte path agar tidak perlu
    round-trip baca file. Selain itu, jatuh ke extract_invoice dgn URL
    relatif yang bakal di-resolve adapter.
    """
    if file.content_type not in ALLOWED_MIME:
        raise HTTPException(415, f"unsupported_media_type: {file.content_type}")

    # Simpan dulu (gambar dioptimasi, ukuran dibatasi via storage layer).
    saved = await save_upload(file, subdir="ocr")
    source_url = saved["url"]

    # Baca file balik utk byte path (storage sudah resize gambar besar).
    from pathlib import Path

    from app.core.config import settings

    rel = source_url[len("/files/") :]
    p = Path(settings.UPLOAD_DIR) / rel
    content = p.read_bytes()
    media_type = saved["mime_type"]

    adapter = get_ocr_adapter()
    try:
        try:
            result = await adapter.extract_from_bytes(
                content, media_type, source_url=source_url
            )
        except NotImplementedError:
            # Adapter lama -- fallback ke URL path
            result = await adapter.extract_invoice(source_url)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"ocr_failed: {e}") from e

    rec = _persist_extraction(entity=entity, source_url=source_url, result=result)
    db.add(rec)
    await db.flush()
    await log(
        db,
        user_id=user.id,
        entity="ai_extraction",
        entity_id=rec.id,
        action=AuditAction.CREATE,
        note=(
            f"ocr extract upload file={saved['file_name']} "
            f"engine={result.get('raw_response', {}).get('engine', '?')}"
        ),
    )
    await db.commit()
    await db.refresh(rec)
    return {
        "id": rec.id,
        "status": rec.status.value,
        "confidence_score": float(rec.confidence_score or 0),
        "extracted_data": rec.extracted_data,
        "needs_review": True,
        "source_url": source_url,
    }


@router.get("/drafts")
async def list_drafts(
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> list[dict]:
    rows = (
        await db.execute(
            select(AIExtraction).where(AIExtraction.deleted_at.is_(None))
            .order_by(AIExtraction.id.desc())
            .limit(100)
        )
    ).scalars().all()
    return [
        {
            "id": r.id,
            "entity": r.entity,
            "status": r.status.value,
            "confidence_score": float(r.confidence_score or 0),
            "extracted_data": r.extracted_data,
            "source_url": r.source_url,
            "reviewed_at": r.reviewed_at.isoformat() if r.reviewed_at else None,
        }
        for r in rows
    ]


@router.post("/drafts/{eid}/review")
async def review_draft(
    eid: int,
    body: ReviewIn = Body(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
) -> dict:
    rec = await db.get(AIExtraction, eid)
    if not rec:
        raise HTTPException(404, "not_found")
    rec.status = AIExtractionStatus.REVIEWED
    rec.reviewed_by_id = user.id
    rec.reviewed_at = datetime.now(timezone.utc)
    await log(db, user_id=user.id, entity="ai_extraction", entity_id=rec.id,
              action=AuditAction.UPDATE, note=f"reviewed approved={body.approved}")
    await db.commit()
    return {"id": rec.id, "approved": body.approved}
