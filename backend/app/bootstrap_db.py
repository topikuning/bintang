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


async def _existing_tables() -> set[str]:
    """Daftar tabel yang sudah ada di DB.

    HARUS memakai engine ASYNC. Sempat ditulis dgn `create_engine()` dan
    URL yang di-strip jadi `postgresql://` -- itu bug: dialek sync
    default SQLAlchemy untuk Postgres adalah psycopg2, dan psycopg2
    TIDAK ada di dependency proyek ini (hanya asyncpg). Akibatnya
    entrypoint gagal `ModuleNotFoundError: psycopg2` dan container tidak
    pernah start. `app/alembic/env.py` juga memakai async engine, jadi
    ini sekalian konsisten dengannya.
    """
    engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
    try:
        async with engine.connect() as conn:
            return set(await conn.run_sync(lambda c: inspect(c).get_table_names()))
    finally:
        await engine.dispose()


def _alembic_config() -> Config:
    root = Path(__file__).resolve().parent
    cfg = Config(str(root.parent / "alembic.ini"))
    cfg.set_main_option("script_location", str(root / "alembic"))
    return cfg


def main() -> int:
    cfg = _alembic_config()

    tables = asyncio.run(_existing_tables())

    has_schema = SENTINEL_TABLE in tables
    has_stamp = "alembic_version" in tables

    if not has_schema:
        print("[bootstrap_db] DB kosong -- jalankan seluruh migrasi dari awal.")
        command.upgrade(cfg, "head")
    elif not has_stamp:
        print(
            "[bootstrap_db] DB berisi tapi belum dikelola Alembic (dibangun "
            "create_all). Schema-nya sudah setara head, jadi kita STAMP -- "
            "tidak ada DDL dan tidak ada data yang disentuh."
        )
        print(
            "[bootstrap_db] Data migration yang dilewati: "
            + ", ".join(_SKIPPED_DATA_MIGRATIONS)
            + " (lihat catatan di app/bootstrap_db.py)."
        )
        command.stamp(cfg, "head")
    else:
        print("[bootstrap_db] DB sudah dikelola Alembic -- upgrade ke head.")
        command.upgrade(cfg, "head")

    print("[bootstrap_db] schema up to date.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001
        print(f"[bootstrap_db] GAGAL: {type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(1)
