"""Filter unlinked_only di /transactions -- drill-down dari dashboard.

Audit 2026-05-24: user keluhan tdk bisa lihat TX mana yg blm dialokasi.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.security import create_access_token, hash_password
from app.db.session import get_db
from app.main import app
from app.models.models import (
    Company, Invoice, InvoiceAllocation, InvoiceStatus, InvoiceType,
    PaymentMethod, Project, ProjectKind, ProjectStatus, Transaction,
    TxnKind, TxnStatus, TxnType, User, UserRole,
)


def _hdr(user):
    return {"Authorization": f"Bearer {create_access_token(user.id, extra={'role': user.role.value})}"}


@pytest.fixture
def override_db(db):
    async def _gen():
        yield db
    app.dependency_overrides[get_db] = _gen
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_unlinked_only_filter(db, override_db):
    """3 TX OUT VERIFIED: 1 sudah full-allocated, 1 partial, 1 belum sama
    sekali. Filter unlinked_only=true -> return 2 (partial + tdk sama
    sekali)."""
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

    # Invoice tujuan alokasi
    inv = Invoice(
        number="INV-1", project_id=p.id, type=InvoiceType.IN,
        invoice_date=date(2026, 5, 24), total=Decimal("1000"),
        status=InvoiceStatus.ISSUED, created_by_id=admin.id,
    )
    db.add(inv); await db.flush()

    # TX-A: full allocated (1000/1000)
    tx_full = Transaction(
        project_id=p.id, tx_date=date(2026, 5, 24),
        type=TxnType.OUT, kind=TxnKind.INVOICE_PAYMENT.value,
        amount=Decimal("1000"), payment_method=PaymentMethod.TRANSFER,
        status=TxnStatus.VERIFIED, created_by_id=admin.id,
    )
    # TX-B: partial allocated (400/1000)
    tx_partial = Transaction(
        project_id=p.id, tx_date=date(2026, 5, 24),
        type=TxnType.OUT, kind=TxnKind.INVOICE_PAYMENT.value,
        amount=Decimal("1000"), payment_method=PaymentMethod.TRANSFER,
        status=TxnStatus.VERIFIED, created_by_id=admin.id,
    )
    # TX-C: tdk dialokasi sama sekali
    tx_unalloc = Transaction(
        project_id=p.id, tx_date=date(2026, 5, 24),
        type=TxnType.OUT, kind=TxnKind.DIRECT_EXPENSE.value,
        amount=Decimal("500"), payment_method=PaymentMethod.CASH,
        status=TxnStatus.VERIFIED, created_by_id=admin.id,
    )
    db.add_all([tx_full, tx_partial, tx_unalloc]); await db.flush()
    db.add(InvoiceAllocation(
        transaction_id=tx_full.id, invoice_id=inv.id,
        allocated_amount=Decimal("1000"), created_by_id=admin.id,
    ))
    db.add(InvoiceAllocation(
        transaction_id=tx_partial.id, invoice_id=inv.id,
        allocated_amount=Decimal("400"), created_by_id=admin.id,
    ))
    await db.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as ac:
        # Default: all 3 tx OUT
        r_all = await ac.get(
            "/api/v1/transactions?type=OUT", headers=_hdr(admin),
        )
        # unlinked only: partial + unallocated = 2
        r_unlinked = await ac.get(
            "/api/v1/transactions?type=OUT&unlinked_only=true",
            headers=_hdr(admin),
        )
    assert r_all.json()["total"] == 3
    unlinked_body = r_unlinked.json()
    assert unlinked_body["total"] == 2
    returned_ids = {it["id"] for it in unlinked_body["items"]}
    assert tx_full.id not in returned_ids
    assert tx_partial.id in returned_ids
    assert tx_unalloc.id in returned_ids
