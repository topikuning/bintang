"""Regression: login boleh pakai email ATAU username.

Auth endpoint deteksi '@' di form.username:
- ada '@' -> lookup User.email (case-sensitive, sesuai existing)
- tanpa '@' -> lookup User.username (lowercase, normalized)

User lama yg tdk punya username harus tetap login via email.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select

from fastapi import Request

from app.api.v1.auth import login
from app.core.rate_limit import login_limiter
from app.core.security import hash_password
from app.models.models import User, UserRole


async def _seed_user(db, *, email: str, password: str, username: str | None = None):
    u = User(
        email=email,
        username=username,
        name="Test",
        password_hash=hash_password(password),
        role=UserRole.PROJECT_ADMIN,
    )
    db.add(u); await db.flush()
    return u


def _form(username: str, password: str) -> OAuth2PasswordRequestForm:
    # Minimal init; field client_id/secret tdk dipakai
    return OAuth2PasswordRequestForm(username=username, password=password, scope="")


def _req(ip: str = "127.0.0.1") -> Request:
    scope = {"type": "http", "method": "POST", "headers": [], "client": (ip, 0)}
    return Request(scope)


class _Resp:
    def __init__(self):
        self.headers: dict[str, str] = {}


async def _do_login(db, username: str, password: str, ip: str = "127.0.0.1"):
    # Reset rate-limit per-test supaya tdk leak antar test.
    login_limiter.reset(f"login:{ip}")
    return await login(
        request=_req(ip),
        response=_Resp(),  # type: ignore[arg-type]
        form=_form(username, password),
        db=db,
    )


@pytest.mark.asyncio
async def test_login_with_email_works(db):
    await _seed_user(db, email="boss@x.com", password="secret123")
    out = await _do_login(db, "boss@x.com", "secret123")
    assert out.access_token


@pytest.mark.asyncio
async def test_login_with_username_works(db):
    await _seed_user(db, email="boss@x.com", password="secret123", username="boss")
    out = await _do_login(db, "boss", "secret123")
    assert out.access_token


@pytest.mark.asyncio
async def test_login_username_case_insensitive(db):
    # Stored lowercase; input mixed-case tetap match.
    await _seed_user(db, email="x@x", password="pw123456", username="admin01")
    out = await _do_login(db, "Admin01", "pw123456")
    assert out.access_token


@pytest.mark.asyncio
async def test_login_wrong_username_rejected(db):
    await _seed_user(db, email="boss@x.com", password="secret123", username="boss")
    with pytest.raises(HTTPException) as exc:
        await _do_login(db, "ghost", "secret123")
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_login_wrong_password_rejected(db):
    await _seed_user(db, email="boss@x.com", password="secret123", username="boss")
    with pytest.raises(HTTPException) as exc:
        await _do_login(db, "boss", "wrong")
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_legacy_user_without_username_uses_email(db):
    """User lama (username=None) harus tetap bisa login via email."""
    await _seed_user(db, email="old@x.com", password="legacy123")
    out = await _do_login(db, "old@x.com", "legacy123")
    assert out.access_token
    with pytest.raises(HTTPException):
        await _do_login(db, "old", "legacy123")
