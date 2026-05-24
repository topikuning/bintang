"""API endpoints utk fitur AI (selain OCR yg ada di /api/v1/ocr).

Aggregate router dari per-feature modules.
"""
from fastapi import APIRouter

from . import (
    anomaly,
    ask_query,
    cash_request_justify,
    category,
    category_audit,
    contract_extract,
    daily_summary,
    po_cover,
)

router = APIRouter()
router.include_router(category.router)
router.include_router(category_audit.router, prefix="/category-audit")
router.include_router(po_cover.router)
router.include_router(cash_request_justify.router)
router.include_router(contract_extract.router)
router.include_router(anomaly.router)
router.include_router(daily_summary.router)
router.include_router(ask_query.router)
