"""Tests untuk AI-5 anomaly detection + AI-7 contract extraction.

Mock LLM/vision call utk hindari real API.
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.core.security import hash_password
from app.models.models import (
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
from app.services.ai.features import anomaly, contract_extract


async def _seed(db):
    co = Company(name="C"); db.add(co); await db.flush()
    p = Project(code="P1", name="P1", company_id=co.id,
                status=ProjectStatus.AKTIF, kind=ProjectKind.REGULAR.value)
    db.add(p); await db.flush()
    u = User(email="u@x", name="U", password_hash=hash_password("x"),
             role=UserRole.SUPERADMIN)
    db.add(u); await db.flush()
    return co, p, u


# ---------- AI-5 anomaly ----------

@pytest.mark.asyncio
async def test_anomaly_empty_period(db):
    """Periode tanpa tx -> safe return."""
    co, p, u = await _seed(db)
    result = await anomaly.run(
        db, user_id=u.id,
        date_from=date(2026, 5, 1), date_to=date(2026, 5, 31),
    )
    assert result["flagged"] == []
    assert "Tdk ada transaksi" in result["summary"]


@pytest.mark.asyncio
async def test_anomaly_flags_high_amount(db, monkeypatch):
    """Tx besar di-flag oleh prefilter, LLM verdict severity."""
    rate_limit.reset_all()
    co, p, u = await _seed(db)
    # Create 5 normal tx + 1 huge
    base = date(2026, 5, 22)
    for i in range(5):
        db.add(Transaction(
            project_id=p.id, tx_date=base, type=TxnType.OUT,
            kind=TxnKind.DIRECT_EXPENSE.value, amount=Decimal("100000"),
            party_name=f"Vendor {i}",
            payment_method=PaymentMethod.CASH, status=TxnStatus.VERIFIED,
            created_by_id=u.id,
        ))
    big = Transaction(
        project_id=p.id, tx_date=base, type=TxnType.OUT,
        kind=TxnKind.DIRECT_EXPENSE.value, amount=Decimal("50000000"),
        party_name="Vendor Baru Misterius",
        payment_method=PaymentMethod.CASH, status=TxnStatus.VERIFIED,
        created_by_id=u.id, description="Pembelian besar",
    )
    db.add(big); await db.commit()

    big_id = big.id

    async def _fake_claude(**kw):
        return ("", {
            "flagged": [{
                "tx_id": big_id, "severity": "high",
                "anomaly_type": "vendor_baru_besar",
                "reason": "Vendor baru, nominal 50% dari total periode.",
            }],
            "summary": "1 flag high severity.",
        }, 500, 200)

    monkeypatch.setattr(llm, "_call_claude", _fake_claude)
    monkeypatch.setattr(llm, "_resolve_model",
                        lambda h: ("claude-sonnet-4-6", "claude"))

    result = await anomaly.run(
        db, user_id=u.id,
        date_from=base, date_to=base,
    )
    assert len(result["flagged"]) == 1
    assert result["flagged"][0]["tx_id"] == big_id
    assert result["flagged"][0]["severity"] == "high"


@pytest.mark.asyncio
async def test_anomaly_filters_invalid_tx_ids(db, monkeypatch):
    """LLM return tx_id yg tdk ada di period -> dibuang (validation)."""
    rate_limit.reset_all()
    co, p, u = await _seed(db)
    db.add(Transaction(
        project_id=p.id, tx_date=date(2026, 5, 1), type=TxnType.OUT,
        kind=TxnKind.DIRECT_EXPENSE.value, amount=Decimal("100"),
        payment_method=PaymentMethod.CASH, status=TxnStatus.VERIFIED,
        created_by_id=u.id,
    ))
    await db.commit()

    async def _fake_claude(**kw):
        return ("", {
            "flagged": [
                {"tx_id": 999999, "severity": "high",  # invalid id
                 "anomaly_type": "test", "reason": "halusinasi"},
            ],
            "summary": "test",
        }, 100, 50)

    monkeypatch.setattr(llm, "_call_claude", _fake_claude)
    monkeypatch.setattr(llm, "_resolve_model",
                        lambda h: ("claude-sonnet-4-6", "claude"))

    result = await anomaly.run(
        db, user_id=u.id,
        date_from=date(2026, 5, 1), date_to=date(2026, 5, 31),
    )
    # 999999 di-filter out
    assert result["flagged"] == []


# ---------- AI-7 contract extract (vision) ----------

@pytest.mark.asyncio
async def test_contract_extract_returns_schema(db, monkeypatch):
    """Vision call mock -> result struktur cocok schema."""
    rate_limit.reset_all()
    co, p, u = await _seed(db)

    fake_extraction = {
        "doc_type": "kontrak",
        "doc_number": "K-001/2026",
        "doc_date": "2026-01-15",
        "parties": [
            {"name": "PT A", "role": "Pihak Pertama"},
            {"name": "CV B", "role": "Kontraktor"},
        ],
        "contract_value": 500000000,
        "currency": "IDR",
        "start_date": "2026-02-01",
        "end_date": "2026-12-31",
        "scope_summary": "Pembangunan kantor 3 lantai.",
        "key_clauses": [
            {"title": "Pasal 5 Pembayaran", "summary": "30/40/30."},
        ],
        "key_dates": [],
        "notes": "",
        "confidence_score": 0.92,
    }

    # Mock vision.extract_from_image (anthropic SDK tdk ada di test env)
    async def _fake_extract(*args, **kwargs):
        return {**fake_extraction, "_meta": {"model": "fake", "cached": False,
                                              "cost_usd": "0.01"}}

    # Patch ke contract_extract module (krn import bound saat module load).
    monkeypatch.setattr(contract_extract, "extract_from_image", _fake_extract)

    result = await contract_extract.run(
        db, user_id=u.id, content=b"fake-pdf-bytes",
        media_type="application/pdf",
    )
    assert result["doc_type"] == "kontrak"
    assert len(result["parties"]) == 2
    assert result["contract_value"] == 500000000
    assert result["confidence_score"] == 0.92
