"""Claude Vision OCR adapter.

Pakai Anthropic Messages API + forced tool use untuk ekstraksi
invoice/kuitansi/struk/PO -- mendukung dokumen cetak DAN tulisan tangan.

Default model: claude-haiku-4-5 (paling murah & cepat). Bisa di-upgrade
ke claude-sonnet-4-6 via env OCR_MODEL kalau akurasi kurang.

Kenapa forced tool use bukan output_config? Tool use lebih universal --
support di semua Claude 4.x model dan SDK versi 0.30+. output_config
adalah feature relatif baru yang bisa hang/timeout di SDK lama.
"""

from __future__ import annotations

import base64
import logging
import re
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import anthropic
import httpx

from app.core.config import settings
from app.services.ocr.adapter import OCRAdapter

log = logging.getLogger(__name__)

# Hard timeout untuk satu API call ke Anthropic. Cukup longgar utk dokumen
# rumit (handwriting + banyak items) tapi cepat fail kalau ada masalah.
_ANTHROPIC_TIMEOUT = 60.0
# Tidak retry. Default SDK retry 2 dgn backoff -- total bisa >150s.
_ANTHROPIC_MAX_RETRIES = 0

# Schema untuk tool input -- model paksa output JSON yg valid sesuai struktur.
INVOICE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "invoice_number": {
            "type": "string",
            "description": "Nomor invoice/kuitansi/PO apa adanya. String kosong kalau tidak terbaca.",
        },
        "invoice_date": {
            "type": "string",
            "description": "Tanggal dokumen, format YYYY-MM-DD. String kosong kalau tidak ada.",
        },
        "vendor_name": {
            "type": "string",
            "description": "Nama vendor/penjual/toko. String kosong kalau tidak terbaca.",
        },
        "due_date": {
            "type": "string",
            "description": "Tanggal jatuh tempo, YYYY-MM-DD. String kosong kalau tidak ada.",
        },
        "subtotal": {
            "type": "number",
            "description": "Subtotal sebelum pajak (rupiah). 0 kalau tidak ada.",
        },
        "tax": {
            "type": "number",
            "description": "Total pajak/PPN (rupiah). 0 kalau tidak ada.",
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
            "description": "True kalau ada bagian ditulis tangan (signature + nomor manual juga termasuk).",
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
            },
        },
        "confidence_score": {
            "type": "number",
            "description": "Skor 0-1. >=0.85 cetak jelas; 0.5-0.7 tulisan tangan rapi; <0.4 sulit dibaca.",
        },
        "notes": {
            "type": "string",
            "description": "Catatan kalau ada bagian sulit dibaca/blur. String kosong kalau semua jelas.",
        },
    },
    "required": ["items", "confidence_score", "is_handwritten", "total"],
}

EXTRACT_TOOL = {
    "name": "save_invoice_extraction",
    "description": "Simpan hasil ekstraksi data invoice/kuitansi/struk/PO. Wajib dipanggil sekali per dokumen dengan semua field yang berhasil dibaca.",
    "input_schema": INVOICE_SCHEMA,
}

SYSTEM_PROMPT = """Kamu OCR engine khusus dokumen keuangan Indonesia: invoice, kuitansi, struk, purchase order. Dokumen bisa cetak ATAU tulisan tangan -- akurat untuk keduanya.

Aturan:
1. Tulisan tangan: baca teliti. Kalau ragu antara dua interpretasi, pilih yang masuk akal di konteks dokumen keuangan dan turunkan confidence_score.
2. Angka rupiah: hilangkan separator titik/koma/spasi -> number polos. "Rp 1.250.000" -> 1250000. "Rp 1,250.50" -> 1250.5.
3. Tanggal: konversi ke YYYY-MM-DD. "12 April 2026" -> "2026-04-12". Kalau ambigu, pakai string kosong.
4. Items: WAJIB ekstrak SETIAP baris item yang terlihat -- jangan skip walau pricing tidak tertulis. Description selalu wajib.
5. is_handwritten=true kalau ada SATU pun bagian tulisan tangan.
6. confidence_score tinggi (>=0.85) hanya kalau hasil bisa langsung dipakai tanpa review. Tulisan tangan paling tinggi 0.7.
7. Bagian tidak terbaca/blur/terpotong -> isi field 'notes' dengan deskripsi singkat.
8. WAJIB call tool save_invoice_extraction dengan semua field. Jangan jawab teks bebas."""


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
    """Auto-konversi URL share Google Drive ke direct download link.

    - https://drive.google.com/file/d/{ID}/view -> https://drive.google.com/uc?export=download&id={ID}
    - https://drive.google.com/open?id={ID}     -> sama
    URL lain dikembalikan apa adanya.
    """
    parsed = urlparse(url)
    if parsed.netloc not in ("drive.google.com", "www.drive.google.com"):
        return url
    # /file/d/{ID}/view atau /file/d/{ID}/preview
    m = re.match(r"^/file/d/([^/]+)", parsed.path)
    if m:
        file_id = m.group(1)
        return f"https://drive.google.com/uc?export=download&id={file_id}"
    # /open?id={ID}
    if parsed.path == "/open":
        ids = parse_qs(parsed.query).get("id")
        if ids:
            return f"https://drive.google.com/uc?export=download&id={ids[0]}"
    return url


class ClaudeVisionOCRAdapter(OCRAdapter):
    def __init__(self, api_key: str, model: str) -> None:
        self._client = anthropic.AsyncAnthropic(
            api_key=api_key,
            timeout=_ANTHROPIC_TIMEOUT,
            max_retries=_ANTHROPIC_MAX_RETRIES,
        )
        self._model = model

    async def test_connection(self) -> dict[str, Any]:
        """Ping kecil ke Anthropic API utk verifikasi auth + connectivity.

        Tidak pakai vision -- input minimal supaya cepat & murah.
        Return dict {ok: bool, model, latency_ms, message, ...}.
        """
        import time

        t0 = time.monotonic()
        try:
            resp = await self._client.messages.create(
                model=self._model,
                max_tokens=10,
                messages=[{"role": "user", "content": "Reply with just: PONG"}],
            )
            text = next(
                (
                    getattr(b, "text", "")
                    for b in resp.content
                    if getattr(b, "type", None) == "text"
                ),
                "",
            )
            return {
                "ok": True,
                "model": resp.model,
                "latency_ms": int((time.monotonic() - t0) * 1000),
                "reply": text.strip(),
                "input_tokens": resp.usage.input_tokens,
                "output_tokens": resp.usage.output_tokens,
            }
        except anthropic.AuthenticationError as e:
            return {
                "ok": False,
                "error": "auth_failed",
                "detail": str(e),
                "hint": "Cek ANTHROPIC_API_KEY -- harus mulai dgn 'sk-ant-api03-' dan masih aktif",
            }
        except anthropic.NotFoundError as e:
            return {
                "ok": False,
                "error": "model_not_found",
                "detail": str(e),
                "hint": f"Model '{self._model}' tidak tersedia. Coba 'claude-haiku-4-5' atau 'claude-sonnet-4-6'.",
            }
        except anthropic.PermissionDeniedError as e:
            return {
                "ok": False,
                "error": "permission_denied",
                "detail": str(e),
                "hint": "API key tidak punya akses ke model ini, atau quota habis.",
            }
        except anthropic.RateLimitError as e:
            return {"ok": False, "error": "rate_limited", "detail": str(e)}
        except anthropic.APITimeoutError:
            return {
                "ok": False,
                "error": "timeout",
                "detail": f"tidak ada response dlm {int(_ANTHROPIC_TIMEOUT)}s",
                "hint": "Network Railway -> Anthropic kemungkinan blocked/lambat.",
            }
        except anthropic.APIError as e:
            return {"ok": False, "error": "api_error", "detail": str(e)}

    async def extract_invoice(self, file_url: str) -> dict[str, Any]:
        """Resolve URL -> bytes -> ekstrak. Mendukung URL absolut, path lokal
        /files/..., dan auto-konversi Google Drive sharing URL ke direct DL.
        """
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
                log.info("ocr.url_normalized %s -> %s", file_url, normalized)
            async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as hx:
                r = await hx.get(normalized)
                r.raise_for_status()
                content = r.content
                media_type = (
                    r.headers.get("content-type", "").split(";")[0].strip()
                    or "image/jpeg"
                )
                if media_type == "text/html":
                    raise ValueError(
                        "url_returned_html: URL mengembalikan halaman web, bukan file. "
                        "Untuk Google Drive: pakai link 'View' (https://drive.google.com/file/d/.../view) "
                        "-- adapter auto-konversi ke direct download. "
                        "Untuk Dropbox: ganti '?dl=0' di akhir URL jadi '?dl=1'."
                    )
                if not (
                    media_type.startswith("image/") or media_type == "application/pdf"
                ):
                    raise ValueError(
                        f"unsupported_media_type: {media_type} (URL bukan gambar/PDF)"
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
                tools=[EXTRACT_TOOL],
                tool_choice={"type": "tool", "name": EXTRACT_TOOL["name"]},
                messages=[
                    {
                        "role": "user",
                        "content": [
                            content_block,
                            {
                                "type": "text",
                                "text": "Ekstrak dokumen ini dan call tool save_invoice_extraction.",
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
        except anthropic.NotFoundError as e:
            log.error("ocr.claude.model_not_found: %s", e)
            raise RuntimeError(
                f"anthropic_model_not_found: model '{self._model}' tidak tersedia"
            ) from e
        except anthropic.BadRequestError as e:
            log.error("ocr.claude.bad_request: %s", e)
            raise RuntimeError(f"anthropic_bad_request: {e}") from e
        except anthropic.APITimeoutError as e:
            log.error("ocr.claude.timeout after %ss", _ANTHROPIC_TIMEOUT)
            raise RuntimeError(
                f"anthropic_timeout_{int(_ANTHROPIC_TIMEOUT)}s: API tidak respond. "
                "Test koneksi dulu di /ocr/test-connection."
            ) from e
        except anthropic.APIError as e:
            log.error("ocr.claude.api_error: %s", e)
            raise RuntimeError(f"anthropic_api_error: {e}") from e

        # Forced tool use -> response harus punya tool_use block
        tool_block = next(
            (b for b in response.content if getattr(b, "type", None) == "tool_use"),
            None,
        )
        if tool_block is None:
            log.error(
                "ocr.claude.no_tool_use stop_reason=%s blocks=%s",
                response.stop_reason,
                [getattr(b, "type", "?") for b in response.content],
            )
            # Surface text dari Claude kalau ada (kadang model refuse)
            text_block = next(
                (b for b in response.content if getattr(b, "type", None) == "text"),
                None,
            )
            text_excerpt = (
                getattr(text_block, "text", "")[:200] if text_block else ""
            )
            raise RuntimeError(
                f"claude_no_tool_use stop={response.stop_reason} text={text_excerpt!r}"
            )
        data = tool_block.input or {}
        log.info(
            "ocr.claude.done items=%d input_tokens=%d output_tokens=%d",
            len(data.get("items") or []),
            response.usage.input_tokens,
            response.usage.output_tokens,
        )

        return {
            "invoice_number": data.get("invoice_number") or None,
            "invoice_date": data.get("invoice_date") or None,
            "vendor_name": data.get("vendor_name") or None,
            "due_date": data.get("due_date") or None,
            "subtotal": _to_decimal(data.get("subtotal")),
            "tax": _to_decimal(data.get("tax")),
            "total": _to_decimal(data.get("total")),
            "currency": data.get("currency") or "IDR",
            "items": data.get("items") or [],
            "is_handwritten": bool(data.get("is_handwritten", False)),
            "notes": data.get("notes") or None,
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
