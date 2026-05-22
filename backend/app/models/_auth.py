"""Models -- User, auth-related codes/configs, AuditLog.

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
    # Token revocation cutoff. Kalau di-set, JWT dgn iat <= cutoff dianggap
    # invalid -> user "logout from all devices". Audit 2026-05-22 #C5.
    # Logout endpoint set kolom ini ke now(). Default NULL = no revocation.
    tokens_revoked_after: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    project_links: Mapped[list["ProjectUser"]] = relationship(back_populates="user", cascade="all,delete-orphan")


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


