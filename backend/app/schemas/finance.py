from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel

from app.models.models import (
    InvoiceStatus,
    InvoiceType,
    PartyType,
    PaymentMethod,
    POStatus,
    TxnStatus,
    TxnType,
)


class AttachmentOut(BaseModel):
    id: int
    file_name: str
    file_size: int
    mime_type: str
    url: str
    created_at: datetime

    class Config:
        from_attributes = True


class ExternalLinkIn(BaseModel):
    """Tambah lampiran berupa link eksternal (mis. Google Drive)."""
    url: str
    label: str | None = None        # dipakai sebagai file_name kalau diisi
    file_name: str | None = None    # override eksplisit nama file


# --- Transaction ---
class TransactionBase(BaseModel):
    project_id: int
    tx_date: date
    type: TxnType
    category_id: int | None = None
    amount: Decimal
    party_type: PartyType | None = None
    party_name: str | None = None
    party_id_number: str | None = None
    party_account: str | None = None
    vendor_client_id: int | None = None
    payment_method: PaymentMethod = PaymentMethod.TRANSFER
    reference_no: str | None = None
    description: str | None = None
    usage_note: str | None = None
    invoice_id: int | None = None
    purchase_order_id: int | None = None


class TransactionCreate(TransactionBase):
    pass


class TransactionUpdate(BaseModel):
    tx_date: date | None = None
    category_id: int | None = None
    amount: Decimal | None = None
    party_type: PartyType | None = None
    party_name: str | None = None
    party_id_number: str | None = None
    party_account: str | None = None
    vendor_client_id: int | None = None
    payment_method: PaymentMethod | None = None
    reference_no: str | None = None
    description: str | None = None
    usage_note: str | None = None
    invoice_id: int | None = None
    purchase_order_id: int | None = None


class TransactionAllocationRef(BaseModel):
    """Ringkasan alokasi yang dipakai pada response Transaction."""
    id: int                       # allocation_id
    invoice_id: int
    invoice_number: str | None = None
    invoice_total: Decimal
    invoice_status: InvoiceStatus
    allocated_amount: Decimal


class TransactionOut(TransactionBase):
    id: int
    status: TxnStatus
    created_by_id: int
    verified_by_id: int | None = None
    verified_at: datetime | None = None
    cancel_reason: str | None = None
    created_at: datetime
    attachments: list[AttachmentOut] = []
    allocated_amount: Decimal = Decimal("0")
    remaining_amount: Decimal = Decimal("0")
    allocations: list[TransactionAllocationRef] = []

    class Config:
        from_attributes = True


class CancelIn(BaseModel):
    reason: str


# --- Invoice ---
class InvoiceItemIn(BaseModel):
    description: str
    quantity: Decimal = Decimal("1")
    unit: str | None = None
    unit_price: Decimal = Decimal("0")


class InvoiceItemOut(InvoiceItemIn):
    id: int
    subtotal: Decimal

    class Config:
        from_attributes = True


class InvoicePayment(BaseModel):
    """Ringkasan transaksi pembayaran yang terhubung ke invoice
    (lewat tabel `invoice_allocations`).
    """
    id: int                              # transaction_id
    allocation_id: int
    tx_date: date
    type: TxnType
    amount: Decimal                       # nilai yang dialokasikan ke invoice ini
    transaction_total: Decimal            # nilai total transaksi
    status: TxnStatus
    payment_method: PaymentMethod
    reference_no: str | None = None
    description: str | None = None
    created_at: datetime


class AllocationItemIn(BaseModel):
    """Satu baris alokasi (digunakan oleh kedua arah API)."""
    transaction_id: int | None = None     # diisi pada endpoint invoice-side
    invoice_id: int | None = None         # diisi pada endpoint transaction-side
    requested_amount: Decimal


class AllocationCreate(BaseModel):
    items: list[AllocationItemIn]
    note: str | None = None


class AllocationOut(BaseModel):
    """Detail satu baris alokasi."""
    id: int
    transaction_id: int
    invoice_id: int
    allocated_amount: Decimal
    note: str | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class AllocationApplyResult(BaseModel):
    """Respons setelah create allocation (auto-cap)."""
    applied: list[AllocationOut]
    total_applied: Decimal
    leftover_requested: Decimal
    invoice_paid: Decimal
    invoice_outstanding: Decimal
    invoice_status: InvoiceStatus


class AllocationPatch(BaseModel):
    allocated_amount: Decimal


class AllocatableTransactionRow(BaseModel):
    """Kandidat transaksi untuk dialokasikan ke invoice."""
    id: int
    tx_date: date
    type: TxnType
    party_name: str | None = None
    payment_method: PaymentMethod
    reference_no: str | None = None
    description: str | None = None
    status: TxnStatus
    total_amount: Decimal
    allocated_amount: Decimal
    remaining_amount: Decimal


class AllocatableInvoiceRow(BaseModel):
    """Kandidat invoice untuk dialokasikan dari sebuah transaksi."""
    id: int
    number: str
    invoice_date: date
    due_date: date | None = None
    type: InvoiceType
    party_name: str | None = None
    status: InvoiceStatus
    total_amount: Decimal
    paid_amount: Decimal
    outstanding_amount: Decimal


class InvoiceBase(BaseModel):
    number: str
    project_id: int
    type: InvoiceType
    invoice_date: date
    due_date: date | None = None
    vendor_client_id: int | None = None
    party_name: str | None = None
    tax: Decimal = Decimal("0")
    notes: str | None = None


class InvoiceCreate(InvoiceBase):
    items: list[InvoiceItemIn] = []


class InvoiceUpdate(BaseModel):
    number: str | None = None
    type: InvoiceType | None = None  # ubah Hutang/Piutang -- gated SUPERADMIN bila status >= ISSUED
    invoice_date: date | None = None
    due_date: date | None = None
    vendor_client_id: int | None = None
    party_name: str | None = None
    tax: Decimal | None = None
    notes: str | None = None
    status: InvoiceStatus | None = None
    items: list[InvoiceItemIn] | None = None


class InvoiceOut(InvoiceBase):
    id: int
    subtotal: Decimal
    total: Decimal
    status: InvoiceStatus
    created_by_id: int
    created_at: datetime
    paid_amount: Decimal = Decimal("0")
    remaining: Decimal = Decimal("0")            # alias outstanding_amount
    outstanding_amount: Decimal = Decimal("0")
    attachments: list[AttachmentOut] = []
    items: list[InvoiceItemOut] = []
    payments: list[InvoicePayment] = []          # 1 baris per allocation aktif

    class Config:
        from_attributes = True


# --- Purchase Order ---
class POItemIn(BaseModel):
    description: str
    quantity: Decimal = Decimal("1")
    unit: str | None = None
    unit_price: Decimal = Decimal("0")


class POItemOut(POItemIn):
    id: int
    subtotal: Decimal

    class Config:
        from_attributes = True


class POBase(BaseModel):
    project_id: int
    company_id: int
    vendor_client_id: int | None = None
    vendor_name: str | None = None
    po_date: date
    needed_date: date | None = None
    tax: Decimal = Decimal("0")
    discount: Decimal = Decimal("0")
    payment_terms: str | None = None
    notes: str | None = None


class POCreate(POBase):
    items: list[POItemIn]


class POUpdate(BaseModel):
    vendor_client_id: int | None = None
    vendor_name: str | None = None
    po_date: date | None = None
    needed_date: date | None = None
    tax: Decimal | None = None
    discount: Decimal | None = None
    payment_terms: str | None = None
    notes: str | None = None
    items: list[POItemIn] | None = None


class POOut(POBase):
    id: int
    number: str
    subtotal: Decimal
    total: Decimal
    status: POStatus
    created_by_id: int
    approved_by_id: int | None = None
    approved_at: datetime | None = None
    cancel_reason: str | None = None
    created_at: datetime
    items: list[POItemOut] = []

    class Config:
        from_attributes = True
