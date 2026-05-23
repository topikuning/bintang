"""AI-1: Smart category suggest.

Given description transaksi + list kategori existing, sarankan kategori
yg paling cocok (konsistensi data, hemat waktu input).
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import Category, CategoryType
from app.services.ai import chat

SYSTEM_PROMPT = """Kamu asisten finansial perusahaan konstruksi Indonesia. Tugasmu: pilih SATU kategori paling cocok dari list utk transaksi yang user deskripsikan.

Aturan:
1. Pilih kategori dgn nama/scope paling relevan ke deskripsi.
2. Kalau ragu antara 2 kategori, pilih yg lebih spesifik (mis. "Beton" lebih spesifik dari "Material Bangunan").
3. Kalau TIDAK ADA kategori yg cocok sama sekali, set category_id=null dan jelaskan di reason.
4. confidence: 0-1. 0.9+ kalau yakin, 0.5-0.8 kalau plausible, <0.5 kalau ragu.
5. reason: 1 kalimat singkat dlm Bahasa Indonesia, kenapa pilih kategori itu."""


SCHEMA = {
    "type": "object",
    "properties": {
        "category_id": {
            "type": ["integer", "null"],
            "description": "ID kategori dari list. null kalau tdk ada yg cocok.",
        },
        "confidence": {"type": "number", "description": "0-1."},
        "reason": {"type": "string"},
    },
    "required": ["confidence", "reason"],
}


async def run(
    db: AsyncSession,
    *,
    user_id: int,
    description: str,
    direction: str | None = None,  # "IN" / "OUT" filter kategori
) -> dict:
    """Sarankan kategori utk `description`.

    direction: kalau diset, filter list kategori yg cocok arah kas.

    Return: {category_id, category_name, confidence, reason}.
    category_name di-resolve setelah LLM return -- ID validation.
    """
    # Load kategori. Filter by type kalau direction diset.
    stmt = select(Category.id, Category.name, Category.type).where(
        Category.deleted_at.is_(None),
    )
    if direction == "IN":
        stmt = stmt.where(Category.type == CategoryType.IN)
    elif direction == "OUT":
        stmt = stmt.where(Category.type == CategoryType.OUT)
    cats = (await db.execute(stmt)).all()
    if not cats:
        return {
            "category_id": None, "category_name": None,
            "confidence": 0, "reason": "Tdk ada kategori di database.",
        }

    cats_str = "\n".join(
        f"- ID {cid}: {name} ({ctype.value})" for cid, name, ctype in cats
    )
    prompt = (
        f"Deskripsi transaksi:\n{description}\n\n"
        f"Pilihan kategori:\n{cats_str}\n\n"
        "Pilih SATU kategori paling cocok."
    )

    resp = await chat(
        db, user_id=user_id, feature="ai:category",
        system=SYSTEM_PROMPT, prompt=prompt, json_schema=SCHEMA,
        model_hint="fast", cache_ttl_days=7,
        rate_limit_max=60, rate_limit_period=60.0,
    )
    out = resp.structured or {}
    cid = out.get("category_id")
    # Validasi: ID harus ada di list (cegah LLM hallucinate ID).
    valid_ids = {c[0] for c in cats}
    if cid is not None and cid not in valid_ids:
        cid = None
    name = next((c[1] for c in cats if c[0] == cid), None) if cid else None
    return {
        "category_id": cid,
        "category_name": name,
        "confidence": float(out.get("confidence") or 0),
        "reason": out.get("reason") or "",
        "_meta": {
            "model": resp.model,
            "cached": resp.cached,
            "cost_usd": str(resp.cost_usd),
        },
    }
