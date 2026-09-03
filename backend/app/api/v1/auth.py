from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.files import FILE_COOKIE_NAME
from app.core.config import settings
from app.core.deps import get_current_user, user_project_ids
from app.core.rate_limit import login_limiter
from app.core.security import create_access_token, verify_password
from app.db.session import get_db
from app.models.models import User
from app.schemas.auth import TokenOut, UserMe

router = APIRouter()


def _client_ip(request: Request) -> str:
    """Resolve client IP untuk kunci rate-limit.

    Audit 2026-06-13 #S-06: dulu fungsi ini mengambil entri PALING KIRI
    dari `X-Forwarded-For`. Entri itu ditulis klien, bukan proxy, jadi
    penyerang cukup mengganti headernya tiap request untuk mendapat
    bucket rate-limit baru -- batas 5 percobaan/menit jadi tidak ada
    artinya untuk brute force.

    Sekarang kita hitung dari KANAN sebanyak `TRUSTED_PROXY_HOPS`. Tiap
    proxy menambahkan IP peer-nya di ujung kanan, jadi entri ke-N dari
    kanan adalah alamat yang dilihat proxy terluar kita -- satu-satunya
    yang tidak bisa dipalsukan klien. Default 1 (Railway edge). Set 0
    untuk mengabaikan header sepenuhnya dan memakai peer TCP langsung.
    """
    hops = settings.TRUSTED_PROXY_HOPS
    if hops > 0:
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            parts = [p.strip() for p in fwd.split(",") if p.strip()]
            if len(parts) >= hops:
                return parts[-hops]
            # Header lebih pendek dari yang seharusnya ditulis proxy kita
            # -> jangan tebak, jatuh ke peer langsung.
    if request.client:
        return request.client.host
    return "unknown"


def _set_file_cookie(response: Response, token: str) -> None:
    """Pasang cookie HttpOnly supaya <img>/<a> bisa memuat /files/*.

    Tag <img> tidak bisa mengirim header Authorization, jadi tanpa
    cookie ini seluruh pratinjau lampiran akan patah begitu `/files`
    tidak lagi anonim (audit #S-03). Ruang lingkupnya sengaja sempit:
    - `path=/files`   -> tidak pernah ikut ke endpoint API yang menulis
      data, jadi tidak menambah permukaan CSRF.
    - `SameSite=strict` -> tidak pernah terkirim pada request lintas-situs,
      termasuk navigasi. Aman dipakai di sini karena SETIAP akses berkas
      berasal dari SPA kita sendiri (same-site): pratinjau <img>, unduhan
      <a>, dan buka-tab-baru semuanya same-site.
      Sempat dipertimbangkan `lax` untuk berjaga kalau URL /files dikirim
      ke chat WhatsApp/Telegram -- tapi diverifikasi bahwa itu tidak
      terjadi: `send_image_url()` di whatsapp/client.py tidak pernah
      dipanggil, dan bot hanya mengirim teks. Kalau suatu saat bot mulai
      mengirim tautan berkas, ini HARUS turun ke `lax`, kalau tidak
      tautannya akan selalu 401.
    - `httponly`     -> tidak terbaca JavaScript, jadi XSS tidak bisa
      mencurinya (berbeda dari token di localStorage).
    """
    response.set_cookie(
        FILE_COOKIE_NAME,
        token,
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        httponly=True,
        samesite="strict",
        secure=settings.is_prod,
        path="/files",
    )


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

    Rate-limited dua lapis (audit 2026-05-22 #C5 + 2026-06-13 #S-06):
    per IP dan per akun, masing-masing 5 percobaan / 60 detik. Bucket
    per akun perlu karena penyerang yang punya banyak IP (atau bisa
    memalsukan hop proxy) tetap tidak boleh bebas menggempur satu akun.
    """
    raw = (form.username or "").strip()
    # Kunci per akun dinormalisasi supaya "Budi@x.com" dan "budi@x.com"
    # berbagi bucket yang sama.
    account_key = raw.lower()

    # Rate-limit: cek SEBELUM lookup DB supaya tdk leak timing.
    ip = _client_ip(request)
    for bucket in (f"login:{ip}", f"login-acct:{account_key}"):
        allowed, retry_after = login_limiter.check(bucket)
        if not allowed:
            response.headers["Retry-After"] = str(int(retry_after) + 1)
            raise HTTPException(status_code=429, detail="rate_limited")

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
    login_limiter.reset(f"login-acct:{account_key}")
    token = create_access_token(user.id, extra={"role": user.role.value})
    # Audit #S-03: cookie ini yang membuat <img src="/files/..."> tetap
    # bekerja setelah penyajian berkas tidak lagi anonim.
    _set_file_cookie(response, token)
    return TokenOut(access_token=token)


@router.post("/logout", status_code=204)
async def logout(
    response: Response,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    """Logout server-side: set tokens_revoked_after = now() supaya semua
    token yg ter-issued sebelum/sama dgn waktu ini di-anggap invalid
    (incl. token di device lain). Audit 2026-05-22 #C5.

    Catatan: ini implementasi 'logout from all devices'. Untuk per-device
    logout, butuh jti tracking (di-tunda).
    """
    user.tokens_revoked_after = datetime.now(UTC)
    await db.commit()
    # Cookie berkas dibuang juga -- kalau tidak, tab yang sudah terbuka
    # masih bisa memuat lampiran sampai cookie kedaluwarsa sendiri.
    response.delete_cookie(FILE_COOKIE_NAME, path="/files")


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
