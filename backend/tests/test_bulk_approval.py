"""Bulk approve/verify TX, PO, Invoice. Audit 2026-05-23 user req."""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.api.v1.invoices import bulk_issue_invoices
from app.api.v1.purchase_orders import (
    bulk_approve_pos,
    bulk_issue_pos,
)
from app.api.v1.transactions import bulk_verify_transactions
from app.core.security import hash_password
from app.models.models import (
    Company,
    Invoice,
    InvoiceStatus,
    InvoiceType,
    PaymentMethod,
    POItem,
    POStatus,
    Project,
    ProjectKind,
    ProjectStatus,
    PurchaseOrder,
    Transaction,
    TxnKind,
    TxnStatus,
    TxnType,
    User,
    UserRole,
)


async def _seed(db):
    co = Company(name="C"); db.add(co); await db.flush()
    p = Project(
        code="P", name="P", company_id=co.id,
        status=ProjectStatus.AKTIF, kind=ProjectKind.REGULAR.value,
    )
    db.add(p); await db.flush()
    admin = User(
        email="a@x", name="A", password_hash=hash_password("x"),
        role=UserRole.SUPERADMIN, scope_all_projects=True,
    )
    db.add(admin); await db.flush()
    return co, p, admin


# ---------- TX bulk verify ----------

@pytest.mark.asyncio
async def test_bulk_verify_tx_mixed_states(db):
    co, p, admin = await _seed(db)
    # 3 tx: 1 SUBMITTED (eligible), 1 DRAFT (eligible), 1 VERIFIED (skip)
    t1 = Transaction(
        project_id=p.id, tx_date=date(2026, 5, 22), type=TxnType.OUT,
        kind=TxnKind.DIRECT_EXPENSE.value, amount=Decimal("100"),
        payment_method=PaymentMethod.CASH, status=TxnStatus.SUBMITTED,
        created_by_id=admin.id,
    )
    t2 = Transaction(
        project_id=p.id, tx_date=date(2026, 5, 22), type=TxnType.OUT,
        kind=TxnKind.DIRECT_EXPENSE.value, amount=Decimal("200"),
        payment_method=PaymentMethod.CASH, status=TxnStatus.DRAFT,
        created_by_id=admin.id,
    )
    t3 = Transaction(
        project_id=p.id, tx_date=date(2026, 5, 22), type=TxnType.OUT,
        kind=TxnKind.DIRECT_EXPENSE.value, amount=Decimal("300"),
        payment_method=PaymentMethod.CASH, status=TxnStatus.VERIFIED,
        created_by_id=admin.id,
    )
    db.add_all([t1, t2, t3]); await db.commit()

    result = await bulk_verify_transactions(
        payload={"ids": [t1.id, t2.id, t3.id, 99999]},
        db=db, admin=admin,
    )
    assert result["total_requested"] == 4
    assert result["success_count"] == 2
    assert set(result["success"]) == {t1.id, t2.id}
    skipped_ids = {s["id"] for s in result["skipped"]}
    assert t3.id in skipped_ids
    assert 99999 in skipped_ids


@pytest.mark.asyncio
async def test_bulk_verify_tx_empty_ids(db):
    co, p, admin = await _seed(db)
    with pytest.raises(HTTPException) as exc:
        await bulk_verify_transactions(payload={"ids": []}, db=db, admin=admin)
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_bulk_verify_tx_max_batch(db):
    co, p, admin = await _seed(db)
    with pytest.raises(HTTPException) as exc:
        await bulk_verify_transactions(
            payload={"ids": list(range(1, 502))}, db=db, admin=admin,
        )
    assert exc.value.status_code == 400


# ---------- PO bulk ----------

@pytest.mark.asyncio
async def test_bulk_issue_po(db):
    co, p, admin = await _seed(db)
    po1 = PurchaseOrder(
        number="PO/1", project_id=p.id, company_id=co.id,
        po_date=date(2026, 5, 22), total=Decimal("100"),
        status=POStatus.DRAFT, created_by_id=admin.id,
    )
    po2 = PurchaseOrder(
        number="PO/2", project_id=p.id, company_id=co.id,
        po_date=date(2026, 5, 22), total=Decimal("200"),
        status=POStatus.ISSUED, created_by_id=admin.id,  # already issued, skip
    )
    db.add_all([po1, po2]); await db.commit()

    result = await bulk_issue_pos(
        payload={"ids": [po1.id, po2.id]}, db=db, user=admin,
    )
    assert result["success_count"] == 1
    assert result["success"] == [po1.id]
    assert any(s["id"] == po2.id and "ISSUED" in s["reason"]
               for s in result["skipped"])


@pytest.mark.asyncio
async def test_bulk_approve_po(db):
    co, p, admin = await _seed(db)
    po1 = PurchaseOrder(
        number="PO/A", project_id=p.id, company_id=co.id,
        po_date=date(2026, 5, 22), total=Decimal("100"),
        status=POStatus.ISSUED, created_by_id=admin.id,
    )
    po2 = PurchaseOrder(
        number="PO/B", project_id=p.id, company_id=co.id,
        po_date=date(2026, 5, 22), total=Decimal("200"),
        status=POStatus.APPROVED, created_by_id=admin.id,  # already, skip
    )
    db.add_all([po1, po2]); await db.commit()

    result = await bulk_approve_pos(
        payload={"ids": [po1.id, po2.id]}, db=db, admin=admin,
    )
    assert result["success_count"] == 1
    assert result["success"] == [po1.id]
    await db.refresh(po1)
    assert po1.status == POStatus.APPROVED
    assert po1.approved_by_id == admin.id


# ---------- Invoice bulk ----------

@pytest.mark.asyncio
async def test_bulk_issue_invoice(db):
    co, p, admin = await _seed(db)
    inv1 = Invoice(
        number="INV/1", project_id=p.id, type=InvoiceType.IN,
        invoice_date=date(2026, 5, 22), total=Decimal("100"),
        status=InvoiceStatus.DRAFT, created_by_id=admin.id,
    )
    inv2 = Invoice(
        number="INV/2", project_id=p.id, type=InvoiceType.IN,
        invoice_date=date(2026, 5, 22), total=Decimal("200"),
        status=InvoiceStatus.ISSUED, created_by_id=admin.id,  # skip
    )
    db.add_all([inv1, inv2]); await db.commit()

    result = await bulk_issue_invoices(
        payload={"ids": [inv1.id, inv2.id]}, db=db, user=admin,
    )
    assert result["success_count"] == 1
    assert result["success"] == [inv1.id]
    await db.refresh(inv1)
    assert inv1.status == InvoiceStatus.ISSUED
