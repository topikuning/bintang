from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_superadmin
from app.db.session import get_db
from app.models.models import (
    AIExtraction,
    AIExtractionStatus,
    AuditAction,
    User,
)
from app.services.audit import log
from app.services.ocr.adapter import get_ocr_adapter

router = APIRouter()


class ExtractIn(BaseModel):
    file_url: str
    entity: str = "invoice"


class ReviewIn(BaseModel):
    approved: bool
    note: str | None = None


@router.post("/extract")
async def extract(
    payload: ExtractIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Submit a file URL to be processed by the OCR adapter.
    Currently returns a stub draft that requires human review before being persisted as Invoice.
    """
    adapter = get_ocr_adapter()
    result = await adapter.extract_invoice(payload.file_url)
    rec = AIExtraction(
        entity=payload.entity,
        source_url=payload.file_url,
        status=AIExtractionStatus.DONE,
        extracted_data={k: (str(v) if hasattr(v, "is_finite") else v) for k, v in result.items() if k != "raw_response"},
        confidence_score=result.get("confidence_score"),
        raw_response=result.get("raw_response"),
    )
    db.add(rec)
    await db.flush()
    await log(db, user_id=user.id, entity="ai_extraction", entity_id=rec.id,
              action=AuditAction.CREATE, note="ocr stub")
    await db.commit()
    await db.refresh(rec)
    return {
        "id": rec.id,
        "status": rec.status.value,
        "confidence_score": float(rec.confidence_score or 0),
        "extracted_data": rec.extracted_data,
        "needs_review": True,
    }


@router.get("/drafts")
async def list_drafts(
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_superadmin),
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
    user: User = Depends(require_superadmin),
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
