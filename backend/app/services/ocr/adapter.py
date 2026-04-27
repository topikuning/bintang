"""OCR adapter (stub).

This module defines the interface so future implementations
(Tesseract, Google Document AI, Anthropic Claude Vision, etc.) can plug in
without changing business logic.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from decimal import Decimal
from typing import Any


class OCRAdapter(ABC):
    @abstractmethod
    async def extract_invoice(self, file_url: str) -> dict[str, Any]:
        """Return dict with keys:
        invoice_number, invoice_date, vendor_name, subtotal, tax,
        total, due_date, items[], confidence_score, raw_response.
        """


class StubOCRAdapter(OCRAdapter):
    """Returns a deterministic dummy result for development."""

    async def extract_invoice(self, file_url: str) -> dict[str, Any]:
        return {
            "invoice_number": "INV-DEMO-0001",
            "invoice_date": "2026-04-01",
            "vendor_name": "Vendor Contoh",
            "subtotal": Decimal("1000000"),
            "tax": Decimal("110000"),
            "total": Decimal("1110000"),
            "due_date": "2026-05-01",
            "items": [
                {"description": "Item Demo 1", "qty": 2, "unit": "pcs", "price": 250000},
                {"description": "Item Demo 2", "qty": 1, "unit": "lot", "price": 500000},
            ],
            "confidence_score": Decimal("0.55"),
            "raw_response": {"engine": "stub", "note": "OCR not yet enabled"},
            "source_url": file_url,
        }


def get_ocr_adapter() -> OCRAdapter:
    return StubOCRAdapter()
