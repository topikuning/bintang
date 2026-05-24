"""AI categorization audit -- scan tx existing yg suspect mis-categorized.

Audit 2026-05-24 user req: admin proyek sering salah kategori.
Tool batch-scan utk identifikasi inconsistency.

Strategi (2-pass utk hemat AI):
1. PRE-FILTER (pure SQL, no AI): cari tx yg kategorinya BEDA dari
   mayoritas pattern utk vendor / deskripsi mirip. Heuristik:
   - Vendor X biasanya kategori A (>=70% dari history), tapi tx ini
     kategori B -> kandidat.
   - Deskripsi mengandung keyword khas kategori tertentu, tapi tx ini
     beda.
2. AI VERDICT: kandidat dikirim ke AI utk verifikasi + suggest fix.
   AI lihat full context (vendor history actual + alternatif kategori).

Output: list flagged + suggested category + confidence + reason.
"""
from __future__ import annotations

from collections import Counter
from datetime import date
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import (
    Category,
    CategoryType,
    Project,
    Transaction,
    TxnStatus,
    TxnType,
)
from app.services.ai import chat
from app.services.ai.prompt_registry import get_prompt

SCHEMA = {
    "type": "object",
    "properties": {
        "flagged": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "tx_id": {"type": "integer"},
                    "is_miscategorized": {"type": "boolean"},
                    "suggested_category_id": {"type": ["integer", "null"]},
                    "confidence": {"type": "number"},
                    "reason": {"type": "string"},
                },
                "required": ["tx_id", "is_miscategorized", "confidence", "reason"],
            },
        },
        "summary": {"type": "string"},
    },
    "required": ["flagged", "summary"],
}


async def _candidates_by_vendor_majority(
    db: AsyncSession,
    project_id: int | None,
    date_from: date | None,
    date_to: date | None,
    direction: str | None,
    min_vendor_count: int = 5,
    majority_threshold: float = 0.7,
    cap: int = 50,
) -> list[dict]:
    """Pre-filter: tx kategorinya beda dr mayoritas pattern vendor.

    Hanya tx VERIFIED, party_name non-null, kategori non-null.
    """
    stmt = (
        select(
            Transaction.id,
            Transaction.tx_date,
            Transaction.party_name,
            Transaction.description,
            Transaction.amount,
            Transaction.category_id,
            Category.name.label("current_cat_name"),
            Transaction.type,
        )
        .join(Category, Category.id == Transaction.category_id)
        .where(
            Transaction.deleted_at.is_(None),
            Transaction.status == TxnStatus.VERIFIED,
            Transaction.party_name.is_not(None),
            Transaction.category_id.is_not(None),
        )
    )
    if project_id:
        stmt = stmt.where(Transaction.project_id == project_id)
    if date_from:
        stmt = stmt.where(Transaction.tx_date >= date_from)
    if date_to:
        stmt = stmt.where(Transaction.tx_date <= date_to)
    if direction == "IN":
        stmt = stmt.where(Transaction.type == TxnType.IN)
    elif direction == "OUT":
        stmt = stmt.where(Transaction.type == TxnType.OUT)

    rows = (await db.execute(stmt)).all()
    # Group by vendor (case-insensitive), count kategorisasi
    by_vendor: dict[str, list[Any]] = {}
    for r in rows:
        key = (r.party_name or "").strip().lower()
        by_vendor.setdefault(key, []).append(r)

    candidates: list[dict] = []
    for vendor_key, vendor_rows in by_vendor.items():
        if len(vendor_rows) < min_vendor_count:
            continue
        cat_counter = Counter(r.category_id for r in vendor_rows)
        top_cat_id, top_count = cat_counter.most_common(1)[0]
        share = top_count / len(vendor_rows)
        if share < majority_threshold:
            continue
        # Tx yg kategorinya BEDA dr top -> kandidat
        for r in vendor_rows:
            if r.category_id == top_cat_id:
                continue
            candidates.append({
                "tx_id": r.id,
                "tx_date": str(r.tx_date),
                "party_name": r.party_name,
                "description": (r.description or "")[:80],
                "amount": str(r.amount),
                "current_category_id": r.category_id,
                "current_category_name": r.current_cat_name,
                "majority_category_id": top_cat_id,
                "majority_share": round(share, 2),
                "vendor_history_size": len(vendor_rows),
                "type": r.type.value if hasattr(r.type, "value") else str(r.type),
            })
            if len(candidates) >= cap:
                return candidates
    return candidates


async def run(
    db: AsyncSession,
    *,
    user_id: int,
    project_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    direction: str | None = None,
    use_ai: bool = True,
) -> dict[str, Any]:
    """Audit kategorisasi.

    Mode `use_ai=False` skip step AI -- return raw kandidat dr SQL.
    Berguna utk preview / cost-saving / atau saat budget habis.
    """
    candidates = await _candidates_by_vendor_majority(
        db, project_id, date_from, date_to, direction,
    )
    if not candidates:
        return {
            "flagged": [],
            "summary": "Tidak ada kandidat -- kategorisasi konsisten dgn pattern vendor.",
            "candidates_count": 0,
            "ai_used": False,
        }

    # Load kategori list (utk AI tau pilihan + nama suggestion)
    cats_stmt = select(Category.id, Category.name, Category.type).where(
        Category.deleted_at.is_(None),
    )
    if direction == "IN":
        cats_stmt = cats_stmt.where(Category.type == CategoryType.IN)
    elif direction == "OUT":
        cats_stmt = cats_stmt.where(Category.type == CategoryType.OUT)
    cats = (await db.execute(cats_stmt)).all()
    cat_name_by_id = {c[0]: c[1] for c in cats}
    valid_cat_ids = set(cat_name_by_id.keys())

    if not use_ai:
        # SQL-only -- tag tiap kandidat dgn suggestion = majority kategori.
        return {
            "flagged": [
                {
                    "tx_id": c["tx_id"],
                    "tx_date": c["tx_date"],
                    "party_name": c["party_name"],
                    "description": c["description"],
                    "amount": c["amount"],
                    "current_category_id": c["current_category_id"],
                    "current_category_name": c["current_category_name"],
                    "suggested_category_id": c["majority_category_id"],
                    "suggested_category_name": cat_name_by_id.get(c["majority_category_id"]),
                    "confidence": c["majority_share"],
                    "reason": (
                        f"{int(c['majority_share']*100)}% tx vendor "
                        f"'{c['party_name']}' ({c['vendor_history_size']} tx) "
                        f"masuk kategori "
                        f"'{cat_name_by_id.get(c['majority_category_id'])}'."
                    ),
                    "is_miscategorized": True,
                }
                for c in candidates
            ],
            "summary": (
                f"{len(candidates)} kandidat di-flag berdasar pattern majority "
                f"(SQL-only, AI skip)."
            ),
            "candidates_count": len(candidates),
            "ai_used": False,
        }

    # AI verdict
    proj_label = ""
    if project_id:
        p = await db.get(Project, project_id)
        if p:
            proj_label = f"{p.name} ({p.code})"

    cats_str = "\n".join(
        f"- ID {cid}: {name} ({ctype.value})" for cid, name, ctype in cats
    )
    cand_str = "\n".join(
        f"- tx_id={c['tx_id']} tanggal={c['tx_date']} amount=Rp {c['amount']} "
        f"vendor='{c['party_name']}' deskripsi='{c['description']}'\n"
        f"  current_category={c['current_category_name']} (ID {c['current_category_id']})\n"
        f"  vendor history pattern: {int(c['majority_share']*100)}% dari "
        f"{c['vendor_history_size']} tx masuk ke "
        f"{cat_name_by_id.get(c['majority_category_id'])} (ID {c['majority_category_id']})"
        for c in candidates
    )
    prompt = (
        f"Periode: {date_from or '-'} s/d {date_to or '-'}\n"
        f"Proyek: {proj_label or 'Semua'}\n"
        f"Total kandidat (pre-filter SQL): {len(candidates)}\n\n"
        f"Daftar kategori valid:\n{cats_str}\n\n"
        f"KANDIDAT (vendor majority mismatch):\n{cand_str}\n\n"
        "Review tiap kandidat. Flag kalau memang salah, skip kalau false positive."
    )

    # Audit 2026-05-24: pakai prompt registry (admin override-able).
    p = await get_prompt(db, "category_audit")
    resp = await chat(
        db, user_id=user_id, feature="ai:category_audit",
        system=p.system, prompt=prompt, json_schema=SCHEMA,
        feature_key="category_audit",
    )
    structured = resp.structured or {"flagged": [], "summary": "(no output)"}

    # Enrich + validate
    cand_by_id = {c["tx_id"]: c for c in candidates}
    flagged_out: list[dict] = []
    for f in structured.get("flagged", []):
        tid = f.get("tx_id")
        cand = cand_by_id.get(tid)
        if cand is None:
            continue  # AI hallucinate
        sid = f.get("suggested_category_id")
        if sid is not None and sid not in valid_cat_ids:
            sid = None
        flagged_out.append({
            "tx_id": tid,
            "tx_date": cand["tx_date"],
            "party_name": cand["party_name"],
            "description": cand["description"],
            "amount": cand["amount"],
            "current_category_id": cand["current_category_id"],
            "current_category_name": cand["current_category_name"],
            "suggested_category_id": sid,
            "suggested_category_name": cat_name_by_id.get(sid) if sid else None,
            "confidence": float(f.get("confidence") or 0),
            "reason": f.get("reason") or "",
            "is_miscategorized": bool(f.get("is_miscategorized")),
        })

    return {
        "flagged": flagged_out,
        "summary": structured.get("summary") or "",
        "candidates_count": len(candidates),
        "ai_used": True,
        "_meta": {
            "model": resp.model,
            "cached": resp.cached,
            "cost_usd": str(resp.cost_usd),
        },
    }
