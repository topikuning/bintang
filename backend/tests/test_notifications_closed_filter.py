"""Notifikasi (in-app + Telegram/WhatsApp + AI ask) -- KONSISTEN dgn
dashboard: exclude proyek SELESAI (tagihan dianggap clear) + DIBATALKAN
(soft-deleted).

Audit 2026-05-24: user complaint "kenapa notifikasi masih muncul invoice
overdue atas proyek selesai!".
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
    p_aktif = Project(
        code="P-A", name="Aktif", company_id=co.id,
        status=ProjectStatus.AKTIF, kind=ProjectKind.REGULAR.value,
    )
    p_selesai = Project(
        code="P-S", name="Selesai", company_id=co.id,
        status=ProjectStatus.SELESAI, kind=ProjectKind.REGULAR.value,
    )
    p_cancel = Project(
        code="P-X", name="Batal", company_id=co.id,
        status=ProjectStatus.DIBATALKAN, kind=ProjectKind.REGULAR.value,
    )
    db.add_all([p_aktif, p_selesai, p_cancel]); await db.flush()
    admin = User(
        email="a@x", name="A", password_hash=hash_password("x"),
        role=UserRole.SUPERADMIN, scope_all_projects=True,
    )
    db.add(admin); await db.flush()
    # Overdue invoice di ke-3 proyek
    today = date.today()
    long_ago = date(today.year - 1, 1, 1)
    for proj in (p_aktif, p_selesai, p_cancel):
        db.add(Invoice(
            number=f"INV-OD-{proj.code}", project_id=proj.id,
            type=InvoiceType.IN, invoice_date=long_ago,
            due_date=long_ago, total=Decimal("100"),
            status=InvoiceStatus.OVERDUE, created_by_id=admin.id,
        ))
    # SUBMITTED tx di ke-3 proyek
    for proj in (p_aktif, p_selesai, p_cancel):
        db.add(Transaction(
            project_id=proj.id, tx_date=today, type=TxnType.OUT,
            kind=TxnKind.DIRECT_EXPENSE.value, amount=Decimal("50"),
            payment_method=PaymentMethod.CASH,
            status=TxnStatus.SUBMITTED, created_by_id=admin.id,
        ))
    await db.commit()
    return co, p_aktif, p_selesai, p_cancel, admin


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
async def test_notifications_summary_excludes_closed(db, override_db):
    """In-app notif: overdue + pending verify count harus exclude
    proyek SELESAI/DIBATALKAN."""
    _, p_aktif, _, _, admin = await _seed(db)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as ac:
        r = await ac.get("/api/v1/notifications/summary", headers=_hdr(admin))
    assert r.status_code == 200, r.text
    body = r.json()
    items = {it["kind"]: it for it in body["items"]}

    # 3 overdue invoice di DB tapi 2 di proyek closed -> notif cuma 1.
    assert items["invoice_overdue"]["count"] == 1, items
    # 3 SUBMITTED tx -> notif cuma 1 (yg di AKTIF).
    assert items["tx_pending_verify"]["count"] == 1, items


@pytest.mark.asyncio
async def test_telegram_cmd_pending_excludes_closed(db):
    """Telegram /pending: exclude proyek closed dari list."""
    from app.services.telegram.commands import cmd_pending
    _, p_aktif, _, _, admin = await _seed(db)
    out = await cmd_pending(db, admin, chat_id=1, args=[], msg={})
    # Hanya 1 tx (di AKTIF) yg muncul, bukan 3.
    assert "1 transaksi menunggu verifikasi" in out, out
    assert "P-S" not in out
    assert "P-X" not in out


@pytest.mark.asyncio
async def test_telegram_cmd_invoice_excludes_closed(db):
    """Telegram /invoice: exclude proyek closed dari list."""
    from app.services.telegram.commands import cmd_invoice
    _, p_aktif, _, _, admin = await _seed(db)
    out = await cmd_invoice(db, admin, chat_id=1, args=[], msg={})
    # Hanya invoice di AKTIF muncul.
    assert "INV-OD-P-A" in out, out
    assert "INV-OD-P-S" not in out
    assert "INV-OD-P-X" not in out


@pytest.mark.asyncio
async def test_ai_outstanding_debts_excludes_closed(db):
    """AI _q_outstanding_debts: KONSISTEN -- exclude proyek closed."""
    from app.services.ai.features.ask_query import _q_outstanding_debts
    _, _, _, _, admin = await _seed(db)
    result = await _q_outstanding_debts(db, pids=None)
    # Return shape: {columns, data: [[row...],...]}.
    # Row 0 = ["Hutang (Invoice Masuk)", amount].
    # 3 invoice IN OVERDUE total 300, tapi 2 di closed -> 100 saja.
    hutang_row = next(r for r in result["data"] if "Hutang" in r[0])
    assert hutang_row[1] == 100.0, result
