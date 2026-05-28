"""Endpoint AI-5: anomaly detection."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import ensure_project_access, get_current_user, require_admin
from app.db.session import get_db
from app.models.models import User
from app.services.ai.features.anomaly import run as run_anomaly

router = APIRouter()


class ScanAnomaliesIn(BaseModel):
    date_from: date
    date_to: date
    project_id: int | None = None


@router.post("/scan-anomalies")
async def scan_anomalies(
    payload: ScanAnomaliesIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
) -> dict:
    """Scan transaksi periode utk anomali (admin only).

    Output: {flagged: [{tx_id, severity, anomaly_type, reason}],
             summary: str, _meta: {...}}
    """
    if payload.date_from > payload.date_to:
        raise HTTPException(400, "date_from_after_date_to")
    if (payload.date_to - payload.date_from).days > 90:
        raise HTTPException(400, "period_too_long: max 90 hari")
    if payload.project_id:
        await ensure_project_access(db, user, payload.project_id)
    try:
        result = await run_anomaly(
            db, user_id=user.id,
            date_from=payload.date_from, date_to=payload.date_to,
            project_id=payload.project_id,
        )
    except RuntimeError as e:
        if "ai_rate_limited" in str(e):
            raise HTTPException(429, "rate_limited") from e
        raise HTTPException(502, f"ai_failed: {e}") from e
    await db.commit()
    return result
