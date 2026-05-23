from functools import lru_cache
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    APP_ENV: str = "dev"
    APP_NAME: str = "CACAK"
    SECRET_KEY: str = "dev-secret-change-me-please-rotate-in-prod"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 720

    DATABASE_URL: str = "sqlite+aiosqlite:///./bintang.db"

    UPLOAD_DIR: str = "./uploads"
    MAX_UPLOAD_MB: int = 20

    ALLOWED_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"

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
    # untuk verifikasi sumber. Boleh kosong (skip verifikasi) -- tidak disarankan
    # di prod.
    WHATSAPP_WEBHOOK_SECRET: str = ""

    @property
    def allowed_origins_list(self) -> list[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]

    @property
    def is_sqlite(self) -> bool:
        return self.DATABASE_URL.startswith("sqlite")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
