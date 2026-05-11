"""OCR adapter interface + stub.

Concrete implementations (Claude Vision, Tesseract, Document AI, dll.)
plug in tanpa mengubah business logic.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from decimal import Decimal
from typing import Any


class OCRAdapter(ABC):
    @abstractmethod
    async def extract_invoice(self, file_url: str) -> dict[str, Any]:
        """Extract via URL atau path lokal (/files/...).

        Return dict with keys:
        invoice_number, invoice_date, vendor_name, subtotal, tax,
        total, due_date, items[], confidence_score, raw_response,
        is_handwritten, notes, currency, source_url.
        """

    async def extract_from_bytes(
        self,
        content: bytes,
        media_type: str,
        *,
        source_url: str | None = None,
    ) -> dict[str, Any]:
        """Extract langsung dari bytes (untuk multipart upload).

        Override di adapter yang support langsung (Claude Vision).
        """
        raise NotImplementedError("extract_from_bytes not supported by this adapter")


class StubOCRAdapter(OCRAdapter):
    """Returns a deterministic dummy result for development."""

    async def extract_invoice(self, file_url: str) -> dict[str, Any]:
        return self._dummy(file_url)

    async def extract_from_bytes(
        self,
        content: bytes,
        media_type: str,
        *,
        source_url: str | None = None,
    ) -> dict[str, Any]:
        return self._dummy(source_url or "<uploaded>")

    @staticmethod
    def _dummy(source: str) -> dict[str, Any]:
        return {
            "invoice_number": "INV-DEMO-0001",
            "invoice_date": "2026-04-01",
            "vendor_name": "Vendor Contoh",
            "subtotal": Decimal("1000000"),
            "tax": Decimal("110000"),
            "total": Decimal("1110000"),
            "due_date": "2026-05-01",
            "currency": "IDR",
            "is_handwritten": False,
            "notes": None,
            "items": [
                {"description": "Item Demo 1", "qty": 2, "unit": "pcs", "price": 250000},
                {"description": "Item Demo 2", "qty": 1, "unit": "lot", "price": 500000},
            ],
            "confidence_score": Decimal("0.55"),
            "raw_response": {"engine": "stub", "note": "OCR not yet enabled"},
            "source_url": source,
        }


def get_ocr_adapter(engine_override: str | None = None) -> OCRAdapter:
    """Pilih adapter berdasarkan env OCR_ENGINE atau override eksplisit.

    Args:
        engine_override: kalau diisi (mis. dari request param), pakai itu;
            else fallback ke settings.OCR_ENGINE.

    - "claude"  + ANTHROPIC_API_KEY -> ClaudeVisionOCRAdapter
    - "mistral" + MISTRAL_API_KEY   -> MistralOCRAdapter (lebih murah)
    - selain itu                    -> StubOCRAdapter

    OCR_MODEL default per engine:
      - claude  -> claude-haiku-4-5
      - mistral -> mistral-ocr-latest
    Override eksplisit via env OCR_MODEL.
    """
    from app.core.config import settings

    engine = (engine_override or settings.OCR_ENGINE or "stub").lower()
    if engine == "claude" and settings.ANTHROPIC_API_KEY:
        # Lazy import biar stub mode tidak butuh anthropic SDK ter-install.
        from app.services.ocr.claude_adapter import ClaudeVisionOCRAdapter

        return ClaudeVisionOCRAdapter(
            api_key=settings.ANTHROPIC_API_KEY,
            model=settings.OCR_MODEL or "claude-haiku-4-5",
        )
    if engine == "mistral" and settings.MISTRAL_API_KEY:
        from app.services.ocr.mistral_adapter import MistralOCRAdapter

        return MistralOCRAdapter(
            api_key=settings.MISTRAL_API_KEY,
            model=settings.OCR_MODEL or "mistral-ocr-latest",
        )
    return StubOCRAdapter()


def list_available_engines() -> list[dict]:
    """List OCR engine yg sudah configured (API key tersedia).

    Return list of dicts utk dropdown FE:
      {key, label, model, cost_per_doc, default, available, note}
    """
    from app.core.config import settings

    default_engine = (settings.OCR_ENGINE or "stub").lower()
    engines: list[dict] = [
        {
            "key": "claude",
            "label": "Claude Vision (akurasi tinggi)",
            "model": settings.OCR_MODEL or "claude-haiku-4-5",
            "cost_per_doc": "~$0.01 / gambar",
            "available": bool(settings.ANTHROPIC_API_KEY),
            "default": default_engine == "claude",
            "note": "Lebih jago tulisan tangan rumit & dokumen sulit.",
        },
        {
            "key": "mistral",
            "label": "Mistral OCR (lebih murah)",
            "model": settings.OCR_MODEL or "mistral-ocr-latest",
            "cost_per_doc": "~$0.002 / halaman",
            "available": bool(settings.MISTRAL_API_KEY),
            "default": default_engine == "mistral",
            "note": "5-10x lebih murah, support PDF multi-page natif.",
        },
    ]
    # Fallback: stub kalau tidak ada engine yg available di prod
    has_any = any(e["available"] for e in engines)
    if not has_any:
        engines.append({
            "key": "stub",
            "label": "Stub (dummy data)",
            "model": "-",
            "cost_per_doc": "free",
            "available": True,
            "default": True,
            "note": "Dev mode -- hasil dummy, tidak panggil API.",
        })
    return engines
