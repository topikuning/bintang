"""AI-6: Chat-style report query (template router pattern).

User tanya bebas, LLM PILIH dari list query template + extract param
(tanggal, proyek, kategori). Backend execute template. **TIDAK** ada
raw SQL generation (cegah injection).

Aman: semua query SQLAlchemy parameterized, scoped ke user_project_ids,
limit row count, hanya read.
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import user_project_ids
from app.models.models import (
    Category,
    Invoice,
    InvoiceStatus,
    InvoiceType,
    Project,
    Transaction,
    TxnStatus,
    TxnType,
    User,
    VendorClient,
)
from app.services.ai import chat


# Registry template -- map template_id -> handler + description.
# Tambah template baru di sini, LLM otomatis aware via SYSTEM_PROMPT.


async def _q_expense_by_category(
    db: AsyncSession, *, pids: list[int] | None,
    date_from: date | None, date_to: date | None,
    project_id: int | None = None, **_,
) -> dict:
    """Total pengeluaran per kategori dlm periode."""
    stmt = (
        select(Category.name, func.coalesce(func.sum(Transaction.amount), 0))
        .join(Transaction, Transaction.category_id == Category.id)
        .where(
            Transaction.deleted_at.is_(None),
            Transaction.status == TxnStatus.VERIFIED,
            Transaction.type == TxnType.OUT,
        )
        .group_by(Category.name)
        .order_by(func.sum(Transaction.amount).desc())
        .limit(20)
    )
    if pids is not None:
        stmt = stmt.where(Transaction.project_id.in_(pids))
    if project_id:
        stmt = stmt.where(Transaction.project_id == project_id)
    if date_from:
        stmt = stmt.where(Transaction.tx_date >= date_from)
    if date_to:
        stmt = stmt.where(Transaction.tx_date <= date_to)
    rows = (await db.execute(stmt)).all()
    return {
        "columns": ["Kategori", "Total (Rp)"],
        "data": [[name, float(amt)] for name, amt in rows],
    }


async def _q_top_vendors(
    db: AsyncSession, *, pids: list[int] | None,
    date_from: date | None, date_to: date | None,
    project_id: int | None = None, limit: int = 10, **_,
) -> dict:
    """Top vendor by pengeluaran."""
    stmt = (
        select(Transaction.party_name, func.coalesce(func.sum(Transaction.amount), 0))
        .where(
            Transaction.deleted_at.is_(None),
            Transaction.status == TxnStatus.VERIFIED,
            Transaction.type == TxnType.OUT,
            Transaction.party_name.isnot(None),
        )
        .group_by(Transaction.party_name)
        .order_by(func.sum(Transaction.amount).desc())
        .limit(max(1, min(limit, 50)))
    )
    if pids is not None:
        stmt = stmt.where(Transaction.project_id.in_(pids))
    if project_id:
        stmt = stmt.where(Transaction.project_id == project_id)
    if date_from:
        stmt = stmt.where(Transaction.tx_date >= date_from)
    if date_to:
        stmt = stmt.where(Transaction.tx_date <= date_to)
    rows = (await db.execute(stmt)).all()
    return {
        "columns": ["Vendor", "Total Pengeluaran (Rp)"],
        "data": [[v, float(a)] for v, a in rows],
    }


async def _q_cashflow_summary(
    db: AsyncSession, *, pids: list[int] | None,
    date_from: date | None, date_to: date | None,
    project_id: int | None = None, **_,
) -> dict:
    """Total IN, OUT, saldo periode."""
    stmt = (
        select(Transaction.type, func.coalesce(func.sum(Transaction.amount), 0))
        .where(
            Transaction.deleted_at.is_(None),
            Transaction.status == TxnStatus.VERIFIED,
        )
        .group_by(Transaction.type)
    )
    if pids is not None:
        stmt = stmt.where(Transaction.project_id.in_(pids))
    if project_id:
        stmt = stmt.where(Transaction.project_id == project_id)
    if date_from:
        stmt = stmt.where(Transaction.tx_date >= date_from)
    if date_to:
        stmt = stmt.where(Transaction.tx_date <= date_to)
    rows = (await db.execute(stmt)).all()
    sum_in = sum_out = Decimal("0")
    for tp, total in rows:
        if tp == TxnType.IN or getattr(tp, "value", tp) == "IN":
            sum_in = Decimal(total or 0)
        else:
            sum_out = Decimal(total or 0)
    return {
        "columns": ["Metrik", "Nilai (Rp)"],
        "data": [
            ["Total Pemasukan", float(sum_in)],
            ["Total Pengeluaran", float(sum_out)],
            ["Saldo Bersih", float(sum_in - sum_out)],
        ],
    }


async def _q_outstanding_debts(
    db: AsyncSession, *, pids: list[int] | None,
    project_id: int | None = None, **_,
) -> dict:
    """Total sisa hutang & piutang."""
    stmt = (
        select(Invoice.type, func.coalesce(func.sum(Invoice.total), 0))
        .where(
            Invoice.deleted_at.is_(None),
            Invoice.status.in_([InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE]),
        )
        .group_by(Invoice.type)
    )
    if pids is not None:
        stmt = stmt.where(Invoice.project_id.in_(pids))
    if project_id:
        stmt = stmt.where(Invoice.project_id == project_id)
    rows = (await db.execute(stmt)).all()
    in_amt = out_amt = Decimal("0")
    for tp, total in rows:
        if tp == InvoiceType.IN or getattr(tp, "value", tp) == "IN":
            in_amt = Decimal(total or 0)
        else:
            out_amt = Decimal(total or 0)
    return {
        "columns": ["Tipe", "Sisa Open (Rp)"],
        "data": [
            ["Hutang (Invoice Masuk)", float(in_amt)],
            ["Piutang (Invoice Keluar)", float(out_amt)],
            ["Net Position", float(out_amt - in_amt)],
        ],
    }


async def _q_project_budget_status(
    db: AsyncSession, *, pids: list[int] | None, **_,
) -> dict:
    """Status budget proyek (budget vs spent vs sisa)."""
    stmt = select(Project).where(
        Project.deleted_at.is_(None),
        Project.budget_amount > 0,
    )
    if pids is not None:
        stmt = stmt.where(Project.id.in_(pids))
    projs = (await db.execute(stmt)).scalars().all()
    pids_list = [p.id for p in projs]
    spent_map: dict[int, Decimal] = {}
    if pids_list:
        spent = (await db.execute(
            select(Transaction.project_id, func.coalesce(func.sum(Transaction.amount), 0))
            .where(
                Transaction.project_id.in_(pids_list),
                Transaction.type == TxnType.OUT,
                Transaction.status == TxnStatus.VERIFIED,
                Transaction.deleted_at.is_(None),
            )
            .group_by(Transaction.project_id)
        )).all()
        spent_map = {pid: Decimal(a or 0) for pid, a in spent}
    data = []
    for p in projs:
        s = spent_map.get(p.id, Decimal("0"))
        b = Decimal(p.budget_amount or 0)
        pct = (s / b * 100) if b > 0 else Decimal("0")
        data.append([p.code, p.name, float(b), float(s), f"{pct:.1f}%"])
    return {
        "columns": ["Kode", "Nama", "Budget", "Spent", "% Pakai"],
        "data": data,
    }


TEMPLATES = {
    "expense_by_category":  _q_expense_by_category,
    "top_vendors":          _q_top_vendors,
    "cashflow_summary":     _q_cashflow_summary,
    "outstanding_debts":    _q_outstanding_debts,
    "project_budget_status": _q_project_budget_status,
}


TEMPLATE_DESCRIPTIONS = """\
- expense_by_category: total pengeluaran per kategori. Param: date_from, date_to, project_id.
- top_vendors: top vendor by pengeluaran. Param: date_from, date_to, project_id, limit (default 10).
- cashflow_summary: total IN, OUT, saldo periode. Param: date_from, date_to, project_id.
- outstanding_debts: sisa hutang & piutang per saat ini. Param: project_id.
- project_budget_status: budget vs realisasi semua proyek. Param: (tdk ada -- scoped user access).
"""


SYSTEM_PROMPT = f"""Kamu finance assistant perusahaan konstruksi Indonesia. User tanya tentang laporan keuangan dlm Bahasa Indonesia natural. Tugasmu: PILIH 1 template dari list + extract parameter dari pertanyaan.

JANGAN generate SQL. JANGAN jawab pertanyaan secara langsung. Cukup pilih template + isi param.

Template tersedia:
{TEMPLATE_DESCRIPTIONS}

Aturan:
1. Pilih 1 template paling cocok. Kalau pertanyaan tdk match template apapun, set template="none" dan jelaskan di reason.
2. Tanggal: convert "bulan lalu" / "minggu ini" / "Q1 2026" ke YYYY-MM-DD format. Hari ini = {{TODAY}}. Kalau ambigu, kosongkan (semua periode).
3. project_id: kalau user sebut nama proyek, set null -- backend akan ignore (UI akan tampil all). User pakai filter project_id terpisah.
4. reason: 1 kalimat jelaskan kenapa pilih template itu (+ param).
5. follow_up: kalau pertanyaan tdk jelas, suggest 1 follow-up question Bahasa Indonesia."""


SCHEMA = {
    "type": "object",
    "properties": {
        "template": {
            "type": "string",
            "description": f"Salah satu: {', '.join(TEMPLATES.keys())} atau 'none'.",
        },
        "params": {
            "type": "object",
            "properties": {
                "date_from": {"type": "string"},
                "date_to": {"type": "string"},
                "project_id": {"type": ["integer", "null"]},
                "limit": {"type": ["integer", "null"]},
            },
        },
        "reason": {"type": "string"},
        "follow_up": {"type": "string"},
    },
    "required": ["template", "reason"],
}


async def run(
    db: AsyncSession,
    *,
    user: User,
    question: str,
) -> dict[str, Any]:
    """Translate pertanyaan -> template -> execute -> return result."""
    pids = await user_project_ids(db, user)
    if pids is not None and not pids:
        return {
            "template": "none", "reason": "User tdk punya akses proyek apapun.",
            "data": None, "follow_up": "",
        }
    today_str = date.today().isoformat()

    resp = await chat(
        db, user_id=user.id, feature="ai:ask_query",
        system=SYSTEM_PROMPT.replace("{TODAY}", today_str),
        prompt=f"Pertanyaan user: {question}",
        json_schema=SCHEMA,
        model_hint="fast",
        cache_ttl_days=1,
        rate_limit_max=30, rate_limit_period=60.0,
        max_tokens=512,
    )
    structured = resp.structured or {}
    template_id = structured.get("template") or "none"
    if template_id == "none" or template_id not in TEMPLATES:
        return {
            "template": "none",
            "reason": structured.get("reason") or "Pertanyaan tdk dikenal pattern-nya.",
            "follow_up": structured.get("follow_up") or "",
            "data": None,
            "_meta": {"model": resp.model, "cost_usd": str(resp.cost_usd)},
        }

    raw_params = structured.get("params") or {}
    # Parse date strings
    def _pdate(s):
        if not s:
            return None
        try:
            return date.fromisoformat(s)
        except (ValueError, TypeError):
            return None

    params = {
        "pids": pids,
        "date_from": _pdate(raw_params.get("date_from")),
        "date_to": _pdate(raw_params.get("date_to")),
        "project_id": raw_params.get("project_id"),
        "limit": raw_params.get("limit"),
    }
    handler = TEMPLATES[template_id]
    result_data = await handler(db, **params)
    return {
        "template": template_id,
        "reason": structured.get("reason") or "",
        "follow_up": structured.get("follow_up") or "",
        "data": result_data,
        "params_used": {
            k: (v.isoformat() if hasattr(v, "isoformat") else v)
            for k, v in params.items() if k != "pids"
        },
        "_meta": {
            "model": resp.model, "cached": resp.cached,
            "cost_usd": str(resp.cost_usd),
        },
    }
