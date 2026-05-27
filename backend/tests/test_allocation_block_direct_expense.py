"""Audit 2026-05-27: TX kind=DIRECT_EXPENSE tdk boleh dialokasikan ke invoice.

DIRECT_EXPENSE punya `items` (multi-line per kategori) -- beban tercatat
in-place via TX. Kalau di-alokasi ke invoice -> double-count (beban
terhitung 2x: dari TX OUT amount + dari invoice yg dianggap "dibayar").

Test invariant + 2 path: invoice-side & transaction-side allocation.
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
    NON_ALLOCATABLE_TXN_KINDS,
    apply_allocations_to_invoice,
    apply_allocations_to_transaction,
)


def test_direct_expense_in_non_allocatable_kinds():
    """Invariant constant."""
    assert TxnKind.DIRECT_EXPENSE in NON_ALLOCATABLE_TXN_KINDS


async def _seed(db, kind: TxnKind):
    co = Company(name="C"); db.add(co); await db.flush()
    u = User(name="u", email="u@x", password_hash="x",
             role=UserRole.PROJECT_ADMIN)
    db.add(u); await db.flush()
    p = Project(name="A", code="A", company_id=co.id)
    db.add(p); await db.flush()
    inv = Invoice(
        project_id=p.id, type=InvoiceType.IN, status=InvoiceStatus.ISSUED,
        number="INV-DE", invoice_date=date.today(),
        subtotal=Decimal("1000"), tax=Decimal("0"), total=Decimal("1000"),
        created_by_id=u.id,
    )
    db.add(inv); await db.flush()
    tx = Transaction(
        project_id=p.id, type=TxnType.OUT, kind=kind,
        amount=Decimal("500"), tx_date=date.today(),
        status=TxnStatus.VERIFIED, created_by_id=u.id,
    )
    db.add(tx); await db.commit()
    return inv, tx, u


@pytest.mark.asyncio
async def test_direct_expense_blocked_invoice_side(db):
    inv, tx, u = await _seed(db, TxnKind.DIRECT_EXPENSE)
    with pytest.raises(HTTPException) as exc:
        await apply_allocations_to_invoice(
            db, invoice_id=inv.id,
            items=[(tx.id, Decimal("500"))],
            note=None, user_id=u.id,
        )
    assert exc.value.status_code == 409
    assert "direct_expense_not_allocatable" in str(exc.value.detail)


@pytest.mark.asyncio
async def test_direct_expense_blocked_transaction_side(db):
    inv, tx, u = await _seed(db, TxnKind.DIRECT_EXPENSE)
    with pytest.raises(HTTPException) as exc:
        await apply_allocations_to_transaction(
            db, transaction_id=tx.id,
            items=[(inv.id, Decimal("500"))],
            note=None, user_id=u.id,
        )
    assert exc.value.status_code == 409
    assert "direct_expense_not_allocatable" in str(exc.value.detail)


@pytest.mark.asyncio
async def test_invoice_payment_still_allowed(db):
    """Pastikan kind default tetap bisa dialokasikan."""
    inv, tx, u = await _seed(db, TxnKind.INVOICE_PAYMENT)
    result = await apply_allocations_to_invoice(
        db, invoice_id=inv.id,
        items=[(tx.id, Decimal("500"))],
        note=None, user_id=u.id,
    )
    assert result is not None
    assert result["total_applied"] == Decimal("500.00")
