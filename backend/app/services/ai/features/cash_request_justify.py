"""AI-4: Cash request justifier.

Bantu user nulis justifikasi pengajuan dana dari list items. Mengubah
input minimal ("beli paku, semen, kabel") jadi paragraph profesional
yg memuaskan approver.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.models import CashRequest, Project
from app.services.ai import chat

SYSTEM_PROMPT = """Kamu PIC operasional perusahaan konstruksi Indonesia.

Tugas: tulis justifikasi pengajuan dana profesional dlm Bahasa Indonesia formal yg memuaskan approver (Central Admin/Superadmin).

Aturan:
1. 1 paragraf saja (3-5 kalimat).
2. Hubungkan item-item ke konteks proyek (tahap pekerjaan yg sedang berlangsung).
3. Sebutkan urgency/timing kalau relevan (mis. "dibutuhkan minggu ini").
4. Hindari hyperbole. Jangan over-promise hasil.
5. Tdk perlu salam pembuka/penutup -- ini field notes, bukan surat.
6. Format paragraf normal, tdk pakai markdown.
7. Total nilai jangan dibahas (sudah ada di field amount terpisah)."""


async def run(
    db: AsyncSession,
    *,
    user_id: int,
    cash_request_id: int | None = None,
    items: list[dict[str, Any]] | None = None,
    project_id: int | None = None,
    title: str | None = None,
) -> dict:
    """Justify pengajuan dana.

    Mode 1: by cash_request_id -> load full context dr DB.
    Mode 2: by items + project_id + title (utk draft baru, sblm CR
    disimpan).
    """
    if cash_request_id:
        cr = (await db.execute(
            select(CashRequest)
            .options(selectinload(CashRequest.items))
            .where(CashRequest.id == cash_request_id,
                   CashRequest.deleted_at.is_(None))
        )).scalar_one_or_none()
        if cr is None:
            raise ValueError("cash_request_not_found")
        project = await db.get(Project, cr.project_id)
        items = [
            {"description": it.description, "amount": str(it.amount)}
            for it in (cr.items or [])
        ]
        title = cr.title
    else:
        if not items or not project_id or not title:
            raise ValueError("missing_input: butuh items + project_id + title")
        project = await db.get(Project, project_id)

    if not items:
        raise ValueError("no_items: minimal 1 item")

    items_str = "\n".join(
        f"- {it.get('description', '?')} (Rp {it.get('amount', '?')})"
        for it in items[:15]
    )
    prompt = (
        f"Judul pengajuan: {title}\n"
        f"Proyek: {project.name if project else '-'} "
        f"({project.code if project else '-'})\n"
        f"Lokasi: {project.location if project and project.location else '-'}\n\n"
        f"Item belanja:\n{items_str}\n\n"
        "Tulis justifikasi profesional 1 paragraf."
    )

    resp = await chat(
        db, user_id=user_id, feature="ai:cash_justify",
        system=SYSTEM_PROMPT, prompt=prompt,
        model_hint="fast",  # short paragraph, fast model OK
        cache_ttl_days=3,
        rate_limit_max=30, rate_limit_period=60.0,
        max_tokens=400,
    )
    return {
        "text": resp.text.strip(),
        "_meta": {
            "model": resp.model,
            "cached": resp.cached,
            "cost_usd": str(resp.cost_usd),
        },
    }
