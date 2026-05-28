"""Tesseract optional pre-pass utk struk cetak. Audit 2026-05-23 OCR opt #T3.9.

Strategi: kalau pytesseract + tesseract binary tersedia, jalankan Tesseract
dulu utk extract raw text. Kalau output confidence tinggi & terdeteksi
keyword finansial (Total/Subtotal/Rp), pakai Tesseract result + regex
ekstrak field utama. Otherwise (handwritten, blurry, ambigu), fallback ke LLM.

Untuk receipt printed sederhana, Tesseract = gratis & 100x lebih cepat
dari LLM call. Hemat biaya signifikan kalau sebagian besar upload adalah
struk cetak.

LIMITASI:
- Butuh tesseract binary + tesseract-ocr-ind (Indonesian) di OS.
- Akurasi field non-text (logo, layout kompleks) rendah.
- Untuk handwritten / blurry, langsung skip ke LLM.

Default DISABLED -- enable via app_settings OCR_TESSERACT_ENABLED=true.
"""
from __future__ import annotations

import io
import logging
import re
from decimal import Decimal
from typing import Any

log = logging.getLogger(__name__)

# Import lazy supaya kalau pytesseract / PIL tdk ada, modul tetap importable.
try:
    import pytesseract  # type: ignore
    from PIL import Image  # type: ignore
    _PYTESSERACT_OK = True
except ImportError:
    _PYTESSERACT_OK = False
    log.info("ocr.tesseract: pytesseract tdk terinstall -- pre-pass disabled")


def is_available() -> bool:
    """Check pytesseract import + binary path."""
    if not _PYTESSERACT_OK:
        return False
    try:
        # Cek binary actually executable
        pytesseract.get_tesseract_version()
        return True
    except Exception as e:  # noqa: BLE001
        log.warning("ocr.tesseract: binary tdk tersedia -- %s", e)
        return False


# Regex utk ekstrak field finansial dari raw OCR text Indonesian.
_RE_TOTAL = re.compile(
    r"(?:total|grand\s*total|jumlah\s*bayar|amount\s*due)\s*[:.]?\s*(?:rp\.?)?\s*"
    r"([\d.,]+)",
    re.IGNORECASE,
)
_RE_DATE = re.compile(
    r"\b(\d{1,2})[/\-\s](\d{1,2}|jan|feb|mar|apr|mei|jun|jul|agu|sep|okt|nov|des)"
    r"[/\-\s](\d{2,4})\b",
    re.IGNORECASE,
)
_RE_INV_NO = re.compile(
    r"(?:no\.?|invoice|inv|kuitansi)\s*[:#]?\s*([A-Z0-9\-/]{4,20})",
    re.IGNORECASE,
)


def _parse_idr_number(s: str) -> Decimal | None:
    """Parse '1.250.000' atau '1,250,000' -> Decimal('1250000')."""
    if not s:
        return None
    # Buang semua non-digit kecuali . dan ,
    clean = re.sub(r"[^\d.,]", "", s)
    # Indonesian convention: . = thousand, , = decimal
    # Heuristic: kalau ada , dan tepat 2 digit setelah , = decimal
    if "," in clean and len(clean.split(",")[-1]) == 2:
        whole, dec = clean.rsplit(",", 1)
        clean = whole.replace(".", "") + "." + dec
    else:
        clean = clean.replace(".", "").replace(",", "")
    try:
        return Decimal(clean)
    except Exception:  # noqa: BLE001
        return None


def try_extract(content: bytes, media_type: str) -> dict[str, Any] | None:
    """Coba ekstrak dgn Tesseract. Return dict spt LLM adapter atau None.

    Return None kalau:
    - Tesseract tdk available
    - Image tdk bisa di-decode
    - Tdk ditemukan keyword finansial (Total, Rp) -> indikasi bukan
      receipt struktur familiar
    - Confidence rata-rata Tesseract < 70 (handwritten/blurry)
    """
    if not is_available():
        return None
    if not media_type.startswith("image/"):
        return None  # PDF tdk handle di Tesseract path
    try:
        img = Image.open(io.BytesIO(content))
        # Get raw text + per-word confidence
        data = pytesseract.image_to_data(
            img, lang="ind+eng", output_type=pytesseract.Output.DICT,
        )
        raw_text = " ".join(t for t in data.get("text", []) if t.strip())
        # Avg confidence (skip -1 = no detection on that word)
        confs = [int(c) for c in data.get("conf", []) if c not in (-1, "-1")]
        avg_conf = sum(confs) / len(confs) if confs else 0
    except Exception as e:  # noqa: BLE001
        log.info("ocr.tesseract.failed: %s -- skip", e)
        return None

    if avg_conf < 70:
        log.info("ocr.tesseract: confidence rendah (%.0f) -- skip ke LLM", avg_conf)
        return None
    if not re.search(r"\b(total|rp|kuitansi|invoice|struk)\b", raw_text, re.IGNORECASE):
        log.info("ocr.tesseract: keyword finansial tdk ada -- skip ke LLM")
        return None

    # Ekstrak field minimum
    total_match = _RE_TOTAL.search(raw_text)
    total = _parse_idr_number(total_match.group(1)) if total_match else None
    inv_match = _RE_INV_NO.search(raw_text)
    inv_no = inv_match.group(1) if inv_match else None

    if total is None:
        log.info("ocr.tesseract: 'Total' tdk terdeteksi -- skip ke LLM")
        return None

    log.info("ocr.tesseract.success conf=%.0f total=%s", avg_conf, total)
    # Build minimum result (LLM-compatible shape)
    return {
        "invoice_number": inv_no,
        "invoice_date": None,  # date parsing fragile, leave to LLM nanti
        "vendor_name": None,   # vendor extraction tdk reliable via regex
        "due_date": None,
        "subtotal": None,
        "tax": None,
        "total": total,
        "currency": "IDR",
        "items": [],
        "is_handwritten": False,
        "notes": "Tesseract pre-pass (printed text). Verify field kosong manual.",
        "confidence_score": Decimal(str(avg_conf / 100)),
        "field_confidences": {
            "total": round(avg_conf / 100, 2),
            "invoice_number": 0.7 if inv_no else 0,
            "vendor_name": 0,
            "invoice_date": 0,
        },
        "raw_response": {
            "engine": "tesseract:local",
            "avg_confidence": avg_conf,
            "text_preview": raw_text[:200],
        },
    }
