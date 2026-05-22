"""C5 (audit 2026-05-22): token revocation + login rate-limit.

- Logout set users.tokens_revoked_after -> token issued before/at
  cutoff dianggap revoked.
- Login endpoint rate-limit per IP (5/60s). Wrong password 6x dari IP
  sama -> 429.
"""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException, Request

from app.api.v1.auth import login, logout
from app.core.deps import get_current_user
from app.core.rate_limit import RateLimiter, login_limiter
from app.core.security import create_access_token, hash_password
from app.models.models import User, UserRole


class _FakeForm:
    def __init__(self, username: str, password: str):
        self.username = username
        self.password = password


def _fake_request(ip: str = "127.0.0.1") -> Request:
    """Minimal Request stub utk test rate-limit (cuma butuh .headers & .client)."""
    scope = {
        "type": "http",
        "method": "POST",
        "headers": [],
        "client": (ip, 0),
    }
    return Request(scope)


class _FakeResp:
    def __init__(self):
        self.headers: dict[str, str] = {}


async def _seed_user(db, *, email="x@x", username=None, password="secret123"):
    u = User(
        email=email, username=username, name="X",
        password_hash=hash_password(password),
        role=UserRole.PROJECT_ADMIN,
    )
    db.add(u); await db.flush()
    return u


@pytest.mark.asyncio
async def test_login_includes_iat_and_is_accepted(db):
    login_limiter.reset("login:127.0.0.1")
    user = await _seed_user(db, email="a@x", password="pw123456")
    out = await login(
        request=_fake_request(),
        response=_FakeResp(),  # type: ignore[arg-type]
        form=_FakeForm("a@x", "pw123456"),
        db=db,
    )
    assert out.access_token
    # Decode untuk verifikasi iat ada
    from jose import jwt
    from app.core.config import settings
    payload = jwt.decode(out.access_token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    assert "iat" in payload


@pytest.mark.asyncio
async def test_logout_revokes_existing_token(db):
    login_limiter.reset("login:127.0.0.1")
    user = await _seed_user(db, email="b@x", password="pw123456")
    # Issue token (iat=now)
    token = create_access_token(user.id, extra={"role": user.role.value})
    # Token valid sebelum logout
    cu = await get_current_user(token=token, db=db)
    assert cu.id == user.id

    # Logout -- set tokens_revoked_after = now (sedikit di depan iat)
    await asyncio.sleep(1.1)  # pastikan logout > iat
    await logout(db=db, user=user)
    # Refresh user dr DB
    await db.refresh(user)
    assert user.tokens_revoked_after is not None

    # Token lama harus invalid sekarang
    with pytest.raises(HTTPException) as exc:
        await get_current_user(token=token, db=db)
    assert exc.value.status_code == 401
    assert exc.value.detail == "token_revoked"


@pytest.mark.asyncio
async def test_logout_does_not_kill_future_tokens(db):
    """Token baru di-issue SETELAH logout harus tetap valid (login ulang)."""
    login_limiter.reset("login:127.0.0.1")
    user = await _seed_user(db, email="c@x", password="pw123456")
    await logout(db=db, user=user)
    await asyncio.sleep(1.1)
    new_token = create_access_token(user.id, extra={"role": user.role.value})
    cu = await get_current_user(token=new_token, db=db)
    assert cu.id == user.id


def test_rate_limiter_blocks_after_max_calls():
    rl = RateLimiter(max_calls=3, period_seconds=10.0)
    for _ in range(3):
        ok, _ = rl.check("k")
        assert ok
    ok, retry = rl.check("k")
    assert not ok
    assert retry > 0


def test_rate_limiter_resets_after_reset():
    rl = RateLimiter(max_calls=2, period_seconds=10.0)
    rl.check("k"); rl.check("k")
    ok, _ = rl.check("k")
    assert not ok
    rl.reset("k")
    ok, _ = rl.check("k")
    assert ok


def test_rate_limiter_window_slides():
    rl = RateLimiter(max_calls=2, period_seconds=0.3)
    rl.check("k"); rl.check("k")
    ok, _ = rl.check("k")
    assert not ok
    time.sleep(0.35)
    ok, _ = rl.check("k")
    assert ok


@pytest.mark.asyncio
async def test_login_rate_limit_kicks_in(db):
    # Pakai key dgn IP unik utk isolation
    test_ip = "10.20.30.40"
    key = f"login:{test_ip}"
    login_limiter.reset(key)
    user = await _seed_user(db, email="d@x", password="correct123")

    # 5 attempts gagal -- semua dpt 401 (wrong password)
    for _ in range(5):
        with pytest.raises(HTTPException) as exc:
            await login(
                request=_fake_request(test_ip),
                response=_FakeResp(),  # type: ignore[arg-type]
                form=_FakeForm("d@x", "wrong"),
                db=db,
            )
        assert exc.value.status_code == 401

    # Attempt ke-6 dlm window -> rate-limited 429
    with pytest.raises(HTTPException) as exc6:
        await login(
            request=_fake_request(test_ip),
            response=_FakeResp(),  # type: ignore[arg-type]
            form=_FakeForm("d@x", "wrong"),
            db=db,
        )
    assert exc6.value.status_code == 429
    assert exc6.value.detail == "rate_limited"
    login_limiter.reset(key)


@pytest.mark.asyncio
async def test_successful_login_resets_limiter(db):
    """User normal yg typo 4x lalu sukses login -- bucket cleared."""
    test_ip = "10.20.30.41"
    key = f"login:{test_ip}"
    login_limiter.reset(key)
    user = await _seed_user(db, email="e@x", password="correct123")

    for _ in range(4):
        with pytest.raises(HTTPException):
            await login(
                request=_fake_request(test_ip),
                response=_FakeResp(),  # type: ignore[arg-type]
                form=_FakeForm("e@x", "wrong"),
                db=db,
            )

    # Sukses login -- reset bucket
    out = await login(
        request=_fake_request(test_ip),
        response=_FakeResp(),  # type: ignore[arg-type]
        form=_FakeForm("e@x", "correct123"),
        db=db,
    )
    assert out.access_token

    # Sekarang harusnya bisa coba lagi sampai 5x baru rate-limited
    for _ in range(5):
        with pytest.raises(HTTPException) as exc:
            await login(
                request=_fake_request(test_ip),
                response=_FakeResp(),  # type: ignore[arg-type]
                form=_FakeForm("e@x", "wrong"),
                db=db,
            )
        assert exc.value.status_code == 401
    login_limiter.reset(key)


@pytest.mark.asyncio
async def test_legacy_token_without_iat_still_works(db):
    """Token lama (di-issued sebelum #C5, tanpa iat di payload) harus
    tetap accepted -- supaya deploy tdk pecahkan session existing."""
    from jose import jwt
    from app.core.config import settings
    user = await _seed_user(db, email="f@x", password="x")
    # Manually issue token tanpa iat
    payload = {
        "sub": str(user.id),
        "exp": datetime.now(timezone.utc) + timedelta(minutes=60),
        "role": user.role.value,
    }
    token = jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)

    # Token harus tetap accepted (no iat -> skip revocation check)
    cu = await get_current_user(token=token, db=db)
    assert cu.id == user.id

    # Bahkan setelah logout (set tokens_revoked_after), legacy token
    # tetap accepted -- design tradeoff utk smooth deploy
    await logout(db=db, user=user)
    cu2 = await get_current_user(token=token, db=db)
    assert cu2.id == user.id
