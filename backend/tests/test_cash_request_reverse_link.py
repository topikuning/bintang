"""H4 (audit 2026-05-22): reverse-link CashRequest saat tx pencairan
di-cancel.

Sebelumnya: saat tx CASH_ADVANCE (auto-created saat CR approve) di-cancel
via /transactions/{id}/cancel, CR.status tetap APPROVED. Data drift:
UI menampilkan 'Transaksi pencairan sudah dibuat' padahal tx-nya
CANCELLED.

Sekarang: cancel_transaction detect linked CR, update status ke
DISBURSEMENT_CANCELLED (final state, tdk kembali ke PENDING per user
keputusan).
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app.api.v1.cash_requests import (
    approve_cash_request,
    create_cash_request,
)
from app.api.v1.transactions import cancel_transaction
from app.models.models import (
    CashRequest,
    CashRequestStatus,
    Company,
    Project,
    ProjectStatus,
    ProjectUser,
    Transaction,
    TxnStatus,
    User,
    UserRole,
)
from app.schemas.cash_requests import CashRequestCreate, CashRequestItemIn
from app.schemas.finance import CancelIn


async def _seed(db):
    co = Company(name="C"); db.add(co); await db.flush()
    proj = Project(
        code="P", name="P", company_id=co.id, status=ProjectStatus.AKTIF,
    )
    db.add(proj); await db.flush()
    requester = User(
        name="R", email="r@x", password_hash="x",
        role=UserRole.PROJECT_ADMIN,
    )
    admin = User(
        name="A", email="a@x", password_hash="x",
        role=UserRole.CENTRAL_ADMIN,
    )
    db.add_all([requester, admin]); await db.flush()
    db.add(ProjectUser(project_id=proj.id, user_id=requester.id))
    await db.flush()
    return proj, requester, admin


@pytest.mark.asyncio
async def test_cancel_disbursement_tx_updates_cash_request(db):
    proj, requester, admin = await _seed(db)
    out = await create_cash_request(
        payload=CashRequestCreate(
            project_id=proj.id,
            request_date=date(2026, 5, 22),
            title="Material",
            items=[CashRequestItemIn(description="x", amount=Decimal("500000"))],
        ),
        db=db, user=requester,
    )
    approved = await approve_cash_request(cr_id=out.id, db=db, admin=admin)
    assert approved.status == CashRequestStatus.APPROVED.value
    tx_id = approved.disbursement_tx_id
    assert tx_id is not None

    # Cancel tx pencairan -- harus update CR ke DISBURSEMENT_CANCELLED.
    await cancel_transaction(
        tid=tx_id,
        body=CancelIn(reason="Dana tdk jadi cair"),
        db=db, admin=admin,
    )
    # Reload CR
    cr_after = await db.get(CashRequest, approved.id)
    assert cr_after is not None
    assert cr_after.status == CashRequestStatus.DISBURSEMENT_CANCELLED.value
    # Tx-nya sendiri sudah CANCELLED
    tx_after = await db.get(Transaction, tx_id)
    assert tx_after.status == TxnStatus.CANCELLED


@pytest.mark.asyncio
async def test_cancel_unrelated_tx_does_not_touch_cash_request(db):
    """Cancel tx yg bukan disbursement dari CR -> tdk affect CR apapun."""
    proj, requester, admin = await _seed(db)
    out = await create_cash_request(
        payload=CashRequestCreate(
            project_id=proj.id,
            request_date=date(2026, 5, 22),
            title="x",
            items=[CashRequestItemIn(description="x", amount=Decimal("500000"))],
        ),
        db=db, user=requester,
    )
    approved = await approve_cash_request(cr_id=out.id, db=db, admin=admin)
    cr_disbursement_tx = approved.disbursement_tx_id

    # Bikin tx lain (tdk terhubung CR)
    other = Transaction(
        project_id=proj.id, tx_date=date(2026, 5, 22),
        type="OUT", kind="DIRECT_EXPENSE",
        amount=Decimal("100000"),
        status=TxnStatus.VERIFIED, created_by_id=admin.id,
    )
    db.add(other); await db.commit()

    await cancel_transaction(
        tid=other.id, body=CancelIn(reason="x"), db=db, admin=admin,
    )
    # CR tetap APPROVED, disbursement_tx_id tdk berubah
    cr_after = await db.get(CashRequest, approved.id)
    assert cr_after.status == CashRequestStatus.APPROVED.value
    assert cr_after.disbursement_tx_id == cr_disbursement_tx
