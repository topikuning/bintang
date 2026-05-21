"""Endpoint Pengajuan Dana Operasional (CashRequest).

Workflow:
  PENDING -> APPROVED  (auto-create tx CASH_ADVANCE DRAFT)
  PENDING -> REJECTED  (CENTRAL/SUPERADMIN)
  PENDING -> CANCELLED (requester / admin)

Setelah APPROVED, tx CASH_ADVANCE-nya berdiri sendiri di flow Transaksi
existing (verify/cancel/settle lewat endpoint /transactions). Pengajuan
ter-link via cash_requests.disbursement_tx_id.
"""
from __future__ import annotations

from datetime import date as date_type, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import (
    ensure_project_access,
    get_current_user,
    require_admin,
    require_can_write,
    user_project_ids,
)
from app.db.session import get_db
from app.models.models import (
    AuditAction,
    CashRequest,
    CashRequestItem,
    CashRequestStatus,
    Category,
    PaymentMethod,
    Project,
    Transaction,
    TxnKind,
    TxnStatus,
    TxnType,
    User,
)
from app.schemas.cash_requests import (
    CashRequestCancelIn,
    CashRequestCreate,
    CashRequestItemIn,
    CashRequestItemOut,
    CashRequestOut,
    CashRequestRejectIn,
    CashRequestUpdate,
)
from app.schemas.common import Page
from app.services.audit import log, snapshot

router = APIRouter()


# ---------- helpers ----------
async def _next_cr_number(db: AsyncSession, when: date_type) -> str:
    """Format: CR/YYYY/MM/####. Global sequential per bulan."""
    prefix = f"CR/{when.year}/{when.month:02d}/"
    res = await db.execute(
        select(func.count()).select_from(CashRequest).where(
            CashRequest.number.like(f"{prefix}%"),
        )
    )
    count = res.scalar_one() or 0
    return f"{prefix}{count + 1:04d}"


def _items_total(items: list[CashRequestItemIn]) -> Decimal:
    return sum((Decimal(it.amount) for it in items), Decimal("0"))


async def _fetch_with_relations(db: AsyncSession, cr_id: int) -> CashRequest | None:
    stmt = (
        select(CashRequest)
        .where(CashRequest.id == cr_id, CashRequest.deleted_at.is_(None))
        .options(selectinload(CashRequest.items))
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def _to_out(db: AsyncSession, cr: CashRequest) -> CashRequestOut:
    """Hydrasi nama-nama relasi utk display di FE (project_code/_name,
    requester_name, recipient_name, approver/rejecter name, category_name)."""
    # Project
    proj = await db.get(Project, cr.project_id)
    # Users
    requester = await db.get(User, cr.requester_id)
    recipient = (
        await db.get(User, cr.recipient_user_id)
        if cr.recipient_user_id else None
    )
    approver = (
        await db.get(User, cr.approved_by_id)
        if cr.approved_by_id else None
    )
    rejecter = (
        await db.get(User, cr.rejected_by_id)
        if cr.rejected_by_id else None
    )
    # Items + category names
    cat_ids = [it.category_id for it in cr.items if it.category_id]
    cat_map: dict[int, str] = {}
    if cat_ids:
        rows = (await db.execute(
            select(Category.id, Category.name).where(Category.id.in_(cat_ids))
        )).all()
        cat_map = {cid: name for cid, name in rows}
    items_out = [
        CashRequestItemOut(
            id=it.id,
            category_id=it.category_id,
            category_name=cat_map.get(it.category_id) if it.category_id else None,
            description=it.description,
            quantity=it.quantity,
            unit_price=it.unit_price,
            amount=it.amount,
        )
        for it in cr.items
    ]
    return CashRequestOut(
        id=cr.id,
        number=cr.number,
        project_id=cr.project_id,
        project_code=proj.code if proj else None,
        project_name=proj.name if proj else None,
        requester_id=cr.requester_id,
        requester_name=requester.name if requester else None,
        recipient_user_id=cr.recipient_user_id,
        recipient_name=recipient.name if recipient else None,
        request_date=cr.request_date,
        title=cr.title,
        notes=cr.notes,
        total_amount=cr.total_amount,
        status=cr.status,
        approved_by_id=cr.approved_by_id,
        approved_by_name=approver.name if approver else None,
        approved_at=cr.approved_at,
        rejected_by_id=cr.rejected_by_id,
        rejected_by_name=rejecter.name if rejecter else None,
        rejected_at=cr.rejected_at,
        rejection_reason=cr.rejection_reason,
        disbursement_tx_id=cr.disbursement_tx_id,
        items=items_out,
        created_at=cr.created_at,
        updated_at=cr.updated_at,
    )


# ---------- endpoints ----------
@router.get("", response_model=Page[CashRequestOut])
async def list_cash_requests(
    status: str | None = Query(None, description="PENDING|APPROVED|REJECTED|CANCELLED"),
    project_id: int | None = None,
    requester_id: int | None = None,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
    q: str | None = Query(None, description="Cari di number/title"),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Page[CashRequestOut]:
    stmt = select(CashRequest).where(CashRequest.deleted_at.is_(None))

    # Akses: scope ke proyek user (atau semua kalau global).
    pids = await user_project_ids(db, user)
    if pids is not None:
        if not pids:
            return Page(items=[], total=0, page=page, size=size)
        stmt = stmt.where(CashRequest.project_id.in_(pids))

    if project_id:
        await ensure_project_access(db, user, project_id)
        stmt = stmt.where(CashRequest.project_id == project_id)
    if status:
        stmt = stmt.where(CashRequest.status == status)
    if requester_id:
        stmt = stmt.where(CashRequest.requester_id == requester_id)
    if date_from:
        stmt = stmt.where(CashRequest.request_date >= date_from)
    if date_to:
        stmt = stmt.where(CashRequest.request_date <= date_to)
    if q:
        like = f"%{q}%"
        stmt = stmt.where((CashRequest.number.ilike(like)) | (CashRequest.title.ilike(like)))

    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    stmt = (
        stmt.options(selectinload(CashRequest.items))
        .order_by(CashRequest.id.desc())
        .offset((page - 1) * size)
        .limit(size)
    )
    rows = (await db.execute(stmt)).scalars().all()
    items_out = [await _to_out(db, cr) for cr in rows]
    return Page(items=items_out, total=total, page=page, size=size)


@router.post("", response_model=CashRequestOut, status_code=201)
async def create_cash_request(
    payload: CashRequestCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_can_write),
) -> CashRequestOut:
    await ensure_project_access(db, user, payload.project_id)
    # Validasi project belum soft-deleted.
    proj = await db.get(Project, payload.project_id)
    if not proj or proj.deleted_at is not None:
        raise HTTPException(404, "project_not_found")

    cr = CashRequest(
        number=await _next_cr_number(db, payload.request_date),
        project_id=payload.project_id,
        requester_id=user.id,
        recipient_user_id=payload.recipient_user_id,
        request_date=payload.request_date,
        title=payload.title.strip(),
        notes=(payload.notes or "").strip() or None,
        total_amount=_items_total(payload.items),
        status=CashRequestStatus.PENDING.value,
    )
    db.add(cr)
    await db.flush()
    for it_in in payload.items:
        db.add(CashRequestItem(
            request_id=cr.id,
            category_id=it_in.category_id,
            description=it_in.description.strip(),
            quantity=it_in.quantity,
            unit_price=it_in.unit_price,
            amount=it_in.amount,
        ))
    await db.flush()
    # Refresh kolom server-default supaya snapshot tdk lazy-load.
    await db.refresh(cr, attribute_names=[c.name for c in CashRequest.__table__.columns])
    await log(db, user_id=user.id, entity="cash_request", entity_id=cr.id,
              action=AuditAction.CREATE, after=snapshot(cr))
    await db.commit()
    cr_full = await _fetch_with_relations(db, cr.id)
    assert cr_full is not None
    return await _to_out(db, cr_full)


@router.get("/{cr_id}", response_model=CashRequestOut)
async def get_cash_request(
    cr_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> CashRequestOut:
    cr = await _fetch_with_relations(db, cr_id)
    if not cr:
        raise HTTPException(404, "not_found")
    await ensure_project_access(db, user, cr.project_id)
    return await _to_out(db, cr)


@router.patch("/{cr_id}", response_model=CashRequestOut)
async def update_cash_request(
    cr_id: int,
    payload: CashRequestUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_can_write),
) -> CashRequestOut:
    cr = await _fetch_with_relations(db, cr_id)
    if not cr:
        raise HTTPException(404, "not_found")
    # Akses proyek lama.
    await ensure_project_access(db, user, cr.project_id)
    # Hanya requester atau admin yg boleh edit.
    from app.core.deps import CENTRAL_ROLES
    if cr.requester_id != user.id and user.role not in CENTRAL_ROLES:
        raise HTTPException(403, "not_requester_or_admin")
    # Hanya PENDING yg boleh diubah -- setelah APPROVED, edit lewat tx
    # (atau cancel tx + bikin pengajuan baru).
    if cr.status != CashRequestStatus.PENDING.value:
        raise HTTPException(400, "only_pending_can_be_edited")

    data = payload.model_dump(exclude_unset=True)
    before = snapshot(cr)

    if "project_id" in data and data["project_id"] != cr.project_id:
        await ensure_project_access(db, user, data["project_id"])
        proj_new = await db.get(Project, data["project_id"])
        if not proj_new or proj_new.deleted_at is not None:
            raise HTTPException(404, "project_not_found")
    new_items = data.pop("items", None)
    for k, v in data.items():
        if k == "title" and isinstance(v, str):
            v = v.strip()
        if k == "notes" and isinstance(v, str):
            v = v.strip() or None
        setattr(cr, k, v)

    if new_items is not None:
        if not new_items:
            raise HTTPException(400, "items_cannot_be_empty")
        # Wipe & re-insert. Sederhana, hindari sync diff.
        cr.items.clear()
        await db.flush()
        items_in = [
            it_in if isinstance(it_in, CashRequestItemIn) else CashRequestItemIn(**it_in)
            for it_in in new_items
        ]
        for it_in in items_in:
            db.add(CashRequestItem(
                request_id=cr.id,
                category_id=it_in.category_id,
                description=it_in.description.strip(),
                quantity=it_in.quantity,
                unit_price=it_in.unit_price,
                amount=it_in.amount,
            ))
        cr.total_amount = _items_total(items_in)

    await db.flush()
    await log(db, user_id=user.id, entity="cash_request", entity_id=cr.id,
              action=AuditAction.UPDATE, before=before, after=snapshot(cr))
    await db.commit()
    cr_full = await _fetch_with_relations(db, cr.id)
    assert cr_full is not None
    return await _to_out(db, cr_full)


@router.delete("/{cr_id}", status_code=204)
async def delete_cash_request(
    cr_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_can_write),
) -> None:
    cr = await _fetch_with_relations(db, cr_id)
    if not cr:
        raise HTTPException(404, "not_found")
    await ensure_project_access(db, user, cr.project_id)
    from app.core.deps import CENTRAL_ROLES
    if cr.requester_id != user.id and user.role not in CENTRAL_ROLES:
        raise HTTPException(403, "not_requester_or_admin")
    # Hanya PENDING. APPROVED -> harus cancel dulu (yg juga akan
    # cancel tx terkait); REJECTED/CANCELLED -> historis, simpan.
    if cr.status != CashRequestStatus.PENDING.value:
        raise HTTPException(400, "only_pending_can_be_deleted")
    before = snapshot(cr)
    cr.deleted_at = datetime.utcnow()
    await log(db, user_id=user.id, entity="cash_request", entity_id=cr.id,
              action=AuditAction.DELETE, before=before)
    await db.commit()


# ---------- Approve / Reject / Cancel ----------
@router.post("/{cr_id}/approve", response_model=CashRequestOut)
async def approve_cash_request(
    cr_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> CashRequestOut:
    """CENTRAL/SUPERADMIN approve. Otomatis bikin tx CASH_ADVANCE DRAFT."""
    cr = await _fetch_with_relations(db, cr_id)
    if not cr:
        raise HTTPException(404, "not_found")
    if cr.status != CashRequestStatus.PENDING.value:
        raise HTTPException(400, "only_pending_can_be_approved")
    if not cr.items:
        raise HTTPException(400, "no_items")
    proj = await db.get(Project, cr.project_id)
    if not proj or proj.deleted_at is not None:
        raise HTTPException(400, "project_unavailable")

    before = snapshot(cr)

    # Auto-create tx CASH_ADVANCE DRAFT. Recipient = recipient_user_id
    # kalau ada, else requester.
    recipient_id = cr.recipient_user_id or cr.requester_id
    recipient = await db.get(User, recipient_id)
    tx = Transaction(
        project_id=cr.project_id,
        tx_date=cr.request_date,
        type=TxnType.OUT,
        kind=TxnKind.CASH_ADVANCE.value,
        amount=cr.total_amount,
        description=f"[Pengajuan {cr.number}] {cr.title}",
        usage_note=cr.notes,
        recipient_user_id=recipient_id,
        recipient_name=recipient.name if recipient else None,
        payment_method=PaymentMethod.TRANSFER,
        status=TxnStatus.DRAFT,
        created_by_id=admin.id,
    )
    db.add(tx)
    await db.flush()

    cr.status = CashRequestStatus.APPROVED.value
    cr.approved_by_id = admin.id
    cr.approved_at = datetime.utcnow()
    cr.disbursement_tx_id = tx.id

    await db.flush()
    await log(db, user_id=admin.id, entity="cash_request", entity_id=cr.id,
              action=AuditAction.UPDATE, before=before, after=snapshot(cr))
    await db.commit()
    cr_full = await _fetch_with_relations(db, cr.id)
    assert cr_full is not None
    return await _to_out(db, cr_full)


@router.post("/{cr_id}/reject", response_model=CashRequestOut)
async def reject_cash_request(
    cr_id: int,
    payload: CashRequestRejectIn,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> CashRequestOut:
    cr = await _fetch_with_relations(db, cr_id)
    if not cr:
        raise HTTPException(404, "not_found")
    if cr.status != CashRequestStatus.PENDING.value:
        raise HTTPException(400, "only_pending_can_be_rejected")
    before = snapshot(cr)
    cr.status = CashRequestStatus.REJECTED.value
    cr.rejected_by_id = admin.id
    cr.rejected_at = datetime.utcnow()
    cr.rejection_reason = payload.reason.strip()
    await db.flush()
    await log(db, user_id=admin.id, entity="cash_request", entity_id=cr.id,
              action=AuditAction.UPDATE, before=before, after=snapshot(cr))
    await db.commit()
    cr_full = await _fetch_with_relations(db, cr.id)
    assert cr_full is not None
    return await _to_out(db, cr_full)


@router.post("/{cr_id}/cancel", response_model=CashRequestOut)
async def cancel_cash_request(
    cr_id: int,
    payload: CashRequestCancelIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_can_write),
) -> CashRequestOut:
    """Requester membatalkan sendiri sebelum di-approve. Admin juga boleh."""
    cr = await _fetch_with_relations(db, cr_id)
    if not cr:
        raise HTTPException(404, "not_found")
    from app.core.deps import CENTRAL_ROLES
    if cr.requester_id != user.id and user.role not in CENTRAL_ROLES:
        raise HTTPException(403, "not_requester_or_admin")
    if cr.status != CashRequestStatus.PENDING.value:
        raise HTTPException(400, "only_pending_can_be_cancelled")
    before = snapshot(cr)
    cr.status = CashRequestStatus.CANCELLED.value
    # Re-use rejection_reason field utk alasan cancel (kalau ada).
    if payload.reason:
        cr.rejection_reason = payload.reason.strip()
    await db.flush()
    await log(db, user_id=user.id, entity="cash_request", entity_id=cr.id,
              action=AuditAction.UPDATE, before=before, after=snapshot(cr))
    await db.commit()
    cr_full = await _fetch_with_relations(db, cr.id)
    assert cr_full is not None
    return await _to_out(db, cr_full)
