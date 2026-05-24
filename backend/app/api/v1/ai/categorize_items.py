"""Endpoint AI-9: bulk item categorization.

Dipakai oleh form Invoice / TX DIRECT_EXPENSE / CashAdvanceSettlement.
Kirim daftar item + konteks, return suggestion per item.

User pattern di FE: tombol "🤖 Saran kategori per item" -> POST endpoint
ini -> isi otomatis category_id per row.
"""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.models import User
from app.services.ai.features.categorize_items import run as run_categorize

router = APIRouter()


class ItemIn(BaseModel):
    description: str = Field(..., max_length=500)
    quantity: Decimal | None = None
    unit: str | None = Field(None, max_length=40)
    unit_price: Decimal | None = None


class CategorizeItemsIn(BaseModel):
    items: list[ItemIn] = Field(..., min_length=1, max_length=100)
    direction: str | None = Field(None, pattern="^(IN|OUT)$")
    party_name: str | None = Field(None, max_length=200)
    project_id: int | None = None
    context_label: str | None = Field(
        None, max_length=200,
        description="Label utk konteks (mis. 'Invoice INV-001').",
    )


@router.post("/categorize-items")
async def categorize_items(
    payload: CategorizeItemsIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Bulk kategorisasi item-item.

    Response: {items: [{index, category_id, category_name, confidence,
    reason}], _meta}.
    """
    try:
        result = await run_categorize(
            db, user_id=user.id,
            items=[it.model_dump() for it in payload.items],
            direction=payload.direction,
            party_name=payload.party_name,
            project_id=payload.project_id,
            context_label=payload.context_label,
        )
    except RuntimeError as e:
        if "ai_rate_limited" in str(e):
            raise HTTPException(429, "rate_limited") from e
        if "BudgetExceeded" in type(e).__name__:
            raise HTTPException(402, "ai_budget_exceeded") from e
        raise HTTPException(502, f"ai_failed: {e}") from e
    await db.commit()
    return result
