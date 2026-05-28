"""AI-1: Smart category suggest.

Audit 2026-05-24 user req: kategorisasi tepat adalah PRIORITAS — admin
proyek sering salah pilih kategori, manfaat analitik jadi turun. AI
sekarang dikasih konteks RIIL:
- Vendor history (20 tx terakhir dgn vendor ini) → AI lihat pattern
- Similar tx (10 tx dgn deskripsi mirip) → reference pencatatan konsisten
- Project info → konteks proyek

AI return: kategori utama + alternatif (kalau ragu) + reason dgn
referensi history. Pakai model lebih kuat (default model_hint=smart;
admin bisa override lewat AI Settings).

Placeholder user template tetap {ctx} + {cats} -- backward compat dgn
override existing. History di-embed dalam {ctx}.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import Category, CategoryType, Project, Transaction, TxnStatus
from app.services.ai import chat
from app.services.ai.prompt_registry import get_prompt


SCHEMA = {
    "type": "object",
    "properties": {
        "category_id": {
            "type": ["integer", "null"],
            "description": "ID kategori utama. null kalau tdk ada yg cocok.",
        },
        "confidence": {"type": "number", "description": "0-1."},
        "reason": {
            "type": "string",
            "description": "1-2 kalimat. WAJIB refer ke history/pattern kalau ada.",
        },
        "alternatives": {
            "type": "array",
            "description": "0-2 kandidat alternatif kalau pilihan utama ragu (confidence < 0.85).",
            "items": {
                "type": "object",
                "properties": {
                    "category_id": {"type": "integer"},
                    "confidence": {"type": "number"},
                    "reason": {"type": "string"},
                },
                "required": ["category_id", "confidence", "reason"],
            },
        },
    },
    "required": ["confidence", "reason"],
}


async def _fetch_vendor_history(
    db: AsyncSession,
    vendor_name: str | None,
    direction: str | None,
    project_id: int | None,
    limit: int = 20,
) -> list[tuple[str, str, str]]:
    """Return list (date, description, category_name) utk vendor ini."""
    if not vendor_name or not vendor_name.strip():
        return []
    stmt = (
        select(
            Transaction.tx_date,
            Transaction.description,
            Category.name,
        )
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
    return [
        (str(d), (desc or "")[:60], cat or "—")
        for d, desc, cat in rows
    ]


async def _fetch_similar_tx(
    db: AsyncSession,
    description: str | None,
    direction: str | None,
    limit: int = 10,
) -> list[tuple[str, str, str, str]]:
    """Return list (date, description, vendor, category_name) -- match deskripsi."""
    desc = (description or "").strip()
    if len(desc) < 4:
        return []
    # Cari dgn keyword 1-2 token paling distinctive (skip stop words).
    # Sederhana: pakai full string ilike, kalau perlu refine pakai tsvector.
    stmt = (
        select(
            Transaction.tx_date,
            Transaction.description,
            Transaction.party_name,
            Category.name,
        )
        .join(Category, Category.id == Transaction.category_id, isouter=True)
        .where(
            Transaction.deleted_at.is_(None),
            Transaction.description.ilike(f"%{desc[:30]}%"),
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
    return [
        (str(d), (de or "")[:60], (p or "—"), c or "—")
        for d, de, p, c in rows
    ]


async def run(
    db: AsyncSession,
    *,
    user_id: int,
    description: str | None = None,
    direction: str | None = None,  # "IN" / "OUT" filter kategori
    party_name: str | None = None,
    amount: str | float | int | None = None,
    kind: str | None = None,
    # Audit 2026-05-24: project_id supaya AI tau konteks proyek.
    project_id: int | None = None,
) -> dict:
    """Sarankan kategori dgn full context (history vendor + similar tx)."""
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
            "alternatives": [],
        }

    desc_clean = (description or "").strip()
    party_clean = (party_name or "").strip()
    if not desc_clean and not party_clean:
        return {
            "category_id": None, "category_name": None,
            "confidence": 0,
            "reason": "Isi deskripsi atau nama vendor/klien dulu supaya AI punya konteks.",
            "alternatives": [],
        }

    # Fetch enriched context: vendor history + similar tx
    vendor_history = await _fetch_vendor_history(
        db, party_clean, direction, project_id,
    )
    similar_tx = await _fetch_similar_tx(db, desc_clean, direction)

    # Project info
    project_info = ""
    if project_id:
        proj = await db.get(Project, project_id)
        if proj:
            project_info = f"{proj.name} ({proj.code})"

    cats_str = "\n".join(
        f"- ID {cid}: {name} ({ctype.value})" for cid, name, ctype in cats
    )

    # Build context (embedded di {ctx} -- backward compat dgn template)
    ctx_lines = []
    if desc_clean:
        ctx_lines.append(f"Deskripsi: {desc_clean}")
    if party_clean:
        ctx_lines.append(f"Vendor/Pihak: {party_clean}")
    if amount:
        ctx_lines.append(f"Nominal: Rp {amount}")
    if kind:
        ctx_lines.append(f"Jenis tx: {kind}")
    if project_info:
        ctx_lines.append(f"Proyek: {project_info}")

    if vendor_history:
        ctx_lines.append("")
        ctx_lines.append(f"History 20 tx terakhir dgn vendor '{party_clean}':")
        for d, de, c in vendor_history:
            ctx_lines.append(f"  - {d} | {de} | kategori: {c}")
    if similar_tx:
        ctx_lines.append("")
        ctx_lines.append("Tx serupa (deskripsi mirip):")
        for d, de, p, c in similar_tx:
            ctx_lines.append(f"  - {d} | {de} | vendor: {p} | kategori: {c}")

    ctx_str = "\n".join(ctx_lines)
    p = await get_prompt(db, "category")
    prompt = p.user_template.format(ctx=ctx_str, cats=cats_str)

    resp = await chat(
        db, user_id=user_id, feature="ai:category",
        system=p.system, prompt=prompt, json_schema=SCHEMA,
        feature_key="category",
    )
    out = resp.structured or {}
    cid = out.get("category_id")
    valid_ids = {c[0] for c in cats}
    cat_name_by_id = {c[0]: c[1] for c in cats}
    if cid is not None and cid not in valid_ids:
        cid = None
    name = cat_name_by_id.get(cid) if cid else None

    # Validate alternatives (filter invalid ids)
    raw_alts = out.get("alternatives") or []
    alts: list[dict] = []
    for a in raw_alts[:2]:
        aid = a.get("category_id")
        if aid in valid_ids and aid != cid:
            alts.append({
                "category_id": aid,
                "category_name": cat_name_by_id.get(aid),
                "confidence": float(a.get("confidence") or 0),
                "reason": a.get("reason") or "",
            })

    return {
        "category_id": cid,
        "category_name": name,
        "confidence": float(out.get("confidence") or 0),
        "reason": out.get("reason") or "",
        "alternatives": alts,
        "_meta": {
            "model": resp.model,
            "cached": resp.cached,
            "cost_usd": str(resp.cost_usd),
            "context_richness": {
                "vendor_history_count": len(vendor_history),
                "similar_tx_count": len(similar_tx),
            },
        },
    }
