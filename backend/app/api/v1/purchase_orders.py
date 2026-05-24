from datetime import date as date_type, datetime, timezone
from decimal import Decimal
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
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
from app.services.pdf.render import html_to_pdf_async, inline_image, render_html

router = APIRouter()


def _compute_totals(items: list[POItem], tax: Decimal, discount: Decimal) -> tuple[Decimal, Decimal]:
    subtotal = sum((Decimal(it.unit_price) * Decimal(it.quantity) for it in items), Decimal("0"))
    for it in items:
        it.subtotal = Decimal(it.unit_price) * Decimal(it.quantity)
    total = subtotal + Decimal(tax or 0) - Decimal(discount or 0)
    return subtotal, total


async def _next_po_number(db: AsyncSession, company_id: int, project_code: str, when: date_type) -> str:
    """Generate nomor PO berikutnya untuk (company, project, year/month).

    Audit 2026-05-23 BUG FIX:
    - Sebelumnya pakai COUNT(*) WHERE company_id=X -- BUG: UNIQUE constraint
      pada PurchaseOrder.number bersifat GLOBAL (lintas company). Kalau 2
      company punya project_code sama (mis. 'GEO1'), keduanya generate
      'PO/.../GEO1/0001' -> UniqueViolationError.
    - Sekarang scan SEMUA PO dgn prefix sama (lintas company) + parse
      sequence number, return max + 1.
    - company_id param tetap di-keep utk future kalau UNIQUE diubah ke
      composite (company_id, number) -- saat ini tdk dipakai filter.

    Tdk fully race-safe -- gunakan retry di caller (create_po) utk handle
    concurrent submission. Untuk hard race-safe, butuh advisory lock atau
    SEQUENCE per (company, project, month). Saat ini single-instance
    Railway dgn concurrency rendah, MAX+1 + retry sudah cukup.
    """
    prefix = f"PO/{when.year}/{when.month:02d}/{project_code.upper()}/"
    rows = (await db.execute(
        select(PurchaseOrder.number).where(
            PurchaseOrder.number.like(f"{prefix}%"),
        )
    )).scalars().all()
    max_seq = 0
    for n in rows:
        suffix = n[len(prefix):]
        # Parse leading digit segment (toleran kalau ada slash/suffix)
        digit_str = ""
        for ch in suffix:
            if ch.isdigit():
                digit_str += ch
            else:
                break
        if digit_str:
            try:
                max_seq = max(max_seq, int(digit_str))
            except ValueError:
                continue
    return f"{prefix}{max_seq + 1:04d}"


def _to_out(po: PurchaseOrder, vendor_client_name: str | None = None) -> POOut:
    out = POOut.model_validate(po)
    out.vendor_client_name = vendor_client_name
    return out


async def _to_out_async(db: AsyncSession, po: PurchaseOrder) -> POOut:
    """Single-PO helper: lookup vendor_client.name dr master kalau ada."""
    name: str | None = None
    if po.vendor_client_id:
        vc = await db.get(VendorClient, po.vendor_client_id)
        if vc:
            name = vc.name
    return _to_out(po, name)


@router.get("", response_model=Page[POOut])
async def list_pos(
    project_id: list[int] | None = Query(None),
    status: POStatus | None = None,
    company_id: int | None = None,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
    q: str | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=2000),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Page[POOut]:
    stmt = select(PurchaseOrder).where(PurchaseOrder.deleted_at.is_(None))
    pids = await user_project_ids(db, user)
    if pids is not None:
        if not pids:
            return Page(items=[], total=0, page=page, size=size)
        stmt = stmt.where(PurchaseOrder.project_id.in_(pids))
    if project_id:
        for pid in project_id:
            await ensure_project_access(db, user, pid)
        stmt = stmt.where(PurchaseOrder.project_id.in_(project_id))
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
    # Bulk-load vendor_client.name utk yg link ke master. Audit #2.
    vc_ids = {p.vendor_client_id for p in items if p.vendor_client_id}
    vc_map: dict[int, str] = {}
    if vc_ids:
        vc_map = {
            vid: name for vid, name in (await db.execute(
                select(VendorClient.id, VendorClient.name)
                .where(VendorClient.id.in_(vc_ids))
            )).all()
        }
    return Page(
        items=[_to_out(p, vc_map.get(p.vendor_client_id)) for p in items],
        total=total, page=page, size=size,
    )


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

    # Audit 2026-05-23: retry on UniqueViolation. Race protection +
    # safety net kalau cross-company collision sliced lewat.
    MAX_ATTEMPTS = 5
    po: PurchaseOrder | None = None
    last_err: Exception | None = None
    for attempt in range(MAX_ATTEMPTS):
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
        try:
            await db.flush()
            break  # success
        except IntegrityError as e:
            last_err = e
            await db.rollback()
            # Re-fetch project+company krn rollback clear session state.
            project = await db.get(Project, payload.project_id)
            company = await db.get(Company, payload.company_id)
            if attempt == MAX_ATTEMPTS - 1:
                raise HTTPException(
                    status_code=409,
                    detail=f"po_number_collision: gagal generate nomor unik setelah {MAX_ATTEMPTS} percobaan",
                ) from e
            # else: loop continues, _next_po_number re-scan & try again
    assert po is not None  # appease type checker
    await log(db, user_id=user.id, entity="purchase_order", entity_id=po.id,
              action=AuditAction.CREATE, after=snapshot(po))
    await db.commit()
    res = await db.execute(
        select(PurchaseOrder).options(selectinload(PurchaseOrder.items)).where(PurchaseOrder.id == po.id)
    )
    return await _to_out_async(db, res.scalar_one())


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
    return await _to_out_async(db, po)


@router.get("/{pid}/linked-transactions")
async def get_po_linked_transactions(
    pid: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """List semua transaksi yg ter-link ke PO ini (via tx.purchase_order_id).

    Plus: via tx allocations -> invoice yg dibayar -> drilldown lengkap
    PO -> TX -> Invoice. Standar finance pro: procurement audit trail.
    """
    from app.models.models import Transaction, InvoiceAllocation, Invoice
    po = await db.get(PurchaseOrder, pid)
    if not po or po.deleted_at is not None:
        raise HTTPException(404, "not_found")
    await ensure_project_access(db, user, po.project_id)

    # Transaksi yg langsung point ke PO ini
    tx_q = (
        select(Transaction)
        .where(
            Transaction.purchase_order_id == pid,
            Transaction.deleted_at.is_(None),
        )
        .order_by(Transaction.tx_date.desc())
    )
    txs = (await db.execute(tx_q)).scalars().all()

    tx_ids = [t.id for t in txs]
    # Invoice yg dibayar oleh tx2 di atas (via allocation)
    inv_map: dict[int, Invoice] = {}
    alloc_map: dict[int, list[dict]] = {}  # tx_id -> [alloc info]
    if tx_ids:
        alloc_res = await db.execute(
            select(InvoiceAllocation, Invoice)
            .join(Invoice, Invoice.id == InvoiceAllocation.invoice_id)
            .where(
                InvoiceAllocation.transaction_id.in_(tx_ids),
                InvoiceAllocation.deleted_at.is_(None),
            )
        )
        for alloc, inv in alloc_res.all():
            inv_map[inv.id] = inv
            alloc_map.setdefault(alloc.transaction_id, []).append({
                "allocation_id": alloc.id,
                "invoice_id": inv.id,
                "invoice_number": inv.number,
                "invoice_status": inv.status.value if hasattr(inv.status, "value") else str(inv.status),
                "allocated_amount": float(alloc.allocated_amount or 0),
            })

    txs_out = [
        {
            "id": t.id,
            "tx_date": t.tx_date.isoformat() if t.tx_date else None,
            "amount": float(t.amount or 0),
            "type": t.type.value if hasattr(t.type, "value") else str(t.type),
            "kind": (t.kind if isinstance(t.kind, str) else (t.kind.value if t.kind else None)),
            "status": t.status.value if hasattr(t.status, "value") else str(t.status),
            "description": t.description,
            "party_name": t.party_name,
            "allocations": alloc_map.get(t.id, []),
        }
        for t in txs
    ]

    return {
        "po_id": pid,
        "po_number": po.number,
        "po_total": float(po.total or 0),
        "transactions": txs_out,
        "transactions_count": len(txs_out),
        "invoices_count": len(inv_map),
        # Summary: total tx amount yg sudah hit (allocated to invoices vs unallocated)
        "total_paid": sum(float(t.amount or 0) for t in txs),
    }


@router.patch("/{pid}", response_model=POOut)
async def update_po(
    pid: int,
    payload: POUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_can_write),
) -> POOut:
    """Update PO. Aturan edit:

    - DRAFT: semua field bebas (siapa pun yg can_write).
    - Non-DRAFT (ISSUED/APPROVED/...): hanya SUPERADMIN (god-mode).
      CENTRAL_ADMIN block -- pakai workflow CANCEL kalau perlu koreksi.

    Audit 2026-05-23 user lapor:
    - project_id sekarang BISA diubah saat draft (sebelumnya silent-
      ignored krn tdk ada di POUpdate schema).
    - SUPERADMIN bypass lock status utk semua field termasuk
      project_id, company_id, status -- jaminan konsistensi terkait
      adalah tanggung jawab SUPERADMIN.

    Side-effects saat project_id berubah:
    - Number PO di-regenerate match prefix proyek baru
      (PO/YYYY/MM/<NEW_CODE>/NNNN). Audit log catat old + new number.
    """
    res = await db.execute(
        select(PurchaseOrder).options(selectinload(PurchaseOrder.items)).where(PurchaseOrder.id == pid)
    )
    po = res.scalar_one_or_none()
    if not po or po.deleted_at is not None:
        raise HTTPException(404, "not_found")
    await ensure_project_access(db, user, po.project_id)

    is_god = user.role == UserRole.SUPERADMIN
    if po.status != POStatus.DRAFT and not is_god:
        # Non-DRAFT locked utk semua kecuali SUPERADMIN.
        # CENTRAL_ADMIN dulu di-allow oleh logic lama -- sekarang
        # tightened (god-mode only). Kalau ini perlu di-relaxasi,
        # pisahkan field non-financial (notes, payment_terms) vs
        # financial (project_id, items, total).
        raise HTTPException(409, "approved_locked: gunakan SUPERADMIN utk edit non-draft")

    before = snapshot(po)
    data = payload.model_dump(exclude_unset=True)
    items = data.pop("items", None)

    # Validate project change kalau ada.
    new_project_id = data.pop("project_id", None)
    new_project: Project | None = None
    if new_project_id is not None and new_project_id != po.project_id:
        await ensure_project_access(db, user, new_project_id)
        new_project = (await db.execute(
            select(Project).where(
                Project.id == new_project_id,
                Project.deleted_at.is_(None),
            )
        )).scalar_one_or_none()
        if new_project is None:
            raise HTTPException(400, "target_project_not_found")

    # Validate company change kalau ada.
    new_company_id = data.pop("company_id", None)
    if new_company_id is not None and new_company_id != po.company_id:
        target_co = await db.get(Company, new_company_id)
        if target_co is None or target_co.deleted_at is not None:
            raise HTTPException(400, "target_company_not_found")

    # Validate status change (gated SUPERADMIN -- dilakukan via workflow
    # endpoints biasanya, tapi god-mode allow direct).
    new_status = data.pop("status", None)
    if new_status is not None and new_status != po.status and not is_god:
        raise HTTPException(403, "status_change_requires_superadmin")

    # Apply field changes (non-FK fields)
    for k, v in data.items():
        setattr(po, k, v)

    # Apply project change + regen number kalau perlu.
    if new_project is not None:
        po.project_id = new_project.id
        # Regen number utk match prefix baru. Pakai retry-loop sama
        # spt create_po utk safety race.
        for _attempt in range(5):
            new_num = await _next_po_number(
                db, po.company_id, new_project.code, po.po_date,
            )
            old_num = po.number
            po.number = new_num
            try:
                await db.flush()
                break
            except IntegrityError:
                await db.rollback()
                # Re-fetch po (rollback clear session) -- re-load + retry
                res2 = await db.execute(
                    select(PurchaseOrder)
                    .options(selectinload(PurchaseOrder.items))
                    .where(PurchaseOrder.id == pid)
                )
                po = res2.scalar_one()
                po.project_id = new_project.id
        else:
            raise HTTPException(500, "po_number_regen_failed")

    if new_company_id is not None:
        po.company_id = new_company_id

    if new_status is not None:
        po.status = new_status

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
    return await _to_out_async(db, res.scalar_one())


@router.post("/bulk/issue")
async def bulk_issue_pos(
    payload: dict,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_can_write),
) -> dict:
    """Bulk issue PO (DRAFT -> ISSUED). Audit 2026-05-23.

    Payload: {ids: list[int]}.
    Return: {total_requested, success_count, success, skipped}.
    """
    ids = payload.get("ids") or []
    if not isinstance(ids, list) or not ids:
        raise HTTPException(400, "ids_required")
    if len(ids) > 500:
        raise HTTPException(400, "max_500_per_batch")
    res = await db.execute(
        select(PurchaseOrder)
        .options(selectinload(PurchaseOrder.items))
        .where(PurchaseOrder.id.in_(ids))
    )
    pos = {p.id: p for p in res.scalars().all()}
    success_ids: list[int] = []
    skipped: list[dict] = []
    for pid in ids:
        p = pos.get(pid)
        if p is None or p.deleted_at is not None:
            skipped.append({"id": pid, "reason": "not_found"})
            continue
        # Access check per-item (project bisa beda).
        try:
            await ensure_project_access(db, user, p.project_id)
        except HTTPException as e:
            skipped.append({"id": pid, "reason": f"access_denied_{e.status_code}"})
            continue
        if p.status != POStatus.DRAFT:
            skipped.append({"id": pid, "reason": f"invalid_state_{p.status.value}"})
            continue
        p.status = POStatus.ISSUED
        await log(
            db, user_id=user.id, entity="purchase_order", entity_id=p.id,
            action=AuditAction.UPDATE, note="bulk issued",
        )
        success_ids.append(pid)
    await db.commit()
    return {
        "total_requested": len(ids),
        "success_count": len(success_ids),
        "success": success_ids,
        "skipped": skipped,
    }


@router.post("/bulk/approve")
async def bulk_approve_pos(
    payload: dict,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    """Bulk approve PO (DRAFT/ISSUED -> APPROVED). Admin only.
    Audit 2026-05-23.
    """
    ids = payload.get("ids") or []
    if not isinstance(ids, list) or not ids:
        raise HTTPException(400, "ids_required")
    if len(ids) > 500:
        raise HTTPException(400, "max_500_per_batch")
    res = await db.execute(
        select(PurchaseOrder)
        .options(selectinload(PurchaseOrder.items))
        .where(PurchaseOrder.id.in_(ids))
    )
    pos = {p.id: p for p in res.scalars().all()}
    success_ids: list[int] = []
    skipped: list[dict] = []
    now = datetime.now(timezone.utc)
    for pid in ids:
        p = pos.get(pid)
        if p is None or p.deleted_at is not None:
            skipped.append({"id": pid, "reason": "not_found"})
            continue
        if p.status not in (POStatus.DRAFT, POStatus.ISSUED):
            skipped.append({"id": pid, "reason": f"invalid_state_{p.status.value}"})
            continue
        p.status = POStatus.APPROVED
        p.approved_by_id = admin.id
        p.approved_at = now
        await log(
            db, user_id=admin.id, entity="purchase_order", entity_id=p.id,
            action=AuditAction.APPROVE, note="bulk approve",
        )
        success_ids.append(pid)
    await db.commit()
    return {
        "total_requested": len(ids),
        "success_count": len(success_ids),
        "success": success_ids,
        "skipped": skipped,
    }


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
    return await _to_out_async(db, res.scalar_one())


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
    return await _to_out_async(db, res.scalar_one())


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
    return await _to_out_async(db, res.scalar_one())


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
    po.deleted_at = datetime.utcnow()
    await log(db, user_id=admin.id, entity="purchase_order", entity_id=po.id,
              action=AuditAction.DELETE)
    await db.commit()


@router.delete("/{pid}/hard", status_code=204)
async def hard_delete_po(
    pid: int,
    db: AsyncSession = Depends(get_db),
    god: User = Depends(require_superadmin),
) -> None:
    """GOD-MODE: hapus permanen PO + semua item-nya. Bypass status apa pun.
    Transaksi yang sempat menunjuk PO ini di-unlink (purchase_order_id = NULL)
    agar tidak meninggalkan FK menggantung. Cuma SUPERADMIN."""
    po = await db.get(PurchaseOrder, pid)
    if not po:
        raise HTTPException(404, "not_found")
    # Unlink transactions yang masih menunjuk PO ini
    from app.models.models import Transaction as TxnModel
    res = await db.execute(
        select(TxnModel).where(TxnModel.purchase_order_id == pid)
    )
    txs = res.scalars().all()
    for t in txs:
        t.purchase_order_id = None
    before = snapshot(po)
    await db.delete(po)  # cascade items via cascade="all,delete-orphan"
    await log(db, user_id=god.id, entity="purchase_order", entity_id=pid,
              action=AuditAction.DELETE, before=before,
              note=f"HARD DELETE (god-mode), {len(txs)} transaksi di-unlink")
    await db.commit()


@router.get("/{pid}/pdf")
async def po_pdf(
    pid: int,
    signatures: str = Query("both", pattern="^(both|creator|approver|none)$"),
    responsible_name: str | None = Query(None, max_length=200),
    responsible_title: str | None = Query(None, max_length=120),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    """Cetak PO ke PDF. signatures + responsible_name dipakai utk
    customize signature block per dokumen (lihat invoice_pdf)."""
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
    logo_data = inline_image(company.logo_url) if company else None
    letterhead_data = inline_image(company.letterhead_url) if company else None
    # Default nama penanggung jawab: approved_by (kalau ada, dia yg meng-approve)
    # lalu company.director_name.
    default_responsible = None
    if approved_by:
        default_responsible = approved_by.name
    elif company:
        default_responsible = company.director_name
    html = render_html(
        "po.html",
        po=po, project=project, company=company,
        vendor=vendor, created_by=created_by, approved_by=approved_by,
        logo_data=logo_data, letterhead_data=letterhead_data,
        base_css=base_css,
        sig_show_creator=signatures in ("both", "creator"),
        sig_show_approver=signatures in ("both", "approver"),
        sig_responsible_name=(responsible_name or "").strip() or default_responsible,
        sig_responsible_title=(responsible_title or "").strip() or "Direktur",
    )
    pdf = await html_to_pdf_async(html)
    return Response(
        pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{po.number.replace("/", "-")}.pdf"'},
    )
