"""Regression test untuk audience-based broadcast notif tx.

Bug yg di-fix di PR #70: notif tx terbatas & sering miss stakeholder.
Audience harus = { creator } ∪ { central_admins } ∪ { project_admins_linked }
minus { actor }.
"""
from __future__ import annotations

from datetime import date

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import (
    Company,
    Project,
    ProjectUser,
    Transaction,
    TxnKind,
    TxnStatus,
    TxnType,
    User,
    UserRole,
)
from app.services.messaging import _wa_audience_for_tx
from app.services.telegram.notify import _audience_for_tx as tg_audience


@pytest_asyncio.fixture
async def fixt(db: AsyncSession):
    """Setup: 1 proyek, 6 user (campuran role + chat link), 1 tx."""
    co = Company(name="C")
    db.add(co)
    await db.flush()

    sup = User(
        name="Sup", email="sup@x", password_hash="x",
        role=UserRole.SUPERADMIN,
        telegram_chat_id="tg-sup", whatsapp_chat_id="wa-sup",
    )
    cad = User(
        name="Cad", email="cad@x", password_hash="x",
        role=UserRole.CENTRAL_ADMIN, telegram_chat_id="tg-cad",
    )
    pad_a = User(
        name="PadA", email="pa@x", password_hash="x",
        role=UserRole.PROJECT_ADMIN,
        telegram_chat_id="tg-pa", whatsapp_chat_id="wa-pa",
    )
    pad_b = User(
        # Tdk-linked ke proyek -- harus EXCLUDED
        name="PadB", email="pb@x", password_hash="x",
        role=UserRole.PROJECT_ADMIN, telegram_chat_id="tg-pb",
    )
    creator = User(
        name="Cre", email="cre@x", password_hash="x",
        role=UserRole.PROJECT_ADMIN,
        telegram_chat_id="tg-cre", whatsapp_chat_id="wa-cre",
    )
    nolink = User(
        # No chat_id -- harus EXCLUDED dr filter chat
        name="Nol", email="nol@x", password_hash="x",
        role=UserRole.SUPERADMIN,
    )
    db.add_all([sup, cad, pad_a, pad_b, creator, nolink])
    await db.flush()

    p1 = Project(name="P1", code="P1", company_id=co.id)
    db.add(p1)
    await db.flush()

    # Link only padA ke p1
    db.add(ProjectUser(project_id=p1.id, user_id=pad_a.id))
    await db.flush()

    tx = Transaction(
        project_id=p1.id, type=TxnType.OUT,
        kind=TxnKind.DIRECT_EXPENSE,
        amount=1000, tx_date=date.today(),
        status=TxnStatus.SUBMITTED, created_by_id=creator.id,
    )
    db.add(tx)
    await db.commit()

    return {
        "sup": sup, "cad": cad, "pad_a": pad_a, "pad_b": pad_b,
        "creator": creator, "nolink": nolink, "tx": tx, "p1": p1,
    }


@pytest.mark.asyncio
async def test_tg_audience_full(db, fixt):
    """Tanpa exclude: creator + central + linked project_admin masuk;
    PROJECT_ADMIN tdk-linked + user tanpa chat_id excluded."""
    aud = await tg_audience(db, fixt["tx"])
    names = sorted(u.name for u in aud)
    assert names == ["Cad", "Cre", "PadA", "Sup"]


@pytest.mark.asyncio
async def test_tg_audience_excludes_verifier(db, fixt):
    """Saat verify, exclude actor (verifier) supaya tdk echo ke diri."""
    aud = await tg_audience(db, fixt["tx"], exclude_user_id=fixt["sup"].id)
    names = sorted(u.name for u in aud)
    assert names == ["Cad", "Cre", "PadA"]


@pytest.mark.asyncio
async def test_tg_audience_excludes_creator_when_self_submit(db, fixt):
    """Saat creator self-submit, dia excluded; admin tetap dapat."""
    aud = await tg_audience(db, fixt["tx"], exclude_user_id=fixt["creator"].id)
    names = sorted(u.name for u in aud)
    assert names == ["Cad", "PadA", "Sup"]


@pytest.mark.asyncio
async def test_wa_audience_filter_chat_id(db, fixt):
    """WA channel: hanya user dgn whatsapp_chat_id non-null. Cad tdk
    masuk (no WA chat), nolink tdk masuk (no chat any)."""
    aud = await _wa_audience_for_tx(db, fixt["tx"])
    names = sorted(u.name for u in aud)
    assert names == ["Cre", "PadA", "Sup"]


@pytest.mark.asyncio
async def test_wa_audience_excludes_actor(db, fixt):
    aud = await _wa_audience_for_tx(
        db, fixt["tx"], exclude_user_id=fixt["sup"].id,
    )
    names = sorted(u.name for u in aud)
    assert names == ["Cre", "PadA"]


@pytest.mark.asyncio
async def test_audience_dedup_when_creator_is_central_admin(db, fixt):
    """Kalau creator juga CENTRAL_ADMIN, dia tdk muncul 2x di audience."""
    # promote creator ke CENTRAL_ADMIN
    fixt["creator"].role = UserRole.CENTRAL_ADMIN
    await db.commit()
    aud = await tg_audience(db, fixt["tx"])
    creator_count = sum(1 for u in aud if u.id == fixt["creator"].id)
    assert creator_count == 1
