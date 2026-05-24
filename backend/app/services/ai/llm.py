"""Generic LLM chat client. Audit 2026-05-23 AI foundation.

Endpoint umum utk semua fitur AI non-vision (kategori suggest, justifier,
generator, dll). Pakai Claude/Mistral chat completion.

Fitur:
- Provider auto-routing via model hint atau explicit model name.
- Optional JSON structured output (tool use Claude / response_format Mistral).
- Optional caching by prompt hash (TTL 30 hari default).
- Rate-limit per feature.
- Audit logging (model, tokens, cost, latency).

Pemakaian:
    from app.services.ai import chat

    resp = await chat(
        db=db,
        user_id=user.id,
        feature="chat:category",
        prompt="Saran kategori utk: Beli semen 50 sak Rp 2 juta",
        system="Kamu bantu pilih kategori dari list...",
        json_schema={"type": "object", "properties": {...}},  # opsional
        model_hint="fast",  # "fast" | "smart" | nama model explicit
        cache_ttl_days=7,   # 0 = disable cache
    )
    # resp.structured (dict kalau json_schema), resp.text, resp.cost_usd, dst.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.ai import audit, cache
from app.services.ai.pricing import estimate_cost
from app.services.ai.rate_limit import get_limiter
from app.services.app_settings import get_cached as get_setting

log = logging.getLogger(__name__)


@dataclass
class LLMResponse:
    """Response dari chat()."""
    text: str                       # Hasil teks (kosong kalau structured only)
    structured: dict | None         # Hasil JSON kalau json_schema disediakan
    model: str
    input_tokens: int
    output_tokens: int
    cost_usd: Decimal
    latency_ms: int
    cached: bool
    cache_key: str | None = None    # Utk debug


# Model hint -> resolution rule.
# "fast" = cheapest available. "smart" = best quality.
# Urutan candidates di-tweak runtime berdasar AI_DEFAULT_PROVIDER setting.
# Default 'mistral' (lebih murah) per user req 2026-05-23.
_MODEL_HINTS = {
    "fast":  ["mistral-small-latest", "claude-haiku-4-5"],
    "smart": ["mistral-large-latest", "claude-sonnet-4-6"],
}


def _resolve_model(hint: str | None) -> tuple[str, str]:
    """Return (model_name, provider). Provider = 'claude' | 'mistral'.

    Resolution:
    - Explicit "claude-*" -> claude.
    - Explicit "mistral-*" -> mistral.
    - "fast"/"smart" -> first available, urutan ditentukan oleh
      AI_DEFAULT_PROVIDER setting. Kalau provider default = mistral,
      coba mistral dulu; kalau key tdk ada, fallback ke claude.
    - None -> default fast.
    """
    if hint and hint.startswith("claude-"):
        return hint, "claude"
    if hint and hint.startswith("mistral-"):
        return hint, "mistral"
    candidates = _MODEL_HINTS.get(hint or "fast", _MODEL_HINTS["fast"])
    # Reorder berdasar AI_DEFAULT_PROVIDER. Default 'mistral' (murah).
    default_provider = (get_setting("AI_DEFAULT_PROVIDER") or "mistral").lower()
    if default_provider not in ("mistral", "claude"):
        default_provider = "mistral"
    # Stable-sort: default_provider candidates dulu, lalu yg lain.
    candidates = sorted(
        candidates,
        key=lambda m: 0 if m.startswith(f"{default_provider}-") else 1,
    )
    for model in candidates:
        provider = "claude" if model.startswith("claude-") else "mistral"
        key_setting = (
            "ANTHROPIC_API_KEY" if provider == "claude" else "MISTRAL_API_KEY"
        )
        if get_setting(key_setting):
            return model, provider
    # Tdk ada key tersedia -> raise utk fail-loudly (vs silent stub)
    raise RuntimeError(
        "ai_no_provider_configured: set ANTHROPIC_API_KEY atau MISTRAL_API_KEY"
    )


async def _call_claude(
    *,
    model: str,
    system: str | None,
    prompt: str,
    json_schema: dict | None,
    max_tokens: int,
    timeout: float,
) -> tuple[str, dict | None, int, int]:
    """Return (text, structured, input_tokens, output_tokens)."""
    import anthropic
    api_key = get_setting("ANTHROPIC_API_KEY")
    client = anthropic.AsyncAnthropic(
        api_key=api_key, timeout=timeout, max_retries=0,
    )
    kwargs: dict[str, Any] = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt}],
    }
    if system:
        kwargs["system"] = system
    if json_schema:
        tool = {
            "name": "structured_response",
            "description": "Wajib pakai tool ini utk return hasil terstruktur.",
            "input_schema": json_schema,
        }
        kwargs["tools"] = [tool]
        kwargs["tool_choice"] = {"type": "tool", "name": "structured_response"}
    resp = await client.messages.create(**kwargs)

    text = ""
    structured: dict | None = None
    for b in resp.content:
        btype = getattr(b, "type", None)
        if btype == "text":
            text += getattr(b, "text", "") or ""
        elif btype == "tool_use":
            structured = dict(b.input or {})
    return text, structured, resp.usage.input_tokens, resp.usage.output_tokens


async def _call_mistral(
    *,
    model: str,
    system: str | None,
    prompt: str,
    json_schema: dict | None,
    max_tokens: int,
    timeout: float,
) -> tuple[str, dict | None, int, int]:
    """Return (text, structured, input_tokens, output_tokens).

    Audit 2026-05-23: upgrade ke `response_format.type=json_schema`
    (Mistral Custom Structured Outputs, GA 2025). Sebelumnya pakai
    'json_object' + instruksi schema di system prompt -- kurang strict.
    Reference: https://docs.mistral.ai/capabilities/structured_output/custom
    """
    import httpx
    import json as _json
    api_key = get_setting("MISTRAL_API_KEY")
    msgs: list[dict] = []
    if system:
        msgs.append({"role": "system", "content": system})
    msgs.append({"role": "user", "content": prompt})
    payload: dict[str, Any] = {
        "model": model, "messages": msgs, "max_tokens": max_tokens,
        "temperature": 0,  # deterministic utk structured output
    }
    if json_schema:
        # Mistral Custom Structured Outputs. Schema di-pass via
        # response_format.json_schema (bukan tool_use spt Claude).
        # `strict: true` memaksa Mistral konform schema. Lebih reliable
        # drpd 'json_object' mode lama.
        payload["response_format"] = {
            "type": "json_schema",
            "json_schema": {
                "name": "extraction",
                "schema": {**json_schema, "additionalProperties": False},
                "strict": True,
            },
        }
    async with httpx.AsyncClient(timeout=timeout) as hx:
        r = await hx.post(
            "https://api.mistral.ai/v1/chat/completions",
            json=payload,
            headers={"Authorization": f"Bearer {api_key}",
                     "Content-Type": "application/json"},
        )
        r.raise_for_status()
        data = r.json()
    choice = data["choices"][0]["message"]["content"]
    text = choice if isinstance(choice, str) else ""
    structured: dict | None = None
    if json_schema and text:
        try:
            structured = _json.loads(text)
        except Exception as e:  # noqa: BLE001
            log.warning("ai.mistral.json_parse_failed: %s -- text=%r", e, text[:200])
    usage = data.get("usage", {})
    return text, structured, usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0)


# Rate limit default per fitur kalau caller tdk override.
_DEFAULT_RATE = {"max_calls": 30, "period_seconds": 60.0}


async def chat(
    db: AsyncSession,
    *,
    user_id: int | None,
    feature: str,
    prompt: str,
    system: str | None = None,
    json_schema: dict | None = None,
    model_hint: str | None = "fast",
    cache_ttl_days: int = 7,
    rate_limit_max: int | None = None,
    rate_limit_period: float | None = None,
    max_tokens: int = 1024,
    timeout: float = 30.0,
    # Audit 2026-05-24: per-feature settings overlay. Kalau di-set,
    # lookup ai_feature_settings + budget check. Caller args masih
    # menang (kalau caller explicit, override config).
    feature_key: str | None = None,
) -> LLMResponse:
    """Generic AI chat. Lihat docstring module."""
    # Per-feature config overlay (audit 2026-05-24).
    if feature_key:
        from app.services.ai.feature_settings import (
            assert_within_budget, get_effective,
        )
        _cfg = await get_effective(db, feature_key)
        await assert_within_budget(db, feature_key, _cfg)
        # Explicit caller args TIDAK di-override -- config cuma fill defaults.
        if model_hint == "fast" or model_hint == "smart":
            # Caller pakai hint generic -> bisa di-override config.
            model_hint = _cfg.model or _cfg.model_hint
        elif model_hint is None:
            model_hint = _cfg.model or _cfg.model_hint
        if max_tokens == 1024:  # default arg
            max_tokens = _cfg.max_tokens
        if cache_ttl_days == 7:
            cache_ttl_days = _cfg.cache_ttl_days
        if rate_limit_max is None:
            rate_limit_max = _cfg.rate_limit_per_min
    # Rate-limit per feature per user.
    limiter = get_limiter(
        feature,
        max_calls=rate_limit_max or _DEFAULT_RATE["max_calls"],
        period_seconds=rate_limit_period or _DEFAULT_RATE["period_seconds"],
    )
    rl_key = f"u:{user_id}" if user_id else "anon"
    allowed, _retry = limiter.check(rl_key)
    if not allowed:
        # Tdk audit-log rate-limited (bukan AI call, tdk consume token)
        raise RuntimeError(f"ai_rate_limited: feature={feature}")

    model, provider = _resolve_model(model_hint)

    # Cache lookup (opsional).
    cache_key: str | None = None
    if cache_ttl_days > 0:
        cache_key = cache.make_key({
            "feature": feature, "model": model,
            "system": system, "prompt": prompt,
            "schema": json_schema,
        })
        cached_val = await cache.lookup(
            db, namespace=feature, key=cache_key, ttl_days=cache_ttl_days,
        )
        if cached_val is not None:
            await audit.log_call(
                db, user_id=user_id, feature=feature, model=model,
                input_tokens=0, output_tokens=0, cost_usd="0",
                latency_ms=0, cached=True, success=True,
            )
            return LLMResponse(
                text=cached_val.get("text", ""),
                structured=cached_val.get("structured"),
                model=model, input_tokens=0, output_tokens=0,
                cost_usd=Decimal("0"), latency_ms=0,
                cached=True, cache_key=cache_key,
            )

    # Call provider
    t0 = time.monotonic()
    success = True
    err_str: str | None = None
    try:
        if provider == "claude":
            text, structured, in_tok, out_tok = await _call_claude(
                model=model, system=system, prompt=prompt,
                json_schema=json_schema, max_tokens=max_tokens, timeout=timeout,
            )
        else:
            text, structured, in_tok, out_tok = await _call_mistral(
                model=model, system=system, prompt=prompt,
                json_schema=json_schema, max_tokens=max_tokens, timeout=timeout,
            )
    except Exception as e:  # noqa: BLE001
        success = False
        err_str = str(e)
        await audit.log_call(
            db, user_id=user_id, feature=feature, model=model,
            input_tokens=0, output_tokens=0, cost_usd="0",
            latency_ms=int((time.monotonic() - t0) * 1000),
            cached=False, success=False, error=err_str,
        )
        raise

    latency_ms = int((time.monotonic() - t0) * 1000)
    cost = estimate_cost(model, input_tokens=in_tok, output_tokens=out_tok)

    # Store cache + audit
    if cache_ttl_days > 0 and cache_key:
        await cache.store(
            db, namespace=feature, key=cache_key,
            value={"text": text, "structured": structured},
            source_info={"model": model, "cost_usd": str(cost), "latency_ms": latency_ms},
        )
    await audit.log_call(
        db, user_id=user_id, feature=feature, model=model,
        input_tokens=in_tok, output_tokens=out_tok, cost_usd=str(cost),
        latency_ms=latency_ms, cached=False, success=success, error=err_str,
    )

    return LLMResponse(
        text=text, structured=structured, model=model,
        input_tokens=in_tok, output_tokens=out_tok,
        cost_usd=cost, latency_ms=latency_ms, cached=False,
        cache_key=cache_key,
    )
