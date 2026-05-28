"""Bulk delete kategori tidak terpakai. Audit 2026-05-24 user req:
salah import 127 kategori, banyak yg blm pernah dipakai."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.security import create_access_token, hash_password
from app.db.session import get_db
from app.main import app
from app.models.models import (
    Category, CategoryType, Company, PaymentMethod, Project, ProjectKind,
    ProjectStatus, Transaction, TxnKind, TxnStatus, TxnType, User, UserRole,
)


async def _seed(db):
    admin = User(
        email="a@x", name="A", password_hash=hash_password("x"),
        role=UserRole.SUPERADMIN, scope_all_projects=True,
    )
    db.add(admin); await db.flush()
    return admin


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
async def test_usage_endpoint_separates_used_vs_unused(db, override_db):
    admin = await _seed(db)
    co = Company(name="C"); db.add(co); await db.flush()
    p = Project(
        code="P", name="P", company_id=co.id,
        status=ProjectStatus.AKTIF, kind=ProjectKind.REGULAR.value,
    )
    db.add(p); await db.flush()
    c_used = Category(name="Used", type=CategoryType.OUT)
    c_unused1 = Category(name="Unused 1", type=CategoryType.OUT)
    c_unused2 = Category(name="Unused 2", type=CategoryType.IN)
    db.add_all([c_used, c_unused1, c_unused2]); await db.flush()
    # Pakai c_used di 1 tx
    db.add(Transaction(
        project_id=p.id, tx_date=date(2026, 5, 24),
        type=TxnType.OUT, kind=TxnKind.DIRECT_EXPENSE.value,
        amount=Decimal("100"), payment_method=PaymentMethod.CASH,
        status=TxnStatus.DRAFT, created_by_id=admin.id,
        category_id=c_used.id,
    ))
    await db.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as ac:
        r = await ac.get(
            "/api/v1/categories/usage?only_unused=true", headers=_hdr(admin),
        )
    assert r.status_code == 200, r.text
    body = r.json()
    names = {i["name"] for i in body["items"]}
    assert names == {"Unused 1", "Unused 2"}
    assert body["unused_count"] == 2
    assert body["total"] == 3


@pytest.mark.asyncio
async def test_bulk_delete_skips_in_use(db, override_db):
    admin = await _seed(db)
    co = Company(name="C"); db.add(co); await db.flush()
    p = Project(
        code="P", name="P", company_id=co.id,
        status=ProjectStatus.AKTIF, kind=ProjectKind.REGULAR.value,
    )
    db.add(p); await db.flush()
    c_used = Category(name="Used", type=CategoryType.OUT)
    c_unused = Category(name="Unused", type=CategoryType.OUT)
    db.add_all([c_used, c_unused]); await db.flush()
    db.add(Transaction(
        project_id=p.id, tx_date=date(2026, 5, 24),
        type=TxnType.OUT, kind=TxnKind.DIRECT_EXPENSE.value,
        amount=Decimal("100"), payment_method=PaymentMethod.CASH,
        status=TxnStatus.DRAFT, created_by_id=admin.id,
        category_id=c_used.id,
    ))
    await db.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as ac:
        r = await ac.post(
            "/api/v1/categories/bulk-delete",
            json={"ids": [c_used.id, c_unused.id]},
            headers=_hdr(admin),
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["success_count"] == 1
    assert body["success"] == [c_unused.id]
    reasons = {s["id"]: s["reason"] for s in body["skipped"]}
    assert "in_use" in reasons[c_used.id]

    # Verify state
    await db.refresh(c_used); await db.refresh(c_unused)
    assert c_used.deleted_at is None
    assert c_unused.deleted_at is not None
