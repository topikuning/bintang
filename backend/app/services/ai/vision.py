"""Generic AI vision extraction (selain OCR invoice yang sudah established).

Audit 2026-05-23 AI foundation. Pakai utk extract dokumen non-invoice
(kontrak, SPK, BAST, dll) dgn schema custom.

Selalu pakai Claude (Mistral OCR khusus invoice-shape, kurang fleksibel
utk dokumen kompleks).
"""
from __future__ import annotations

import base64
import hashlib
import logging
import time
from decimal import Decimal
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.ai import audit, cache
from app.services.ai.pricing import estimate_cost
from app.services.ai.rate_limit import get_limiter
from app.services.app_settings import get_cached as get_setting

log = logging.getLogger(__name__)

_ANTHROPIC_TIMEOUT = 90.0
# Vision butuh model yg support image input
_VISION_MODEL_DEFAULT = "claude-sonnet-4-6"


async def extract_from_image(
    db: AsyncSession,
    *,
    user_id: int | None,
    feature: str,
    content: bytes,
    media_type: str,
    system_prompt: str,
    schema: dict[str, Any],
    tool_name: str = "save_extraction",
    model: str | None = None,
    cache_ttl_days: int = 30,
    rate_limit_max: int = 20,
    rate_limit_period: float = 60.0,
    max_tokens: int = 4096,
) -> dict[str, Any]:
    """Extract dokumen image/PDF via Claude vision dgn schema custom.

    Return: hasil tool_use input (dict) + _meta keys.

    Caller commit DB.
    """
    # Rate-limit per feature per user
    limiter = get_limiter(
        feature, max_calls=rate_limit_max, period_seconds=rate_limit_period,
    )
    rl_key = f"u:{user_id}" if user_id else "anon"
    if not limiter.check(rl_key)[0]:
        raise RuntimeError(f"ai_rate_limited: feature={feature}")

    # Cache by (feature, content hash, schema hash) -- schema berubah =
    # cache invalidate (extraction shape beda).
    content_hash = hashlib.sha256(content).hexdigest()
    schema_hash = hashlib.sha256(
        cache.make_key(schema).encode("utf-8")
    ).hexdigest()[:16]
    cache_key = f"{content_hash}:{schema_hash}"

    if cache_ttl_days > 0:
        cached_val = await cache.lookup(
            db, namespace=feature, key=cache_key, ttl_days=cache_ttl_days,
        )
        if cached_val is not None:
            await audit.log_call(
                db, user_id=user_id, feature=feature, model="cache",
                input_tokens=0, output_tokens=0, cost_usd="0",
                latency_ms=0, cached=True,
            )
            result = dict(cached_val)
            result["_meta"] = {"cached": True, "model": "cache", "cost_usd": "0"}
            return result

    # Call Claude vision
    api_key = get_setting("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("anthropic_not_configured")
    chosen_model = model or _VISION_MODEL_DEFAULT

    import anthropic
    client = anthropic.AsyncAnthropic(
        api_key=api_key, timeout=_ANTHROPIC_TIMEOUT, max_retries=0,
    )

    b64 = base64.standard_b64encode(content).decode("ascii")
    if media_type == "application/pdf":
        content_block: dict[str, Any] = {
            "type": "document",
            "source": {"type": "base64", "media_type": media_type, "data": b64},
        }
    elif media_type.startswith("image/"):
        content_block = {
            "type": "image",
            "source": {"type": "base64", "media_type": media_type, "data": b64},
        }
    else:
        raise ValueError(f"unsupported_media_type: {media_type}")

    tool = {
        "name": tool_name,
        "description": "Wajib panggil tool ini utk save hasil ekstraksi.",
        "input_schema": schema,
    }

    t0 = time.monotonic()
    try:
        resp = await client.messages.create(
            model=chosen_model,
            max_tokens=max_tokens,
            system=system_prompt + (
                "\n\nWAJIB call tool save_extraction (atau tool_name yg disediakan) "
                "dgn semua field. Jangan jawab teks bebas."
            ),
            tools=[tool],
            tool_choice={"type": "tool", "name": tool_name},
            messages=[{
                "role": "user",
                "content": [
                    content_block,
                    {"type": "text", "text": "Extract dokumen ini dan call tool."},
                ],
            }],
        )
    except Exception as e:  # noqa: BLE001
        await audit.log_call(
            db, user_id=user_id, feature=feature, model=chosen_model,
            input_tokens=0, output_tokens=0, cost_usd="0",
            latency_ms=int((time.monotonic() - t0) * 1000),
            cached=False, success=False, error=str(e),
        )
        raise RuntimeError(f"vision_failed: {e}") from e

    latency_ms = int((time.monotonic() - t0) * 1000)
    tool_block = next(
        (b for b in resp.content if getattr(b, "type", None) == "tool_use"),
        None,
    )
    if tool_block is None:
        await audit.log_call(
            db, user_id=user_id, feature=feature, model=chosen_model,
            input_tokens=resp.usage.input_tokens,
            output_tokens=resp.usage.output_tokens,
            cost_usd=str(estimate_cost(
                chosen_model, input_tokens=resp.usage.input_tokens,
                output_tokens=resp.usage.output_tokens,
            )),
            latency_ms=latency_ms, cached=False, success=False,
            error=f"no_tool_use stop={resp.stop_reason}",
        )
        raise RuntimeError(
            f"claude_no_tool_use stop={resp.stop_reason}"
        )

    data = dict(tool_block.input or {})
    cost = estimate_cost(
        chosen_model, input_tokens=resp.usage.input_tokens,
        output_tokens=resp.usage.output_tokens,
    )

    # Cache
    if cache_ttl_days > 0:
        await cache.store(
            db, namespace=feature, key=cache_key,
            value=data,
            source_info={
                "model": chosen_model,
                "cost_usd": str(cost),
                "latency_ms": latency_ms,
                "input_tokens": resp.usage.input_tokens,
                "output_tokens": resp.usage.output_tokens,
            },
        )

    await audit.log_call(
        db, user_id=user_id, feature=feature, model=chosen_model,
        input_tokens=resp.usage.input_tokens,
        output_tokens=resp.usage.output_tokens,
        cost_usd=str(cost), latency_ms=latency_ms, cached=False, success=True,
    )

    data["_meta"] = {
        "model": chosen_model,
        "cached": False,
        "cost_usd": str(cost),
        "latency_ms": latency_ms,
        "input_tokens": resp.usage.input_tokens,
        "output_tokens": resp.usage.output_tokens,
    }
    return data
