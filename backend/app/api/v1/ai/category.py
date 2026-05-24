"""Endpoint AI-1: smart category suggest."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.models import User
from app.services.ai.features.category import run as run_category

router = APIRouter()


class SuggestCategoryIn(BaseModel):
    """Minimum salah satu dr description / party_name harus terisi.
    Konteks tambahan (amount, kind) opsional tapi tingkatkan akurasi."""
    description: str | None = Field(None, max_length=500)
    party_name: str | None = Field(None, max_length=200)
    amount: str | float | int | None = None
    kind: str | None = Field(None, max_length=40)
    direction: str | None = Field(None, pattern="^(IN|OUT)$",
                                  description="Filter kategori berdasar arah kas.")


@router.post("/suggest-category")
async def suggest_category(
    payload: SuggestCategoryIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Sarankan kategori utk deskripsi transaksi.

    Response:
      category_id: int|null
      category_name: str|null
      confidence: float (0-1)
      reason: str (penjelasan singkat)
      _meta: {model, cached, cost_usd}
    """
    try:
        result = await run_category(
            db, user_id=user.id,
            description=payload.description,
            party_name=payload.party_name,
            amount=payload.amount,
            kind=payload.kind,
            direction=payload.direction,
        )
    except RuntimeError as e:
        if "ai_rate_limited" in str(e):
            raise HTTPException(429, "rate_limited") from e
        raise HTTPException(502, f"ai_failed: {e}") from e
    await db.commit()
    return result
