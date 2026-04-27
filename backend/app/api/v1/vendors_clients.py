from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_superadmin
from app.db.session import get_db
from app.models.models import AuditAction, User, VendorClient
from app.schemas.common import Page
from app.schemas.refs import VendorClientCreate, VendorClientOut, VendorClientUpdate
from app.services.audit import log, snapshot

router = APIRouter()


@router.get("", response_model=Page[VendorClientOut])
async def list_vc(
    q: str | None = None,
    type: str | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> Page[VendorClientOut]:
    stmt = select(VendorClient).where(VendorClient.deleted_at.is_(None))
    if q:
        stmt = stmt.where(VendorClient.name.ilike(f"%{q}%"))
    if type:
        stmt = stmt.where(VendorClient.type == type)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    stmt = stmt.order_by(VendorClient.name).offset((page - 1) * size).limit(size)
    items = (await db.execute(stmt)).scalars().all()
    return Page(items=[VendorClientOut.model_validate(c) for c in items], total=total, page=page, size=size)


@router.post("", response_model=VendorClientOut, status_code=201)
async def create_vc(
    payload: VendorClientCreate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_superadmin),
) -> VendorClientOut:
    c = VendorClient(**payload.model_dump())
    db.add(c)
    await db.flush()
    await log(db, user_id=admin.id, entity="vendor_client", entity_id=c.id,
              action=AuditAction.CREATE, after=snapshot(c))
    await db.commit()
    await db.refresh(c)
    return VendorClientOut.model_validate(c)


@router.patch("/{cid}", response_model=VendorClientOut)
async def update_vc(
    cid: int,
    payload: VendorClientUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_superadmin),
) -> VendorClientOut:
    c = await db.get(VendorClient, cid)
    if not c or c.deleted_at is not None:
        raise HTTPException(404, "not_found")
    before = snapshot(c)
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(c, k, v)
    await log(db, user_id=admin.id, entity="vendor_client", entity_id=c.id,
              action=AuditAction.UPDATE, before=before, after=snapshot(c))
    await db.commit()
    await db.refresh(c)
    return VendorClientOut.model_validate(c)


@router.delete("/{cid}", status_code=204)
async def delete_vc(
    cid: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_superadmin),
) -> None:
    c = await db.get(VendorClient, cid)
    if not c or c.deleted_at is not None:
        raise HTTPException(404, "not_found")
    from sqlalchemy import func as sa_func
    before = snapshot(c)
    c.deleted_at = sa_func.now()
    await log(db, user_id=admin.id, entity="vendor_client", entity_id=c.id,
              action=AuditAction.DELETE, before=before)
    await db.commit()
