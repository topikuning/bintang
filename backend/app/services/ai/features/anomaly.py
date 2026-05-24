"""AI-5: Anomaly detection.

Scan transaksi periode tertentu, flag pattern aneh (vendor baru jumlah
besar, kategori tdk biasa, amount outlier, dst). LLM analyze summary +
candidate list, return flagged items dgn severity & reasoning.

Two-stage approach:
1. Python pre-filter (statistik): identify candidate (new vendor, top
   amount, duplicate, unusual time/category) -- pakai histogram historis.
2. LLM analyze candidates dlm context business, prioritize & explain.

Hemat token: LLM dapat ringkasan + top candidates, bukan full data dump.
"""
from __future__ import annotations

import statistics
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import Project, Transaction, TxnStatus, TxnType
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
                    "severity": {"type": "string", "enum": ["high", "medium", "low"]},
                    "anomaly_type": {"type": "string"},
                    "reason": {"type": "string"},
                },
                "required": ["tx_id", "severity", "anomaly_type", "reason"],
            },
        },
        "summary": {
            "type": "string",
            "description": "1-2 kalimat overall verdict periode ini (clean / banyak issue / dst).",
        },
    },
    "required": ["flagged", "summary"],
}


def _build_candidates(
    txs: list[Transaction],
    historical_vendors: set[str],
) -> list[dict]:
    """Python pre-filter: cari kandidat anomali via heuristik.

    Heuristics:
    - Vendor baru (tdk muncul di periode sebelumnya) + amount > median
    - Amount > p95 dari periode ini
    - Top 10 absolute amount (always candidate)
    """
    if not txs:
        return []
    amounts = sorted(Decimal(t.amount or 0) for t in txs)
    n = len(amounts)
    median = amounts[n // 2] if n else Decimal("0")
    p95 = amounts[int(n * 0.95)] if n > 1 else amounts[0] if amounts else Decimal("0")

    candidates: list[dict] = []
    seen_tx_ids: set[int] = set()

    # Top 10 by amount
    top10 = sorted(txs, key=lambda t: Decimal(t.amount or 0), reverse=True)[:10]
    for t in top10:
        if t.id in seen_tx_ids:
            continue
        seen_tx_ids.add(t.id)
        candidates.append({
            "tx_id": t.id,
            "date": str(t.tx_date),
            "amount": str(t.amount),
            "vendor": t.party_name or "(tdk ada)",
            "description": (t.description or "")[:100],
            "reason_prefilter": "top10_amount",
        })

    # Vendor baru + amount > median
    for t in txs:
        if t.id in seen_tx_ids:
            continue
        vendor = (t.party_name or "").strip().lower()
        amount = Decimal(t.amount or 0)
        if vendor and vendor not in historical_vendors and amount > median:
            seen_tx_ids.add(t.id)
            candidates.append({
                "tx_id": t.id,
                "date": str(t.tx_date),
                "amount": str(t.amount),
                "vendor": t.party_name,
                "description": (t.description or "")[:100],
                "reason_prefilter": "vendor_baru + amount > median",
            })

    # Amount > p95
    for t in txs:
        if t.id in seen_tx_ids:
            continue
        if Decimal(t.amount or 0) > p95:
            seen_tx_ids.add(t.id)
            candidates.append({
                "tx_id": t.id,
                "date": str(t.tx_date),
                "amount": str(t.amount),
                "vendor": t.party_name or "(tdk ada)",
                "description": (t.description or "")[:100],
                "reason_prefilter": "amount > p95",
            })

    # Cap candidates ke 30 (LLM token budget)
    return candidates[:30]


async def run(
    db: AsyncSession,
    *,
    user_id: int,
    date_from: date,
    date_to: date,
    project_id: int | None = None,
) -> dict[str, Any]:
    """Scan periode utk anomali transaksi."""
    # Load tx periode
    stmt = (
        select(Transaction)
        .where(
            Transaction.deleted_at.is_(None),
            Transaction.status == TxnStatus.VERIFIED,
            Transaction.tx_date >= date_from,
            Transaction.tx_date <= date_to,
        )
    )
    if project_id:
        stmt = stmt.where(Transaction.project_id == project_id)
    txs = list((await db.execute(stmt)).scalars().all())

    if not txs:
        return {"flagged": [], "summary": "Tdk ada transaksi VERIFIED di periode ini."}

    # Historical vendors (90 hari sebelum date_from) -- bandingkan apakah
    # vendor baru muncul.
    hist_start = date_from - timedelta(days=90)
    hist_stmt = (
        select(Transaction.party_name).distinct()
        .where(
            Transaction.deleted_at.is_(None),
            Transaction.status == TxnStatus.VERIFIED,
            Transaction.tx_date >= hist_start,
            Transaction.tx_date < date_from,
        )
    )
    if project_id:
        hist_stmt = hist_stmt.where(Transaction.project_id == project_id)
    historical_vendors = {
        (v or "").strip().lower()
        for (v,) in (await db.execute(hist_stmt)).all()
        if v
    }

    candidates = _build_candidates(txs, historical_vendors)
    if not candidates:
        return {"flagged": [], "summary": "Tdk ada kandidat anomali (semua pattern normal)."}

    # Build summary stats
    total_tx = len(txs)
    total_amount = sum(Decimal(t.amount or 0) for t in txs)
    amounts = [Decimal(t.amount or 0) for t in txs]
    avg_amount = total_amount / Decimal(total_tx) if total_tx else Decimal("0")

    project = None
    if project_id:
        project = await db.get(Project, project_id)
    proj_label = f"{project.name} ({project.code})" if project else "Semua proyek"

    candidates_str = "\n".join(
        f"- tx_id={c['tx_id']} tanggal={c['date']} amount=Rp {c['amount']} "
        f"vendor='{c['vendor']}' deskripsi='{c['description']}' "
        f"[pre-filter: {c['reason_prefilter']}]"
        for c in candidates
    )
    # Audit 2026-05-24: pakai prompt registry (admin override-able).
    p = await get_prompt(db, "anomaly")
    prompt = p.user_template.format(
        date_from=date_from,
        date_to=date_to,
        proj_label=proj_label,
        total_tx=total_tx,
        total_amount=total_amount,
        avg_amount=avg_amount,
        n_historical=len(historical_vendors),
        n_candidates=len(candidates),
        candidates=candidates_str,
    )

    resp = await chat(
        db, user_id=user_id, feature="ai:anomaly",
        system=p.system, prompt=prompt, json_schema=SCHEMA,
        model_hint="smart",  # analysis butuh reasoning bagus
        cache_ttl_days=0,    # tdk cache (data berubah cepat)
        rate_limit_max=10, rate_limit_period=60.0,
        max_tokens=2048,
    )
    structured = resp.structured or {"flagged": [], "summary": "(no output)"}
    # Validate tx_id ada di periode
    valid_ids = {t.id for t in txs}
    structured["flagged"] = [
        f for f in structured.get("flagged", [])
        if f.get("tx_id") in valid_ids
    ]
    structured["_meta"] = {
        "model": resp.model,
        "cost_usd": str(resp.cost_usd),
        "candidates_count": len(candidates),
        "tx_count": total_tx,
    }
    return structured
