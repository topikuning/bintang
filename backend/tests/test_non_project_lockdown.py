"""C2/H1/H2 (audit 2026-05-22): NON_PROJECT secrecy invariant.

Verifikasi NP project (kind=NON_PROJECT) tdk bocor ke role lain
selain SUPERADMIN:
- user_project_ids exclude NP utk non-SUPERADMIN
- ensure_project_access raise 404 (not 403) utk NP supaya keberadaan
  proyek tidak ekspos via error semantics.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.core.deps import ensure_project_access, user_project_ids
from app.models.models import (
    Company,
    Project,
    ProjectKind,
    ProjectStatus,
    ProjectUser,
    User,
    UserRole,
)


async def _seed_with_np(db):
    co = Company(name="C"); db.add(co); await db.flush()
    reg = Project(
        code="P1", name="P1", company_id=co.id,
        status=ProjectStatus.AKTIF,
    )
    np = Project(
        code=f"NON-PROJECT-{co.id}", name="Catatan Non-Proyek",
        company_id=co.id, status=ProjectStatus.AKTIF,
        kind=ProjectKind.NON_PROJECT.value,
    )
    db.add_all([reg, np]); await db.flush()
    return co, reg, np


@pytest.mark.asyncio
async def test_user_project_ids_superadmin_returns_none(db):
    """SUPERADMIN dapat akses semua proyek tanpa filter -> None."""
    _, _, _ = await _seed_with_np(db)
    su = User(
        name="S", email="s@x", password_hash="x", role=UserRole.SUPERADMIN,
    )
    db.add(su); await db.flush()
    result = await user_project_ids(db, su)
    assert result is None  # convention: None = global access


@pytest.mark.asyncio
async def test_user_project_ids_central_admin_excludes_np(db):
    """CENTRAL_ADMIN dapat semua proyek REGULAR, TAPI bukan NP."""
    _, reg, np = await _seed_with_np(db)
    ca = User(
        name="CA", email="ca@x", password_hash="x", role=UserRole.CENTRAL_ADMIN,
    )
    db.add(ca); await db.flush()
    result = await user_project_ids(db, ca)
    assert result is not None
    assert reg.id in result
    assert np.id not in result


@pytest.mark.asyncio
async def test_user_project_ids_project_admin_with_np_link_still_excludes(db):
    """Even kalau seseorang nakal masukkan project_users link ke NP,
    PROJECT_ADMIN tetap tdk dapat NP dari user_project_ids."""
    _, reg, np = await _seed_with_np(db)
    pa = User(
        name="PA", email="pa@x", password_hash="x", role=UserRole.PROJECT_ADMIN,
    )
    db.add(pa); await db.flush()
    db.add_all([
        ProjectUser(project_id=reg.id, user_id=pa.id),
        ProjectUser(project_id=np.id, user_id=pa.id),  # nakal: assign NP
    ])
    await db.flush()
    result = await user_project_ids(db, pa)
    assert result == [reg.id]


@pytest.mark.asyncio
async def test_ensure_project_access_returns_404_for_np_non_super(db):
    """NP project di-treat 'tidak ada' utk non-SUPERADMIN, walaupun
    sebenarnya ada -- supaya keberadaan tidak ekspos via 403."""
    _, _, np = await _seed_with_np(db)
    ca = User(
        name="CA", email="ca@x", password_hash="x", role=UserRole.CENTRAL_ADMIN,
    )
    db.add(ca); await db.flush()
    with pytest.raises(HTTPException) as exc:
        await ensure_project_access(db, ca, np.id)
    assert exc.value.status_code == 404
    assert exc.value.detail == "not_found"


@pytest.mark.asyncio
async def test_ensure_project_access_superadmin_allowed_np(db):
    """SUPERADMIN tetap boleh akses NP -- bukan rahasia thd diri sendiri."""
    _, _, np = await _seed_with_np(db)
    su = User(
        name="S", email="s@x", password_hash="x", role=UserRole.SUPERADMIN,
    )
    db.add(su); await db.flush()
    # Tdk raise
    await ensure_project_access(db, su, np.id)


@pytest.mark.asyncio
async def test_ensure_project_access_regular_still_works_for_central(db):
    """REGULAR project tetap accessible utk CENTRAL_ADMIN (regression
    sanity check supaya lockdown NP tdk break existing flow)."""
    _, reg, _ = await _seed_with_np(db)
    ca = User(
        name="CA", email="ca@x", password_hash="x", role=UserRole.CENTRAL_ADMIN,
    )
    db.add(ca); await db.flush()
    await ensure_project_access(db, ca, reg.id)  # no raise
