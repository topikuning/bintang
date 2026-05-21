"""Endpoint utk fitur Catatan Non-Proyek.

Komponen:
- GET  /non-project/companies          : daftar (company_id, np_project_id) yg user akses
- GET  /non-project/settings/years     : daftar tahun (auto-detect + saved) + status setting
- PUT  /non-project/settings/years/{year}  : toggle inklusi (SUPERADMIN)

Untuk LIST/CREATE/UPDATE/DELETE tx di bucket non-proyek, FE pakai endpoint
existing /transactions dgn:
- list: GET /transactions?non_project=true
- create: POST /transactions dgn project_id = ID system project NON_PROJECT
  (FE ambil via /non-project/companies)

Akses:
- GET endpoints: CENTRAL_ADMIN, SUPERADMIN (lihat list/setting)
- PUT setting: SUPERADMIN saja (audit-sensitive)
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import extract, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import (
    get_current_user,
    require_admin,
    require_superadmin,
    user_project_ids,
)
from app.db.session import get_db
from app.models.models import (
    AuditAction,
    Company,
    NonProjectYearSetting,
    Project,
    ProjectKind,
    Transaction,
    TxnStatus,
    TxnType,
    User,
)
from app.services.audit import log, snapshot
from app.services.non_project import get_or_create_non_project

router = APIRouter()


class NonProjectCompanyEntry(BaseModel):
    company_id: int
    company_name: str
    project_id: int
    project_code: str


class NonProjectYearStatus(BaseModel):
    company_id: int
    company_name: str
    year: int
    include_in_global: bool
    notes: str | None = None
    updated_at: datetime | None = None
    updated_by_name: str | None = None
    tx_count: int = 0
    total_in: float = 0
    total_out: float = 0


class NonProjectYearUpdate(BaseModel):
    include_in_global: bool
    notes: str | None = None


@router.get("/companies", response_model=list[NonProjectCompanyEntry])
async def list_non_project_companies(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_superadmin),
) -> list[NonProjectCompanyEntry]:
    """Daftar company + ID system project NON_PROJECT-nya. Dipakai FE
    di halaman Catatan Non-Proyek utk:
    - tampilan multi-company (kalau user akses >1 company)
    - pre-fill project_id saat create tx
    Hanya admin yg boleh akses (PROJECT_ADMIN tdk relevan -- non-proyek
    di luar scope dia).
    """
    # Load semua company beserta NP project (lazy auto-create kalau hilang).
    companies = (
        await db.execute(
            select(Company).where(Company.deleted_at.is_(None)).order_by(Company.name)
        )
    ).scalars().all()
    out: list[NonProjectCompanyEntry] = []
    dirty = False
    for c in companies:
        # Cari system project NON_PROJECT
        proj = (
            await db.execute(
                select(Project).where(
                    Project.company_id == c.id,
                    Project.kind == ProjectKind.NON_PROJECT.value,
                    Project.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if proj is None:
            # Safety: auto-create kalau hilang (mis. company baru pasca migrasi)
            pid = await get_or_create_non_project(db, c.id)
            dirty = True
            proj = (
                await db.execute(select(Project).where(Project.id == pid))
            ).scalar_one()
        out.append(
            NonProjectCompanyEntry(
                company_id=c.id,
                company_name=c.name,
                project_id=proj.id,
                project_code=proj.code,
            )
        )
    if dirty:
        await db.commit()
    return out


@router.get("/settings/years", response_model=list[NonProjectYearStatus])
async def list_year_settings(
    company_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_superadmin),
) -> list[NonProjectYearStatus]:
    """Daftar status inklusi per tahun per company.

    Logic: gabungan dari (a) tahun yg sudah disimpan di
    NonProjectYearSetting, dengan (b) tahun yg auto-detect dari tx_date
    di proyek NON_PROJECT. Tahun yg belum disimpan di-default OFF.

    Sort: company_name ASC, year DESC (terbaru di atas)."""
    # Ambil company list (scoped ke filter kalau ada)
    co_stmt = select(Company).where(Company.deleted_at.is_(None))
    if company_id:
        co_stmt = co_stmt.where(Company.id == company_id)
    companies = (await db.execute(co_stmt)).scalars().all()
    co_map = {c.id: c for c in companies}
    if not companies:
        return []
    company_ids = list(co_map.keys())

    # Ambil semua setting yg sudah ada
    settings_rows = (
        await db.execute(
            select(NonProjectYearSetting).where(
                NonProjectYearSetting.company_id.in_(company_ids)
            )
        )
    ).scalars().all()
    settings_map: dict[tuple[int, int], NonProjectYearSetting] = {
        (s.company_id, s.year): s for s in settings_rows
    }

    # Auto-detect tahun dari tx_date di NON_PROJECT projects per company.
    # Aggregasi terpisah per (company, year, type) -- digabung di Python.
    agg_q = (
        select(
            Project.company_id.label("cid"),
            extract("year", Transaction.tx_date).label("yr"),
            Transaction.type.label("tp"),
            func.count(Transaction.id).label("cnt"),
            func.coalesce(func.sum(Transaction.amount), 0).label("amt"),
        )
        .select_from(Transaction)
        .join(Project, Project.id == Transaction.project_id)
        .where(
            Project.kind == ProjectKind.NON_PROJECT.value,
            Project.company_id.in_(company_ids),
            Transaction.deleted_at.is_(None),
            Transaction.status == TxnStatus.VERIFIED,
        )
        .group_by(Project.company_id, "yr", Transaction.type)
    )
    agg_rows = (await db.execute(agg_q)).all()
    # Aggregasi: (cid, yr) -> {tx_count, total_in, total_out}
    detected: dict[tuple[int, int], dict] = {}
    for cid, yr, tp, cnt, amt in agg_rows:
        if yr is None:
            continue
        key = (int(cid), int(yr))
        d = detected.setdefault(key, {"tx_count": 0, "total_in": 0.0, "total_out": 0.0})
        d["tx_count"] += int(cnt or 0)
        if tp == TxnType.IN or getattr(tp, "value", tp) == "IN":
            d["total_in"] += float(amt or 0)
        else:
            d["total_out"] += float(amt or 0)

    # Resolve nama user editor (utk audit)
    editor_ids = {s.updated_by_id for s in settings_rows if s.updated_by_id}
    editor_map = {}
    if editor_ids:
        editors = (
            await db.execute(select(User).where(User.id.in_(editor_ids)))
        ).scalars().all()
        editor_map = {u.id: (u.name or u.email) for u in editors}

    # Gabungkan: union of keys from settings + detected
    all_keys = set(settings_map.keys()) | set(detected.keys())
    items: list[NonProjectYearStatus] = []
    for cid, yr in all_keys:
        s = settings_map.get((cid, yr))
        d = detected.get((cid, yr), {"tx_count": 0, "total_in": 0.0, "total_out": 0.0})
        items.append(
            NonProjectYearStatus(
                company_id=cid,
                company_name=co_map[cid].name if cid in co_map else "?",
                year=yr,
                include_in_global=bool(s.include_in_global) if s else False,
                notes=s.notes if s else None,
                updated_at=s.updated_at if s else None,
                updated_by_name=(
                    editor_map.get(s.updated_by_id) if s and s.updated_by_id else None
                ),
                tx_count=d["tx_count"],
                total_in=d["total_in"],
                total_out=d["total_out"],
            )
        )

    items.sort(key=lambda x: (x.company_name.lower(), -x.year))
    return items


@router.put("/settings/years/{year}", response_model=NonProjectYearStatus)
async def upsert_year_setting(
    year: int,
    payload: NonProjectYearUpdate,
    company_id: int = Body(..., embed=True),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_superadmin),
) -> NonProjectYearStatus:
    """Upsert toggle inklusi NON_PROJECT utk (company, year).

    Hanya SUPERADMIN -- mengubah ini langsung memengaruhi laporan
    keuangan & dashboard utk SEMUA user, jadi audit-sensitive.

    Cara panggil:
        PUT /non-project/settings/years/2026
        body: {"company_id": 1, "include_in_global": true, "notes": "..."}
    """
    if year < 1900 or year > 2100:
        raise HTTPException(400, "year_out_of_range")
    # Validasi company exists
    co = (
        await db.execute(
            select(Company).where(Company.id == company_id, Company.deleted_at.is_(None))
        )
    ).scalar_one_or_none()
    if co is None:
        raise HTTPException(404, "company_not_found")

    existing = (
        await db.execute(
            select(NonProjectYearSetting).where(
                NonProjectYearSetting.company_id == company_id,
                NonProjectYearSetting.year == year,
            )
        )
    ).scalar_one_or_none()
    before = snapshot(existing) if existing else None
    if existing is None:
        existing = NonProjectYearSetting(
            company_id=company_id,
            year=year,
            include_in_global=payload.include_in_global,
            notes=payload.notes,
            updated_by_id=admin.id,
        )
        db.add(existing)
    else:
        existing.include_in_global = payload.include_in_global
        existing.notes = payload.notes
        existing.updated_by_id = admin.id
    await db.flush()
    await log(
        db,
        user_id=admin.id,
        entity="non_project_year_setting",
        entity_id=existing.id,
        action=AuditAction.UPDATE if before else AuditAction.CREATE,
        before=before,
        after=snapshot(existing),
    )
    await db.commit()

    return NonProjectYearStatus(
        company_id=company_id,
        company_name=co.name,
        year=year,
        include_in_global=existing.include_in_global,
        notes=existing.notes,
        updated_at=existing.updated_at,
        updated_by_name=admin.name or admin.email,
        tx_count=0,
        total_in=0.0,
        total_out=0.0,
    )
