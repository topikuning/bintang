"""H9 + H10 (audit 2026-05-22): rate-limit endpoint OCR + Telegram/WA link-code.

OCR: 20 calls/menit per user (LLM/vision API berbayar).
Link-code: 5 calls/menit per user (cegah spam regenerate).
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.api.v1.ocr import extract as ocr_extract
from app.api.v1.telegram import issue_my_link_code as tg_issue
from app.core.rate_limit import (
    ocr_limiter,
    telegram_link_limiter,
)
from app.core.security import hash_password
from app.models.models import User, UserRole


async def _user(db, *, email="r@x"):
    u = User(email=email, name="R", password_hash=hash_password("x"), role=UserRole.PROJECT_ADMIN)
    db.add(u); await db.flush()
    return u


@pytest.mark.asyncio
async def test_ocr_rate_limiter_blocks(db, monkeypatch):
    """21 call ke OCR/extract dlm 1 menit -> call ke-21 dpt 429."""
    user = await _user(db, email="ocr@x")
    ocr_limiter.reset(f"ocr:{user.id}")

    # Patch adapter supaya tdk benar2 panggil LLM
    from app.api.v1 import ocr as ocr_mod

    class _FakeAdapter:
        async def extract_invoice(self, url):
            return {"raw_response": {"engine": "fake"}, "confidence_score": 1.0, "fields": {}}

    monkeypatch.setattr(ocr_mod, "get_ocr_adapter", lambda eng: _FakeAdapter())

    payload = ocr_mod.ExtractIn(file_url="http://x")
    # 20 sukses
    for _ in range(20):
        await ocr_extract(payload=payload, db=db, user=user)
    # Ke-21 -> 429
    with pytest.raises(HTTPException) as exc:
        await ocr_extract(payload=payload, db=db, user=user)
    assert exc.value.status_code == 429
    ocr_limiter.reset(f"ocr:{user.id}")


@pytest.mark.asyncio
async def test_ocr_rate_limit_per_user_isolated(db, monkeypatch):
    """User A ter-rate-limit tdk affect user B."""
    a = await _user(db, email="a@x")
    b = await _user(db, email="b@x")
    ocr_limiter.reset(f"ocr:{a.id}")
    ocr_limiter.reset(f"ocr:{b.id}")

    from app.api.v1 import ocr as ocr_mod

    class _FakeAdapter:
        async def extract_invoice(self, url):
            return {"raw_response": {"engine": "fake"}, "confidence_score": 1.0, "fields": {}}

    monkeypatch.setattr(ocr_mod, "get_ocr_adapter", lambda eng: _FakeAdapter())

    payload = ocr_mod.ExtractIn(file_url="http://x")
    # Drain user A
    for _ in range(20):
        await ocr_extract(payload=payload, db=db, user=a)
    with pytest.raises(HTTPException) as exc:
        await ocr_extract(payload=payload, db=db, user=a)
    assert exc.value.status_code == 429

    # User B masih fresh
    await ocr_extract(payload=payload, db=db, user=b)
    ocr_limiter.reset(f"ocr:{a.id}")
    ocr_limiter.reset(f"ocr:{b.id}")


@pytest.mark.asyncio
async def test_telegram_link_rate_limiter_blocks(db, monkeypatch):
    """6x generate link-code dlm 1 menit -> ke-6 dpt 429."""
    user = await _user(db, email="tg@x")
    telegram_link_limiter.reset(f"tglink:{user.id}")

    # Patch tg & messaging.get_config supaya boleh issue
    from app.api.v1 import telegram as tg_mod
    from app.services.telegram import linking as link_mod

    monkeypatch.setattr(tg_mod.tg, "is_enabled", lambda: True)

    class _Cfg:
        telegram_enabled = True

    async def _get_cfg(_db):
        return _Cfg()

    monkeypatch.setattr(tg_mod.messaging, "get_config", _get_cfg)

    # 5 sukses
    for _ in range(5):
        await tg_issue(db=db, user=user)
    # Ke-6 -> 429
    with pytest.raises(HTTPException) as exc:
        await tg_issue(db=db, user=user)
    assert exc.value.status_code == 429
    telegram_link_limiter.reset(f"tglink:{user.id}")
