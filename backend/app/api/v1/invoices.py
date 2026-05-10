from datetime import date, date as date_type
from decimal import Decimal
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from sqlalchemy import delete, func, select
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
    Invoice,
    InvoiceAllocation,
    InvoiceAttachment,
    InvoiceItem,
    InvoiceStatus,
    InvoiceType,
    PaymentMethod,
    Project,
    Transaction,
    TxnStatus,
    TxnType,
    User,
    UserRole,
    VendorClient,
)
from app.schemas.common import Page
from app.schemas.finance import (
    AttachmentOut,
    ExternalLinkIn,
    InvoiceCreate,
    InvoiceItemIn,
    InvoiceItemOut,
    InvoiceOut,
    InvoicePayment,
    InvoiceUpdate,
)
from app.services.audit import log, snapshot
from app.services.invoice_status import linked_amount, paid_amount, recompute_invoice_status
from app.services.pdf.render import html_to_pdf_async, inline_image, render_html
from app.services.storage.links import normalize_external_link
from app.services.storage.local import save_upload

router = APIRouter()


def _compute_totals(items: list[InvoiceItem], tax: Decimal) -> tuple[Decimal, Decimal]:
    subtotal = Decimal("0")
    for it in items:
        it.subtotal = Decimal(it.unit_price) * Decimal(it.quantity)
        subtotal += it.subtotal
    total = subtotal + Decimal(tax or 0)
    return subtotal, total


async def _bulk_paid_amounts(
    db: AsyncSession, invoice_ids: list[int]
) -> dict[int, Decimal]:
    """1 query SUM(allocated_amount) GROUP BY invoice_id utk N invoice."""
    if not invoice_ids:
        return {}
    q = (
        select(
            InvoiceAllocation.invoice_id,
            func.coalesce(func.sum(InvoiceAllocation.allocated_amount), 0),
        )
        .where(
            InvoiceAllocation.invoice_id.in_(invoice_ids),
            InvoiceAllocation.deleted_at.is_(None),
        )
        .group_by(InvoiceAllocation.invoice_id)
    )
    rows = (await db.execute(q)).all()
    return {inv_id: Decimal(amt or 0) for inv_id, amt in rows}


async def _bulk_payment_rows(
    db: AsyncSession, invoice_ids: list[int]
) -> dict[int, list[tuple[InvoiceAllocation, Transaction]]]:
    """1 query utk semua payment-row (allocation + txn) milik N invoice."""
    if not invoice_ids:
        return {}
    pq = (
        select(InvoiceAllocation, Transaction)
        .join(Transaction, Transaction.id == InvoiceAllocation.transaction_id)
        .where(
            InvoiceAllocation.invoice_id.in_(invoice_ids),
            InvoiceAllocation.deleted_at.is_(None),
            Transaction.deleted_at.is_(None),
        )
        .order_by(Transaction.tx_date.asc(), InvoiceAllocation.id.asc())
    )
    rows = (await db.execute(pq)).all()
    grouped: dict[int, list[tuple[InvoiceAllocation, Transaction]]] = {}
    for a, t in rows:
        grouped.setdefault(a.invoice_id, []).append((a, t))
    return grouped


async def _to_out(
    db: AsyncSession,
    inv: Invoice,
    *,
    paid_override: Decimal | None = None,
    payment_rows: list[tuple[InvoiceAllocation, Transaction]] | None = None,
) -> InvoiceOut:
    """Serialize 1 invoice. Bila `paid_override` & `payment_rows`
    diberikan (mis. dari bulk-loader di list endpoint), tidak ada
    query tambahan -- ini menghilangkan N+1 di list_invoices."""
    if paid_override is not None:
        paid = paid_override
    else:
        paid = await paid_amount(db, inv.id)
    out = InvoiceOut.model_validate(inv)
    out.attachments = [AttachmentOut.model_validate(a) for a in inv.attachments]
    out.items = [InvoiceItemOut.model_validate(it) for it in inv.items]
    out.paid_amount = paid
    outstanding = max(Decimal(inv.total or 0) - paid, Decimal("0"))
    out.remaining = outstanding
    out.outstanding_amount = outstanding

    if payment_rows is None:
        pq = (
            select(InvoiceAllocation, Transaction)
            .join(Transaction, Transaction.id == InvoiceAllocation.transaction_id)
            .where(
                InvoiceAllocation.invoice_id == inv.id,
                InvoiceAllocation.deleted_at.is_(None),
                Transaction.deleted_at.is_(None),
            )
            .order_by(Transaction.tx_date.asc(), InvoiceAllocation.id.asc())
        )
        payment_rows = (await db.execute(pq)).all()

    out.payments = [
        InvoicePayment(
            id=t.id,
            allocation_id=a.id,
            tx_date=t.tx_date,
            type=t.type,
            amount=Decimal(a.allocated_amount),
            transaction_total=Decimal(t.amount),
            status=t.status,
            payment_method=t.payment_method,
            reference_no=t.reference_no,
            description=t.description,
            created_at=a.created_at,
        )
        for a, t in payment_rows
    ]
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
    size: int = Query(50, ge=1, le=2000),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Page[InvoiceOut]:
    stmt = select(Invoice).where(Invoice.deleted_at.is_(None))
    pids = await user_project_ids(db, user)
    if pids is not None:
        if not pids:
            return Page(items=[], total=0, page=page, size=size)
        stmt = stmt.where(Invoice.project_id.in_(pids))
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
    # Bulk-load paid amount + payment rows utk seluruh invoice di page,
    # bukan 2 query per invoice (N+1).
    inv_ids = [i.id for i in items]
    paid_map = await _bulk_paid_amounts(db, inv_ids)
    payments_map = await _bulk_payment_rows(db, inv_ids)
    out_items = [
        await _to_out(
            db, i,
            paid_override=paid_map.get(i.id, Decimal("0")),
            payment_rows=payments_map.get(i.id, []),
        )
        for i in items
    ]
    return Page(items=out_items, total=total, page=page, size=size)


@router.post("", response_model=InvoiceOut, status_code=201)
async def create_invoice(
    payload: InvoiceCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_can_write),
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
    user: User = Depends(require_can_write),
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
        # Pakai explicit DELETE statement, BUKAN inv.items.clear() + cascade.
        # Pola clear()+cascade='all,delete-orphan' di async session bisa
        # trigger MissingGreenlet karena verifikasi collection state internal
        # mencoba lazy-load di luar greenlet context.
        # synchronize_session=False supaya SQLAlchemy tidak coba sinkronisasi
        # in-memory state -- default 'auto' bisa expire kolom Invoice yg
        # related, lalu snapshot(inv) berikutnya trigger lazy-load di luar
        # greenlet context (MissingGreenlet pas line 'after=snapshot(inv)').
        await db.execute(
            delete(InvoiceItem)
            .where(InvoiceItem.invoice_id == inv.id)
            .execution_options(synchronize_session=False)
        )
        # Putus link ke object lama yg sudah dihapus, lalu fresh start.
        inv.items[:] = []
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
    user: User = Depends(require_can_write),
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
    user: User = Depends(require_can_write),
) -> InvoiceOut:
    """Tandai invoice LUNAS.

    Skema baru (M:N allocations):
      1. Hitung outstanding = total - SUM(allocations aktif).
      2. Kalau outstanding > 0, buat transaksi DRAFT untuk selisih +
         allocation row sebesar outstanding (auto-link via tabel
         `invoice_allocations`, BUKAN lewat `transactions.invoice_id`).
      3. Allocation service akan menaikkan status invoice ke PAID.
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

    paid = await paid_amount(db, inv.id)
    outstanding = total - paid

    note_msg = None
    if outstanding > 0:
        tx_type = TxnType.OUT if inv.type == InvoiceType.IN else TxnType.IN
        new_tx = Transaction(
            project_id=inv.project_id,
            tx_date=date.today(),
            type=tx_type,
            amount=outstanding,
            party_name=inv.party_name,
            vendor_client_id=inv.vendor_client_id,
            payment_method=PaymentMethod.TRANSFER,
            description=f"Pelunasan invoice {inv.number}",
            status=TxnStatus.DRAFT,
            created_by_id=user.id,
        )
        db.add(new_tx)
        await db.flush()
        await log(db, user_id=user.id, entity="transaction", entity_id=new_tx.id,
                  action=AuditAction.CREATE, after=snapshot(new_tx),
                  note=f"Auto-create dari mark_paid invoice {inv.number}")
        # Buat allocation row sebesar outstanding (lewat service supaya
        # validasi & lock konsisten dengan endpoint /allocations).
        from app.services.allocation import apply_allocations_to_invoice
        await apply_allocations_to_invoice(
            db,
            invoice_id=inv.id,
            items=[(new_tx.id, outstanding)],
            note=f"auto mark-paid",
            user_id=user.id,
        )
        note_msg = f"auto-create transaksi {tx_type.value} Rp{outstanding} untuk pelunasan"
    else:
        # sudah lunas via alokasi sebelumnya; pastikan status PAID
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
    """GOD-MODE: hapus permanen invoice + items + lampiran + semua
    allocation row yang terhubung. Transaksi pembayaran TIDAK ikut
    dihapus, hanya alokasinya yang dibuang. Legacy `transactions.invoice_id`
    yang masih null-able juga di-clear bila ada (kompat). Cuma SUPERADMIN."""
    inv = await db.get(Invoice, iid)
    if not inv:
        raise HTTPException(404, "not_found")

    # Hapus semua allocations row untuk invoice ini
    alloc_res = await db.execute(
        select(InvoiceAllocation).where(InvoiceAllocation.invoice_id == iid)
    )
    allocs = alloc_res.scalars().all()
    for a in allocs:
        await db.delete(a)

    # Legacy: bila masih ada transaksi yang menunjuk invoice ini lewat
    # kolom lama, clear juga.
    res = await db.execute(select(Transaction).where(Transaction.invoice_id == iid))
    txs = res.scalars().all()
    for t in txs:
        t.invoice_id = None

    before = snapshot(inv)
    await db.delete(inv)  # cascade items + attachments
    await log(db, user_id=god.id, entity="invoice", entity_id=iid,
              action=AuditAction.DELETE, before=before,
              note=f"HARD DELETE (god-mode), {len(allocs)} alokasi dihapus, "
                   f"{len(txs)} legacy link di-unlink")
    await db.commit()


@router.post("/{iid}/attachments", response_model=AttachmentOut, status_code=201)
async def upload_invoice_attachment(
    iid: int,
    file: Annotated[UploadFile, File(...)],
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_can_write),
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


@router.post("/{iid}/attachments/link", response_model=AttachmentOut, status_code=201)
async def attach_invoice_link(
    iid: int,
    body: ExternalLinkIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_can_write),
) -> AttachmentOut:
    inv = await db.get(Invoice, iid)
    if not inv or inv.deleted_at is not None:
        raise HTTPException(404, "not_found")
    await ensure_project_access(db, user, inv.project_id)
    meta = normalize_external_link(body.url, label=body.label, file_name=body.file_name)
    att = InvoiceAttachment(invoice_id=inv.id, uploaded_by_id=user.id, **meta)
    db.add(att)
    await log(db, user_id=user.id, entity="invoice_attachment", entity_id=inv.id,
              action=AuditAction.CREATE, after={"link": meta["file_name"], "url": meta["url"]})
    await db.commit()
    await db.refresh(att)
    return AttachmentOut.model_validate(att)


# --- Bahasa Indonesia "terbilang" (angka -> kata) ----------------------------

def _terbilang(n: int) -> str:
    """Konversi bilangan bulat positif ke kata-kata Bahasa Indonesia."""
    n = int(abs(n))
    if n == 0:
        return "nol"
    satuan = ["", "satu", "dua", "tiga", "empat", "lima",
              "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"]

    def _below_1000(x: int) -> str:
        if x < 12:
            return satuan[x]
        if x < 20:
            return satuan[x - 10] + " belas"
        if x < 100:
            return satuan[x // 10] + " puluh" + (
                " " + satuan[x % 10] if x % 10 else ""
            )
        if x < 200:
            return "seratus" + (" " + _below_1000(x - 100) if x > 100 else "")
        if x < 1000:
            return satuan[x // 100] + " ratus" + (
                " " + _below_1000(x % 100) if x % 100 else ""
            )
        return ""  # tidak akan terjadi

    if n < 1000:
        return _below_1000(n)
    if n < 2000:
        return "seribu" + (" " + _terbilang(n - 1000) if n > 1000 else "")
    if n < 1_000_000:
        return _terbilang(n // 1000) + " ribu" + (
            " " + _terbilang(n % 1000) if n % 1000 else ""
        )
    if n < 1_000_000_000:
        return _terbilang(n // 1_000_000) + " juta" + (
            " " + _terbilang(n % 1_000_000) if n % 1_000_000 else ""
        )
    if n < 1_000_000_000_000:
        return _terbilang(n // 1_000_000_000) + " miliar" + (
            " " + _terbilang(n % 1_000_000_000) if n % 1_000_000_000 else ""
        )
    return _terbilang(n // 1_000_000_000_000) + " triliun" + (
        " " + _terbilang(n % 1_000_000_000_000) if n % 1_000_000_000_000 else ""
    )


@router.get("/{iid}/pdf")
async def invoice_pdf(
    iid: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    """Cetak invoice ke PDF (A4). Status, paid, dan sisa diambil
    real-time dari tabel allocations."""
    res = await db.execute(
        select(Invoice).options(*_full_options()).where(Invoice.id == iid)
    )
    inv = res.scalar_one_or_none()
    if not inv or inv.deleted_at is not None:
        raise HTTPException(404, "not_found")
    await ensure_project_access(db, user, inv.project_id)

    project = await db.get(Project, inv.project_id)
    company = await db.get(Company, project.company_id) if project else None
    vendor = (
        await db.get(VendorClient, inv.vendor_client_id)
        if inv.vendor_client_id else None
    )
    created_by = await db.get(User, inv.created_by_id) if inv.created_by_id else None
    paid = await paid_amount(db, inv.id)
    outstanding = max(Decimal(inv.total or 0) - paid, Decimal("0"))

    base_css = (
        Path(__file__).parent.parent.parent / "services/pdf/templates/_base.css"
    ).read_text(encoding="utf-8")
    logo_data = inline_image(company.logo_url) if company else None
    letterhead_data = inline_image(company.letterhead_url) if company else None
    html = render_html(
        "invoice.html",
        invoice=inv, project=project, company=company,
        vendor=vendor, created_by=created_by,
        paid_amount=paid, outstanding=outstanding,
        amount_in_words=_terbilang(int(Decimal(inv.total or 0))).capitalize(),
        logo_data=logo_data, letterhead_data=letterhead_data,
        base_css=base_css,
    )
    pdf = await html_to_pdf_async(html)
    safe_name = (inv.number or f"INV-{inv.id}").replace("/", "-")
    return Response(
        pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{safe_name}.pdf"'},
    )
