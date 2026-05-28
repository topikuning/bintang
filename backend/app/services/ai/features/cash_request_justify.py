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
from app.services.ai.prompt_registry import get_prompt


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
    # Audit 2026-05-24: pakai prompt registry (admin override-able).
    p = await get_prompt(db, "cash_justify")
    prompt = p.user_template.format(
        title=title,
        project=project.name if project else "-",
        code=project.code if project else "-",
        location=project.location if project and project.location else "-",
        items=items_str,
    )

    resp = await chat(
        db, user_id=user_id, feature="ai:cash_justify",
        system=p.system, prompt=prompt,
        feature_key="cash_justify",
    )
    return {
        "text": resp.text.strip(),
        "_meta": {
            "model": resp.model,
            "cached": resp.cached,
            "cost_usd": str(resp.cost_usd),
        },
    }
