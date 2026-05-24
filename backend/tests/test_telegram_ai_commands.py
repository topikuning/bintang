"""Smoke test command AI di Telegram & WhatsApp bot. Audit 2026-05-23.

Mock services/ai/features.* utk hindari real LLM call.
"""
from __future__ import annotations

import pytest

from app.core.security import hash_password
from app.models.models import User, UserRole
from app.services.telegram import commands as tg
from app.services.whatsapp import commands as wa


async def _user(db, role=UserRole.PROJECT_ADMIN, email="t@x"):
    u = User(email=email, name="T", password_hash=hash_password("x"),
             role=role)
    db.add(u); await db.flush()
    return u


@pytest.mark.asyncio
async def test_tg_tanya_without_args_shows_usage(db):
    u = await _user(db)
    out = await tg.cmd_tanya(db, u, "chat1", [], None)
    assert "Cara pakai" in out
    assert "/tanya" in out


@pytest.mark.asyncio
async def test_tg_tanya_no_link(db):
    out = await tg.cmd_tanya(db, None, "chat1", ["test"], None)
    assert "belum ter-link" in out


@pytest.mark.asyncio
async def test_tg_tanya_calls_ai(db, monkeypatch):
    u = await _user(db, role=UserRole.SUPERADMIN)

    async def _fake_run(db, *, user, question):
        return {
            "template": "cashflow_summary",
            "reason": "User tanya saldo periode.",
            "data": {
                "columns": ["Metrik", "Nilai (Rp)"],
                "data": [["Total Pemasukan", 1000.0], ["Total Pengeluaran", 500.0]],
            },
            "follow_up": "",
            "_meta": {"model": "fake", "cost_usd": "0", "cached": False},
        }

    from app.services.ai.features import ask_query
    monkeypatch.setattr(ask_query, "run", _fake_run)

    out = await tg.cmd_tanya(db, u, "chat", ["berapa", "saldo"], None)
    assert "Total Pemasukan" in out
    assert "1.000" in out  # IDR-formatted


@pytest.mark.asyncio
async def test_tg_ringkas_admin_only(db):
    u_admin = await _user(db, role=UserRole.CENTRAL_ADMIN, email="a@x")
    u_member = await _user(db, role=UserRole.PROJECT_ADMIN, email="m@x")
    out_member = await tg.cmd_ringkas(db, u_member, "chat", [], None)
    assert "SUPERADMIN/CENTRAL_ADMIN" in out_member
    # Admin path tested via summary mock berikutnya.


@pytest.mark.asyncio
async def test_tg_ringkas_calls_summary(db, monkeypatch):
    u = await _user(db, role=UserRole.SUPERADMIN)

    async def _fake_run(db, *, user_id, target_date=None):
        return {"text": "Aktivitas normal hari ini.",
                "facts": "...",
                "_meta": {"model": "fake", "cached": False, "cost_usd": "0"}}

    from app.services.ai.features import daily_summary
    monkeypatch.setattr(daily_summary, "run", _fake_run)

    out = await tg.cmd_ringkas(db, u, "chat", [], None)
    assert "Aktivitas normal" in out
    assert "Ringkasan Hari Ini" in out


@pytest.mark.asyncio
async def test_wa_tanya_smoke(db, monkeypatch):
    u = await _user(db, role=UserRole.SUPERADMIN, email="w@x")

    async def _fake_run(db, *, user, question):
        return {"template": "none", "reason": "Tdk dikenal",
                "follow_up": "Coba: top vendor", "data": None,
                "_meta": {"model": "fake", "cost_usd": "0", "cached": False}}

    from app.services.ai.features import ask_query
    monkeypatch.setattr(ask_query, "run", _fake_run)

    out = await wa.cmd_tanya(db, u, "chat", ["test"], None)
    assert "Tdk dikenal" in out
    assert "Coba: top vendor" in out


def test_tg_registry_has_ai_commands():
    assert "tanya" in tg.REGISTRY
    assert "ringkas" in tg.REGISTRY
    assert "ask" in tg.REGISTRY  # alias
    assert "summary" in tg.REGISTRY  # alias


def test_wa_registry_has_ai_commands():
    assert "tanya" in wa.REGISTRY
    assert "ringkas" in wa.REGISTRY
