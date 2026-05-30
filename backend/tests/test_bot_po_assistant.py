"""Test bot WA/Telegram -> PO chat parser (audit 2026-05-30).

Mock LLM `_call_claude` agar tdk panggil API beneran. Test scope:
- Parser ekstrak items + project/vendor hint dgn benar
- Resolver match project by code (case-insensitive) atau name ilike
- BotPOError raised kalau items kosong / project tdk ketemu
- confirm_create bikin PO DRAFT + delete session
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app.core.security import hash_password
from app.models.models import (
    Company,
    POStatus,
    Project,
    ProjectKind,
    ProjectStatus,
    PurchaseOrder,
    User,
    UserRole,
    VendorClient,
)
from app.services.ai import llm, rate_limit
from app.services.bot_po_assistant import (
    BotPOError,
    confirm_create,
    load_active_session,
    parse_and_save,
)


async def _seed(db):
    co = Company(name="PT Bumijaya Berkah"); db.add(co); await db.flush()
    p = Project(
        code="BMJ1", name="Rekonstruksi Ruas Pucuk - Sekaran",
        company_id=co.id,
        status=ProjectStatus.AKTIF, kind=ProjectKind.REGULAR.value,
    )
    db.add(p); await db.flush()
    u = User(
        email="u@x", name="U", password_hash=hash_password("x"),
        role=UserRole.SUPERADMIN, scope_all_projects=True,
    )
    db.add(u); await db.flush()
    vendor = VendorClient(name="PT Sumber Besi")
    db.add(vendor); await db.commit()
    return co, p, u, vendor


def _mock_chat(monkeypatch, parsed_struct: dict):
    """Helper: mock llm._call_claude utk return structured response."""
    rate_limit.reset_all()

    async def _fake_claude(**kw):
        # return (text, structured, in_tok, out_tok)
        return ("", parsed_struct, 100, 50)

    monkeypatch.setattr(llm, "_call_claude", _fake_claude)
    monkeypatch.setattr(
        llm, "_resolve_model", lambda h: ("claude-haiku-4-5-20251001", "claude"),
    )


@pytest.mark.asyncio
async def test_parse_and_save_happy_path(db, monkeypatch):
    """Free-text -> parsed + project matched + session saved + preview."""
    co, p, u, vendor = await _seed(db)
    _mock_chat(monkeypatch, {
        "items": [
            {"description": "Besi 10 polos", "quantity": 270, "unit": "lonjor", "unit_price": None},
            {"description": "Wiremesh M8 bulat", "quantity": 228, "unit": "lembar", "unit_price": None},
        ],
        "project_hint": "BMJ1",
        "vendor_hint": "PT Sumber Besi",
        "notes": None,
    })

    text = (
        "Besi 10 polos = 270 lonjor\n"
        "Wiremesh M8 bulat = 228 lembar\n"
        "proyek BMJ1\n"
        "vendor PT Sumber Besi"
    )
    reply = await parse_and_save(
        db, user=u, channel="telegram", chat_id="111", text=text,
    )
    assert "Preview PO" in reply
    assert "Besi 10 polos" in reply
    assert "BMJ1" in reply
    assert "PT Sumber Besi" in reply
    assert "ya" in reply.lower()

    # Session tersimpan.
    session = await load_active_session(db, channel="telegram", chat_id="111")
    assert session is not None
    assert session.user_id == u.id


@pytest.mark.asyncio
async def test_parse_empty_items_raises(db, monkeypatch):
    """AI return items=[] -> BotPOError ramah."""
    co, p, u, _ = await _seed(db)
    _mock_chat(monkeypatch, {"items": [], "project_hint": None, "vendor_hint": None})
    with pytest.raises(BotPOError) as exc:
        await parse_and_save(
            db, user=u, channel="telegram", chat_id="112", text="halo bot",
        )
    assert "item" in str(exc.value).lower()


@pytest.mark.asyncio
async def test_parse_project_not_found_raises(db, monkeypatch):
    """Project hint typo/unknown -> BotPOError."""
    co, p, u, _ = await _seed(db)
    _mock_chat(monkeypatch, {
        "items": [{"description": "Semen", "quantity": 10, "unit": "zak", "unit_price": None}],
        "project_hint": "XYZ-NONEXISTENT",
        "vendor_hint": None,
    })
    with pytest.raises(BotPOError) as exc:
        await parse_and_save(
            db, user=u, channel="telegram", chat_id="113",
            text="Semen = 10 zak proyek XYZ-NONEXISTENT",
        )
    assert "tidak ketemu" in str(exc.value).lower() or "tidak punya akses" in str(exc.value).lower()


@pytest.mark.asyncio
async def test_parse_project_resolve_by_name(db, monkeypatch):
    """project_hint = potongan nama -> match via ilike."""
    co, p, u, _ = await _seed(db)
    _mock_chat(monkeypatch, {
        "items": [{"description": "Semen", "quantity": 10, "unit": "zak", "unit_price": None}],
        "project_hint": "pucuk",  # partial nama
        "vendor_hint": None,
    })
    reply = await parse_and_save(
        db, user=u, channel="telegram", chat_id="114",
        text="Semen 10 zak proyek pucuk",
    )
    assert "Rekonstruksi Ruas Pucuk" in reply


@pytest.mark.asyncio
async def test_confirm_create_makes_po_draft(db, monkeypatch):
    """End-to-end: parse -> confirm -> PurchaseOrder DRAFT exists."""
    co, p, u, vendor = await _seed(db)
    _mock_chat(monkeypatch, {
        "items": [
            {"description": "Besi 10 polos", "quantity": 270, "unit": "lonjor", "unit_price": 95000},
            {"description": "Semen", "quantity": 10, "unit": "zak", "unit_price": None},
        ],
        "project_hint": "BMJ1",
        "vendor_hint": "PT Sumber Besi",
        "notes": "kirim sebelum jumat",
    })
    await parse_and_save(
        db, user=u, channel="telegram", chat_id="115",
        text="...",
    )
    session = await load_active_session(db, channel="telegram", chat_id="115")
    assert session is not None
    po = await confirm_create(db, user=u, session=session)
    await db.commit()
    assert po.id is not None
    assert po.status == POStatus.DRAFT
    assert po.project_id == p.id
    assert po.vendor_client_id == vendor.id
    assert po.notes == "kirim sebelum jumat"
    assert len(po.items) == 2
    # subtotal item 1 = 270 * 95000, item 2 = 10 * 0
    assert po.items[0].subtotal == Decimal("270") * Decimal("95000")
    assert po.items[1].subtotal == Decimal("0")
    # Session sudah di-delete setelah confirm.
    session2 = await load_active_session(db, channel="telegram", chat_id="115")
    assert session2 is None


@pytest.mark.asyncio
async def test_vendor_fallback_to_string(db, monkeypatch):
    """Vendor hint tdk ketemu di master -> dipakai sbg vendor_name string."""
    co, p, u, _ = await _seed(db)
    _mock_chat(monkeypatch, {
        "items": [{"description": "Pasir", "quantity": 5, "unit": "kubik", "unit_price": None}],
        "project_hint": "BMJ1",
        "vendor_hint": "Toko Anonim XYZ",  # tdk ada di VendorClient
    })
    await parse_and_save(
        db, user=u, channel="telegram", chat_id="116", text="...",
    )
    session = await load_active_session(db, channel="telegram", chat_id="116")
    po = await confirm_create(db, user=u, session=session)
    await db.commit()
    assert po.vendor_client_id is None
    assert po.vendor_name == "Toko Anonim XYZ"
