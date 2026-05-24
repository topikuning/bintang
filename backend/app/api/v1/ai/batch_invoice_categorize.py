"""Bulk kategorisasi semua item invoice dalam 1 proyek (1 perintah AI batch).

Audit 2026-05-24 user req: "supaya tdk kebanyakan request". Daripada
buka 50 invoice satu-satu lalu klik "Saran AI" di tiap form, scan 1
proyek + auto-kategorisasi semua item yg blm punya category_id.

Strategi:
1. SQL: load semua invoice di project dgn item kategori NULL.
2. Per invoice -> call AI categorize_items (dgn context per-invoice
   supaya vendor pattern relevan). Loop sequential (bukan 1 mega
   prompt) supaya AI fokus per invoice + rate limit terkontrol.
3. Return aggregate: invoices [{invoice_id, number, items: [...]}].

Apply: separate endpoint POST /apply -- terima per-item suggestion,
update invoice_items.category_id, audit log.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import require_admin
from app.db.session import get_db
from app.models.models import (
    AuditAction, Category, Invoice, InvoiceItem, InvoiceStatus,
    InvoiceType, User,
)
from app.services.ai.features.categorize_items import run as run_categorize
from app.services.audit import log

router = APIRouter()


class BatchProjectScanIn(BaseModel):
    project_id: int
    # Default: scan invoice DRAFT/ISSUED/PARTIALLY_PAID (yg masih
    # mungkin perlu update). Skip PAID/CANCELLED. Bisa di-override.
    statuses: list[str] | None = None
    # Hanya item dgn category_id NULL (default true) -- skip yg sudah
    # ada. Set false utk include semua + bandingkan dgn saran AI.
    only_uncategorized: bool = True
    # Cap invoice scan dalam 1 batch.
    max_invoices: int = Field(default=30, ge=1, le=100)


class ItemSuggestion(BaseModel):
    item_id: int
    description: str
    quantity: str | float | None = None
    unit: str | None = None
    unit_price: str | float | None = None
    current_category_id: int | None = None
    current_category_name: str | None = None
    suggested_category_id: int | None = None
    suggested_category_name: str | None = None
    confidence: float = 0
    reason: str = ""


class InvoiceSuggestion(BaseModel):
    invoice_id: int
    invoice_number: str
    invoice_type: str
    party_name: str | None
    items: list[ItemSuggestion]
    # Indicator: berapa item yg ada saran high confidence (>=0.7)
    high_confidence_count: int = 0


class BatchScanResp(BaseModel):
    project_id: int
    invoices: list[InvoiceSuggestion]
    invoices_scanned: int
    invoices_skipped: int  # invoice yg tdk ada item perlu categorize
    summary: str


_DEFAULT_STATUSES = (
    InvoiceStatus.DRAFT,
    InvoiceStatus.ISSUED,
    InvoiceStatus.PARTIALLY_PAID,
    InvoiceStatus.OVERDUE,
)


@router.post("/categorize-project", response_model=BatchScanResp)
async def batch_categorize_project_invoices(
    payload: BatchProjectScanIn,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> BatchScanResp:
    # Resolve status filter
    if payload.statuses:
        try:
            statuses = [InvoiceStatus(s) for s in payload.statuses]
        except ValueError:
            raise HTTPException(400, "invalid_status")
    else:
        statuses = list(_DEFAULT_STATUSES)

    # Load invoices + items
    stmt = (
        select(Invoice)
        .options(selectinload(Invoice.items))
        .where(
            Invoice.deleted_at.is_(None),
            Invoice.project_id == payload.project_id,
            Invoice.status.in_(statuses),
        )
        .order_by(Invoice.invoice_date.desc(), Invoice.id.desc())
        .limit(payload.max_invoices)
    )
    invoices = (await db.execute(stmt)).scalars().all()

    # Load category name lookup (tdk per-call)
    cats = (await db.execute(
        select(Category.id, Category.name).where(Category.deleted_at.is_(None))
    )).all()
    cat_name_by_id = {cid: name for cid, name in cats}

    result_invoices: list[InvoiceSuggestion] = []
    scanned = 0
    skipped = 0

    for inv in invoices:
        target_items = [
            it for it in (inv.items or [])
            if not payload.only_uncategorized or it.category_id is None
        ]
        if not target_items:
            skipped += 1
            continue

        # Direction: InvoiceType IN (hutang) -> items expense -> Category OUT.
        # InvoiceType OUT (piutang) -> items income -> Category IN.
        cat_dir = "OUT" if inv.type == InvoiceType.IN else "IN"

        scanned += 1
        try:
            ai_result = await run_categorize(
                db, user_id=admin.id,
                items=[
                    {
                        "description": it.description,
                        "quantity": float(it.quantity or 0),
                        "unit": it.unit,
                        "unit_price": float(it.unit_price or 0),
                    }
                    for it in target_items
                ],
                direction=cat_dir,
                party_name=inv.party_name,
                project_id=inv.project_id,
                context_label=f"Invoice {inv.number}",
            )
        except RuntimeError as e:
            # rate limit / budget exceeded -- stop loop, return partial
            if "ai_rate_limited" in str(e):
                result_invoices.append(InvoiceSuggestion(
                    invoice_id=inv.id, invoice_number=inv.number,
                    invoice_type=inv.type.value,
                    party_name=inv.party_name, items=[],
                    high_confidence_count=0,
                ))
                break
            raise

        ai_by_idx = {s["index"]: s for s in ai_result.get("items", [])}
        item_suggestions: list[ItemSuggestion] = []
        high_conf = 0
        for i, it in enumerate(target_items):
            s = ai_by_idx.get(i, {})
            sug_cid = s.get("category_id")
            conf = float(s.get("confidence") or 0)
            if conf >= 0.7 and sug_cid is not None:
                high_conf += 1
            item_suggestions.append(ItemSuggestion(
                item_id=it.id,
                description=it.description,
                quantity=str(it.quantity) if it.quantity is not None else None,
                unit=it.unit,
                unit_price=str(it.unit_price) if it.unit_price is not None else None,
                current_category_id=it.category_id,
                current_category_name=cat_name_by_id.get(it.category_id) if it.category_id else None,
                suggested_category_id=sug_cid,
                suggested_category_name=cat_name_by_id.get(sug_cid) if sug_cid else None,
                confidence=conf,
                reason=s.get("reason") or "",
            ))
        result_invoices.append(InvoiceSuggestion(
            invoice_id=inv.id, invoice_number=inv.number,
            invoice_type=inv.type.value,
            party_name=inv.party_name, items=item_suggestions,
            high_confidence_count=high_conf,
        ))

    await db.commit()

    total_items = sum(len(r.items) for r in result_invoices)
    total_high = sum(r.high_confidence_count for r in result_invoices)
    summary = (
        f"{scanned} invoice di-scan ({total_items} item). "
        f"{total_high} item dgn confidence >=70% siap auto-apply. "
        f"{skipped} invoice di-skip (semua item sudah ber-kategori)."
    )
    return BatchScanResp(
        project_id=payload.project_id,
        invoices=result_invoices,
        invoices_scanned=scanned,
        invoices_skipped=skipped,
        summary=summary,
    )


class ApplyItem(BaseModel):
    item_id: int
    new_category_id: int


class BatchApplyIn(BaseModel):
    items: list[ApplyItem]


class BatchApplyOut(BaseModel):
    total_requested: int
    success_count: int
    success: list[int]
    skipped: list[dict]


@router.post("/apply", response_model=BatchApplyOut)
async def apply_item_categories(
    payload: BatchApplyIn,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> BatchApplyOut:
    if not payload.items:
        raise HTTPException(400, "no_items")
    if len(payload.items) > 1000:
        raise HTTPException(400, "max_1000_per_batch")

    item_ids = [it.item_id for it in payload.items]
    new_cat_by_id = {it.item_id: it.new_category_id for it in payload.items}

    # Validate kategori valid
    cat_ids = set(new_cat_by_id.values())
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

    res = await db.execute(
        select(InvoiceItem).where(InvoiceItem.id.in_(item_ids))
    )
    items_map = {it.id: it for it in res.scalars().all()}
    # Group by invoice utk audit log scalable
    by_invoice: dict[int, list[tuple[int, int | None, int]]] = defaultdict(list)
    success: list[int] = []
    skipped: list[dict] = []
    for iid in item_ids:
        it = items_map.get(iid)
        if it is None:
            skipped.append({"item_id": iid, "reason": "not_found"})
            continue
        new_cat = new_cat_by_id[iid]
        if it.category_id == new_cat:
            skipped.append({"item_id": iid, "reason": "unchanged"})
            continue
        by_invoice[it.invoice_id].append((iid, it.category_id, new_cat))
        it.category_id = new_cat
        success.append(iid)

    # Single audit log per invoice (granular per-item kalau perlu trace
    # lewat note).
    for inv_id, changes in by_invoice.items():
        note = f"AI bulk categorize: {len(changes)} item updated"
        await log(
            db, user_id=admin.id, entity="invoice", entity_id=inv_id,
            action=AuditAction.UPDATE, note=note,
        )

    await db.commit()
    return BatchApplyOut(
        total_requested=len(item_ids),
        success_count=len(success),
        success=success,
        skipped=skipped,
    )
