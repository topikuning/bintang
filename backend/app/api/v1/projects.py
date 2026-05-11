from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import (
    ensure_project_access,
    get_current_user,
    require_admin,
    require_superadmin,
    user_project_ids,
)
from app.db.session import get_db
from app.models.models import (
    AuditAction,
    Funder,
    Project,
    ProjectAttachment,
    ProjectDocType,
    ProjectFunder,
    ProjectStatus,
    ProjectUser,
    User,
    UserRole,
)
from app.schemas.common import Page
from app.schemas.refs import (
    ProjectCreate,
    ProjectOut,
    ProjectProposalCreate,
    ProjectRejectIn,
    ProjectUpdate,
)
from app.services.audit import log, snapshot
from app.services.storage.links import normalize_external_link
from app.services.storage.local import save_upload
from app.models.models import (  # extra imports for stats endpoint
    Company as _Company,
    Invoice as _Invoice,
    InvoiceStatus as _InvoiceStatus,
    Transaction as _Transaction,
    TxnStatus as _TxnStatus,
    TxnType as _TxnType,
)

router = APIRouter()


def _to_out(p: Project) -> ProjectOut:
    """Serialize Project + isi company_name + nama pengaju/approver +
    funder_ids/funder_names dari relasi (perlu sudah eager-loaded).

    approved_at = datetime di model_validate -> Pydantic handle serialize
    ke ISO string otomatis di response JSON dump.
    """
    out = ProjectOut.model_validate(p)
    out.company_name = p.company.name if getattr(p, "company", None) else None
    proposed_by = getattr(p, "_proposed_by_user", None)
    if proposed_by is not None:
        out.proposed_by_name = proposed_by.name
    approved_by = getattr(p, "_approved_by_user", None)
    if approved_by is not None:
        out.approved_by_name = approved_by.name
    # Funders dr relasi project_funders (selectinload-ed).
    funder_links = getattr(p, "funders", []) or []
    out.funder_ids = [pf.funder_id for pf in funder_links]
    # Bulk-loaded di endpoint via _attach_funder_names utk dapat name.
    funder_names_map: dict[int, str] = getattr(p, "_funder_names_map", {})
    out.funder_names = [
        funder_names_map.get(pf.funder_id, "") for pf in funder_links
    ]
    return out


async def _attach_funder_names(db: AsyncSession, projects: list[Project]) -> None:
    """Bulk-load nama Funder utk semua proyek, tempel sbg dict in-memory
    supaya _to_out bisa pakai tanpa N+1 query."""
    fids: set[int] = set()
    for p in projects:
        for pf in getattr(p, "funders", []) or []:
            fids.add(pf.funder_id)
    if not fids:
        return
    res = await db.execute(select(Funder).where(Funder.id.in_(fids)))
    name_map = {f.id: f.name for f in res.scalars().all()}
    for p in projects:
        p._funder_names_map = name_map


async def _attach_relations(db: AsyncSession, projects: list[Project]) -> None:
    """Convenience: attach proposal users + funder names utk list proyek."""
    await _attach_proposal_users(db, projects)
    await _attach_funder_names(db, projects)


async def _attach_proposal_users(db: AsyncSession, projects: list[Project]) -> None:
    """Bulk-load nama pengaju + approver utk list proyek, tempel sbg attr
    in-memory supaya _to_out bisa pakai tanpa N+1 query."""
    uids: set[int] = set()
    for p in projects:
        if p.proposed_by_id:
            uids.add(p.proposed_by_id)
        if p.approved_by_id:
            uids.add(p.approved_by_id)
    if not uids:
        return
    res = await db.execute(select(User).where(User.id.in_(uids)))
    umap = {u.id: u for u in res.scalars().all()}
    for p in projects:
        if p.proposed_by_id and p.proposed_by_id in umap:
            p._proposed_by_user = umap[p.proposed_by_id]
        if p.approved_by_id and p.approved_by_id in umap:
            p._approved_by_user = umap[p.approved_by_id]


@router.get("", response_model=Page[ProjectOut])
async def list_projects(
    q: str | None = None,
    status: str | None = None,
    company_id: int | None = None,
    include_pending: bool = False,
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=2000),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Page[ProjectOut]:
    stmt = select(Project).where(Project.deleted_at.is_(None))
    pids = await user_project_ids(db, user)
    if pids is not None:
        if not pids:
            return Page(items=[], total=0, page=page, size=size)
        stmt = stmt.where(Project.id.in_(pids))
    if q:
        like = f"%{q}%"
        # Cari di nama proyek, kode proyek, dan nama perusahaan.
        stmt = stmt.join(_Company, Project.company_id == _Company.id, isouter=True).where(
            or_(
                Project.name.ilike(like),
                Project.code.ilike(like),
                _Company.name.ilike(like),
            )
        )
    if status:
        stmt = stmt.where(Project.status == status)
    elif not include_pending:
        # Default: HIDE proyek MENUNGGU_PERSETUJUAN dr list operasional.
        # Admin yg butuh lihat (master CRUD) bisa pass include_pending=true atau
        # status=MENUNGGU_PERSETUJUAN.
        stmt = stmt.where(Project.status != ProjectStatus.MENUNGGU_PERSETUJUAN)
    if company_id:
        stmt = stmt.where(Project.company_id == company_id)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    stmt = (
        stmt.options(selectinload(Project.company), selectinload(Project.funders))
        .order_by(Project.id.desc())
        .offset((page - 1) * size)
        .limit(size)
    )
    items = list((await db.execute(stmt)).scalars().all())
    await _attach_relations(db, items)
    return Page(items=[_to_out(p) for p in items], total=total, page=page, size=size)


@router.get("/filters")
async def list_project_filters(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Distinct values utk filter dropdown di hub proyek. Hormat scoping
    user. Termasuk funders {id,name} yg tertaut ke proyek yg user akses.
    """
    stmt = select(Project).options(selectinload(Project.funders)).where(
        Project.deleted_at.is_(None),
        Project.status != ProjectStatus.MENUNGGU_PERSETUJUAN,
    )
    pids = await user_project_ids(db, user)
    if pids is not None:
        if not pids:
            return {"locations": [], "clients": [], "funders": []}
        stmt = stmt.where(Project.id.in_(pids))
    projects = (await db.execute(stmt)).scalars().all()
    locations = sorted({(p.location or "").strip() for p in projects if p.location})
    clients = sorted({(p.client_name or "").strip() for p in projects if p.client_name})
    # Funder yg tertaut ke proyek user (subset Funder table, sorted by name).
    fids = {pf.funder_id for p in projects for pf in (p.funders or [])}
    funders_list: list[dict] = []
    if fids:
        res = await db.execute(
            select(Funder)
            .where(Funder.id.in_(fids), Funder.deleted_at.is_(None))
            .order_by(Funder.name)
        )
        funders_list = [{"id": f.id, "name": f.name} for f in res.scalars().all()]
    return {"locations": locations, "clients": clients, "funders": funders_list}


@router.get("/stats")
async def list_projects_with_stats(
    q: str | None = None,
    status: str | None = None,
    company_id: int | None = None,
    location: str | None = None,
    client_name: str | None = None,
    funder_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict]:
    """List proyek lengkap dengan agregat keuangan (untuk halaman Proyek
    yang kaya kartu). Hormat scoping user.

    Filter location & client_name: exact match (case-insensitive). Dipakai
    di hub proyek utk filter berdasarkan kota/instansi.
    """
    stmt = select(Project).where(Project.deleted_at.is_(None))
    pids = await user_project_ids(db, user)
    if pids is not None:
        if not pids:
            return []
        stmt = stmt.where(Project.id.in_(pids))
    if q:
        like = f"%{q}%"
        stmt = stmt.where((Project.name.ilike(like)) | (Project.code.ilike(like)))
    if status:
        stmt = stmt.where(Project.status == status)
    else:
        # Stats hanya utk proyek aktif/operasional, exclude proposal yg belum approve.
        stmt = stmt.where(Project.status != ProjectStatus.MENUNGGU_PERSETUJUAN)
    if company_id:
        stmt = stmt.where(Project.company_id == company_id)
    if location:
        # case-insensitive exact match (asumsi dropdown value sesuai DB)
        stmt = stmt.where(func.lower(Project.location) == location.lower())
    if client_name:
        stmt = stmt.where(func.lower(Project.client_name) == client_name.lower())
    if funder_id:
        # Join lewat project_funders
        stmt = stmt.join(
            ProjectFunder, ProjectFunder.project_id == Project.id
        ).where(ProjectFunder.funder_id == funder_id)
    stmt = stmt.options(selectinload(Project.funders)).order_by(Project.id.desc())
    projects = (await db.execute(stmt)).scalars().all()

    # company map
    cmap_q = select(_Company)
    cmap = {c.id: c for c in (await db.execute(cmap_q)).scalars().all()}
    # Funder name map utk display chip di card
    funder_ids_all = {pf.funder_id for p in projects for pf in (p.funders or [])}
    fname_map: dict[int, str] = {}
    if funder_ids_all:
        fres = await db.execute(
            select(Funder).where(Funder.id.in_(funder_ids_all))
        )
        fname_map = {f.id: f.name for f in fres.scalars().all()}

    out: list[dict] = []
    active_tx_statuses = (_TxnStatus.DRAFT, _TxnStatus.SUBMITTED, _TxnStatus.VERIFIED)
    open_inv_statuses = (
        _InvoiceStatus.ISSUED, _InvoiceStatus.PARTIALLY_PAID, _InvoiceStatus.OVERDUE,
    )
    for p in projects:
        # totals_in / totals_out (active)
        in_q = select(func.coalesce(func.sum(_Transaction.amount), 0)).where(
            _Transaction.project_id == p.id,
            _Transaction.type == _TxnType.IN,
            _Transaction.status.in_(active_tx_statuses),
            _Transaction.deleted_at.is_(None),
        )
        out_q = select(func.coalesce(func.sum(_Transaction.amount), 0)).where(
            _Transaction.project_id == p.id,
            _Transaction.type == _TxnType.OUT,
            _Transaction.status.in_(active_tx_statuses),
            _Transaction.deleted_at.is_(None),
        )
        total_in = float((await db.execute(in_q)).scalar_one() or 0)
        total_out = float((await db.execute(out_q)).scalar_one() or 0)

        # invoice open
        inv_open_q = select(func.coalesce(func.sum(_Invoice.total), 0)).where(
            _Invoice.project_id == p.id,
            _Invoice.status.in_(open_inv_statuses),
            _Invoice.deleted_at.is_(None),
        )
        inv_open = float((await db.execute(inv_open_q)).scalar_one() or 0)

        budget = float(p.budget_amount or 0)
        spent = total_out
        usage_pct = (spent / budget * 100) if budget > 0 else 0.0
        if budget <= 0:
            bstatus = "no_budget"
        elif usage_pct <= 80:
            bstatus = "aman"
        elif usage_pct <= 100:
            bstatus = "mendekati_batas"
        else:
            bstatus = "overbudget"

        balance = total_in - total_out
        if balance < 0:
            health = "minus"
        elif balance == 0:
            health = "waspada"
        else:
            health = "sehat"

        out.append({
            "id": p.id,
            "code": p.code,
            "name": p.name,
            "location": p.location,
            "status": p.status.value,
            "currency": p.currency,
            "company_id": p.company_id,
            "company": cmap[p.company_id].name if p.company_id in cmap else None,
            "project_value": float(p.project_value or 0),
            "budget_amount": budget,
            "total_in": total_in,
            "total_out": total_out,
            "balance": balance,
            "invoice_open": inv_open,
            "budget": {
                "amount": budget,
                "spent": spent,
                "remaining": budget - spent,
                "usage_pct": round(usage_pct, 2),
                "status": bstatus,
            },
            "health": health,
            "funder_ids": [pf.funder_id for pf in (p.funders or [])],
            "funder_names": [
                fname_map.get(pf.funder_id, "") for pf in (p.funders or [])
            ],
        })
    return out


async def _load_with_company(db: AsyncSession, pid: int) -> Project | None:
    res = await db.execute(
        select(Project)
        .options(
            selectinload(Project.company),
            selectinload(Project.funders),
        )
        .where(Project.id == pid)
    )
    return res.scalar_one_or_none()


async def _replace_project_funders(
    db: AsyncSession, project_id: int, new_funder_ids: list[int]
) -> None:
    """Replace seluruh link funder utk proyek. Validate semua ID exist,
    drop yg lama, insert yg baru. Idempoten saat list sama dgn DB."""
    new_set = set(int(x) for x in (new_funder_ids or []))
    if new_set:
        # Validasi: pastikan semua ID exist & belum di-soft-delete.
        valid = (
            await db.execute(
                select(Funder.id).where(
                    Funder.id.in_(new_set), Funder.deleted_at.is_(None)
                )
            )
        ).scalars().all()
        invalid = new_set - set(valid)
        if invalid:
            raise HTTPException(
                400,
                f"funder_id_invalid: {sorted(invalid)} tidak ada / sudah dihapus",
            )
    existing = (
        await db.execute(
            select(ProjectFunder).where(ProjectFunder.project_id == project_id)
        )
    ).scalars().all()
    existing_set = {pf.funder_id for pf in existing}
    # Drop yg sudah tdk di list baru
    to_drop = existing_set - new_set
    for pf in existing:
        if pf.funder_id in to_drop:
            await db.delete(pf)
    # Insert yg baru
    to_add = new_set - existing_set
    for fid in to_add:
        db.add(ProjectFunder(project_id=project_id, funder_id=fid))


@router.post("", response_model=ProjectOut, status_code=201)
async def create_project(
    payload: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> ProjectOut:
    exists = (await db.execute(select(Project).where(Project.code == payload.code))).scalar_one_or_none()
    if exists:
        raise HTTPException(409, "project_code_already_used")
    payload_data = payload.model_dump(exclude={"funder_ids"})
    funder_ids = payload.funder_ids
    p = Project(**payload_data)
    # Proyek yg dibuat langsung oleh admin -> AKTIF + ter-approve oleh dirinya.
    if p.status == ProjectStatus.MENUNGGU_PERSETUJUAN:
        p.status = ProjectStatus.AKTIF
    p.approved_by_id = admin.id
    # Pakai Python datetime (BUKAN func.now()) supaya snapshot(p) di
    # bawah bisa JSON-serialize utk AuditLog.after. func.now() return SQL
    # FunctionElement object yg gagal json.dumps -> 500.
    from datetime import datetime as _dt
    p.approved_at = _dt.utcnow()
    db.add(p)
    await db.flush()
    if funder_ids:
        await _replace_project_funders(db, p.id, funder_ids)
    if p.pic_user_id:
        db.add(ProjectUser(project_id=p.id, user_id=p.pic_user_id))
    # PENTING: setelah db.flush(), kolom server-default (TimestampMixin
    # created_at/updated_at, def. column2) di-expire. Refresh dgn explicit
    # attribute_names supaya snapshot(p) tdk trigger lazy-load (yg gagal
    # di async context = MissingGreenlet).
    await db.refresh(
        p, attribute_names=[c.name for c in Project.__table__.columns]
    )
    await log(db, user_id=admin.id, entity="project", entity_id=p.id,
              action=AuditAction.CREATE, after=snapshot(p))
    await db.commit()
    p = await _load_with_company(db, p.id)
    return _to_out(p)


# ---------- Proposal workflow ----------
@router.get("/proposals/queue", response_model=Page[ProjectOut])
async def list_proposal_queue(
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> Page[ProjectOut]:
    """Queue proposal proyek yg menunggu approval. Hanya CENTRAL/SUPERADMIN."""
    stmt = select(Project).where(
        Project.deleted_at.is_(None),
        Project.status == ProjectStatus.MENUNGGU_PERSETUJUAN,
    )
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    stmt = (
        stmt.options(selectinload(Project.company), selectinload(Project.funders))
        .order_by(Project.id.desc())
        .offset((page - 1) * size)
        .limit(size)
    )
    items = list((await db.execute(stmt)).scalars().all())
    await _attach_relations(db, items)
    return Page(items=[_to_out(p) for p in items], total=total, page=page, size=size)


@router.get("/proposals/count")
async def count_proposals(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    """Hitungan proposal pending utk badge nav. Hanya admin."""
    res = await db.execute(
        select(func.count()).where(
            Project.deleted_at.is_(None),
            Project.status == ProjectStatus.MENUNGGU_PERSETUJUAN,
        )
    )
    return {"count": res.scalar_one() or 0}


@router.post("/proposals", response_model=ProjectOut, status_code=201)
async def propose_project(
    payload: ProjectProposalCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ProjectOut:
    """Ajukan proyek baru -- terbuka utk semua user login (non-EXECUTIVE).

    Status -> MENUNGGU_PERSETUJUAN. proposed_by_id = pengaju. Admin
    (CENTRAL/SUPERADMIN) yg approve di endpoint /approve.
    """
    if user.role == UserRole.EXECUTIVE:
        raise HTTPException(403, "read_only_role")
    exists = (await db.execute(
        select(Project).where(Project.code == payload.code)
    )).scalar_one_or_none()
    if exists:
        raise HTTPException(409, "project_code_already_used")
    p = Project(
        **payload.model_dump(),
        status=ProjectStatus.MENUNGGU_PERSETUJUAN,
        proposed_by_id=user.id,
    )
    db.add(p)
    await db.flush()
    await log(db, user_id=user.id, entity="project_proposal", entity_id=p.id,
              action=AuditAction.CREATE, after=snapshot(p))
    await db.commit()
    p = await _load_with_company(db, p.id)
    await _attach_relations(db, [p])
    return _to_out(p)


@router.post("/{pid}/approve", response_model=ProjectOut)
async def approve_proposal(
    pid: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> ProjectOut:
    """Approve proposal proyek -> status AKTIF.

    Hanya CENTRAL_ADMIN / SUPERADMIN. Catat approved_by_id + approved_at.
    Otomatis assign pengaju sbg anggota tim proyek (kalau belum).
    """
    p = await db.get(Project, pid)
    if not p or p.deleted_at is not None:
        raise HTTPException(404, "not_found")
    if p.status != ProjectStatus.MENUNGGU_PERSETUJUAN:
        raise HTTPException(400, "proposal_not_pending")

    # PENTING: lakukan SEMUA db.execute() SEBELUM setattr supaya
    # autoflush tidak ke-trigger di tengah. Kalau autoflush trigger
    # setelah setattr, pending UPDATE Project di-flush, kolom updated_at
    # (TimestampMixin onupdate=func.now()) di-expire SQLAlchemy, dan
    # snapshot(p) berikutnya akan trigger lazy-load yg gagal di async
    # (MissingGreenlet).
    existing_pu = None
    if p.proposed_by_id:
        existing_pu = (await db.execute(
            select(ProjectUser).where(
                ProjectUser.project_id == p.id,
                ProjectUser.user_id == p.proposed_by_id,
            )
        )).scalar_one_or_none()

    before = snapshot(p)
    p.status = ProjectStatus.AKTIF
    p.approved_by_id = admin.id
    # Pakai Python datetime (BUKAN func.now()) supaya snapshot(p) di
    # bawah bisa JSON-serialize utk AuditLog.after. func.now() return SQL
    # FunctionElement object yg gagal json.dumps -> 500.
    from datetime import datetime as _dt
    p.approved_at = _dt.utcnow()
    p.rejection_reason = None
    if p.proposed_by_id and not existing_pu:
        db.add(ProjectUser(project_id=p.id, user_id=p.proposed_by_id))
    # snapshot(p) DI SINI safe -- tdk ada execute() di antara setattr & ini,
    # jadi autoflush belum trigger, updated_at masih cached.
    after_data = snapshot(p)
    await log(db, user_id=admin.id, entity="project_proposal", entity_id=p.id,
              action=AuditAction.APPROVE, before=before, after=after_data)
    await db.commit()
    p = await _load_with_company(db, p.id)
    await _attach_relations(db, [p])
    return _to_out(p)


@router.post("/{pid}/reject", response_model=ProjectOut)
async def reject_proposal(
    pid: int,
    payload: ProjectRejectIn,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> ProjectOut:
    """Tolak proposal proyek -> status DIBATALKAN + simpan rejection_reason."""
    p = await db.get(Project, pid)
    if not p or p.deleted_at is not None:
        raise HTTPException(404, "not_found")
    if p.status != ProjectStatus.MENUNGGU_PERSETUJUAN:
        raise HTTPException(400, "proposal_not_pending")
    reason = (payload.reason or "").strip()
    if not reason:
        raise HTTPException(400, "rejection_reason_required")
    before = snapshot(p)
    p.status = ProjectStatus.DIBATALKAN
    p.approved_by_id = admin.id  # siapa yg menolak
    # Pakai Python datetime (BUKAN func.now()) supaya snapshot(p) di
    # bawah bisa JSON-serialize utk AuditLog.after. func.now() return SQL
    # FunctionElement object yg gagal json.dumps -> 500.
    from datetime import datetime as _dt
    p.approved_at = _dt.utcnow()
    p.rejection_reason = reason
    await log(db, user_id=admin.id, entity="project_proposal", entity_id=p.id,
              action=AuditAction.REJECT, before=before, after=snapshot(p))
    await db.commit()
    p = await _load_with_company(db, p.id)
    await _attach_relations(db, [p])
    return _to_out(p)


@router.get("/{pid}", response_model=ProjectOut)
async def get_project(
    pid: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ProjectOut:
    p = await _load_with_company(db, pid)
    if not p or p.deleted_at is not None:
        raise HTTPException(404, "not_found")
    # Proyek MENUNGGU_PERSETUJUAN: hanya pengaju + admin (CENTRAL/SUPER) yg
    # boleh lihat detail-nya. User lain dapat 404 (pretend not found).
    if p.status == ProjectStatus.MENUNGGU_PERSETUJUAN:
        is_central = user.role in (UserRole.SUPERADMIN, UserRole.CENTRAL_ADMIN)
        is_proposer = p.proposed_by_id == user.id
        if not (is_central or is_proposer):
            raise HTTPException(404, "not_found")
    else:
        await ensure_project_access(db, user, pid)
    await _attach_relations(db, [p])
    return _to_out(p)


@router.patch("/{pid}", response_model=ProjectOut)
async def update_project(
    pid: int,
    payload: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> ProjectOut:
    p = await db.get(Project, pid)
    if not p or p.deleted_at is not None:
        raise HTTPException(404, "not_found")

    data = payload.model_dump(exclude_unset=True)

    # Code IMMUTABLE jika sudah ada aktivitas. Walau secara FK relasi pakai
    # project_id, 'code' di-embed di nomor PO (PO/YYYY/MM/{CODE}/####) dan
    # dipakai sbg lookup chat (Telegram/WhatsApp) + Excel import. Ubah code
    # akan bikin seri PO inkonsisten + putus alias chat. Block utk SEMUA
    # role (termasuk SUPERADMIN) -- escape hatch: hapus dulu semua tx/inv/PO.
    if "code" in data and data["code"] != p.code:
        from app.models.models import (
            Invoice as _Invoice,
            PurchaseOrder as _PurchaseOrder,
            Transaction as _Transaction,
        )
        tx_exists = (await db.execute(
            select(_Transaction.id).where(
                _Transaction.project_id == pid,
                _Transaction.deleted_at.is_(None),
            ).limit(1)
        )).scalar_one_or_none() is not None
        inv_exists = (await db.execute(
            select(_Invoice.id).where(
                _Invoice.project_id == pid,
                _Invoice.deleted_at.is_(None),
            ).limit(1)
        )).scalar_one_or_none() is not None
        po_exists = (await db.execute(
            select(_PurchaseOrder.id).where(
                _PurchaseOrder.project_id == pid,
                _PurchaseOrder.deleted_at.is_(None),
            ).limit(1)
        )).scalar_one_or_none() is not None
        if tx_exists or inv_exists or po_exists:
            raise HTTPException(
                400,
                "project_code_locked: kode proyek tidak bisa diubah karena "
                "sudah ada transaksi/invoice/PO terhubung. Kode di-embed di "
                "nomor PO dan dipakai sbg lookup chat -- mengubahnya akan "
                "memutus referensi historis.",
            )
        # Validasi unik kalau memang diizinkan (tidak ada activity).
        clash = (await db.execute(
            select(Project).where(Project.code == data["code"], Project.id != pid)
        )).scalar_one_or_none()
        if clash:
            raise HTTPException(409, "project_code_already_used")

    before = snapshot(p)
    # Pisahkan funder_ids (M2M) dari kolom regular project.
    funder_ids = data.pop("funder_ids", None)
    # PENTING: lakukan _replace_project_funders (yg meng-execute db query)
    # SEBELUM setattr supaya autoflush tdk meng-expire updated_at (yg
    # bikin snapshot(p) berikutnya gagal lazy-load di async = MissingGreenlet).
    if funder_ids is not None:
        await _replace_project_funders(db, p.id, funder_ids)
    for k, v in data.items():
        setattr(p, k, v)
    after_data = snapshot(p)
    await log(db, user_id=admin.id, entity="project", entity_id=p.id,
              action=AuditAction.UPDATE, before=before, after=after_data)
    await db.commit()
    p = await _load_with_company(db, p.id)
    await _attach_funder_names(db, [p])
    return _to_out(p)


@router.delete("/{pid}", status_code=204)
async def delete_project(
    pid: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> None:
    p = await db.get(Project, pid)
    if not p or p.deleted_at is not None:
        raise HTTPException(404, "not_found")
    from sqlalchemy import func as sa_func
    before = snapshot(p)
    p.deleted_at = sa_func.now()
    await log(db, user_id=admin.id, entity="project", entity_id=p.id,
              action=AuditAction.DELETE, before=before)
    await db.commit()


@router.get("/{pid}/users")
async def project_users(
    pid: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict]:
    await ensure_project_access(db, user, pid)
    res = await db.execute(
        select(User).join(ProjectUser, ProjectUser.user_id == User.id).where(
            ProjectUser.project_id == pid,
            User.deleted_at.is_(None),
        )
    )
    return [
        {"id": u.id, "email": u.email, "name": u.name, "role": u.role.value}
        for u in res.scalars().all()
    ]


# ---------- Project document attachments (kontrak, BAST, dll) ----------
# Enum value valid utk doc_type. Dipakai untuk validasi input (raise 400
# kalau client kirim value di luar daftar) dan referensi UI.
_VALID_DOC_TYPES = {t.value for t in ProjectDocType}


def _validate_doc_type(v: str | None) -> str | None:
    if v is None or v == "":
        return None
    if v not in _VALID_DOC_TYPES:
        raise HTTPException(
            400,
            f"invalid_doc_type: '{v}' tidak valid. Pilihan: "
            + ", ".join(sorted(_VALID_DOC_TYPES)),
        )
    return v


class ProjectAttachmentOut(BaseModel):
    id: int
    label: str | None = None
    doc_type: str | None = None
    file_name: str
    file_size: int
    mime_type: str
    url: str
    uploaded_by_id: int
    created_at: str

    class Config:
        from_attributes = True


def _att_to_out(a: ProjectAttachment) -> ProjectAttachmentOut:
    return ProjectAttachmentOut(
        id=a.id,
        label=a.label,
        doc_type=a.doc_type,
        file_name=a.file_name,
        file_size=a.file_size,
        mime_type=a.mime_type,
        url=a.url,
        uploaded_by_id=a.uploaded_by_id,
        created_at=a.created_at.isoformat(),
    )


@router.get("/{pid}/attachments", response_model=list[ProjectAttachmentOut])
async def list_project_attachments(
    pid: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ProjectAttachmentOut]:
    """Daftar dokumen proyek. Bisa dilihat siapa pun yang punya akses ke proyek."""
    p = await db.get(Project, pid)
    if not p or p.deleted_at is not None:
        raise HTTPException(404, "not_found")
    await ensure_project_access(db, user, pid)
    res = await db.execute(
        select(ProjectAttachment)
        .where(ProjectAttachment.project_id == pid, ProjectAttachment.deleted_at.is_(None))
        .order_by(ProjectAttachment.id.asc())
    )
    return [_att_to_out(a) for a in res.scalars().all()]


@router.post("/{pid}/attachments", response_model=ProjectAttachmentOut, status_code=201)
async def upload_project_attachment(
    pid: int,
    file: Annotated[UploadFile, File(...)],
    label: str | None = None,
    doc_type: str | None = None,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> ProjectAttachmentOut:
    """Upload dokumen proyek (kontrak, surat penunjukan, BAST, dll).
    Hanya superadmin / admin pusat yang boleh upload.

    doc_type: kategori dokumen (SPK/BAST/Faktur Pajak/dll). Opsional --
    kalau diisi, akan divalidasi terhadap ProjectDocType enum.
    """
    p = await db.get(Project, pid)
    if not p or p.deleted_at is not None:
        raise HTTPException(404, "not_found")
    doc_type = _validate_doc_type(doc_type)
    meta = await save_upload(file, subdir=f"projects/{pid}")
    att = ProjectAttachment(
        project_id=pid,
        label=(label or "").strip() or None,
        doc_type=doc_type,
        uploaded_by_id=admin.id,
        **meta,
    )
    db.add(att)
    await db.flush()
    await log(db, user_id=admin.id, entity="project_attachment", entity_id=pid,
              action=AuditAction.CREATE,
              after={"file": meta["file_name"], "label": label, "doc_type": doc_type})
    await db.commit()
    await db.refresh(att)
    return _att_to_out(att)


class _ProjectLinkIn(BaseModel):
    url: str
    label: str | None = None
    doc_type: str | None = None
    file_name: str | None = None


@router.post("/{pid}/attachments/link", response_model=ProjectAttachmentOut, status_code=201)
async def attach_project_link(
    pid: int,
    body: _ProjectLinkIn,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> ProjectAttachmentOut:
    """Lampirkan link eksternal (Google Drive, dll) sebagai dokumen proyek."""
    p = await db.get(Project, pid)
    if not p or p.deleted_at is not None:
        raise HTTPException(404, "not_found")
    doc_type = _validate_doc_type(body.doc_type)
    meta = normalize_external_link(body.url, label=body.label, file_name=body.file_name)
    att = ProjectAttachment(
        project_id=pid,
        label=(body.label or "").strip() or None,
        doc_type=doc_type,
        uploaded_by_id=admin.id,
        **meta,
    )
    db.add(att)
    await db.flush()
    await log(db, user_id=admin.id, entity="project_attachment", entity_id=pid,
              action=AuditAction.CREATE,
              after={"link": meta["file_name"], "url": meta["url"],
                     "label": body.label, "doc_type": doc_type})
    await db.commit()
    await db.refresh(att)
    return _att_to_out(att)


class _ProjectAttachmentPatch(BaseModel):
    """Patch metadata attachment (label/doc_type). File tdk diganti."""
    label: str | None = None
    doc_type: str | None = None


@router.patch("/{pid}/attachments/{aid}", response_model=ProjectAttachmentOut)
async def patch_project_attachment(
    pid: int,
    aid: int,
    body: _ProjectAttachmentPatch,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> ProjectAttachmentOut:
    """Update label/doc_type attachment yg sudah ada (utk re-kategori)."""
    att = await db.get(ProjectAttachment, aid)
    if not att or att.project_id != pid or att.deleted_at is not None:
        raise HTTPException(404, "not_found")
    if body.doc_type is not None:
        att.doc_type = _validate_doc_type(body.doc_type)
    if body.label is not None:
        att.label = body.label.strip() or None
    await log(db, user_id=admin.id, entity="project_attachment", entity_id=pid,
              action=AuditAction.UPDATE,
              after={"label": att.label, "doc_type": att.doc_type})
    await db.commit()
    await db.refresh(att)
    return _att_to_out(att)


@router.delete("/{pid}/attachments/{aid}", status_code=204)
async def delete_project_attachment(
    pid: int,
    aid: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> None:
    att = await db.get(ProjectAttachment, aid)
    if not att or att.project_id != pid or att.deleted_at is not None:
        raise HTTPException(404, "not_found")
    await db.delete(att)
    await log(db, user_id=admin.id, entity="project_attachment", entity_id=pid,
              action=AuditAction.DELETE, before={"file": att.file_name, "label": att.label})
    await db.commit()
