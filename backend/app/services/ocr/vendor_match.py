"""Fuzzy match extracted vendor_name terhadap tabel VendorClient.

Audit 2026-05-23 OCR opt #T2.5. Tujuan: cegah duplikat vendor di DB
("PT Berkah Karya" vs "Berkah Karya" vs "PT.BERKAH KARYA") + auto-suggest
existing vendor utk hemat input user.

Algoritma:
1. Normalize name (lowercase, strip prefix PT/CV/UD/dll, strip non-alnum)
2. Difflib SequenceMatcher ratio terhadap semua candidate
3. Return top-1 di atas threshold

Difflib built-in (no dep). Untuk skala >500 vendor, swap ke rapidfuzz.
"""
from __future__ import annotations

import logging
import re
from difflib import SequenceMatcher

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import VendorClient

log = logging.getLogger(__name__)

# Threshold default. >=0.75 = match yakin (mis. typo / spasi beda).
# 0.6-0.75 = saran lemah (mungkin nama mirip tapi entitas beda).
MATCH_THRESHOLD = 0.75

_LEGAL_PREFIX = re.compile(
    r"^\s*(pt\.?|cv\.?|ud\.?|toko|fa\.?|persero|tbk|terbuka)\s+",
    re.IGNORECASE,
)


def normalize(name: str) -> str:
    """Normalize vendor name utk matching:
    - lowercase
    - strip prefix PT/CV/UD/Toko/FA/Persero/Tbk
    - strip non-alfanumerik (spasi, titik, koma jadi space, lalu collapse)
    """
    if not name:
        return ""
    s = name.strip().lower()
    # Strip legal prefix berkali2 (mis. "PT. CV Berkah" -> "Berkah")
    while True:
        new = _LEGAL_PREFIX.sub("", s)
        if new == s:
            break
        s = new
    # Replace non-alnum dgn space, collapse
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    s = re.sub(r"\s+", " ", s)
    return s


async def match_vendor(
    db: AsyncSession,
    extracted_name: str | None,
    *,
    min_score: float = MATCH_THRESHOLD,
) -> dict | None:
    """Return best match: {id, name, score} atau None.

    None kalau:
    - extracted_name empty/None
    - tdk ada VendorClient di DB
    - best score < min_score
    """
    if not extracted_name or not extracted_name.strip():
        return None
    target = normalize(extracted_name)
    if not target:
        return None

    rows = (await db.execute(
        select(VendorClient.id, VendorClient.name).where(
            VendorClient.deleted_at.is_(None),
        )
    )).all()
    if not rows:
        return None

    best_score = 0.0
    best: tuple[int, str] | None = None
    for vid, vname in rows:
        cand = normalize(vname)
        if not cand:
            continue
        # SequenceMatcher quick_ratio adalah fast upper-bound -- skip pair
        # yg jelas tdk match (perf optimization utk DB besar).
        sm = SequenceMatcher(None, target, cand)
        if sm.quick_ratio() < min_score:
            continue
        score = sm.ratio()
        if score > best_score:
            best_score = score
            best = (vid, vname)

    if best is None or best_score < min_score:
        return None
    vid, vname = best
    log.info("ocr.vendor_match: '%s' -> '%s' (score=%.2f)",
             extracted_name, vname, best_score)
    return {"id": vid, "name": vname, "score": round(best_score, 3)}
