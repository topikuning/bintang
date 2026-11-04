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
    import app.models.models  # noqa: F401  (registrasi seluruh tabel)
    from app.db.base import Base

    def _inspect(conn):
        insp = inspect(conn)
        names = set(insp.get_table_names())
        return {
            "tables": names,
            "columns": {t: {c["name"]: c for c in insp.get_columns(t)} for t in names},
            "indexes": {t: insp.get_indexes(t) for t in names},
            "uniques": {t: insp.get_unique_constraints(t) for t in names},
            "foreign_keys": {t: insp.get_foreign_keys(t) for t in names},
            "primary_keys": {t: insp.get_pk_constraint(t) for t in names},
        }

    engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
    try:
        async with engine.connect() as conn:
            live = await conn.run_sync(_inspect)
    finally:
        await engine.dispose()

    # alembic_version bukan bagian dari model -- abaikan saat menilai
    # apakah DB "kosong".
    live_tables = live["tables"]
    is_empty = not (live_tables - {"alembic_version"})

    missing: list[str] = []
    for table in Base.metadata.sorted_tables:
        if table.name not in live_tables:
            missing.append(table.name)
            continue
        live_cols = live["columns"][table.name]
        for col in table.columns:
            if col.name not in live_cols:
                missing.append(f"{table.name}.{col.name}")
                continue
            reflected = live_cols[col.name]
            # Bandingkan karakteristik yang memengaruhi integritas data.
            # Type affinity lintas dialek tetap stabil (Enum -> String,
            # EncryptedString -> String), sedangkan nama SQL mentah tidak.
            model_type = col.type._type_affinity
            live_type = reflected["type"]._type_affinity
            if model_type is not live_type:
                missing.append(f"{table.name}.{col.name}:type")
            if not col.primary_key and bool(col.nullable) != bool(reflected["nullable"]):
                missing.append(f"{table.name}.{col.name}:nullable")

        expected_pk = tuple(c.name for c in table.primary_key.columns)
        live_pk = tuple(live["primary_keys"][table.name].get("constrained_columns") or ())
        if expected_pk and expected_pk != live_pk:
            missing.append(f"{table.name}:primary_key")

        live_keys = {
            (tuple(i.get("column_names") or ()), bool(i.get("unique")))
            for i in live["indexes"][table.name]
        }
        live_keys.update(
            (tuple(u.get("column_names") or ()), True) for u in live["uniques"][table.name]
        )
        expected_keys = {
            (tuple(c.name for c in idx.columns), bool(idx.unique)) for idx in table.indexes
        }
        expected_keys.update(
            (tuple(c.name for c in constraint.columns), True)
            for constraint in table.constraints
            if constraint.__class__.__name__ == "UniqueConstraint"
        )
        for columns, unique in expected_keys - live_keys:
            missing.append(f"{table.name}:index({','.join(columns)};unique={str(unique).lower()})")

        live_fks = {
            (
                tuple(fk.get("constrained_columns") or ()),
                fk.get("referred_table"),
                tuple(fk.get("referred_columns") or ()),
            )
            for fk in live["foreign_keys"][table.name]
        }
        for fk in table.foreign_key_constraints:
            signature = (
                tuple(e.parent.name for e in fk.elements),
                next(iter(fk.elements)).column.table.name,
                tuple(e.column.name for e in fk.elements),
            )
            if signature not in live_fks:
                missing.append(f"{table.name}:foreign_key({','.join(signature[0])})")
    return is_empty, missing


async def _reconcile_legacy_schema() -> None:
    """Bawa schema DB lama ke keadaan mutakhir TANPA menjalankan migrasi.

    Menjalankan tiga hal yang idempoten dan selama ini memang sudah
    dipakai aplikasi (dulu di lifespan `main.py`):
      - `create_all`        : tambah tabel yang belum ada
      - `_sync_pg_columns`  : ADD COLUMN IF NOT EXISTS utk kolom baru
      - `_sync_pg_enums`    : ALTER TYPE ... ADD VALUE IF NOT EXISTS

    Kombinasi inilah yang menjaga schema produksi tetap benar selama
    berbulan-bulan sebelum Alembic diaktifkan, jadi memakainya di sini
    berarti kita bersandar pada jalur yang sudah terbukti di lingkungan
    itu -- bukan menebak.

    Tujuannya: setelah ini, `_schema_gap()` hampir pasti bersih,
    sehingga kita bisa `stamp head` dgn aman alih-alih `upgrade` dari
    revisi basi (yang akan menabrak DuplicateColumn -> crash loop).
    """
    import app.models.models  # noqa: F401
    from app.db.base import Base
    from app.db.schema_sync import _sync_pg_columns, _sync_pg_enums

    engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        if not settings.is_sqlite:
            async with engine.begin() as conn:
                await _sync_pg_columns(conn)
                await _sync_pg_enums(conn)
    finally:
        await engine.dispose()


def _alembic_config() -> Config:
    root = Path(__file__).resolve().parent
    cfg = Config(str(root.parent / "alembic.ini"))
    cfg.set_main_option("script_location", str(root / "alembic"))
    return cfg


def _already_exists_error(exc: BaseException) -> bool:
    """True kalau kegagalan upgrade disebabkan objek yang sudah ada.

    Ini penanda khas DB yang lahir SEBELUM Alembic: schema-nya sudah
    lebih maju daripada revisi yang tercatat, sehingga migrasi mencoba
    membuat kolom/tabel yang sudah ada.
    """
    text = f"{type(exc).__name__}: {exc}".lower()
    # Postgres/asyncpg : 'DuplicateColumnError', 'column ... already exists'
    # SQLite           : 'duplicate column name: kind'
    markers = (
        "already exists",
        "duplicatecolumn",
        "duplicatetable",
        "duplicateobject",
        "duplicate column",
        "duplicate table",
        "duplicate key",
    )
    return any(m in text for m in markers)


def main() -> int:
    cfg = _alembic_config()

    is_empty, _missing = asyncio.run(_schema_gap())

    if is_empty:
        # DB kosong -> bangun schema langsung dari model, lalu stamp.
        #
        # Bukan `upgrade head`: rantai migrasi memuat ALTER constraint
        # yang tidak didukung SQLite, sehingga instalasi `docker
        # compose` baru (default SQLite) gagal boot. Di DB kosong tidak
        # ada data yang perlu dimigrasi, jadi hasilnya identik.
        print("[bootstrap_db] DB kosong -- bangun schema dari model lalu stamp head.")
        asyncio.run(_reconcile_legacy_schema())
        command.stamp(cfg, "head")
        print("[bootstrap_db] schema up to date.")
        return 0

    # DB berisi. Jalur NORMAL tetap `upgrade head` -- itu yang membuat
    # migrasi asli benar-benar dijalankan. Kita TIDAK boleh
    # mem-blanket-stamp di sini: kalau nanti ada migrasi baru yang sah,
    # blanket-stamp akan melewatinya diam-diam.
    try:
        print("[bootstrap_db] DB berisi -- upgrade ke head.")
        command.upgrade(cfg, "head")
    except Exception as e:  # noqa: BLE001
        if not _already_exists_error(e):
            raise

        # Objek sudah ada -> DB ini lahir sebelum Alembic dan schema-nya
        # lebih maju daripada alembic_version. Upgrade tadi berjalan
        # dalam satu transaksi, jadi sudah ter-rollback penuh: DB tidak
        # berubah dan aman untuk direkonsiliasi.
        #
        # Inilah keadaan yang mengunci deploy produksi dalam crash loop
        # pada 2026-08-30 (alembic_version=f1a2b3c4d5e6, schema sudah
        # setara head). Ditangani otomatis di sini supaya tidak pernah
        # lagi butuh `alembic stamp head` manual.
        print(
            "[bootstrap_db] Upgrade menabrak objek yang sudah ada -- DB ini "
            "lahir sebelum Alembic. Rekonsiliasi lalu stamp."
        )
        asyncio.run(_reconcile_legacy_schema())

        _, missing = asyncio.run(_schema_gap())
        if missing:
            preview = ", ".join(missing[:10]) + ("..." if len(missing) > 10 else "")
            raise RuntimeError(
                f"schema masih kurang {len(missing)} objek setelah "
                f"rekonsiliasi ({preview}). Perlu ditangani manual."
            ) from e

        print(
            "[bootstrap_db] Schema lengkap sesuai model -- STAMP ke head. "
            "Tidak ada data yang disentuh."
        )
        print(
            "[bootstrap_db] Data migration yang dilewati: "
            + ", ".join(_SKIPPED_DATA_MIGRATIONS)
            + " (lihat catatan di berkas ini)."
        )
        command.stamp(cfg, "head")

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
