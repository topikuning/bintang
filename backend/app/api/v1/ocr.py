from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.deps import (
    ensure_project_access,
    get_current_user,
    require_admin,
    require_can_write,
    require_superadmin,
)
from app.db.session import get_db
from app.models.models import (
    AIExtraction,
    AIExtractionStatus,
    AuditAction,
    Invoice,
    InvoiceAttachment,
    InvoiceItem,
    InvoiceStatus,
    InvoiceType,
    User,
)
from app.services.audit import log, snapshot
from app.services.ocr.adapter import get_ocr_adapter
from app.services.storage.local import ALLOWED_MIME, save_upload

router = APIRouter()


class ExtractIn(BaseModel):
    file_url: str
    entity: str = "invoice"


class ReviewIn(BaseModel):
    approved: bool
    note: str | None = None


@router.get("/test-connection")
async def test_connection(
    user: User = Depends(require_admin),
) -> dict:
    """Verifikasi koneksi ke Anthropic API tanpa upload file.

    Pakai untuk:
    - Cek apakah ANTHROPIC_API_KEY valid setelah set di Railway
    - Cek apakah OCR_MODEL bisa di-akses (404 = model name salah)
    - Ukur latency baseline Railway -> api.anthropic.com
    - Diagnose timeout: kalau test-connection sukses tapi /extract timeout,
      problemnya di image/payload, bukan auth/network
    """
    from app.core.config import settings

    engine = (settings.OCR_ENGINE or "stub").lower()
    if engine != "claude":
        return {
            "ok": False,
            "engine": engine,
            "error": "engine_not_claude",
            "hint": "Set OCR_ENGINE=claude di Railway env vars dulu.",
        }
    if not settings.ANTHROPIC_API_KEY:
        return {
            "ok": False,
            "engine": "claude",
            "error": "missing_api_key",
            "hint": "Set ANTHROPIC_API_KEY di Railway env vars.",
        }

    # Lazy import (sama dgn factory) -- supaya error import muncul jelas
    try:
        from app.services.ocr.claude_adapter import ClaudeVisionOCRAdapter
    except ImportError as e:
        return {
            "ok": False,
            "error": "anthropic_not_installed",
            "detail": str(e),
            "hint": "Restart deploy supaya pip install anthropic dijalankan.",
        }

    adapter = ClaudeVisionOCRAdapter(
        api_key=settings.ANTHROPIC_API_KEY,
        model=settings.OCR_MODEL,
    )
    result = await adapter.test_connection()
    return {
        "engine": "claude",
        "model": settings.OCR_MODEL,
        **result,
    }


def _persist_extraction(
    *, entity: str, source_url: str, result: dict[str, Any]
) -> AIExtraction:
    """Bangun row AIExtraction dari hasil adapter -- kompatibel dgn URL dan
    upload path. Decimal di-stringify agar JSON-serializable.
    """
    extracted = {
        k: (str(v) if hasattr(v, "is_finite") else v)
        for k, v in result.items()
        if k != "raw_response"
    }
    return AIExtraction(
        entity=entity,
        source_url=source_url,
        status=AIExtractionStatus.DONE,
        extracted_data=extracted,
        confidence_score=result.get("confidence_score"),
        raw_response=result.get("raw_response"),
    )


@router.post("/extract")
async def extract(
    payload: ExtractIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Ekstrak dokumen dari URL (eksternal atau path lokal /files/...).

    Untuk upload langsung dari browser, pakai POST /ocr/extract-upload.
    """
    adapter = get_ocr_adapter()
    try:
        result = await adapter.extract_invoice(payload.file_url)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"ocr_failed: {e}") from e
    rec = _persist_extraction(
        entity=payload.entity, source_url=payload.file_url, result=result
    )
    db.add(rec)
    await db.flush()
    await log(
        db,
        user_id=user.id,
        entity="ai_extraction",
        entity_id=rec.id,
        action=AuditAction.CREATE,
        note=f"ocr extract url engine={result.get('raw_response', {}).get('engine', '?')}",
    )
    await db.commit()
    await db.refresh(rec)
    return {
        "id": rec.id,
        "status": rec.status.value,
        "confidence_score": float(rec.confidence_score or 0),
        "extracted_data": rec.extracted_data,
        "needs_review": True,
    }


@router.post("/extract-upload")
async def extract_upload(
    file: UploadFile = File(...),
    entity: str = Form("invoice"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Upload langsung gambar/PDF -> simpan ke storage -> jalankan OCR.

    File disimpan permanent (sama seperti attachment lain), URL relatif
    dipakai sebagai source_url. Kalau adapter mendukung
    extract_from_bytes (Claude Vision), pakai byte path agar tidak perlu
    round-trip baca file. Selain itu, jatuh ke extract_invoice dgn URL
    relatif yang bakal di-resolve adapter.
    """
    if file.content_type not in ALLOWED_MIME:
        raise HTTPException(415, f"unsupported_media_type: {file.content_type}")

    # Simpan dulu (gambar dioptimasi, ukuran dibatasi via storage layer).
    saved = await save_upload(file, subdir="ocr")
    source_url = saved["url"]

    # Baca file balik utk byte path (storage sudah resize gambar besar).
    from pathlib import Path

    from app.core.config import settings

    rel = source_url[len("/files/") :]
    p = Path(settings.UPLOAD_DIR) / rel
    content = p.read_bytes()
    media_type = saved["mime_type"]

    adapter = get_ocr_adapter()
    try:
        try:
            result = await adapter.extract_from_bytes(
                content, media_type, source_url=source_url
            )
        except NotImplementedError:
            # Adapter lama -- fallback ke URL path
            result = await adapter.extract_invoice(source_url)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"ocr_failed: {e}") from e

    rec = _persist_extraction(entity=entity, source_url=source_url, result=result)
    db.add(rec)
    await db.flush()
    await log(
        db,
        user_id=user.id,
        entity="ai_extraction",
        entity_id=rec.id,
        action=AuditAction.CREATE,
        note=(
            f"ocr extract upload file={saved['file_name']} "
            f"engine={result.get('raw_response', {}).get('engine', '?')}"
        ),
    )
    await db.commit()
    await db.refresh(rec)
    return {
        "id": rec.id,
        "status": rec.status.value,
        "confidence_score": float(rec.confidence_score or 0),
        "extracted_data": rec.extracted_data,
        "needs_review": True,
        "source_url": source_url,
    }


@router.get("/drafts")
async def list_drafts(
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> list[dict]:
    rows = (
        await db.execute(
            select(AIExtraction).where(AIExtraction.deleted_at.is_(None))
            .order_by(AIExtraction.id.desc())
            .limit(100)
        )
    ).scalars().all()
    return [
        {
            "id": r.id,
            "entity": r.entity,
            "entity_id": r.entity_id,  # invoice id kalau sudah linked, null kalau belum
            "status": r.status.value,
            "confidence_score": float(r.confidence_score or 0),
            "extracted_data": r.extracted_data,
            "source_url": r.source_url,
            "reviewed_at": r.reviewed_at.isoformat() if r.reviewed_at else None,
        }
        for r in rows
    ]


@router.post("/drafts/{eid}/review")
async def review_draft(
    eid: int,
    body: ReviewIn = Body(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
) -> dict:
    rec = await db.get(AIExtraction, eid)
    if not rec:
        raise HTTPException(404, "not_found")
    rec.status = AIExtractionStatus.REVIEWED
    rec.reviewed_by_id = user.id
    rec.reviewed_at = datetime.now(timezone.utc)
    await log(db, user_id=user.id, entity="ai_extraction", entity_id=rec.id,
              action=AuditAction.UPDATE, note=f"reviewed approved={body.approved}")
    await db.commit()
    return {"id": rec.id, "approved": body.approved}


class CreateInvoiceFromDraftIn(BaseModel):
    project_id: int
    type: InvoiceType  # IN | OUT -- OCR tidak bisa nentuin sendiri, user pilih
    vendor_client_id: int | None = None
    # Override field dari hasil OCR kalau user mau ubah saat konfirmasi.
    override_number: str | None = None
    override_party_name: str | None = None
    override_notes: str | None = None


def _to_decimal(v: Any, default: Decimal = Decimal("0")) -> Decimal:
    if v is None or v == "":
        return default
    try:
        return Decimal(str(v))
    except (InvalidOperation, ValueError):
        return default


def _parse_iso_date(v: Any) -> date | None:
    if not v or not isinstance(v, str):
        return None
    try:
        return date.fromisoformat(v[:10])
    except (ValueError, TypeError):
        return None


@router.post("/drafts/{eid}/create-invoice", status_code=201)
async def create_invoice_from_draft(
    eid: int,
    body: CreateInvoiceFromDraftIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_can_write),
) -> dict:
    """Bikin Invoice DRAFT dari hasil OCR yang sudah direview.

    Flow:
      1. Ambil draft (harus REVIEWED + belum pernah linked: entity_id IS NULL)
      2. Build Invoice dari extracted_data + body (project, type, vendor)
      3. Auto-attach file source (gambar yg diupload) sebagai
         InvoiceAttachment -- tidak copy file, cuma reference URL yang sama
      4. Set draft.entity_id = invoice.id supaya tidak bisa dipakai dua kali
      5. Audit log create invoice + update draft
    """
    rec = await db.get(AIExtraction, eid)
    if not rec or rec.deleted_at is not None:
        raise HTTPException(404, "draft_not_found")
    if rec.status != AIExtractionStatus.REVIEWED:
        raise HTTPException(409, "draft_must_be_reviewed_first")
    if rec.entity_id is not None:
        raise HTTPException(
            409, f"draft_already_linked_to_invoice_{rec.entity_id}"
        )
    # User harus punya akses ke project tujuan
    await ensure_project_access(db, user, body.project_id)

    data = rec.extracted_data or {}
    # Nomor invoice: pakai override > extracted > fallback "OCR-{draft_id}"
    number = (
        (body.override_number or "").strip()
        or str(data.get("invoice_number") or "").strip()
        or f"OCR-{rec.id}"
    )
    party_name = (
        body.override_party_name
        if body.override_party_name is not None
        else data.get("vendor_name")
    ) or None
    notes_from_ocr = data.get("notes")
    notes_parts: list[str] = []
    if body.override_notes:
        notes_parts.append(body.override_notes.strip())
    if notes_from_ocr:
        notes_parts.append(f"[OCR] {notes_from_ocr}")
    notes_parts.append(
        f"[OCR] Dibuat dari draft #{rec.id} oleh {user.email or user.id}"
    )

    invoice_date = _parse_iso_date(data.get("invoice_date")) or date.today()
    due_date = _parse_iso_date(data.get("due_date"))

    inv = Invoice(
        number=number,
        project_id=body.project_id,
        type=body.type,
        invoice_date=invoice_date,
        due_date=due_date,
        vendor_client_id=body.vendor_client_id,
        party_name=party_name,
        tax=_to_decimal(data.get("tax")),
        notes="\n".join(notes_parts) or None,
        status=InvoiceStatus.DRAFT,
        created_by_id=user.id,
    )

    # Items dari OCR -- map ke schema InvoiceItem
    raw_items = data.get("items") or []
    subtotal_total = Decimal("0")
    for it in raw_items:
        if not isinstance(it, dict):
            continue
        desc = str(it.get("description") or "").strip()
        if not desc:
            continue
        qty = _to_decimal(it.get("qty"), Decimal("1"))
        if qty <= 0:
            qty = Decimal("1")
        unit_price = _to_decimal(it.get("price"))
        # Kalau OCR kasih amount tapi tidak ada price, derive: price = amount / qty
        if unit_price == 0 and it.get("amount") is not None:
            amount = _to_decimal(it.get("amount"))
            if amount > 0 and qty > 0:
                unit_price = amount / qty
        line_subtotal = (qty * unit_price).quantize(Decimal("0.01"))
        inv.items.append(
            InvoiceItem(
                description=desc[:500],
                quantity=qty,
                unit=(str(it.get("unit"))[:40] if it.get("unit") else None),
                unit_price=unit_price,
                subtotal=line_subtotal,
            )
        )
        subtotal_total += line_subtotal

    # Kalau sama sekali tidak ada item valid, pakai total OCR sbg single line
    if not inv.items:
        ocr_total = _to_decimal(data.get("total"))
        if ocr_total > 0:
            inv.items.append(
                InvoiceItem(
                    description=party_name or "Item dari OCR",
                    quantity=Decimal("1"),
                    unit=None,
                    unit_price=ocr_total,
                    subtotal=ocr_total,
                )
            )
            subtotal_total = ocr_total

    inv.subtotal = subtotal_total
    inv.total = subtotal_total + Decimal(inv.tax or 0)

    # Auto-attach file OCR sebagai bukti -- cuma kalau source_url-nya
    # path lokal /files/... (artinya file ada di storage kita).
    if rec.source_url and rec.source_url.startswith("/files/"):
        rel = rec.source_url[len("/files/") :]
        p = Path(settings.UPLOAD_DIR) / rel
        if p.exists():
            suffix = p.suffix.lower()
            mime_map = {
                ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                ".png": "image/png", ".webp": "image/webp",
                ".gif": "image/gif", ".pdf": "application/pdf",
            }
            inv.attachments.append(
                InvoiceAttachment(
                    file_name=p.name,
                    file_size=p.stat().st_size,
                    mime_type=mime_map.get(suffix, "application/octet-stream"),
                    url=rec.source_url,
                    uploaded_by_id=user.id,
                )
            )

    db.add(inv)
    await db.flush()  # supaya inv.id terisi

    # Tandai draft sudah dipakai -- entity_id = invoice id baru
    rec.entity_id = inv.id

    await log(
        db,
        user_id=user.id,
        entity="invoice",
        entity_id=inv.id,
        action=AuditAction.CREATE,
        after=snapshot(inv),
        note=f"created from ocr draft #{rec.id}",
    )
    await log(
        db,
        user_id=user.id,
        entity="ai_extraction",
        entity_id=rec.id,
        action=AuditAction.UPDATE,
        note=f"linked to invoice #{inv.id}",
    )

    # Capture summary SEBELUM commit. Setelah commit, mengakses
    # inv.items / inv.attachments bisa trigger lazy-load yang butuh
    # greenlet context (MissingGreenlet error). expire_on_commit=False
    # cuma menjaga column attrs, bukan relationship collections setelah
    # refresh.
    summary = {
        "invoice_id": inv.id,
        "invoice_number": inv.number,
        "project_id": inv.project_id,
        "type": inv.type.value,
        "status": inv.status.value,
        "total": float(inv.total or 0),
        "items_count": len(inv.items),
        "attachments_count": len(inv.attachments),
        "draft_id": rec.id,
    }

    await db.commit()
    return summary
