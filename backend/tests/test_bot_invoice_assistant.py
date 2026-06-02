"""Test bot Invoice OCR flow (audit 2026-06-02).

Mock OCR pipeline supaya tdk panggil Mistral/Claude. Verifikasi:
- parse_photo_and_save -> session payload + preview text
- confirm_create -> Invoice DRAFT created
- Vendor fallback ke string kalau tdk ketemu di master
- Project default kalau hint tdk ada
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.core.security import hash_password
from app.models.models import (
    Company,
    Invoice,
    InvoiceStatus,
    InvoiceType,
    Project,
    ProjectKind,
    ProjectStatus,
    User,
    UserRole,
    VendorClient,
)
from app.services import bot_invoice_assistant as inv_asst
from app.services.bot_doc_session import (
    BotDocError,
    load_active_session,
)


async def _seed(db):
    co = Company(name="PT Bumijaya Berkah"); db.add(co); await db.flush()
    p = Project(
        code="BMJ1", name="Rekonstruksi Pucuk", company_id=co.id,
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


def _mock_ocr(monkeypatch, ocr_result: dict):
    """Patch run_extraction supaya return canned OCR result."""
    async def _fake(db, *, content, media_type, source_url, engine):
        return ocr_result

    from app.services.ocr import pipeline as ocr_pipeline
    monkeypatch.setattr(ocr_pipeline, "run_extraction", _fake)


@pytest.mark.asyncio
async def test_parse_photo_happy_path(db, monkeypatch):
    """OCR sukses -> session payload + preview text."""
    co, p, u, vendor = await _seed(db)
    _mock_ocr(monkeypatch, {
        "invoice_number": "INV-2026/05/001",
        "invoice_date": "2026-05-30",
        "vendor_name": "PT Sumber Besi",
        "due_date": "",
        "subtotal": 26865000,
        "tax": 0,
        "total": 26865000,
        "items": [
            {"description": "Besi 10 polos", "qty": 270, "unit": "lonjor", "price": 95000, "amount": 25650000},
            {"description": "Wiremesh M8 bulat", "qty": 228, "unit": "lembar", "price": 65000, "amount": 14820000},
        ],
        "confidence_score": 0.88,
        "is_handwritten": False,
        "raw_response": {"engine": "mistral:test"},
    })
    reply = await inv_asst.parse_photo_and_save(
        db, user=u, channel="telegram", chat_id="200",
        content=b"fakejpeg", media_type="image/jpeg",
        source_url=None,
        invoice_type=InvoiceType.IN,
        project_hint="BMJ1",
    )
    assert "Preview Invoice" in reply
    assert "Hutang" in reply  # type IN label
    assert "BMJ1" in reply
    assert "PT Sumber Besi" in reply
    assert "Besi 10 polos" in reply
    assert "OCR confidence" in reply

    sess = await load_active_session(db, channel="telegram", chat_id="200")
    assert sess is not None
    assert sess.entity_type == "INVOICE"


@pytest.mark.asyncio
async def test_parse_photo_project_default_when_no_hint(db, monkeypatch):
    """Tanpa project_hint -> fallback first accessible + flag default."""
    co, p, u, _ = await _seed(db)
    _mock_ocr(monkeypatch, {
        "vendor_name": "Toko X", "items": [
            {"description": "Semen", "qty": 10, "unit": "zak", "price": 75000, "amount": 750000},
        ],
        "total": 750000, "confidence_score": 0.9, "is_handwritten": False,
        "raw_response": {},
    })
    reply = await inv_asst.parse_photo_and_save(
        db, user=u, channel="telegram", chat_id="201",
        content=b"x", media_type="image/jpeg", source_url=None,
        invoice_type=InvoiceType.IN, project_hint=None,
    )
    assert p.code in reply  # project default = p (BMJ1)
    assert "default" in reply.lower()


@pytest.mark.asyncio
async def test_parse_photo_empty_items_raises(db, monkeypatch):
    """OCR fail items=[] + total=0 -> error ramah."""
    co, p, u, _ = await _seed(db)
    _mock_ocr(monkeypatch, {
        "items": [], "total": 0, "confidence_score": 0.1,
        "is_handwritten": False, "raw_response": {},
    })
    with pytest.raises(BotDocError) as exc:
        await inv_asst.parse_photo_and_save(
            db, user=u, channel="telegram", chat_id="202",
            content=b"x", media_type="image/jpeg", source_url=None,
            invoice_type=InvoiceType.IN, project_hint=None,
        )
    assert "OCR" in str(exc.value) or "foto" in str(exc.value).lower()


@pytest.mark.asyncio
async def test_confirm_create_makes_invoice_draft(db, monkeypatch):
    """End-to-end: parse -> confirm -> Invoice DRAFT exists dgn items."""
    co, p, u, vendor = await _seed(db)
    _mock_ocr(monkeypatch, {
        "invoice_number": "INV-XYZ-001",
        "invoice_date": "2026-06-01",
        "vendor_name": "PT Sumber Besi",
        "subtotal": 25650000, "tax": 0, "total": 25650000,
        "items": [
            {"description": "Besi 10", "qty": 270, "unit": "lonjor", "price": 95000, "amount": 25650000},
        ],
        "confidence_score": 0.85, "is_handwritten": False,
        "raw_response": {},
    })
    await inv_asst.parse_photo_and_save(
        db, user=u, channel="telegram", chat_id="203",
        content=b"x", media_type="image/jpeg", source_url=None,
        invoice_type=InvoiceType.IN, project_hint="BMJ1",
    )
    session = await load_active_session(db, channel="telegram", chat_id="203")
    assert session is not None

    inv = await inv_asst.confirm_create(db, user=u, session=session)
    await db.commit()
    assert inv.id is not None
    assert inv.status == InvoiceStatus.DRAFT
    assert inv.type == InvoiceType.IN
    assert inv.project_id == p.id
    assert inv.vendor_client_id == vendor.id
    assert inv.party_name == "PT Sumber Besi"
    assert inv.number == "INV-XYZ-001"
    assert len(inv.items) == 1
    assert inv.items[0].subtotal == Decimal("270") * Decimal("95000")

    # Session auto-deleted.
    sess2 = await load_active_session(db, channel="telegram", chat_id="203")
    assert sess2 is None


@pytest.mark.asyncio
async def test_confirm_create_handles_duplicate_number(db, monkeypatch):
    """OCR extract number yg sudah dipakai -> placeholder generated."""
    co, p, u, _ = await _seed(db)
    # Seed invoice dgn number yg akan di-clash dgn OCR.
    existing = Invoice(
        number="INV-DUP-001", project_id=p.id, type=InvoiceType.IN,
        status=InvoiceStatus.DRAFT, invoice_date=p.created_at.date() if hasattr(p.created_at, "date") else None,
        total=Decimal("0"), subtotal=Decimal("0"), tax=Decimal("0"),
        created_by_id=u.id,
    )
    # Pakai tanggal hari ini supaya nggak butuh import datetime
    from datetime import date
    existing.invoice_date = date.today()
    db.add(existing); await db.commit()

    _mock_ocr(monkeypatch, {
        "invoice_number": "INV-DUP-001",  # COLLISION
        "vendor_name": "Vendor Y",
        "items": [{"description": "X", "qty": 1, "price": 100, "amount": 100}],
        "total": 100, "confidence_score": 0.9, "is_handwritten": False,
        "raw_response": {},
    })
    await inv_asst.parse_photo_and_save(
        db, user=u, channel="telegram", chat_id="204",
        content=b"x", media_type="image/jpeg", source_url=None,
        invoice_type=InvoiceType.IN, project_hint="BMJ1",
    )
    session = await load_active_session(db, channel="telegram", chat_id="204")
    inv = await inv_asst.confirm_create(db, user=u, session=session)
    await db.commit()
    # Number harus beda dari yg existing.
    assert inv.number != "INV-DUP-001"
    assert inv.number.startswith("DRAFT-INV-")
