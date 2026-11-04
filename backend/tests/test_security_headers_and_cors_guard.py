"""H5 + H6 (audit 2026-05-22):

- Security headers middleware: X-Frame, X-Content-Type, Referrer-Policy,
  Permissions-Policy semua di-set di setiap response. HSTS di-prod saja.
- CORS prod validation. Perilakunya berubah dua kali seiring arsitektur:
    * era 3-service : kosong/wildcard/localhost = refuse boot
    * 2026-06-13    : kosong jadi SAH (SPA satu origin dgn API)
    * 2026-08-30    : localhost tidak lagi refuse boot, cukup DIBUANG --
                      hanya wildcard '*' yang masih menolak boot.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest


def test_app_imports_with_security_middleware():
    """Sanity: app build dgn middleware tdk crash."""
    from app.main import app

    # Middleware terdaftar
    assert any("SecurityHeaders" in str(m.cls) for m in app.user_middleware)


def test_cors_prod_guard_rejects_wildcard():
    from app.core.config import settings
    from app.main import _guard_production_config

    with (
        patch.object(settings, "APP_ENV", "prod"),
        patch.object(settings, "SECRET_KEY", "a" * 40),
        patch.object(settings, "ALLOWED_ORIGINS", "*"),
    ):
        with pytest.raises(RuntimeError, match="ALLOWED_ORIGINS='\\*'"):
            _guard_production_config()


def test_cors_prod_tidak_menolak_boot_karena_localhost():
    """REPRODUKSI INSIDEN 2026-08-30.

    Deploy produksi mati di startup dgn:

        REFUSE_BOOT: ALLOWED_ORIGINS punya localhost/127.0.0.1 di prod
        (['http://localhost:5173', 'http://127.0.0.1:5173'])

    Nilai itu adalah DEFAULT lama di config.py -- variabelnya memang
    tidak pernah di-set di Railway. Menolak boot karena sisa konfigurasi
    era 3-service adalah reaksi yang terlalu keras: yang dibutuhkan cuma
    mengabaikan entri itu.
    """
    from app.core.config import settings
    from app.main import _guard_production_config

    with (
        patch.object(settings, "APP_ENV", "prod"),
        patch.object(settings, "SECRET_KEY", "a" * 40),
        patch.object(settings, "ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"),
    ):
        _guard_production_config()  # tidak boleh raise
        # ...dan entri localhost TIDAK boleh sampai ke CORSMiddleware.
        assert settings.allowed_origins_effective == []


def test_cors_prod_membuang_localhost_tapi_menyimpan_origin_asli():
    """Origin produksi yang sah tetap dipertahankan."""
    from app.core.config import settings

    with (
        patch.object(settings, "APP_ENV", "prod"),
        patch.object(settings, "ALLOWED_ORIGINS", "https://app.bintang.com,http://localhost:5173"),
    ):
        assert settings.allowed_origins_effective == ["https://app.bintang.com"]
        assert settings.local_origins_in_prod == ["http://localhost:5173"]


def test_cors_dev_tidak_membuang_localhost():
    """Di dev, localhost justru yang dipakai -- jangan disaring."""
    from app.core.config import settings

    with (
        patch.object(settings, "APP_ENV", "dev"),
        patch.object(settings, "ALLOWED_ORIGINS", "http://localhost:5173"),
    ):
        assert settings.allowed_origins_effective == ["http://localhost:5173"]


def test_cors_prod_guard_accepts_empty_after_single_service_merge():
    """ALLOWED_ORIGINS kosong kini SAH -- dan justru paling aman.

    Sebelum 2026-06-13, frontend adalah service Railway terpisah,
    sehingga origin frontend WAJIB didaftarkan dan guard menolak boot
    kalau kosong. Setelah SPA disajikan FastAPI dari origin yang sama,
    tidak ada lagi request lintas-origin yang perlu diizinkan, jadi
    kosong = "same-origin saja".

    Wildcard '*' TETAP menolak boot; localhost hanya dibuang.
    """
    from app.core.config import settings
    from app.main import _guard_production_config

    with (
        patch.object(settings, "APP_ENV", "prod"),
        patch.object(settings, "SECRET_KEY", "a" * 40),
        patch.object(settings, "ALLOWED_ORIGINS", ""),
    ):
        _guard_production_config()  # tidak boleh raise


def test_cors_prod_guard_accepts_valid():
    from app.core.config import settings
    from app.main import _guard_production_config

    with (
        patch.object(settings, "APP_ENV", "prod"),
        patch.object(settings, "SECRET_KEY", "a" * 40),
        patch.object(settings, "ALLOWED_ORIGINS", "https://app.bintang.com"),
    ):
        # Tdk raise
        _guard_production_config()


def test_cors_dev_guard_allows_anything():
    """Dev (APP_ENV != prod) tdk validate origins -- developer flexibility."""
    from app.core.config import settings
    from app.main import _guard_production_config

    with (
        patch.object(settings, "APP_ENV", "dev"),
        patch.object(settings, "ALLOWED_ORIGINS", "http://localhost"),
    ):
        _guard_production_config()  # no raise


@pytest.mark.asyncio
async def test_security_headers_attached_to_response():
    """Smoke: hit /health endpoint, expect headers di response.

    Pakai httpx AsyncClient ke ASGI app supaya tdk perlu uvicorn live.
    """
    from httpx import ASGITransport, AsyncClient

    from app.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/health")
    assert r.status_code == 200
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert "referrer-policy" in r.headers
    assert "permissions-policy" in r.headers
