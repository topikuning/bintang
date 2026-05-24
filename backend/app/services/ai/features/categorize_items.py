"""AI-9: Bulk item categorization.

Audit 2026-05-24 user req: TX biasa = transfer ke admin proyek, items
belanja sebenarnya bercampur di invoice/rincian. Kategorisasi yg
benar di level ITEM, bukan tx. Tool ini batch-categorize semua item
dalam 1 panggilan AI (hemat token vs per-item).

Input: list items + context (vendor, project, direction). Optional:
vendor history (akan auto-fetch kalau context.party_name diset).

Output per item: category_id + confidence + reason (+ alternatif kalau ragu).
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import Category, CategoryType, Project, Transaction, TxnStatus
from app.services.ai import chat
from app.services.ai.prompt_registry import get_prompt


SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {
                        "type": "integer",
                        "description": "Index item di input array (0-based).",
                    },
                    "category_id": {
                        "type": ["integer", "null"],
                        "description": "ID kategori. null kalau tdk yakin.",
                    },
                    "confidence": {"type": "number"},
                    "reason": {"type": "string"},
                },
                "required": ["index", "confidence", "reason"],
            },
        },
    },
    "required": ["items"],
}


async def _fetch_vendor_pattern(
    db: AsyncSession,
    vendor_name: str | None,
    direction: str | None,
    limit: int = 20,
) -> list[tuple[str, str]]:
    """Return list (description, category_name) utk pattern vendor."""
    if not vendor_name or not vendor_name.strip():
        return []
    stmt = (
        select(Transaction.description, Category.name)
        .join(Category, Category.id == Transaction.category_id, isouter=True)
        .where(
            Transaction.deleted_at.is_(None),
            Transaction.party_name.ilike(f"%{vendor_name.strip()}%"),
            Transaction.category_id.is_not(None),
            Transaction.status == TxnStatus.VERIFIED,
        )
        .order_by(Transaction.tx_date.desc())
        .limit(limit)
    )
    if direction == "IN":
        stmt = stmt.where(Transaction.type == "IN")
    elif direction == "OUT":
        stmt = stmt.where(Transaction.type == "OUT")
    rows = (await db.execute(stmt)).all()
    return [((d or "")[:50], c or "—") for d, c in rows]


async def run(
    db: AsyncSession,
    *,
    user_id: int,
    items: list[dict],  # [{description, quantity?, unit?, unit_price?}]
    direction: str | None = None,  # IN/OUT filter kategori
    party_name: str | None = None,
    project_id: int | None = None,
    context_label: str | None = None,  # e.g. "Invoice INV-001" / "Settlement #42"
) -> dict[str, Any]:
    """Bulk categorize items. Return enriched suggestions per item."""
    if not items:
        return {"items": [], "summary": "Tidak ada item utk dikategori."}
    if len(items) > 100:
        # safety cap
        items = items[:100]

    # Load kategori valid
    cats_stmt = select(Category.id, Category.name, Category.type).where(
        Category.deleted_at.is_(None),
    )
    if direction == "IN":
        cats_stmt = cats_stmt.where(Category.type == CategoryType.IN)
    elif direction == "OUT":
        cats_stmt = cats_stmt.where(Category.type == CategoryType.OUT)
    cats = (await db.execute(cats_stmt)).all()
    if not cats:
        return {
            "items": [
                {
                    "index": i, "category_id": None,
                    "category_name": None, "confidence": 0,
                    "reason": "Tdk ada kategori di database.",
                }
                for i in range(len(items))
            ],
            "summary": "Tdk ada kategori utk dipilih.",
        }
    valid_ids = {c[0] for c in cats}
    cat_name_by_id = {c[0]: c[1] for c in cats}

    # Context lines
    ctx_lines: list[str] = []
    if context_label:
        ctx_lines.append(f"Konteks: {context_label}")
    if party_name:
        ctx_lines.append(f"Vendor/Pihak: {party_name}")
    if project_id:
        p = await db.get(Project, project_id)
        if p:
            ctx_lines.append(f"Proyek: {p.name} ({p.code})")
    if direction:
        ctx_lines.append(f"Arah: {direction}")

    # Vendor pattern (kalau ada)
    vendor_pattern = await _fetch_vendor_pattern(db, party_name, direction)
    if vendor_pattern:
        ctx_lines.append("")
        ctx_lines.append(
            f"Pattern history 20 tx vendor '{party_name}':"
        )
        for desc, cat in vendor_pattern:
            ctx_lines.append(f"  - {desc} → {cat}")

    # Items listing
    items_lines = []
    for i, it in enumerate(items):
        desc = (it.get("description") or "").strip()[:120]
        qty = it.get("quantity")
        unit = it.get("unit") or ""
        price = it.get("unit_price")
        qty_str = f"{qty} {unit}".strip() if qty else ""
        price_str = f"@ Rp {price}" if price else ""
        items_lines.append(
            f"[{i}] {desc} {qty_str} {price_str}".strip()
        )
    items_block = "\n".join(items_lines)

    cats_block = "\n".join(
        f"- ID {cid}: {name} ({ctype.value})" for cid, name, ctype in cats
    )

    ctx_block = "\n".join(ctx_lines)

    # Prompt registry
    p = await get_prompt(db, "categorize_items")
    prompt = p.user_template.format(
        ctx=ctx_block,
        cats=cats_block,
        items=items_block,
    )

    resp = await chat(
        db, user_id=user_id, feature="ai:categorize_items",
        system=p.system, prompt=prompt, json_schema=SCHEMA,
        feature_key="categorize_items",
    )
    structured = resp.structured or {"items": []}

    # Enrich + validate per item
    out_by_idx: dict[int, dict] = {}
    for entry in structured.get("items", []):
        idx = entry.get("index")
        if not isinstance(idx, int) or idx < 0 or idx >= len(items):
            continue
        cid = entry.get("category_id")
        if cid is not None and cid not in valid_ids:
            cid = None
        out_by_idx[idx] = {
            "index": idx,
            "category_id": cid,
            "category_name": cat_name_by_id.get(cid) if cid else None,
            "confidence": float(entry.get("confidence") or 0),
            "reason": entry.get("reason") or "",
        }

    # Pastikan semua items punya output (kalau AI lupa some, fill blank)
    enriched: list[dict] = []
    for i in range(len(items)):
        enriched.append(out_by_idx.get(i, {
            "index": i,
            "category_id": None,
            "category_name": None,
            "confidence": 0,
            "reason": "AI tdk return suggestion utk item ini.",
        }))

    return {
        "items": enriched,
        "_meta": {
            "model": resp.model,
            "cached": resp.cached,
            "cost_usd": str(resp.cost_usd),
            "vendor_pattern_size": len(vendor_pattern),
        },
    }
