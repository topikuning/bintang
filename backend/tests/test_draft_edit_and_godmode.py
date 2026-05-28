"""Regression test edit DRAFT bebas + SUPERADMIN god-mode.

Audit 2026-05-23 user lapor:
- PO draft edit project tdk berubah (project_id silent-ignored krn tdk
  ada di POUpdate schema).
- Godmode SUPERADMIN harusnya bisa edit semua kondisi.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app.api.v1.purchase_orders import update_po
from app.api.v1.invoices import update_invoice
from app.api.v1.transactions import update_transaction
from app.core.security import hash_password
from app.models.models import (
    Company,
    Invoice,
    InvoiceStatus,
    InvoiceType,
    PaymentMethod,
    POItem,
    Project,
    ProjectKind,
    ProjectStatus,
    POStatus,
    PurchaseOrder,
    Transaction,
    TxnKind,
    TxnStatus,
    TxnType,
    User,
    UserRole,
)
from app.schemas.finance import (
    InvoiceUpdate,
    POUpdate,
    TransactionUpdate,
)


async def _seed_2_projects(db, *, role=UserRole.PROJECT_ADMIN):
    co = Company(name="C"); db.add(co); await db.flush()
    p1 = Project(code="P1", name="P1", company_id=co.id,
                 status=ProjectStatus.AKTIF, kind=ProjectKind.REGULAR.value)
    p2 = Project(code="P2", name="P2", company_id=co.id,
                 status=ProjectStatus.AKTIF, kind=ProjectKind.REGULAR.value)
    db.add_all([p1, p2]); await db.flush()
    u = User(email="u@x", name="U", password_hash=hash_password("x"),
             role=role, scope_all_projects=True)
    db.add(u); await db.flush()
    return co, p1, p2, u


# ---------- PO ----------

@pytest.mark.asyncio
async def test_po_draft_edit_project_works(db):
    """User lapor: edit project saat DRAFT tdk berubah. Fixed."""
    co, p1, p2, u = await _seed_2_projects(db)
    po = PurchaseOrder(
        number="PO/2026/05/P1/0001",
        project_id=p1.id, company_id=co.id,
        po_date=date(2026, 5, 22), total=Decimal("100"),
        status=POStatus.DRAFT, created_by_id=u.id,
    )
    db.add(po); await db.flush()
    db.add(POItem(po_id=po.id, description="X",
                  quantity=Decimal("1"), unit_price=Decimal("100"),
                  subtotal=Decimal("100")))
    await db.commit()

    payload = POUpdate(project_id=p2.id)
    out = await update_po(pid=po.id, payload=payload, db=db, user=u)
    assert out.project_id == p2.id
    # Number di-regenerate utk match prefix P2
    assert out.number.startswith("PO/2026/05/P2/")


@pytest.mark.asyncio
async def test_po_non_draft_project_change_blocked_for_non_super(db):
    co, p1, p2, u = await _seed_2_projects(db, role=UserRole.CENTRAL_ADMIN)
    po = PurchaseOrder(
        number="PO/2026/05/P1/0001",
        project_id=p1.id, company_id=co.id,
        po_date=date(2026, 5, 22), total=Decimal("100"),
        status=POStatus.ISSUED, created_by_id=u.id,
    )
    db.add(po); await db.commit()
    # CENTRAL_ADMIN tdk boleh edit non-DRAFT (god-mode SUPERADMIN only)
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        await update_po(pid=po.id, payload=POUpdate(project_id=p2.id),
                        db=db, user=u)
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_po_superadmin_godmode_edit_non_draft(db):
    """SUPERADMIN bisa edit project_id walau PO sudah ISSUED."""
    co, p1, p2, u = await _seed_2_projects(db, role=UserRole.SUPERADMIN)
    po = PurchaseOrder(
        number="PO/2026/05/P1/0001",
        project_id=p1.id, company_id=co.id,
        po_date=date(2026, 5, 22), total=Decimal("100"),
        status=POStatus.ISSUED, created_by_id=u.id,
    )
    db.add(po); await db.commit()
    out = await update_po(pid=po.id, payload=POUpdate(project_id=p2.id),
                          db=db, user=u)
    assert out.project_id == p2.id


# ---------- Invoice ----------

@pytest.mark.asyncio
async def test_invoice_draft_edit_project_works(db):
    co, p1, p2, u = await _seed_2_projects(db)
    inv = Invoice(
        number="INV-1", project_id=p1.id, type=InvoiceType.IN,
        invoice_date=date(2026, 5, 22), total=Decimal("100"),
        status=InvoiceStatus.DRAFT, created_by_id=u.id,
    )
    db.add(inv); await db.commit()
    out = await update_invoice(
        iid=inv.id, payload=InvoiceUpdate(project_id=p2.id), db=db, user=u,
    )
    assert out.project_id == p2.id


@pytest.mark.asyncio
async def test_invoice_non_draft_project_change_blocked_for_non_super(db):
    co, p1, p2, u = await _seed_2_projects(db, role=UserRole.PROJECT_ADMIN)
    inv = Invoice(
        number="INV-2", project_id=p1.id, type=InvoiceType.IN,
        invoice_date=date(2026, 5, 22), total=Decimal("100"),
        status=InvoiceStatus.ISSUED, created_by_id=u.id,
    )
    db.add(inv); await db.commit()
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        await update_invoice(
            iid=inv.id, payload=InvoiceUpdate(project_id=p2.id),
            db=db, user=u,
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_invoice_superadmin_godmode_edit_issued(db):
    co, p1, p2, u = await _seed_2_projects(db, role=UserRole.SUPERADMIN)
    inv = Invoice(
        number="INV-3", project_id=p1.id, type=InvoiceType.IN,
        invoice_date=date(2026, 5, 22), total=Decimal("100"),
        status=InvoiceStatus.ISSUED, created_by_id=u.id,
    )
    db.add(inv); await db.commit()
    out = await update_invoice(
        iid=inv.id, payload=InvoiceUpdate(project_id=p2.id), db=db, user=u,
    )
    assert out.project_id == p2.id


# ---------- TX ----------

@pytest.mark.asyncio
async def test_tx_superadmin_godmode_edit_verified(db):
    """SUPERADMIN bisa pindahkan project tx walau VERIFIED."""
    co, p1, p2, u = await _seed_2_projects(db, role=UserRole.SUPERADMIN)
    tx = Transaction(
        project_id=p1.id, tx_date=date(2026, 5, 22), type=TxnType.OUT,
        kind=TxnKind.DIRECT_EXPENSE.value, amount=Decimal("100"),
        payment_method=PaymentMethod.CASH, status=TxnStatus.VERIFIED,
        created_by_id=u.id,
    )
    db.add(tx); await db.commit()
    out = await update_transaction(
        tid=tx.id, payload=TransactionUpdate(project_id=p2.id),
        db=db, user=u,
    )
    assert out.project_id == p2.id
