"""Regression: cross-project allocation harus di-tolak di service layer.

Bug class: subagent audit thought endpoint allocations.py:76 IDOR
(verifikasi project ditarik dari invoice tapi transaksi tdk). Faktanya
service-layer (allocation.py:184) sudah validate
`txn.project_id != inv.project_id` -> raise 409. Test ini memastikan
guard tsb tdk regress.
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
from app.services.allocation import apply_allocations_to_invoice


@pytest.mark.asyncio
async def test_allocation_cross_project_rejected(db):
    """Tx project A tdk boleh di-alokasi ke invoice project B."""
    co = Company(name="C"); db.add(co); await db.flush()
    u = User(name="u", email="u@x", password_hash="x",
             role=UserRole.PROJECT_ADMIN)
    db.add(u); await db.flush()

    # Dua proyek
    pa = Project(name="A", code="A", company_id=co.id)
    pb = Project(name="B", code="B", company_id=co.id)
    db.add_all([pa, pb]); await db.flush()

    # Invoice di proyek A
    inv = Invoice(
        project_id=pa.id, type=InvoiceType.IN, status=InvoiceStatus.ISSUED,
        number="INV-1", invoice_date=date.today(),
        subtotal=Decimal("1000"), tax=Decimal("0"), total=Decimal("1000"),
        created_by_id=u.id,
    )
    db.add(inv); await db.flush()

    # Tx di proyek B (BEDA)
    tx = Transaction(
        project_id=pb.id, type=TxnType.OUT, kind=TxnKind.INVOICE_PAYMENT,
        amount=Decimal("500"), tx_date=date.today(),
        status=TxnStatus.VERIFIED, created_by_id=u.id,
    )
    db.add(tx); await db.commit()

    # Coba alokasi cross-project -> harus 409
    with pytest.raises(HTTPException) as exc_info:
        await apply_allocations_to_invoice(
            db, invoice_id=inv.id,
            items=[(tx.id, Decimal("500"))],
            note=None, user_id=u.id,
        )
    assert exc_info.value.status_code == 409
    assert "project_mismatch" in str(exc_info.value.detail)


@pytest.mark.asyncio
async def test_allocation_same_project_accepted(db):
    """Sanity: same-project allocation BERHASIL (tdk regress)."""
    co = Company(name="C"); db.add(co); await db.flush()
    u = User(name="u", email="u@x", password_hash="x",
             role=UserRole.PROJECT_ADMIN)
    db.add(u); await db.flush()
    p = Project(name="A", code="A", company_id=co.id)
    db.add(p); await db.flush()

    inv = Invoice(
        project_id=p.id, type=InvoiceType.IN, status=InvoiceStatus.ISSUED,
        number="INV-1", invoice_date=date.today(),
        subtotal=Decimal("1000"), tax=Decimal("0"), total=Decimal("1000"),
        created_by_id=u.id,
    )
    db.add(inv); await db.flush()
    tx = Transaction(
        project_id=p.id, type=TxnType.OUT, kind=TxnKind.INVOICE_PAYMENT,
        amount=Decimal("500"), tx_date=date.today(),
        status=TxnStatus.VERIFIED, created_by_id=u.id,
    )
    db.add(tx); await db.commit()

    result = await apply_allocations_to_invoice(
        db, invoice_id=inv.id,
        items=[(tx.id, Decimal("500"))],
        note=None, user_id=u.id,
    )
    # Service mengembalikan dict siap utk AllocationApplyResult
    assert result is not None
