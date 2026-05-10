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


def get_ocr_adapter() -> OCRAdapter:
    """Pilih adapter berdasarkan env OCR_ENGINE.

    - "claude" + ANTHROPIC_API_KEY -> ClaudeVisionOCRAdapter
    - selain itu -> StubOCRAdapter
    """
    from app.core.config import settings

    engine = (settings.OCR_ENGINE or "stub").lower()
    if engine == "claude" and settings.ANTHROPIC_API_KEY:
        # Lazy import biar stub mode tidak butuh anthropic SDK ter-install.
        from app.services.ocr.claude_adapter import ClaudeVisionOCRAdapter

        return ClaudeVisionOCRAdapter(
            api_key=settings.ANTHROPIC_API_KEY,
            model=settings.OCR_MODEL,
        )
    return StubOCRAdapter()
