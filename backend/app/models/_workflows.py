"""Models -- CashRequest, CashAdvanceSettlement, AIExtraction, AppSetting, RoleMenuPolicy.

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

    cash_advance: Mapped["Transaction"] = relationship(
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
