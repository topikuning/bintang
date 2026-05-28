"""AI-2: PO cover letter generator.

Generate cover letter / surat pengantar profesional utk PO yang dikirim
ke vendor. Style formal Indonesia.
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.models import Company, POItem, Project, PurchaseOrder
from app.services.ai import chat
from app.services.ai.prompt_registry import get_prompt


async def run(
    db: AsyncSession,
    *,
    user_id: int,
    po_id: int,
    tone: str = "formal",
) -> dict:
    """Generate cover letter utk PO."""
    po = (await db.execute(
        select(PurchaseOrder)
        .options(selectinload(PurchaseOrder.items))
        .where(PurchaseOrder.id == po_id, PurchaseOrder.deleted_at.is_(None))
    )).scalar_one_or_none()
    if po is None:
        raise ValueError("po_not_found")
    project = await db.get(Project, po.project_id)
    company = await db.get(Company, po.company_id)

    items_str = "\n".join(
        f"- {it.description} ({it.quantity or 0} {it.unit or ''}) Rp {it.subtotal or 0}"
        for it in (po.items or [])[:10]  # top 10
    )
    extra_items = (len(po.items or []) - 10) if (po.items or []) else 0
    if extra_items > 0:
        items_str += f"\n- (dan {extra_items} item lainnya)"

    proj_label = (
        f"{project.name} ({project.code})" if project else "-"
    )
    # Audit 2026-05-24: pakai prompt registry (admin override-able).
    p = await get_prompt(db, "po_cover")
    prompt = p.user_template.format(
        po_number=po.number,
        po_date=po.po_date,
        vendor=po.vendor_name or "-",
        project=proj_label,
        company=company.name if company else "-",
        total=po.total or 0,
        tone=tone,
        items=items_str,
    )

    resp = await chat(
        db, user_id=user_id, feature="ai:po_cover",
        system=p.system, prompt=prompt,
        feature_key="po_cover",
    )
    return {
        "text": resp.text.strip(),
        "_meta": {
            "model": resp.model,
            "cached": resp.cached,
            "cost_usd": str(resp.cost_usd),
        },
    }
