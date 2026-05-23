"""API endpoints utk fitur AI (selain OCR yg ada di /api/v1/ocr).

Aggregate router dari per-feature modules.
"""
from fastapi import APIRouter

from . import (
    cash_request_justify,
    category,
    po_cover,
)

router = APIRouter()
router.include_router(category.router)
router.include_router(po_cover.router)
router.include_router(cash_request_justify.router)
