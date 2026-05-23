"""Content-hash cache untuk hasil OCR. Audit 2026-05-23 OCR opt #T1.2.

Lookup by sha256(file_bytes). Cache cross-engine -- entry pertama yg
panggil LLM, entry berikutnya pakai data tersimpan. Hemat 10-20% biaya
LLM utk SME yg re-upload (salah klik / iterasi).

TTL 30 hari (default). Cleanup di-pickup lazy saat insert -- entry lama
di-purge utk cegah tabel bengkak unbounded.
"""
from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import OCRCache

log = logging.getLogger(__name__)

# TTL default. Configurable di sini, bukan via env (cache lifetime
# tdk butuh runtime tuning).
CACHE_TTL_DAYS = 30
# Cleanup probabilistic: setiap N insert, jalankan purge. Hindari run
# di setiap call (overhead) tapi tdk butuh cron eksternal.
_CLEANUP_EVERY_N_INSERTS = 50
_insert_counter = 0


def file_hash(content: bytes) -> str:
    """SHA256 hex digest. Stable, collision-resistant utk dedupe."""
    return hashlib.sha256(content).hexdigest()


async def lookup(db: AsyncSession, hash_hex: str) -> dict[str, Any] | None:
    """Cari cache entry. Return extracted_data (dict) atau None.

    Sebagai side effect, increment `hits` & set `last_hit_at` kalau hit.
    Tdk commit -- caller responsible.
    """
    row = (await db.execute(
        select(OCRCache).where(OCRCache.file_hash == hash_hex)
    )).scalar_one_or_none()
    if row is None:
        return None
    # Cek TTL. Kalau expired, treat as miss (caller akan re-extract
    # dan overwrite via store()).
    age = datetime.now(timezone.utc) - (
        row.created_at.replace(tzinfo=timezone.utc)
        if row.created_at.tzinfo is None else row.created_at
    )
    if age > timedelta(days=CACHE_TTL_DAYS):
        return None
    # Update stat (best-effort, tdk block return).
    await db.execute(
        update(OCRCache)
        .where(OCRCache.id == row.id)
        .values(hits=OCRCache.hits + 1, last_hit_at=datetime.now(timezone.utc))
    )
    log.info(
        "ocr.cache.hit hash=%s engine=%s hits=%d",
        hash_hex[:12], row.source_engine, row.hits + 1,
    )
    return dict(row.extracted_data)


async def store(
    db: AsyncSession,
    *,
    hash_hex: str,
    engine: str,
    media_type: str,
    size_bytes: int,
    extracted_data: dict[str, Any],
) -> None:
    """Simpan hasil. Overwrite kalau hash sudah ada (mis. expired entry).

    Tdk commit -- caller responsible. Trigger probabilistic cleanup
    setiap N insert.
    """
    global _insert_counter
    # Hapus existing dgn hash sama (overwrite semantics).
    await db.execute(delete(OCRCache).where(OCRCache.file_hash == hash_hex))
    db.add(OCRCache(
        file_hash=hash_hex,
        source_engine=engine,
        media_type=media_type,
        size_bytes=size_bytes,
        extracted_data=extracted_data,
        hits=0,
    ))
    _insert_counter += 1
    if _insert_counter >= _CLEANUP_EVERY_N_INSERTS:
        _insert_counter = 0
        await _cleanup_expired(db)
    log.info(
        "ocr.cache.store hash=%s engine=%s size_kb=%d",
        hash_hex[:12], engine, size_bytes // 1024,
    )


async def _cleanup_expired(db: AsyncSession) -> None:
    """Purge entry lebih lama dari TTL. Best-effort, log only on err."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=CACHE_TTL_DAYS)
    try:
        res = await db.execute(
            delete(OCRCache).where(OCRCache.created_at < cutoff)
        )
        n = res.rowcount or 0
        if n > 0:
            log.info("ocr.cache.cleanup deleted=%d entries (>%dd old)",
                     n, CACHE_TTL_DAYS)
    except Exception as e:  # noqa: BLE001
        log.warning("ocr.cache.cleanup_failed: %s", e)


async def stats(db: AsyncSession) -> dict:
    """Statistik cache utk monitoring (admin endpoint).

    Return: {total_entries, total_hits, total_size_kb, oldest_age_days}.
    """
    from sqlalchemy import func
    row = (await db.execute(
        select(
            func.count(OCRCache.id),
            func.coalesce(func.sum(OCRCache.hits), 0),
            func.coalesce(func.sum(OCRCache.size_bytes), 0),
            func.min(OCRCache.created_at),
        )
    )).one()
    total, hits, size_b, oldest = row
    age_days = None
    if oldest:
        age_days = (datetime.now(timezone.utc) - (
            oldest.replace(tzinfo=timezone.utc) if oldest.tzinfo is None else oldest
        )).days
    return {
        "total_entries": int(total or 0),
        "total_hits": int(hits or 0),
        "total_size_kb": int((size_b or 0) // 1024),
        "oldest_age_days": age_days,
    }
