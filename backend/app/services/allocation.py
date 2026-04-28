"""Allocation service: pasangan M:N antara Transaction dan Invoice.

Algoritma & invariannya didefinisikan di catatan desain:
  Σ allocated_amount per transaction <= transaction.amount
  Σ allocated_amount per invoice     <= invoice.total

Semua operasi membutuhkan AsyncSession yang dijalankan di dalam satu DB
transaction. Caller bertanggung jawab memanggil `db.commit()` setelah
operasi berhasil; jika gagal, raise HTTPException agar middleware
melakukan rollback.

Penguncian:
  - SELECT ... FOR UPDATE pada Invoice tunggal,
  - lalu pada semua Transaction yang terlibat (urutan id ASC) untuk
    mencegah deadlock pada akses bersilangan dari kedua sisi API.
SQLite tidak men-support FOR UPDATE; di dev kita rely pada serializable
transaction default-nya. Di prod (Postgres) lock benar-benar dipakai.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import Iterable

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.models import (
    Invoice,
    InvoiceAllocation,
    InvoiceStatus,
    InvoiceType,
    Transaction,
    TxnStatus,
    TxnType,
)

ZERO = Decimal("0")
TWO = Decimal("0.01")


def q2(v: Decimal | int | float | str) -> Decimal:
    """Quantize ke 2 desimal HALF_UP. Sumber kebenaran presisi uang."""
    return Decimal(str(v)).quantize(TWO, rounding=ROUND_HALF_UP)


def direction_compatible(invoice_type: InvoiceType, txn_type: TxnType) -> bool:
    return (invoice_type == InvoiceType.IN and txn_type == TxnType.OUT) or (
        invoice_type == InvoiceType.OUT and txn_type == TxnType.IN
    )


# Statuses yang boleh dialokasikan
ALLOCATABLE_INVOICE_STATUSES = (
    InvoiceStatus.ISSUED,
    InvoiceStatus.PARTIALLY_PAID,
    InvoiceStatus.OVERDUE,
)
# DRAFT juga diizinkan agar form pembayaran bisa langsung di-attach saat
# user membuat invoice + langsung mark paid (issue + allocate). Backend
# auto-issue kalau invoice masih DRAFT.
ALLOCATABLE_TXN_STATUSES = (
    TxnStatus.DRAFT,
    TxnStatus.SUBMITTED,
    TxnStatus.VERIFIED,
)


def _sum_allocs_for_txn():
    return select(func.coalesce(func.sum(InvoiceAllocation.allocated_amount), 0)).where(
        InvoiceAllocation.deleted_at.is_(None),
    )


async def transaction_allocated(db: AsyncSession, txn_id: int) -> Decimal:
    q = _sum_allocs_for_txn().where(InvoiceAllocation.transaction_id == txn_id)
    return Decimal((await db.execute(q)).scalar_one() or 0)


async def invoice_allocated(db: AsyncSession, invoice_id: int) -> Decimal:
    q = _sum_allocs_for_txn().where(InvoiceAllocation.invoice_id == invoice_id)
    return Decimal((await db.execute(q)).scalar_one() or 0)


async def transaction_remaining(db: AsyncSession, txn: Transaction) -> Decimal:
    return q2(Decimal(txn.amount or 0) - await transaction_allocated(db, txn.id))


async def invoice_outstanding(db: AsyncSession, inv: Invoice) -> Decimal:
    return q2(Decimal(inv.total or 0) - await invoice_allocated(db, inv.id))


def _lock(stmt):
    """Tambah FOR UPDATE bila DB-nya bukan SQLite."""
    if settings.is_sqlite:
        return stmt
    return stmt.with_for_update()


async def _load_invoice_locked(db: AsyncSession, invoice_id: int) -> Invoice:
    res = await db.execute(_lock(select(Invoice).where(Invoice.id == invoice_id)))
    inv = res.scalar_one_or_none()
    if not inv or inv.deleted_at is not None:
        raise HTTPException(404, "invoice_not_found")
    return inv


async def _load_txns_locked(
    db: AsyncSession, txn_ids: Iterable[int]
) -> dict[int, Transaction]:
    ids = sorted(set(txn_ids))
    if not ids:
        return {}
    res = await db.execute(
        _lock(select(Transaction).where(Transaction.id.in_(ids)).order_by(Transaction.id))
    )
    txns = {t.id: t for t in res.scalars().all()}
    missing = [i for i in ids if i not in txns]
    if missing:
        raise HTTPException(404, f"transactions_not_found:{missing}")
    return txns


async def _recompute_invoice_status(db: AsyncSession, inv: Invoice) -> None:
    """Update status invoice menurut paid/outstanding hasil alokasi.
    DRAFT dan CANCELLED tidak diubah otomatis; OVERDUE dipertahankan
    sampai due_date lewat (logic itu hidup di endpoint, bukan di sini).
    """
    if inv.status in (InvoiceStatus.DRAFT, InvoiceStatus.CANCELLED):
        return
    paid = await invoice_allocated(db, inv.id)
    total = Decimal(inv.total or 0)
    if paid <= 0:
        inv.status = InvoiceStatus.ISSUED
    elif paid < total:
        inv.status = InvoiceStatus.PARTIALLY_PAID
    else:
        inv.status = InvoiceStatus.PAID


async def apply_allocations_to_invoice(
    db: AsyncSession,
    *,
    invoice_id: int,
    items: list[tuple[int, Decimal]],
    note: str | None,
    user_id: int,
) -> dict:
    """Alokasikan banyak transaksi ke 1 invoice (auto-cap).

    `items` = [(transaction_id, requested_amount), ...]
    Mengembalikan dict siap-dijadikan AllocationApplyResult.
    """
    inv = await _load_invoice_locked(db, invoice_id)
    if inv.status not in ALLOCATABLE_INVOICE_STATUSES and inv.status != InvoiceStatus.DRAFT:
        raise HTTPException(409, "invoice_not_allocatable")
    # Auto-issue kalau masih DRAFT (mark sebagai ISSUED supaya pembayaran tercatat).
    if inv.status == InvoiceStatus.DRAFT:
        inv.status = InvoiceStatus.ISSUED

    txns = await _load_txns_locked(db, (tid for tid, _ in items))
    inv_total = Decimal(inv.total or 0)
    inv_already_paid = await invoice_allocated(db, inv.id)
    outstanding = q2(inv_total - inv_already_paid)
    if outstanding <= 0:
        raise HTTPException(409, "invoice_already_paid")

    # Pre-fetch alokasi existing per transaction agar bisa update (bukan duplikat)
    existing_per_txn = await _existing_allocations_for_invoice(db, inv.id, list(txns))

    applied_rows: list[InvoiceAllocation] = []
    total_applied = ZERO
    total_requested = ZERO

    for tid, requested in items:
        req = q2(requested)
        if req <= 0:
            raise HTTPException(422, f"invalid_amount:{tid}")
        total_requested += req
        txn = txns[tid]
        if txn.deleted_at is not None or txn.status not in ALLOCATABLE_TXN_STATUSES:
            raise HTTPException(409, f"transaction_not_allocatable:{tid}")
        if txn.project_id != inv.project_id:
            raise HTTPException(409, f"project_mismatch:{tid}")
        if not direction_compatible(inv.type, txn.type):
            raise HTTPException(409, f"direction_mismatch:{tid}")

        txn_remaining = q2(Decimal(txn.amount or 0) - await transaction_allocated(db, txn.id))
        # outstanding sisa setelah loop sebelumnya
        room_invoice = q2(outstanding - total_applied)
        if room_invoice <= 0:
            break
        apply = min(req, txn_remaining, room_invoice)
        if apply <= 0:
            continue

        existing = existing_per_txn.get(tid)
        if existing is None:
            row = InvoiceAllocation(
                transaction_id=tid,
                invoice_id=inv.id,
                allocated_amount=apply,
                note=note,
                created_by_id=user_id,
            )
            db.add(row)
            await db.flush()
            applied_rows.append(row)
            existing_per_txn[tid] = row
        else:
            existing.allocated_amount = q2(Decimal(existing.allocated_amount) + apply)
            applied_rows.append(existing)

        total_applied += apply
        if total_applied >= outstanding:
            break

    await _recompute_invoice_status(db, inv)
    leftover = q2(total_requested - total_applied)

    return {
        "applied": applied_rows,
        "total_applied": q2(total_applied),
        "leftover_requested": leftover if leftover > 0 else ZERO,
        "invoice_paid": q2(inv_already_paid + total_applied),
        "invoice_outstanding": q2(outstanding - total_applied),
        "invoice_status": inv.status,
    }


async def apply_allocations_to_transaction(
    db: AsyncSession,
    *,
    transaction_id: int,
    items: list[tuple[int, Decimal]],
    note: str | None,
    user_id: int,
) -> list[dict]:
    """Alokasikan 1 transaksi ke banyak invoice (auto-cap).

    Mengembalikan list per-invoice dict (status invoice setelah alokasi).
    """
    # Lock transaksi sumber-nya
    res = await db.execute(_lock(select(Transaction).where(Transaction.id == transaction_id)))
    txn = res.scalar_one_or_none()
    if not txn or txn.deleted_at is not None:
        raise HTTPException(404, "transaction_not_found")
    if txn.status not in ALLOCATABLE_TXN_STATUSES:
        raise HTTPException(409, "transaction_not_allocatable")

    txn_remaining = q2(Decimal(txn.amount or 0) - await transaction_allocated(db, txn.id))
    if txn_remaining <= 0:
        raise HTTPException(409, "transaction_fully_used")

    results: list[dict] = []
    total_applied = ZERO

    for inv_id, requested in items:
        req = q2(requested)
        if req <= 0:
            raise HTTPException(422, f"invalid_amount:{inv_id}")
        # Hitung sisa kapasitas transaksi setelah alokasi sebelumnya
        room_txn = q2(txn_remaining - total_applied)
        if room_txn <= 0:
            results.append({
                "invoice_id": inv_id,
                "applied": ZERO,
                "leftover_requested": req,
                "skipped": "transaction_exhausted",
            })
            continue
        single_req = min(req, room_txn)
        sub = await apply_allocations_to_invoice(
            db,
            invoice_id=inv_id,
            items=[(txn.id, single_req)],
            note=note,
            user_id=user_id,
        )
        applied_here = sub["total_applied"]
        total_applied += applied_here
        leftover = q2(req - applied_here)
        results.append({
            "invoice_id": inv_id,
            "applied": applied_here,
            "leftover_requested": leftover if leftover > 0 else ZERO,
            "invoice_status": sub["invoice_status"],
            "invoice_paid": sub["invoice_paid"],
            "invoice_outstanding": sub["invoice_outstanding"],
        })

    return results


async def _existing_allocations_for_invoice(
    db: AsyncSession, invoice_id: int, txn_ids: list[int]
) -> dict[int, InvoiceAllocation]:
    if not txn_ids:
        return {}
    res = await db.execute(
        _lock(
            select(InvoiceAllocation).where(
                InvoiceAllocation.invoice_id == invoice_id,
                InvoiceAllocation.transaction_id.in_(txn_ids),
                InvoiceAllocation.deleted_at.is_(None),
            )
        )
    )
    return {a.transaction_id: a for a in res.scalars().all()}


async def patch_allocation(
    db: AsyncSession,
    *,
    allocation_id: int,
    new_amount: Decimal,
) -> InvoiceAllocation:
    """Edit nilai alokasi (strict, bukan auto-cap). Caller sudah mengecek izin."""
    res = await db.execute(
        _lock(select(InvoiceAllocation).where(InvoiceAllocation.id == allocation_id))
    )
    a = res.scalar_one_or_none()
    if not a or a.deleted_at is not None:
        raise HTTPException(404, "allocation_not_found")

    inv = await _load_invoice_locked(db, a.invoice_id)
    txns = await _load_txns_locked(db, [a.transaction_id])
    txn = txns[a.transaction_id]

    new_amount = q2(new_amount)
    if new_amount <= 0:
        # Setara dengan delete
        await db.delete(a)
        await db.flush()
        await _recompute_invoice_status(db, inv)
        return a

    inv_total = Decimal(inv.total or 0)
    inv_paid_excl_self = q2(await invoice_allocated(db, inv.id) - Decimal(a.allocated_amount))
    txn_total = Decimal(txn.amount or 0)
    txn_alloc_excl_self = q2(await transaction_allocated(db, txn.id) - Decimal(a.allocated_amount))

    inv_outstanding_excl_self = q2(inv_total - inv_paid_excl_self)
    txn_remaining_excl_self = q2(txn_total - txn_alloc_excl_self)

    if new_amount > min(inv_outstanding_excl_self, txn_remaining_excl_self):
        raise HTTPException(409, "exceeds_caps")

    a.allocated_amount = new_amount
    await db.flush()
    await _recompute_invoice_status(db, inv)
    return a


async def delete_allocation(db: AsyncSession, *, allocation_id: int) -> int:
    """Hapus alokasi. Mengembalikan invoice_id agar caller bisa serialisasi."""
    res = await db.execute(
        _lock(select(InvoiceAllocation).where(InvoiceAllocation.id == allocation_id))
    )
    a = res.scalar_one_or_none()
    if not a or a.deleted_at is not None:
        raise HTTPException(404, "allocation_not_found")
    inv = await _load_invoice_locked(db, a.invoice_id)
    invoice_id = inv.id
    await db.delete(a)
    await db.flush()
    await _recompute_invoice_status(db, inv)
    return invoice_id
