from datetime import date as date_type, datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
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
    Invoice,
    Transaction,
    TransactionAttachment,
    TxnStatus,
    TxnType,
    User,
    UserRole,
)
from app.schemas.common import Page
from app.schemas.finance import (
    AttachmentOut,
    CancelIn,
    ExternalLinkIn,
    TransactionCreate,
    TransactionOut,
    TransactionUpdate,
)
from app.services.audit import log, snapshot
from app.services.invoice_status import recompute_invoice_status
from app.services.storage.links import normalize_external_link
from app.services.storage.local import save_upload

router = APIRouter()


def _serialize(t: Transaction) -> TransactionOut:
    out = TransactionOut.model_validate(t)
    out.attachments = [AttachmentOut.model_validate(a) for a in t.attachments]
    return out


@router.get("", response_model=Page[TransactionOut])
async def list_transactions(
    project_id: int | None = None,
    type: TxnType | None = None,
    status: TxnStatus | None = None,
    category_id: int | None = None,
    vendor_client_id: int | None = None,
    invoice_id: int | None = None,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
    q: str | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=2000),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Page[TransactionOut]:
    stmt = select(Transaction).where(Transaction.deleted_at.is_(None))
    pids = await user_project_ids(db, user)
    if pids is not None:
        if not pids:
            return Page(items=[], total=0, page=page, size=size)
        stmt = stmt.where(Transaction.project_id.in_(pids))
    if project_id:
        await ensure_project_access(db, user, project_id)
        stmt = stmt.where(Transaction.project_id == project_id)
    if type:
        stmt = stmt.where(Transaction.type == type)
    if status:
        stmt = stmt.where(Transaction.status == status)
    if category_id:
        stmt = stmt.where(Transaction.category_id == category_id)
    if vendor_client_id:
        stmt = stmt.where(Transaction.vendor_client_id == vendor_client_id)
    if invoice_id:
        stmt = stmt.where(Transaction.invoice_id == invoice_id)
    if date_from:
        stmt = stmt.where(Transaction.tx_date >= date_from)
    if date_to:
        stmt = stmt.where(Transaction.tx_date <= date_to)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            (Transaction.description.ilike(like))
            | (Transaction.party_name.ilike(like))
            | (Transaction.reference_no.ilike(like))
        )
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    stmt = (
        stmt.options(selectinload(Transaction.attachments))
        .order_by(Transaction.tx_date.desc(), Transaction.id.desc())
        .offset((page - 1) * size)
        .limit(size)
    )
    items = (await db.execute(stmt)).scalars().all()
    return Page(items=[_serialize(t) for t in items], total=total, page=page, size=size)


@router.post("", response_model=TransactionOut, status_code=201)
async def create_transaction(
    payload: TransactionCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_can_write),
) -> TransactionOut:
    await ensure_project_access(db, user, payload.project_id)
    t = Transaction(**payload.model_dump(), status=TxnStatus.DRAFT, created_by_id=user.id)
    db.add(t)
    await db.flush()
    if t.invoice_id:
        inv = await db.get(Invoice, t.invoice_id)
        if inv:
            await recompute_invoice_status(db, inv)
    await log(db, user_id=user.id, entity="transaction", entity_id=t.id,
              action=AuditAction.CREATE, after=snapshot(t))
    await db.commit()
    res = await db.execute(
        select(Transaction).options(selectinload(Transaction.attachments)).where(Transaction.id == t.id)
    )
    return _serialize(res.scalar_one())


@router.get("/{tid}", response_model=TransactionOut)
async def get_transaction(
    tid: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TransactionOut:
    res = await db.execute(
        select(Transaction).options(selectinload(Transaction.attachments)).where(Transaction.id == tid)
    )
    t = res.scalar_one_or_none()
    if not t or t.deleted_at is not None:
        raise HTTPException(404, "not_found")
    await ensure_project_access(db, user, t.project_id)
    return _serialize(t)


@router.patch("/{tid}", response_model=TransactionOut)
async def update_transaction(
    tid: int,
    payload: TransactionUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_can_write),
) -> TransactionOut:
    t = await db.get(Transaction, tid)
    if not t or t.deleted_at is not None:
        raise HTTPException(404, "not_found")
    await ensure_project_access(db, user, t.project_id)
    if t.status == TxnStatus.VERIFIED and user.role not in (UserRole.SUPERADMIN, UserRole.CENTRAL_ADMIN):
        raise HTTPException(409, "verified_locked")
    before = snapshot(t)
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(t, k, v)
    if t.invoice_id:
        inv = await db.get(Invoice, t.invoice_id)
        if inv:
            await recompute_invoice_status(db, inv)
    await log(db, user_id=user.id, entity="transaction", entity_id=t.id,
              action=AuditAction.UPDATE, before=before, after=snapshot(t))
    await db.commit()
    res = await db.execute(
        select(Transaction).options(selectinload(Transaction.attachments)).where(Transaction.id == t.id)
    )
    return _serialize(res.scalar_one())


@router.post("/{tid}/submit", response_model=TransactionOut)
async def submit_transaction(
    tid: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_can_write),
) -> TransactionOut:
    t = await db.get(Transaction, tid)
    if not t or t.deleted_at is not None:
        raise HTTPException(404, "not_found")
    await ensure_project_access(db, user, t.project_id)
    if t.status not in (TxnStatus.DRAFT, TxnStatus.REJECTED):
        raise HTTPException(409, "invalid_state")
    before = snapshot(t)
    t.status = TxnStatus.SUBMITTED
    await log(db, user_id=user.id, entity="transaction", entity_id=t.id,
              action=AuditAction.UPDATE, before=before, after=snapshot(t),
              note="submitted")
    await db.commit()
    res = await db.execute(
        select(Transaction).options(selectinload(Transaction.attachments)).where(Transaction.id == t.id)
    )
    return _serialize(res.scalar_one())


@router.post("/{tid}/verify", response_model=TransactionOut)
async def verify_transaction(
    tid: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> TransactionOut:
    t = await db.get(Transaction, tid)
    if not t or t.deleted_at is not None:
        raise HTTPException(404, "not_found")
    if t.status not in (TxnStatus.SUBMITTED, TxnStatus.DRAFT):
        raise HTTPException(409, "invalid_state")
    before = snapshot(t)
    t.status = TxnStatus.VERIFIED
    t.verified_by_id = admin.id
    t.verified_at = datetime.now(timezone.utc)
    if t.invoice_id:
        inv = await db.get(Invoice, t.invoice_id)
        if inv:
            await recompute_invoice_status(db, inv)
    await log(db, user_id=admin.id, entity="transaction", entity_id=t.id,
              action=AuditAction.VERIFY, before=before, after=snapshot(t))
    await db.commit()
    res = await db.execute(
        select(Transaction).options(selectinload(Transaction.attachments)).where(Transaction.id == t.id)
    )
    return _serialize(res.scalar_one())


@router.post("/{tid}/reject", response_model=TransactionOut)
async def reject_transaction(
    tid: int,
    body: CancelIn,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> TransactionOut:
    t = await db.get(Transaction, tid)
    if not t or t.deleted_at is not None:
        raise HTTPException(404, "not_found")
    if t.status != TxnStatus.SUBMITTED:
        raise HTTPException(409, "invalid_state")
    before = snapshot(t)
    t.status = TxnStatus.REJECTED
    t.cancel_reason = body.reason
    await log(db, user_id=admin.id, entity="transaction", entity_id=t.id,
              action=AuditAction.UPDATE, before=before, after=snapshot(t), note="rejected")
    await db.commit()
    res = await db.execute(
        select(Transaction).options(selectinload(Transaction.attachments)).where(Transaction.id == t.id)
    )
    return _serialize(res.scalar_one())


@router.post("/{tid}/cancel", response_model=TransactionOut)
async def cancel_transaction(
    tid: int,
    body: CancelIn,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> TransactionOut:
    t = await db.get(Transaction, tid)
    if not t or t.deleted_at is not None:
        raise HTTPException(404, "not_found")
    before = snapshot(t)
    t.status = TxnStatus.CANCELLED
    t.cancel_reason = body.reason
    if t.invoice_id:
        inv = await db.get(Invoice, t.invoice_id)
        if inv:
            await recompute_invoice_status(db, inv)
    await log(db, user_id=admin.id, entity="transaction", entity_id=t.id,
              action=AuditAction.CANCEL, before=before, after=snapshot(t), note=body.reason)
    await db.commit()
    res = await db.execute(
        select(Transaction).options(selectinload(Transaction.attachments)).where(Transaction.id == t.id)
    )
    return _serialize(res.scalar_one())


@router.delete("/{tid}", status_code=204)
async def delete_transaction(
    tid: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> None:
    t = await db.get(Transaction, tid)
    if not t or t.deleted_at is not None:
        raise HTTPException(404, "not_found")
    if t.status == TxnStatus.VERIFIED:
        raise HTTPException(409, "verified_must_be_cancelled")
    from sqlalchemy import func as sa_func
    before = snapshot(t)
    t.deleted_at = sa_func.now()
    await log(db, user_id=admin.id, entity="transaction", entity_id=t.id,
              action=AuditAction.DELETE, before=before)
    await db.commit()


@router.delete("/{tid}/hard", status_code=204)
async def hard_delete_transaction(
    tid: int,
    db: AsyncSession = Depends(get_db),
    god: User = Depends(require_superadmin),
) -> None:
    """GOD-MODE: hapus permanen transaksi + lampiran. Bypass status apa pun.
    Cuma SUPERADMIN."""
    t = await db.get(Transaction, tid)
    if not t:
        raise HTTPException(404, "not_found")
    before = snapshot(t)
    inv_id = t.invoice_id
    await db.delete(t)  # cascade attachments via cascade="all,delete-orphan"
    await log(db, user_id=god.id, entity="transaction", entity_id=tid,
              action=AuditAction.DELETE, before=before, note="HARD DELETE (god-mode)")
    if inv_id:
        inv = await db.get(Invoice, inv_id)
        if inv:
            await recompute_invoice_status(db, inv)
    await db.commit()


@router.post("/{tid}/attachments", response_model=AttachmentOut, status_code=201)
async def upload_attachment(
    tid: int,
    file: Annotated[UploadFile, File(...)],
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_can_write),
) -> AttachmentOut:
    t = await db.get(Transaction, tid)
    if not t or t.deleted_at is not None:
        raise HTTPException(404, "not_found")
    await ensure_project_access(db, user, t.project_id)
    if t.status == TxnStatus.VERIFIED and user.role not in (UserRole.SUPERADMIN, UserRole.CENTRAL_ADMIN):
        raise HTTPException(409, "verified_locked")
    meta = await save_upload(file, subdir=f"transactions/{t.id}")
    att = TransactionAttachment(transaction_id=t.id, uploaded_by_id=user.id, **meta)
    db.add(att)
    await log(db, user_id=user.id, entity="transaction_attachment", entity_id=t.id,
              action=AuditAction.CREATE, after={"file": meta["file_name"], "url": meta["url"]})
    await db.commit()
    await db.refresh(att)
    return AttachmentOut.model_validate(att)


@router.post("/{tid}/attachments/link", response_model=AttachmentOut, status_code=201)
async def attach_external_link(
    tid: int,
    body: ExternalLinkIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_can_write),
) -> AttachmentOut:
    """Lampirkan link eksternal (Google Drive, Dropbox, dll) sebagai bukti."""
    t = await db.get(Transaction, tid)
    if not t or t.deleted_at is not None:
        raise HTTPException(404, "not_found")
    await ensure_project_access(db, user, t.project_id)
    if t.status == TxnStatus.VERIFIED and user.role not in (UserRole.SUPERADMIN, UserRole.CENTRAL_ADMIN):
        raise HTTPException(409, "verified_locked")
    meta = normalize_external_link(body.url, label=body.label, file_name=body.file_name)
    att = TransactionAttachment(transaction_id=t.id, uploaded_by_id=user.id, **meta)
    db.add(att)
    await log(db, user_id=user.id, entity="transaction_attachment", entity_id=t.id,
              action=AuditAction.CREATE, after={"link": meta["file_name"], "url": meta["url"]})
    await db.commit()
    await db.refresh(att)
    return AttachmentOut.model_validate(att)


@router.delete("/{tid}/attachments/{aid}", status_code=204)
async def delete_attachment(
    tid: int, aid: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_can_write),
) -> None:
    t = await db.get(Transaction, tid)
    if not t or t.deleted_at is not None:
        raise HTTPException(404, "not_found")
    await ensure_project_access(db, user, t.project_id)
    if t.status == TxnStatus.VERIFIED and user.role not in (UserRole.SUPERADMIN, UserRole.CENTRAL_ADMIN):
        raise HTTPException(409, "verified_locked")
    att = await db.get(TransactionAttachment, aid)
    if not att or att.transaction_id != tid:
        raise HTTPException(404, "not_found")
    await db.delete(att)
    await log(db, user_id=user.id, entity="transaction_attachment", entity_id=tid,
              action=AuditAction.DELETE, before={"file": att.file_name})
    await db.commit()
