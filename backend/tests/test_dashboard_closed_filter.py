"""Dashboard global -- exclude SELESAI/DIBATALKAN dari warning counters.

Audit 2026-05-24: semantik "tagihan dianggap clear saat proyek selesai".
Operational warnings (top_spender, minus_count, overdue, pending,
unlinked_out, overbudget, near_budget) exclude closed projects. Totals
& saldo & project list TETAP include semua.
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
    Company,
    Invoice,
    InvoiceStatus,
    InvoiceType,
    PaymentMethod,
    Project,
    ProjectKind,
    ProjectStatus,
    Transaction,
    TxnKind,
    TxnStatus,
    TxnType,
    User,
    UserRole,
)


async def _seed(db):
    co = Company(name="C"); db.add(co); await db.flush()
    # 2 projects: 1 AKTIF + 1 SELESAI, masing-2 ada bukti minus + overdue
    # invoice + pending tx -- supaya kelihatan filter exclude vs include.
    p_aktif = Project(
        code="P-AKTIF", name="Aktif", company_id=co.id,
        status=ProjectStatus.AKTIF, kind=ProjectKind.REGULAR.value,
        budget_amount=Decimal("1000"),
    )
    p_selesai = Project(
        code="P-DONE", name="Selesai", company_id=co.id,
        status=ProjectStatus.SELESAI, kind=ProjectKind.REGULAR.value,
        budget_amount=Decimal("1000"),
    )
    db.add_all([p_aktif, p_selesai]); await db.flush()
    user = User(
        email="u@x", name="U", password_hash=hash_password("x"),
        role=UserRole.SUPERADMIN, scope_all_projects=True,
    )
    db.add(user); await db.flush()
    # Tx pending di kedua proyek -> warning operational
    for proj in (p_aktif, p_selesai):
        db.add(Transaction(
            project_id=proj.id, tx_date=date(2026, 5, 24),
            type=TxnType.OUT, kind=TxnKind.DIRECT_EXPENSE.value,
            amount=Decimal("100"), payment_method=PaymentMethod.CASH,
            status=TxnStatus.SUBMITTED, created_by_id=user.id,
        ))
    # Overdue invoice di kedua proyek
    for proj in (p_aktif, p_selesai):
        db.add(Invoice(
            number=f"INV-OD-{proj.code}", project_id=proj.id,
            type=InvoiceType.IN, invoice_date=date(2026, 1, 1),
            total=Decimal("500"), status=InvoiceStatus.OVERDUE,
            created_by_id=user.id,
        ))
    # Tx OUT VERIFIED gede di selesai supaya jadi top_spender kalau ikut.
    db.add(Transaction(
        project_id=p_selesai.id, tx_date=date(2026, 5, 24),
        type=TxnType.OUT, kind=TxnKind.DIRECT_EXPENSE.value,
        amount=Decimal("9999"), payment_method=PaymentMethod.CASH,
        status=TxnStatus.VERIFIED, created_by_id=user.id,
    ))
    db.add(Transaction(
        project_id=p_aktif.id, tx_date=date(2026, 5, 24),
        type=TxnType.OUT, kind=TxnKind.DIRECT_EXPENSE.value,
        amount=Decimal("50"), payment_method=PaymentMethod.CASH,
        status=TxnStatus.VERIFIED, created_by_id=user.id,
    ))
    await db.commit()
    return co, p_aktif, p_selesai, user


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
async def test_dashboard_exclude_selesai_default(db, override_db):
    """Default include_closed=False: warning counters exclude SELESAI."""
    _, p_aktif, p_selesai, user = await _seed(db)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as ac:
        r = await ac.get("/api/v1/dashboard/global", headers=_hdr(user))
    assert r.status_code == 200, r.text
    body = r.json()

    # Overdue: 2 invoice di DB (1 AKTIF + 1 SELESAI). Default exclude -> 1.
    assert body["overdue_invoices"] == 1, body
    # Pending tx: 2 SUBMITTED di DB. Default exclude -> 1.
    assert body["pending_count"] == 1, body
    # Top spender: SELESAI punya 9999 (lebih besar), tapi exclude ->
    # top_spender = AKTIF dgn 50.
    assert body["top_spender"]["project_id"] == p_aktif.id, body
    # Project list: include semua (2)
    assert body["total_projects"] == 2
    assert body["closed_count"] == 1
    assert body["include_closed"] is False


@pytest.mark.asyncio
async def test_dashboard_include_closed_toggle(db, override_db):
    """include_closed=true: counters include semua."""
    _, p_aktif, p_selesai, user = await _seed(db)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as ac:
        r = await ac.get(
            "/api/v1/dashboard/global?include_closed=true",
            headers=_hdr(user),
        )
    assert r.status_code == 200, r.text
    body = r.json()

    assert body["overdue_invoices"] == 2
    assert body["pending_count"] == 2
    # Top spender: SELESAI lebih besar -> ke include sekarang.
    assert body["top_spender"]["project_id"] == p_selesai.id
    assert body["include_closed"] is True


@pytest.mark.asyncio
async def test_dashboard_totals_include_closed_always(db, override_db):
    """Totals & saldo selalu include semua proyek, terlepas filter."""
    _, p_aktif, p_selesai, user = await _seed(db)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as ac:
        r = await ac.get("/api/v1/dashboard/global", headers=_hdr(user))
    body = r.json()
    # total_out di project_totals include DRAFT+SUBMITTED+VERIFIED
    # (ACTIVE_STATUSES di budget.py). Penting: closed project TIDAK
    # di-exclude dari sini -- saldo & total adalah real money.
    # SELESAI 9999+100 + AKTIF 50+100 = 10249.
    assert float(body["totals"]["out"]) == 10249.0


@pytest.mark.asyncio
async def test_project_dashboard_warnings_suppressed_for_selesai(db, override_db):
    """Detail proyek SELESAI: warnings tdk muncul (banner sudah cukup)."""
    _, p_aktif, p_selesai, user = await _seed(db)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as ac:
        r_aktif = await ac.get(
            f"/api/v1/dashboard/project/{p_aktif.id}", headers=_hdr(user)
        )
        r_selesai = await ac.get(
            f"/api/v1/dashboard/project/{p_selesai.id}", headers=_hdr(user)
        )
    # AKTIF: ada warnings (overdue + pending).
    assert len(r_aktif.json()["warnings"]) > 0
    # SELESAI: warnings disuppress (banner sudah indikasi status).
    assert r_selesai.json()["warnings"] == []
