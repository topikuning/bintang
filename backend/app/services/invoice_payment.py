"""Pelunasan tagihan (invoice): satu tempat untuk tiga jalur.

Dipakai oleh:
- `POST /invoices/{id}/mark-paid` dan `/invoices/bulk/mark-paid` (aplikasi);
- alur PO lewat WhatsApp (`BAYAR PO12` + foto bukti, `services/wa_po_flow.py`).

Aturannya tetap sama dengan sebelumnya: transaksi pelunasan dibuat langsung
VERIFIED sebesar sisa tagihan, lalu dialokasikan lewat service alokasi
(yang menaikkan status invoice ke PAID). Pemanggil yang melakukan commit.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import (
    AuditAction,
    Invoice,
    InvoiceStatus,
    InvoiceType,
    PaymentMethod,
    Transaction,
    TxnStatus,
    TxnType,
    User,
)
from app.services.audit import log, snapshot
from app.services.invoice_status import paid_amount


async def lunasi_invoice(
    db: AsyncSession,
    inv: Invoice,
    actor: User,
    *,
    catatan_audit: str,
    catatan_alokasi: str,
    keterangan: str | None = None,
    tx_date: date | None = None,
) -> tuple[Transaction | None, Decimal]:
    """Buat transaksi VERIFIED untuk sisa tagihan lalu alokasikan.

    Return `(transaksi, sisa)`. Kalau tagihan sudah tertutup oleh alokasi
    sebelumnya, status dipastikan PAID dan return `(None, 0)`.
    """
    from app.services.allocation import apply_allocations_to_invoice

    total = Decimal(inv.total or 0)
    paid = await paid_amount(db, inv.id)
    outstanding = total - paid
    if outstanding <= 0:
        inv.status = InvoiceStatus.PAID
        return None, Decimal("0")

    tx_type = TxnType.OUT if inv.type == InvoiceType.IN else TxnType.IN
    new_tx = Transaction(
        project_id=inv.project_id,
        tx_date=tx_date or date.today(),
        type=tx_type,
        amount=outstanding,
        party_name=inv.party_name,
        vendor_client_id=inv.vendor_client_id,
        payment_method=PaymentMethod.TRANSFER,
        description=keterangan or f"Pelunasan invoice {inv.number}",
        status=TxnStatus.VERIFIED,
        verified_by_id=actor.id,
        verified_at=datetime.now(UTC),
        created_by_id=actor.id,
    )
    db.add(new_tx)
    await db.flush()
    await log(
        db,
        user_id=actor.id,
        entity="transaction",
        entity_id=new_tx.id,
        action=AuditAction.CREATE,
        after=snapshot(new_tx),
        note=catatan_audit,
    )
    await apply_allocations_to_invoice(
        db,
        invoice_id=inv.id,
        items=[(new_tx.id, outstanding)],
        note=catatan_alokasi,
        user_id=actor.id,
    )
    return new_tx, outstanding
