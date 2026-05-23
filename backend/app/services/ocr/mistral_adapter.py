"""Mistral Document AI (OCR) adapter.

Pakai endpoint `POST /v1/ocr` dgn `document_annotation_format` (JSON schema
structured output) -- tidak perlu step kedua utk parse text ke struktur.

Pricing (per Mei 2026):
- Standard: ~$2 / 1000 halaman = $0.002 / halaman
- Batch API: ~$1 / 1000 halaman = $0.001 / halaman
=> 5-10x lebih murah dr Claude Haiku-4.5 (~$0.01/gambar).

Trade-off vs Claude:
- (+) Murah, fokus document AI, structured output langsung
- (+) Mendukung PDF multi-halaman natif (sampai 1000 pages, 50MB)
- (-) Annotations dibatasi 8 halaman per request (untuk invoice biasa OK)
- (-) Tdk se-pintar Claude utk tulisan tangan kompleks/dokumen sulit
=> Tetap sediakan ClaudeVisionOCRAdapter sbg fallback berkualitas tinggi.

Implementasi pakai httpx (raw HTTP) supaya tidak perlu mistralai SDK
sebagai dep tambahan. Sesuai dgn pattern claude_adapter.
"""

from __future__ import annotations

import base64
import json
import logging
import re
import time
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx

from app.core.config import settings
from app.services.ocr.adapter import OCRAdapter
from app.services.ocr.schema import INVOICE_SCHEMA, INVOICE_SYSTEM_PROMPT

log = logging.getLogger(__name__)

_MISTRAL_OCR_URL = "https://api.mistral.ai/v1/ocr"
_MISTRAL_MODELS_URL = "https://api.mistral.ai/v1/models"
# Timeout cukup longgar utk dokumen multi-halaman.
_MISTRAL_TIMEOUT = 90.0

_MEDIA_TYPE_BY_SUFFIX = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".pdf": "application/pdf",
}


def _to_decimal(v: Any) -> Decimal | None:
    if v is None or v == "":
        return None
    try:
        return Decimal(str(v))
    except (InvalidOperation, ValueError):
        return None


def _normalize_url(url: str) -> str:
    """Auto-konversi URL share Google Drive ke direct download. Sama dgn
    claude_adapter -- duplikat sederhana supaya adapter mandiri."""
    parsed = urlparse(url)
    if parsed.netloc not in ("drive.google.com", "www.drive.google.com"):
        return url
    m = re.match(r"^/file/d/([^/]+)", parsed.path)
    if m:
        return f"https://drive.google.com/uc?export=download&id={m.group(1)}"
    if parsed.path == "/open":
        ids = parse_qs(parsed.query).get("id")
        if ids:
            return f"https://drive.google.com/uc?export=download&id={ids[0]}"
    return url


class MistralOCRAdapter(OCRAdapter):
    """Adapter Mistral Document AI -- structured invoice extraction.

    Strategi:
    1. Encode file (image/PDF) ke data URI base64.
    2. POST /v1/ocr dgn document + document_annotation_format(JSON schema).
    3. Parse response.document_annotation (JSON string) -> dict.
    4. Map ke format standar OCRAdapter (sama dgn ClaudeVisionOCRAdapter).
    """

    def __init__(self, api_key: str, model: str = "mistral-ocr-latest") -> None:
        self._api_key = api_key
        self._model = model
        self._client = httpx.AsyncClient(
            timeout=_MISTRAL_TIMEOUT,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
        )

    async def test_connection(self) -> dict[str, Any]:
        """Ping ringan via GET /v1/models -- verifikasi auth + connectivity
        tanpa mengkonsumsi credit OCR."""
        t0 = time.monotonic()
        try:
            r = await self._client.get(_MISTRAL_MODELS_URL)
            latency = int((time.monotonic() - t0) * 1000)
            if r.status_code == 401:
                return {
                    "ok": False,
                    "error": "auth_failed",
                    "detail": "MISTRAL_API_KEY ditolak (401).",
                    "hint": "Cek MISTRAL_API_KEY -- generate di console.mistral.ai.",
                }
            if r.status_code == 403:
                return {
                    "ok": False,
                    "error": "permission_denied",
                    "detail": str(r.text)[:300],
                }
            r.raise_for_status()
            data = r.json()
            ids = [
                m.get("id") for m in (data.get("data") or [])
                if isinstance(m, dict)
            ]
            has_model = self._model in ids or any(
                (m or "").startswith("mistral-ocr") for m in ids
            )
            return {
                "ok": True,
                "model": self._model,
                "latency_ms": latency,
                "models_available": len(ids),
                "ocr_model_listed": has_model,
                "hint": (
                    None if has_model
                    else f"Model '{self._model}' tidak terdeteksi di list."
                ),
            }
        except httpx.TimeoutException:
            return {
                "ok": False,
                "error": "timeout",
                "detail": f"tidak ada response dlm {int(_MISTRAL_TIMEOUT)}s",
            }
        except httpx.HTTPError as e:
            return {"ok": False, "error": "http_error", "detail": str(e)}

    async def extract_invoice(self, file_url: str) -> dict[str, Any]:
        """Resolve URL/path lokal -> bytes -> ekstrak. Mendukung file lokal
        (/files/...) dan URL absolut (auto-konversi Google Drive share)."""
        if file_url.startswith("/files/"):
            rel = file_url[len("/files/") :]
            p = Path(settings.UPLOAD_DIR) / rel
            if not p.exists():
                raise FileNotFoundError(f"local_file_not_found: {p}")
            content = p.read_bytes()
            media_type = _MEDIA_TYPE_BY_SUFFIX.get(p.suffix.lower(), "image/jpeg")
        else:
            normalized = _normalize_url(file_url)
            if normalized != file_url:
                log.info("ocr.mistral.url_normalized %s -> %s", file_url, normalized)
            async with httpx.AsyncClient(
                timeout=30.0, follow_redirects=True
            ) as hx:
                r = await hx.get(normalized)
                r.raise_for_status()
                content = r.content
                media_type = (
                    r.headers.get("content-type", "").split(";")[0].strip()
                    or "image/jpeg"
                )
                if media_type == "text/html":
                    raise ValueError(
                        "url_returned_html: URL mengembalikan halaman web. "
                        "Untuk Google Drive: pakai link 'View'; Dropbox: "
                        "ganti '?dl=0' jadi '?dl=1'."
                    )
                if not (
                    media_type.startswith("image/")
                    or media_type == "application/pdf"
                ):
                    raise ValueError(
                        f"unsupported_media_type: {media_type}"
                    )
        return await self.extract_from_bytes(
            content, media_type, source_url=file_url
        )

    async def extract_from_bytes(
        self,
        content: bytes,
        media_type: str,
        *,
        source_url: str | None = None,
    ) -> dict[str, Any]:
        b64 = base64.standard_b64encode(content).decode("ascii")
        data_uri = f"data:{media_type};base64,{b64}"

        if media_type == "application/pdf":
            document = {"type": "document_url", "document_url": data_uri}
        elif media_type.startswith("image/"):
            document = {"type": "image_url", "image_url": data_uri}
        else:
            raise ValueError(f"unsupported_media_type: {media_type}")

        # document_annotation_format = structured output utk seluruh
        # dokumen. Pakai JSON Schema. Mistral akan fill schema otomatis
        # berdasarkan teks OCR + instruksi sistem (kalau didukung).
        payload = {
            "model": self._model,
            "document": document,
            "document_annotation_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "invoice_extraction",
                    "description": INVOICE_SYSTEM_PROMPT,
                    "schema": INVOICE_SCHEMA,
                    "strict": False,  # strict=True kadang tolak partial fill
                },
            },
            # Tidak butuh base64 image return -- hemat bandwidth.
            "include_image_base64": False,
        }

        log.info(
            "ocr.mistral.start model=%s media=%s size_kb=%d",
            self._model,
            media_type,
            len(content) // 1024,
        )
        t0 = time.monotonic()
        try:
            r = await self._client.post(_MISTRAL_OCR_URL, json=payload)
        except httpx.TimeoutException as e:
            log.error("ocr.mistral.timeout after %ss", _MISTRAL_TIMEOUT)
            raise RuntimeError(
                f"mistral_timeout_{int(_MISTRAL_TIMEOUT)}s: API tdk respond."
            ) from e
        except httpx.HTTPError as e:
            log.error("ocr.mistral.http_error: %s", e)
            raise RuntimeError(f"mistral_http_error: {e}") from e

        latency_ms = int((time.monotonic() - t0) * 1000)

        if r.status_code == 401:
            log.error("ocr.mistral.auth_failed")
            raise RuntimeError("mistral_auth_failed: cek MISTRAL_API_KEY")
        if r.status_code == 429:
            log.error("ocr.mistral.rate_limited")
            raise RuntimeError("mistral_rate_limited: coba lagi sebentar")
        if r.status_code >= 500:
            log.error(
                "ocr.mistral.server_error status=%s body=%s",
                r.status_code, r.text[:300],
            )
            raise RuntimeError(
                f"mistral_server_error_{r.status_code}: API down"
            )
        if r.status_code >= 400:
            log.error(
                "ocr.mistral.bad_request status=%s body=%s",
                r.status_code, r.text[:500],
            )
            raise RuntimeError(
                f"mistral_bad_request_{r.status_code}: {r.text[:200]}"
            )
        data = r.json()

        # Response shape (Mistral OCR v1):
        # {
        #   pages: [{index, markdown, dimensions, ...}],
        #   model: "...",
        #   document_annotation: "{...JSON string...}",  // kalau req format
        #   usage_info: {pages_processed, doc_size_bytes}
        # }
        ann_raw = data.get("document_annotation")
        ann: dict[str, Any] = {}
        if ann_raw:
            if isinstance(ann_raw, str):
                try:
                    ann = json.loads(ann_raw)
                except json.JSONDecodeError:
                    log.warning(
                        "ocr.mistral.annotation_not_json -- fallback empty"
                    )
                    ann = {}
            elif isinstance(ann_raw, dict):
                ann = ann_raw

        # Concat semua page markdown utk debug + audit trail (truncate)
        pages = data.get("pages") or []
        all_md = "\n\n---\n\n".join(
            (p.get("markdown") or "")[:2000] for p in pages
        )[:8000]

        log.info(
            "ocr.mistral.done pages=%d items=%d latency_ms=%d",
            len(pages),
            len(ann.get("items") or []),
            latency_ms,
        )

        return {
            "invoice_number": ann.get("invoice_number") or None,
            "invoice_date": ann.get("invoice_date") or None,
            "vendor_name": ann.get("vendor_name") or None,
            "due_date": ann.get("due_date") or None,
            "subtotal": _to_decimal(ann.get("subtotal")),
            "tax": _to_decimal(ann.get("tax")),
            "total": _to_decimal(ann.get("total")),
            "currency": ann.get("currency") or "IDR",
            "items": ann.get("items") or [],
            "is_handwritten": bool(ann.get("is_handwritten", False)),
            "notes": ann.get("notes") or None,
            "confidence_score": _to_decimal(ann.get("confidence_score"))
            or Decimal("0"),
            "field_confidences": ann.get("field_confidences") or {},
            "raw_response": {
                "engine": f"mistral:{self._model}",
                "model": data.get("model"),
                "pages_count": len(pages),
                "latency_ms": latency_ms,
                "usage_info": data.get("usage_info"),
                "ocr_markdown_preview": all_md,
            },
            "source_url": source_url,
        }

    async def aclose(self) -> None:
        await self._client.aclose()
