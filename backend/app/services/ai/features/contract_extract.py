"""AI-7: Generic document extraction (kontrak/SPK/BAST/perjanjian).

Bukan invoice — dokumen legal/operasional yg ekstrak pasal, tanggal,
nilai kontrak, pihak-pihak.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.ai.vision import extract_from_image

SYSTEM_PROMPT = """Kamu legal & operations analyst perusahaan konstruksi Indonesia.

Tugas: ekstrak struktur kunci dari dokumen legal/operasional (kontrak, SPK, BAST, perjanjian, addendum, dll).

Aturan:
1. doc_type: kategorisasi singkat (kontrak / spk / bast / perjanjian / addendum / lain).
2. doc_number: nomor dokumen apa adanya. Empty string kalau tdk ada.
3. doc_date: tanggal pembuatan/penandatanganan, YYYY-MM-DD. Empty kalau tdk ada.
4. parties: SEMUA pihak yang terlibat. role bisa "Pihak Pertama"/"Pihak Kedua"/"Kontraktor"/"Klien"/dst.
5. contract_value: total nilai kontrak (Rupiah). 0 kalau tdk ada/bukan kontrak nilai.
6. start_date / end_date: jangka waktu pelaksanaan. Empty kalau tdk ada.
7. scope_summary: 2-3 kalimat ringkas scope kerja (apa yg dikerjakan / dikirim).
8. key_clauses: pasal-pasal PENTING saja (pembayaran, denda, jangka waktu, force majeure, BAST). Max 8 pasal. Title = "Pasal X JUDUL". Summary 1 kalimat per pasal.
9. key_dates: tanggal-tanggal kunci selain doc_date/start/end (mis. tanggal BAST, milestone, tanggal jatuh tempo). Max 10.
10. notes: catatan kalau ada bagian sulit dibaca/blur/terpotong. Empty kalau jelas.
11. confidence_score: 0-1. 0.85+ kalau cetak jelas, 0.5-0.7 kalau handwritten/scan jelek."""


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
    return await extract_from_image(
        db, user_id=user_id, feature="ai:contract_extract",
        content=content, media_type=media_type,
        system_prompt=SYSTEM_PROMPT, schema=SCHEMA,
        tool_name="save_contract_extraction",
        cache_ttl_days=30,
        rate_limit_max=10, rate_limit_period=60.0,
        max_tokens=6144,
    )
