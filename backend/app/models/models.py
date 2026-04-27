from __future__ import annotations

import enum
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    JSON,
    Boolean,
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


# --- Enums ---
class UserRole(str, enum.Enum):
    SUPERADMIN = "SUPERADMIN"
    PROJECT_ADMIN = "PROJECT_ADMIN"


class ProjectStatus(str, enum.Enum):
    AKTIF = "AKTIF"
    SELESAI = "SELESAI"
    DITAHAN = "DITAHAN"
    DIBATALKAN = "DIBATALKAN"


class TxnType(str, enum.Enum):
    IN = "IN"
    OUT = "OUT"


class TxnStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    SUBMITTED = "SUBMITTED"
    VERIFIED = "VERIFIED"
    REJECTED = "REJECTED"
    CANCELLED = "CANCELLED"


class PaymentMethod(str, enum.Enum):
    CASH = "CASH"
    TRANSFER = "TRANSFER"
    QRIS = "QRIS"
    GIRO = "GIRO"
    OTHER = "OTHER"


class PartyType(str, enum.Enum):
    COMPANY = "COMPANY"
    PERSONAL = "PERSONAL"
    EMPLOYEE = "EMPLOYEE"
    INTERNAL = "INTERNAL"
    OTHER = "OTHER"


class InvoiceType(str, enum.Enum):
    IN = "IN"   # invoice masuk dari vendor
    OUT = "OUT"  # tagihan ke client


class InvoiceStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    ISSUED = "ISSUED"
    PARTIALLY_PAID = "PARTIALLY_PAID"
    PAID = "PAID"
    OVERDUE = "OVERDUE"
    CANCELLED = "CANCELLED"


class POStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    ISSUED = "ISSUED"
    APPROVED = "APPROVED"
    PARTIALLY_FULFILLED = "PARTIALLY_FULFILLED"
    FULFILLED = "FULFILLED"
    CANCELLED = "CANCELLED"


class CategoryType(str, enum.Enum):
    IN = "IN"
    OUT = "OUT"


class VendorClientType(str, enum.Enum):
    VENDOR = "VENDOR"
    CLIENT = "CLIENT"
    BOTH = "BOTH"


class AIExtractionStatus(str, enum.Enum):
    PENDING = "PENDING"
    DONE = "DONE"
    FAILED = "FAILED"
    REVIEWED = "REVIEWED"


class AuditAction(str, enum.Enum):
    CREATE = "CREATE"
    UPDATE = "UPDATE"
    DELETE = "DELETE"
    VERIFY = "VERIFY"
    CANCEL = "CANCEL"
    APPROVE = "APPROVE"


# --- Core entities ---
class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), default=UserRole.PROJECT_ADMIN)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)

    project_links: Mapped[list[ProjectUser]] = relationship(back_populates="user", cascade="all,delete-orphan")


class Company(TimestampMixin, Base):
    __tablename__ = "companies"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    npwp: Mapped[str | None] = mapped_column(String(40), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    email: Mapped[str | None] = mapped_column(String(120), nullable=True)
    logo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    letterhead_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    director_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    bank_account: Mapped[str | None] = mapped_column(String(200), nullable=True)

    projects: Mapped[list[Project]] = relationship(back_populates="company")


class Project(TimestampMixin, Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    location: Mapped[str | None] = mapped_column(String(200), nullable=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), nullable=False)
    pic_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[ProjectStatus] = mapped_column(Enum(ProjectStatus), default=ProjectStatus.AKTIF)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # budget control
    budget_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"))
    currency: Mapped[str] = mapped_column(String(8), default="IDR")
    overbudget_tolerance_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0"))

    company: Mapped[Company] = relationship(back_populates="projects")
    user_links: Mapped[list[ProjectUser]] = relationship(
        back_populates="project", cascade="all,delete-orphan"
    )


class ProjectUser(TimestampMixin, Base):
    __tablename__ = "project_users"
    __table_args__ = (UniqueConstraint("project_id", "user_id", name="uq_project_user"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))

    project: Mapped[Project] = relationship(back_populates="user_links")
    user: Mapped[User] = relationship(back_populates="project_links")


class Category(TimestampMixin, Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    type: Mapped[CategoryType] = mapped_column(Enum(CategoryType), nullable=False)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)


class VendorClient(TimestampMixin, Base):
    __tablename__ = "vendors_clients"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    type: Mapped[VendorClientType] = mapped_column(
        Enum(VendorClientType), default=VendorClientType.VENDOR
    )
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    npwp: Mapped[str | None] = mapped_column(String(40), nullable=True)
    contact: Mapped[str | None] = mapped_column(String(120), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    email: Mapped[str | None] = mapped_column(String(120), nullable=True)
    bank_account: Mapped[str | None] = mapped_column(String(200), nullable=True)


# --- Transaction ---
class Transaction(TimestampMixin, Base):
    __tablename__ = "transactions"
    __table_args__ = (
        Index("ix_transactions_project_date", "project_id", "tx_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), nullable=False)
    tx_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    type: Mapped[TxnType] = mapped_column(Enum(TxnType), nullable=False)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"), nullable=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)

    party_type: Mapped[PartyType | None] = mapped_column(Enum(PartyType), nullable=True)
    party_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    party_id_number: Mapped[str | None] = mapped_column(String(80), nullable=True)
    party_account: Mapped[str | None] = mapped_column(String(200), nullable=True)
    vendor_client_id: Mapped[int | None] = mapped_column(
        ForeignKey("vendors_clients.id"), nullable=True
    )

    payment_method: Mapped[PaymentMethod] = mapped_column(
        Enum(PaymentMethod), default=PaymentMethod.TRANSFER
    )
    reference_no: Mapped[str | None] = mapped_column(String(120), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    usage_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[TxnStatus] = mapped_column(Enum(TxnStatus), default=TxnStatus.DRAFT)
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

    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), nullable=False)
    type: Mapped[InvoiceType] = mapped_column(Enum(InvoiceType), nullable=False)
    invoice_date: Mapped[date] = mapped_column(Date, nullable=False)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    vendor_client_id: Mapped[int | None] = mapped_column(
        ForeignKey("vendors_clients.id"), nullable=True
    )
    party_name: Mapped[str | None] = mapped_column(String(200), nullable=True)

    subtotal: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"))
    tax: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"))
    total: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"))

    status: Mapped[InvoiceStatus] = mapped_column(Enum(InvoiceStatus), default=InvoiceStatus.DRAFT)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)

    attachments: Mapped[list[InvoiceAttachment]] = relationship(
        back_populates="invoice", cascade="all,delete-orphan"
    )
    items: Mapped[list[InvoiceItem]] = relationship(
        back_populates="invoice", cascade="all,delete-orphan", order_by="InvoiceItem.id"
    )


class InvoiceItem(TimestampMixin, Base):
    __tablename__ = "invoice_items"

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

    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[str] = mapped_column(String(80), unique=True, nullable=False, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), nullable=False)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), nullable=False)
    vendor_client_id: Mapped[int | None] = mapped_column(
        ForeignKey("vendors_clients.id"), nullable=True
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

    status: Mapped[POStatus] = mapped_column(Enum(POStatus), default=POStatus.DRAFT)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    approved_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    items: Mapped[list[POItem]] = relationship(
        back_populates="po", cascade="all,delete-orphan", order_by="POItem.id"
    )


class POItem(TimestampMixin, Base):
    __tablename__ = "po_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    po_id: Mapped[int] = mapped_column(ForeignKey("purchase_orders.id", ondelete="CASCADE"))
    description: Mapped[str] = mapped_column(String(500), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("1"))
    unit: Mapped[str | None] = mapped_column(String(40), nullable=True)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"))
    subtotal: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"))

    po: Mapped[PurchaseOrder] = relationship(back_populates="items")


# --- Audit + AI ---
class AuditLog(TimestampMixin, Base):
    __tablename__ = "audit_logs"
    __table_args__ = (Index("ix_audit_entity", "entity", "entity_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    entity: Mapped[str] = mapped_column(String(80), nullable=False)
    entity_id: Mapped[int] = mapped_column(Integer, nullable=False)
    action: Mapped[AuditAction] = mapped_column(Enum(AuditAction), nullable=False)
    before: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    after: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)


class AIExtraction(TimestampMixin, Base):
    __tablename__ = "ai_extractions"

    id: Mapped[int] = mapped_column(primary_key=True)
    entity: Mapped[str] = mapped_column(String(40), default="invoice")  # invoice / po
    entity_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[AIExtractionStatus] = mapped_column(
        Enum(AIExtractionStatus), default=AIExtractionStatus.PENDING
    )
    extracted_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    confidence_score: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    raw_response: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    reviewed_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
