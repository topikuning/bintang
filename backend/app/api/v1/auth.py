from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, user_project_ids
from app.core.security import create_access_token, verify_password
from app.db.session import get_db
from app.models.models import User
from app.schemas.auth import TokenOut, UserMe

router = APIRouter()


@router.post("/login", response_model=TokenOut)
async def login(
    form: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
) -> TokenOut:
    """Login pakai form-encoded body (username field = email atau username,
    password). Auto-detect: ada '@' -> lookup email; tdk ada -> lookup
    username (case-insensitive via normalize ke lowercase).
    Kompatibel dengan Swagger Authorize button dan OAuth2 password flow.
    """
    raw = (form.username or "").strip()
    if "@" in raw:
        # Email -- email kita unique tapi case-sensitive di DB. Mayoritas
        # user input email lowercase, tapi safety: lookup as-is (sesuai
        # convention sebelumnya).
        res = await db.execute(select(User).where(User.email == raw))
    else:
        # Username -- selalu di-store lowercase, jadi normalize input.
        uname = raw.lower()
        if not uname:
            raise HTTPException(status_code=401, detail="invalid_credentials")
        res = await db.execute(select(User).where(User.username == uname))
    user = res.scalar_one_or_none()
    if not user or not user.is_active or user.deleted_at is not None:
        raise HTTPException(status_code=401, detail="invalid_credentials")
    if not verify_password(form.password, user.password_hash):
        raise HTTPException(status_code=401, detail="invalid_credentials")
    token = create_access_token(user.id, extra={"role": user.role.value})
    return TokenOut(access_token=token)


@router.get("/me", response_model=UserMe)
async def me(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> UserMe:
    pids = await user_project_ids(db, user)
    return UserMe(
        id=user.id,
        email=user.email,
        username=user.username,
        name=user.name,
        role=user.role,
        is_active=user.is_active,
        phone=user.phone,
        scope_all_projects=user.scope_all_projects,
        # None (akses semua) -> [] di payload (frontend tidak perlu daftar id)
        project_ids=pids or [],
    )
