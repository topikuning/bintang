"""Spending-by-category chart -- gabung TX-level + InvoiceItem-level.

Audit 2026-05-24 user req: chart per kategori juga dr invoice items.
TX yg ter-link invoice di-skip supaya tdk double-count.
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
    Category, CategoryType, Company, Invoice, InvoiceAllocation, InvoiceItem,
    InvoiceStatus, InvoiceType, PaymentMethod, Project, ProjectKind,
    ProjectStatus, Transaction, TxnKind, TxnStatus, TxnType, User, UserRole,
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


@pytest.mark.asyncio
async def test_category_chart_includes_invoice_items(db, override_db):
    """InvoiceItem contributions muncul di spending_by_category."""
    _, p, admin = await _seed(db)
    cat_material = Category(name="Material", type=CategoryType.OUT)
    cat_bensin = Category(name="BBM", type=CategoryType.OUT)
    db.add_all([cat_material, cat_bensin]); await db.flush()

    # Invoice IN dgn 2 items beda kategori
    inv = Invoice(
        number="INV-A", project_id=p.id, type=InvoiceType.IN,
        invoice_date=date(2026, 5, 24), total=Decimal("3000"),
        status=InvoiceStatus.ISSUED, created_by_id=admin.id,
    )
    db.add(inv); await db.flush()
    db.add_all([
        InvoiceItem(
            invoice_id=inv.id, description="Semen", quantity=Decimal("1"),
            unit_price=Decimal("1000"), subtotal=Decimal("1000"),
            category_id=cat_material.id,
        ),
        InvoiceItem(
            invoice_id=inv.id, description="Solar", quantity=Decimal("1"),
            unit_price=Decimal("2000"), subtotal=Decimal("2000"),
            category_id=cat_bensin.id,
        ),
    ])
    await db.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as ac:
        r = await ac.get("/api/v1/dashboard/global", headers=_hdr(admin))
    body = r.json()
    by_cat = {item["category"]: item["total"]
              for item in body["spending_by_category"]}
    assert by_cat.get("Material") == 1000.0
    assert by_cat.get("BBM") == 2000.0


@pytest.mark.asyncio
async def test_category_chart_no_double_count_when_tx_linked(db, override_db):
    """TX yg pakai invoice_allocations -> skip dari TX path, ambil dr items.

    Setup:
    - Invoice INV-A total 5000, item Material kategori cat_material.
    - TX-100 OUT 5000, category=cat_other (mock typo admin).
    - InvoiceAllocation TX-100 -> INV-A 5000.
    Expected: spending_by_category = {Material: 5000} (TX skipped krn
    ter-link).
    """
    _, p, admin = await _seed(db)
    cat_material = Category(name="Material", type=CategoryType.OUT)
    cat_other = Category(name="Other", type=CategoryType.OUT)
    db.add_all([cat_material, cat_other]); await db.flush()

    inv = Invoice(
        number="INV-B", project_id=p.id, type=InvoiceType.IN,
        invoice_date=date(2026, 5, 24), total=Decimal("5000"),
        status=InvoiceStatus.PAID, created_by_id=admin.id,
    )
    db.add(inv); await db.flush()
    db.add(InvoiceItem(
        invoice_id=inv.id, description="Semen", quantity=Decimal("1"),
        unit_price=Decimal("5000"), subtotal=Decimal("5000"),
        category_id=cat_material.id,
    ))
    tx = Transaction(
        project_id=p.id, tx_date=date(2026, 5, 24),
        type=TxnType.OUT, kind=TxnKind.INVOICE_PAYMENT.value,
        amount=Decimal("5000"), payment_method=PaymentMethod.TRANSFER,
        status=TxnStatus.VERIFIED, created_by_id=admin.id,
        category_id=cat_other.id,  # admin tag salah, dedup via allocation
    )
    db.add(tx); await db.flush()
    db.add(InvoiceAllocation(
        transaction_id=tx.id, invoice_id=inv.id,
        allocated_amount=Decimal("5000"), created_by_id=admin.id,
    ))
    await db.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as ac:
        r = await ac.get("/api/v1/dashboard/global", headers=_hdr(admin))
    body = r.json()
    by_cat = {item["category"]: item["total"]
              for item in body["spending_by_category"]}
    # Hanya Material (dari invoice item) yg muncul, tdk dobel ke "Other".
    assert by_cat.get("Material") == 5000.0
    assert "Other" not in by_cat


@pytest.mark.asyncio
async def test_category_chart_standalone_tx_still_counted(db, override_db):
    """TX standalone (no invoice link) tetap muncul -- legacy path."""
    _, p, admin = await _seed(db)
    cat_ops = Category(name="Operasional", type=CategoryType.OUT)
    db.add(cat_ops); await db.flush()
    db.add(Transaction(
        project_id=p.id, tx_date=date(2026, 5, 24),
        type=TxnType.OUT, kind=TxnKind.DIRECT_EXPENSE.value,
        amount=Decimal("400"), payment_method=PaymentMethod.CASH,
        status=TxnStatus.VERIFIED, created_by_id=admin.id,
        category_id=cat_ops.id,
    ))
    await db.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as ac:
        r = await ac.get("/api/v1/dashboard/global", headers=_hdr(admin))
    body = r.json()
    by_cat = {item["category"]: item["total"]
              for item in body["spending_by_category"]}
    assert by_cat.get("Operasional") == 400.0
