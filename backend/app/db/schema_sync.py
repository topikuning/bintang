"""Sinkronisasi schema untuk DB yang lahir sebelum Alembic.

Fungsi di sini SEBELUMNYA tinggal di `app/main.py` dan hanya dipanggil
saat lifespan aplikasi. Dipindah ke modul sendiri (2026-08-30) supaya
`app/bootstrap_db.py` bisa memanggilnya SEBELUM memutuskan
stamp-vs-upgrade -- lihat catatan di berkas itu.

Semuanya idempoten (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT
EXISTS`, `ALTER TYPE ... ADD VALUE IF NOT EXISTS`) dan sudah terbukti
menjaga schema produksi tetap mutakhir selama berbulan-bulan sebelum
Alembic diaktifkan.
"""

from __future__ import annotations

from sqlalchemy import Enum as SAEnum
from sqlalchemy import text

from app.db.base import Base


async def _sync_pg_columns(conn) -> None:
    """Tambahkan kolom baru yang muncul di model setelah tabel sudah ada di prod.
    Idempoten via `ADD COLUMN IF NOT EXISTS` (Postgres 9.6+)."""
    statements = [
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS scope_all_projects BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_chat_id VARCHAR(40)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_telegram_chat_id ON users (telegram_chat_id) WHERE telegram_chat_id IS NOT NULL",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_chat_id VARCHAR(64)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_whatsapp_chat_id ON users (whatsapp_chat_id) WHERE whatsapp_chat_id IS NOT NULL",
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_value NUMERIC(18,2) NOT NULL DEFAULT 0",
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS tax_ppn_pct NUMERIC(5,2) NOT NULL DEFAULT 11",
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS tax_pph_pct NUMERIC(5,2) NOT NULL DEFAULT 2",
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS marketing_pct NUMERIC(5,2) NOT NULL DEFAULT 15",
        # Nama Dinas/Instansi/Klien pemberi pekerjaan (opsional)
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS client_name VARCHAR(200)",
        # Kategori dokumen lampiran proyek (SPK/BAST/Faktur Pajak/dll)
        "ALTER TABLE project_attachments ADD COLUMN IF NOT EXISTS doc_type VARCHAR(40)",
        # Proposal workflow (siapa ajukan, siapa approve, kapan, alasan reject)
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS proposed_by_id INTEGER REFERENCES users(id)",
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS approved_by_id INTEGER REFERENCES users(id)",
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP",
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS rejection_reason TEXT",
        # Akunting: kind tx (INVOICE_PAYMENT/CASH_ADVANCE/DIRECT_EXPENSE)
        "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS kind VARCHAR(40) NOT NULL DEFAULT 'INVOICE_PAYMENT'",
        "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS recipient_user_id INTEGER REFERENCES users(id)",
        "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS recipient_name VARCHAR(200)",
        "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS parent_advance_tx_id INTEGER REFERENCES transactions(id)",
        "CREATE INDEX IF NOT EXISTS ix_transactions_kind ON transactions (kind)",
        "CREATE INDEX IF NOT EXISTS ix_transactions_recipient_user_id ON transactions (recipient_user_id)",
        # Settlement item: link ke invoice eksternal yg dibayar lewat dana ops
        "ALTER TABLE cash_advance_settlement_items ADD COLUMN IF NOT EXISTS invoice_id INTEGER REFERENCES invoices(id)",
        # Catatan Non-Proyek (Project.kind enum REGULAR|NON_PROJECT).
        # Default REGULAR utk data legacy. Migrasi alembic
        # c4d2a9e1f7b8 juga add column ini -- _sync di sini hanya
        # safety net kalau deploy tdk run alembic upgrade.
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS kind VARCHAR(20) NOT NULL DEFAULT 'REGULAR'",
        "CREATE INDEX IF NOT EXISTS ix_projects_kind ON projects (kind)",
        # Username opsional utk login alternatif. Migrasi alembic
        # f3a7b9c5d2e8 juga add column ini -- _sync di sini hanya
        # safety net.
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(50)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_username ON users (username)",
        # Token revocation cutoff (audit #C5). Logout set ke now() supaya
        # JWT dgn iat <= cutoff dianggap revoked. Migrasi c8e1d4f2a6b9.
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS tokens_revoked_after TIMESTAMP WITH TIME ZONE",
        # Encrypt-at-rest utk bank_account & party_account (audit #C3).
        # Widen kolom 200 -> 500 supaya cukup Fernet ciphertext. Postgres
        # ALTER COLUMN TYPE OK; SQLite skip (try/except wrapping).
        "ALTER TABLE companies ALTER COLUMN bank_account TYPE VARCHAR(500)",
        "ALTER TABLE vendors_clients ALTER COLUMN bank_account TYPE VARCHAR(500)",
        "ALTER TABLE transactions ALTER COLUMN party_account TYPE VARCHAR(500)",
        # Category marketing flag (audit 2026-05-23) -- cegah double count
        # marketing di rincian proyek. Migrasi h9e4b2d6f3a8.
        "ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_marketing BOOLEAN NOT NULL DEFAULT FALSE",
        # Category penalty + profit_share flags (audit 2026-05-23) -- transparansi
        # distribusi profit di Rincian Keuangan. Migrasi i3a8b5c7e9d2.
        "ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_penalty BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_profit_share BOOLEAN NOT NULL DEFAULT FALSE",
        # Invoice item per-kategori (audit 2026-05-24) -- migrasi
        # l7f4a0c3e6b9. Safety net kalau deploy lewat alembic upgrade.
        "ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES categories(id)",
        "CREATE INDEX IF NOT EXISTS ix_invoice_items_category_id ON invoice_items (category_id)",
        # AI prompt overrides + per-feature settings (audit 2026-05-24).
        # Migrasi j5d2e8a1c4f7 + k6e3f9b2d5a8. CREATE IF NOT EXISTS supaya
        # idempoten -- alembic boleh "skip" karena no-op kalau sudah ada.
        """CREATE TABLE IF NOT EXISTS ai_prompt_overrides (
            feature_key VARCHAR(64) NOT NULL,
            field VARCHAR(32) NOT NULL,
            content TEXT NOT NULL,
            updated_by_id INTEGER REFERENCES users(id),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            PRIMARY KEY (feature_key, field)
        )""",
        """CREATE TABLE IF NOT EXISTS ai_feature_settings (
            feature_key VARCHAR(64) PRIMARY KEY,
            provider VARCHAR(32),
            model VARCHAR(80),
            max_tokens INTEGER,
            cache_ttl_days INTEGER,
            rate_limit_per_min INTEGER,
            web_search_enabled BOOLEAN,
            monthly_budget_usd NUMERIC(10,4),
            updated_by_id INTEGER REFERENCES users(id),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        )""",
        # Invoice number wajib unik. Drop index lama (non-unique) lalu
        # buat unique index. Tdk pakai DROP IF EXISTS sebelum CREATE
        # supaya idempoten -- kalau sudah unique, CREATE UNIQUE INDEX IF
        # NOT EXISTS no-op. Kalau masih index biasa: harus DROP dulu
        # baru CREATE UNIQUE -- itu kerja migrasi alembic. Sini cuma
        # safety net utk fresh deploy yg lewatin alembic.
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_invoices_number ON invoices (number)",
    ]
    for sql in statements:
        try:
            await conn.execute(text(sql))
        except Exception as e:  # noqa: BLE001
            print(f"[startup] column add warning: {e}")


# Indeks performa yg ditambahkan setelah tabel sudah berisi data.
# `CREATE INDEX IF NOT EXISTS` valid di SQLite 3.8+ dan Postgres 9.5+,
# jadi statement ini idempoten dan aman untuk dev maupun prod.
_PERF_INDEXES = [
    # transactions: hot-path filter di reports/cashflow/transactions list
    "CREATE INDEX IF NOT EXISTS ix_transactions_project_id ON transactions (project_id)",
    "CREATE INDEX IF NOT EXISTS ix_transactions_type ON transactions (type)",
    "CREATE INDEX IF NOT EXISTS ix_transactions_status ON transactions (status)",
    "CREATE INDEX IF NOT EXISTS ix_transactions_category_id ON transactions (category_id)",
    "CREATE INDEX IF NOT EXISTS ix_transactions_deleted_at ON transactions (deleted_at)",
    "CREATE INDEX IF NOT EXISTS ix_transactions_invoice_id ON transactions (invoice_id)",
    "CREATE INDEX IF NOT EXISTS ix_transactions_vendor_client ON transactions (vendor_client_id)",
    "CREATE INDEX IF NOT EXISTS ix_transactions_project_status_type ON transactions (project_id, status, type)",
    # invoices
    "CREATE INDEX IF NOT EXISTS ix_invoices_project_id ON invoices (project_id)",
    "CREATE INDEX IF NOT EXISTS ix_invoices_type ON invoices (type)",
    "CREATE INDEX IF NOT EXISTS ix_invoices_status ON invoices (status)",
    "CREATE INDEX IF NOT EXISTS ix_invoices_deleted_at ON invoices (deleted_at)",
    "CREATE INDEX IF NOT EXISTS ix_invoices_due_date ON invoices (due_date)",
    "CREATE INDEX IF NOT EXISTS ix_invoices_invoice_date ON invoices (invoice_date)",
    "CREATE INDEX IF NOT EXISTS ix_invoices_vendor_client_id ON invoices (vendor_client_id)",
    "CREATE INDEX IF NOT EXISTS ix_invoices_project_status ON invoices (project_id, status)",
    # purchase orders
    "CREATE INDEX IF NOT EXISTS ix_po_project_id ON purchase_orders (project_id)",
    "CREATE INDEX IF NOT EXISTS ix_po_company_id ON purchase_orders (company_id)",
    "CREATE INDEX IF NOT EXISTS ix_po_status ON purchase_orders (status)",
    "CREATE INDEX IF NOT EXISTS ix_po_deleted_at ON purchase_orders (deleted_at)",
    "CREATE INDEX IF NOT EXISTS ix_po_po_date ON purchase_orders (po_date)",
    "CREATE INDEX IF NOT EXISTS ix_po_vendor_client ON purchase_orders (vendor_client_id)",
    "CREATE INDEX IF NOT EXISTS ix_po_project_status ON purchase_orders (project_id, status)",
    # audit logs
    "CREATE INDEX IF NOT EXISTS ix_audit_created_at ON audit_logs (created_at)",
    "CREATE INDEX IF NOT EXISTS ix_audit_user_id ON audit_logs (user_id)",
    # project_users
    "CREATE INDEX IF NOT EXISTS ix_project_users_user_id ON project_users (user_id)",
]


async def _ensure_perf_indexes(conn) -> None:
    for sql in _PERF_INDEXES:
        try:
            await conn.execute(text(sql))
        except Exception as e:  # noqa: BLE001
            print(f"[startup] index ensure warning: {e}")


async def _sync_pg_enums(conn) -> None:
    """Postgres: pastikan tiap nilai enum di model ada di type DB.
    `create_all` tidak update enum yang sudah ada, sehingga value baru
    yang ditambahkan di kode (mis. UserRole.CENTRAL_ADMIN) gagal di
    INSERT. Kita lakukan `ALTER TYPE ... ADD VALUE IF NOT EXISTS` untuk
    setiap nilai (idempoten, butuh PG 12+).
    """
    seen: set[tuple[str, str]] = set()
    for table in Base.metadata.tables.values():
        for column in table.columns:
            t = column.type
            if not isinstance(t, SAEnum) or not t.name:
                continue
            for val in t.enums:
                key = (t.name, val)
                if key in seen:
                    continue
                seen.add(key)
                # Aman karena enum name & value semuanya literal Python sumber.
                safe = val.replace("'", "''")
                await conn.execute(
                    text(f"ALTER TYPE {t.name} ADD VALUE IF NOT EXISTS '{safe}'")
                )
