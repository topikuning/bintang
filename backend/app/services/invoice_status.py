from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import Invoice, InvoiceStatus, Transaction, TxnStatus


async def paid_amount(db: AsyncSession, invoice_id: int) -> Decimal:
    q = select(func.coalesce(func.sum(Transaction.amount), 0)).where(
        Transaction.invoice_id == invoice_id,
        Transaction.status == TxnStatus.VERIFIED,
        Transaction.deleted_at.is_(None),
    )
    return Decimal((await db.execute(q)).scalar_one() or 0)


async def recompute_invoice_status(db: AsyncSession, invoice: Invoice) -> Decimal:
    paid = await paid_amount(db, invoice.id)
    total = Decimal(invoice.total or 0)
    if invoice.status == InvoiceStatus.CANCELLED:
        return paid
    if paid <= 0:
        if invoice.status == InvoiceStatus.DRAFT:
            return paid
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
