from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import (
    ensure_project_access,
    get_current_user,
    require_admin,
    require_superadmin,
    user_project_ids,
)
from app.db.session import get_db
from app.models.models import AuditAction, Project, ProjectUser, User, UserRole
from app.schemas.common import Page
from app.schemas.refs import ProjectCreate, ProjectOut, ProjectUpdate
from app.services.audit import log, snapshot

router = APIRouter()


@router.get("", response_model=Page[ProjectOut])
async def list_projects(
    q: str | None = None,
    status: str | None = None,
    company_id: int | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Page[ProjectOut]:
    stmt = select(Project).where(Project.deleted_at.is_(None))
    pids = await user_project_ids(db, user)
    if pids is not None:
        if not pids:
            return Page(items=[], total=0, page=page, size=size)
        stmt = stmt.where(Project.id.in_(pids))
    if q:
        like = f"%{q}%"
        stmt = stmt.where((Project.name.ilike(like)) | (Project.code.ilike(like)))
    if status:
        stmt = stmt.where(Project.status == status)
    if company_id:
        stmt = stmt.where(Project.company_id == company_id)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    stmt = stmt.order_by(Project.id.desc()).offset((page - 1) * size).limit(size)
    items = (await db.execute(stmt)).scalars().all()
    return Page(items=[ProjectOut.model_validate(p) for p in items], total=total, page=page, size=size)


@router.post("", response_model=ProjectOut, status_code=201)
async def create_project(
    payload: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> ProjectOut:
    exists = (await db.execute(select(Project).where(Project.code == payload.code))).scalar_one_or_none()
    if exists:
        raise HTTPException(409, "project_code_already_used")
    p = Project(**payload.model_dump())
    db.add(p)
    await db.flush()
    if p.pic_user_id:
        db.add(ProjectUser(project_id=p.id, user_id=p.pic_user_id))
    await log(db, user_id=admin.id, entity="project", entity_id=p.id,
              action=AuditAction.CREATE, after=snapshot(p))
    await db.commit()
    await db.refresh(p)
    return ProjectOut.model_validate(p)


@router.get("/{pid}", response_model=ProjectOut)
async def get_project(
    pid: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ProjectOut:
    p = await db.get(Project, pid)
    if not p or p.deleted_at is not None:
        raise HTTPException(404, "not_found")
    await ensure_project_access(db, user, pid)
    return ProjectOut.model_validate(p)


@router.patch("/{pid}", response_model=ProjectOut)
async def update_project(
    pid: int,
    payload: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> ProjectOut:
    p = await db.get(Project, pid)
    if not p or p.deleted_at is not None:
        raise HTTPException(404, "not_found")
    before = snapshot(p)
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(p, k, v)
    await log(db, user_id=admin.id, entity="project", entity_id=p.id,
              action=AuditAction.UPDATE, before=before, after=snapshot(p))
    await db.commit()
    await db.refresh(p)
    return ProjectOut.model_validate(p)


@router.delete("/{pid}", status_code=204)
async def delete_project(
    pid: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> None:
    p = await db.get(Project, pid)
    if not p or p.deleted_at is not None:
        raise HTTPException(404, "not_found")
    from sqlalchemy import func as sa_func
    before = snapshot(p)
    p.deleted_at = sa_func.now()
    await log(db, user_id=admin.id, entity="project", entity_id=p.id,
              action=AuditAction.DELETE, before=before)
    await db.commit()


@router.get("/{pid}/users")
async def project_users(
    pid: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict]:
    await ensure_project_access(db, user, pid)
    res = await db.execute(
        select(User).join(ProjectUser, ProjectUser.user_id == User.id).where(
            ProjectUser.project_id == pid,
            User.deleted_at.is_(None),
        )
    )
    return [
        {"id": u.id, "email": u.email, "name": u.name, "role": u.role.value}
        for u in res.scalars().all()
    ]
