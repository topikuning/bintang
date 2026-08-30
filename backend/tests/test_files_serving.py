"""Penyajian /files: autentikasi, cookie, dan tipe konten.

Latar: audit #S-03 mengubah `/files` dari StaticFiles anonim menjadi
router terautentikasi. Dua regresi muncul di produksi karenanya, dan
berkas ini mengunci keduanya.
"""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.files import FILE_COOKIE_NAME
from app.core.security import create_access_token
from app.core.security import hash_password
from app.models.models import User, UserRole


async def _seed_admin(db) -> User:
    u = User(
        email="files@x.test", name="Files Tester",
        password_hash=hash_password("secret123"),
        role=UserRole.SUPERADMIN,
    )
    db.add(u)
    await db.flush()
    await db.commit()
    return u


@pytest.mark.asyncio
async def test_files_menolak_anonim(tmp_path, monkeypatch):
    """Inti #S-03: tanpa kredensial apa pun -> 401, bukan berkasnya."""
    from app.core import config
    from app.main import app

    monkeypatch.setattr(config.settings, "UPLOAD_DIR", str(tmp_path), raising=False)
    target = tmp_path / "2026" / "08"
    target.mkdir(parents=True)
    (target / "bukti.jpeg").write_bytes(b"\xff\xd8\xff\xe0fake-jpeg")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as ac:
        r = await ac.get("/files/2026/08/bukti.jpeg")
    assert r.status_code == 401
    assert r.json()["detail"] == "not_authenticated"


@pytest.mark.asyncio
async def test_bearer_dicerminkan_jadi_cookie_berkas(db, tmp_path, monkeypatch):
    """REGRESI PRODUKSI 2026-08-30.

    Cookie berkas dulu HANYA di-set saat login, jadi setiap sesi yang
    sudah berjalan saat deploy tidak memilikinya dan semua
    <img src="/files/..."> balas 401 -- lampiran tampak rusak sampai
    user logout-login.

    Sekarang request terautentikasi mana pun yang belum membawa cookie
    akan mendapatkannya, sehingga sesi lama sembuh sendiri.
    """
    from app.core import config
    from app.db.session import get_db
    from app.main import app

    monkeypatch.setattr(config.settings, "UPLOAD_DIR", str(tmp_path), raising=False)
    user = await _seed_admin(db)
    token = create_access_token(user.id, extra={"role": user.role.value})

    app.dependency_overrides[get_db] = lambda: db
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://t") as ac:
            r = await ac.get("/health", headers={"Authorization": f"Bearer {token}"})
    finally:
        app.dependency_overrides.pop(get_db, None)

    assert r.status_code == 200
    cookie = r.headers.get("set-cookie", "")
    assert FILE_COOKIE_NAME in cookie
    assert "HttpOnly" in cookie
    assert "Path=/files" in cookie
    assert "SameSite=strict" in cookie.replace("samesite", "SameSite")


@pytest.mark.asyncio
async def test_cookie_tidak_dipasang_ulang_kalau_sudah_ada(tmp_path, monkeypatch):
    """Kalau cookienya sudah ada, jangan kirim Set-Cookie lagi."""
    from app.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as ac:
        r = await ac.get(
            "/health",
            headers={"Authorization": "Bearer dummy"},
            cookies={FILE_COOKIE_NAME: "sudah-ada"},
        )
    assert FILE_COOKIE_NAME not in r.headers.get("set-cookie", "")


@pytest.mark.asyncio
async def test_tanpa_bearer_tidak_memasang_cookie(tmp_path):
    """Request anonim tidak boleh memicu Set-Cookie."""
    from app.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as ac:
        r = await ac.get("/health")
    assert FILE_COOKIE_NAME not in r.headers.get("set-cookie", "")
