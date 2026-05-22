"""In-memory rate limiter sederhana. Untuk single-instance deploy.

PENTING: state in-memory -> reset saat restart. Multi-instance deploy
butuh shared store (Redis). Cocok utk Railway single instance.

Implementation: sliding window per key (mis. IP). Tdk pakai library
eksternal supaya tdk nambah dep.
"""
from __future__ import annotations

from collections import deque
from time import monotonic
from threading import Lock
from typing import Deque


class RateLimiter:
    """Sliding window rate limiter (max_calls per period_seconds).

    Thread-safe via Lock supaya safe di multi-worker uvicorn.
    """

    def __init__(self, *, max_calls: int, period_seconds: float):
        self.max_calls = max_calls
        self.period = period_seconds
        self._buckets: dict[str, Deque[float]] = {}
        self._lock = Lock()

    def check(self, key: str) -> tuple[bool, float]:
        """Return (allowed, retry_after_seconds).

        retry_after = 0 kalau allowed; else detik sampai slot tersedia.
        """
        now = monotonic()
        cutoff = now - self.period
        with self._lock:
            bucket = self._buckets.get(key)
            if bucket is None:
                bucket = deque()
                self._buckets[key] = bucket
            # Purge expired
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()
            if len(bucket) >= self.max_calls:
                retry = max(0.0, bucket[0] - cutoff)
                return False, retry
            bucket.append(now)
            return True, 0.0

    def reset(self, key: str) -> None:
        """Hapus history utk key (mis. setelah login sukses)."""
        with self._lock:
            self._buckets.pop(key, None)


# Global instances utk dipakai di endpoint.
# Tunable: login 5 attempts / 60 detik per IP (cukup ketat utk cegah
# brute-force credential stuffing, ringan utk user normal yg sesekali typo).
login_limiter = RateLimiter(max_calls=5, period_seconds=60.0)

# Audit 2026-05-22 #H9: OCR extract dipanggil ke LLM/vision API
# (Claude/Mistral) -- biaya per request, dan upload file besar bisa
# memory-heavy. Throttle agresif per user supaya tdk meledak cost
# kalau client buggy (mis. retry loop) atau akun di-abuse.
# Per user: 20 OCR per menit (1 setiap 3 detik) -- normal usage paling
# 1-5 OCR/menit saat input bulk receipt.
ocr_limiter = RateLimiter(max_calls=20, period_seconds=60.0)

# Audit 2026-05-22 #H10: Telegram link-code generation dipanggil tanpa
# proof-of-work apapun. Brute-force enumeration code (000000-999999)
# pakai endpoint /api/v1/telegram/me/link-code (re-generate) tdk akan
# work langsung -- tapi rate-limit utk cegah abuse generate code spam
# yg bisa invalidasi kode aktif user lain.
# Per user: 5 generate/menit.
telegram_link_limiter = RateLimiter(max_calls=5, period_seconds=60.0)
