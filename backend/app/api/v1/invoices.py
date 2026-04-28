from datetime import date, date as date_type
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import func, select
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
    Invoice,
    InvoiceAttachment,
    InvoiceItem,
    InvoiceStatus,
    InvoiceType,
    PaymentMethod,
    Transaction,
    TxnStatus,
    TxnType,
    User,
    UserRole,
)
from app.schemas.common import Page
from app.schemas.finance import (
    AttachmentOut,
    InvoiceCreate,
    InvoiceItemIn,
    InvoiceItemOut,
    InvoiceOut,
    InvoicePayment,
    InvoiceUpdate,
)
from app.services.audit import log, snapshot
from app.services.invoice_status import linked_amount, paid_amount, recompute_invoice_status
from app.services.storage.local import save_upload

router = APIRouter()


def _compute_totals(items: list[InvoiceItem], tax: Decimal) -> tuple[Decimal, Decimal]:
    subtotal = Decimal("0")
    for it in items:
        it.subtotal = Decimal(it.unit_price) * Decimal(it.quantity)
        subtotal += it.subtotal
    total = subtotal + Decimal(tax or 0)
    return subtotal, total


async def _to_out(db: AsyncSession, inv: Invoice) -> InvoiceOut:
    paid = await paid_amount(db, inv.id)
    out = InvoiceOut.model_validate(inv)
    out.attachments = [AttachmentOut.model_validate(a) for a in inv.attachments]
    out.items = [InvoiceItemOut.model_validate(it) for it in inv.items]
    out.paid_amount = paid
    out.remaining = max(Decimal(inv.total or 0) - paid, Decimal("0"))

    pq = (
        select(Transaction)
        .where(
            Transaction.invoice_id == inv.id,
            Transaction.deleted_at.is_(None),
        )
        .order_by(Transaction.tx_date.asc(), Transaction.id.asc())
    )
    pay_rows = (await db.execute(pq)).scalars().all()
    out.payments = [InvoicePayment.model_validate(t) for t in pay_rows]
    return out


def _full_options():
    return [selectinload(Invoice.attachments), selectinload(Invoice.items)]


@router.get("", response_model=Page[InvoiceOut])
async def list_invoices(
    project_id: int | None = None,
    type: str | None = None,
    status: InvoiceStatus | None = None,
    vendor_client_id: int | None = None,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
    q: str | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Page[InvoiceOut]:
    stmt = select(Invoice).where(Invoice.deleted_at.is_(None))
    if user.role not in (UserRole.SUPERADMIN, UserRole.CENTRAL_ADMIN):
        ids = await user_project_ids(db, user)
        if not ids:
            return Page(items=[], total=0, page=page, size=size)
        stmt = stmt.where(Invoice.project_id.in_(ids))
    if project_id:
        await ensure_project_access(db, user, project_id)
        stmt = stmt.where(Invoice.project_id == project_id)
    if type:
        stmt = stmt.where(Invoice.type == type)
    if status:
        stmt = stmt.where(Invoice.status == status)
    if vendor_client_id:
        stmt = stmt.where(Invoice.vendor_client_id == vendor_client_id)
    if date_from:
        stmt = stmt.where(Invoice.invoice_date >= date_from)
    if date_to:
        stmt = stmt.where(Invoice.invoice_date <= date_to)
    if q:
        like = f"%{q}%"
        stmt = stmt.where((Invoice.number.ilike(like)) | (Invoice.party_name.ilike(like)))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    stmt = (
        stmt.options(*_full_options())
        .order_by(Invoice.invoice_date.desc(), Invoice.id.desc())
        .offset((page - 1) * size)
        .limit(size)
    )
    items = (await db.execute(stmt)).scalars().all()
    out_items = [await _to_out(db, i) for i in items]
    return Page(items=out_items, total=total, page=page, size=size)


@router.post("", response_model=InvoiceOut, status_code=201)
async def create_invoice(
    payload: InvoiceCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> InvoiceOut:
    await ensure_project_access(db, user, payload.project_id)
    data = payload.model_dump(exclude={"items"})
    inv = Invoice(**data, status=InvoiceStatus.DRAFT, created_by_id=user.id)
    for it in payload.items:
        inv.items.append(InvoiceItem(
            description=it.description,
            quantity=it.quantity,
            unit=it.unit,
            unit_price=it.unit_price,
            subtotal=Decimal(it.unit_price) * Decimal(it.quantity),
        ))
    sub, tot = _compute_totals(inv.items, inv.tax)
    inv.subtotal = sub
    inv.total = tot
    db.add(inv)
    await db.flush()
    await log(db, user_id=user.id, entity="invoice", entity_id=inv.id,
              action=AuditAction.CREATE, after=snapshot(inv))
    await db.commit()
    res = await db.execute(
        select(Invoice).options(*_full_options()).where(Invoice.id == inv.id)
    )
    return await _to_out(db, res.scalar_one())


@router.get("/{iid}", response_model=InvoiceOut)
async def get_invoice(
    iid: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> InvoiceOut:
    res = await db.execute(
        select(Invoice).options(*_full_options()).where(Invoice.id == iid)
    )
    inv = res.scalar_one_or_none()
    if not inv or inv.deleted_at is not None:
        raise HTTPException(404, "not_found")
    await ensure_project_access(db, user, inv.project_id)
    return await _to_out(db, inv)


@router.patch("/{iid}", response_model=InvoiceOut)
async def update_invoice(
    iid: int,
    payload: InvoiceUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> InvoiceOut:
    res = await db.execute(
        select(Invoice).options(*_full_options()).where(Invoice.id == iid)
    )
    inv = res.scalar_one_or_none()
    if not inv or inv.deleted_at is not None:
        raise HTTPException(404, "not_found")
    await ensure_project_access(db, user, inv.project_id)
    before = snapshot(inv)
    data = payload.model_dump(exclude_unset=True)
    items_data = data.pop("items", None)
    for k, v in data.items():
        setattr(inv, k, v)
    if items_data:
        inv.items.clear()
        await db.flush()
        for it in items_data:
            inv.items.append(InvoiceItem(
                description=it["description"],
                quantity=Decimal(str(it.get("quantity", 1))),
                unit=it.get("unit"),
                unit_price=Decimal(str(it.get("unit_price", 0))),
                subtotal=Decimal(str(it.get("unit_price", 0))) * Decimal(str(it.get("quantity", 1))),
            ))
    if inv.items:
        # ada items -- subtotal selalu mengikuti item
        sub, tot = _compute_totals(inv.items, inv.tax)
        inv.subtotal = sub
        inv.total = tot
    else:
        # data legacy tanpa items: pertahankan subtotal, total = subtotal + tax
        inv.total = Decimal(inv.subtotal or 0) + Decimal(inv.tax or 0)
    await recompute_invoice_status(db, inv)
    await log(db, user_id=user.id, entity="invoice", entity_id=inv.id,
              action=AuditAction.UPDATE, before=before, after=snapshot(inv))
    await db.commit()
    res = await db.execute(
        select(Invoice).options(*_full_options()).where(Invoice.id == inv.id)
    )
    return await _to_out(db, res.scalar_one())


@router.post("/{iid}/issue", response_model=InvoiceOut)
async def issue_invoice(
    iid: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> InvoiceOut:
    inv = await db.get(Invoice, iid)
    if not inv or inv.deleted_at is not None:
        raise HTTPException(404, "not_found")
    await ensure_project_access(db, user, inv.project_id)
    if inv.status != InvoiceStatus.DRAFT:
        raise HTTPException(409, "invalid_state")
    inv.status = InvoiceStatus.ISSUED
    await recompute_invoice_status(db, inv)
    await log(db, user_id=user.id, entity="invoice", entity_id=inv.id,
              action=AuditAction.UPDATE, note="issued")
    await db.commit()
    res = await db.execute(
        select(Invoice).options(*_full_options()).where(Invoice.id == inv.id)
    )
    return await _to_out(db, res.scalar_one())


@router.post("/{iid}/mark-paid", response_model=InvoiceOut)
async def mark_invoice_paid(
    iid: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> InvoiceOut:
    """Tandai invoice lunas. Kalau total transaksi yang sudah terhubung lebih
    kecil dari nilai invoice, otomatis buatkan transaksi DRAFT untuk
    selisihnya. Arah transaksi disesuaikan dengan tipe invoice:
    - Invoice IN  (vendor menagih kita / hutang) -> transaksi OUT
    - Invoice OUT (kita menagih client / piutang) -> transaksi IN
    """
    inv = await db.get(Invoice, iid)
    if not inv or inv.deleted_at is not None:
        raise HTTPException(404, "not_found")
    await ensure_project_access(db, user, inv.project_id)
    if inv.status == InvoiceStatus.CANCELLED:
        raise HTTPException(409, "invoice_cancelled")

    total = Decimal(inv.total or 0)
    if total <= 0:
        raise HTTPException(409, "invoice_total_zero")

    linked = await linked_amount(db, inv.id)
    diff = total - linked

    note_msg = None
    if diff > 0:
        # buat transaksi pelunasan otomatis
        tx_type = TxnType.OUT if inv.type == InvoiceType.IN else TxnType.IN
        new_tx = Transaction(
            project_id=inv.project_id,
            tx_date=date.today(),
            type=tx_type,
            amount=diff,
            party_name=inv.party_name,
            vendor_client_id=inv.vendor_client_id,
            payment_method=PaymentMethod.TRANSFER,
            description=f"Pelunasan invoice {inv.number}",
            status=TxnStatus.DRAFT,
            invoice_id=inv.id,
            created_by_id=user.id,
        )
        db.add(new_tx)
        await db.flush()
        note_msg = f"auto-create transaksi {tx_type.value} Rp{diff} untuk pelunasan"
        await log(db, user_id=user.id, entity="transaction", entity_id=new_tx.id,
                  action=AuditAction.CREATE, after=snapshot(new_tx),
                  note=f"Otomatis dibuat dari mark_paid invoice {inv.number}")

    inv.status = InvoiceStatus.PAID
    await log(db, user_id=user.id, entity="invoice", entity_id=inv.id,
              action=AuditAction.UPDATE, note=note_msg or "marked paid")
    await db.commit()
    res = await db.execute(
        select(Invoice).options(*_full_options()).where(Invoice.id == inv.id)
    )
    return await _to_out(db, res.scalar_one())


@router.post("/{iid}/cancel", response_model=InvoiceOut)
async def cancel_invoice(
    iid: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> InvoiceOut:
    inv = await db.get(Invoice, iid)
    if not inv or inv.deleted_at is not None:
        raise HTTPException(404, "not_found")
    inv.status = InvoiceStatus.CANCELLED
    await log(db, user_id=admin.id, entity="invoice", entity_id=inv.id,
              action=AuditAction.CANCEL)
    await db.commit()
    res = await db.execute(
        select(Invoice).options(*_full_options()).where(Invoice.id == inv.id)
    )
    return await _to_out(db, res.scalar_one())


@router.delete("/{iid}", status_code=204)
async def delete_invoice(
    iid: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> None:
    inv = await db.get(Invoice, iid)
    if not inv or inv.deleted_at is not None:
        raise HTTPException(404, "not_found")
    from sqlalchemy import func as sa_func
    inv.deleted_at = sa_func.now()
    await log(db, user_id=admin.id, entity="invoice", entity_id=inv.id,
              action=AuditAction.DELETE)
    await db.commit()


@router.delete("/{iid}/hard", status_code=204)
async def hard_delete_invoice(
    iid: int,
    db: AsyncSession = Depends(get_db),
    god: User = Depends(require_superadmin),
) -> None:
    """GOD-MODE: hapus permanen invoice + items + lampiran. Transaksi yang
    terhubung di-unlink (invoice_id = NULL), tidak ikut dihapus.
    Cuma SUPERADMIN."""
    inv = await db.get(Invoice, iid)
    if not inv:
        raise HTTPException(404, "not_found")

    # unlink transactions yang terhubung
    res = await db.execute(select(Transaction).where(Transaction.invoice_id == iid))
    txs = res.scalars().all()
    for t in txs:
        t.invoice_id = None

    before = snapshot(inv)
    await db.delete(inv)  # cascade items + attachments
    await log(db, user_id=god.id, entity="invoice", entity_id=iid,
              action=AuditAction.DELETE, before=before,
              note=f"HARD DELETE (god-mode), {len(txs)} transaksi di-unlink")
    await db.commit()


@router.post("/{iid}/attachments", response_model=AttachmentOut, status_code=201)
async def upload_invoice_attachment(
    iid: int,
    file: Annotated[UploadFile, File(...)],
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AttachmentOut:
    inv = await db.get(Invoice, iid)
    if not inv or inv.deleted_at is not None:
        raise HTTPException(404, "not_found")
    await ensure_project_access(db, user, inv.project_id)
    meta = await save_upload(file, subdir=f"invoices/{inv.id}")
    att = InvoiceAttachment(invoice_id=inv.id, uploaded_by_id=user.id, **meta)
    db.add(att)
    await log(db, user_id=user.id, entity="invoice_attachment", entity_id=inv.id,
              action=AuditAction.CREATE, after={"file": meta["file_name"]})
    await db.commit()
    await db.refresh(att)
    return AttachmentOut.model_validate(att)
