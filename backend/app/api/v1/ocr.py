from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
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
from app.core.rate_limit import ocr_limiter
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
    UserRole,
)
from app.services.audit import log, snapshot
from app.services.ocr.adapter import get_ocr_adapter, list_available_engines
from app.services.storage.local import ALLOWED_MIME, save_upload

router = APIRouter()


class ExtractIn(BaseModel):
    file_url: str
    entity: str = "invoice"
    # Override OCR engine per request. None = pakai default dari env.
    engine: str | None = None


@router.get("/engines")
async def list_engines(_user: User = Depends(get_current_user)) -> dict:
    """List OCR engine yg available + tandai mana yg default.
    Dipakai FE utk render dropdown 'Pilih engine' di OCR page."""
    return {"engines": list_available_engines()}


@router.get("/test-connection")
async def test_connection(
    engine: str | None = None,
    user: User = Depends(require_admin),
) -> dict:
    """Verifikasi koneksi ke OCR provider tanpa upload file.

    Args:
        engine: opsional, override pilihan engine (claude/mistral).
            None = pakai default dari env OCR_ENGINE.

    Pakai untuk:
    - Cek apakah API key valid setelah set di env
    - Cek apakah OCR_MODEL bisa di-akses (404 = model name salah)
    - Ukur latency baseline
    - Diagnose timeout: kalau test-connection sukses tapi /extract timeout,
      problemnya di image/payload, bukan auth/network
    """
    from app.services.app_settings import get_cached

    engine = (engine or get_cached("OCR_ENGINE") or "stub").lower()

    if engine == "claude":
        anthropic_key = get_cached("ANTHROPIC_API_KEY")
        if not anthropic_key:
            return {
                "ok": False,
                "engine": "claude",
                "error": "missing_api_key",
                "hint": "Set ANTHROPIC_API_KEY di Pengaturan.",
            }
        try:
            from app.services.ocr.claude_adapter import ClaudeVisionOCRAdapter
        except ImportError as e:
            return {
                "ok": False,
                "engine": "claude",
                "error": "anthropic_not_installed",
                "detail": str(e),
                "hint": "Restart deploy supaya pip install anthropic dijalankan.",
            }
        from app.services.ocr.adapter import _resolve_model
        model = _resolve_model("claude")
        adapter = ClaudeVisionOCRAdapter(api_key=anthropic_key, model=model)
        result = await adapter.test_connection()
        return {"engine": "claude", "model": model, **result}

    if engine == "mistral":
        mistral_key = get_cached("MISTRAL_API_KEY")
        if not mistral_key:
            return {
                "ok": False,
                "engine": "mistral",
                "error": "missing_api_key",
                "hint": "Set MISTRAL_API_KEY di Pengaturan (https://console.mistral.ai/).",
            }
        from app.services.ocr.adapter import _resolve_model
        from app.services.ocr.mistral_adapter import MistralOCRAdapter

        model = _resolve_model("mistral")
        adapter = MistralOCRAdapter(api_key=mistral_key, model=model)
        try:
            result = await adapter.test_connection()
        finally:
            await adapter.aclose()
        return {"engine": "mistral", "model": model, **result}

    return {
        "ok": False,
        "engine": engine,
        "error": "engine_not_supported",
        "hint": "Pilih engine claude atau mistral di Pengaturan.",
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

    payload.engine: opsional, override engine OCR per request
        ('claude' | 'mistral' | None=default env).
    """
    # Audit #H9: rate-limit per user (LLM/vision API berbayar per call).
    allowed, _ = ocr_limiter.check(f"ocr:{user.id}")
    if not allowed:
        raise HTTPException(429, "rate_limited: terlalu banyak OCR. Tunggu sebentar.")
    # Pipeline: fetch URL -> hash cache -> preprocess -> adapter (+ fallback).
    # Audit 2026-05-23 OCR opt #T1.1/#T1.2/#T2.6.
    from app.services.ocr.pipeline import fetch_to_bytes, run_extraction
    try:
        content, media_type = await fetch_to_bytes(payload.file_url)
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(400, f"fetch_failed: {e}") from e
    except httpx.HTTPError as e:
        raise HTTPException(502, f"fetch_http_error: {e}") from e
    try:
        result = await run_extraction(
            db, content=content, media_type=media_type,
            source_url=payload.file_url, engine=payload.engine,
        )
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
    engine: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Upload langsung gambar/PDF -> simpan ke storage -> jalankan OCR.

    File disimpan permanent (sama seperti attachment lain), URL relatif
    dipakai sebagai source_url. Kalau adapter mendukung
    extract_from_bytes (Claude Vision), pakai byte path agar tidak perlu
    round-trip baca file. Selain itu, jatuh ke extract_invoice dgn URL
    relatif yang bakal di-resolve adapter.

    engine: opsional, override engine OCR per request
        ('claude' | 'mistral' | None=default env).
    """
    # Audit #H9: rate-limit per user (LLM/vision API berbayar per call).
    allowed, _ = ocr_limiter.check(f"ocr:{user.id}")
    if not allowed:
        raise HTTPException(429, "rate_limited: terlalu banyak OCR. Tunggu sebentar.")
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

    # Pipeline shared (hash cache + preprocess + engine fallback).
    from app.services.ocr.pipeline import run_extraction
    try:
        result = await run_extraction(
            db, content=content, media_type=media_type,
            source_url=source_url, engine=engine,
        )
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


# ============================================================
# Async OCR jobs (audit 2026-05-23 OCR opt #T3.8 + #T3.7 streaming)
# ============================================================
@router.post("/jobs", status_code=202)
async def create_ocr_job(
    file: UploadFile = File(...),
    entity: str = Form("invoice"),
    engine: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Enqueue async OCR job. Return job_id immediately (HTTP 202).

    Client poll via GET /ocr/jobs/{id} atau stream via SSE
    /ocr/jobs/{id}/stream. Cocok utk bulk upload (10+ struk) supaya UI
    tdk blocking.
    """
    # Rate-limit: enqueue tetap counted (cegah spam).
    allowed, _ = ocr_limiter.check(f"ocr:{user.id}")
    if not allowed:
        raise HTTPException(429, "rate_limited: terlalu banyak OCR.")
    if file.content_type not in ALLOWED_MIME:
        raise HTTPException(415, f"unsupported_media_type: {file.content_type}")

    saved = await save_upload(file, subdir="ocr")
    from app.models.models import OCRJob, OCRJobStatus
    job = OCRJob(
        user_id=user.id,
        entity=entity,
        source_url=saved["url"],
        file_size_bytes=saved.get("size_bytes", 0),
        engine_requested=engine,
        status=OCRJobStatus.PENDING,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    # Spawn background task (asyncio.create_task fire-and-forget).
    # Task pakai DB session sendiri (request session di-close setelah return).
    import asyncio
    asyncio.create_task(_process_ocr_job(job.id))

    return {
        "job_id": job.id,
        "status": job.status.value,
        "poll_url": f"/api/v1/ocr/jobs/{job.id}",
        "stream_url": f"/api/v1/ocr/jobs/{job.id}/stream",
    }


async def _process_ocr_job(job_id: int) -> None:
    """Background processor utk OCRJob.

    Pakai DB session sendiri (request session sudah closed di POST handler).
    State transitions: PENDING -> PROCESSING -> DONE/FAILED.
    """
    import logging
    from datetime import datetime, timezone
    from pathlib import Path

    from app.core.config import settings
    from app.db.session import SessionLocal
    from app.models.models import OCRJob, OCRJobStatus
    from app.services.ocr.pipeline import run_extraction
    from app.services.audit import log as _audit_log
    from app.models.models import AuditAction

    log = logging.getLogger(__name__)

    async with SessionLocal() as bg_db:
        job = await bg_db.get(OCRJob, job_id)
        if not job:
            log.error("ocr.job.not_found id=%s", job_id)
            return
        job.status = OCRJobStatus.PROCESSING
        job.started_at = datetime.now(timezone.utc)
        await bg_db.commit()
        try:
            # Resolve file path
            rel = job.source_url[len("/files/"):]
            p = Path(settings.UPLOAD_DIR) / rel
            content = p.read_bytes()
            # Mime guessing dari ext (cukup utk pipeline)
            ext = p.suffix.lower()
            media_map = {
                ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                ".png": "image/png", ".webp": "image/webp",
                ".pdf": "application/pdf",
            }
            media_type = media_map.get(ext, "image/jpeg")

            result = await run_extraction(
                bg_db, content=content, media_type=media_type,
                source_url=job.source_url, engine=job.engine_requested,
            )
            # Serialize Decimal sebelum simpan JSON
            serializable = {
                k: (str(v) if hasattr(v, "is_finite") else v)
                for k, v in result.items()
            }
            job.result = serializable
            job.status = OCRJobStatus.DONE
            job.completed_at = datetime.now(timezone.utc)
            await _audit_log(
                bg_db, user_id=job.user_id,
                entity="ocr_job", entity_id=job.id, action=AuditAction.CREATE,
                note=f"async ocr engine={result.get('raw_response', {}).get('engine', '?')}",
            )
        except Exception as e:  # noqa: BLE001
            log.exception("ocr.job.failed id=%s", job_id)
            job.status = OCRJobStatus.FAILED
            job.error = str(e)[:1000]
            job.completed_at = datetime.now(timezone.utc)
        await bg_db.commit()


def _job_to_dict(job) -> dict:
    """Serialize OCRJob row -> response dict."""
    return {
        "id": job.id,
        "status": job.status.value if hasattr(job.status, "value") else str(job.status),
        "entity": job.entity,
        "source_url": job.source_url,
        "engine_requested": job.engine_requested,
        "file_size_bytes": job.file_size_bytes,
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
        "result": job.result,
        "error": job.error,
        "created_at": job.created_at.isoformat() if job.created_at else None,
    }


@router.get("/jobs/{job_id}")
async def get_ocr_job(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Poll status OCR job. Return full state (status, result/error)."""
    from app.models.models import OCRJob
    job = await db.get(OCRJob, job_id)
    if not job:
        raise HTTPException(404, "job_not_found")
    if job.user_id != user.id and user.role not in (
        UserRole.SUPERADMIN, UserRole.CENTRAL_ADMIN,
    ):
        raise HTTPException(403, "not_owner")
    return _job_to_dict(job)


@router.get("/jobs/{job_id}/stream")
async def stream_ocr_job(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """SSE stream status job sampai DONE/FAILED.

    Audit 2026-05-23 OCR opt #T3.7. Client pakai EventSource:
        const es = new EventSource('/api/v1/ocr/jobs/123/stream', {
            headers: {Authorization: 'Bearer ...'}
        });
        es.onmessage = (e) => { const data = JSON.parse(e.data); ... };
        // Server emit event setiap kali status berubah, lalu close
        // setelah terminal (DONE/FAILED).
    """
    from fastapi.responses import StreamingResponse
    from app.models.models import OCRJob, OCRJobStatus

    job = await db.get(OCRJob, job_id)
    if not job:
        raise HTTPException(404, "job_not_found")
    if job.user_id != user.id and user.role not in (
        UserRole.SUPERADMIN, UserRole.CENTRAL_ADMIN,
    ):
        raise HTTPException(403, "not_owner")

    async def _gen():
        import asyncio
        import json
        from app.db.session import SessionLocal
        last_status: str | None = None
        # Poll interval 800ms. Total max wait 5 menit (~375 ticks).
        for _ in range(375):
            async with SessionLocal() as poll_db:
                j = await poll_db.get(OCRJob, job_id)
                if j is None:
                    yield f"event: error\ndata: {json.dumps({'error': 'gone'})}\n\n"
                    return
                status = j.status.value
                if status != last_status:
                    payload = json.dumps(_job_to_dict(j), default=str)
                    yield f"event: status\ndata: {payload}\n\n"
                    last_status = status
                if status in ("DONE", "FAILED"):
                    return
            await asyncio.sleep(0.8)
        # Timeout
        yield f"event: timeout\ndata: {{\"error\":\"poll_timeout\"}}\n\n"

    return StreamingResponse(
        _gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


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


@router.delete("/drafts/{eid}", status_code=204)
async def discard_draft(
    eid: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
) -> None:
    """Hapus (soft-delete) draft OCR -- biasanya kalau hasil ekstraksi
    salah/blur dan tidak perlu dipakai. Tidak bisa dihapus kalau sudah
    linked ke invoice (entity_id ter-set) supaya audit trail tetap utuh.
    """
    rec = await db.get(AIExtraction, eid)
    if not rec or rec.deleted_at is not None:
        raise HTTPException(404, "draft_not_found")
    if rec.entity_id is not None:
        raise HTTPException(
            409,
            f"draft_already_linked_to_invoice_{rec.entity_id}_cannot_discard",
        )
    rec.deleted_at = datetime.now(timezone.utc)
    await log(
        db,
        user_id=user.id,
        entity="ai_extraction",
        entity_id=rec.id,
        action=AuditAction.DELETE,
        note="ocr draft discarded",
    )
    await db.commit()


class OcrItemOverrideIn(BaseModel):
    """Item override saat user edit di OCR Asisten sebelum Buat Invoice.
    Audit 2026-06-13: items bisa di-edit / exclude per-baris."""
    description: str
    quantity: Decimal = Decimal("1")
    unit: str | None = None
    unit_price: Decimal = Decimal("0")


class CreateInvoiceFromDraftIn(BaseModel):
    project_id: int
    type: InvoiceType  # IN | OUT -- OCR tidak bisa nentuin sendiri, user pilih
    vendor_client_id: int | None = None
    # Override field dari hasil OCR kalau user mau ubah saat konfirmasi.
    override_number: str | None = None
    override_party_name: str | None = None
    override_notes: str | None = None
    # Audit 2026-06-13: extend overrides supaya user bisa koreksi
    # tanggal/pajak + items langsung di OcrPage tanpa harus edit di
    # InvoiceForm setelah create.
    override_invoice_date: date | None = None
    override_due_date: date | None = None
    override_tax: Decimal | None = None
    # Kalau diisi, MENGGANTI items dari extracted_data. List ini sudah
    # filter (item yg di-exclude user tdk ada di list). Kalau None,
    # fallback ke extracted_data.items (behaviour lama).
    items: list[OcrItemOverrideIn] | None = None


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
    """Bikin Invoice DRAFT langsung dari hasil OCR.

    Flow:
      1. Ambil draft (belum pernah linked: entity_id IS NULL)
      2. Build Invoice dari extracted_data + body (project, type, vendor)
         -- user koreksi field-field di InvoiceForm setelahnya bila perlu
      3. Auto-attach file source (gambar yg diupload) sebagai
         InvoiceAttachment -- tidak copy file, cuma reference URL yang sama
      4. Set draft.entity_id = invoice.id supaya tidak bisa dipakai dua kali
      5. Audit log create invoice + update draft

    Catatan: dulu ada gating 'status must be REVIEWED' tapi proses approve
    itu kosmetik (tidak ada koreksi data) -- dihapus. Edit data terjadi di
    InvoiceForm yang muncul setelah submit (status=DRAFT, semua field
    editable sebelum diterbitkan).
    """
    rec = await db.get(AIExtraction, eid)
    if not rec or rec.deleted_at is not None:
        raise HTTPException(404, "draft_not_found")
    if rec.entity_id is not None:
        raise HTTPException(
            409, f"draft_already_linked_to_invoice_{rec.entity_id}"
        )
    # User harus punya akses ke project tujuan
    await ensure_project_access(db, user, body.project_id)
    # Audit 2026-05-24 Phase 1: guard project closed. OCR import =
    # mutasi baru -- konsisten dgn create invoice biasa.
    from app.services.project_guard import assert_project_open
    await assert_project_open(db, body.project_id, user=user, force=False)

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

    # Audit 2026-06-13: dates + tax override-able. Fallback ke OCR.
    invoice_date = (
        body.override_invoice_date
        or _parse_iso_date(data.get("invoice_date"))
        or date.today()
    )
    due_date = (
        body.override_due_date
        if body.override_due_date is not None
        else _parse_iso_date(data.get("due_date"))
    )
    tax_value = (
        body.override_tax
        if body.override_tax is not None
        else _to_decimal(data.get("tax"))
    )

    inv = Invoice(
        number=number,
        project_id=body.project_id,
        type=body.type,
        invoice_date=invoice_date,
        due_date=due_date,
        vendor_client_id=body.vendor_client_id,
        party_name=party_name,
        tax=tax_value,
        notes="\n".join(notes_parts) or None,
        status=InvoiceStatus.DRAFT,
        created_by_id=user.id,
    )

    # Audit 2026-06-13: kalau body.items dikirim (user koreksi di OcrPage),
    # pakai itu sbg sumber kebenaran. Otherwise fallback ke extracted_data.items.
    if body.items is not None:
        raw_items = [
            {
                "description": it.description,
                "qty": it.quantity,
                "unit": it.unit,
                "price": it.unit_price,
            }
            for it in body.items
        ]
    else:
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
