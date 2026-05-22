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

from app.api.v1.auth import login
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


@pytest.mark.asyncio
async def test_login_with_email_works(db):
    await _seed_user(db, email="boss@x.com", password="secret123")
    out = await login(form=_form("boss@x.com", "secret123"), db=db)
    assert out.access_token


@pytest.mark.asyncio
async def test_login_with_username_works(db):
    await _seed_user(db, email="boss@x.com", password="secret123", username="boss")
    out = await login(form=_form("boss", "secret123"), db=db)
    assert out.access_token


@pytest.mark.asyncio
async def test_login_username_case_insensitive(db):
    # Stored lowercase; input mixed-case tetap match.
    await _seed_user(db, email="x@x", password="pw123456", username="admin01")
    out = await login(form=_form("Admin01", "pw123456"), db=db)
    assert out.access_token


@pytest.mark.asyncio
async def test_login_wrong_username_rejected(db):
    await _seed_user(db, email="boss@x.com", password="secret123", username="boss")
    with pytest.raises(HTTPException) as exc:
        await login(form=_form("ghost", "secret123"), db=db)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_login_wrong_password_rejected(db):
    await _seed_user(db, email="boss@x.com", password="secret123", username="boss")
    with pytest.raises(HTTPException) as exc:
        await login(form=_form("boss", "wrong"), db=db)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_legacy_user_without_username_uses_email(db):
    """User lama (username=None) harus tetap bisa login via email."""
    await _seed_user(db, email="old@x.com", password="legacy123")
    # Login via email -> ok
    out = await login(form=_form("old@x.com", "legacy123"), db=db)
    assert out.access_token
    # Login via dummy "old" tanpa @ -> miss (username field NULL)
    with pytest.raises(HTTPException):
        await login(form=_form("old", "legacy123"), db=db)
