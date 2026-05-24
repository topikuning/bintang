"""AI-8: Daily summary -- summary tx/invoice/PO hari itu utk owner.

Cron-friendly endpoint. Output bisa dikirim via Telegram/WAHA push.
"""
from __future__ import annotations

from datetime import date, datetime, time, timezone
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import (
    Category,
    Invoice,
    InvoiceStatus,
    PurchaseOrder,
    Transaction,
    TxnStatus,
    TxnType,
)
from app.services.ai import chat

SYSTEM_PROMPT = """Kamu CFO assistant perusahaan konstruksi Indonesia.

Tugas: tulis summary harian aktivitas keuangan dalam 1 paragraf executive (3-5 kalimat) Bahasa Indonesia formal-santai. Owner butuh insight cepat tanpa baca detail.

Aturan:
1. Mulai dgn highlight terbesar (mis. "Hari ini fokus belanja material besar Rp X").
2. Sebut angka penting: total in, total out, # transaksi.
3. Kalau ada anomaly/perhatian (overdue invoice, vendor baru besar, dll), highlight dgn 1 kalimat.
4. Tutup dgn 1 kalimat outlook/saran kalau ada.
5. JANGAN list semua angka -- pilih yg paling relevan.
6. JANGAN markdown, plain paragraph saja.
7. Kalau hari tdk ada aktivitas significan, OK cuma 1-2 kalimat."""


async def run(
    db: AsyncSession,
    *,
    user_id: int,
    target_date: date | None = None,
) -> dict:
    """Summary aktivitas pada `target_date` (default hari ini)."""
    d = target_date or date.today()
    day_start = datetime.combine(d, time.min, tzinfo=timezone.utc)
    day_end = datetime.combine(d, time.max, tzinfo=timezone.utc)

    # Transactions VERIFIED today (tx_date=d)
    tx_rows = (await db.execute(
        select(
            Transaction.type,
            func.coalesce(func.sum(Transaction.amount), 0),
            func.count(Transaction.id),
        )
        .where(
            Transaction.deleted_at.is_(None),
            Transaction.status == TxnStatus.VERIFIED,
            Transaction.tx_date == d,
        )
        .group_by(Transaction.type)
    )).all()
    sum_in = sum_out = Decimal("0"); n_in = n_out = 0
    for tp, total, cnt in tx_rows:
        if tp == TxnType.IN or getattr(tp, "value", tp) == "IN":
            sum_in = Decimal(total or 0); n_in = int(cnt or 0)
        else:
            sum_out = Decimal(total or 0); n_out = int(cnt or 0)

    # Top kategori OUT hari ini
    top_cat_rows = (await db.execute(
        select(
            Category.name,
            func.coalesce(func.sum(Transaction.amount), 0),
        )
        .join(Transaction, Transaction.category_id == Category.id)
        .where(
            Transaction.deleted_at.is_(None),
            Transaction.status == TxnStatus.VERIFIED,
            Transaction.tx_date == d,
            Transaction.type == TxnType.OUT,
        )
        .group_by(Category.name)
        .order_by(func.sum(Transaction.amount).desc())
        .limit(3)
    )).all()

    # Invoice baru hari ini (created_at di rentang d)
    n_inv_new = (await db.execute(
        select(func.count(Invoice.id))
        .where(
            Invoice.deleted_at.is_(None),
            Invoice.created_at >= day_start,
            Invoice.created_at <= day_end,
        )
    )).scalar_one() or 0

    # Invoice overdue per d (jatuh tempo sebelum d, status open).
    # Audit 2026-05-24: KONSISTEN dgn dashboard/notif -- exclude
    # proyek SELESAI/DIBATALKAN dari counter overdue.
    from app.models.models import Project, ProjectStatus
    n_inv_overdue = (await db.execute(
        select(func.count(Invoice.id))
        .join(Project, Project.id == Invoice.project_id)
        .where(
            Invoice.deleted_at.is_(None),
            Invoice.due_date < d,
            Invoice.status.in_([
                InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID,
                InvoiceStatus.OVERDUE,
            ]),
            Project.status.notin_([
                ProjectStatus.SELESAI, ProjectStatus.DIBATALKAN,
            ]),
        )
    )).scalar_one() or 0

    # PO baru hari ini
    n_po_new = (await db.execute(
        select(func.count(PurchaseOrder.id))
        .where(
            PurchaseOrder.deleted_at.is_(None),
            PurchaseOrder.created_at >= day_start,
            PurchaseOrder.created_at <= day_end,
        )
    )).scalar_one() or 0

    # Build prompt context
    cat_str = "\n".join(f"- {n}: Rp {a}" for n, a in top_cat_rows) or "(tdk ada OUT)"
    facts = (
        f"Tanggal: {d.isoformat()}\n"
        f"Tx Pemasukan VERIFIED: {n_in} tx, total Rp {sum_in}\n"
        f"Tx Pengeluaran VERIFIED: {n_out} tx, total Rp {sum_out}\n"
        f"Saldo bersih hari ini: Rp {sum_in - sum_out}\n"
        f"Top kategori pengeluaran:\n{cat_str}\n"
        f"Invoice baru hari ini: {n_inv_new}\n"
        f"Invoice overdue (jatuh tempo lewat): {n_inv_overdue}\n"
        f"PO baru hari ini: {n_po_new}"
    )

    # Empty day fast path
    if n_in == 0 and n_out == 0 and n_inv_new == 0 and n_po_new == 0:
        return {
            "text": f"Tdk ada aktivitas keuangan tercatat pada {d.isoformat()}.",
            "facts": facts,
            "_meta": {"model": "skip-llm", "cached": True, "cost_usd": "0"},
        }

    resp = await chat(
        db, user_id=user_id, feature="ai:daily_summary",
        system=SYSTEM_PROMPT,
        prompt=f"Data hari ini:\n{facts}\n\nTulis summary executive 3-5 kalimat.",
        model_hint="fast",
        cache_ttl_days=1,  # 1 hari cache (idempoten utk same date)
        rate_limit_max=20, rate_limit_period=60.0,
        max_tokens=400,
    )
    return {
        "text": resp.text.strip(),
        "facts": facts,
        "_meta": {
            "model": resp.model, "cached": resp.cached,
            "cost_usd": str(resp.cost_usd),
        },
    }
