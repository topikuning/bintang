import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest
from starlette.responses import Response as StarletteResponse

from app.api.files import router as files_router
from app.api.v1 import api_router
from app.core.config import settings
from app.db.base import Base
from app.db.schema_sync import (
    _ensure_perf_indexes,
    _sync_pg_columns,
    _sync_pg_enums,
)
from app.db.session import engine


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
        # Audit 2026-05-22 #H6: validate CORS allowed_origins di prod.
        # Wildcard '*' + localhost reference = misconfig dangerous.
        #
        # Update 2026-06-13 (deploy satu service): ALLOWED_ORIGINS KOSONG
        # kini sah dan justru pilihan paling aman -- SPA disajikan dari
        # origin yang sama dgn API, jadi tidak ada request lintas-origin
        # yang perlu diizinkan. Isi hanya kalau ada klien eksternal.
        origins = [o.strip() for o in settings.allowed_origins_list]
        if any(o == "*" for o in origins):
            raise RuntimeError(
                "REFUSE_BOOT: ALLOWED_ORIGINS='*' tdk boleh di prod -- "
                "credentials akan ter-expose ke origin manapun."
            )
        bad = [o for o in origins if "localhost" in o or "127.0.0.1" in o]
        if bad:
            raise RuntimeError(
                f"REFUSE_BOOT: ALLOWED_ORIGINS punya localhost/127.0.0.1 "
                f"di prod ({bad}). Pakai URL prod yg sebenarnya."
            )


async def _guard_webhook_secrets(db) -> None:
    """Audit 2026-06-13 #S-04: di prod, integrasi bot yang AKTIF wajib
    punya webhook secret.

    Pemeriksaan ini harus terjadi setelah DB siap (nilai efektif ada di
    app_settings, bukan cuma env), jadi ia dipanggil dari lifespan --
    bukan dari `_guard_production_config()` yang jalan sebelum DB ada.

    Boot ditolak, bukan sekadar warning: webhook tanpa verifikasi berarti
    siapa pun di internet bisa mengirim perintah bot atas nama user yang
    sudah ter-link.
    """
    if not settings.is_prod:
        return
    from app.services.app_settings import get_setting

    problems: list[str] = []
    if await get_setting(db, "TELEGRAM_BOT_TOKEN"):
        if not await get_setting(db, "TELEGRAM_WEBHOOK_SECRET"):
            problems.append("TELEGRAM_WEBHOOK_SECRET")
    if await get_setting(db, "WHATSAPP_BASE_URL"):
        if not await get_setting(db, "WHATSAPP_WEBHOOK_SECRET"):
            problems.append("WHATSAPP_WEBHOOK_SECRET")
    if problems:
        raise RuntimeError(
            "REFUSE_BOOT: integrasi bot aktif di prod tapi secret webhook "
            f"kosong: {', '.join(problems)}. Isi lewat Pengaturan > "
            "Integrasi, atau matikan integrasinya."
        )


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _guard_production_config()
    # Schema bootstrap policy:
    # - Dev (SQLite): `create_all` cukup (cepat, no migration friction).
    # - Prod (Postgres): SEBAIKNYA jalankan `alembic upgrade head` di
    #   deploy step sebelum app start. `create_all` di sini idempotent
    #   (tidak overwrite tabel ada) + `_sync_pg_columns` di bawah cover
    #   penambahan kolom legacy DB. Kombinasi ini back-compat dgn DB
    #   prod sebelum Alembic di-introduce; setelah baseline stamp,
    #   migration berikutnya yg jadi source of truth.
    # Lihat backend/docs/migrations.md.
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
    # Audit 2026-05-24: invalidate asyncpg prepared statement cache.
    # Tanpa ini, kolom yg baru di-ALTER (mis. invoice_items.category_id)
    # menyebabkan UndefinedColumnError karena prepared stmt lama refer ke
    # schema snapshot pre-ALTER. dispose() drop semua connection di pool,
    # next request dapat conn baru dgn schema fresh.
    if not settings.is_sqlite:
        try:
            await engine.dispose()
        except Exception as e:  # noqa: BLE001
            print(f"[startup] engine dispose warning: {e}")
    Path(settings.UPLOAD_DIR).mkdir(parents=True, exist_ok=True)

    # Audit 2026-06-13 #S-07: rate limiter menyimpan state di memori
    # proses. Begitu ada worker/replika kedua, batas login dan batas OCR
    # terbagi diam-diam ke tiap proses -- 5 percobaan/menit jadi 5 x N.
    # Deteksi konfigurasi multi-worker yang umum dan buat berisik.
    _workers = os.getenv("WEB_CONCURRENCY") or os.getenv("UVICORN_WORKERS")
    if _workers and _workers.isdigit() and int(_workers) > 1:
        print(
            f"[startup] PERINGATAN: {_workers} worker terdeteksi, tapi "
            "rate limiter masih in-memory (app/core/rate_limit.py). Batas "
            "login/OCR efektif terkalikan jumlah worker. Pindahkan ke "
            "Redis sebelum menaikkan replika."
        )

    # Warm app_settings cache (DB > env) supaya sync readers (telegram/
    # whatsapp/ocr clients) langsung dapat nilai effective.
    try:
        from app.db.session import SessionLocal
        from app.services.app_settings import bootstrap_cache, get_cached

        async with SessionLocal() as _ssn:
            await bootstrap_cache(_ssn)
            await _guard_webhook_secrets(_ssn)
    except RuntimeError:
        # REFUSE_BOOT dari _guard_webhook_secrets -- jangan ditelan.
        raise
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


class _SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Pasang security headers di setiap response (audit #H5).

    - X-Frame-Options DENY: cegah clickjacking embed di iframe pihak ke-3.
    - X-Content-Type-Options nosniff: cegah MIME sniffing.
    - Referrer-Policy strict-origin-when-cross-origin: minimal referrer leak.
    - Permissions-Policy: disable feature browser yg tdk kita pakai.
    - Strict-Transport-Security: HANYA di prod (HTTPS enforce 1 tahun).
      Dev tdk pakai (browser cache HSTS bisa lock dev http).
    - Content-Security-Policy: DULU dilewati ("butuh audit per-page").
      Sekarang bisa, karena SPA disajikan dari origin yang sama sehingga
      seluruh sumber daya berasal dari `self`. Build Vite juga tidak
      punya <script> inline (diverifikasi di dist/index.html), jadi
      tidak perlu 'unsafe-inline' untuk skrip.

      Dikirim sebagai **Report-Only** secara default. CSP yang salah
      menghasilkan halaman putih tanpa pesan yang jelas, jadi jangan
      langsung memaksakannya di aplikasi yang sedang dipakai. Alur yang
      dimaksudkan:
        1. Deploy dgn report-only, buka aplikasi, cek console browser.
        2. Kalau tidak ada laporan pelanggaran, set CSP_ENFORCE=true.
      Set `CSP_ENFORCE=true` untuk mengubahnya jadi menegakkan.

      `style-src` memakai 'unsafe-inline' karena Radix/Recharts menaruh
      gaya lewat atribut style. (React menulis gaya lewat CSSOM yang
      sebenarnya tidak dibatasi CSP, tapi pustaka pihak ketiga tidak
      dijamin begitu -- ini yang dilonggarkan lebih dulu kalau ada
      laporan pelanggaran.)

      /docs dan /redoc DIKECUALIKAN: Swagger UI memuat aset dari CDN
      jsdelivr, dan melonggarkan policy global demi halaman dokumentasi
      internal itu salah tukar.
    """

    # Sumber daya SPA semuanya same-origin setelah penggabungan service.
    _CSP = "; ".join([
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self'",
        "form-action 'self'",
    ])

    # Halaman yang sengaja tidak diberi CSP.
    _CSP_EXEMPT = ("/docs", "/redoc", "/openapi.json")

    def __init__(self, app, *, is_prod: bool, csp_enforce: bool = False):
        super().__init__(app)
        self._is_prod = is_prod
        self._csp_header = (
            "Content-Security-Policy" if csp_enforce
            else "Content-Security-Policy-Report-Only"
        )

    async def dispatch(self, request: StarletteRequest, call_next) -> StarletteResponse:
        response = await call_next(request)
        response.headers.setdefault("X-Frame-Options", "DENY")
        if not request.url.path.startswith(self._CSP_EXEMPT):
            response.headers.setdefault(self._csp_header, self._CSP)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault(
            "Referrer-Policy", "strict-origin-when-cross-origin"
        )
        response.headers.setdefault(
            "Permissions-Policy",
            "camera=(), microphone=(), geolocation=(), interest-cohort=()",
        )
        if self._is_prod:
            # HSTS 1 tahun, include subdomains. Pakai 'preload' kalau
            # operator submit ke hsts preload list (manual, optional).
            response.headers.setdefault(
                "Strict-Transport-Security",
                "max-age=31536000; includeSubDomains",
            )
        return response


app.add_middleware(
    _SecurityHeadersMiddleware,
    is_prod=settings.is_prod,
    csp_enforce=settings.CSP_ENFORCE,
)

upload_path = Path(settings.UPLOAD_DIR)
upload_path.mkdir(parents=True, exist_ok=True)

app.include_router(api_router, prefix="/api/v1")

# Audit 2026-06-13 #S-03: `/files` DULU adalah StaticFiles mount tanpa
# autentikasi -- seluruh bukti transaksi & lampiran invoice terbuka utk
# siapa pun yg tahu URL-nya. Sekarang dilayani router yg memverifikasi
# user lalu memanggil ensure_project_access. Prefix-nya sengaja sama
# supaya URL yg sudah tersimpan di DB tetap bekerja.
app.include_router(files_router)


@app.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    return {"status": "ok", "app": settings.APP_NAME}


# ---------------------------------------------------------------------------
# Serving SPA (deploy satu service)
# ---------------------------------------------------------------------------
# Frontend & backend dijalankan dari satu container supaya Railway cukup
# punya SATU service aplikasi (+ Postgres). Efek sampingnya: SPA dan API
# berbagi origin, jadi CORS tidak lagi berperan di produksi.
#
# Urutan pendaftaran penting. Router API dan /files sudah terdaftar di
# atas, jadi catch-all di bawah tidak akan pernah menelan rute mereka.
_frontend_dist = Path(settings.FRONTEND_DIST)
_frontend_index = _frontend_dist / "index.html"

if _frontend_index.is_file():
    # Aset ber-hash dari Vite: aman di-cache lama karena namanya berubah
    # tiap build.
    _assets_dir = _frontend_dist / "assets"
    if _assets_dir.is_dir():
        app.mount(
            "/assets",
            StaticFiles(directory=str(_assets_dir)),
            name="spa-assets",
        )

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str) -> Response:
        """Sajikan berkas statis kalau ada, selain itu index.html.

        React Router memakai path asli (mis. /transactions/123), jadi
        refresh di route mana pun harus mengembalikan index.html --
        bukan 404.
        """
        # 404 asli untuk namespace API supaya kesalahan URL endpoint
        # tidak balas HTML yang membingungkan saat debug.
        if full_path.startswith(("api/", "files/")):
            raise HTTPException(status_code=404, detail="not_found")

        if full_path:
            try:
                candidate = (_frontend_dist / full_path).resolve()
                if (
                    candidate.is_file()
                    and candidate.is_relative_to(_frontend_dist.resolve())
                ):
                    return FileResponse(candidate)
            except (OSError, ValueError):
                pass

        # index.html tidak boleh di-cache: kalau proxy menyimpannya, user
        # bisa dapat HTML lama yang menunjuk chunk hash yang sudah hilang
        # setelah deploy -> "error loading chunk".
        return FileResponse(
            _frontend_index,
            media_type="text/html",
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
        )
else:
    print(
        f"[startup] FRONTEND_DIST tidak ditemukan di {_frontend_dist} -- "
        "mode API-only (normal saat dev dgn `vite dev`)."
    )
