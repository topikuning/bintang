"""Endpoint Audit Kategorisasi.

Audit 2026-05-24 user req: admin proyek sering salah kategori. Tool
mass-scan utk identifikasi + bulk re-apply.

Flow:
- POST /scan -> jalankan pre-filter + (optional) AI verdict.
- POST /apply -> bulk update category_id utk tx_id list yg admin pilih.

Admin only (CENTRAL_ADMIN / SUPERADMIN).
"""
from __future__ import annotations

from datetime import date as date_type
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_admin
from app.db.session import get_db
from app.models.models import AuditAction, Category, Transaction, User
from app.services.ai.features.category_audit import run as run_audit
from app.services.audit import log, snapshot

router = APIRouter()


class ScanIn(BaseModel):
    project_id: int | None = None
    date_from: date_type | None = None
    date_to: date_type | None = None
    direction: str | None = Field(None, pattern="^(IN|OUT)$")
    # Audit 2026-05-24: opsi skip AI utk preview murah / saat budget habis.
    use_ai: bool = True


@router.post("/scan")
async def scan_miscategorized(
    payload: ScanIn,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    try:
        result = await run_audit(
            db, user_id=admin.id,
            project_id=payload.project_id,
            date_from=payload.date_from,
            date_to=payload.date_to,
            direction=payload.direction,
            use_ai=payload.use_ai,
        )
    except RuntimeError as e:
        if "ai_rate_limited" in str(e):
            raise HTTPException(429, "rate_limited") from e
        if "BudgetExceeded" in str(type(e).__name__):
            raise HTTPException(402, "ai_budget_exceeded") from e
        raise HTTPException(502, f"ai_failed: {e}") from e
    await db.commit()
    return result


class ApplyItem(BaseModel):
    tx_id: int
    new_category_id: int


class ApplyIn(BaseModel):
    """Bulk apply: tiap item = pasangan tx_id + kategori baru.

    Admin biasa kirim subset dari hasil scan yg sudah dia review.
    """
    items: list[ApplyItem]


@router.post("/apply")
async def apply_recategorization(
    payload: ApplyIn,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    if not payload.items:
        raise HTTPException(400, "no_items")
    if len(payload.items) > 500:
        raise HTTPException(400, "max_500_per_batch")
    # Validate category IDs ada
    cat_ids = {it.new_category_id for it in payload.items}
    valid_cats = {
        c for (c,) in (await db.execute(
            select(Category.id).where(
                Category.id.in_(cat_ids),
                Category.deleted_at.is_(None),
            )
        )).all()
    }
    invalid = cat_ids - valid_cats
    if invalid:
        raise HTTPException(400, f"invalid_category_ids: {sorted(invalid)}")

    tx_ids = [it.tx_id for it in payload.items]
    new_cat_by_tx = {it.tx_id: it.new_category_id for it in payload.items}

    res = await db.execute(
        select(Transaction).where(Transaction.id.in_(tx_ids))
    )
    txs = {t.id: t for t in res.scalars().all()}

    success: list[int] = []
    skipped: list[dict] = []
    for tid in tx_ids:
        t = txs.get(tid)
        if t is None or t.deleted_at is not None:
            skipped.append({"tx_id": tid, "reason": "not_found"})
            continue
        new_cat = new_cat_by_tx[tid]
        if t.category_id == new_cat:
            skipped.append({"tx_id": tid, "reason": "unchanged"})
            continue
        before = snapshot(t)
        t.category_id = new_cat
        await log(
            db, user_id=admin.id, entity="transaction", entity_id=t.id,
            action=AuditAction.UPDATE, before=before, after=snapshot(t),
            note="AI audit recategorization",
        )
        success.append(tid)
    await db.commit()
    return {
        "total_requested": len(tx_ids),
        "success_count": len(success),
        "success": success,
        "skipped": skipped,
    }
