"""Per-feature AI settings + budget enforcement. Audit 2026-05-24."""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.security import create_access_token, hash_password
from app.db.session import get_db
from app.main import app
from app.models.models import AICallLog, AIFeatureSettings, User, UserRole
from app.services.ai.feature_settings import (
    DEFAULTS,
    BudgetExceededError,
    assert_within_budget,
    get_effective,
    monthly_spend_usd,
)


async def _seed_admin(db, role=UserRole.SUPERADMIN, email="s@x"):
    u = User(
        email=email, name="X", password_hash=hash_password("x"),
        role=role, scope_all_projects=True,
    )
    db.add(u); await db.flush()
    return u


def _hdr(user):
    return {"Authorization": f"Bearer {create_access_token(user.id, extra={'role': user.role.value})}"}


@pytest.fixture
def override_db(db):
    async def _gen():
        yield db
    app.dependency_overrides[get_db] = _gen
    yield
    app.dependency_overrides.pop(get_db, None)


# ---------- Effective config ----------

@pytest.mark.asyncio
async def test_effective_falls_back_to_defaults(db):
    cfg = await get_effective(db, "category")
    assert cfg.model_hint == DEFAULTS["category"]["model_hint"]
    assert cfg.max_tokens == DEFAULTS["category"]["max_tokens"]
    assert cfg.overridden_fields == ()


@pytest.mark.asyncio
async def test_effective_merges_override(db):
    admin = await _seed_admin(db)
    db.add(AIFeatureSettings(
        feature_key="category", model="claude-sonnet-4-6",
        max_tokens=2048, updated_by_id=admin.id,
    ))
    await db.commit()
    cfg = await get_effective(db, "category")
    assert cfg.model == "claude-sonnet-4-6"
    assert cfg.max_tokens == 2048
    # cache_ttl_days tdk di-override -> tetap default
    assert cfg.cache_ttl_days == DEFAULTS["category"]["cache_ttl_days"]
    assert set(cfg.overridden_fields) == {"model", "max_tokens"}


# ---------- Budget ----------

@pytest.mark.asyncio
async def test_budget_enforcement(db):
    admin = await _seed_admin(db)
    # Set budget 0.01 USD, sudah ada AICallLog 0.05 bulan ini
    db.add(AIFeatureSettings(
        feature_key="category",
        monthly_budget_usd=Decimal("0.01"),
        updated_by_id=admin.id,
    ))
    db.add(AICallLog(
        feature="ai:category", model="x",
        input_tokens=0, output_tokens=0,
        cost_usd="0.05",
        latency_ms=0, cached=False, success=True,
    ))
    await db.commit()
    cfg = await get_effective(db, "category")
    spent = await monthly_spend_usd(db, "category")
    assert spent == Decimal("0.05")
    with pytest.raises(BudgetExceededError):
        await assert_within_budget(db, "category", cfg)


@pytest.mark.asyncio
async def test_budget_unlimited_when_null(db):
    # Tdk ada override budget -> default None (unlimited)
    cfg = await get_effective(db, "category")
    assert cfg.monthly_budget_usd is None
    # Tdk raise meskipun ada spend gede
    db.add(AICallLog(
        feature="ai:category", model="x",
        input_tokens=0, output_tokens=0,
        cost_usd="999",
        latency_ms=0, cached=False, success=True,
    ))
    await db.commit()
    await assert_within_budget(db, "category", cfg)  # no raise


# ---------- HTTP endpoints ----------

@pytest.mark.asyncio
async def test_http_list_settings_superadmin(db, override_db):
    admin = await _seed_admin(db)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as ac:
        r = await ac.get("/api/v1/ai-feature-settings/", headers=_hdr(admin))
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["features"]) == len(DEFAULTS)
    assert any(m["id"] == "mistral-small-latest" for m in body["supported_models"])


@pytest.mark.asyncio
async def test_http_central_admin_forbidden(db, override_db):
    central = await _seed_admin(db, role=UserRole.CENTRAL_ADMIN, email="c@x")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as ac:
        r = await ac.get("/api/v1/ai-feature-settings/", headers=_hdr(central))
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_http_update_settings(db, override_db):
    admin = await _seed_admin(db)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as ac:
        r = await ac.put(
            "/api/v1/ai-feature-settings/category",
            json={
                "provider": "claude",
                "model": "claude-sonnet-4-6",
                "max_tokens": 2048,
                "cache_ttl_days": 7,
                "rate_limit_per_min": 60,
                "web_search_enabled": True,
                "monthly_budget_usd": 5.0,
            },
            headers=_hdr(admin),
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["model"] == "claude-sonnet-4-6"
    assert body["web_search_enabled"] is True
    assert float(body["monthly_budget_usd"]) == 5.0
    assert "model" in body["overridden_fields"]


@pytest.mark.asyncio
async def test_http_update_model_provider_mismatch(db, override_db):
    admin = await _seed_admin(db)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as ac:
        r = await ac.put(
            "/api/v1/ai-feature-settings/category",
            json={"provider": "mistral", "model": "claude-sonnet-4-6"},
            headers=_hdr(admin),
        )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_http_reset_settings(db, override_db):
    admin = await _seed_admin(db)
    db.add(AIFeatureSettings(
        feature_key="category", max_tokens=999, updated_by_id=admin.id,
    ))
    await db.commit()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as ac:
        r = await ac.delete(
            "/api/v1/ai-feature-settings/category", headers=_hdr(admin),
        )
    assert r.status_code == 200
    body = r.json()
    assert body["max_tokens"] == DEFAULTS["category"]["max_tokens"]
    assert body["overridden_fields"] == []
