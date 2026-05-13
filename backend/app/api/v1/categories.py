from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_admin, require_superadmin
from app.db.session import get_db
from app.models.models import AuditAction, Category, User
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


@router.post("", response_model=CategoryOut, status_code=201)
async def create_category(
    payload: CategoryCreate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> CategoryOut:
    c = Category(**payload.model_dump())
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
