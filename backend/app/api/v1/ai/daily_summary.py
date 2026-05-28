"""Endpoint AI-8: daily summary."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_admin
from app.db.session import get_db
from app.models.models import User
from app.services.ai.features.daily_summary import run as run_summary

router = APIRouter()


class DailySummaryIn(BaseModel):
    target_date: date | None = None


@router.post("/daily-summary")
async def daily_summary(
    payload: DailySummaryIn = DailySummaryIn(),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
) -> dict:
    """Generate executive summary aktivitas tanggal tertentu (default
    hari ini). Admin only.

    Output: {text, facts (raw stats), _meta}.
    """
    try:
        result = await run_summary(db, user_id=user.id, target_date=payload.target_date)
    except RuntimeError as e:
        if "ai_rate_limited" in str(e):
            raise HTTPException(429, "rate_limited") from e
        raise HTTPException(502, f"ai_failed: {e}") from e
    await db.commit()
    return result
