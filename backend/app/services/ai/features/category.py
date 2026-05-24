"""AI-1: Smart category suggest.

Given description transaksi + list kategori existing, sarankan kategori
yg paling cocok (konsistensi data, hemat waktu input).
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import Category, CategoryType
from app.services.ai import chat
from app.services.ai.prompt_registry import get_prompt


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
    description: str | None = None,
    direction: str | None = None,  # "IN" / "OUT" filter kategori
    # Audit 2026-05-23: konteks tambahan supaya AI tdk cuma rely di
    # description (sering kosong saat user masih mengetik). party_name +
    # amount + kind = sinyal kuat utk kategorisasi.
    party_name: str | None = None,
    amount: str | float | int | None = None,
    kind: str | None = None,  # INVOICE_PAYMENT / DIRECT_EXPENSE / CASH_ADVANCE
) -> dict:
    """Sarankan kategori dr konteks transaksi.

    Minimal salah satu dari description / party_name harus terisi.
    Kalau dua-duanya kosong, return null tanpa panggil AI (hemat).
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

    # Minimum signal: harus ada description atau party_name
    desc_clean = (description or "").strip()
    party_clean = (party_name or "").strip()
    if not desc_clean and not party_clean:
        return {
            "category_id": None, "category_name": None,
            "confidence": 0,
            "reason": "Isi deskripsi atau nama vendor/klien dulu supaya AI punya konteks.",
        }

    cats_str = "\n".join(
        f"- ID {cid}: {name} ({ctype.value})" for cid, name, ctype in cats
    )
    # Build context lines (skip yg kosong)
    ctx_lines = []
    if desc_clean:
        ctx_lines.append(f"Deskripsi: {desc_clean}")
    if party_clean:
        ctx_lines.append(f"Vendor/Pihak: {party_clean}")
    if amount:
        ctx_lines.append(f"Nominal: Rp {amount}")
    if kind:
        ctx_lines.append(f"Jenis tx: {kind}")
    ctx_str = "\n".join(ctx_lines)
    # Audit 2026-05-24: pakai prompt registry (admin override-able).
    p = await get_prompt(db, "category")
    prompt = p.user_template.format(ctx=ctx_str, cats=cats_str)

    resp = await chat(
        db, user_id=user_id, feature="ai:category",
        system=p.system, prompt=prompt, json_schema=SCHEMA,
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
