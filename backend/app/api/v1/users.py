from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_admin, require_superadmin
from app.core.security import hash_password
from app.db.session import get_db
from app.models.models import AuditAction, Project, ProjectUser, User, UserRole
from app.schemas.auth import UserCreate, UserOut, UserUpdate
from app.schemas.common import Page
from app.services.audit import log, snapshot

router = APIRouter()


@router.get("", response_model=Page[UserOut])
async def list_users(
    q: str | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=2000),
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
    actor: User = Depends(get_current_user),
) -> UserOut:
    """Update user.

    - SUPERADMIN: bebas update siapa pun & semua field.
    - Bukan SUPERADMIN: hanya boleh update DIRI SENDIRI, dan terbatas
      ke field profil non-sensitif (name, phone, password). Field
      role / is_active / scope_all_projects tetap dijaga supaya user
      tidak bisa eskalasi privilege.
    """
    is_self = user_id == actor.id
    is_super = actor.role == UserRole.SUPERADMIN
    if not (is_self or is_super):
        raise HTTPException(403, "superadmin_only")

    u = await db.get(User, user_id)
    if not u or u.deleted_at is not None:
        raise HTTPException(404, "not_found")
    before = snapshot(u)
    data = payload.model_dump(exclude_unset=True)

    # Self-update (non-SUPERADMIN): tolak field sensitif.
    if is_self and not is_super:
        forbidden = {"role", "is_active", "scope_all_projects"}
        bad = forbidden & set(data.keys())
        if bad:
            raise HTTPException(403, f"field_forbidden_for_self_update: {','.join(sorted(bad))}")

    if "password" in data:
        pw = data.pop("password")
        if pw:
            u.password_hash = hash_password(pw)
    for k, v in data.items():
        setattr(u, k, v)
    await log(db, user_id=actor.id, entity="user", entity_id=u.id,
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


@router.get("/{user_id}/projects")
async def list_user_projects(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[dict]:
    """Daftar proyek yang di-assign ke user via project_users. Admin only.

    Catatan: user dgn scope_all_projects=True secara efektif punya akses
    ke semua proyek, tapi endpoint ini hanya mengembalikan baris eksplisit
    di project_users (utk UI bisa kasih hint kalau scope_all aktif).
    """
    target = await db.get(User, user_id)
    if not target or target.deleted_at is not None:
        raise HTTPException(404, "user_not_found")
    res = await db.execute(
        select(Project)
        .join(ProjectUser, ProjectUser.project_id == Project.id)
        .where(
            ProjectUser.user_id == user_id,
            Project.deleted_at.is_(None),
        )
        .order_by(Project.name)
    )
    return [
        {
            "id": p.id,
            "code": p.code,
            "name": p.name,
            "status": p.status.value,
        }
        for p in res.scalars().all()
    ]


@router.post("/{user_id}/projects/{project_id}", status_code=204)
async def assign_project(
    user_id: int, project_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
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
    admin: User = Depends(require_admin),
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
