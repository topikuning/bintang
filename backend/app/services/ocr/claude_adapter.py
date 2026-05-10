"""Claude Vision OCR adapter.

Pakai Anthropic Messages API + structured JSON output untuk ekstraksi
invoice/kuitansi/struk/PO -- mendukung dokumen cetak DAN tulisan tangan.

Default model: claude-haiku-4-5 (paling murah & cepat). Bisa di-upgrade
ke claude-sonnet-4-6 via env OCR_MODEL kalau akurasi kurang.
"""

from __future__ import annotations

import base64
import json
import logging
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

import anthropic
import httpx

from app.core.config import settings
from app.services.ocr.adapter import OCRAdapter

log = logging.getLogger(__name__)

# Hard timeout untuk satu API call ke Anthropic. Cukup longgar utk dokumen
# rumit (handwriting + banyak items) tapi cepat fail kalau ada masalah --
# axios client di frontend 110s, jadi backend harus selesai lebih dulu.
_ANTHROPIC_TIMEOUT = 75.0
# Tidak retry. Default SDK retry 2 dgn exponential backoff -- total bisa
# >150s dan trigger proxy/client timeout. Lebih baik fail cepat dan biarkan
# user retry manual.
_ANTHROPIC_MAX_RETRIES = 0


# Schema yang dipaksakan ke output Claude. Field optional sengaja tidak
# masuk required -> Claude boleh omit kalau tidak terbaca (vs nullable yg
# kadang membingungkan structured output).
INVOICE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "invoice_number": {
            "type": "string",
            "description": "Nomor invoice/kuitansi/PO apa adanya.",
        },
        "invoice_date": {
            "type": "string",
            "description": "Tanggal dokumen, format YYYY-MM-DD. Konversi 'Apr 12, 2026' -> '2026-04-12'.",
        },
        "vendor_name": {
            "type": "string",
            "description": "Nama vendor/penjual/toko.",
        },
        "due_date": {
            "type": "string",
            "description": "Tanggal jatuh tempo, YYYY-MM-DD.",
        },
        "subtotal": {
            "type": "number",
            "description": "Subtotal sebelum pajak (rupiah). Number polos tanpa separator.",
        },
        "tax": {
            "type": "number",
            "description": "Total pajak/PPN (rupiah).",
        },
        "total": {
            "type": "number",
            "description": "Grand total (rupiah). Field paling penting.",
        },
        "currency": {
            "type": "string",
            "description": "Default IDR.",
        },
        "is_handwritten": {
            "type": "boolean",
            "description": "True kalau ada bagian ditulis tangan (termasuk tanda tangan/nomor manual di kuitansi cetak).",
        },
        "items": {
            "type": "array",
            "description": "Setiap baris item/barang/jasa di dokumen.",
            "items": {
                "type": "object",
                "properties": {
                    "description": {
                        "type": "string",
                        "description": "Nama/deskripsi item apa adanya.",
                    },
                    "qty": {"type": "number"},
                    "unit": {
                        "type": "string",
                        "description": "Satuan: pcs/kg/liter/lot/m/dll.",
                    },
                    "price": {
                        "type": "number",
                        "description": "Harga satuan (rupiah).",
                    },
                    "amount": {
                        "type": "number",
                        "description": "Subtotal baris = qty * price.",
                    },
                },
                "required": ["description"],
                "additionalProperties": False,
            },
        },
        "confidence_score": {
            "type": "number",
            "description": "Skor 0-1. >=0.85 cetak jelas; 0.5-0.7 tulisan tangan rapi; <0.4 sulit dibaca/blur.",
        },
        "notes": {
            "type": "string",
            "description": "Catatan kalau ada bagian sulit dibaca/terpotong/blur.",
        },
    },
    "required": ["items", "confidence_score", "is_handwritten"],
    "additionalProperties": False,
}


SYSTEM_PROMPT = """Kamu OCR engine khusus dokumen keuangan Indonesia: invoice, kuitansi, struk, purchase order. Dokumen bisa cetak ATAU tulisan tangan -- akurat untuk keduanya.

Aturan:
1. Tulisan tangan: baca teliti. Kalau ragu antara dua interpretasi, pilih yang masuk akal di konteks dokumen keuangan dan turunkan confidence_score.
2. Angka rupiah: hilangkan separator titik/koma/spasi -> number polos. "Rp 1.250.000" -> 1250000. "Rp 1,250.50" -> 1250.5.
3. Tanggal: konversi ke YYYY-MM-DD. "12 April 2026" -> "2026-04-12". Kalau ambigu, omit field.
4. Items: WAJIB ekstrak SETIAP baris item yang terlihat -- jangan skip walau pricing tidak tertulis. Description selalu wajib.
5. is_handwritten=true kalau ada SATU pun bagian tulisan tangan (signature + nomor manual di kuitansi cetak juga termasuk).
6. confidence_score tinggi (>=0.85) hanya kalau hasil bisa langsung dipakai tanpa review. Tulisan tangan paling tinggi 0.7.
7. Bagian tidak terbaca/blur/terpotong -> isi field 'notes' dengan deskripsi singkat masalahnya.

Output JSON sesuai schema. Tidak perlu komentar/penjelasan tambahan."""


_MEDIA_TYPE_BY_SUFFIX = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".pdf": "application/pdf",
}


def _to_decimal(v: Any) -> Decimal | None:
    if v is None:
        return None
    try:
        return Decimal(str(v))
    except (InvalidOperation, ValueError):
        return None


class ClaudeVisionOCRAdapter(OCRAdapter):
    def __init__(self, api_key: str, model: str) -> None:
        self._client = anthropic.AsyncAnthropic(
            api_key=api_key,
            timeout=_ANTHROPIC_TIMEOUT,
            max_retries=_ANTHROPIC_MAX_RETRIES,
        )
        self._model = model

    async def extract_invoice(self, file_url: str) -> dict[str, Any]:
        """Resolve URL -> bytes -> ekstrak. Mendukung URL absolut (http/https)
        dan path relatif lokal (/files/...) yang sudah disimpan storage service.
        """
        if file_url.startswith("/files/"):
            rel = file_url[len("/files/") :]
            p = Path(settings.UPLOAD_DIR) / rel
            if not p.exists():
                raise FileNotFoundError(f"local_file_not_found: {p}")
            content = p.read_bytes()
            media_type = _MEDIA_TYPE_BY_SUFFIX.get(p.suffix.lower(), "image/jpeg")
        else:
            async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as hx:
                r = await hx.get(file_url)
                r.raise_for_status()
                content = r.content
                media_type = (
                    r.headers.get("content-type", "").split(";")[0].strip()
                    or "image/jpeg"
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

        if media_type == "application/pdf":
            content_block: dict[str, Any] = {
                "type": "document",
                "source": {"type": "base64", "media_type": media_type, "data": b64},
            }
        elif media_type.startswith("image/"):
            # Claude vision support: jpeg/png/gif/webp. HEIC tidak didukung
            # langsung -- storage layer sudah konversi via Pillow ke JPEG.
            content_block = {
                "type": "image",
                "source": {"type": "base64", "media_type": media_type, "data": b64},
            }
        else:
            raise ValueError(f"unsupported_media_type: {media_type}")

        log.info(
            "ocr.claude.start model=%s media=%s size_kb=%d",
            self._model,
            media_type,
            len(content) // 1024,
        )
        try:
            response = await self._client.messages.create(
                model=self._model,
                max_tokens=4096,
                system=SYSTEM_PROMPT,
                output_config={
                    "format": {"type": "json_schema", "schema": INVOICE_SCHEMA}
                },
                messages=[
                    {
                        "role": "user",
                        "content": [
                            content_block,
                            {
                                "type": "text",
                                "text": "Ekstrak dokumen ini sesuai schema. Kembalikan JSON saja.",
                            },
                        ],
                    }
                ],
            )
        except anthropic.AuthenticationError as e:
            log.error("ocr.claude.auth_error: %s", e)
            raise RuntimeError(
                "anthropic_auth_failed: cek ANTHROPIC_API_KEY di env"
            ) from e
        except anthropic.RateLimitError as e:
            log.error("ocr.claude.rate_limited: %s", e)
            raise RuntimeError("anthropic_rate_limited: coba lagi sebentar") from e
        except anthropic.BadRequestError as e:
            log.error("ocr.claude.bad_request: %s", e)
            raise RuntimeError(f"anthropic_bad_request: {e}") from e
        except anthropic.APITimeoutError as e:
            log.error("ocr.claude.timeout after %ss", _ANTHROPIC_TIMEOUT)
            raise RuntimeError(
                f"anthropic_timeout_{int(_ANTHROPIC_TIMEOUT)}s: dokumen terlalu rumit atau API lambat"
            ) from e
        except anthropic.APIError as e:
            log.error("ocr.claude.api_error: %s", e)
            raise RuntimeError(f"anthropic_api_error: {e}") from e

        text_block = next(
            (b for b in response.content if getattr(b, "type", None) == "text"),
            None,
        )
        if text_block is None:
            log.error(
                "ocr.claude.no_text_block stop_reason=%s blocks=%s",
                response.stop_reason,
                [getattr(b, "type", "?") for b in response.content],
            )
            raise RuntimeError(f"claude_no_text_block stop={response.stop_reason}")
        try:
            data = json.loads(text_block.text)
        except json.JSONDecodeError as e:
            log.error("ocr.claude.invalid_json: %s | text=%s", e, text_block.text[:500])
            raise RuntimeError(f"claude_invalid_json: {e}") from e
        log.info(
            "ocr.claude.done items=%d input_tokens=%d output_tokens=%d",
            len(data.get("items") or []),
            response.usage.input_tokens,
            response.usage.output_tokens,
        )

        return {
            "invoice_number": data.get("invoice_number"),
            "invoice_date": data.get("invoice_date"),
            "vendor_name": data.get("vendor_name"),
            "due_date": data.get("due_date"),
            "subtotal": _to_decimal(data.get("subtotal")),
            "tax": _to_decimal(data.get("tax")),
            "total": _to_decimal(data.get("total")),
            "currency": data.get("currency") or "IDR",
            "items": data.get("items") or [],
            "is_handwritten": bool(data.get("is_handwritten", False)),
            "notes": data.get("notes"),
            "confidence_score": _to_decimal(data.get("confidence_score"))
            or Decimal("0"),
            "raw_response": {
                "engine": f"claude:{self._model}",
                "model": response.model,
                "stop_reason": response.stop_reason,
                "usage": {
                    "input_tokens": response.usage.input_tokens,
                    "output_tokens": response.usage.output_tokens,
                },
            },
            "source_url": source_url,
        }
