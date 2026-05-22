"""C1 (audit 2026-05-22): invoices.number harus UNIQUE global.

Regression: sebelumnya kolom hanya indexed (bukan unique) -> dua invoice
dengan nomor identik bisa dibuat. Ini bermasalah utk reconciliation,
Faktur Pajak legal (nomor unik), dan filter URL.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.api.v1.invoices import create_invoice, update_invoice
from app.models.models import (
    Company,
    Project,
    ProjectStatus,
    ProjectUser,
    User,
    UserRole,
)
from app.schemas.finance import InvoiceCreate, InvoiceItemIn, InvoiceUpdate


async def _seed(db):
    co = Company(name="C"); db.add(co); await db.flush()
    proj = Project(
        code="P1", name="P", company_id=co.id, status=ProjectStatus.AKTIF,
    )
    db.add(proj); await db.flush()
    user = User(
        name="U", email="u@x", password_hash="x",
        role=UserRole.PROJECT_ADMIN,
    )
    db.add(user); await db.flush()
    db.add(ProjectUser(project_id=proj.id, user_id=user.id))
    await db.flush()
    return co, proj, user


def _invoice_payload(number: str, project_id: int) -> InvoiceCreate:
    return InvoiceCreate(
        number=number,
        project_id=project_id,
        type="OUT",  # piutang
        invoice_date=date(2026, 5, 22),
        tax=Decimal("0"),
        items=[InvoiceItemIn(
            description="Jasa konsultasi",
            quantity=Decimal("1"),
            unit="paket",
            unit_price=Decimal("1000000"),
        )],
    )


@pytest.mark.asyncio
async def test_duplicate_invoice_number_rejected(db):
    _, proj, user = await _seed(db)
    # First invoice -> ok
    out1 = await create_invoice(
        payload=_invoice_payload("INV-2026-001", proj.id),
        db=db, user=user,
    )
    assert out1.number == "INV-2026-001"
    # Second with same number -> reject
    with pytest.raises(HTTPException) as exc:
        await create_invoice(
            payload=_invoice_payload("INV-2026-001", proj.id),
            db=db, user=user,
        )
    assert exc.value.status_code == 409
    assert exc.value.detail == "invoice_number_already_used"


@pytest.mark.asyncio
async def test_invoice_number_update_dup_rejected(db):
    _, proj, user = await _seed(db)
    out1 = await create_invoice(
        payload=_invoice_payload("INV-A", proj.id), db=db, user=user,
    )
    out2 = await create_invoice(
        payload=_invoice_payload("INV-B", proj.id), db=db, user=user,
    )
    # Coba update INV-B jadi INV-A -> dup, harus reject.
    with pytest.raises(HTTPException) as exc:
        await update_invoice(
            iid=out2.id,
            payload=InvoiceUpdate(number="INV-A"),
            db=db, user=user,
        )
    assert exc.value.status_code == 409
    assert exc.value.detail == "invoice_number_already_used"


@pytest.mark.asyncio
async def test_invoice_number_update_to_same_ok(db):
    """Update tanpa mengubah number (atau set ke value yg sama) tdk
    boleh trigger dup check (membandingkan diri sendiri)."""
    _, proj, user = await _seed(db)
    out = await create_invoice(
        payload=_invoice_payload("INV-X", proj.id), db=db, user=user,
    )
    # Update field lain saja
    out2 = await update_invoice(
        iid=out.id,
        payload=InvoiceUpdate(notes="ubah catatan saja"),
        db=db, user=user,
    )
    assert out2.number == "INV-X"
