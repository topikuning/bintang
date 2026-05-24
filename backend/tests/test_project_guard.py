"""Project-status guard di create endpoint TX/Invoice/PO.

Audit 2026-05-24 Phase 1: lock create di proyek SELESAI/DIBATALKAN/
MENUNGGU_PERSETUJUAN. SUPERADMIN bypass dgn ?force=true. DITAHAN
intentionally tdk diblok (warn-only di FE).
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app.core.security import hash_password
from app.models.models import (
    Company,
    Project,
    ProjectKind,
    ProjectStatus,
    User,
    UserRole,
)
from app.services.project_guard import assert_project_open


async def _seed(db, *, status: ProjectStatus = ProjectStatus.AKTIF):
    co = Company(name="C"); db.add(co); await db.flush()
    p = Project(
        code="P", name="P", company_id=co.id,
        status=status, kind=ProjectKind.REGULAR.value,
    )
    db.add(p); await db.flush()
    super_admin = User(
        email="s@x", name="S", password_hash=hash_password("x"),
        role=UserRole.SUPERADMIN, scope_all_projects=True,
    )
    central = User(
        email="c@x", name="C", password_hash=hash_password("x"),
        role=UserRole.CENTRAL_ADMIN, scope_all_projects=True,
    )
    db.add_all([super_admin, central]); await db.flush()
    return co, p, super_admin, central


@pytest.mark.asyncio
async def test_assert_open_passes_for_aktif(db):
    _, p, sa, _ = await _seed(db, status=ProjectStatus.AKTIF)
    proj, forced = await assert_project_open(db, p.id, user=sa)
    assert proj.id == p.id
    assert forced is False


@pytest.mark.asyncio
async def test_assert_open_passes_for_ditahan(db):
    """DITAHAN tdk di-block -- warn-only via FE banner."""
    _, p, sa, _ = await _seed(db, status=ProjectStatus.DITAHAN)
    proj, forced = await assert_project_open(db, p.id, user=sa)
    assert proj.id == p.id
    assert forced is False


@pytest.mark.asyncio
async def test_assert_open_blocks_selesai(db):
    from fastapi import HTTPException
    _, p, _, central = await _seed(db, status=ProjectStatus.SELESAI)
    with pytest.raises(HTTPException) as exc:
        await assert_project_open(db, p.id, user=central)
    assert exc.value.status_code == 409
    detail = exc.value.detail
    assert isinstance(detail, dict)
    assert detail["code"] == "project_closed"
    assert detail["status"] == "SELESAI"


@pytest.mark.asyncio
async def test_assert_open_blocks_dibatalkan(db):
    from fastapi import HTTPException
    _, p, _, central = await _seed(db, status=ProjectStatus.DIBATALKAN)
    with pytest.raises(HTTPException) as exc:
        await assert_project_open(db, p.id, user=central)
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_assert_open_blocks_central_admin_even_with_force(db):
    """Hanya SUPERADMIN yg boleh bypass."""
    from fastapi import HTTPException
    _, p, _, central = await _seed(db, status=ProjectStatus.SELESAI)
    with pytest.raises(HTTPException) as exc:
        await assert_project_open(db, p.id, user=central, force=True)
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_assert_open_superadmin_force_bypass(db):
    _, p, sa, _ = await _seed(db, status=ProjectStatus.SELESAI)
    proj, forced = await assert_project_open(db, p.id, user=sa, force=True)
    assert proj.id == p.id
    assert forced is True


@pytest.mark.asyncio
async def test_assert_open_superadmin_without_force_still_blocked(db):
    """SUPERADMIN tanpa force flag tetap di-block -- explicit, bukan implicit."""
    from fastapi import HTTPException
    _, p, sa, _ = await _seed(db, status=ProjectStatus.SELESAI)
    with pytest.raises(HTTPException) as exc:
        await assert_project_open(db, p.id, user=sa, force=False)
    assert exc.value.status_code == 409


# ---------- Integration via HTTP utk TX/Invoice/PO create ----------
# Pastikan endpoint create benar-benar memanggil guard + return 409
# dgn detail dict. Audit 2026-05-24.


@pytest.mark.asyncio
async def test_create_tx_blocked_on_selesai_via_http(db):
    from httpx import ASGITransport, AsyncClient

    from app.core.security import create_access_token
    from app.db.session import get_db
    from app.main import app

    _, p, sa, _ = await _seed(db, status=ProjectStatus.SELESAI)

    async def _gen():
        yield db
    app.dependency_overrides[get_db] = _gen
    try:
        token = create_access_token(sa.id, extra={"role": sa.role.value})
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://t") as ac:
            r = await ac.post(
                "/api/v1/transactions",
                json={
                    "project_id": p.id, "tx_date": "2026-05-24",
                    "type": "OUT", "kind": "DIRECT_EXPENSE",
                    "amount": "100", "payment_method": "CASH",
                    "items": [{"description": "test", "amount": "100"}],
                },
                headers={"Authorization": f"Bearer {token}"},
            )
        assert r.status_code == 409, r.text
        body = r.json()
        assert isinstance(body["detail"], dict)
        assert body["detail"]["code"] == "project_closed"
        assert body["detail"]["status"] == "SELESAI"
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_create_tx_force_bypass_via_http(db):
    from httpx import ASGITransport, AsyncClient

    from app.core.security import create_access_token
    from app.db.session import get_db
    from app.main import app

    _, p, sa, _ = await _seed(db, status=ProjectStatus.SELESAI)

    async def _gen():
        yield db
    app.dependency_overrides[get_db] = _gen
    try:
        token = create_access_token(sa.id, extra={"role": sa.role.value})
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://t") as ac:
            r = await ac.post(
                "/api/v1/transactions?force=true",
                json={
                    "project_id": p.id, "tx_date": "2026-05-24",
                    "type": "OUT", "kind": "DIRECT_EXPENSE",
                    "amount": "100", "payment_method": "CASH",
                    "items": [{"description": "test", "amount": "100"}],
                },
                headers={"Authorization": f"Bearer {token}"},
            )
        assert r.status_code == 201, r.text
    finally:
        app.dependency_overrides.pop(get_db, None)
