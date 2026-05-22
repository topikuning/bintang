"""H3 (audit 2026-05-22): allocation hanya boleh ke tx VERIFIED.

Sebelumnya: DRAFT, SUBMITTED, VERIFIED diizinkan -> invoice bisa
PARTIALLY_PAID padahal dana belum diverifikasi (laporan 'lunas semu').
Sekarang: strict -- harus VERIFIED dulu sebelum di-claim ke invoice.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.models.models import (
    Company,
    Invoice,
    InvoiceStatus,
    InvoiceType,
    Project,
    Transaction,
    TxnKind,
    TxnStatus,
    TxnType,
    User,
    UserRole,
)
from app.services.allocation import (
    ALLOCATABLE_TXN_STATUSES,
    apply_allocations_to_invoice,
)


@pytest.mark.asyncio
async def test_only_verified_in_allocatable_statuses():
    """Invariant constant: hanya VERIFIED."""
    assert ALLOCATABLE_TXN_STATUSES == (TxnStatus.VERIFIED,)


async def _seed(db, status: TxnStatus):
    co = Company(name="C"); db.add(co); await db.flush()
    u = User(name="u", email="u@x", password_hash="x",
             role=UserRole.PROJECT_ADMIN)
    db.add(u); await db.flush()
    p = Project(name="A", code="A", company_id=co.id)
    db.add(p); await db.flush()
    inv = Invoice(
        project_id=p.id, type=InvoiceType.IN, status=InvoiceStatus.ISSUED,
        number="INV-V", invoice_date=date.today(),
        subtotal=Decimal("1000"), tax=Decimal("0"), total=Decimal("1000"),
        created_by_id=u.id,
    )
    db.add(inv); await db.flush()
    tx = Transaction(
        project_id=p.id, type=TxnType.OUT, kind=TxnKind.INVOICE_PAYMENT,
        amount=Decimal("500"), tx_date=date.today(),
        status=status, created_by_id=u.id,
    )
    db.add(tx); await db.commit()
    return inv, tx, u


@pytest.mark.asyncio
async def test_draft_tx_cannot_be_allocated(db):
    inv, tx, u = await _seed(db, TxnStatus.DRAFT)
    with pytest.raises(HTTPException) as exc:
        await apply_allocations_to_invoice(
            db, invoice_id=inv.id,
            items=[(tx.id, Decimal("500"))],
            note=None, user_id=u.id,
        )
    assert exc.value.status_code == 409
    assert "transaction_not_allocatable" in str(exc.value.detail)


@pytest.mark.asyncio
async def test_submitted_tx_cannot_be_allocated(db):
    inv, tx, u = await _seed(db, TxnStatus.SUBMITTED)
    with pytest.raises(HTTPException) as exc:
        await apply_allocations_to_invoice(
            db, invoice_id=inv.id,
            items=[(tx.id, Decimal("500"))],
            note=None, user_id=u.id,
        )
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_verified_tx_can_be_allocated(db):
    inv, tx, u = await _seed(db, TxnStatus.VERIFIED)
    result = await apply_allocations_to_invoice(
        db, invoice_id=inv.id,
        items=[(tx.id, Decimal("500"))],
        note=None, user_id=u.id,
    )
    assert result is not None
