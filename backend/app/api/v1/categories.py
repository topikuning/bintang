from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_admin, require_superadmin
from app.db.session import get_db
from app.models.models import (
    AuditAction,
    CashAdvanceSettlementItem,
    CashRequestItem,
    Category,
    InvoiceItem,
    Transaction,
    TransactionItem,
    User,
)
from app.schemas.common import Page
from app.schemas.refs import CategoryCreate, CategoryOut, CategoryUpdate
from app.services.audit import log, snapshot

router = APIRouter()


@router.get("", response_model=Page[CategoryOut])
async def list_categories(
    q: str | None = None,
    type: str | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(100, ge=1, le=2000),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> Page[CategoryOut]:
    stmt = select(Category).where(Category.deleted_at.is_(None))
    if q:
        stmt = stmt.where(Category.name.ilike(f"%{q}%"))
    if type:
        stmt = stmt.where(Category.type == type)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    stmt = stmt.order_by(Category.name).offset((page - 1) * size).limit(size)
    items = (await db.execute(stmt)).scalars().all()
    return Page(items=[CategoryOut.model_validate(c) for c in items], total=total, page=page, size=size)


def _validate_accounting_flags(c: Category) -> None:
    """Audit 2026-05-23: max 1 dr is_marketing/is_penalty/is_profit_share
    boleh true (mutually exclusive). Raise 400 kalau lebih dr 1."""
    flags = [
        bool(c.is_marketing), bool(c.is_penalty), bool(c.is_profit_share),
    ]
    if sum(flags) > 1:
        raise HTTPException(
            400,
            "accounting_flags_conflict: max 1 dari is_marketing / is_penalty / "
            "is_profit_share boleh true. Pilih satu peran akuntansi.",
        )


@router.post("", response_model=CategoryOut, status_code=201)
async def create_category(
    payload: CategoryCreate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> CategoryOut:
    c = Category(**payload.model_dump())
    _validate_accounting_flags(c)
    db.add(c)
    await db.flush()
    await log(db, user_id=admin.id, entity="category", entity_id=c.id,
              action=AuditAction.CREATE, after=snapshot(c))
    await db.commit()
    await db.refresh(c)
    return CategoryOut.model_validate(c)


@router.patch("/{cid}", response_model=CategoryOut)
async def update_category(
    cid: int,
    payload: CategoryUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> CategoryOut:
    c = await db.get(Category, cid)
    if not c or c.deleted_at is not None:
        raise HTTPException(404, "not_found")
    before = snapshot(c)
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(c, k, v)
    _validate_accounting_flags(c)
    await log(db, user_id=admin.id, entity="category", entity_id=c.id,
              action=AuditAction.UPDATE, before=before, after=snapshot(c))
    await db.commit()
    await db.refresh(c)
    return CategoryOut.model_validate(c)


@router.delete("/{cid}", status_code=204)
async def delete_category(
    cid: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> None:
    c = await db.get(Category, cid)
    if not c or c.deleted_at is not None:
        raise HTTPException(404, "not_found")
    before = snapshot(c)
    c.deleted_at = datetime.utcnow()
    await log(db, user_id=admin.id, entity="category", entity_id=c.id,
              action=AuditAction.DELETE, before=before)
    await db.commit()


# ---------- Bulk cleanup helpers (audit 2026-05-24) ----------
# User salah import 127 kategori. Tool utk hapus massal yg blm pernah
# dipakai (zero usage di 5 tabel FK).


_FK_SOURCES = (
    # (Model, column) -- semua kolom kategori non-deleted (deleted_at
    # filter tdk di-pasang di item-* karena cascade dari parent invoice/
    # tx/settle/cash_request -- kalau parent di-soft-delete, item tetap
    # ada tp tdk relevan. Utk "pernah dipakai", kalau dia exist di DB
    # = pernah ditulis = dianggap pakai).
    (Transaction, Transaction.category_id),
    (TransactionItem, TransactionItem.category_id),
    (InvoiceItem, InvoiceItem.category_id),
    (CashAdvanceSettlementItem, CashAdvanceSettlementItem.category_id),
    (CashRequestItem, CashRequestItem.category_id),
)


async def _usage_counts(db: AsyncSession) -> dict[int, int]:
    """Return dict {category_id: total_usage} across semua FK source.

    Dipanggil sekali, agregat di Python. Skala 127 kategori + N tx
    masih murah (5 query GROUP BY).
    """
    totals: dict[int, int] = {}
    for _Model, col in _FK_SOURCES:
        stmt = (
            select(col, func.count())
            .where(col.is_not(None))
            .group_by(col)
        )
        for cid, n in (await db.execute(stmt)).all():
            if cid is None:
                continue
            totals[cid] = totals.get(cid, 0) + int(n)
    return totals


class CategoryUsageOut(BaseModel):
    id: int
    name: str
    type: str
    usage_count: int


class CategoryUsageListOut(BaseModel):
    items: list[CategoryUsageOut]
    total: int
    unused_count: int


@router.get("/usage", response_model=CategoryUsageListOut)
async def list_with_usage(
    only_unused: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> CategoryUsageListOut:
    """List semua kategori non-deleted + usage_count.

    `only_unused=true` -> filter yg usage_count=0 saja (utk dialog
    bulk-cleanup).
    """
    cats = (await db.execute(
        select(Category).where(Category.deleted_at.is_(None))
        .order_by(Category.name)
    )).scalars().all()
    counts = await _usage_counts(db)
    items: list[CategoryUsageOut] = []
    unused_count = 0
    for c in cats:
        n = counts.get(c.id, 0)
        if n == 0:
            unused_count += 1
        if only_unused and n > 0:
            continue
        items.append(CategoryUsageOut(
            id=c.id, name=c.name,
            type=c.type.value if hasattr(c.type, "value") else str(c.type),
            usage_count=n,
        ))
    return CategoryUsageListOut(
        items=items, total=len(cats), unused_count=unused_count,
    )


class BulkDeleteIn(BaseModel):
    ids: list[int]


class BulkDeleteOut(BaseModel):
    total_requested: int
    success_count: int
    success: list[int]
    skipped: list[dict]


@router.post("/bulk-delete", response_model=BulkDeleteOut)
async def bulk_delete_categories(
    payload: BulkDeleteIn,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> BulkDeleteOut:
    """Bulk soft-delete kategori. SAFETY: tolak kategori yg usage_count>0.

    Mencegah deletion accidental dari kategori yg sudah dipakai
    (akan break aggregation di reports). Caller harus filter pakai
    GET /usage?only_unused=true sebelum kirim ke sini.
    """
    if not payload.ids:
        raise HTTPException(400, "no_ids")
    if len(payload.ids) > 500:
        raise HTTPException(400, "max_500_per_batch")

    counts = await _usage_counts(db)
    res = await db.execute(
        select(Category).where(Category.id.in_(payload.ids))
    )
    cats_map = {c.id: c for c in res.scalars().all()}

    success: list[int] = []
    skipped: list[dict] = []
    now = datetime.utcnow()
    for cid in payload.ids:
        c = cats_map.get(cid)
        if c is None:
            skipped.append({"id": cid, "reason": "not_found"})
            continue
        if c.deleted_at is not None:
            skipped.append({"id": cid, "reason": "already_deleted"})
            continue
        used = counts.get(cid, 0)
        if used > 0:
            skipped.append({
                "id": cid, "reason": f"in_use ({used} record)",
            })
            continue
        before = snapshot(c)
        c.deleted_at = now
        await log(
            db, user_id=admin.id, entity="category", entity_id=c.id,
            action=AuditAction.DELETE, before=before,
            note="bulk delete unused category",
        )
        success.append(cid)

    await db.commit()
    return BulkDeleteOut(
        total_requested=len(payload.ids),
        success_count=len(success),
        success=success,
        skipped=skipped,
    )
