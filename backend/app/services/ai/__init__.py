"""AI service layer -- generic infra utk semua fitur AI (OCR, chat-based
features, generators, dll).

Audit 2026-05-23 AI foundation.

Modul:
- llm.py        -- generic chat client (Claude + Mistral), tool use, JSON mode
- cache.py      -- namespace-based AI response cache (table ai_cache)
- rate_limit.py -- per-feature rate limiter factory
- audit.py      -- log setiap AI call (cost, tokens, latency, user) ke ai_call_logs
- pricing.py    -- model -> price per 1M token (estimate cost)
- prompts/      -- system prompts per feature (struktur expandable)

Cara tambah fitur AI baru, lihat README di module ini.

Existing OCR (services/ocr/) berdiri sendiri utk sekarang -- migrasi ke
services/ai/ di masa depan kalau ada nilai (saat ini OCR sudah established).
"""

from app.services.ai.llm import LLMResponse, chat
from app.services.ai.cache import lookup as cache_lookup, store as cache_store
from app.services.ai.rate_limit import get_limiter
from app.services.ai.audit import log_call

__all__ = [
    "LLMResponse",
    "chat",
    "cache_lookup",
    "cache_store",
    "get_limiter",
    "log_call",
]
