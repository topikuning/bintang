from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, user_project_ids
from app.core.rate_limit import login_limiter
from app.core.security import create_access_token, verify_password
from app.db.session import get_db
from app.models.models import User
from app.schemas.auth import TokenOut, UserMe

router = APIRouter()


def _client_ip(request: Request) -> str:
    """Resolve client IP. Honor X-Forwarded-For (Railway proxy) tapi
    fallback ke direct kalau header tdk ada / suspicious."""
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        # Format: client, proxy1, proxy2... -- ambil client (paling kiri).
        first = fwd.split(",")[0].strip()
        if first:
            return first
    if request.client:
        return request.client.host
    return "unknown"


@router.post("/login", response_model=TokenOut)
async def login(
    request: Request,
    response: Response,
    form: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
) -> TokenOut:
    """Login pakai form-encoded body (username field = email atau username,
    password). Auto-detect: ada '@' -> lookup email; tdk ada -> lookup
    username (case-insensitive via normalize ke lowercase).
    Kompatibel dengan Swagger Authorize button dan OAuth2 password flow.

    Rate-limited per IP (5 attempts / 60 detik) utk cegah brute-force
    credential stuffing -- audit 2026-05-22 #C5.
    """
    # Rate-limit: cek SEBELUM lookup DB supaya tdk leak timing.
    ip = _client_ip(request)
    allowed, retry_after = login_limiter.check(f"login:{ip}")
    if not allowed:
        response.headers["Retry-After"] = str(int(retry_after) + 1)
        raise HTTPException(status_code=429, detail="rate_limited")

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
    # Sukses -- reset bucket biar user normal yg sempat typo password
    # tdk ter-block. Cuma attempt gagal yg dihitung utk lockout.
    login_limiter.reset(f"login:{ip}")
    token = create_access_token(user.id, extra={"role": user.role.value})
    return TokenOut(access_token=token)


@router.post("/logout", status_code=204)
async def logout(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    """Logout server-side: set tokens_revoked_after = now() supaya semua
    token yg ter-issued sebelum/sama dgn waktu ini di-anggap invalid
    (incl. token di device lain). Audit 2026-05-22 #C5.

    Catatan: ini implementasi 'logout from all devices'. Untuk per-device
    logout, butuh jti tracking (di-tunda).
    """
    user.tokens_revoked_after = datetime.now(timezone.utc)
    await db.commit()


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
