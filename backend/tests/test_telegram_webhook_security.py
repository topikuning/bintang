"""Webhook Telegram harus tertutup ketika secret belum dikonfigurasi."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.api.v1 import telegram


def _request() -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/telegram/webhook",
            "headers": [],
            "query_string": b"",
        }
    )


@pytest.mark.asyncio
async def test_webhook_menolak_ketika_secret_belum_disetel(db, monkeypatch):
    """Integrasi aktif tanpa secret tidak boleh berubah menjadi endpoint publik."""

    async def _config(_db):
        return SimpleNamespace(telegram_enabled=True)

    async def _missing_secret(_db, _key):
        return None

    monkeypatch.setattr(telegram.tg, "is_enabled", lambda: True)
    monkeypatch.setattr(telegram.messaging, "get_config", _config)
    monkeypatch.setattr(telegram, "get_setting", _missing_secret)

    with pytest.raises(HTTPException) as exc:
        await telegram.webhook(_request(), db=db)

    assert exc.value.status_code == 503
    assert exc.value.detail == "telegram_webhook_secret_required"


@pytest.mark.asyncio
async def test_webhook_menolak_secret_yang_salah(db, monkeypatch):
    async def _config(_db):
        return SimpleNamespace(telegram_enabled=True)

    async def _secret(_db, _key):
        return "secret-valid"

    monkeypatch.setattr(telegram.tg, "is_enabled", lambda: True)
    monkeypatch.setattr(telegram.messaging, "get_config", _config)
    monkeypatch.setattr(telegram, "get_setting", _secret)

    with pytest.raises(HTTPException) as exc:
        await telegram.webhook(
            _request(),
            x_telegram_bot_api_secret_token="secret-salah",
            db=db,
        )

    assert exc.value.status_code == 401
    assert exc.value.detail == "bad_secret"
