"""Ekspor ke Bintang v3: mati bawaan, token wajib, data & berkas utuh."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.security import hash_password
from app.models.models import (
    Company,
    Project,
    Transaction,
    TxnStatus,
    TxnType,
    User,
    UserRole,
    VendorClient,
)

TOKEN = "t" * 40


async def _client(db, monkeypatch, tmp_path, token: str | None):
    from app.core import config
    from app.db.session import get_db
    from app.main import app

    monkeypatch.setattr(config.settings, "UPLOAD_DIR", str(tmp_path), raising=False)
    monkeypatch.setattr(config.settings, "EKSPOR_V3_TOKEN", token or "", raising=False)
    app.dependency_overrides[get_db] = lambda: db
    return app, AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


async def _seed(db) -> None:
    u = User(
        email="a@x.test",
        name="Admin",
        password_hash=hash_password("rahasia123"),
        role=UserRole.SUPERADMIN,
    )
    c = Company(name="PT Uji", bank_account="1234567890")  # EncryptedString menyandikan saat tulis
    db.add_all([u, c])
    await db.flush()
    p = Project(code="P1", name="Proyek", company_id=c.id)
    v = VendorClient(name="TB Maju", bank_account="0987654321")
    db.add_all([p, v])
    await db.flush()
    db.add(
        Transaction(
            project_id=p.id,
            tx_date=date(2026, 10, 1),
            type=TxnType.OUT,
            amount=Decimal("1500000.50"),
            status=TxnStatus.VERIFIED,
            created_by_id=u.id,
            party_account="5555",
        )
    )
    await db.commit()


@pytest.mark.asyncio
async def test_mati_bila_token_kosong_atau_pendek(db, monkeypatch, tmp_path):
    for t in (None, "pendek"):
        app, ac = await _client(db, monkeypatch, tmp_path, t)
        try:
            async with ac:
                r = await ac.get("/api/v1/ekspor-v3/manifest", headers={"X-Ekspor-Token": t or ""})
        finally:
            app.dependency_overrides.clear()
        assert r.status_code == 404


@pytest.mark.asyncio
async def test_token_salah_ditolak(db, monkeypatch, tmp_path):
    app, ac = await _client(db, monkeypatch, tmp_path, TOKEN)
    try:
        async with ac:
            r1 = await ac.get("/api/v1/ekspor-v3/manifest")
            r2 = await ac.get("/api/v1/ekspor-v3/manifest", headers={"X-Ekspor-Token": "x" * 40})
    finally:
        app.dependency_overrides.clear()
    assert r1.status_code == 401
    assert r2.status_code == 401


@pytest.mark.asyncio
async def test_manifest_dan_tabel_dengan_rekening_terbuka(db, monkeypatch, tmp_path):
    await _seed(db)
    (tmp_path / "2026" / "10").mkdir(parents=True)
    (tmp_path / "2026" / "10" / "nota.jpg").write_bytes(b"\xff\xd8\xff" + b"0" * 100)
    (tmp_path / ".tmp").mkdir()
    (tmp_path / ".tmp" / "sampah").write_bytes(b"x")

    app, ac = await _client(db, monkeypatch, tmp_path, TOKEN)
    h = {"X-Ekspor-Token": TOKEN}
    try:
        async with ac:
            m = (await ac.get("/api/v1/ekspor-v3/manifest", headers=h)).json()
            comp = (await ac.get("/api/v1/ekspor-v3/tabel/companies", headers=h)).json()
            ven = (await ac.get("/api/v1/ekspor-v3/tabel/vendors_clients", headers=h)).json()
            tx = (await ac.get("/api/v1/ekspor-v3/tabel/transactions", headers=h)).json()
            daftar = (await ac.get("/api/v1/ekspor-v3/berkas", headers=h)).json()
            isi = await ac.get("/api/v1/ekspor-v3/berkas/2026/10/nota.jpg", headers=h)
            asing = await ac.get("/api/v1/ekspor-v3/tabel/alembic_version", headers=h)
    finally:
        app.dependency_overrides.clear()

    assert m["versi"] == 1
    assert m["tabel"]["transactions"] == 1
    assert m["berkas"] == {"jumlah": 1, "total_bytes": 103}
    # Rekening tersandi di DB, terbuka di ekspor.
    assert comp["rows"][0]["bank_account"] == "1234567890"
    assert ven["rows"][0]["bank_account"] == "0987654321"
    assert tx["rows"][0]["party_account"] == "5555"
    # Desimal & tanggal aman di JSON, tanpa kehilangan sen.
    assert tx["rows"][0]["amount"] in ("1500000.50", "1500000.5")
    assert tx["rows"][0]["tx_date"] == "2026-10-01"
    assert [b["path"] for b in daftar["berkas"]] == ["2026/10/nota.jpg"]
    assert isi.status_code == 200 and isi.content.startswith(b"\xff\xd8\xff")
    assert asing.status_code == 404


@pytest.mark.asyncio
async def test_berkas_tidak_bisa_keluar_dari_upload_dir(db, monkeypatch, tmp_path):
    rahasia = tmp_path.parent / "rahasia.txt"
    rahasia.write_text("jangan")
    up = tmp_path / "up"
    up.mkdir()
    app, ac = await _client(db, monkeypatch, up, TOKEN)
    try:
        async with ac:
            r = await ac.get(
                "/api/v1/ekspor-v3/berkas/..%2Frahasia.txt", headers={"X-Ekspor-Token": TOKEN}
            )
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 404
