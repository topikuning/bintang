"""Test services/ai/ foundation: cache + rate-limit + audit + LLM client mock.

Audit 2026-05-23 AI foundation.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.services.ai import cache, rate_limit, audit, llm
from app.services.ai.pricing import estimate_cost
from app.models.models import AICache, AICallLog


# ---------- Pricing ----------

def test_estimate_cost_known_model():
    # claude-haiku-4-5: $1/1M input + $5/1M output
    c = estimate_cost("claude-haiku-4-5", input_tokens=1_000_000, output_tokens=1_000_000)
    assert c == Decimal("6.000000")


def test_estimate_cost_unknown_fallback():
    # Worst case fallback: $5/$25
    c = estimate_cost("unknown-model", input_tokens=1_000_000, output_tokens=0)
    assert c == Decimal("5.000000")


def test_estimate_cost_zero_tokens():
    assert estimate_cost("claude-haiku-4-5", input_tokens=0, output_tokens=0) == Decimal("0E-6")


# ---------- Cache ----------

@pytest.mark.asyncio
async def test_cache_lookup_miss(db):
    assert await cache.lookup(db, namespace="test", key="missing") is None


@pytest.mark.asyncio
async def test_cache_store_and_hit(db):
    await cache.store(
        db, namespace="chat:test", key="abc123",
        value={"result": "ok"}, source_info={"model": "x"},
    )
    await db.commit()
    hit = await cache.lookup(db, namespace="chat:test", key="abc123")
    assert hit == {"result": "ok"}


@pytest.mark.asyncio
async def test_cache_namespace_isolation(db):
    """Same key, different namespace -> different cache."""
    await cache.store(db, namespace="ns:a", key="k", value={"v": 1})
    await cache.store(db, namespace="ns:b", key="k", value={"v": 2})
    await db.commit()
    a = await cache.lookup(db, namespace="ns:a", key="k")
    b = await cache.lookup(db, namespace="ns:b", key="k")
    assert a == {"v": 1}
    assert b == {"v": 2}


@pytest.mark.asyncio
async def test_cache_overwrite(db):
    await cache.store(db, namespace="ns", key="k", value={"v": 1})
    await cache.store(db, namespace="ns", key="k", value={"v": 2})
    await db.commit()
    assert (await cache.lookup(db, namespace="ns", key="k")) == {"v": 2}


def test_cache_make_key_deterministic():
    k1 = cache.make_key({"feature": "x", "input": [1, 2, 3]})
    k2 = cache.make_key({"input": [1, 2, 3], "feature": "x"})  # different order
    assert k1 == k2  # sort_keys=True
    assert len(k1) == 64  # sha256 hex


# ---------- Rate limit ----------

def test_get_limiter_singleton():
    rate_limit.reset_all()
    a = rate_limit.get_limiter("feat:test", max_calls=5, period_seconds=10.0)
    b = rate_limit.get_limiter("feat:test", max_calls=999, period_seconds=999)
    assert a is b  # same feature_id -> same instance


def test_get_limiter_per_feature():
    rate_limit.reset_all()
    a = rate_limit.get_limiter("feat:a", max_calls=5, period_seconds=10.0)
    b = rate_limit.get_limiter("feat:b", max_calls=5, period_seconds=10.0)
    assert a is not b


def test_get_limiter_check_blocks():
    rate_limit.reset_all()
    lim = rate_limit.get_limiter("feat:block", max_calls=2, period_seconds=10.0)
    assert lim.check("user1")[0] is True
    assert lim.check("user1")[0] is True
    assert lim.check("user1")[0] is False  # exceeded


# ---------- Audit ----------

@pytest.mark.asyncio
async def test_log_call_inserts_row(db):
    await audit.log_call(
        db, user_id=None, feature="test", model="claude-haiku-4-5",
        input_tokens=100, output_tokens=50, cost_usd="0.0007",
        latency_ms=1234, cached=False, success=True,
    )
    await db.commit()
    from sqlalchemy import select
    rows = (await db.execute(select(AICallLog))).scalars().all()
    assert len(rows) == 1
    r = rows[0]
    assert r.feature == "test"
    assert r.model == "claude-haiku-4-5"
    assert r.cost_usd == "0.0007"


# ---------- LLM client (mock provider) ----------

@pytest.mark.asyncio
async def test_chat_with_mocked_claude(db, monkeypatch):
    """End-to-end chat() dgn mocked _call_claude. Verify cache + audit."""
    rate_limit.reset_all()

    async def _fake_claude(**kw):
        return ("Halo dari fake!", None, 10, 20)

    monkeypatch.setattr(llm, "_call_claude", _fake_claude)
    monkeypatch.setattr(llm, "_resolve_model", lambda hint: ("claude-haiku-4-5", "claude"))

    resp = await llm.chat(
        db, user_id=1, feature="chat:test",
        prompt="Halo", system="Kamu friendly",
        cache_ttl_days=1,
    )
    await db.commit()
    assert resp.text == "Halo dari fake!"
    assert resp.cached is False
    assert resp.model == "claude-haiku-4-5"
    assert resp.input_tokens == 10
    assert resp.output_tokens == 20
    assert resp.cost_usd > 0

    # Second call -> cache hit
    resp2 = await llm.chat(
        db, user_id=1, feature="chat:test",
        prompt="Halo", system="Kamu friendly",
        cache_ttl_days=1,
    )
    assert resp2.cached is True
    assert resp2.text == "Halo dari fake!"


@pytest.mark.asyncio
async def test_chat_structured_via_json_schema(db, monkeypatch):
    """json_schema -> hasil structured ke-populate."""
    rate_limit.reset_all()
    async def _fake_claude(**kw):
        return ("", {"category_id": 5, "reason": "match"}, 30, 15)

    monkeypatch.setattr(llm, "_call_claude", _fake_claude)
    monkeypatch.setattr(llm, "_resolve_model", lambda hint: ("claude-haiku-4-5", "claude"))

    resp = await llm.chat(
        db, user_id=1, feature="chat:json",
        prompt="Pilih kategori", json_schema={"type": "object"},
        cache_ttl_days=0,  # disable cache utk test
    )
    assert resp.structured == {"category_id": 5, "reason": "match"}


@pytest.mark.asyncio
async def test_chat_rate_limit(db, monkeypatch):
    """Spam exceeds limit -> ai_rate_limited."""
    rate_limit.reset_all()
    async def _fake_claude(**kw):
        return ("ok", None, 1, 1)
    monkeypatch.setattr(llm, "_call_claude", _fake_claude)
    monkeypatch.setattr(llm, "_resolve_model", lambda hint: ("claude-haiku-4-5", "claude"))

    for i in range(3):
        await llm.chat(
            db, user_id=42, feature="chat:rl",
            prompt=f"call {i}", cache_ttl_days=0,
            rate_limit_max=3, rate_limit_period=60.0,
        )
    with pytest.raises(RuntimeError, match="ai_rate_limited"):
        await llm.chat(
            db, user_id=42, feature="chat:rl",
            prompt="call extra", cache_ttl_days=0,
            rate_limit_max=3, rate_limit_period=60.0,
        )
