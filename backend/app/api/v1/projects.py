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
    Project,
    ProjectAttachment,
    ProjectUser,
    User,
    UserRole,
)
from app.schemas.common import Page
from app.schemas.refs import ProjectCreate, ProjectOut, ProjectUpdate
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
    """Serialize Project + isi company_name dari relasi (perlu sudah eager-loaded)."""
    out = ProjectOut.model_validate(p)
    out.company_name = p.company.name if getattr(p, "company", None) else None
    return out


@router.get("", response_model=Page[ProjectOut])
async def list_projects(
    q: str | None = None,
    status: str | None = None,
    company_id: int | None = None,
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
    if company_id:
        stmt = stmt.where(Project.company_id == company_id)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    stmt = (
        stmt.options(selectinload(Project.company))
        .order_by(Project.id.desc())
        .offset((page - 1) * size)
        .limit(size)
    )
    items = (await db.execute(stmt)).scalars().all()
    return Page(items=[_to_out(p) for p in items], total=total, page=page, size=size)


@router.get("/stats")
async def list_projects_with_stats(
    q: str | None = None,
    status: str | None = None,
    company_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict]:
    """List proyek lengkap dengan agregat keuangan (untuk halaman Proyek
    yang kaya kartu). Hormat scoping user."""
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
    if company_id:
        stmt = stmt.where(Project.company_id == company_id)
    stmt = stmt.order_by(Project.id.desc())
    projects = (await db.execute(stmt)).scalars().all()

    # company map
    cmap_q = select(_Company)
    cmap = {c.id: c for c in (await db.execute(cmap_q)).scalars().all()}

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
        })
    return out


async def _load_with_company(db: AsyncSession, pid: int) -> Project | None:
    res = await db.execute(
        select(Project).options(selectinload(Project.company)).where(Project.id == pid)
    )
    return res.scalar_one_or_none()


@router.post("", response_model=ProjectOut, status_code=201)
async def create_project(
    payload: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> ProjectOut:
    exists = (await db.execute(select(Project).where(Project.code == payload.code))).scalar_one_or_none()
    if exists:
        raise HTTPException(409, "project_code_already_used")
    p = Project(**payload.model_dump())
    db.add(p)
    await db.flush()
    if p.pic_user_id:
        db.add(ProjectUser(project_id=p.id, user_id=p.pic_user_id))
    await log(db, user_id=admin.id, entity="project", entity_id=p.id,
              action=AuditAction.CREATE, after=snapshot(p))
    await db.commit()
    p = await _load_with_company(db, p.id)
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
    await ensure_project_access(db, user, pid)
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
    before = snapshot(p)
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(p, k, v)
    await log(db, user_id=admin.id, entity="project", entity_id=p.id,
              action=AuditAction.UPDATE, before=before, after=snapshot(p))
    await db.commit()
    p = await _load_with_company(db, p.id)
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
class ProjectAttachmentOut(BaseModel):
    id: int
    label: str | None = None
    file_name: str
    file_size: int
    mime_type: str
    url: str
    uploaded_by_id: int
    created_at: str

    class Config:
        from_attributes = True


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
    return [
        ProjectAttachmentOut(
            id=a.id, label=a.label, file_name=a.file_name, file_size=a.file_size,
            mime_type=a.mime_type, url=a.url, uploaded_by_id=a.uploaded_by_id,
            created_at=a.created_at.isoformat(),
        )
        for a in res.scalars().all()
    ]


@router.post("/{pid}/attachments", response_model=ProjectAttachmentOut, status_code=201)
async def upload_project_attachment(
    pid: int,
    file: Annotated[UploadFile, File(...)],
    label: str | None = None,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> ProjectAttachmentOut:
    """Upload dokumen proyek (kontrak, surat penunjukan, BAST, dll).
    Hanya superadmin / admin pusat yang boleh upload."""
    p = await db.get(Project, pid)
    if not p or p.deleted_at is not None:
        raise HTTPException(404, "not_found")
    meta = await save_upload(file, subdir=f"projects/{pid}")
    att = ProjectAttachment(
        project_id=pid,
        label=(label or "").strip() or None,
        uploaded_by_id=admin.id,
        **meta,
    )
    db.add(att)
    await db.flush()
    await log(db, user_id=admin.id, entity="project_attachment", entity_id=pid,
              action=AuditAction.CREATE, after={"file": meta["file_name"], "label": label})
    await db.commit()
    await db.refresh(att)
    return ProjectAttachmentOut(
        id=att.id, label=att.label, file_name=att.file_name, file_size=att.file_size,
        mime_type=att.mime_type, url=att.url, uploaded_by_id=att.uploaded_by_id,
        created_at=att.created_at.isoformat(),
    )


class _ProjectLinkIn(BaseModel):
    url: str
    label: str | None = None
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
    meta = normalize_external_link(body.url, label=body.label, file_name=body.file_name)
    att = ProjectAttachment(
        project_id=pid,
        label=(body.label or "").strip() or None,
        uploaded_by_id=admin.id,
        **meta,
    )
    db.add(att)
    await db.flush()
    await log(db, user_id=admin.id, entity="project_attachment", entity_id=pid,
              action=AuditAction.CREATE,
              after={"link": meta["file_name"], "url": meta["url"], "label": body.label})
    await db.commit()
    await db.refresh(att)
    return ProjectAttachmentOut(
        id=att.id, label=att.label, file_name=att.file_name, file_size=att.file_size,
        mime_type=att.mime_type, url=att.url, uploaded_by_id=att.uploaded_by_id,
        created_at=att.created_at.isoformat(),
    )


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
