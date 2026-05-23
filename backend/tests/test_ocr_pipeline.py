"""OCR pipeline tests: preprocessing + cache hit/miss + engine fallback.

Audit 2026-05-23 OCR opt.
"""
from __future__ import annotations

import io
from typing import Any

import pytest
from PIL import Image

from app.services.ocr import pipeline as pipe
from app.services.ocr.cache import file_hash, lookup, store
from app.services.ocr.preprocess import preprocess_for_ocr


def _make_image_bytes(w: int, h: int, fmt: str = "JPEG") -> bytes:
    img = Image.new("RGB", (w, h), color=(200, 200, 200))
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    return buf.getvalue()


# ---------- Preprocessing ----------

def test_preprocess_resizes_large_image():
    """Image 4032x3024 -> max 1568 longest edge."""
    big = _make_image_bytes(4032, 3024)
    out, mt = preprocess_for_ocr(big, "image/jpeg")
    assert mt == "image/jpeg"
    new_img = Image.open(io.BytesIO(out))
    assert max(new_img.size) == 1568
    # Aspect ratio preserved (≤1px rounding)
    assert abs(new_img.width / new_img.height - 4032 / 3024) < 0.01
    assert len(out) < len(big)


def test_preprocess_small_image_keeps_size():
    """Image < 1568 longest edge tdk di-upscale."""
    small = _make_image_bytes(800, 600)
    out, mt = preprocess_for_ocr(small, "image/jpeg")
    new_img = Image.open(io.BytesIO(out))
    assert new_img.size == (800, 600)


def test_preprocess_png_to_jpeg():
    """PNG di-convert ke JPEG (smaller for OCR)."""
    png = _make_image_bytes(1000, 1000, fmt="PNG")
    out, mt = preprocess_for_ocr(png, "image/png")
    assert mt == "image/jpeg"


def test_preprocess_pdf_passthrough():
    """PDF tdk di-touch."""
    fake_pdf = b"%PDF-1.4\n..."
    out, mt = preprocess_for_ocr(fake_pdf, "application/pdf")
    assert out == fake_pdf
    assert mt == "application/pdf"


def test_preprocess_corrupted_image_fallback():
    """Corrupted image -> pass-through tdk crash."""
    bad = b"not-a-real-image"
    out, mt = preprocess_for_ocr(bad, "image/jpeg")
    assert out == bad
    assert mt == "image/jpeg"


# ---------- Cache ----------

@pytest.mark.asyncio
async def test_cache_store_and_lookup(db):
    h = file_hash(b"some-content")
    assert await lookup(db, h) is None  # miss
    await store(db, hash_hex=h, engine="claude:test", media_type="image/jpeg",
                size_bytes=100, extracted_data={"total": "1000"})
    await db.commit()
    cached = await lookup(db, h)
    assert cached is not None
    assert cached["total"] == "1000"


@pytest.mark.asyncio
async def test_cache_increments_hits(db):
    h = file_hash(b"hit-test")
    await store(db, hash_hex=h, engine="claude:test", media_type="image/jpeg",
                size_bytes=100, extracted_data={"total": "500"})
    await db.commit()
    await lookup(db, h); await lookup(db, h); await lookup(db, h)
    await db.commit()
    from sqlalchemy import select
    from app.models.models import OCRCache
    row = (await db.execute(
        select(OCRCache).where(OCRCache.file_hash == h)
    )).scalar_one()
    assert row.hits == 3


@pytest.mark.asyncio
async def test_cache_overwrites_on_store(db):
    """Re-store dgn hash sama overwrite (mis. setelah expired re-extract)."""
    h = file_hash(b"overwrite-test")
    await store(db, hash_hex=h, engine="mistral:v1", media_type="image/jpeg",
                size_bytes=50, extracted_data={"total": "100"})
    await store(db, hash_hex=h, engine="claude:v2", media_type="image/jpeg",
                size_bytes=50, extracted_data={"total": "200"})
    await db.commit()
    cached = await lookup(db, h)
    assert cached["total"] == "200"  # second store wins


# ---------- Pipeline integration ----------

@pytest.mark.asyncio
async def test_pipeline_cache_hit_skips_adapter(db, monkeypatch):
    """Kalau hash sudah di-cache, pipeline TIDAK panggil adapter."""
    content = _make_image_bytes(400, 400)
    h = file_hash(content)
    await store(db, hash_hex=h, engine="claude:cached", media_type="image/jpeg",
                size_bytes=len(content),
                extracted_data={"total": "999",
                                "raw_response": {"engine": "claude:cached"}})
    await db.commit()

    adapter_called = []
    async def _spy_call(*a, **kw):
        adapter_called.append(True)
        return {"total": "0", "raw_response": {"engine": "spy"}}
    monkeypatch.setattr(pipe, "_call_adapter", _spy_call)

    result = await pipe.run_extraction(
        db, content=content, media_type="image/jpeg",
        source_url="/files/x.jpg", engine="claude",
    )
    assert result["total"] == "999"
    assert result["raw_response"]["cached"] is True
    assert adapter_called == []  # adapter NOT called


@pytest.mark.asyncio
async def test_pipeline_cache_miss_calls_adapter_and_stores(db, monkeypatch):
    """Cache miss: adapter dipanggil, hasil disimpan."""
    content = _make_image_bytes(400, 400)
    h = file_hash(content)

    async def _fake_call(adapter, c, mt, src):
        return {"total": "555", "confidence_score": "0.9",
                "raw_response": {"engine": "claude:fake"}}
    monkeypatch.setattr(pipe, "_call_adapter", _fake_call)

    result = await pipe.run_extraction(
        db, content=content, media_type="image/jpeg",
        source_url="/files/y.jpg", engine="claude",
    )
    assert result["raw_response"]["cached"] is False
    await db.commit()
    # Verify stored
    cached = await lookup(db, h)
    assert cached is not None
    assert cached["total"] == "555"


@pytest.mark.asyncio
async def test_pipeline_fallback_to_claude_when_mistral_low_conf(db, monkeypatch):
    """Mistral confidence < threshold -> retry dgn claude. Audit #T2.6."""
    content = _make_image_bytes(400, 400)
    call_log: list[str] = []

    # Sentinel adapters (just labels)
    class _MistralSentinel: pass
    class _ClaudeSentinel: pass

    def _fake_get(engine):
        if engine == "claude":
            return _ClaudeSentinel()
        return _MistralSentinel()

    async def _fake_call(adapter, c, mt, src):
        if isinstance(adapter, _MistralSentinel):
            call_log.append("mistral")
            return {"total": "0", "confidence_score": "0.3",
                    "raw_response": {"engine": "mistral:test"}}
        call_log.append("claude")
        return {"total": "888", "confidence_score": "0.92",
                "raw_response": {"engine": "claude:test"}}

    monkeypatch.setattr(pipe, "get_ocr_adapter", _fake_get)
    monkeypatch.setattr(pipe, "_call_adapter", _fake_call)
    # Force ANTHROPIC_API_KEY available
    from app.services import app_settings as _ap
    monkeypatch.setattr(_ap, "get_cached",
                        lambda k: "sk-ant-test" if k == "ANTHROPIC_API_KEY" else None)

    result = await pipe.run_extraction(
        db, content=content, media_type="image/jpeg",
        source_url=None, engine="mistral",
    )
    assert call_log == ["mistral", "claude"]
    assert result["total"] == "888"
    assert result["raw_response"]["engine"] == "claude:test"
    assert result["raw_response"]["fallback_from"] == "mistral:test"


# ---------- Vendor fuzzy match ----------

def test_normalize_strips_legal_prefix():
    from app.services.ocr.vendor_match import normalize
    assert normalize("PT. Berkah Karya") == "berkah karya"
    assert normalize("CV Berkah Karya Sentosa") == "berkah karya sentosa"
    assert normalize("PT BERKAH KARYA") == "berkah karya"


@pytest.mark.asyncio
async def test_vendor_match_finds_typo_variant(db):
    from app.services.ocr.vendor_match import match_vendor
    from app.models.models import VendorClient, VendorClientType
    db.add(VendorClient(name="PT Berkah Karya Sentosa",
                        type=VendorClientType.VENDOR))
    await db.commit()
    # OCR mengembalikan tanpa "PT" prefix
    m = await match_vendor(db, "Berkah Karya Sentosa")
    assert m is not None
    assert m["name"] == "PT Berkah Karya Sentosa"
    assert m["score"] >= 0.75


@pytest.mark.asyncio
async def test_vendor_match_returns_none_when_too_different(db):
    from app.services.ocr.vendor_match import match_vendor
    from app.models.models import VendorClient, VendorClientType
    db.add(VendorClient(name="PT Alpha", type=VendorClientType.VENDOR))
    await db.commit()
    assert await match_vendor(db, "Toko Berbeda Sekali") is None


@pytest.mark.asyncio
async def test_vendor_match_none_when_empty(db):
    from app.services.ocr.vendor_match import match_vendor
    assert await match_vendor(db, None) is None
    assert await match_vendor(db, "") is None


@pytest.mark.asyncio
async def test_pipeline_attaches_vendor_match(db, monkeypatch):
    """Pipeline integrasi: vendor_match field ke-populate."""
    from app.models.models import VendorClient, VendorClientType
    db.add(VendorClient(name="CV Sumber Rejeki", type=VendorClientType.VENDOR))
    await db.commit()

    content = _make_image_bytes(300, 300)
    async def _fake_call(adapter, c, mt, src):
        return {"vendor_name": "Sumber Rejeki",
                "total": "100", "confidence_score": "0.9",
                "raw_response": {"engine": "fake"}}
    monkeypatch.setattr(pipe, "_call_adapter", _fake_call)

    result = await pipe.run_extraction(
        db, content=content, media_type="image/jpeg",
        source_url=None, engine="claude",
    )
    assert result["vendor_match"] is not None
    assert result["vendor_match"]["name"] == "CV Sumber Rejeki"


@pytest.mark.asyncio
async def test_pipeline_no_fallback_when_confidence_high(db, monkeypatch):
    """Mistral high confidence -> tdk fallback."""
    content = _make_image_bytes(400, 400)
    call_count = 0

    async def _fake_call(adapter, c, mt, src):
        nonlocal call_count
        call_count += 1
        return {"total": "777", "confidence_score": "0.95",
                "raw_response": {"engine": "mistral:test"}}

    monkeypatch.setattr(pipe, "_call_adapter", _fake_call)

    result = await pipe.run_extraction(
        db, content=content, media_type="image/jpeg",
        source_url=None, engine="mistral",
    )
    assert call_count == 1  # NO fallback
    assert result["total"] == "777"
