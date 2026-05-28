"""Per-feature rate-limiter factory. Audit 2026-05-23 AI foundation.

Pakai infra core.rate_limit.RateLimiter (in-memory sliding window).
Setiap feature dapat bucket sendiri supaya OCR yg ramai tdk affect
chat-category yg jarang.

Pemakaian:
    from app.services.ai.rate_limit import get_limiter

    limiter = get_limiter("chat:category", max_calls=30, period_seconds=60)
    ok, retry = limiter.check(f"user:{user.id}")
    if not ok:
        raise HTTPException(429, ...)
"""
from __future__ import annotations

from app.core.rate_limit import RateLimiter

_limiters: dict[str, RateLimiter] = {}


def get_limiter(
    feature_id: str,
    *,
    max_calls: int,
    period_seconds: float,
) -> RateLimiter:
    """Return limiter utk feature_id. Idempoten: call kedua dgn feature_id
    sama return instance yg sama (tdk bikin baru, parameter di-ignore).

    Caller pattern (di endpoint module-level):
        my_limiter = get_limiter("chat:category", max_calls=30,
                                  period_seconds=60.0)
    """
    if feature_id not in _limiters:
        _limiters[feature_id] = RateLimiter(
            max_calls=max_calls, period_seconds=period_seconds,
        )
    return _limiters[feature_id]


def reset_all() -> None:
    """Reset semua limiter (utk test/dev)."""
    for lim in _limiters.values():
        lim._buckets.clear()  # noqa: SLF001
