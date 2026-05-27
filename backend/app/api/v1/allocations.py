"""Endpoints untuk M:N allocation antara Transaction dan Invoice.

Routes:
  POST   /invoices/{iid}/allocations      -- alokasi banyak transaksi -> 1 invoice (auto-cap)
  GET    /invoices/{iid}/allocatable-transactions
  POST   /transactions/{tid}/allocations  -- alokasi 1 transaksi -> banyak invoice (auto-cap)
  GET    /transactions/{tid}/allocatable-invoices
  PATCH  /allocations/{id}                -- edit nilai (strict, no auto-cap)
  DELETE /allocations/{id}

Semua disertai izin lewat `require_can_write` / `ensure_project_access`.
"""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import (
    ensure_project_access,
    get_current_user,
    require_can_write,
)
from app.db.session import get_db
from app.models.models import (
    AuditAction,
    Invoice,
    InvoiceAllocation,
    InvoiceStatus,
    InvoiceType,
    Transaction,
    TxnKind,
    TxnStatus,
    TxnType,
    User,
)
from app.schemas.finance import (
    AllocatableInvoiceRow,
    AllocatableTransactionRow,
    AllocationApplyResult,
    AllocationCreate,
    AllocationOut,
    AllocationPatch,
)
from app.services.allocation import (
    ALLOCATABLE_INVOICE_STATUSES,
    ALLOCATABLE_TXN_STATUSES,
    NON_ALLOCATABLE_TXN_KINDS,
    apply_allocations_to_invoice,
    apply_allocations_to_transaction,
    delete_allocation,
    direction_compatible,
    invoice_allocated,
    patch_allocation,
    transaction_allocated,
)
from app.services.audit import log

router = APIRouter()


# ---- Invoice side ---------------------------------------------------------

@router.get(
    "/invoices/{iid}/allocatable-transactions",
    response_model=list[AllocatableTransactionRow],
)
async def list_allocatable_transactions(
    iid: int,
    include_zero: bool = False,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[AllocatableTransactionRow]:
    """Daftar transaksi yang masih punya remaining_amount untuk dialokasikan
    ke invoice ini. Filter: project sama, arah cocok, status eligible."""
    inv = await db.get(Invoice, iid)
    if not inv or inv.deleted_at is not None:
        raise HTTPException(404, "invoice_not_found")
    await ensure_project_access(db, user, inv.project_id)

    # arah transaksi yang kompatibel
    txn_type = TxnType.OUT if inv.type == InvoiceType.IN else TxnType.IN

    sum_alloc = (
        select(
            InvoiceAllocation.transaction_id,
            func.coalesce(func.sum(InvoiceAllocation.allocated_amount), 0).label("alloc_sum"),
        )
        .where(InvoiceAllocation.deleted_at.is_(None))
        .group_by(InvoiceAllocation.transaction_id)
        .subquery()
    )

    # Audit 2026-05-27: exclude kind=DIRECT_EXPENSE -- beban sudah tercatat
    # in-place via TX items, alokasi ke invoice = double-count.
    excluded_kinds = [k.value for k in NON_ALLOCATABLE_TXN_KINDS]
    stmt = (
        select(Transaction, func.coalesce(sum_alloc.c.alloc_sum, 0))
        .outerjoin(sum_alloc, sum_alloc.c.transaction_id == Transaction.id)
        .where(
            Transaction.project_id == inv.project_id,
            Transaction.type == txn_type,
            Transaction.deleted_at.is_(None),
            Transaction.status.in_(ALLOCATABLE_TXN_STATUSES),
            Transaction.kind.notin_(excluded_kinds),
        )
        .order_by(Transaction.tx_date.desc(), Transaction.id.desc())
    )
    rows = (await db.execute(stmt)).all()
    out: list[AllocatableTransactionRow] = []
    for t, alloc_sum in rows:
        total = Decimal(t.amount or 0)
        allocated = Decimal(alloc_sum or 0)
        remaining = total - allocated
        if remaining <= 0 and not include_zero:
            continue
        out.append(AllocatableTransactionRow(
            id=t.id, tx_date=t.tx_date, type=t.type,
            party_name=t.party_name, payment_method=t.payment_method,
            reference_no=t.reference_no, description=t.description,
            status=t.status,
            total_amount=total, allocated_amount=allocated, remaining_amount=remaining,
        ))
    return out


@router.post(
    "/invoices/{iid}/allocations",
    response_model=AllocationApplyResult,
    status_code=201,
)
async def create_invoice_allocations(
    iid: int,
    payload: AllocationCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_can_write),
) -> AllocationApplyResult:
    inv = await db.get(Invoice, iid)
    if not inv or inv.deleted_at is not None:
        raise HTTPException(404, "invoice_not_found")
    await ensure_project_access(db, user, inv.project_id)

    items: list[tuple[int, Decimal]] = []
    for it in payload.items:
        if it.transaction_id is None:
            raise HTTPException(422, "transaction_id_required")
        items.append((it.transaction_id, Decimal(it.requested_amount)))

    result = await apply_allocations_to_invoice(
        db, invoice_id=iid, items=items, note=payload.note, user_id=user.id,
    )
    await log(
        db, user_id=user.id, entity="invoice_allocation", entity_id=iid,
        action=AuditAction.CREATE,
        after={"applied": [r.id for r in result["applied"]],
               "total_applied": str(result["total_applied"])},
        note=payload.note,
    )
    await db.commit()
    return AllocationApplyResult(
        applied=[AllocationOut.model_validate(r) for r in result["applied"]],
        total_applied=result["total_applied"],
        leftover_requested=result["leftover_requested"],
        invoice_paid=result["invoice_paid"],
        invoice_outstanding=result["invoice_outstanding"],
        invoice_status=result["invoice_status"],
    )


# ---- Transaction side ----------------------------------------------------

@router.get(
    "/transactions/{tid}/allocatable-invoices",
    response_model=list[AllocatableInvoiceRow],
)
async def list_allocatable_invoices(
    tid: int,
    include_zero: bool = False,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[AllocatableInvoiceRow]:
    txn = await db.get(Transaction, tid)
    if not txn or txn.deleted_at is not None:
        raise HTTPException(404, "transaction_not_found")
    await ensure_project_access(db, user, txn.project_id)

    inv_type = InvoiceType.IN if txn.type == TxnType.OUT else InvoiceType.OUT

    sum_alloc = (
        select(
            InvoiceAllocation.invoice_id,
            func.coalesce(func.sum(InvoiceAllocation.allocated_amount), 0).label("alloc_sum"),
        )
        .where(InvoiceAllocation.deleted_at.is_(None))
        .group_by(InvoiceAllocation.invoice_id)
        .subquery()
    )

    stmt = (
        select(Invoice, func.coalesce(sum_alloc.c.alloc_sum, 0))
        .outerjoin(sum_alloc, sum_alloc.c.invoice_id == Invoice.id)
        .where(
            Invoice.project_id == txn.project_id,
            Invoice.type == inv_type,
            Invoice.deleted_at.is_(None),
            Invoice.status.in_(ALLOCATABLE_INVOICE_STATUSES + (InvoiceStatus.DRAFT,)),
        )
        .order_by(Invoice.invoice_date.desc(), Invoice.id.desc())
    )
    rows = (await db.execute(stmt)).all()
    out: list[AllocatableInvoiceRow] = []
    for i, alloc_sum in rows:
        total = Decimal(i.total or 0)
        paid = Decimal(alloc_sum or 0)
        outstanding = total - paid
        if outstanding <= 0 and not include_zero:
            continue
        out.append(AllocatableInvoiceRow(
            id=i.id, number=i.number, invoice_date=i.invoice_date,
            due_date=i.due_date, type=i.type, party_name=i.party_name,
            status=i.status,
            total_amount=total, paid_amount=paid, outstanding_amount=outstanding,
        ))
    return out


@router.post(
    "/transactions/{tid}/allocations",
    status_code=201,
)
async def create_transaction_allocations(
    tid: int,
    payload: AllocationCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_can_write),
) -> dict:
    txn = await db.get(Transaction, tid)
    if not txn or txn.deleted_at is not None:
        raise HTTPException(404, "transaction_not_found")
    await ensure_project_access(db, user, txn.project_id)

    items: list[tuple[int, Decimal]] = []
    for it in payload.items:
        if it.invoice_id is None:
            raise HTTPException(422, "invoice_id_required")
        items.append((it.invoice_id, Decimal(it.requested_amount)))

    results = await apply_allocations_to_transaction(
        db, transaction_id=tid, items=items, note=payload.note, user_id=user.id,
    )
    await log(
        db, user_id=user.id, entity="transaction_allocation", entity_id=tid,
        action=AuditAction.CREATE,
        after={"results": [{"invoice_id": r["invoice_id"],
                             "applied": str(r.get("applied", "0"))} for r in results]},
        note=payload.note,
    )
    await db.commit()

    # Hitung sisa transaksi setelah commit
    remaining = Decimal(txn.amount or 0) - await transaction_allocated(db, txn.id)
    return {
        "results": results,
        "transaction_remaining": str(remaining),
    }


# ---- Allocation row level ------------------------------------------------

@router.patch("/allocations/{aid}", response_model=AllocationOut)
async def patch_allocation_row(
    aid: int,
    payload: AllocationPatch,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_can_write),
) -> AllocationOut:
    a = await db.get(InvoiceAllocation, aid)
    if not a or a.deleted_at is not None:
        raise HTTPException(404, "allocation_not_found")
    inv = await db.get(Invoice, a.invoice_id)
    if not inv:
        raise HTTPException(404, "invoice_not_found")
    await ensure_project_access(db, user, inv.project_id)

    updated = await patch_allocation(db, allocation_id=aid, new_amount=payload.allocated_amount)
    await log(
        db, user_id=user.id, entity="invoice_allocation", entity_id=aid,
        action=AuditAction.UPDATE,
        after={"allocated_amount": str(updated.allocated_amount)},
    )
    await db.commit()
    return AllocationOut.model_validate(updated)


@router.delete("/allocations/{aid}", status_code=204)
async def delete_allocation_row(
    aid: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_can_write),
) -> None:
    a = await db.get(InvoiceAllocation, aid)
    if not a or a.deleted_at is not None:
        raise HTTPException(404, "allocation_not_found")
    inv = await db.get(Invoice, a.invoice_id)
    if not inv:
        raise HTTPException(404, "invoice_not_found")
    await ensure_project_access(db, user, inv.project_id)
    await delete_allocation(db, allocation_id=aid)
    await log(
        db, user_id=user.id, entity="invoice_allocation", entity_id=aid,
        action=AuditAction.DELETE,
    )
    await db.commit()
