from __future__ import annotations

import enum
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


# --- Enums ---
class UserRole(str, enum.Enum):
    SUPERADMIN = "SUPERADMIN"          # god-mode: hard delete + cascade
    CENTRAL_ADMIN = "CENTRAL_ADMIN"    # admin pusat, manage semua kecuali destructive ops
    PROJECT_ADMIN = "PROJECT_ADMIN"    # admin proyek, scoped ke project_users
    EXECUTIVE = "EXECUTIVE"            # view-only (laporan, dashboard) -- bisa scope semua atau per proyek


class ProjectStatus(str, enum.Enum):
    # Proposal dr non-admin user -> menunggu approve dr CENTRAL/SUPERADMIN.
    # Tidak muncul di operasional (ProjectPicker/Switcher/list/dashboard);
    # hanya muncul di approval queue + master CRUD utk admin.
    MENUNGGU_PERSETUJUAN = "MENUNGGU_PERSETUJUAN"
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
    SUBMIT = "SUBMIT"
    VERIFY = "VERIFY"
    CANCEL = "CANCEL"
    APPROVE = "APPROVE"
    REJECT = "REJECT"


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
    # EXECUTIVE: True = boleh lihat semua proyek; False = hanya proyek di project_users.
    # Diabaikan untuk role lain.
    scope_all_projects: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Telegram bot integration: chat_id user setelah berhasil /link
    telegram_chat_id: Mapped[str | None] = mapped_column(String(40), unique=True, nullable=True)
    # WhatsApp via WAHA: nomor WA user dlm format internal WAHA "<msisdn>@c.us"
    whatsapp_chat_id: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)

    project_links: Mapped[list[ProjectUser]] = relationship(back_populates="user", cascade="all,delete-orphan")


class TelegramLinkCode(TimestampMixin, Base):
    """Kode 6 digit sekali pakai untuk meng-link user web ke chat Telegram.
    User generate kode dari halaman profil, ketik `/link <code>` di bot.
    Server cocokkan kode -> isi telegram_chat_id user.
    Kode kadaluwarsa setelah `expires_at`.
    """
    __tablename__ = "telegram_link_codes"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    code: Mapped[str] = mapped_column(String(12), unique=True, nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class TelegramPendingCommand(TimestampMixin, Base):
    """Buffer kecil per chat untuk mengaitkan foto yang dikirim *setelah*
    command /keluar atau /masuk dengan transaksi yang baru dibuat. Foto
    masuk dalam jendela waktu pendek setelah command sukses akan otomatis
    di-attach ke transaksi terakhir.
    """
    __tablename__ = "telegram_pending_attachments"

    id: Mapped[int] = mapped_column(primary_key=True)
    chat_id: Mapped[str] = mapped_column(String(40), index=True, nullable=False)
    transaction_id: Mapped[int] = mapped_column(ForeignKey("transactions.id", ondelete="CASCADE"), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class WhatsAppLinkCode(TimestampMixin, Base):
    """Mirror TelegramLinkCode untuk channel WhatsApp via WAHA."""
    __tablename__ = "whatsapp_link_codes"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    code: Mapped[str] = mapped_column(String(12), unique=True, nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class WhatsAppPendingCommand(TimestampMixin, Base):
    """Mirror TelegramPendingCommand untuk channel WhatsApp."""
    __tablename__ = "whatsapp_pending_attachments"

    id: Mapped[int] = mapped_column(primary_key=True)
    chat_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    transaction_id: Mapped[int] = mapped_column(ForeignKey("transactions.id", ondelete="CASCADE"), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class MessagingConfig(TimestampMixin, Base):
    """Singleton row (id=1) menyimpan toggle on/off untuk tiap channel.
    Detail koneksi (token, URL) tetap di env -- ini hanya master switch yg
    bisa diubah dari halaman Pengaturan tanpa redeploy.
    """
    __tablename__ = "messaging_config"

    id: Mapped[int] = mapped_column(primary_key=True)
    telegram_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    whatsapp_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


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
    # Nama Dinas/Instansi/Klien pemberi pekerjaan (opsional). Bukan FK -- pure
    # display string supaya luwes (nama lengkap dgn jabatan, alamat, dll).
    # Tampil di header PDF PO/Invoice.
    client_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    pic_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[ProjectStatus] = mapped_column(Enum(ProjectStatus), default=ProjectStatus.AKTIF)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # budget control
    project_value: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"))   # nilai proyek (kontrak/SPK)
    budget_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"))   # target pengeluaran (default 70% project_value)
    currency: Mapped[str] = mapped_column(String(8), default="IDR")
    overbudget_tolerance_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0"))

    # tax & marketing % per proyek (diturunkan ke breakdown DPP/PPn/PPh/Cair)
    tax_ppn_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("11"))
    tax_pph_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("2"))
    marketing_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("15"))

    # Proposal workflow: kalau diajukan oleh non-admin, status=MENUNGGU_PERSETUJUAN.
    # proposed_by_id wajib utk audit (siapa yg mengajukan). approved_by_id +
    # approved_at terisi saat admin approve. rejection_reason terisi saat reject
    # (status berubah jadi DIBATALKAN).
    proposed_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    approved_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    company: Mapped[Company] = relationship(back_populates="projects")
    user_links: Mapped[list[ProjectUser]] = relationship(
        back_populates="project", cascade="all,delete-orphan"
    )
    attachments: Mapped[list[ProjectAttachment]] = relationship(
        back_populates="project", cascade="all,delete-orphan",
        order_by="ProjectAttachment.id",
    )


class ProjectAttachment(TimestampMixin, Base):
    """Lampiran dokumen proyek (kontrak, surat penunjukan, BAST, dll).
    Opsional, bisa banyak per proyek."""
    __tablename__ = "project_attachments"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    label: Mapped[str | None] = mapped_column(String(100), nullable=True)  # mis: "Kontrak", "BAST"
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(120), nullable=False)
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    uploaded_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)

    project: Mapped[Project] = relationship(back_populates="attachments")


class ProjectUser(TimestampMixin, Base):
    __tablename__ = "project_users"
    __table_args__ = (
        UniqueConstraint("project_id", "user_id", name="uq_project_user"),
        # Scope check di setiap request user_project_ids() WHERE user_id=?.
        Index("ix_project_users_user_id", "user_id"),
    )

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
        # Hot-path filter combos di reports/cashflow/transactions list:
        # (project, status, type) -- arus kas verified per proyek/arah.
        Index("ix_transactions_project_status_type", "project_id", "status", "type"),
        # Soft-delete filter ada di hampir semua query.
        Index("ix_transactions_deleted_at", "deleted_at"),
        # Lookup dari invoice_allocations / detail invoice.
        Index("ix_transactions_invoice_id", "invoice_id"),
        Index("ix_transactions_vendor_client", "vendor_client_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), nullable=False, index=True)
    tx_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    type: Mapped[TxnType] = mapped_column(Enum(TxnType), nullable=False, index=True)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"), nullable=True, index=True)
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
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
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
    __table_args__ = (
        Index("ix_audit_entity", "entity", "entity_id"),
        # Laporan audit-log selalu ORDER BY created_at DESC + filter user_id.
        Index("ix_audit_created_at", "created_at"),
        Index("ix_audit_user_id", "user_id"),
    )

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
