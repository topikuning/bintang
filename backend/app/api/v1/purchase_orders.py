from datetime import date as date_type, datetime, timezone
from decimal import Decimal
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import (
    ensure_project_access,
    get_current_user,
    require_admin,
    require_can_write,
    require_superadmin,
    user_project_ids,
)
from app.db.session import get_db
from app.models.models import (
    AuditAction,
    Company,
    POItem,
    POStatus,
    Project,
    PurchaseOrder,
    User,
    UserRole,
    VendorClient,
)
from app.schemas.common import Page
from app.schemas.finance import CancelIn, POCreate, POOut, POUpdate
from app.services.audit import log, snapshot
from app.services.pdf.render import html_to_pdf, render_html

router = APIRouter()


def _compute_totals(items: list[POItem], tax: Decimal, discount: Decimal) -> tuple[Decimal, Decimal]:
    subtotal = sum((Decimal(it.unit_price) * Decimal(it.quantity) for it in items), Decimal("0"))
    for it in items:
        it.subtotal = Decimal(it.unit_price) * Decimal(it.quantity)
    total = subtotal + Decimal(tax or 0) - Decimal(discount or 0)
    return subtotal, total


async def _next_po_number(db: AsyncSession, company_id: int, project_code: str, when: date_type) -> str:
    prefix = f"PO/{when.year}/{when.month:02d}/{project_code.upper()}/"
    res = await db.execute(
        select(func.count()).select_from(PurchaseOrder).where(
            PurchaseOrder.company_id == company_id,
            PurchaseOrder.number.like(f"{prefix}%"),
        )
    )
    count = res.scalar_one() or 0
    return f"{prefix}{count + 1:04d}"


def _to_out(po: PurchaseOrder) -> POOut:
    return POOut.model_validate(po)


@router.get("", response_model=Page[POOut])
async def list_pos(
    project_id: int | None = None,
    status: POStatus | None = None,
    company_id: int | None = None,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
    q: str | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Page[POOut]:
    stmt = select(PurchaseOrder).where(PurchaseOrder.deleted_at.is_(None))
    if user.role not in (UserRole.SUPERADMIN, UserRole.CENTRAL_ADMIN):
        ids = await user_project_ids(db, user)
        if not ids:
            return Page(items=[], total=0, page=page, size=size)
        stmt = stmt.where(PurchaseOrder.project_id.in_(ids))
    if project_id:
        await ensure_project_access(db, user, project_id)
        stmt = stmt.where(PurchaseOrder.project_id == project_id)
    if company_id:
        stmt = stmt.where(PurchaseOrder.company_id == company_id)
    if status:
        stmt = stmt.where(PurchaseOrder.status == status)
    if date_from:
        stmt = stmt.where(PurchaseOrder.po_date >= date_from)
    if date_to:
        stmt = stmt.where(PurchaseOrder.po_date <= date_to)
    if q:
        like = f"%{q}%"
        stmt = stmt.where((PurchaseOrder.number.ilike(like)) | (PurchaseOrder.vendor_name.ilike(like)))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    stmt = (
        stmt.options(selectinload(PurchaseOrder.items))
        .order_by(PurchaseOrder.id.desc())
        .offset((page - 1) * size)
        .limit(size)
    )
    items = (await db.execute(stmt)).scalars().all()
    return Page(items=[_to_out(p) for p in items], total=total, page=page, size=size)


@router.post("", response_model=POOut, status_code=201)
async def create_po(
    payload: POCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_can_write),
) -> POOut:
    await ensure_project_access(db, user, payload.project_id)
    project = await db.get(Project, payload.project_id)
    if not project:
        raise HTTPException(404, "project_not_found")
    company = await db.get(Company, payload.company_id)
    if not company:
        raise HTTPException(404, "company_not_found")

    number = await _next_po_number(db, company.id, project.code, payload.po_date)
    po = PurchaseOrder(
        number=number,
        project_id=payload.project_id,
        company_id=payload.company_id,
        vendor_client_id=payload.vendor_client_id,
        vendor_name=payload.vendor_name,
        po_date=payload.po_date,
        needed_date=payload.needed_date,
        tax=payload.tax,
        discount=payload.discount,
        payment_terms=payload.payment_terms,
        notes=payload.notes,
        status=POStatus.DRAFT,
        created_by_id=user.id,
    )
    for it in payload.items:
        po.items.append(POItem(
            description=it.description,
            quantity=it.quantity,
            unit=it.unit,
            unit_price=it.unit_price,
            subtotal=Decimal(it.unit_price) * Decimal(it.quantity),
        ))
    subtotal, total = _compute_totals(po.items, po.tax, po.discount)
    po.subtotal = subtotal
    po.total = total

    db.add(po)
    await db.flush()
    await log(db, user_id=user.id, entity="purchase_order", entity_id=po.id,
              action=AuditAction.CREATE, after=snapshot(po))
    await db.commit()
    res = await db.execute(
        select(PurchaseOrder).options(selectinload(PurchaseOrder.items)).where(PurchaseOrder.id == po.id)
    )
    return _to_out(res.scalar_one())


@router.get("/{pid}", response_model=POOut)
async def get_po(
    pid: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> POOut:
    res = await db.execute(
        select(PurchaseOrder).options(selectinload(PurchaseOrder.items)).where(PurchaseOrder.id == pid)
    )
    po = res.scalar_one_or_none()
    if not po or po.deleted_at is not None:
        raise HTTPException(404, "not_found")
    await ensure_project_access(db, user, po.project_id)
    return _to_out(po)


@router.patch("/{pid}", response_model=POOut)
async def update_po(
    pid: int,
    payload: POUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_can_write),
) -> POOut:
    res = await db.execute(
        select(PurchaseOrder).options(selectinload(PurchaseOrder.items)).where(PurchaseOrder.id == pid)
    )
    po = res.scalar_one_or_none()
    if not po or po.deleted_at is not None:
        raise HTTPException(404, "not_found")
    await ensure_project_access(db, user, po.project_id)
    if po.status not in (POStatus.DRAFT,) and user.role not in (UserRole.SUPERADMIN, UserRole.CENTRAL_ADMIN):
        raise HTTPException(409, "approved_locked")
    before = snapshot(po)
    data = payload.model_dump(exclude_unset=True)
    items = data.pop("items", None)
    for k, v in data.items():
        setattr(po, k, v)
    if items is not None:
        po.items.clear()
        await db.flush()
        for it in items:
            po.items.append(POItem(
                description=it["description"],
                quantity=it.get("quantity", 1),
                unit=it.get("unit"),
                unit_price=it.get("unit_price", 0),
                subtotal=Decimal(it.get("unit_price", 0)) * Decimal(it.get("quantity", 1)),
            ))
    subtotal, total = _compute_totals(po.items, po.tax, po.discount)
    po.subtotal = subtotal
    po.total = total
    await log(db, user_id=user.id, entity="purchase_order", entity_id=po.id,
              action=AuditAction.UPDATE, before=before, after=snapshot(po))
    await db.commit()
    res = await db.execute(
        select(PurchaseOrder).options(selectinload(PurchaseOrder.items)).where(PurchaseOrder.id == po.id)
    )
    return _to_out(res.scalar_one())


@router.post("/{pid}/issue", response_model=POOut)
async def issue_po(
    pid: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_can_write),
) -> POOut:
    po = await db.get(PurchaseOrder, pid)
    if not po or po.deleted_at is not None:
        raise HTTPException(404, "not_found")
    await ensure_project_access(db, user, po.project_id)
    if po.status != POStatus.DRAFT:
        raise HTTPException(409, "invalid_state")
    po.status = POStatus.ISSUED
    await log(db, user_id=user.id, entity="purchase_order", entity_id=po.id,
              action=AuditAction.UPDATE, note="issued")
    await db.commit()
    res = await db.execute(
        select(PurchaseOrder).options(selectinload(PurchaseOrder.items)).where(PurchaseOrder.id == po.id)
    )
    return _to_out(res.scalar_one())


@router.post("/{pid}/approve", response_model=POOut)
async def approve_po(
    pid: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> POOut:
    po = await db.get(PurchaseOrder, pid)
    if not po or po.deleted_at is not None:
        raise HTTPException(404, "not_found")
    if po.status not in (POStatus.DRAFT, POStatus.ISSUED):
        raise HTTPException(409, "invalid_state")
    po.status = POStatus.APPROVED
    po.approved_by_id = admin.id
    po.approved_at = datetime.now(timezone.utc)
    await log(db, user_id=admin.id, entity="purchase_order", entity_id=po.id,
              action=AuditAction.APPROVE)
    await db.commit()
    res = await db.execute(
        select(PurchaseOrder).options(selectinload(PurchaseOrder.items)).where(PurchaseOrder.id == po.id)
    )
    return _to_out(res.scalar_one())


@router.post("/{pid}/cancel", response_model=POOut)
async def cancel_po(
    pid: int,
    body: CancelIn,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> POOut:
    po = await db.get(PurchaseOrder, pid)
    if not po or po.deleted_at is not None:
        raise HTTPException(404, "not_found")
    po.status = POStatus.CANCELLED
    po.cancel_reason = body.reason
    await log(db, user_id=admin.id, entity="purchase_order", entity_id=po.id,
              action=AuditAction.CANCEL, note=body.reason)
    await db.commit()
    res = await db.execute(
        select(PurchaseOrder).options(selectinload(PurchaseOrder.items)).where(PurchaseOrder.id == po.id)
    )
    return _to_out(res.scalar_one())


@router.delete("/{pid}", status_code=204)
async def delete_po(
    pid: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> None:
    po = await db.get(PurchaseOrder, pid)
    if not po or po.deleted_at is not None:
        raise HTTPException(404, "not_found")
    if po.status not in (POStatus.DRAFT, POStatus.CANCELLED):
        raise HTTPException(409, "approved_must_be_cancelled")
    from sqlalchemy import func as sa_func
    po.deleted_at = sa_func.now()
    await log(db, user_id=admin.id, entity="purchase_order", entity_id=po.id,
              action=AuditAction.DELETE)
    await db.commit()


@router.get("/{pid}/pdf")
async def po_pdf(
    pid: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    res = await db.execute(
        select(PurchaseOrder).options(selectinload(PurchaseOrder.items)).where(PurchaseOrder.id == pid)
    )
    po = res.scalar_one_or_none()
    if not po or po.deleted_at is not None:
        raise HTTPException(404, "not_found")
    await ensure_project_access(db, user, po.project_id)
    project = await db.get(Project, po.project_id)
    company = await db.get(Company, po.company_id)
    vendor = await db.get(VendorClient, po.vendor_client_id) if po.vendor_client_id else None
    created_by = await db.get(User, po.created_by_id) if po.created_by_id else None
    approved_by = await db.get(User, po.approved_by_id) if po.approved_by_id else None
    base_css = (Path(__file__).parent.parent.parent / "services/pdf/templates/_base.css").read_text(encoding="utf-8")
    html = render_html(
        "po.html",
        po=po, project=project, company=company,
        vendor=vendor, created_by=created_by, approved_by=approved_by,
        base_css=base_css,
    )
    pdf = html_to_pdf(html)
    return Response(
        pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{po.number.replace("/", "-")}.pdf"'},
    )
