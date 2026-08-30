"""Siapkan schema DB sebelum aplikasi start.

Audit 2026-06-13 #D-01. Sebelum ini, 20 migrasi Alembic ada di repo tapi
TIDAK PERNAH dijalankan: `startCommand` cuma menjalankan uvicorn, dan
schema produksi dikelola `Base.metadata.create_all` + ~40 `ALTER TABLE`
tulisan tangan di `main.py` yang kegagalannya hanya di-print.

## Kenapa tidak sekadar `alembic upgrade head`

`create_all` membangun schema dari model SAAT INI -- artinya DB produksi
STRUKTURNYA SUDAH SETARA `head`, cuma tidak punya baris di
`alembic_version`. Kalau kita stamp ke baseline lalu `upgrade head`,
setiap migrasi sesudahnya akan mencoba membuat objek yang sudah ada:

    op.add_column('users', 'username')      -> DuplicateColumn
    op.create_table('cash_requests')        -> DuplicateTable

dan deploy gagal di langkah pertama.

Ini sudah diverifikasi untuk repo ini (audit 2026-06-13): ketujuh kolom
yang ditambahkan migrasi pasca-baseline semuanya ada di daftar
`_sync_pg_columns`, dan kesebelas tabel barunya dibuat `create_all`.

## Yang dilakukan modul ini

1. DB kosong              -> `upgrade head`. Seluruh rantai migrasi
                             jalan normal, termasuk data migration.
2. DB terisi, belum
   ter-stamp (kasus prod
   saat ini)              -> `stamp head`. TIDAK ADA DDL dan TIDAK ADA
                             baris data yang disentuh -- kita hanya
                             mencatat bahwa schema sudah di posisi head.
3. DB sudah ter-stamp     -> `upgrade head` seperti biasa. Mulai dari
                             sini Alembic jadi sumber kebenaran.

Efek jalur (2): data migration yang belum pernah jalan akan dilewati
selamanya. Untuk repo ini itu aman dan disengaja -- lihat CATATAN di
bawah.

Dipanggil `docker-entrypoint.sh` sebelum uvicorn. Kalau gagal, exit
non-zero supaya deploy berhenti dan versi lama tetap melayani.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings

# Tabel yang pasti ada di schema versi mana pun -- dipakai untuk
# membedakan "DB kosong" dari "DB lama tanpa stamp".
SENTINEL_TABLE = "users"

# CATATAN -- data migration yang dilewati pada jalur stamp:
#
#   d4f8a2e7c1b5  encrypt_bank_accounts
#       Meng-enkripsi nilai bank_account/party_account yang masih
#       plaintext. AMAN dilewati: tipe kolom `EncryptedString` membaca
#       plaintext maupun ciphertext (nilai tanpa marker `enc:v1:`
#       di-pass-through), jadi data lama tetap terbaca dan tulisan baru
#       otomatis ter-enkripsi. Untuk meng-enkripsi baris lama secara
#       retroaktif, jalankan migrasi itu manual sekali:
#           alembic -x force=1 upgrade d4f8a2e7c1b5
#       (migrasinya idempoten: nilai yang sudah ber-marker di-skip).
#
#   f1a2b3c4d5e6  merge_funder_into_user_executive
#       Memindahkan tabel `funders` ke `users(role=EXECUTIVE)`. AMAN
#       dilewati: kalau `funders` masih ada di DB produksi, ia tidak
#       lagi ada di model sehingga tidak dibaca aplikasi; kalau sudah
#       tidak ada, migrasi ini justru akan CRASH bila dipaksa jalan
#       (SELECT-nya tidak dijaga pemeriksaan keberadaan tabel).
_SKIPPED_DATA_MIGRATIONS = ("d4f8a2e7c1b5", "f1a2b3c4d5e6")


async def _schema_gap() -> tuple[bool, list[str]]:
    """Bandingkan schema hidup dgn `Base.metadata`.

    Return `(db_kosong, daftar_yang_kurang)`. `daftar_yang_kurang` berisi
    "tabel" atau "tabel.kolom" yang ada di model tapi belum ada di DB.

    HARUS memakai engine ASYNC -- dialek sync default SQLAlchemy untuk
    Postgres adalah psycopg2, yang TIDAK ada di dependency proyek ini.
    """
    from app.db.base import Base
    import app.models.models  # noqa: F401  (registrasi seluruh tabel)

    def _inspect(conn) -> tuple[set[str], dict[str, set[str]]]:
        insp = inspect(conn)
        names = set(insp.get_table_names())
        cols = {t: {c["name"] for c in insp.get_columns(t)} for t in names}
        return names, cols

    engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
    try:
        async with engine.connect() as conn:
            live_tables, live_cols = await conn.run_sync(_inspect)
    finally:
        await engine.dispose()

    # alembic_version bukan bagian dari model -- abaikan saat menilai
    # apakah DB "kosong".
    is_empty = not (live_tables - {"alembic_version"})

    missing: list[str] = []
    for table in Base.metadata.sorted_tables:
        if table.name not in live_tables:
            missing.append(table.name)
            continue
        for col in table.columns:
            if col.name not in live_cols[table.name]:
                missing.append(f"{table.name}.{col.name}")
    return is_empty, missing


async def _create_all() -> None:
    """Bangun seluruh tabel dari `Base.metadata` (khusus DB kosong)."""
    from app.db.base import Base
    import app.models.models  # noqa: F401

    engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    finally:
        await engine.dispose()


def _alembic_config() -> Config:
    root = Path(__file__).resolve().parent
    cfg = Config(str(root.parent / "alembic.ini"))
    cfg.set_main_option("script_location", str(root / "alembic"))
    return cfg


def main() -> int:
    cfg = _alembic_config()

    is_empty, missing = asyncio.run(_schema_gap())

    if is_empty:
        # DB kosong -> bangun schema langsung dari model, lalu stamp.
        #
        # Bukan `upgrade head`: rantai migrasi memuat langkah yang tidak
        # bisa dijalankan SQLite (ALTER constraint di
        # b7e2f4a8c9d1_financial_check_constraints), sehingga instalasi
        # `docker compose` baru -- default-nya SQLite -- gagal boot.
        # Di DB kosong tidak ada data yang perlu dimigrasi, jadi hasil
        # create_all identik dgn menjalankan seluruh rantai, dan bekerja
        # di SQLite maupun Postgres.
        print("[bootstrap_db] DB kosong -- bangun schema dari model lalu stamp head.")
        asyncio.run(_create_all())
        command.stamp(cfg, "head")
    elif not missing:
        # Schema sudah lengkap sesuai model. Ini benar TERLEPAS dari apa
        # yang tertulis di alembic_version -- termasuk saat stamp-nya
        # basi (mis. tertulis f1a2b3c4d5e6 padahal create_all +
        # _sync_pg_columns sudah membawa schema ke head). Meng-upgrade
        # dari stamp basi akan menabrak DuplicateColumn/DuplicateTable
        # dan mengunci deploy dalam crash loop -- persis yang terjadi
        # pada deploy pertama 2026-08-30.
        print(
            "[bootstrap_db] Schema sudah lengkap sesuai model -- STAMP ke "
            "head. Tidak ada DDL dan tidak ada data yang disentuh."
        )
        print(
            "[bootstrap_db] Data migration yang dilewati: "
            + ", ".join(_SKIPPED_DATA_MIGRATIONS)
            + " (lihat catatan di app/bootstrap_db.py)."
        )
        command.stamp(cfg, "head")
    else:
        preview = ", ".join(missing[:10]) + ("..." if len(missing) > 10 else "")
        print(
            f"[bootstrap_db] {len(missing)} objek belum ada di DB "
            f"({preview}) -- jalankan upgrade."
        )
        command.upgrade(cfg, "head")

    print("[bootstrap_db] schema up to date.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001
        print(f"[bootstrap_db] GAGAL: {type(e).__name__}: {e}", file=sys.stderr)
        if "already exists" in str(e) or "DuplicateColumn" in type(e).__name__:
            print(
                "[bootstrap_db] PETUNJUK: objek sudah ada, artinya schema "
                "lebih maju daripada alembic_version. Sinkronkan sekali dgn:\n"
                "    railway run alembic stamp head",
                file=sys.stderr,
            )
        sys.exit(1)
