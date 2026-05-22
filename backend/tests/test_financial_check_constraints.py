"""C4 (audit 2026-05-22): CHECK constraints di level DB utk amount fields.

Pencegahan korup financial data via direct ORM/SQL insert. Validasi
Pydantic di endpoint sudah ada, tapi defense-in-depth: kalau ada bug
code path yg bypass Pydantic (mis. bot, import excel, raw SQL), DB
constraint akan tetap reject.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.models import (
    CashRequest,
    CashRequestItem,
    Company,
    Invoice,
    InvoiceItem,
    InvoiceStatus,
    InvoiceType,
    POItem,
    PaymentMethod,
    Project,
    ProjectStatus,
    PurchaseOrder,
    POStatus,
    Transaction,
    TransactionItem,
    TxnKind,
    TxnStatus,
    TxnType,
    User,
    UserRole,
)


async def _seed_minimal(db):
    co = Company(name="C"); db.add(co); await db.flush()
    proj = Project(
        code="P1", name="P", company_id=co.id, status=ProjectStatus.AKTIF,
    )
    db.add(proj); await db.flush()
    user = User(
        name="U", email="u@x", password_hash="x", role=UserRole.SUPERADMIN,
    )
    db.add(user); await db.flush()
    return co, proj, user


async def _assert_integrity(db, obj):
    db.add(obj)
    with pytest.raises(IntegrityError):
        await db.flush()
    await db.rollback()


@pytest.mark.asyncio
async def test_transactions_amount_must_be_positive(db):
    _, proj, user = await _seed_minimal(db)
    tx = Transaction(
        project_id=proj.id, tx_date=date(2026, 5, 22),
        type=TxnType.OUT, kind=TxnKind.DIRECT_EXPENSE.value,
        amount=Decimal("-1"),
        payment_method=PaymentMethod.TRANSFER,
        status=TxnStatus.DRAFT, created_by_id=user.id,
    )
    await _assert_integrity(db, tx)


@pytest.mark.asyncio
async def test_transactions_amount_zero_rejected(db):
    _, proj, user = await _seed_minimal(db)
    tx = Transaction(
        project_id=proj.id, tx_date=date(2026, 5, 22),
        type=TxnType.OUT, kind=TxnKind.DIRECT_EXPENSE.value,
        amount=Decimal("0"),
        payment_method=PaymentMethod.TRANSFER,
        status=TxnStatus.DRAFT, created_by_id=user.id,
    )
    await _assert_integrity(db, tx)


@pytest.mark.asyncio
async def test_invoice_total_cannot_be_negative(db):
    _, proj, user = await _seed_minimal(db)
    inv = Invoice(
        number="INV-NEG",
        project_id=proj.id,
        type=InvoiceType.OUT,
        invoice_date=date(2026, 5, 22),
        subtotal=Decimal("0"), tax=Decimal("0"),
        total=Decimal("-100"),
        status=InvoiceStatus.DRAFT,
        created_by_id=user.id,
    )
    await _assert_integrity(db, inv)


@pytest.mark.asyncio
async def test_invoice_item_unit_price_can_be_zero(db):
    """Free/promo item legitimate -- unit_price=0 boleh."""
    _, proj, user = await _seed_minimal(db)
    inv = Invoice(
        number="INV-FREE",
        project_id=proj.id, type=InvoiceType.OUT,
        invoice_date=date(2026, 5, 22),
        subtotal=Decimal("0"), tax=Decimal("0"), total=Decimal("0"),
        status=InvoiceStatus.DRAFT, created_by_id=user.id,
    )
    db.add(inv); await db.flush()
    item = InvoiceItem(
        invoice_id=inv.id, description="Free sample",
        quantity=Decimal("1"), unit_price=Decimal("0"),
        subtotal=Decimal("0"),
    )
    db.add(item)
    await db.flush()  # should NOT raise


@pytest.mark.asyncio
async def test_invoice_item_quantity_zero_rejected(db):
    _, proj, user = await _seed_minimal(db)
    inv = Invoice(
        number="INV-Q0",
        project_id=proj.id, type=InvoiceType.OUT,
        invoice_date=date(2026, 5, 22),
        subtotal=Decimal("0"), tax=Decimal("0"), total=Decimal("0"),
        status=InvoiceStatus.DRAFT, created_by_id=user.id,
    )
    db.add(inv); await db.flush()
    item = InvoiceItem(
        invoice_id=inv.id, description="Bad",
        quantity=Decimal("0"), unit_price=Decimal("100"),
        subtotal=Decimal("0"),
    )
    await _assert_integrity(db, item)


@pytest.mark.asyncio
async def test_po_total_cannot_be_negative(db):
    _, proj, user = await _seed_minimal(db)
    po = PurchaseOrder(
        number="PO-NEG", project_id=proj.id, company_id=proj.company_id,
        vendor_name="V", po_date=date(2026, 5, 22),
        subtotal=Decimal("0"), tax=Decimal("0"), discount=Decimal("0"),
        total=Decimal("-1"),
        status=POStatus.DRAFT, created_by_id=user.id,
    )
    await _assert_integrity(db, po)


@pytest.mark.asyncio
async def test_po_discount_negative_rejected(db):
    _, proj, user = await _seed_minimal(db)
    po = PurchaseOrder(
        number="PO-D",
        project_id=proj.id, company_id=proj.company_id,
        vendor_name="V", po_date=date(2026, 5, 22),
        subtotal=Decimal("1000"), tax=Decimal("0"),
        discount=Decimal("-50"),
        total=Decimal("1050"),
        status=POStatus.DRAFT, created_by_id=user.id,
    )
    await _assert_integrity(db, po)


@pytest.mark.asyncio
async def test_cash_request_total_amount_negative_rejected(db):
    _, proj, user = await _seed_minimal(db)
    cr = CashRequest(
        number="CR-NEG",
        project_id=proj.id,
        requester_id=user.id,
        request_date=date(2026, 5, 22),
        title="x",
        total_amount=Decimal("-1"),
        status="PENDING",
    )
    await _assert_integrity(db, cr)


@pytest.mark.asyncio
async def test_cash_request_item_amount_zero_rejected(db):
    _, proj, user = await _seed_minimal(db)
    cr = CashRequest(
        number="CR-Z", project_id=proj.id, requester_id=user.id,
        request_date=date(2026, 5, 22), title="x",
        total_amount=Decimal("0"), status="PENDING",
    )
    db.add(cr); await db.flush()
    item = CashRequestItem(
        request_id=cr.id, description="x", amount=Decimal("0"),
    )
    await _assert_integrity(db, item)


@pytest.mark.asyncio
async def test_transaction_item_amount_must_be_positive(db):
    _, proj, user = await _seed_minimal(db)
    tx = Transaction(
        project_id=proj.id, tx_date=date(2026, 5, 22),
        type=TxnType.OUT, kind=TxnKind.DIRECT_EXPENSE.value,
        amount=Decimal("1000"),
        payment_method=PaymentMethod.TRANSFER,
        status=TxnStatus.DRAFT, created_by_id=user.id,
    )
    db.add(tx); await db.flush()
    item = TransactionItem(
        transaction_id=tx.id, description="x", amount=Decimal("-1"),
    )
    await _assert_integrity(db, item)
