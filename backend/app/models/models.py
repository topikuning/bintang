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


class ProjectKind(str, enum.Enum):
    """Klasifikasi proyek utk pemisahan agregasi keuangan.

    - REGULAR: proyek konstruksi normal -- ikut semua agregat dashboard,
      cashflow, beban, dll.
    - NON_PROJECT: bucket "Catatan Non-Proyek" -- 1 system project per
      company. Tx di sini IS-A "side ledger" yg by default TIDAK ikut
      agregat global. Dikontrol per-tahun lewat NonProjectYearSetting.
    """
    REGULAR = "REGULAR"
    NON_PROJECT = "NON_PROJECT"


class ProjectDocType(str, enum.Enum):
    """Tipe dokumen lampiran proyek (kategorisasi utk audit).
    Disimpan sbg VARCHAR di DB supaya luwes nambah tipe baru tanpa
    perlu ALTER TYPE di Postgres. Validasi enum hanya di app level."""
    SPK = "SPK"                          # Surat Perintah Kerja
    SURAT_PESANAN = "SURAT_PESANAN"      # Surat Pesanan
    BAST = "BAST"                        # Berita Acara Serah Terima
    KONTRAK = "KONTRAK"                  # Kontrak induk
    FAKTUR_PAJAK = "FAKTUR_PAJAK"        # Faktur Pajak
    INVOICE = "INVOICE"                  # Invoice fisik dr vendor
    KWITANSI = "KWITANSI"                # Kwitansi pembayaran
    BERITA_ACARA = "BERITA_ACARA"        # Berita Acara umum (selain BAST)
    LAINNYA = "LAINNYA"                  # Catch-all


class TxnType(str, enum.Enum):
    IN = "IN"
    OUT = "OUT"


class TxnKind(str, enum.Enum):
    """Sub-jenis transaksi (terutama utk OUT) -- memenuhi kaidah akunting:

    - INVOICE_PAYMENT: pembayaran ke vendor lewat invoice (ada party
      eksternal + nomor invoice). Mapped ke invoice_id / allocations.
    - CASH_ADVANCE: uang muka ke personal internal (BUKAN beban, masih
      piutang -- 'Dr. Uang Muka / Kr. Kas'). Wajib di-settle dgn
      CashAdvanceSettlement supaya jadi beban.
    - DIRECT_EXPENSE: beban langsung tanpa invoice (struk/kwitansi).
      Multi-line items per kategori (mis. ATK, bensin, parkir). Total
      transaksi = sum(items).

    Utk TxnType.IN: kind biasanya INVOICE_PAYMENT (penerimaan dr invoice
    OUT) atau OTHER -- tdk dibedakan ketat.
    """
    INVOICE_PAYMENT = "INVOICE_PAYMENT"
    CASH_ADVANCE = "CASH_ADVANCE"
    DIRECT_EXPENSE = "DIRECT_EXPENSE"


class TxnStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    SUBMITTED = "SUBMITTED"
    VERIFIED = "VERIFIED"
    REJECTED = "REJECTED"
    CANCELLED = "CANCELLED"


class CashRequestStatus(str, enum.Enum):
    """Status pengajuan dana operasional (CashRequest)."""
    PENDING = "PENDING"
    APPROVED = "APPROVED"
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
    # Username opsional utk login alternatif (selain email). Selalu di-store
    # lowercase + dibatasi char aman ([a-z0-9._-]{3,50}). Nullable supaya
    # user lama tdk perlu di-backfill; mereka tetap login pakai email.
    # Lookup di endpoint login: deteksi '@' di input -> route ke email
    # vs username column. Backend force lowercase saat write.
    username: Mapped[str | None] = mapped_column(
        String(50), unique=True, nullable=True, index=True
    )
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
    # Klasifikasi proyek: REGULAR (default, perilaku lama) atau
    # NON_PROJECT (bucket Catatan Non-Proyek, 1 per company). Disimpan
    # sbg VARCHAR supaya luwes nambah kind baru tanpa ALTER TYPE Postgres.
    # Lihat juga: NonProjectYearSetting utk toggle inklusi per tahun.
    kind: Mapped[str] = mapped_column(
        String(20), default=ProjectKind.REGULAR.value, nullable=False, index=True
    )
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
    user_links: Mapped[list["ProjectUser"]] = relationship(
        back_populates="project", cascade="all,delete-orphan"
    )
    attachments: Mapped[list["ProjectAttachment"]] = relationship(
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
    label: Mapped[str | None] = mapped_column(String(100), nullable=True)  # judul bebas: "Kontrak no. xxx", dll
    # Kategorisasi dokumen utk audit (SPK/BAST/dll). Disimpan sbg string
    # supaya bisa nambah enum value tanpa migration. Nullable utk dok lama.
    doc_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(120), nullable=False)
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    uploaded_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)

    project: Mapped[Project] = relationship(back_populates="attachments")


# NOTE: Funder + ProjectFunder dihapus -- entitas pendana sekarang
# disimpan sbg User(role=EXECUTIVE) dgn link via ProjectUser. Lihat
# migration 20260518_1400_merge_funder_into_user_executive.


class NonProjectYearSetting(TimestampMixin, Base):
    """Toggle per-tahun utk inklusi tx di bucket Catatan Non-Proyek
    (`Project.kind=NON_PROJECT`) ke agregat keuangan global.

    Semantik:
    - Setting per (company_id, year)
    - include_in_global=True -> tx non-proyek di tahun itu IKUT semua
      agregat (saldo kas, beban total, cashflow, dashboard, laporan)
      seperti tx proyek REGULAR
    - include_in_global=False -> tx jadi SIDE LEDGER: hanya muncul di
      halaman Catatan Non-Proyek, tdk menyentuh angka manapun
    - Tahun yg belum ada baris di tabel ini -> default OFF (tidak masuk)
    - Modify setting hanya boleh SUPERADMIN (audit-sensitive).
    """
    __tablename__ = "non_project_year_settings"
    __table_args__ = (
        UniqueConstraint("company_id", "year", name="uq_non_project_year"),
        Index("ix_non_project_year_company_year", "company_id", "year"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(
        ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    include_in_global: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)


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


class CashAdvanceSettlement(TimestampMixin, Base):
    """Pertanggungjawaban uang muka.
    1-to-1 ke Transaction kind=CASH_ADVANCE. Membentuk pencatatan akunting:
        Dr. Beban XYZ (per item) + Kr. Uang Muka Karyawan
        Dr. Kas (returned_to_kas) + Kr. Uang Muka Karyawan
    Kalau total items > advance amount -> auto-create top-up tx
    (kind=DIRECT_EXPENSE, parent_advance_tx_id = advance).
    """
    __tablename__ = "cash_advance_settlements"
    __table_args__ = (
        # Nominal kembali ke kas tdk boleh negatif (zero OK = tdk ada sisa).
        CheckConstraint(
            "returned_to_kas >= 0",
            name="ck_cash_advance_settlements_returned_nonneg",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    cash_advance_tx_id: Mapped[int] = mapped_column(
        ForeignKey("transactions.id", ondelete="CASCADE"),
        unique=True, nullable=False, index=True,
    )
    settled_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    settled_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    # Sisa yg dikembalikan ke kas (kalau pakai < advance). Tdk negatif.
    returned_to_kas: Mapped[Decimal] = mapped_column(
        Numeric(18, 2), nullable=False, default=Decimal("0")
    )
    # Top-up tx kalau overpay (sum items > advance). Auto-created by API.
    topup_tx_id: Mapped[int | None] = mapped_column(
        ForeignKey("transactions.id"), nullable=True
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    cash_advance: Mapped[Transaction] = relationship(
        back_populates="settlement",
        foreign_keys=[cash_advance_tx_id],
    )
    items: Mapped[list["CashAdvanceSettlementItem"]] = relationship(
        back_populates="settlement",
        cascade="all,delete-orphan",
        order_by="CashAdvanceSettlementItem.id",
    )


class CashAdvanceSettlementItem(TimestampMixin, Base):
    """Rincian penggunaan uang muka. 1 item = 1 baris pertanggungjawaban
    (kategori + deskripsi + amount + opsional URL struk)."""
    __tablename__ = "cash_advance_settlement_items"
    __table_args__ = (
        CheckConstraint(
            "amount > 0",
            name="ck_cash_advance_settlement_items_amount_positive",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    settlement_id: Mapped[int] = mapped_column(
        ForeignKey("cash_advance_settlements.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id"), nullable=True
    )
    description: Mapped[str] = mapped_column(String(300), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    receipt_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Kalau item ini sebenarnya bayar invoice eksternal (bukan beban langsung),
    # link ke invoice. Saat settle, backend auto-bikin InvoiceAllocation
    # dari tx CASH_ADVANCE asli ke invoice ini utk amount item.
    # Tetap simpan di settlement_item supaya jelas mana item yg invoice-payment
    # vs beban langsung. category_id boleh diisi atau tidak (informasi tambahan).
    invoice_id: Mapped[int | None] = mapped_column(
        ForeignKey("invoices.id"), nullable=True
    )

    settlement: Mapped[CashAdvanceSettlement] = relationship(back_populates="items")


class CashRequest(TimestampMixin, Base):
    """Pengajuan dana operasional internal (sebelum jadi tx KELUAR).

    Mirip invoice tapi utk pengeluaran internal team (bukan ke vendor
    eksternal). Header + line items (rincian belanja yg direncanakan).

    Flow:
      1. Requester (non-EXECUTIVE) bikin pengajuan dgn rincian items.
         Status: PENDING. Belum ada tx, belum masuk hitungan saldo.
      2. CENTRAL/SUPERADMIN approve atau reject.
      3. Saat APPROVED, sistem auto-create Transaction OUT kind=CASH_ADVANCE
         status DRAFT di proyek tsb (recipient = recipient_user_id atau
         requester). Link disbursement_tx_id. Tx masuk hitungan pending.
      4. Admin keuangan verify tx lewat flow Transaksi existing saat
         dana ditransfer -> VERIFIED, masuk saldo.
      5. Pertanggungjawaban pakai CashAdvanceSettlement existing.
    """
    __tablename__ = "cash_requests"
    __table_args__ = (
        Index("ix_cash_requests_project_status", "project_id", "status"),
        Index("ix_cash_requests_requester", "requester_id"),
        Index("ix_cash_requests_deleted_at", "deleted_at"),
        # Total tdk boleh negatif. Zero OK utk PENDING tanpa item
        # (defensive default), tapi item-nya wajib > 0.
        CheckConstraint(
            "total_amount >= 0",
            name="ck_cash_requests_total_nonneg",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # Format: CR/YYYY/MM/#### (sequential per bulan, global).
    number: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)

    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id"), nullable=False, index=True
    )

    # Yang mengajukan.
    requester_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"), nullable=False, index=True
    )
    # Calon penerima dana (kalau berbeda dari requester). Saat APPROVED,
    # ini jadi recipient_user_id di tx CASH_ADVANCE. Null -> default ke
    # requester.
    recipient_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )

    request_date: Mapped[date] = mapped_column(Date, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Sum(items.amount). Disimpan utk performance & filter range.
    total_amount: Mapped[Decimal] = mapped_column(
        Numeric(18, 2), nullable=False, default=Decimal("0")
    )

    # String (bukan native enum) -- konsisten dgn pola Project.kind:
    # luwes nambah status baru tanpa ALTER TYPE Postgres.
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=CashRequestStatus.PENDING.value, index=True
    )

    approved_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    approved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    rejected_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    rejected_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Link ke tx CASH_ADVANCE yg auto-created saat APPROVED. SET NULL
    # kalau tx-nya di-hard-delete (jarang -- tx pakai soft-delete). Unique:
    # 1 pengajuan = 1 tx pencairan.
    disbursement_tx_id: Mapped[int | None] = mapped_column(
        ForeignKey("transactions.id", ondelete="SET NULL"),
        nullable=True, unique=True,
    )

    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    items: Mapped[list["CashRequestItem"]] = relationship(
        back_populates="request",
        cascade="all,delete-orphan",
        order_by="CashRequestItem.id",
    )


class CashRequestItem(TimestampMixin, Base):
    """Rincian belanja yang direncanakan utk satu pengajuan dana.
    1 item = 1 baris (kategori + deskripsi + qty/harga atau amount langsung).
    Total request = SUM(items.amount).
    """
    __tablename__ = "cash_request_items"
    __table_args__ = (
        CheckConstraint(
            "amount > 0",
            name="ck_cash_request_items_amount_positive",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    request_id: Mapped[int] = mapped_column(
        ForeignKey("cash_requests.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id"), nullable=True
    )
    description: Mapped[str] = mapped_column(String(300), nullable=False)
    # Qty & unit_price opsional -- user boleh isi amount langsung.
    quantity: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 3), nullable=True
    )
    unit_price: Mapped[Decimal | None] = mapped_column(
        Numeric(18, 2), nullable=True
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)

    request: Mapped[CashRequest] = relationship(back_populates="items")


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



class AppSetting(TimestampMixin, Base):
    """Pengaturan sistem yg di-manage SUPERADMIN via UI (bukan env vars).

    Pakai untuk: API keys (OCR, Telegram, WhatsApp/WAHA), URL public,
    engine default, dll. Secret value di-encrypt at rest dgn Fernet
    (master key derived dr SECRET_KEY env).

    Convention key: UPPER_SNAKE_CASE (sama dgn env var lama). group_key
    utk grouping di UI (ocr/telegram/whatsapp/system).
    """
    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(80), unique=True, nullable=False, index=True)
    # Value setelah encrypt (kalau is_secret) atau plaintext. Nullable
    # supaya bisa 'hapus' (set ke None) tanpa drop row.
    value: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_secret: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Grouping utk UI: "ocr", "telegram", "whatsapp", "system".
    group_key: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    # Audit
    updated_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)


class RoleMenuPolicy(TimestampMixin, Base):
    """Toggle off menu utk role tertentu. Default: semua menu visible
    untuk semua role -- baris di tabel ini menandakan menu yg DI-HIDE.

    SUPERADMIN selalu lihat semua (tdk berlaku policy).
    """
    __tablename__ = "role_menu_policies"
    __table_args__ = (
        UniqueConstraint("role", "menu_id", name="uq_role_menu"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), nullable=False, index=True)
    menu_id: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    hidden: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    updated_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
