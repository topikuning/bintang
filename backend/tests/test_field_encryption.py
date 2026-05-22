"""C3 (audit 2026-05-22): bank_account & party_account ter-encrypt at rest.

Gradual rollout: write encrypt selalu, read tolerant ke legacy plain
text (pass-through).
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import text

from app.models.models import (
    Company,
    PaymentMethod,
    Project,
    ProjectStatus,
    Transaction,
    TxnKind,
    TxnStatus,
    TxnType,
    User,
    UserRole,
    VendorClient,
    VendorClientType,
)
from app.services.field_crypto import (
    decrypt_field,
    encrypt_field,
    is_encrypted,
)


def test_encrypt_decrypt_roundtrip():
    plain = "BCA 1234567890 a.n. PT Berkah"
    enc = encrypt_field(plain)
    assert enc is not None
    assert is_encrypted(enc)
    assert enc != plain
    assert enc.startswith("enc:v1:")
    assert decrypt_field(enc) == plain


def test_encrypt_none_and_empty_returns_none():
    assert encrypt_field(None) is None
    assert encrypt_field("") is None
    assert encrypt_field("   ") is None


def test_encrypt_idempotent():
    e1 = encrypt_field("12345")
    e2 = encrypt_field(e1)  # already encrypted
    assert e1 == e2


def test_decrypt_passthrough_legacy_plain():
    """Row legacy yg belum encrypted tetap accessible."""
    assert decrypt_field("BCA 12345") == "BCA 12345"
    assert decrypt_field(None) is None


@pytest.mark.asyncio
async def test_company_bank_account_persisted_encrypted(db):
    """Verifikasi ORM auto-encrypt: raw DB row punya prefix, attr Python plain."""
    co = Company(name="C1", bank_account="BCA 9876543210 a.n. PT X")
    db.add(co); await db.flush()
    # ORM attribute = plaintext
    assert co.bank_account == "BCA 9876543210 a.n. PT X"
    # Raw DB row = encrypted
    raw = (await db.execute(
        text("SELECT bank_account FROM companies WHERE id = :id"),
        {"id": co.id},
    )).scalar_one()
    assert raw.startswith("enc:v1:")
    assert raw != "BCA 9876543210 a.n. PT X"


@pytest.mark.asyncio
async def test_vendor_bank_account_encrypted(db):
    v = VendorClient(name="V1", type=VendorClientType.VENDOR, bank_account="Mandiri 1112223334")
    db.add(v); await db.flush()
    assert v.bank_account == "Mandiri 1112223334"
    raw = (await db.execute(
        text("SELECT bank_account FROM vendors_clients WHERE id = :id"),
        {"id": v.id},
    )).scalar_one()
    assert raw.startswith("enc:v1:")


@pytest.mark.asyncio
async def test_transaction_party_account_encrypted(db):
    co = Company(name="C"); db.add(co); await db.flush()
    p = Project(code="P", name="P", company_id=co.id, status=ProjectStatus.AKTIF)
    db.add(p); await db.flush()
    u = User(name="U", email="u@x", password_hash="x", role=UserRole.PROJECT_ADMIN)
    db.add(u); await db.flush()
    tx = Transaction(
        project_id=p.id, tx_date=date(2026, 5, 22),
        type=TxnType.OUT, kind=TxnKind.INVOICE_PAYMENT.value,
        amount=Decimal("100"),
        party_account="BNI 555 a.n. CV Test",
        payment_method=PaymentMethod.TRANSFER,
        status=TxnStatus.DRAFT, created_by_id=u.id,
    )
    db.add(tx); await db.flush()
    assert tx.party_account == "BNI 555 a.n. CV Test"
    raw = (await db.execute(
        text("SELECT party_account FROM transactions WHERE id = :id"),
        {"id": tx.id},
    )).scalar_one()
    assert raw.startswith("enc:v1:")


@pytest.mark.asyncio
async def test_legacy_plain_row_readable(db):
    """Row legacy plain text (mis. dari production sebelum migrasi #C3)
    tetap dapat dibaca via ORM."""
    co = Company(name="C"); db.add(co); await db.flush()
    # Inject row legacy plain via raw UPDATE (bypass TypeDecorator)
    await db.execute(
        text("UPDATE companies SET bank_account = :v WHERE id = :id"),
        {"v": "LEGACY PLAIN 999", "id": co.id},
    )
    await db.commit()
    # Re-load via ORM
    await db.refresh(co)
    # Pass-through (tdk crash, decrypt_field return as-is)
    assert co.bank_account == "LEGACY PLAIN 999"
    # Next write -> ter-encrypt
    co.bank_account = "BCA 12345"
    await db.flush()
    raw = (await db.execute(
        text("SELECT bank_account FROM companies WHERE id = :id"),
        {"id": co.id},
    )).scalar_one()
    assert raw.startswith("enc:v1:")
