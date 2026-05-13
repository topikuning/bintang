from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import Enum as SAEnum
from sqlalchemy import text

from app.api.v1 import api_router
from app.core.config import settings
from app.db.base import Base
from app.db.session import engine


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


_DEFAULT_SECRET_KEY = "dev-secret-change-me-please-rotate-in-prod"


def _guard_production_config() -> None:
    """Refuse to boot if production env still has insecure defaults.

    Fernet (app_settings) key di-derive dari SECRET_KEY. Kalau default
    terpakai di prod, semua secret terenkripsi (API key, TG/WA token)
    bisa di-decrypt siapa pun yg tahu default -> compromise penuh.
    """
    if settings.APP_ENV.lower() in ("prod", "production"):
        if settings.SECRET_KEY == _DEFAULT_SECRET_KEY:
            raise RuntimeError(
                "REFUSE_BOOT: SECRET_KEY masih default di APP_ENV=prod. "
                "Generate via `python -c 'import secrets; print(secrets.token_urlsafe(48))'` "
                "lalu set env SECRET_KEY sebelum boot."
            )
        if len(settings.SECRET_KEY) < 32:
            raise RuntimeError(
                "REFUSE_BOOT: SECRET_KEY terlalu pendek (<32 char) di prod."
            )


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _guard_production_config()
    # Pastikan tabel ada untuk dev (SQLite). Untuk prod gunakan Alembic.
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    # Sync enum + kolom baru (hanya Postgres). SQLite cukup create_all.
    if not settings.is_sqlite:
        try:
            async with engine.begin() as conn:
                await _sync_pg_columns(conn)
                await _sync_pg_enums(conn)
        except Exception as e:  # noqa: BLE001
            # jangan blok startup; cetak warning saja
            print(f"[startup] schema sync warning: {e}")
    # Indeks performa: idempoten utk SQLite & Postgres. create_all di atas
    # tidak menambahkan indeks baru ke tabel yg sudah ada di DB lama.
    try:
        async with engine.begin() as conn:
            await _ensure_perf_indexes(conn)
    except Exception as e:  # noqa: BLE001
        print(f"[startup] perf index warning: {e}")
    Path(settings.UPLOAD_DIR).mkdir(parents=True, exist_ok=True)

    # Warm app_settings cache (DB > env) supaya sync readers (telegram/
    # whatsapp/ocr clients) langsung dapat nilai effective.
    try:
        from app.db.session import SessionLocal
        from app.services.app_settings import bootstrap_cache, get_cached

        async with SessionLocal() as _ssn:
            await bootstrap_cache(_ssn)
    except Exception as e:  # noqa: BLE001
        print(f"[startup] app_settings.bootstrap_cache warning: {e}")
        from app.services.app_settings import get_cached  # type: ignore

    public_base = get_cached("PUBLIC_BASE_URL")
    tg_token = get_cached("TELEGRAM_BOT_TOKEN")
    tg_secret = get_cached("TELEGRAM_WEBHOOK_SECRET")
    wa_base = get_cached("WHATSAPP_BASE_URL")

    # Register Telegram webhook kalau token + base URL tersedia.
    if tg_token and public_base:
        try:
            from app.services.telegram import client as tg
            url = public_base.rstrip("/") + "/api/v1/telegram/webhook"
            ok = await tg.set_webhook(url, tg_secret or None)
            print(f"[startup] telegram setWebhook {url} -> ok={ok}")
        except Exception as e:  # noqa: BLE001
            print(f"[startup] telegram setWebhook failed: {e}")

    # Register WAHA webhook kalau base URL + PUBLIC_BASE_URL tersedia.
    if wa_base and public_base:
        try:
            from app.services.whatsapp import client as wa
            url = public_base.rstrip("/") + "/api/v1/whatsapp/webhook"
            ok = await wa.set_webhook(url)
            print(f"[startup] WAHA setWebhook {url} -> ok={ok}")
        except Exception as e:  # noqa: BLE001
            print(f"[startup] WAHA setWebhook failed: {e}")

    yield


app = FastAPI(
    title=f"{settings.APP_NAME} API",
    description="Bintang - Biaya, Investasi dan Tata Anggaran Gerak",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

upload_path = Path(settings.UPLOAD_DIR)
upload_path.mkdir(parents=True, exist_ok=True)
app.mount("/files", StaticFiles(directory=str(upload_path)), name="files")

app.include_router(api_router, prefix="/api/v1")


@app.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    return {"status": "ok", "app": settings.APP_NAME}
