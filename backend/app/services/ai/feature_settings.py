"""Per-feature AI runtime settings.

Audit 2026-05-24 user req: tdk hardcode, admin atur per feature.

Layered config:
1. DEFAULTS dict di code (kalau row override tdk ada)
2. Override row di tabel `ai_feature_settings` (kalau ada)
3. Caller bisa argumentpass yg over-rule keduanya (mis. paksa max_tokens
   utk eksperimen) — saat ini tdk dipakai.

Caller pattern:
    cfg = await get_effective(db, "category")
    chat(..., model_hint=cfg.model_hint, max_tokens=cfg.max_tokens,
         cache_ttl_days=cfg.cache_ttl_days, ...)

Budget enforcement: sebelum panggil chat, cek `monthly_spend_usd`
vs `monthly_budget_usd`. Kalau lewat → raise BudgetExceededError.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import AICallLog, AIFeatureSettings


class BudgetExceededError(RuntimeError):
    """Monthly budget utk feature ini sudah habis."""


# Default per-feature. Sumber kebenaran kalau row override tdk ada.
# Map feature_key (matches ai_prompt_registry) ke default config.
# `provider` = None artinya pakai AI_DEFAULT_PROVIDER global setting.
# `model` = None artinya pakai model_hint resolve.
DEFAULTS: dict[str, dict] = {
    "category": {
        # Audit 2026-05-24: AI v2 dgn history context -- butuh reasoning
        # lebih kuat. Default model_hint=smart (Mistral Large / Claude
        # Sonnet). Admin bisa downgrade ke "fast" lewat AI Settings.
        "provider": None, "model": None, "model_hint": "smart",
        "max_tokens": 1024, "cache_ttl_days": 7,
        "rate_limit_per_min": 60, "web_search_enabled": False,
        "monthly_budget_usd": None,
    },
    "anomaly": {
        "provider": None, "model": None, "model_hint": "smart",
        "max_tokens": 2048, "cache_ttl_days": 0,
        "rate_limit_per_min": 10, "web_search_enabled": False,
        "monthly_budget_usd": None,
    },
    "po_cover": {
        "provider": None, "model": None, "model_hint": "smart",
        "max_tokens": 800, "cache_ttl_days": 3,
        "rate_limit_per_min": 20, "web_search_enabled": False,
        "monthly_budget_usd": None,
    },
    "cash_justify": {
        "provider": None, "model": None, "model_hint": "fast",
        "max_tokens": 400, "cache_ttl_days": 3,
        "rate_limit_per_min": 30, "web_search_enabled": False,
        "monthly_budget_usd": None,
    },
    "contract_extract": {
        "provider": None, "model": None, "model_hint": "smart",
        "max_tokens": 6144, "cache_ttl_days": 30,
        "rate_limit_per_min": 10, "web_search_enabled": False,
        "monthly_budget_usd": None,
    },
    "ask_query": {
        "provider": None, "model": None, "model_hint": "fast",
        "max_tokens": 512, "cache_ttl_days": 1,
        "rate_limit_per_min": 30, "web_search_enabled": False,
        "monthly_budget_usd": None,
    },
    "daily_summary": {
        "provider": None, "model": None, "model_hint": "fast",
        "max_tokens": 400, "cache_ttl_days": 1,
        "rate_limit_per_min": 20, "web_search_enabled": False,
        "monthly_budget_usd": None,
    },
    "categorize_items": {
        # Audit 2026-05-24: bulk per-item categorization. Items bisa
        # banyak (sampai 100), reasoning per item -- pakai smart model.
        "provider": None, "model": None, "model_hint": "smart",
        "max_tokens": 4096, "cache_ttl_days": 0,
        "rate_limit_per_min": 20, "web_search_enabled": False,
        "monthly_budget_usd": None,
    },
    "ocr_invoice": {
        # OCR sudah punya settings tersendiri di app_settings (provider,
        # model). Di sini hanya utk prompt override + audit cost/budget.
        # Provider/model dummy = None -> mengikuti AI_DEFAULT_PROVIDER /
        # OCR_PROVIDER. Field-field operasional (max_tokens, cache, dst)
        # tdk dipakai oleh adapter OCR -- ignored.
        "provider": None, "model": None, "model_hint": "smart",
        "max_tokens": 8192, "cache_ttl_days": 30,
        "rate_limit_per_min": 30, "web_search_enabled": False,
        "monthly_budget_usd": None,
    },
    "category_audit": {
        # Audit 2026-05-24: scan + flag tx mis-categorized. Reasoning
        # task -- pakai smart model.
        "provider": None, "model": None, "model_hint": "smart",
        "max_tokens": 2048, "cache_ttl_days": 0,
        "rate_limit_per_min": 5, "web_search_enabled": False,
        "monthly_budget_usd": None,
    },
    "po_chat_parser": {
        # Audit 2026-05-30: parse free-text chat ke PO struktur. Tugas
        # ekstraksi sederhana, model fast cukup (Mistral Small / Haiku).
        # Cache 0 -- tiap user kirim unik, caching probably tdk hit.
        "provider": None, "model": None, "model_hint": "fast",
        "max_tokens": 1024, "cache_ttl_days": 0,
        "rate_limit_per_min": 30, "web_search_enabled": False,
        "monthly_budget_usd": None,
    },
}


@dataclass(frozen=True)
class EffectiveConfig:
    feature_key: str
    provider: str | None        # 'claude' | 'mistral' | None
    model: str | None           # full model name, None = use model_hint
    model_hint: str             # "fast" | "smart" (used if model is None)
    max_tokens: int
    cache_ttl_days: int
    rate_limit_per_min: int
    web_search_enabled: bool
    monthly_budget_usd: Decimal | None
    # Indicator field-mana yg override (utk UI badge "custom")
    overridden_fields: tuple[str, ...]


def _merge(default: dict, row: AIFeatureSettings | None) -> tuple[dict, tuple[str, ...]]:
    out = dict(default)
    overridden: list[str] = []
    if row is None:
        return out, ()
    fields = [
        "provider", "model", "max_tokens", "cache_ttl_days",
        "rate_limit_per_min", "web_search_enabled", "monthly_budget_usd",
    ]
    for f in fields:
        val = getattr(row, f)
        if val is not None:
            out[f] = val
            overridden.append(f)
    return out, tuple(overridden)


async def get_effective(
    db: AsyncSession, feature_key: str,
) -> EffectiveConfig:
    if feature_key not in DEFAULTS:
        raise KeyError(f"Unknown feature: {feature_key}")
    default = DEFAULTS[feature_key]
    row = (await db.execute(
        select(AIFeatureSettings).where(
            AIFeatureSettings.feature_key == feature_key,
        )
    )).scalar_one_or_none()
    merged, overridden = _merge(default, row)
    # Resolve model_hint: kalau explicit model di-set, hint diabaikan
    # (tetap dibawa utk audit).
    return EffectiveConfig(
        feature_key=feature_key,
        provider=merged.get("provider"),
        model=merged.get("model"),
        model_hint=merged.get("model_hint", "fast"),
        max_tokens=merged["max_tokens"],
        cache_ttl_days=merged["cache_ttl_days"],
        rate_limit_per_min=merged["rate_limit_per_min"],
        web_search_enabled=bool(merged["web_search_enabled"]),
        monthly_budget_usd=(
            Decimal(merged["monthly_budget_usd"])
            if merged["monthly_budget_usd"] is not None else None
        ),
        overridden_fields=overridden,
    )


async def monthly_spend_usd(
    db: AsyncSession, feature_key: str,
) -> Decimal:
    """Sum cost_usd utk feature ini di bulan berjalan (UTC).

    Note: cost_usd disimpan sbg String di AICallLog (sengaja, supaya
    presisi token-level tdk lost di float). Sum di Python supaya
    decimal-aware. Volume low (~ratusan call/bulan), no perf issue.
    """
    now = datetime.now(timezone.utc)
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    feature_namespace = f"ai:{feature_key}"
    rows = (await db.execute(
        select(AICallLog.cost_usd).where(
            AICallLog.feature == feature_namespace,
            AICallLog.created_at >= start,
            AICallLog.success.is_(True),
        )
    )).scalars().all()
    total = Decimal("0")
    for v in rows:
        try:
            total += Decimal(str(v or 0))
        except Exception:  # noqa: BLE001
            pass
    return total


async def assert_within_budget(
    db: AsyncSession, feature_key: str, cfg: EffectiveConfig,
) -> None:
    """Raise BudgetExceededError kalau monthly spend >= budget cap."""
    if cfg.monthly_budget_usd is None:
        return
    spent = await monthly_spend_usd(db, feature_key)
    if spent >= cfg.monthly_budget_usd:
        raise BudgetExceededError(
            f"feature={feature_key} monthly spend ${spent:.4f} >= "
            f"budget ${cfg.monthly_budget_usd:.4f}"
        )


# Daftar model yg di-support utk dropdown FE. Schema diperkaya supaya
# user tau kapabilitas + cost + use case tiap model.
#
# `capabilities`:
#   - "chat": teks-only chat completion (kategori, ringkas, dst)
#   - "structured": support strict JSON schema output (Mistral Custom
#     Structured Outputs / Claude tool_use)
#   - "vision": bisa terima image input (utk OCR + extract dokumen)
#   - "web_search": built-in web search tool (Claude Sonnet/Opus only)
#
# `cost_tier`: relative, 1=cheapest, 5=most expensive.
SUPPORTED_MODELS = [
    # ---------- Mistral ----------
    {
        "id": "mistral-small-latest",
        "provider": "mistral",
        "label": "Mistral Small (cepat & murah)",
        "description": (
            "Default chat model. Cocok utk tugas ringan: saran kategori, "
            "justifier text, ringkasan harian. ~10x lebih murah dari Large."
        ),
        "capabilities": ["chat", "structured"],
        "cost_tier": 1,
        "cost_per_1m_input_usd": 0.20,
        "cost_per_1m_output_usd": 0.60,
        "best_for": ["category", "cash_justify", "daily_summary", "ask_query"],
    },
    {
        "id": "mistral-large-latest",
        "provider": "mistral",
        "label": "Mistral Large (reasoning kuat)",
        "description": (
            "Reasoning lebih dalam utk task analitis: deteksi anomali, "
            "audit kategori, batch categorize ramai context."
        ),
        "capabilities": ["chat", "structured"],
        "cost_tier": 3,
        "cost_per_1m_input_usd": 2.00,
        "cost_per_1m_output_usd": 6.00,
        "best_for": ["anomaly", "categorize_items", "category_audit"],
    },
    {
        "id": "mistral-ocr-latest",
        "provider": "mistral",
        "label": "Mistral OCR (khusus dokumen)",
        "description": (
            "Model OCR-spesifik. Hanya utk extract dokumen (invoice, "
            "kuitansi, kontrak). Tdk bisa chat. Support PDF multi-page "
            "natif. Jauh lebih murah dr Claude Vision."
        ),
        "capabilities": ["vision", "structured"],
        "cost_tier": 1,
        "cost_per_1m_input_usd": None,  # per-page pricing (~$0.001/page)
        "cost_per_1m_output_usd": None,
        "best_for": ["ocr_invoice", "contract_extract"],
    },
    # ---------- Claude (Anthropic) ----------
    {
        "id": "claude-haiku-4-5",
        "provider": "claude",
        "label": "Claude Haiku 4.5 (cepat + vision)",
        "description": (
            "Cepat + murah utk chat ringan. Sudah support vision = bisa "
            "OCR juga. Cocok utk volume tinggi yg masih butuh akurasi."
        ),
        "capabilities": ["chat", "structured", "vision"],
        "cost_tier": 2,
        "cost_per_1m_input_usd": 1.00,
        "cost_per_1m_output_usd": 5.00,
        "best_for": ["category", "cash_justify", "ocr_invoice"],
    },
    {
        "id": "claude-sonnet-4-6",
        "provider": "claude",
        "label": "Claude Sonnet 4.6 (balanced + web search)",
        "description": (
            "Reasoning bagus + vision + web_search built-in. Pakai utk "
            "fitur agentic (price check via web), OCR sulit handwriting, "
            "analisis kompleks."
        ),
        "capabilities": ["chat", "structured", "vision", "web_search"],
        "cost_tier": 4,
        "cost_per_1m_input_usd": 3.00,
        "cost_per_1m_output_usd": 15.00,
        "best_for": ["po_cover", "anomaly", "contract_extract", "category_audit"],
    },
    {
        "id": "claude-opus-4-7",
        "provider": "claude",
        "label": "Claude Opus 4.7 (top quality, mahal)",
        "description": (
            "Top-tier reasoning + vision + web_search. Pakai hanya utk "
            "case kritis yg butuh akurasi maksimal. Cost 5-10x Sonnet."
        ),
        "capabilities": ["chat", "structured", "vision", "web_search"],
        "cost_tier": 5,
        "cost_per_1m_input_usd": 15.00,
        "cost_per_1m_output_usd": 75.00,
        "best_for": [],  # opsi premium, no default recommendation
    },
]


# Per-feature kapabilitas yg DIBUTUHKAN. FE filter dropdown -- model
# yg tdk match capability di-hide. Audit 2026-05-24.
FEATURE_REQUIRED_CAPABILITIES: dict[str, tuple[str, ...]] = {
    "category": ("chat", "structured"),
    "anomaly": ("chat", "structured"),
    "po_cover": ("chat",),  # text generation, no schema
    "cash_justify": ("chat",),
    "contract_extract": ("vision", "structured"),
    "ask_query": ("chat", "structured"),
    "daily_summary": ("chat",),
    "categorize_items": ("chat", "structured"),
    "category_audit": ("chat", "structured"),
    "ocr_invoice": ("vision",),
}
