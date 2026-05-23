"""Shared OCR pipeline: fetch -> hash-cache -> preprocess -> adapter.

Audit 2026-05-23 OCR opt -- combine #T1.1 (preprocess) + #T1.2 (cache)
+ #T2.6 (engine fallback).

Caller pattern:
    result = await run_extraction(
        db, content=..., media_type=..., source_url=..., engine=...,
    )
    # result keys: extracted data + raw_response.cached (bool) + .engine
"""
from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.services.ocr.adapter import OCRAdapter, get_ocr_adapter
from app.services.ocr.cache import file_hash, lookup as cache_lookup, store as cache_store
from app.services.ocr.preprocess import preprocess_for_ocr

log = logging.getLogger(__name__)

_MEDIA_TYPE_BY_SUFFIX = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".pdf": "application/pdf",
}


def _normalize_url(url: str) -> str:
    """Google Drive share URL -> direct download. Other URL passthrough.

    Sebelumnya helper ini di claude_adapter; di-pindah ke shared supaya
    pipeline (yang fetch URL sebelum delegate ke adapter) juga bisa pakai.
    """
    parsed = urlparse(url)
    if parsed.netloc not in ("drive.google.com", "www.drive.google.com"):
        return url
    m = re.match(r"^/file/d/([^/]+)", parsed.path)
    if m:
        return f"https://drive.google.com/uc?export=download&id={m.group(1)}"
    if parsed.path == "/open":
        ids = parse_qs(parsed.query).get("id")
        if ids:
            return f"https://drive.google.com/uc?export=download&id={ids[0]}"
    return url


async def fetch_to_bytes(file_url: str) -> tuple[bytes, str]:
    """Resolve URL/local-path -> (bytes, media_type).

    - /files/* path: read local upload.
    - http(s)://: httpx download dgn follow_redirects.
    - GDrive share URL auto-normalize.
    """
    if file_url.startswith("/files/"):
        rel = file_url[len("/files/"):]
        p = Path(settings.UPLOAD_DIR) / rel
        if not p.exists():
            raise FileNotFoundError(f"local_file_not_found: {p}")
        content = p.read_bytes()
        media_type = _MEDIA_TYPE_BY_SUFFIX.get(p.suffix.lower(), "image/jpeg")
        return content, media_type
    normalized = _normalize_url(file_url)
    if normalized != file_url:
        log.info("ocr.pipeline.url_normalized %s -> %s", file_url, normalized)
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as hx:
        r = await hx.get(normalized)
        r.raise_for_status()
        content = r.content
        media_type = (
            r.headers.get("content-type", "").split(";")[0].strip()
            or "image/jpeg"
        )
    if media_type == "text/html":
        raise ValueError(
            "url_returned_html: URL mengembalikan halaman web, bukan file. "
            "Untuk Google Drive: pakai link 'View'. "
            "Untuk Dropbox: ganti '?dl=0' jadi '?dl=1' di akhir URL."
        )
    if not (media_type.startswith("image/") or media_type == "application/pdf"):
        raise ValueError(f"unsupported_media_type: {media_type}")
    return content, media_type


async def _call_adapter(
    adapter: OCRAdapter,
    content: bytes,
    media_type: str,
    source_url: str | None,
) -> dict[str, Any]:
    """Call adapter.extract_from_bytes dgn graceful fallback ke extract_invoice
    untuk adapter lama yg tdk override extract_from_bytes."""
    try:
        return await adapter.extract_from_bytes(
            content, media_type, source_url=source_url,
        )
    except NotImplementedError:
        if not source_url:
            raise RuntimeError(
                "adapter_no_bytes_support: pakai engine claude (support bytes)"
            )
        return await adapter.extract_invoice(source_url)


# Audit 2026-05-23 user request #3: engine fallback DI-NONAKTIFKAN
# secara default. Kalau user pilih Mistral, hormati pilihan -- jangan
# auto-retry ke Claude apapun confidence-nya. User minta deterministic
# behavior: "selalu gunakan engine yg di-set, jangan ambil dr AI lain".
#
# Untuk re-enable opt-in (mis. saat user mau cost-vs-akurasi balance),
# set app_setting OCR_FALLBACK_ENABLED=true.
_FALLBACK_CONFIDENCE_THRESHOLD = 0.65


async def run_extraction(
    db: AsyncSession,
    *,
    content: bytes,
    media_type: str,
    source_url: str | None,
    engine: str | None,
) -> dict[str, Any]:
    """Full pipeline: hash -> cache lookup -> preprocess -> adapter ->
    cache store. Caller commit DB.

    Engine fallback: kalau primary engine = mistral & hasil confidence
    < threshold, retry dgn claude. Disable fallback dgn set engine
    eksplisit ke 'claude' atau 'stub'.

    Result dict berisi semua field extract + `cached: bool` di
    raw_response utk transparency.
    """
    original_size = len(content)
    # 1. Hash content original (sebelum preprocess) -- key cache stable
    # tanpa peduli proses preprocess yg deterministic atau tdk.
    h = file_hash(content)

    # 2. Cache lookup
    cached_data = await cache_lookup(db, h)
    if cached_data is not None:
        # Mark sbg cache hit di raw_response
        raw = dict(cached_data.get("raw_response") or {})
        raw["cached"] = True
        cached_data["raw_response"] = raw
        # source_url override (file yg sama bisa di-upload di multiple lokasi)
        if source_url:
            cached_data["source_url"] = source_url
        return cached_data

    # 3. Preprocess (resize + JPEG q=85 + strip EXIF + auto-rotate)
    processed_content, processed_media = preprocess_for_ocr(content, media_type)

    # 3b. Tesseract pre-pass (T3.9). Optional, default disabled.
    # Kalau enabled & receipt printed dgn keyword finansial jelas,
    # Tesseract result dipakai langsung (gratis, ~100x lebih cepat LLM).
    # tesseract_result None = tdk eligible / disabled -> lanjut ke LLM.
    result: dict[str, Any] | None = None
    from app.services.app_settings import get_cached as _get_setting
    if _get_setting("OCR_TESSERACT_ENABLED") == "true":
        try:
            from app.services.ocr import tesseract_engine
            tres = tesseract_engine.try_extract(processed_content, processed_media)
            if tres is not None:
                tres["source_url"] = source_url
                result = tres
                log.info("ocr.pipeline: tesseract pre-pass success -- skip LLM")
        except Exception as e:  # noqa: BLE001
            log.warning("ocr.pipeline.tesseract_failed: %s -- skip ke LLM", e)

    # 4. Primary adapter call (kalau tesseract miss/disabled)
    if result is None:
        primary_engine = (engine or "").lower() or None
        adapter = get_ocr_adapter(primary_engine)
        result = await _call_adapter(adapter, processed_content, processed_media, source_url)

    # 5. Engine fallback -- OPT-IN sekarang (user request #3).
    # Default OFF: hormati engine user. Aktifkan dgn app_setting
    # OCR_FALLBACK_ENABLED=true kalau mau cost-vs-akurasi balance.
    from app.services.app_settings import get_cached as _setting
    fallback_enabled = (_setting("OCR_FALLBACK_ENABLED") == "true")
    raw_eng = (result.get("raw_response", {}).get("engine") or "").lower()
    confidence = float(result.get("confidence_score") or 0)
    if (
        fallback_enabled
        and raw_eng.startswith("mistral:")
        and confidence < _FALLBACK_CONFIDENCE_THRESHOLD
        and _setting("ANTHROPIC_API_KEY")
    ):
        log.info(
            "ocr.pipeline.fallback mistral -> claude (confidence=%.2f<%.2f)",
            confidence, _FALLBACK_CONFIDENCE_THRESHOLD,
        )
        try:
            claude_adapter = get_ocr_adapter("claude")
            claude_result = await _call_adapter(
                claude_adapter, processed_content, processed_media, source_url,
            )
            claude_raw = dict(claude_result.get("raw_response") or {})
            claude_raw["fallback_from"] = raw_eng
            claude_raw["primary_confidence"] = confidence
            claude_result["raw_response"] = claude_raw
            result = claude_result
        except Exception as e:  # noqa: BLE001
            log.warning("ocr.pipeline.fallback_failed: %s -- pakai primary", e)
            raw = dict(result.get("raw_response") or {})
            raw["fallback_attempted"] = True
            raw["fallback_error"] = str(e)
            result["raw_response"] = raw

    # 6. Store ke cache (best-effort). Sertakan engine final yg dipakai.
    final_engine = (result.get("raw_response", {}).get("engine") or "unknown")
    # Decimal di extracted_data harus di-stringify utk JSON.
    serializable = {
        k: (str(v) if hasattr(v, "is_finite") else v)
        for k, v in result.items()
    }
    try:
        await cache_store(
            db,
            hash_hex=h,
            engine=final_engine,
            media_type=media_type,
            size_bytes=original_size,
            extracted_data=serializable,
        )
    except Exception as e:  # noqa: BLE001
        log.warning("ocr.pipeline.cache_store_failed: %s", e)

    # 7. Vendor fuzzy match (T2.5). Setelah extraction sukses, cek
    # vendor_name di tabel VendorClient -- kalau match >75%, tambah ke
    # result supaya FE bisa suggest existing vendor (cegah duplikat).
    try:
        from app.services.ocr.vendor_match import match_vendor
        result["vendor_match"] = await match_vendor(
            db, result.get("vendor_name"),
        )
    except Exception as e:  # noqa: BLE001
        log.warning("ocr.pipeline.vendor_match_failed: %s", e)
        result["vendor_match"] = None

    # Mark sebagai fresh extraction
    raw = dict(result.get("raw_response") or {})
    raw["cached"] = False
    result["raw_response"] = raw
    return result
