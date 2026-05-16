"""Regression test untuk pattern soft-delete dgn `datetime.utcnow()`.

Bug yg di-fix di PR #68: `obj.deleted_at = sa_func.now()` (SQL expr)
membuat kolom expired post-commit. Access subsequent -> SELECT -> kalau
async di luar greenlet -> MissingGreenlet 500.

Fix: pakai datetime.utcnow() Python-side. Value diketahui session,
tdk pernah expire. Test ini verify pattern fix konsisten -- akses
`obj.deleted_at` setelah commit TIDAK trigger query baru.
"""
from __future__ import annotations

from datetime import date, datetime

import pytest
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.orm.base import LoaderCallableStatus

from app.models.models import (
    Company,
    Project,
    Transaction,
    TxnKind,
    TxnStatus,
    TxnType,
    User,
    UserRole,
)


@pytest.mark.asyncio
async def test_soft_delete_with_python_datetime_no_expiry(db):
    """Set deleted_at = datetime.utcnow() -> setelah commit, kolom TETAP
    loaded (tdk expired). Access deleted_at TIDAK trigger SELECT lazy."""
    co = Company(name="C"); db.add(co); await db.flush()
    p = Project(name="P", code="P", company_id=co.id)
    db.add(p)
    await db.commit()

    # Simulate soft delete pattern yg di-fix di PR #68
    p.deleted_at = datetime.utcnow()
    await db.commit()

    # Verify deleted_at TIDAK expired -- loaded_value tetap value asli
    insp = sa_inspect(p)
    attr = insp.attrs["deleted_at"]
    val = attr.loaded_value
    assert val is not LoaderCallableStatus.NO_VALUE, (
        "deleted_at expired post-commit -- ini bug pattern sa_func.now() "
        "yg seharusnya sudah di-fix oleh PR #68"
    )
    assert isinstance(val, datetime), f"unexpected loaded_value: {val!r}"


@pytest.mark.asyncio
async def test_soft_delete_tx_recoverable_no_lazy_load(db):
    """End-to-end: soft delete tx, lalu re-query -> field accessible
    tanpa MissingGreenlet."""
    co = Company(name="C"); db.add(co); await db.flush()
    user = User(
        name="u", email="u@x", password_hash="x", role=UserRole.PROJECT_ADMIN,
    )
    db.add(user); await db.flush()
    p = Project(name="P", code="P", company_id=co.id)
    db.add(p); await db.flush()

    tx = Transaction(
        project_id=p.id, type=TxnType.OUT, kind=TxnKind.DIRECT_EXPENSE,
        amount=100, tx_date=date.today(),
        status=TxnStatus.DRAFT, created_by_id=user.id,
    )
    db.add(tx); await db.commit()

    # Pattern yg sudah di-fix (PR #68)
    tx.deleted_at = datetime.utcnow()
    await db.commit()

    # Akses post-commit -- harus return datetime, BUKAN raise
    val = tx.deleted_at
    assert isinstance(val, datetime)
    assert tx.amount == 100  # column lain tetap accessible

    # Re-fetch fresh dan verify deleted_at sama (persisted)
    from sqlalchemy import select
    res = await db.execute(select(Transaction).where(Transaction.id == tx.id))
    fresh = res.scalar_one()
    assert fresh.deleted_at is not None
