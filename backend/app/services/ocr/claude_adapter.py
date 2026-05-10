"""Claude Vision OCR adapter.

Pakai Anthropic Messages API + structured JSON output untuk ekstraksi
invoice/kuitansi/struk/PO -- mendukung dokumen cetak DAN tulisan tangan.

Default model: claude-haiku-4-5 (paling murah & cepat). Bisa di-upgrade
ke claude-sonnet-4-6 via env OCR_MODEL kalau akurasi kurang.
"""

from __future__ import annotations

import base64
import json
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

import anthropic
import httpx

from app.core.config import settings
from app.services.ocr.adapter import OCRAdapter


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
        self._client = anthropic.AsyncAnthropic(api_key=api_key)
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

        text_block = next(
            (b for b in response.content if getattr(b, "type", None) == "text"),
            None,
        )
        if text_block is None:
            raise RuntimeError("claude_no_text_block")
        try:
            data = json.loads(text_block.text)
        except json.JSONDecodeError as e:
            raise RuntimeError(f"claude_invalid_json: {e}") from e

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
