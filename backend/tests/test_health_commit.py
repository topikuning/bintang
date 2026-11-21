"""/health melaporkan commit yang sedang berjalan.

Dipakai untuk memastikan deploy terakhir benar-benar aktif (kejadian
2026-11-09: deploy #145/#146 ter-skip di Railway, produksi tertahan di #144
tanpa ada yang sadar).
"""

from __future__ import annotations

import pytest


async def _get_health():
    from httpx import ASGITransport, AsyncClient

    from app.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        return await ac.get("/health")


@pytest.mark.asyncio
async def test_health_commit_dari_railway(monkeypatch):
    monkeypatch.setenv("RAILWAY_GIT_COMMIT_SHA", "a96966f800461c064dcc7119bf3d3d01b61080fe")
    r = await _get_health()
    assert r.status_code == 200
    assert r.json()["commit"] == "a96966f"
    assert r.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_health_commit_tanpa_env(monkeypatch):
    monkeypatch.delenv("RAILWAY_GIT_COMMIT_SHA", raising=False)
    r = await _get_health()
    assert r.json()["commit"] == "tidak-diketahui"
