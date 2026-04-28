"""Sumber kebenaran paid_amount sekarang = SUM(invoice_allocations).
Tabel `transactions.invoice_id` lama tetap ada tapi tidak lagi
diperhitungkan di sini -- semua jalur baru harus menulis allocation.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import Invoice, InvoiceAllocation, InvoiceStatus


async def paid_amount(db: AsyncSession, invoice_id: int) -> Decimal:
    """Total alokasi aktif untuk invoice ini = paid_amount sebenarnya."""
    q = select(func.coalesce(func.sum(InvoiceAllocation.allocated_amount), 0)).where(
        InvoiceAllocation.invoice_id == invoice_id,
        InvoiceAllocation.deleted_at.is_(None),
    )
    return Decimal((await db.execute(q)).scalar_one() or 0)


# Alias dipertahankan agar pemanggil lama tidak meledak.
linked_amount = paid_amount


async def recompute_invoice_status(db: AsyncSession, invoice: Invoice) -> Decimal:
    """Update status invoice dari paid_amount terkini.
    DRAFT dan CANCELLED tidak otomatis diubah.
    """
    paid = await paid_amount(db, invoice.id)
    total = Decimal(invoice.total or 0)
    if invoice.status == InvoiceStatus.CANCELLED:
        return paid
    if invoice.status == InvoiceStatus.DRAFT and paid <= 0:
        return paid
    if paid <= 0:
        if invoice.due_date and invoice.due_date < date.today():
            invoice.status = InvoiceStatus.OVERDUE
        else:
            invoice.status = InvoiceStatus.ISSUED
    elif paid < total:
        if invoice.due_date and invoice.due_date < date.today():
            invoice.status = InvoiceStatus.OVERDUE
        else:
            invoice.status = InvoiceStatus.PARTIALLY_PAID
    else:
        invoice.status = InvoiceStatus.PAID
    return paid
