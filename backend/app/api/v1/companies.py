from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_admin, require_superadmin
from app.db.session import get_db
from app.models.models import AuditAction, Company, User
from app.schemas.common import Page
from app.schemas.refs import CompanyCreate, CompanyOut, CompanyUpdate
from app.services.audit import log, snapshot
from app.services.storage.local import save_upload

router = APIRouter()


@router.get("", response_model=Page[CompanyOut])
async def list_companies(
    q: str | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> Page[CompanyOut]:
    stmt = select(Company).where(Company.deleted_at.is_(None))
    if q:
        stmt = stmt.where(Company.name.ilike(f"%{q}%"))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    stmt = stmt.order_by(Company.name).offset((page - 1) * size).limit(size)
    items = (await db.execute(stmt)).scalars().all()
    return Page(items=[CompanyOut.model_validate(c) for c in items], total=total, page=page, size=size)


@router.post("", response_model=CompanyOut, status_code=201)
async def create_company(
    payload: CompanyCreate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> CompanyOut:
    c = Company(**payload.model_dump())
    db.add(c)
    await db.flush()
    await log(db, user_id=admin.id, entity="company", entity_id=c.id,
              action=AuditAction.CREATE, after=snapshot(c))
    await db.commit()
    await db.refresh(c)
    return CompanyOut.model_validate(c)


@router.get("/{cid}", response_model=CompanyOut)
async def get_company(
    cid: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> CompanyOut:
    c = await db.get(Company, cid)
    if not c or c.deleted_at is not None:
        raise HTTPException(404, "not_found")
    return CompanyOut.model_validate(c)


@router.patch("/{cid}", response_model=CompanyOut)
async def update_company(
    cid: int,
    payload: CompanyUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> CompanyOut:
    c = await db.get(Company, cid)
    if not c or c.deleted_at is not None:
        raise HTTPException(404, "not_found")
    before = snapshot(c)
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(c, k, v)
    await log(db, user_id=admin.id, entity="company", entity_id=c.id,
              action=AuditAction.UPDATE, before=before, after=snapshot(c))
    await db.commit()
    await db.refresh(c)
    return CompanyOut.model_validate(c)


@router.delete("/{cid}", status_code=204)
async def delete_company(
    cid: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> None:
    c = await db.get(Company, cid)
    if not c or c.deleted_at is not None:
        raise HTTPException(404, "not_found")
    from sqlalchemy import func as sa_func
    before = snapshot(c)
    c.deleted_at = sa_func.now()
    await log(db, user_id=admin.id, entity="company", entity_id=c.id,
              action=AuditAction.DELETE, before=before)
    await db.commit()


@router.post("/{cid}/upload/{kind}", response_model=CompanyOut)
async def upload_company_asset(
    cid: int,
    kind: Literal["logo", "letterhead"],
    file: Annotated[UploadFile, File(...)],
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> CompanyOut:
    """Upload logo atau kop surat perusahaan, otomatis update field-nya."""
    c = await db.get(Company, cid)
    if not c or c.deleted_at is not None:
        raise HTTPException(404, "not_found")
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(415, "Hanya file gambar yang diterima")
    meta = await save_upload(file, subdir=f"companies/{c.id}")
    before = snapshot(c)
    if kind == "logo":
        c.logo_url = meta["url"]
    else:
        c.letterhead_url = meta["url"]
    await log(db, user_id=admin.id, entity="company", entity_id=c.id,
              action=AuditAction.UPDATE, before=before, after=snapshot(c),
              note=f"upload {kind}")
    await db.commit()
    await db.refresh(c)
    return CompanyOut.model_validate(c)
