"""Smoke test pengajuan dana (CashRequest).

Cover happy path:
- Buat pengajuan dgn 2 item -> total_amount = sum(items).
- Approve -> status APPROVED + auto-create tx CASH_ADVANCE DRAFT,
  link via disbursement_tx_id.
- Reject (test terpisah) -> status REJECTED + rejection_reason.

Tidak pakai HTTP layer -- panggil endpoint function langsung dgn db
fixture. Cukup utk regression invariant utama.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app.api.v1.cash_requests import (
    approve_cash_request,
    create_cash_request,
    reject_cash_request,
)
from app.models.models import (
    CashRequestStatus,
    Company,
    Project,
    ProjectKind,
    ProjectStatus,
    ProjectUser,
    Transaction,
    TxnKind,
    TxnStatus,
    TxnType,
    User,
    UserRole,
)
from fastapi import HTTPException
from app.schemas.cash_requests import (
    CashRequestCreate,
    CashRequestItemIn,
    CashRequestRejectIn,
)


async def _seed(db):
    co = Company(name="C1"); db.add(co); await db.flush()
    proj = Project(
        code="P1", name="Proj 1", company_id=co.id,
        status=ProjectStatus.AKTIF,
    )
    db.add(proj); await db.flush()
    requester = User(
        name="Mandor", email="mandor@x", password_hash="x",
        role=UserRole.PROJECT_ADMIN,
    )
    admin = User(
        name="CentralAdm", email="ca@x", password_hash="x",
        role=UserRole.CENTRAL_ADMIN,
    )
    db.add_all([requester, admin]); await db.flush()
    # PROJECT_ADMIN tdk punya global access -- assign ke proyek lewat
    # ProjectUser supaya ensure_project_access lulus.
    db.add(ProjectUser(project_id=proj.id, user_id=requester.id))
    await db.flush()
    return co, proj, requester, admin


@pytest.mark.asyncio
async def test_create_then_approve_creates_cash_advance_tx(db):
    _, proj, requester, admin = await _seed(db)

    payload = CashRequestCreate(
        project_id=proj.id,
        request_date=date(2026, 5, 21),
        title="Belanja material minggu 21",
        notes="Beli semen + besi",
        items=[
            CashRequestItemIn(description="Semen 50 sak", amount=Decimal("2500000")),
            CashRequestItemIn(description="Besi 10mm", amount=Decimal("3500000")),
        ],
    )
    out = await create_cash_request(payload=payload, db=db, user=requester)
    assert out.status == CashRequestStatus.PENDING.value
    assert out.total_amount == Decimal("6000000")
    assert out.number.startswith("CR/2026/05/")
    assert len(out.items) == 2

    # Approve -> jadi APPROVED + auto-create tx CASH_ADVANCE DRAFT.
    approved = await approve_cash_request(cr_id=out.id, db=db, admin=admin)
    assert approved.status == CashRequestStatus.APPROVED.value
    assert approved.disbursement_tx_id is not None
    assert approved.approved_by_id == admin.id

    tx = await db.get(Transaction, approved.disbursement_tx_id)
    assert tx is not None
    assert tx.type == TxnType.OUT
    assert tx.kind == TxnKind.CASH_ADVANCE.value
    assert tx.status == TxnStatus.DRAFT
    assert tx.amount == Decimal("6000000")
    assert tx.project_id == proj.id
    # Recipient default = requester saat recipient_user_id None.
    assert tx.recipient_user_id == requester.id


@pytest.mark.asyncio
async def test_reject_blocks_tx_creation(db):
    _, proj, requester, admin = await _seed(db)
    payload = CashRequestCreate(
        project_id=proj.id,
        request_date=date(2026, 5, 21),
        title="Operasional",
        items=[CashRequestItemIn(description="Bensin", amount=Decimal("500000"))],
    )
    out = await create_cash_request(payload=payload, db=db, user=requester)
    rejected = await reject_cash_request(
        cr_id=out.id,
        payload=CashRequestRejectIn(reason="Bukan prioritas"),
        db=db, admin=admin,
    )
    assert rejected.status == CashRequestStatus.REJECTED.value
    assert rejected.rejection_reason == "Bukan prioritas"
    assert rejected.disbursement_tx_id is None  # tidak bikin tx


@pytest.mark.asyncio
async def test_approve_uses_recipient_when_set(db):
    _, proj, requester, admin = await _seed(db)
    recipient = User(
        name="Mandor B", email="mb@x", password_hash="x",
        role=UserRole.PROJECT_ADMIN,
    )
    db.add(recipient); await db.flush()
    payload = CashRequestCreate(
        project_id=proj.id,
        recipient_user_id=recipient.id,
        request_date=date(2026, 5, 21),
        title="Material",
        items=[CashRequestItemIn(description="Pasir", amount=Decimal("1000000"))],
    )
    out = await create_cash_request(payload=payload, db=db, user=requester)
    approved = await approve_cash_request(cr_id=out.id, db=db, admin=admin)
    tx = await db.get(Transaction, approved.disbursement_tx_id)
    assert tx.recipient_user_id == recipient.id
    assert tx.recipient_name == "Mandor B"


@pytest.mark.asyncio
async def test_cannot_request_against_non_project(db):
    """Pengajuan dana ke project kind=NON_PROJECT harus ditolak.

    Setelah audit 2026-05-22 #C2: NP rahasia utk non-SUPERADMIN.
    ensure_project_access raise 404 (bukan 403 atau 400) supaya tdk
    bocorkan keberadaan NP. Dengan demikian, requester PROJECT_ADMIN/
    CENTRAL_ADMIN tdk pernah sampai ke explicit NP-check di endpoint
    cash_requests -- mereka di-block lebih awal di ensure_project_access.
    SUPERADMIN tetap di-block di endpoint explicit NP-check (400)."""
    co, _, requester, _admin = await _seed(db)
    np_proj = Project(
        code=f"NON-PROJECT-{co.id}", name="Catatan Non-Proyek",
        company_id=co.id, status=ProjectStatus.AKTIF,
        kind=ProjectKind.NON_PROJECT.value,
    )
    db.add(np_proj); await db.flush()
    db.add(ProjectUser(project_id=np_proj.id, user_id=requester.id))
    await db.flush()

    payload = CashRequestCreate(
        project_id=np_proj.id,
        request_date=date(2026, 5, 21),
        title="Should fail",
        items=[CashRequestItemIn(description="x", amount=Decimal("100000"))],
    )
    # PROJECT_ADMIN -> 404 not_found (NP rahasia, return 404 supaya tdk
    # ekspos keberadaan).
    with pytest.raises(HTTPException) as exc:
        await create_cash_request(payload=payload, db=db, user=requester)
    assert exc.value.status_code == 404
    assert exc.value.detail == "not_found"

    # SUPERADMIN -> 400 cannot_request_against_non_project (visible tapi
    # tetap reject scopa pengajuan ke NP).
    super_user = User(
        name="Super", email="su@x", password_hash="x",
        role=UserRole.SUPERADMIN,
    )
    db.add(super_user); await db.flush()
    with pytest.raises(HTTPException) as exc2:
        await create_cash_request(payload=payload, db=db, user=super_user)
    assert exc2.value.status_code == 400
    assert "non_project" in exc2.value.detail
