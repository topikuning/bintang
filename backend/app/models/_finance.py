"""Models -- Transaction, Invoice, PurchaseOrder + child items/attachments.

Audit 2026-05-22 #M1: split dari models.py (1072 baris). Class-class
di sini bisa pakai string forward-ref ("OtherClass") utk relationship
ke modul lain -- SQLAlchemy resolve via Base.registry.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin
from app.services.field_crypto import EncryptedString

from ._enums import *  # noqa: F401, F403


class Transaction(TimestampMixin, Base):
    __tablename__ = "transactions"
    __table_args__ = (
        Index("ix_transactions_project_date", "project_id", "tx_date"),
        # Hot-path filter combos di reports/cashflow/transactions list:
        # (project, status, type) -- arus kas verified per proyek/arah.
        Index("ix_transactions_project_status_type", "project_id", "status", "type"),
        # Soft-delete filter ada di hampir semua query.
        Index("ix_transactions_deleted_at", "deleted_at"),
        # Lookup dari invoice_allocations / detail invoice.
        Index("ix_transactions_invoice_id", "invoice_id"),
        Index("ix_transactions_vendor_client", "vendor_client_id"),
        # Defense-in-depth: pencegahan amount negatif di level DB.
        # Validasi sudah ada di Pydantic, tapi direct SQL/ORM bug bisa
        # bypass. Audit 2026-05-22 #C4.
        CheckConstraint("amount > 0", name="ck_transactions_amount_positive"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), nullable=False, index=True)
    tx_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    type: Mapped[TxnType] = mapped_column(Enum(TxnType), nullable=False, index=True)
    # Sub-jenis tx OUT (akunting). Default INVOICE_PAYMENT supaya legacy
    # data tdk perlu re-tagging. Hanya bermakna utk type=OUT.
    kind: Mapped[TxnKind] = mapped_column(
        String(40),
        default=TxnKind.INVOICE_PAYMENT.value,
        nullable=False,
        index=True,
    )
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"), nullable=True, index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    # Untuk kind=CASH_ADVANCE -- penerima uang muka (hybrid: bisa FK ke
    # User akun, atau hanya string nama bebas utk staff yg belum punya akun).
    # Salah satu wajib diisi kalau kind=CASH_ADVANCE.
    recipient_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True, index=True
    )
    recipient_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Untuk kind=CASH_ADVANCE -- link ke top-up tx kalau settlement overpay.
    # Untuk DIRECT_EXPENSE auto-generated -- link balik ke advance asal.
    parent_advance_tx_id: Mapped[int | None] = mapped_column(
        ForeignKey("transactions.id"), nullable=True
    )

    party_type: Mapped[PartyType | None] = mapped_column(Enum(PartyType), nullable=True)
    party_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    party_id_number: Mapped[str | None] = mapped_column(String(80), nullable=True)
    # Encrypted at rest (nomor rekening pihak ke-3). Audit 2026-05-22 #C3.
    party_account: Mapped[str | None] = mapped_column(EncryptedString(500), nullable=True)
    vendor_client_id: Mapped[int | None] = mapped_column(
        ForeignKey("vendors_clients.id"), nullable=True
    )

    payment_method: Mapped[PaymentMethod] = mapped_column(
        Enum(PaymentMethod), default=PaymentMethod.TRANSFER
    )
    reference_no: Mapped[str | None] = mapped_column(String(120), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    usage_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[TxnStatus] = mapped_column(Enum(TxnStatus), default=TxnStatus.DRAFT, index=True)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    invoice_id: Mapped[int | None] = mapped_column(ForeignKey("invoices.id"), nullable=True)
    purchase_order_id: Mapped[int | None] = mapped_column(
        ForeignKey("purchase_orders.id"), nullable=True
    )

    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    verified_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    attachments: Mapped[list[TransactionAttachment]] = relationship(
        back_populates="transaction", cascade="all,delete-orphan"
    )
    # Multi-line breakdown utk DIRECT_EXPENSE (rincian pengeluaran per item).
    items: Mapped[list["TransactionItem"]] = relationship(
        back_populates="transaction",
        cascade="all,delete-orphan",
        order_by="TransactionItem.id",
    )
    # Settlement utk CASH_ADVANCE. 1 advance = max 1 settlement (unique).
    settlement: Mapped["CashAdvanceSettlement | None"] = relationship(
        back_populates="cash_advance",
        cascade="all,delete-orphan",
        uselist=False,
        foreign_keys="CashAdvanceSettlement.cash_advance_tx_id",
    )


class TransactionItem(TimestampMixin, Base):
    """Multi-line item breakdown utk transaksi (terutama DIRECT_EXPENSE).
    Total transaksi = SUM(items.amount). Validasi di endpoint."""
    __tablename__ = "transaction_items"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_transaction_items_amount_positive"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    transaction_id: Mapped[int] = mapped_column(
        ForeignKey("transactions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id"), nullable=True
    )
    description: Mapped[str] = mapped_column(String(300), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)

    transaction: Mapped[Transaction] = relationship(back_populates="items")



class TransactionAttachment(TimestampMixin, Base):
    __tablename__ = "transaction_attachments"

    id: Mapped[int] = mapped_column(primary_key=True)
    transaction_id: Mapped[int] = mapped_column(
        ForeignKey("transactions.id", ondelete="CASCADE")
    )
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(120), nullable=False)
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    uploaded_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)

    transaction: Mapped[Transaction] = relationship(back_populates="attachments")


# --- Invoice ---

class Invoice(TimestampMixin, Base):
    __tablename__ = "invoices"
    __table_args__ = (
        # Filter umum: per proyek + status (laporan, list invoices).
        Index("ix_invoices_project_status", "project_id", "status"),
        # Soft-delete + due-date scan utk hutang/piutang aging.
        Index("ix_invoices_deleted_at", "deleted_at"),
        Index("ix_invoices_due_date", "due_date"),
        Index("ix_invoices_invoice_date", "invoice_date"),
        # Amount fields tdk boleh negatif (credit note di-modelkan terpisah
        # nanti kalau perlu, bukan via invoice negatif).
        CheckConstraint("subtotal >= 0", name="ck_invoices_subtotal_nonneg"),
        CheckConstraint("tax >= 0", name="ck_invoices_tax_nonneg"),
        CheckConstraint("total >= 0", name="ck_invoices_total_nonneg"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # Nomor invoice WAJIB unik global. Sumber kebenaran utk dokumen legal
    # (Faktur Pajak ID hrs unik per perusahaan; kita pakai global utk
    # invariant terkuat -- format bisa di-embed company prefix).
    # Sebelumnya hanya index, bukan unique -> bug data integrity (dup
    # bisa terjadi).
    number: Mapped[str] = mapped_column(String(80), nullable=False, unique=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), nullable=False, index=True)
    type: Mapped[InvoiceType] = mapped_column(Enum(InvoiceType), nullable=False, index=True)
    invoice_date: Mapped[date] = mapped_column(Date, nullable=False)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    vendor_client_id: Mapped[int | None] = mapped_column(
        ForeignKey("vendors_clients.id"), nullable=True, index=True
    )
    party_name: Mapped[str | None] = mapped_column(String(200), nullable=True)

    subtotal: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"))
    tax: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"))
    total: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"))

    status: Mapped[InvoiceStatus] = mapped_column(Enum(InvoiceStatus), default=InvoiceStatus.DRAFT, index=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)

    attachments: Mapped[list[InvoiceAttachment]] = relationship(
        back_populates="invoice", cascade="all,delete-orphan"
    )
    items: Mapped[list[InvoiceItem]] = relationship(
        back_populates="invoice", cascade="all,delete-orphan", order_by="InvoiceItem.id"
    )
    allocations: Mapped[list["InvoiceAllocation"]] = relationship(
        back_populates="invoice", cascade="all,delete-orphan",
        primaryjoin="and_(Invoice.id==InvoiceAllocation.invoice_id, "
                    "InvoiceAllocation.deleted_at.is_(None))",
        order_by="InvoiceAllocation.id",
    )


class InvoiceAllocation(TimestampMixin, Base):
    """Bridging table M:N antara Transaction dan Invoice.

    Satu baris = sebagian (atau seluruh) nilai transaksi diperhitungkan
    untuk membayar sebuah invoice. Constraint:
      - allocated_amount > 0 dan presisi 2 desimal
      - hanya satu baris aktif per pasangan (transaction_id, invoice_id);
        untuk menambah jumlah, update baris yang sama, jangan duplikat.
    Sumber kebenaran tunggal untuk paid_amount/outstanding/remaining.
    """
    __tablename__ = "invoice_allocations"
    __table_args__ = (
        UniqueConstraint("transaction_id", "invoice_id", "deleted_at",
                         name="uq_alloc_pair"),
        CheckConstraint("allocated_amount > 0", name="ck_alloc_positive"),
        Index("ix_alloc_txn", "transaction_id"),
        Index("ix_alloc_inv", "invoice_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    transaction_id: Mapped[int] = mapped_column(
        ForeignKey("transactions.id", ondelete="RESTRICT"), nullable=False
    )
    invoice_id: Mapped[int] = mapped_column(
        ForeignKey("invoices.id", ondelete="RESTRICT"), nullable=False
    )
    allocated_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)

    invoice: Mapped[Invoice] = relationship(back_populates="allocations")
    transaction: Mapped["Transaction"] = relationship()


class InvoiceItem(TimestampMixin, Base):
    __tablename__ = "invoice_items"
    __table_args__ = (
        # Quantity > 0 wajib (line item kosong tdk masuk akal).
        CheckConstraint("quantity > 0", name="ck_invoice_items_quantity_positive"),
        # Unit price boleh 0 (mis. free promo/sample item), tapi tdk negatif.
        CheckConstraint("unit_price >= 0", name="ck_invoice_items_unit_price_nonneg"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id", ondelete="CASCADE"))
    description: Mapped[str] = mapped_column(String(500), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("1"))
    unit: Mapped[str | None] = mapped_column(String(40), nullable=True)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"))
    subtotal: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"))

    invoice: Mapped[Invoice] = relationship(back_populates="items")


class InvoiceAttachment(TimestampMixin, Base):
    __tablename__ = "invoice_attachments"

    id: Mapped[int] = mapped_column(primary_key=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id", ondelete="CASCADE"))
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(120), nullable=False)
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    uploaded_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)

    invoice: Mapped[Invoice] = relationship(back_populates="attachments")


# --- Purchase Order ---

class PurchaseOrder(TimestampMixin, Base):
    __tablename__ = "purchase_orders"
    __table_args__ = (
        Index("ix_po_project_status", "project_id", "status"),
        Index("ix_po_deleted_at", "deleted_at"),
        Index("ix_po_po_date", "po_date"),
        # Amount fields tdk boleh negatif.
        CheckConstraint("subtotal >= 0", name="ck_po_subtotal_nonneg"),
        CheckConstraint("tax >= 0", name="ck_po_tax_nonneg"),
        CheckConstraint("discount >= 0", name="ck_po_discount_nonneg"),
        CheckConstraint("total >= 0", name="ck_po_total_nonneg"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[str] = mapped_column(String(80), unique=True, nullable=False, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), nullable=False, index=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), nullable=False, index=True)
    vendor_client_id: Mapped[int | None] = mapped_column(
        ForeignKey("vendors_clients.id"), nullable=True, index=True
    )
    vendor_name: Mapped[str | None] = mapped_column(String(200), nullable=True)

    po_date: Mapped[date] = mapped_column(Date, nullable=False)
    needed_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    subtotal: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"))
    tax: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"))
    discount: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"))
    total: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"))

    payment_terms: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[POStatus] = mapped_column(Enum(POStatus), default=POStatus.DRAFT, index=True)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    approved_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    items: Mapped[list[POItem]] = relationship(
        back_populates="po", cascade="all,delete-orphan", order_by="POItem.id"
    )


class POItem(TimestampMixin, Base):
    __tablename__ = "po_items"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_po_items_quantity_positive"),
        CheckConstraint("unit_price >= 0", name="ck_po_items_unit_price_nonneg"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    po_id: Mapped[int] = mapped_column(ForeignKey("purchase_orders.id", ondelete="CASCADE"))
    description: Mapped[str] = mapped_column(String(500), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("1"))
    unit: Mapped[str | None] = mapped_column(String(40), nullable=True)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"))
    subtotal: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"))

    po: Mapped[PurchaseOrder] = relationship(back_populates="items")


# --- Audit + AI ---
