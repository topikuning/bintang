"""Endpoint AI-4: cash request justifier."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import ensure_project_access, get_current_user
from app.db.session import get_db
from app.models.models import CashRequest, User
from app.services.ai.features.cash_request_justify import run as run_justify

router = APIRouter()


class JustifyItemIn(BaseModel):
    description: str
    amount: str | float | int


class JustifyIn(BaseModel):
    """Mode 1: cash_request_id (CR sudah ada -- load context dari DB).
    Mode 2: items + project_id + title (draft baru, belum di-save).
    """
    cash_request_id: int | None = None
    items: list[JustifyItemIn] | None = None
    project_id: int | None = None
    title: str | None = None


@router.post("/justify-cash-request")
async def justify_cash_request(
    payload: JustifyIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Generate justifikasi pengajuan dana.

    Output: {text: str, _meta: {model, cached, cost_usd}}
    """
    # Access check: kalau by ID, cek owner project. Kalau draft, cek
    # access ke project_id.
    if payload.cash_request_id:
        cr = await db.get(CashRequest, payload.cash_request_id)
        if not cr or cr.deleted_at is not None:
            raise HTTPException(404, "cash_request_not_found")
        await ensure_project_access(db, user, cr.project_id)
    elif payload.project_id:
        await ensure_project_access(db, user, payload.project_id)
    else:
        raise HTTPException(400, "missing_input: butuh cash_request_id atau project_id+items+title")

    try:
        result = await run_justify(
            db, user_id=user.id,
            cash_request_id=payload.cash_request_id,
            items=[it.model_dump() for it in (payload.items or [])] or None,
            project_id=payload.project_id,
            title=payload.title,
        )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except RuntimeError as e:
        if "ai_rate_limited" in str(e):
            raise HTTPException(429, "rate_limited") from e
        raise HTTPException(502, f"ai_failed: {e}") from e
    await db.commit()
    return result
