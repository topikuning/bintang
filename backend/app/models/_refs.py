"""Models -- Company, Project, ProjectUser, Category, VendorClient.

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
    # Encrypted at rest (Fernet via field_crypto). Audit 2026-05-22 #C3.
    # Length 500 cover Fernet ciphertext + prefix utk plaintext hingga ~120 char.
    bank_account: Mapped[str | None] = mapped_column(EncryptedString(500), nullable=True)

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

    project: Mapped["Project"] = relationship(back_populates="user_links")
    user: Mapped["User"] = relationship(back_populates="project_links")


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
    # Encrypted at rest. Audit 2026-05-22 #C3.
    bank_account: Mapped[str | None] = mapped_column(EncryptedString(500), nullable=True)


# --- Transaction ---
