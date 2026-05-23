"""Endpoint AI-2: PO cover letter generator."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import ensure_project_access, get_current_user
from app.db.session import get_db
from app.models.models import PurchaseOrder, User
from app.services.ai.features.po_cover import run as run_po_cover

router = APIRouter()


class GenPOCoverIn(BaseModel):
    po_id: int = Field(..., gt=0)
    tone: str = Field("formal", pattern="^(formal|santai)$")


@router.post("/generate-po-cover")
async def generate_po_cover(
    payload: GenPOCoverIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Generate cover letter / surat pengantar PO ke vendor.

    Output: {text: str, _meta: {model, cached, cost_usd}}
    """
    po = await db.get(PurchaseOrder, payload.po_id)
    if not po or po.deleted_at is not None:
        raise HTTPException(404, "po_not_found")
    await ensure_project_access(db, user, po.project_id)
    try:
        result = await run_po_cover(
            db, user_id=user.id, po_id=payload.po_id, tone=payload.tone,
        )
    except ValueError as e:
        raise HTTPException(404, str(e)) from e
    except RuntimeError as e:
        if "ai_rate_limited" in str(e):
            raise HTTPException(429, "rate_limited") from e
        raise HTTPException(502, f"ai_failed: {e}") from e
    await db.commit()
    return result
