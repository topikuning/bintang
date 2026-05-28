"""Smoke + integration test untuk fitur AI batch 1: category suggest,
PO cover gen, cash request justify.

Mock services/ai.chat untuk hindari real LLM call.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app.core.security import hash_password
from app.models.models import (
    CashRequest,
    CashRequestItem,
    CashRequestStatus,
    Category,
    CategoryType,
    Company,
    POItem,
    Project,
    ProjectKind,
    ProjectStatus,
    PurchaseOrder,
    POStatus,
    User,
    UserRole,
)
from app.services.ai import llm, rate_limit
from app.services.ai.features import (
    cash_request_justify,
    category as category_feat,
    po_cover,
)


async def _seed(db):
    co = Company(name="C"); db.add(co); await db.flush()
    p = Project(code="P1", name="P1", company_id=co.id,
                status=ProjectStatus.AKTIF, kind=ProjectKind.REGULAR.value)
    db.add(p); await db.flush()
    u = User(email="u@x", name="U", password_hash=hash_password("x"),
             role=UserRole.PROJECT_ADMIN)
    db.add(u); await db.flush()
    return co, p, u


# ---------- AI-1 category ----------

@pytest.mark.asyncio
async def test_category_suggest_returns_valid_id(db, monkeypatch):
    rate_limit.reset_all()
    co, p, u = await _seed(db)
    cat = Category(name="Material Konstruksi", type=CategoryType.OUT)
    db.add(cat); await db.flush()
    cat_id = cat.id

    async def _fake_claude(**kw):
        return ("", {"category_id": cat_id, "confidence": 0.92,
                     "reason": "deskripsi sebut material"}, 50, 20)

    monkeypatch.setattr(llm, "_call_claude", _fake_claude)
    monkeypatch.setattr(llm, "_resolve_model",
                        lambda h: ("claude-haiku-4-5", "claude"))

    result = await category_feat.run(
        db, user_id=u.id, description="Beli semen 50 sak", direction="OUT",
    )
    assert result["category_id"] == cat_id
    assert result["category_name"] == "Material Konstruksi"
    assert result["confidence"] == 0.92


@pytest.mark.asyncio
async def test_category_suggest_rejects_hallucinated_id(db, monkeypatch):
    """LLM return ID yg tdk ada di list -> validated to None."""
    rate_limit.reset_all()
    co, p, u = await _seed(db)
    db.add(Category(name="X", type=CategoryType.OUT))
    await db.commit()

    async def _fake_claude(**kw):
        return ("", {"category_id": 999999, "confidence": 0.9,
                     "reason": "halusinasi"}, 10, 10)

    monkeypatch.setattr(llm, "_call_claude", _fake_claude)
    monkeypatch.setattr(llm, "_resolve_model",
                        lambda h: ("claude-haiku-4-5", "claude"))

    result = await category_feat.run(
        db, user_id=u.id, description="Foo", direction="OUT",
    )
    assert result["category_id"] is None
    assert result["category_name"] is None


@pytest.mark.asyncio
async def test_category_suggest_empty_db(db, monkeypatch):
    """Tdk ada kategori di DB -> safe return."""
    rate_limit.reset_all()
    co, p, u = await _seed(db)
    result = await category_feat.run(db, user_id=u.id, description="X")
    assert result["category_id"] is None
    assert result["confidence"] == 0


# ---------- AI-2 po_cover ----------

@pytest.mark.asyncio
async def test_po_cover_generates_text(db, monkeypatch):
    rate_limit.reset_all()
    co, p, u = await _seed(db)
    po = PurchaseOrder(
        number="PO-001", project_id=p.id, company_id=co.id,
        po_date=date(2026, 5, 22), vendor_name="PT Vendor X",
        total=Decimal("1000000"), status=POStatus.APPROVED,
        created_by_id=u.id,
    )
    db.add(po); await db.flush()
    db.add(POItem(po_id=po.id, description="Semen 50 sak",
                  quantity=Decimal("50"), unit="sak",
                  unit_price=Decimal("70000"), subtotal=Decimal("3500000")))
    await db.commit()

    async def _fake_claude(**kw):
        return ("Kepada PT Vendor X,\n\nSurat pengantar PO-001...",
                None, 200, 150)

    monkeypatch.setattr(llm, "_call_claude", _fake_claude)
    monkeypatch.setattr(llm, "_resolve_model",
                        lambda h: ("claude-sonnet-4-6", "claude"))

    result = await po_cover.run(db, user_id=u.id, po_id=po.id, tone="formal")
    assert result["text"].startswith("Kepada PT Vendor X")
    assert "_meta" in result
    assert result["_meta"]["model"] == "claude-sonnet-4-6"


@pytest.mark.asyncio
async def test_po_cover_404_on_missing_po(db, monkeypatch):
    co, p, u = await _seed(db)
    with pytest.raises(ValueError, match="po_not_found"):
        await po_cover.run(db, user_id=u.id, po_id=99999)


# ---------- AI-4 cash_request_justify ----------

@pytest.mark.asyncio
async def test_justify_by_cash_request_id(db, monkeypatch):
    rate_limit.reset_all()
    co, p, u = await _seed(db)
    cr = CashRequest(
        number="CR-1", project_id=p.id, requester_id=u.id,
        request_date=date(2026, 5, 22), title="Beli material minggu 12",
        total_amount=Decimal("500000"), status=CashRequestStatus.PENDING,
    )
    db.add(cr); await db.flush()
    db.add(CashRequestItem(
        request_id=cr.id, description="Paku 5 kg", amount=Decimal("500000"),
    ))
    await db.commit()

    async def _fake_claude(**kw):
        return ("Pengajuan untuk pembelian paku tahap finishing minggu ini.",
                None, 80, 40)

    monkeypatch.setattr(llm, "_call_claude", _fake_claude)
    monkeypatch.setattr(llm, "_resolve_model",
                        lambda h: ("claude-haiku-4-5", "claude"))

    result = await cash_request_justify.run(
        db, user_id=u.id, cash_request_id=cr.id,
    )
    assert "Pengajuan" in result["text"]


@pytest.mark.asyncio
async def test_justify_by_draft_items(db, monkeypatch):
    """Mode 2: tanpa CR di DB, langsung dari items draft."""
    rate_limit.reset_all()
    co, p, u = await _seed(db)

    async def _fake_claude(**kw):
        return ("Justifikasi belanja draft.", None, 40, 20)

    monkeypatch.setattr(llm, "_call_claude", _fake_claude)
    monkeypatch.setattr(llm, "_resolve_model",
                        lambda h: ("claude-haiku-4-5", "claude"))

    result = await cash_request_justify.run(
        db, user_id=u.id, project_id=p.id, title="Draft test",
        items=[{"description": "Item A", "amount": "100"}],
    )
    assert "Justifikasi" in result["text"]


@pytest.mark.asyncio
async def test_justify_missing_input(db):
    co, p, u = await _seed(db)
    with pytest.raises(ValueError, match="missing_input"):
        await cash_request_justify.run(db, user_id=u.id, title="X")
