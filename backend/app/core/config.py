from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    APP_ENV: str = "dev"
    APP_NAME: str = "Bintang"
    SECRET_KEY: str = "dev-secret-change-me-please-rotate-in-prod"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 720

    DATABASE_URL: str = "sqlite+aiosqlite:///./bintang.db"

    UPLOAD_DIR: str = "./uploads"
    MAX_UPLOAD_MB: int = 20

    # Default KOSONG = hanya same-origin.
    #
    # Sampai 2026-06-13 default-nya berisi localhost:5173, peninggalan
    # saat frontend adalah service terpisah. Setelah SPA disajikan
    # FastAPI dari origin yang sama, tidak ada request lintas-origin yang
    # perlu diizinkan -- dan default lama itu justru membuat guard prod
    # menolak boot di deploy yang tidak menyetel variabel ini sama sekali.
    #
    # Saat dev pun tidak perlu diisi: Vite mem-proxy /api dan /files ke
    # backend, jadi browser hanya bicara ke satu origin.
    ALLOWED_ORIGINS: str = ""

    # Jumlah proxy tepercaya di depan aplikasi. Dipakai untuk membaca
    # X-Forwarded-For dari KANAN saat menentukan IP klien (audit #S-06).
    # Railway = 1 edge proxy. Set 0 kalau app diekspos langsung.
    TRUSTED_PROXY_HOPS: int = 1

    # Content-Security-Policy ditegakkan secara default. Set False hanya
    # sementara untuk diagnosis agar header berubah menjadi Report-Only.
    CSP_ENFORCE: bool = True

    # --- Serving frontend (deploy satu service) ---
    # Direktori hasil build SPA (Vite `dist/`). Kalau ada, backend ikut
    # menyajikan SPA di "/" sehingga frontend & backend jadi SATU service
    # Railway -- dan karena jadi satu origin, CORS tidak lagi diperlukan.
    # Kosong / direktori tidak ada = mode API-only (dev, `vite dev`
    # terpisah dgn proxy).
    FRONTEND_DIST: str = "/app/frontend_dist"

    # --- Telegram bot ---
    # Token dari @BotFather. KOSONG = integrasi off.
    TELEGRAM_BOT_TOKEN: str = ""
    # Secret untuk verifikasi webhook. Tambahkan sebagai query string `?secret=`
    # dan juga sebagai header `X-Telegram-Bot-Api-Secret-Token` saat register.
    TELEGRAM_WEBHOOK_SECRET: str = ""
    # Public base URL untuk register webhook otomatis saat startup. Kosong = manual.
    # Contoh: https://api.bintang.me
    PUBLIC_BASE_URL: str = ""

    # --- OCR ---
    # Pilih engine:
    #   "stub"    -> dummy data (default, dev mode)
    #   "claude"  -> Anthropic Claude Vision (Haiku 4.5 default; ~$0.01/img)
    #   "mistral" -> Mistral Document AI (mistral-ocr-latest; ~$0.002/page,
    #               5-10x lebih murah dari Claude)
    OCR_ENGINE: str = "stub"
    # Model OCR -- ada 2 env terpisah PER engine supaya tidak salah forward
    # (mis. claude model ke Mistral API -> 400 invalid_model).
    #   OCR_MODEL_CLAUDE   default: "claude-haiku-4-5"
    #   OCR_MODEL_MISTRAL  default: "mistral-ocr-latest"
    OCR_MODEL_CLAUDE: str = ""
    OCR_MODEL_MISTRAL: str = ""
    # Backward-compat: OCR_MODEL lama. Akan di-forward HANYA kalau prefix
    # cocok dgn engine yg dipakai (claude-* utk claude, mistral-* utk mistral).
    # Engine lain akan abaikan (pakai default). Logging warning kalau mismatch.
    OCR_MODEL: str = ""
    # API key Anthropic (wajib kalau OCR_ENGINE="claude"). Kosong = skip.
    ANTHROPIC_API_KEY: str = ""
    # API key Mistral (wajib kalau OCR_ENGINE="mistral"). Generate di
    # https://console.mistral.ai/api-keys/. Kosong = skip.
    MISTRAL_API_KEY: str = ""

    # --- WhatsApp via WAHA ---
    # Base URL WAHA-server (TANPA trailing slash). KOSONG = integrasi off.
    # Contoh: http://172.105.116.245:3000
    WHATSAPP_BASE_URL: str = ""
    # Nama session WAHA, default "default". WAHA Core hanya 1 session.
    WHATSAPP_SESSION: str = "default"
    # API key WAHA (header X-Api-Key). Boleh kosong untuk WAHA Core tanpa auth.
    WHATSAPP_API_KEY: str = ""
    # Secret yang dipasang di WAHA -> webhook header X-Webhook-Hmac dipakai
    # untuk verifikasi sumber. Nilai dibaca lewat app_settings (DB > env).
    # Saat ini boleh kosong karena keterbatasan persistensi WAHA Core;
    # lihat catatan eksplisit di api/v1/whatsapp.py.
    WHATSAPP_WEBHOOK_SECRET: str = ""

    @field_validator("DATABASE_URL", mode="before")
    @classmethod
    def normalize_database_url(cls, value: object) -> object:
        """Railway menyediakan URL Postgres sync; runtime memakai asyncpg."""
        if not isinstance(value, str):
            return value
        if value.startswith("postgres://"):
            return "postgresql+asyncpg://" + value.removeprefix("postgres://")
        if value.startswith("postgresql://"):
            return "postgresql+asyncpg://" + value.removeprefix("postgresql://")
        return value

    @property
    def allowed_origins_list(self) -> list[str]:
        """Nilai mentah dari konfigurasi (belum disaring)."""
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]

    @property
    def local_origins_in_prod(self) -> list[str]:
        """Entri localhost yang akan dibuang saat APP_ENV=prod."""
        if not self.is_prod:
            return []
        return [o for o in self.allowed_origins_list if "localhost" in o or "127.0.0.1" in o]

    @property
    def allowed_origins_effective(self) -> list[str]:
        """Origin yang BENAR-BENAR dipasang ke CORSMiddleware.

        Di prod, entri localhost dibuang. Ini disaring di sini -- bukan
        di guard lifespan -- karena middleware dibangun saat import,
        SEBELUM lifespan berjalan; menyaring di guard tidak akan
        berpengaruh pada middleware yang sudah terlanjur dibuat.
        """
        dropped = set(self.local_origins_in_prod)
        return [o for o in self.allowed_origins_list if o not in dropped]

    @property
    def is_sqlite(self) -> bool:
        return self.DATABASE_URL.startswith("sqlite")

    @property
    def is_prod(self) -> bool:
        return self.APP_ENV.lower() in ("prod", "production")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
