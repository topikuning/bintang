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


class TransactionOut(TransactionBase):
    id: int
    status: TxnStatus
    created_by_id: int
    verified_by_id: int | None = None
    verified_at: datetime | None = None
    cancel_reason: str | None = None
    created_at: datetime
    attachments: list[AttachmentOut] = []

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
    """Ringkasan transaksi pembayaran yang terhubung ke invoice."""
    id: int
    tx_date: date
    type: TxnType
    amount: Decimal
    status: TxnStatus
    payment_method: PaymentMethod
    reference_no: str | None = None
    description: str | None = None
    created_at: datetime

    class Config:
        from_attributes = True


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
    remaining: Decimal = Decimal("0")
    attachments: list[AttachmentOut] = []
    items: list[InvoiceItemOut] = []
    payments: list[InvoicePayment] = []

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
