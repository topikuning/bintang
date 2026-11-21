"""Semua kolom DateTime wajib ber-zona waktu.

Kode mengisi waktu dengan `datetime.now(UTC)` (punya zona waktu). Kolom
`TIMESTAMP WITHOUT TIME ZONE` menolak nilai itu di PostgreSQL + asyncpg
("can't subtract offset-naive and offset-aware datetimes") -> 500. SQLite
(dipakai tes) tidak menolak, jadi kesalahan ini lolos tes biasa. Kasus nyata:
`projects.approved_at` membuat setujui proposal proyek gagal di produksi.
"""

from sqlalchemy import DateTime

import app.models.models  # noqa: F401
from app.db.base import Base


def test_semua_kolom_datetime_berzona_waktu():
    tanpa_zona = [
        f"{t.name}.{c.name}"
        for t in Base.metadata.tables.values()
        for c in t.columns
        if isinstance(c.type, DateTime) and not c.type.timezone
    ]
    assert tanpa_zona == [], f"Kolom DateTime tanpa timezone=True: {tanpa_zona}"
