"""Endpoint AI-6: chat-style report query (template router, safe)."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.models import User
from app.services.ai.features.ask_query import run as run_ask

router = APIRouter()


class AskIn(BaseModel):
    question: str = Field(..., min_length=3, max_length=500)


@router.post("/ask")
async def ask_query(
    payload: AskIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Tanya laporan keuangan dlm Bahasa Indonesia natural.

    Backend pilih dari template predefined (BUKAN raw SQL — aman dari
    injection). Output: template terpakai + data + reason + follow_up.

    Contoh pertanyaan:
    - "Berapa pengeluaran material bulan ini?"
    - "Top vendor minggu lalu"
    - "Saldo kas Q1 2026"
    - "Sisa hutang & piutang sekarang"
    - "Status budget semua proyek"
    """
    try:
        result = await run_ask(db, user=user, question=payload.question)
    except RuntimeError as e:
        if "ai_rate_limited" in str(e):
            raise HTTPException(429, "rate_limited") from e
        raise HTTPException(502, f"ai_failed: {e}") from e
    await db.commit()
    return result
