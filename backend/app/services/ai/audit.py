"""Log setiap AI call ke ai_call_logs utk analytics + cost tracking.

Audit 2026-05-23 AI foundation.

Tdk simpan full prompt/response (privacy + storage). Hanya metadata.
"""
from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import AICallLog

log = logging.getLogger(__name__)


async def log_call(
    db: AsyncSession,
    *,
    user_id: int | None,
    feature: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
    cost_usd: str,
    latency_ms: int,
    cached: bool = False,
    success: bool = True,
    error: str | None = None,
) -> None:
    """Tambahkan 1 baris audit log. Caller commit."""
    db.add(AICallLog(
        user_id=user_id,
        feature=feature,
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cost_usd=cost_usd,
        latency_ms=latency_ms,
        cached=cached,
        success=success,
        error=(error[:1000] if error else None),
    ))
    log.info(
        "ai.call feature=%s model=%s tokens=%d/%d cost=$%s lat=%dms cached=%s ok=%s",
        feature, model, input_tokens, output_tokens, cost_usd,
        latency_ms, cached, success,
    )
