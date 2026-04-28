from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_token
from app.db.session import get_db
from app.models.models import ProjectUser, User, UserRole

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)


# Roles yang dianggap punya akses ke semua proyek (untuk read & operasional).
CENTRAL_ROLES = (UserRole.SUPERADMIN, UserRole.CENTRAL_ADMIN)


async def get_current_user(
    token: str | None = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    if not token:
        raise HTTPException(status_code=401, detail="not_authenticated")
    try:
        payload = decode_token(token)
    except ValueError:
        raise HTTPException(status_code=401, detail="invalid_token") from None
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="invalid_token")
    user = await db.get(User, int(sub))
    if not user or not user.is_active or user.deleted_at is not None:
        raise HTTPException(status_code=401, detail="user_inactive")
    return user


def require_superadmin(user: User = Depends(get_current_user)) -> User:
    """God-mode only: hard delete + cascade. Hanya SUPERADMIN."""
    if user.role != UserRole.SUPERADMIN:
        raise HTTPException(status_code=403, detail="superadmin_only")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    """Operasional admin pusat: SUPERADMIN atau CENTRAL_ADMIN."""
    if user.role not in CENTRAL_ROLES:
        raise HTTPException(status_code=403, detail="admin_only")
    return user


def require_can_write(user: User = Depends(get_current_user)) -> User:
    """Block role view-only (EXECUTIVE) dari endpoint write/upload."""
    if user.role == UserRole.EXECUTIVE:
        raise HTTPException(status_code=403, detail="read_only_role")
    return user


def has_global_access(user: User) -> bool:
    """User boleh akses SEMUA proyek (tidak perlu filter):
    - SUPERADMIN dan CENTRAL_ADMIN selalu
    - EXECUTIVE / PROJECT_ADMIN bila flag scope_all_projects = True
    """
    if user.role in CENTRAL_ROLES:
        return True
    if user.scope_all_projects:
        return True
    return False


async def user_project_ids(db: AsyncSession, user: User) -> list[int] | None:
    """Project IDs yang boleh diakses user.

    Konvensi:
    - **None**  = akses ke SEMUA proyek (tidak perlu filter)
    - **[]**    = restricted user tanpa proyek yg ditugaskan (= no access)
    - **[...]** = list project_id yang ditugaskan via project_users
    """
    if has_global_access(user):
        return None
    res = await db.execute(
        select(ProjectUser.project_id).where(ProjectUser.user_id == user.id)
    )
    return [row[0] for row in res.all()]


async def ensure_project_access(db: AsyncSession, user: User, project_id: int) -> None:
    if has_global_access(user):
        return
    res = await db.execute(
        select(ProjectUser.id).where(
            ProjectUser.user_id == user.id, ProjectUser.project_id == project_id
        )
    )
    if not res.first():
        raise HTTPException(status_code=403, detail="no_access_to_project")
