from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_admin
from app.db.session import get_db
from app.models.models import AuditAction, Funder, User
from app.schemas.common import Page
from app.schemas.refs import FunderCreate, FunderOut, FunderUpdate
from app.services.audit import log, snapshot

router = APIRouter()


@router.get("", response_model=Page[FunderOut])
async def list_funders(
    q: str | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(100, ge=1, le=2000),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> Page[FunderOut]:
    stmt = select(Funder).where(Funder.deleted_at.is_(None))
    if q:
        stmt = stmt.where(Funder.name.ilike(f"%{q}%"))
    total = (
        await db.execute(select(func.count()).select_from(stmt.subquery()))
    ).scalar_one()
    stmt = stmt.order_by(Funder.name).offset((page - 1) * size).limit(size)
    items = (await db.execute(stmt)).scalars().all()
    return Page(
        items=[FunderOut.model_validate(f) for f in items],
        total=total,
        page=page,
        size=size,
    )


@router.post("", response_model=FunderOut, status_code=201)
async def create_funder(
    payload: FunderCreate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> FunderOut:
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "funder_name_required")
    exists = (
        await db.execute(select(Funder).where(Funder.name == name))
    ).scalar_one_or_none()
    if exists:
        raise HTTPException(409, "funder_name_already_used")
    f = Funder(name=name)
    db.add(f)
    await db.flush()
    await log(
        db,
        user_id=admin.id,
        entity="funder",
        entity_id=f.id,
        action=AuditAction.CREATE,
        after=snapshot(f),
    )
    await db.commit()
    await db.refresh(f)
    return FunderOut.model_validate(f)


@router.patch("/{fid}", response_model=FunderOut)
async def update_funder(
    fid: int,
    payload: FunderUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> FunderOut:
    f = await db.get(Funder, fid)
    if not f or f.deleted_at is not None:
        raise HTTPException(404, "not_found")
    before = snapshot(f)
    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"]:
        new_name = data["name"].strip()
        if not new_name:
            raise HTTPException(400, "funder_name_required")
        if new_name != f.name:
            clash = (
                await db.execute(
                    select(Funder).where(Funder.name == new_name, Funder.id != fid)
                )
            ).scalar_one_or_none()
            if clash:
                raise HTTPException(409, "funder_name_already_used")
            f.name = new_name
    await log(
        db,
        user_id=admin.id,
        entity="funder",
        entity_id=f.id,
        action=AuditAction.UPDATE,
        before=before,
        after=snapshot(f),
    )
    await db.commit()
    await db.refresh(f)
    return FunderOut.model_validate(f)


@router.delete("/{fid}", status_code=204)
async def delete_funder(
    fid: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> None:
    f = await db.get(Funder, fid)
    if not f or f.deleted_at is not None:
        raise HTTPException(404, "not_found")
    before = snapshot(f)
    f.deleted_at = datetime.utcnow()
    await log(
        db,
        user_id=admin.id,
        entity="funder",
        entity_id=f.id,
        action=AuditAction.DELETE,
        before=before,
    )
    await db.commit()
