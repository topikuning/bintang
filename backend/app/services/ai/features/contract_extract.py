"""AI-7: Generic document extraction (kontrak/SPK/BAST/perjanjian).

Bukan invoice — dokumen legal/operasional yg ekstrak pasal, tanggal,
nilai kontrak, pihak-pihak.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.ai.vision import extract_from_image
from app.services.ai.prompt_registry import get_prompt


SCHEMA = {
    "type": "object",
    "properties": {
        "doc_type": {
            "type": "string",
            "description": "kontrak / spk / bast / perjanjian / addendum / lain",
        },
        "doc_number": {"type": "string"},
        "doc_date": {"type": "string", "description": "YYYY-MM-DD"},
        "parties": {
            "type": "array",
            "description": "Pihak-pihak yang terlibat.",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "role": {"type": "string"},
                },
                "required": ["name"],
            },
        },
        "contract_value": {
            "type": "number",
            "description": "Total nilai kontrak (Rupiah). 0 kalau tdk ada.",
        },
        "currency": {"type": "string", "description": "Default IDR."},
        "start_date": {"type": "string"},
        "end_date": {"type": "string"},
        "scope_summary": {
            "type": "string",
            "description": "2-3 kalimat scope kerja.",
        },
        "key_clauses": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "summary": {"type": "string"},
                },
                "required": ["title", "summary"],
            },
        },
        "key_dates": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "label": {"type": "string"},
                    "date": {"type": "string"},
                },
                "required": ["label", "date"],
            },
        },
        "notes": {"type": "string"},
        "confidence_score": {"type": "number"},
    },
    "required": ["doc_type", "scope_summary", "confidence_score"],
}


async def run(
    db: AsyncSession,
    *,
    user_id: int,
    content: bytes,
    media_type: str,
) -> dict[str, Any]:
    """Extract dokumen legal/operasional."""
    # Audit 2026-05-24: pakai prompt registry (admin override-able).
    p = await get_prompt(db, "contract_extract")
    return await extract_from_image(
        db, user_id=user_id, feature="ai:contract_extract",
        content=content, media_type=media_type,
        system_prompt=p.system, schema=SCHEMA,
        tool_name="save_contract_extraction",
        cache_ttl_days=30,
        rate_limit_max=10, rate_limit_period=60.0,
        max_tokens=6144,
    )
