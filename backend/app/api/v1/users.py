from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_superadmin
from app.core.security import hash_password
from app.db.session import get_db
from app.models.models import AuditAction, ProjectUser, User, UserRole
from app.schemas.auth import UserCreate, UserOut, UserUpdate
from app.schemas.common import Page
from app.services.audit import log, snapshot

router = APIRouter()


@router.get("", response_model=Page[UserOut])
async def list_users(
    q: str | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_superadmin),
) -> Page[UserOut]:
    stmt = select(User).where(User.deleted_at.is_(None))
    if q:
        like = f"%{q}%"
        stmt = stmt.where((User.email.ilike(like)) | (User.name.ilike(like)))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    stmt = stmt.order_by(User.id.desc()).offset((page - 1) * size).limit(size)
    items = (await db.execute(stmt)).scalars().all()
    return Page(items=[UserOut.model_validate(u) for u in items], total=total, page=page, size=size)


@router.post("", response_model=UserOut, status_code=201)
async def create_user(
    payload: UserCreate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_superadmin),
) -> UserOut:
    exists = (await db.execute(select(User).where(User.email == payload.email))).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=409, detail="email_already_used")
    user = User(
        email=payload.email,
        password_hash=hash_password(payload.password),
        name=payload.name,
        role=payload.role,
        phone=payload.phone,
        scope_all_projects=payload.scope_all_projects,
    )
    db.add(user)
    await db.flush()
    await log(db, user_id=admin.id, entity="user", entity_id=user.id,
              action=AuditAction.CREATE, after=snapshot(user))
    await db.commit()
    await db.refresh(user)
    return UserOut.model_validate(user)


@router.get("/{user_id}", response_model=UserOut)
async def get_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_superadmin),
) -> UserOut:
    u = await db.get(User, user_id)
    if not u or u.deleted_at is not None:
        raise HTTPException(404, "not_found")
    return UserOut.model_validate(u)


@router.patch("/{user_id}", response_model=UserOut)
async def update_user(
    user_id: int,
    payload: UserUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_superadmin),
) -> UserOut:
    u = await db.get(User, user_id)
    if not u or u.deleted_at is not None:
        raise HTTPException(404, "not_found")
    before = snapshot(u)
    data = payload.model_dump(exclude_unset=True)
    if "password" in data:
        pw = data.pop("password")
        if pw:
            u.password_hash = hash_password(pw)
    for k, v in data.items():
        setattr(u, k, v)
    await log(db, user_id=admin.id, entity="user", entity_id=u.id,
              action=AuditAction.UPDATE, before=before, after=snapshot(u))
    await db.commit()
    await db.refresh(u)
    return UserOut.model_validate(u)


@router.delete("/{user_id}", status_code=204)
async def delete_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_superadmin),
) -> None:
    u = await db.get(User, user_id)
    if not u or u.deleted_at is not None:
        raise HTTPException(404, "not_found")
    if u.id == admin.id:
        raise HTTPException(400, "cannot_delete_self")
    before = snapshot(u)
    u.is_active = False
    from sqlalchemy import func as sa_func
    u.deleted_at = sa_func.now()
    await log(db, user_id=admin.id, entity="user", entity_id=u.id,
              action=AuditAction.DELETE, before=before)
    await db.commit()


@router.post("/{user_id}/projects/{project_id}", status_code=204)
async def assign_project(
    user_id: int, project_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_superadmin),
) -> None:
    exists = (await db.execute(
        select(ProjectUser).where(
            ProjectUser.user_id == user_id, ProjectUser.project_id == project_id
        )
    )).scalar_one_or_none()
    if exists:
        return
    db.add(ProjectUser(user_id=user_id, project_id=project_id))
    await log(db, user_id=admin.id, entity="project_user", entity_id=project_id,
              action=AuditAction.CREATE, note=f"user {user_id} -> project {project_id}")
    await db.commit()


@router.delete("/{user_id}/projects/{project_id}", status_code=204)
async def unassign_project(
    user_id: int, project_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_superadmin),
) -> None:
    res = await db.execute(
        select(ProjectUser).where(
            ProjectUser.user_id == user_id, ProjectUser.project_id == project_id
        )
    )
    link = res.scalar_one_or_none()
    if not link:
        return
    await db.delete(link)
    await log(db, user_id=admin.id, entity="project_user", entity_id=project_id,
              action=AuditAction.DELETE, note=f"user {user_id} <- project {project_id}")
    await db.commit()
