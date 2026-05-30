"""Parser chat -> PO struktur (audit 2026-05-30).

Input: teks bebas dari user (WA/Telegram) yg berisi daftar item +
opsional sebut proyek/vendor.

Output: dict dgn schema -- items[], project_hint, vendor_hint, notes.
Resolver di `app.services.bot_po_assistant` yang match project_hint ke
Project nyata + vendor_hint ke VendorClient (atau pakai string as-is).
"""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.ai import chat
from app.services.ai.prompt_registry import get_prompt


# JSON schema strict utk structured output. Provider (Claude/Mistral)
# enforce schema -- response.structured guaranteed match shape (atau
# error).
_SCHEMA: dict = {
    "type": "object",
    "additionalProperties": False,
    "required": ["items"],
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["description", "quantity"],
                "properties": {
                    "description": {"type": "string", "minLength": 1},
                    "quantity": {"type": "number"},
                    "unit": {"type": ["string", "null"]},
                    "unit_price": {"type": ["number", "null"]},
                },
            },
        },
        "project_hint": {"type": ["string", "null"]},
        "vendor_hint": {"type": ["string", "null"]},
        "notes": {"type": ["string", "null"]},
    },
}


async def parse(db: AsyncSession, *, user_id: int, text: str) -> dict:
    """Parse teks chat -> dict {items, project_hint, vendor_hint, notes}.

    Raises RuntimeError dari `chat()` kalau rate-limited / budget exceeded.
    Caller bertanggung jawab handle empty items[] (= input tdk recognized).
    """
    p = await get_prompt(db, "po_chat_parser")
    prompt = p.user_template.format(text=text.strip())
    resp = await chat(
        db,
        user_id=user_id,
        feature="ai:po_chat_parser",
        system=p.system,
        prompt=prompt,
        json_schema=_SCHEMA,
        feature_key="po_chat_parser",
    )
    parsed = resp.structured or {}
    # Normalisasi: pastikan items list of dict dgn field minimum.
    items_raw = parsed.get("items") or []
    items: list[dict] = []
    for it in items_raw:
        if not isinstance(it, dict):
            continue
        desc = (it.get("description") or "").strip()
        if not desc:
            continue
        items.append({
            "description": desc,
            "quantity": float(it.get("quantity") or 1),
            "unit": (it.get("unit") or None),
            "unit_price": (
                float(it["unit_price"])
                if it.get("unit_price") is not None else None
            ),
        })
    return {
        "items": items,
        "project_hint": (parsed.get("project_hint") or None),
        "vendor_hint": (parsed.get("vendor_hint") or None),
        "notes": (parsed.get("notes") or None),
        "_meta": {
            "model": resp.model,
            "cached": resp.cached,
            "cost_usd": str(resp.cost_usd),
        },
    }
