"""Generic AI response cache (table ai_cache).

Namespace + key based. Lebih luas dari OCRCache (yg khusus file_hash):
- ocr:invoice  -> key = sha256(file_bytes)
- chat:category -> key = sha256(prompt_normalized)
- chat:po-cover -> key = hash(items + vendor + project)

Audit 2026-05-23 AI foundation.
"""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import AICache

log = logging.getLogger(__name__)

# TTL default. Override per-call via store(ttl_days=...).
DEFAULT_TTL_DAYS = 30
_CLEANUP_EVERY_N_INSERTS = 50
_insert_counter = 0


def make_key(parts: Any) -> str:
    """Helper: hash arbitrary serializable input -> stable cache key.

    Pakai utk feature dgn input kompleks (mis. chat dgn list items).
    Sort keys utk deterministic.
    """
    s = json.dumps(parts, sort_keys=True, default=str, ensure_ascii=True)
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


async def lookup(
    db: AsyncSession,
    *,
    namespace: str,
    key: str,
    ttl_days: int = DEFAULT_TTL_DAYS,
) -> dict | None:
    """Cari cache entry. Return value (dict) atau None.

    Side effect: increment hits & set last_hit_at. Caller commit.
    """
    row = (await db.execute(
        select(AICache).where(
            AICache.namespace == namespace,
            AICache.cache_key == key,
        )
    )).scalar_one_or_none()
    if row is None:
        return None
    # TTL check
    created = row.created_at
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    if (datetime.now(timezone.utc) - created) > timedelta(days=ttl_days):
        return None
    await db.execute(
        update(AICache)
        .where(AICache.id == row.id)
        .values(hits=AICache.hits + 1, last_hit_at=datetime.now(timezone.utc))
    )
    log.info("ai.cache.hit ns=%s key=%s hits=%d", namespace, key[:12], row.hits + 1)
    return dict(row.value)


async def store(
    db: AsyncSession,
    *,
    namespace: str,
    key: str,
    value: dict,
    source_info: dict | None = None,
) -> None:
    """Simpan/overwrite cache entry. Caller commit.

    source_info: opsional metadata (model, cost, dst) -- berguna utk debug
    & analytics, bukan utk key matching.
    """
    global _insert_counter
    await db.execute(
        delete(AICache).where(
            AICache.namespace == namespace, AICache.cache_key == key,
        )
    )
    db.add(AICache(
        namespace=namespace,
        cache_key=key,
        value=value,
        source_info=source_info,
        hits=0,
    ))
    _insert_counter += 1
    if _insert_counter >= _CLEANUP_EVERY_N_INSERTS:
        _insert_counter = 0
        await _cleanup_expired(db)
    log.info("ai.cache.store ns=%s key=%s", namespace, key[:12])


async def _cleanup_expired(db: AsyncSession) -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(days=DEFAULT_TTL_DAYS)
    try:
        res = await db.execute(delete(AICache).where(AICache.created_at < cutoff))
        n = res.rowcount or 0
        if n > 0:
            log.info("ai.cache.cleanup deleted=%d", n)
    except Exception as e:  # noqa: BLE001
        log.warning("ai.cache.cleanup_failed: %s", e)
