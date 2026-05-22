"""H5 + H6 (audit 2026-05-22):

- Security headers middleware: X-Frame, X-Content-Type, Referrer-Policy,
  Permissions-Policy semua di-set di setiap response. HSTS di-prod saja.
- CORS prod validation: ALLOWED_ORIGINS empty/wildcard/localhost = refuse boot.
"""
from __future__ import annotations

from unittest.mock import patch

import pytest


def test_app_imports_with_security_middleware():
    """Sanity: app build dgn middleware tdk crash."""
    from app.main import app
    # Middleware terdaftar
    assert any(
        "SecurityHeaders" in str(m.cls)
        for m in app.user_middleware
    )


def test_cors_prod_guard_rejects_wildcard():
    from app.main import _guard_production_config
    from app.core.config import settings

    with patch.object(settings, "APP_ENV", "prod"), \
         patch.object(settings, "SECRET_KEY", "a" * 40), \
         patch.object(settings, "ALLOWED_ORIGINS", "*"):
        with pytest.raises(RuntimeError, match="ALLOWED_ORIGINS='\\*'"):
            _guard_production_config()


def test_cors_prod_guard_rejects_localhost():
    from app.main import _guard_production_config
    from app.core.config import settings

    with patch.object(settings, "APP_ENV", "prod"), \
         patch.object(settings, "SECRET_KEY", "a" * 40), \
         patch.object(
             settings, "ALLOWED_ORIGINS",
             "https://app.bintang.com,http://localhost:5173",
         ):
        with pytest.raises(RuntimeError, match="localhost/127"):
            _guard_production_config()


def test_cors_prod_guard_rejects_empty():
    from app.main import _guard_production_config
    from app.core.config import settings

    with patch.object(settings, "APP_ENV", "prod"), \
         patch.object(settings, "SECRET_KEY", "a" * 40), \
         patch.object(settings, "ALLOWED_ORIGINS", ""):
        with pytest.raises(RuntimeError, match="ALLOWED_ORIGINS kosong"):
            _guard_production_config()


def test_cors_prod_guard_accepts_valid():
    from app.main import _guard_production_config
    from app.core.config import settings

    with patch.object(settings, "APP_ENV", "prod"), \
         patch.object(settings, "SECRET_KEY", "a" * 40), \
         patch.object(settings, "ALLOWED_ORIGINS", "https://app.bintang.com"):
        # Tdk raise
        _guard_production_config()


def test_cors_dev_guard_allows_anything():
    """Dev (APP_ENV != prod) tdk validate origins -- developer flexibility."""
    from app.main import _guard_production_config
    from app.core.config import settings

    with patch.object(settings, "APP_ENV", "dev"), \
         patch.object(settings, "ALLOWED_ORIGINS", "http://localhost"):
        _guard_production_config()  # no raise


@pytest.mark.asyncio
async def test_security_headers_attached_to_response():
    """Smoke: hit /health endpoint, expect headers di response.

    Pakai httpx AsyncClient ke ASGI app supaya tdk perlu uvicorn live.
    """
    from httpx import AsyncClient, ASGITransport
    from app.main import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/health")
    assert r.status_code == 200
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert "referrer-policy" in r.headers
    assert "permissions-policy" in r.headers
