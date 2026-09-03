"""Penyajian /files: autentikasi, cookie, dan tipe konten.

Latar: audit #S-03 mengubah `/files` dari StaticFiles anonim menjadi
router terautentikasi. Dua regresi muncul di produksi karenanya, dan
berkas ini mengunci keduanya.
"""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.files import FILE_COOKIE_NAME
from app.core.security import create_access_token, hash_password
from app.models.models import AIExtraction, User, UserRole


async def _seed_admin(db) -> User:
    u = User(
        email="files@x.test",
        name="Files Tester",
        password_hash=hash_password("secret123"),
        role=UserRole.SUPERADMIN,
    )
    db.add(u)
    await db.flush()
    await db.commit()
    return u


async def _seed_user(db, *, email: str, role: UserRole = UserRole.PROJECT_ADMIN) -> User:
    user = User(
        email=email,
        name=email.split("@", 1)[0],
        password_hash=hash_password("secret123"),
        role=role,
    )
    db.add(user)
    await db.flush()
    return user


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
    async with AsyncClient(
        transport=transport,
        base_url="http://t",
        cookies={FILE_COOKIE_NAME: "sudah-ada"},
    ) as ac:
        r = await ac.get(
            "/health",
            headers={"Authorization": "Bearer dummy"},
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


@pytest.mark.asyncio
async def test_upload_ai_hanya_bisa_dibuka_pemilik_atau_admin(db, tmp_path, monkeypatch):
    """URL acak bukan otorisasi: metadata AIExtraction menentukan pemilik."""
    from app.core import config
    from app.db.session import get_db
    from app.main import app

    monkeypatch.setattr(config.settings, "UPLOAD_DIR", str(tmp_path), raising=False)
    target = tmp_path / "ocr" / "dokumen.pdf"
    target.parent.mkdir(parents=True)
    target.write_bytes(b"%PDF-1.4\nprivate")

    owner = await _seed_user(db, email="owner@x.test")
    stranger = await _seed_user(db, email="stranger@x.test")
    admin = await _seed_user(db, email="admin@x.test", role=UserRole.CENTRAL_ADMIN)
    db.add(AIExtraction(user_id=owner.id, source_url="/files/ocr/dokumen.pdf"))
    await db.commit()

    tokens = {
        "owner": create_access_token(owner.id, extra={"role": owner.role.value}),
        "stranger": create_access_token(stranger.id, extra={"role": stranger.role.value}),
        "admin": create_access_token(admin.id, extra={"role": admin.role.value}),
    }
    app.dependency_overrides[get_db] = lambda: db
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://t") as ac:
            owner_response = await ac.get(
                "/files/ocr/dokumen.pdf",
                headers={"Authorization": f"Bearer {tokens['owner']}"},
            )
            stranger_response = await ac.get(
                "/files/ocr/dokumen.pdf",
                headers={"Authorization": f"Bearer {tokens['stranger']}"},
            )
            admin_response = await ac.get(
                "/files/ocr/dokumen.pdf",
                headers={"Authorization": f"Bearer {tokens['admin']}"},
            )
    finally:
        app.dependency_overrides.pop(get_db, None)

    assert owner_response.status_code == 200
    assert owner_response.headers["content-type"] == "application/pdf"
    assert stranger_response.status_code == 404
    assert admin_response.status_code == 200


@pytest.mark.asyncio
async def test_berkas_tanpa_metadata_dibatasi_ke_admin(db, tmp_path, monkeypatch):
    """Berkas orphan tetap bisa dikelola admin tetapi tak bocor ke anggota."""
    from app.core import config
    from app.db.session import get_db
    from app.main import app

    monkeypatch.setattr(config.settings, "UPLOAD_DIR", str(tmp_path), raising=False)
    (tmp_path / "orphan.txt").write_text("data orphan", encoding="utf-8")
    member = await _seed_user(db, email="member@x.test")
    admin = await _seed_user(db, email="orphan-admin@x.test", role=UserRole.SUPERADMIN)
    await db.commit()

    member_token = create_access_token(member.id, extra={"role": member.role.value})
    admin_token = create_access_token(admin.id, extra={"role": admin.role.value})
    app.dependency_overrides[get_db] = lambda: db
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://t") as ac:
            member_response = await ac.get(
                "/files/orphan.txt",
                headers={"Authorization": f"Bearer {member_token}"},
            )
            admin_response = await ac.get(
                "/files/orphan.txt",
                headers={"Authorization": f"Bearer {admin_token}"},
            )
    finally:
        app.dependency_overrides.pop(get_db, None)

    assert member_response.status_code == 404
    assert admin_response.status_code == 200
    assert admin_response.headers["content-disposition"].startswith("attachment;")
