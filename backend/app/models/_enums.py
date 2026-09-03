"""Models enum module -- semua Enum class.

Audit 2026-05-22 #M1: split dari models.py.
"""

import enum


class UserRole(enum.StrEnum):
    SUPERADMIN = "SUPERADMIN"  # god-mode: hard delete + cascade
    CENTRAL_ADMIN = "CENTRAL_ADMIN"  # admin pusat, manage semua kecuali destructive ops
    PROJECT_ADMIN = "PROJECT_ADMIN"  # admin proyek, scoped ke project_users
    EXECUTIVE = "EXECUTIVE"  # view-only (laporan, dashboard) -- bisa scope semua atau per proyek


class ProjectStatus(enum.StrEnum):
    # Proposal dr non-admin user -> menunggu approve dr CENTRAL/SUPERADMIN.
    # Tidak muncul di operasional (ProjectPicker/Switcher/list/dashboard);
    # hanya muncul di approval queue + master CRUD utk admin.
    MENUNGGU_PERSETUJUAN = "MENUNGGU_PERSETUJUAN"
    AKTIF = "AKTIF"
    SELESAI = "SELESAI"
    DITAHAN = "DITAHAN"
    DIBATALKAN = "DIBATALKAN"


class ProjectKind(enum.StrEnum):
    """Klasifikasi proyek utk pemisahan agregasi keuangan.

    - REGULAR: proyek konstruksi normal -- ikut semua agregat dashboard,
      cashflow, beban, dll.
    - NON_PROJECT: bucket "Catatan Non-Proyek" -- 1 system project per
      company. Tx di sini IS-A "side ledger" yg by default TIDAK ikut
      agregat global. Dikontrol per-tahun lewat NonProjectYearSetting.
    """

    REGULAR = "REGULAR"
    NON_PROJECT = "NON_PROJECT"


class ProjectDocType(enum.StrEnum):
    """Tipe dokumen lampiran proyek (kategorisasi utk audit).
    Disimpan sbg VARCHAR di DB supaya luwes nambah tipe baru tanpa
    perlu ALTER TYPE di Postgres. Validasi enum hanya di app level."""

    SPK = "SPK"  # Surat Perintah Kerja
    SURAT_PESANAN = "SURAT_PESANAN"  # Surat Pesanan
    BAST = "BAST"  # Berita Acara Serah Terima
    KONTRAK = "KONTRAK"  # Kontrak induk
    FAKTUR_PAJAK = "FAKTUR_PAJAK"  # Faktur Pajak
    INVOICE = "INVOICE"  # Invoice fisik dr vendor
    KWITANSI = "KWITANSI"  # Kwitansi pembayaran
    BERITA_ACARA = "BERITA_ACARA"  # Berita Acara umum (selain BAST)
    LAINNYA = "LAINNYA"  # Catch-all


class TxnType(enum.StrEnum):
    IN = "IN"
    OUT = "OUT"


class TxnKind(enum.StrEnum):
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


class TxnStatus(enum.StrEnum):
    DRAFT = "DRAFT"
    SUBMITTED = "SUBMITTED"
    VERIFIED = "VERIFIED"
    REJECTED = "REJECTED"
    CANCELLED = "CANCELLED"


class CashRequestStatus(enum.StrEnum):
    """Status pengajuan dana operasional (CashRequest).

    Transitions:
      PENDING -> APPROVED  (auto-create tx CASH_ADVANCE DRAFT)
              -> REJECTED  (admin reject + reason)
              -> CANCELLED (requester self-cancel sblm approve)
      APPROVED -> DISBURSEMENT_CANCELLED  (kalau tx pencairan di-CANCEL
              di flow /transactions/{id}/cancel). Final state -- bukan
              dikembalikan ke PENDING (audit Q5 keputusan: finally state).
              Kalau perlu pengajuan baru, requester buat CR baru.
    """

    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    CANCELLED = "CANCELLED"
    DISBURSEMENT_CANCELLED = "DISBURSEMENT_CANCELLED"


class PaymentMethod(enum.StrEnum):
    CASH = "CASH"
    TRANSFER = "TRANSFER"
    QRIS = "QRIS"
    GIRO = "GIRO"
    OTHER = "OTHER"


class PartyType(enum.StrEnum):
    COMPANY = "COMPANY"
    PERSONAL = "PERSONAL"
    EMPLOYEE = "EMPLOYEE"
    INTERNAL = "INTERNAL"
    OTHER = "OTHER"


class InvoiceType(enum.StrEnum):
    IN = "IN"  # invoice masuk dari vendor
    OUT = "OUT"  # tagihan ke client


class InvoiceStatus(enum.StrEnum):
    DRAFT = "DRAFT"
    ISSUED = "ISSUED"
    PARTIALLY_PAID = "PARTIALLY_PAID"
    PAID = "PAID"
    OVERDUE = "OVERDUE"
    CANCELLED = "CANCELLED"


class POStatus(enum.StrEnum):
    DRAFT = "DRAFT"
    ISSUED = "ISSUED"
    APPROVED = "APPROVED"
    PARTIALLY_FULFILLED = "PARTIALLY_FULFILLED"
    FULFILLED = "FULFILLED"
    CANCELLED = "CANCELLED"


class CategoryType(enum.StrEnum):
    IN = "IN"
    OUT = "OUT"


class VendorClientType(enum.StrEnum):
    VENDOR = "VENDOR"
    CLIENT = "CLIENT"
    BOTH = "BOTH"


class AIExtractionStatus(enum.StrEnum):
    PENDING = "PENDING"
    DONE = "DONE"
    FAILED = "FAILED"
    REVIEWED = "REVIEWED"


class OCRJobStatus(enum.StrEnum):
    """Status async OCR job. Audit 2026-05-23 OCR opt #T3.8."""

    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    DONE = "DONE"
    FAILED = "FAILED"


class AuditAction(enum.StrEnum):
    CREATE = "CREATE"
    UPDATE = "UPDATE"
    DELETE = "DELETE"
    SUBMIT = "SUBMIT"
    VERIFY = "VERIFY"
    CANCEL = "CANCEL"
    APPROVE = "APPROVE"
    REJECT = "REJECT"


# --- Core entities ---
