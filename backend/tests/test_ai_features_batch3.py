"""Tests AI-8 daily summary + AI-6 ask query (template router)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app.core.security import hash_password
from app.models.models import (
    Category,
    CategoryType,
    Company,
    PaymentMethod,
    Project,
    ProjectKind,
    ProjectStatus,
    Transaction,
    TxnKind,
    TxnStatus,
    TxnType,
    User,
    UserRole,
)
from app.services.ai import llm, rate_limit
from app.services.ai.features import ask_query, daily_summary


async def _seed(db):
    co = Company(name="C"); db.add(co); await db.flush()
    p = Project(code="P1", name="P1", company_id=co.id,
                status=ProjectStatus.AKTIF, kind=ProjectKind.REGULAR.value,
                budget_amount=Decimal("1000000"))
    db.add(p); await db.flush()
    u = User(email="u@x", name="U", password_hash=hash_password("x"),
             role=UserRole.SUPERADMIN)
    db.add(u); await db.flush()
    return co, p, u


# ---------- AI-8 ----------

@pytest.mark.asyncio
async def test_daily_summary_empty_day(db):
    """Hari tanpa aktivitas -> static text tanpa LLM."""
    co, p, u = await _seed(db)
    result = await daily_summary.run(db, user_id=u.id, target_date=date(2026, 6, 1))
    assert "Tdk ada aktivitas" in result["text"]
    assert result["_meta"]["model"] == "skip-llm"


@pytest.mark.asyncio
async def test_daily_summary_with_tx(db, monkeypatch):
    rate_limit.reset_all()
    co, p, u = await _seed(db)
    d = date(2026, 5, 22)
    db.add(Transaction(
        project_id=p.id, tx_date=d, type=TxnType.IN,
        kind=TxnKind.INVOICE_PAYMENT.value, amount=Decimal("1000000"),
        payment_method=PaymentMethod.TRANSFER, status=TxnStatus.VERIFIED,
        created_by_id=u.id, party_name="Klien A",
    ))
    db.add(Transaction(
        project_id=p.id, tx_date=d, type=TxnType.OUT,
        kind=TxnKind.DIRECT_EXPENSE.value, amount=Decimal("300000"),
        payment_method=PaymentMethod.CASH, status=TxnStatus.VERIFIED,
        created_by_id=u.id, party_name="Vendor B",
    ))
    await db.commit()

    async def _fake_claude(**kw):
        return ("Hari ini surplus Rp 700rb dari 1 invoice masuk Rp 1jt vs 1 belanja Rp 300rb.",
                None, 100, 50)

    monkeypatch.setattr(llm, "_call_claude", _fake_claude)
    monkeypatch.setattr(llm, "_resolve_model",
                        lambda h: ("claude-haiku-4-5", "claude"))

    result = await daily_summary.run(db, user_id=u.id, target_date=d)
    assert "surplus" in result["text"].lower()
    assert "1000000" in result["facts"]


# ---------- AI-6 ----------

@pytest.mark.asyncio
async def test_ask_query_routes_to_template(db, monkeypatch):
    """LLM pilih template 'cashflow_summary' -> backend execute."""
    rate_limit.reset_all()
    co, p, u = await _seed(db)
    db.add(Transaction(
        project_id=p.id, tx_date=date(2026, 5, 22), type=TxnType.IN,
        kind=TxnKind.INVOICE_PAYMENT.value, amount=Decimal("500"),
        payment_method=PaymentMethod.TRANSFER, status=TxnStatus.VERIFIED,
        created_by_id=u.id,
    ))
    await db.commit()

    async def _fake_claude(**kw):
        return ("", {
            "template": "cashflow_summary",
            "params": {},
            "reason": "User minta saldo periode.",
            "follow_up": "",
        }, 80, 40)

    monkeypatch.setattr(llm, "_call_claude", _fake_claude)
    monkeypatch.setattr(llm, "_resolve_model",
                        lambda h: ("claude-haiku-4-5", "claude"))

    result = await ask_query.run(db, user=u, question="Berapa saldo kas?")
    assert result["template"] == "cashflow_summary"
    assert result["data"]["columns"] == ["Metrik", "Nilai (Rp)"]
    # Pemasukan 500, OUT 0
    in_row = next(r for r in result["data"]["data"] if r[0] == "Total Pemasukan")
    assert in_row[1] == 500.0


@pytest.mark.asyncio
async def test_ask_query_unknown_template_none(db, monkeypatch):
    """LLM pilih 'none' utk pertanyaan tdk relevan."""
    rate_limit.reset_all()
    co, p, u = await _seed(db)

    async def _fake_claude(**kw):
        return ("", {
            "template": "none", "params": {},
            "reason": "Pertanyaan tdk match template.",
            "follow_up": "Coba tanya: 'Berapa total pengeluaran bulan ini?'",
        }, 50, 30)

    monkeypatch.setattr(llm, "_call_claude", _fake_claude)
    monkeypatch.setattr(llm, "_resolve_model",
                        lambda h: ("claude-haiku-4-5", "claude"))

    result = await ask_query.run(db, user=u, question="Cuaca hari ini gimana?")
    assert result["template"] == "none"
    assert result["data"] is None
    assert result["follow_up"] != ""


@pytest.mark.asyncio
async def test_ask_query_top_vendors(db, monkeypatch):
    rate_limit.reset_all()
    co, p, u = await _seed(db)
    for v, amt in [("Vendor A", 1000), ("Vendor B", 500), ("Vendor A", 700)]:
        db.add(Transaction(
            project_id=p.id, tx_date=date(2026, 5, 22), type=TxnType.OUT,
            kind=TxnKind.DIRECT_EXPENSE.value, amount=Decimal(amt),
            party_name=v,
            payment_method=PaymentMethod.CASH, status=TxnStatus.VERIFIED,
            created_by_id=u.id,
        ))
    await db.commit()

    async def _fake_claude(**kw):
        return ("", {
            "template": "top_vendors",
            "params": {"limit": 5}, "reason": "...",
        }, 50, 30)

    monkeypatch.setattr(llm, "_call_claude", _fake_claude)
    monkeypatch.setattr(llm, "_resolve_model",
                        lambda h: ("claude-haiku-4-5", "claude"))

    result = await ask_query.run(db, user=u, question="Top vendor?")
    assert result["template"] == "top_vendors"
    rows = result["data"]["data"]
    # Vendor A muncul pertama (total 1700)
    assert rows[0][0] == "Vendor A"
    assert rows[0][1] == 1700.0
