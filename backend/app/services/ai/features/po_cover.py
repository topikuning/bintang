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

SYSTEM_PROMPT = """Kamu sekretaris perusahaan konstruksi Indonesia yang menulis surat pengantar Purchase Order ke vendor.

Tugas: tulis surat pengantar singkat, sopan, profesional dlm Bahasa Indonesia formal.

Aturan:
1. 2-3 paragraf max. Jangan bertele-tele.
2. Pembuka: salam + konteks (PO no untuk proyek apa).
3. Inti: list singkat item utama (3-5 item teratas) + total nilai. Sebut tanggal pengiriman/penyelesaian kalau ada.
4. Penutup: instruksi follow-up (konfirmasi, kontak PIC, dll) + salam.
5. JANGAN sebut "AI generated" atau tanda kutip lain yg tdk profesional.
6. Output: HANYA isi surat, tanpa header/kop (perusahaan punya kop sendiri). Tanpa tanda tangan.
7. Format paragraf normal, tdk pakai markdown."""


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

    prompt = (
        f"PO Number: {po.number}\n"
        f"Tanggal PO: {po.po_date}\n"
        f"Vendor: {po.vendor_name or '-'}\n"
        f"Proyek: {project.name if project else '-'} ({project.code if project else '-'})\n"
        f"Perusahaan Pembeli: {company.name if company else '-'}\n"
        f"Total Nilai: Rp {po.total or 0}\n"
        f"Tone yang diinginkan: {tone}\n\n"
        f"Item-item:\n{items_str}\n\n"
        "Tulis surat pengantar profesional."
    )

    resp = await chat(
        db, user_id=user_id, feature="ai:po_cover",
        system=SYSTEM_PROMPT, prompt=prompt,
        model_hint="smart",  # writing quality matters
        cache_ttl_days=3,    # less aggressive cache (kreatif output)
        rate_limit_max=20, rate_limit_period=60.0,
        max_tokens=800,
    )
    return {
        "text": resp.text.strip(),
        "_meta": {
            "model": resp.model,
            "cached": resp.cached,
            "cost_usd": str(resp.cost_usd),
        },
    }
