"""Audit 2026-05-24: TX VERIFIED yg blm punya lampiran -- admin biasa
boleh upload bukti pertama (audit trail jadi lengkap). Append-only."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app.api.v1.transactions import upload_attachment, attach_external_link
from app.core.security import hash_password
from app.models.models import (
    Company, PaymentMethod, Project, ProjectKind, ProjectStatus,
    Transaction, TransactionAttachment, TxnKind, TxnStatus, TxnType,
    User, UserRole,
)
from app.schemas.finance import ExternalLinkIn


async def _seed(db, role=UserRole.CENTRAL_ADMIN):
    co = Company(name="C"); db.add(co); await db.flush()
    p = Project(
        code="P", name="P", company_id=co.id,
        status=ProjectStatus.AKTIF, kind=ProjectKind.REGULAR.value,
    )
    db.add(p); await db.flush()
    u = User(
        email="c@x", name="C", password_hash=hash_password("x"),
        role=role, scope_all_projects=True,
    )
    db.add(u); await db.flush()
    return co, p, u


@pytest.mark.asyncio
async def test_attach_link_allowed_for_verified_without_existing(db):
    """VERIFIED + 0 lampiran -> CENTRAL_ADMIN boleh attach link."""
    _, p, central = await _seed(db)
    t = Transaction(
        project_id=p.id, tx_date=date(2026, 5, 24),
        type=TxnType.OUT, kind=TxnKind.DIRECT_EXPENSE.value,
        amount=Decimal("100"), payment_method=PaymentMethod.CASH,
        status=TxnStatus.VERIFIED, created_by_id=central.id,
    )
    db.add(t); await db.commit()

    out = await attach_external_link(
        tid=t.id,
        body=ExternalLinkIn(url="https://drive.google.com/file/d/abc/view"),
        db=db, user=central,
    )
    assert out is not None
    # Verify saved
    from sqlalchemy import select, func
    count = (await db.execute(
        select(func.count(TransactionAttachment.id))
        .where(TransactionAttachment.transaction_id == t.id)
    )).scalar_one()
    assert count == 1


@pytest.mark.asyncio
async def test_attach_link_blocked_when_already_has_attachment(db):
    """VERIFIED + sudah ada lampiran -> CENTRAL_ADMIN ditolak 409."""
    from fastapi import HTTPException
    _, p, central = await _seed(db)
    t = Transaction(
        project_id=p.id, tx_date=date(2026, 5, 24),
        type=TxnType.OUT, kind=TxnKind.DIRECT_EXPENSE.value,
        amount=Decimal("100"), payment_method=PaymentMethod.CASH,
        status=TxnStatus.VERIFIED, created_by_id=central.id,
    )
    db.add(t); await db.flush()
    db.add(TransactionAttachment(
        transaction_id=t.id, uploaded_by_id=central.id,
        file_name="existing.pdf", url="/files/existing.pdf",
        file_size=1024, mime_type="application/pdf",
    ))
    await db.commit()

    with pytest.raises(HTTPException) as exc:
        await attach_external_link(
            tid=t.id,
            body=ExternalLinkIn(url="https://drive.google.com/file/d/new/view"),
            db=db, user=central,
        )
    assert exc.value.status_code == 409
    assert "verified_locked" in str(exc.value.detail)


@pytest.mark.asyncio
async def test_superadmin_bypass_unchanged(db):
    """SUPERADMIN tetap bypass (god-mode) bahkan kalau sudah ada lampiran."""
    _, p, superadmin = await _seed(db, role=UserRole.SUPERADMIN)
    t = Transaction(
        project_id=p.id, tx_date=date(2026, 5, 24),
        type=TxnType.OUT, kind=TxnKind.DIRECT_EXPENSE.value,
        amount=Decimal("100"), payment_method=PaymentMethod.CASH,
        status=TxnStatus.VERIFIED, created_by_id=superadmin.id,
    )
    db.add(t); await db.flush()
    db.add(TransactionAttachment(
        transaction_id=t.id, uploaded_by_id=superadmin.id,
        file_name="existing.pdf", url="/files/existing.pdf",
        file_size=1024, mime_type="application/pdf",
    ))
    await db.commit()

    out = await attach_external_link(
        tid=t.id,
        body=ExternalLinkIn(url="https://drive.google.com/file/d/sup/view"),
        db=db, user=superadmin,
    )
    assert out is not None
