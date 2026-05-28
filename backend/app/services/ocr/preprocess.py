"""Image preprocessing untuk OCR.

Tujuan: kecilkan size yg dikirim ke LLM vision API (input token = pixel
count). Resize 4032x3024 (foto HP) -> 1568px longest = ~16x fewer pixels
= ~70% biaya turun. Akurasi rata-rata tdk turun krn teks struk masih
besar di hasil resize.

Audit 2026-05-23 OCR optimization #T1.1.
"""
from __future__ import annotations

import io
import logging
from typing import Literal

from PIL import Image, ImageOps

log = logging.getLogger(__name__)

# Claude vision sweet spot per dokumentasi Anthropic:
# https://docs.claude.com/en/docs/build-with-claude/vision
# "For best performance, downsize images to 1568 pixels along the
#  longest edge". Lebih besar dr ini tdk meningkatkan akurasi tapi
#  tambah cost & latency.
_MAX_LONG_EDGE_PX = 1568
# JPEG quality 85 sweet spot: file size ~30% dari q=100, visual quality
# masih excellent utk OCR (teks bukan foto detil).
_JPEG_QUALITY = 85


def preprocess_for_ocr(
    content: bytes,
    media_type: str,
) -> tuple[bytes, str]:
    """Preprocess content sebelum kirim ke OCR adapter.

    - PDF: pass-through (LLM handle PDF natif, tdk perlu rasterize).
    - Image: resize ke max 1568px longest edge, save JPEG q=85,
      strip EXIF, auto-rotate via EXIF Orientation.

    Returns:
        (processed_bytes, output_media_type). Output media_type bisa
        berbeda dr input (mis. PNG -> JPEG).

    Catatan keandalan: kalau ada exception (corrupted image, format
    aneh), return content original supaya OCR tetap jalan (tdk break
    workflow). Log warning utk diagnostik.
    """
    if media_type == "application/pdf":
        return content, media_type
    if not media_type.startswith("image/"):
        # Unknown type -- biarkan adapter handle (akan reject).
        return content, media_type

    original_size_kb = len(content) // 1024
    try:
        img = Image.open(io.BytesIO(content))
        # Auto-rotate via EXIF Orientation. Banyak foto HP punya EXIF
        # rotation flag -- kalau tdk handle, output ter-rotate 90°/180°
        # dan OCR bingung baca terbalik.
        img = ImageOps.exif_transpose(img)
        # Convert ke RGB. JPEG tdk support RGBA/P/grayscale dgn alpha.
        # Receipt mostly content, alpha tdk perlu.
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        # Resize kalau perlu (longest edge > MAX).
        w, h = img.size
        long_edge = max(w, h)
        if long_edge > _MAX_LONG_EDGE_PX:
            scale = _MAX_LONG_EDGE_PX / long_edge
            new_size = (int(w * scale), int(h * scale))
            img = img.resize(new_size, Image.Resampling.LANCZOS)
        # Encode JPEG (strip EXIF dgn cara tdk pass parameter exif=).
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=_JPEG_QUALITY, optimize=True)
        out = buf.getvalue()
        log.info(
            "ocr.preprocess: %dx%d -> %dx%d, %dKB -> %dKB (%.0f%% reduction)",
            w, h, img.width, img.height,
            original_size_kb, len(out) // 1024,
            (1 - len(out) / max(len(content), 1)) * 100,
        )
        return out, "image/jpeg"
    except Exception as e:  # noqa: BLE001
        log.warning("ocr.preprocess.failed media=%s err=%s -- pass-through",
                    media_type, e)
        return content, media_type
