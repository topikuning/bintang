"""Helper perbandingan datetime yang aman lintas backend DB.

Masalahnya: kolom `DateTime(timezone=True)` mengembalikan objek yang
BERBEDA tergantung driver.

- Postgres (asyncpg)  -> datetime AWARE (punya tzinfo).
- SQLite (aiosqlite)  -> datetime NAIVE (SQLite tidak menyimpan tz).

Jadi `row.expires_at < datetime.now(timezone.utc)` bekerja di Postgres
tapi melempar `TypeError: can't compare offset-naive and offset-aware
datetimes` di SQLite. Karena SQLite adalah default untuk dev DAN untuk
docker-compose, seluruh alur sesi bot (Telegram/WhatsApp) crash di sana
-- ketahuan saat test suite akhirnya dijalankan, 2026-08-30.

Konvensi proyek: semua timestamp disimpan dalam UTC. Jadi datetime naive
yang datang dari DB aman diperlakukan sebagai UTC.
"""

from __future__ import annotations

from datetime import datetime, timezone


def as_utc(value: datetime | None) -> datetime | None:
    """Pastikan `value` punya tzinfo UTC. None diteruskan apa adanya."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def is_expired(expires_at: datetime | None, *, now: datetime | None = None) -> bool:
    """True kalau `expires_at` sudah lewat. None dianggap TIDAK kedaluwarsa.

    Pakai ini alih-alih membandingkan langsung -- lihat catatan modul.
    """
    if expires_at is None:
        return False
    reference = now or datetime.now(timezone.utc)
    return as_utc(expires_at) < as_utc(reference)
