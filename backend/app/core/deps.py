from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_token
from app.db.session import get_db
from app.models.models import ProjectUser, User, UserRole

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)


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
    if user.role != UserRole.SUPERADMIN:
        raise HTTPException(status_code=403, detail="superadmin_only")
    return user


async def user_project_ids(db: AsyncSession, user: User) -> list[int]:
    if user.role == UserRole.SUPERADMIN:
        return []  # convention: empty = all
    res = await db.execute(
        select(ProjectUser.project_id).where(ProjectUser.user_id == user.id)
    )
    return [row[0] for row in res.all()]


async def ensure_project_access(db: AsyncSession, user: User, project_id: int) -> None:
    if user.role == UserRole.SUPERADMIN:
        return
    res = await db.execute(
        select(ProjectUser.id).where(
            ProjectUser.user_id == user.id, ProjectUser.project_id == project_id
        )
    )
    if not res.first():
        raise HTTPException(status_code=403, detail="no_access_to_project")
