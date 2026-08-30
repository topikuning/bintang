"""Regresi bootstrap_db: tiga keadaan DB yang mungkin ditemui saat deploy.

Kenapa berkas ini ada: deploy produksi pertama setelah migrasi otomatis
diaktifkan (2026-08-30) masuk CRASH LOOP. Penyebabnya asumsi yang salah
di `bootstrap_db.main()` -- ia hanya membedakan "sudah dikelola Alembic"
vs "belum", padahal DB produksi ada di keadaan KETIGA: `alembic_version`
terisi revisi lama, TAPI schema-nya sudah setara head karena selama ini
dijaga `create_all` + `_sync_pg_columns`.

Akibatnya ia memilih `upgrade head`, lalu mati di migrasi pertama:

    DuplicateColumnError: column "kind" of relation "projects"
    already exists

Test ini mengunci ketiga keadaan supaya keputusan stamp-vs-upgrade
diambil dari SCHEMA SEBENARNYA, bukan dari isi alembic_version.
"""
from __future__ import annotations

import sqlite3

import pytest
from sqlalchemy import create_engine, inspect, text

from app.db.base import Base
import app.models.models  # noqa: F401  (registrasi tabel)

# Revisi lama yang tercatat di DB produksi saat insiden.
STALE_REVISION = "f1a2b3c4d5e6"


def _sqlite_url(path) -> str:
    return f"sqlite:///{path}"


def _build_schema(path) -> None:
    """Bangun schema lewat create_all -- meniru cara DB produksi dibuat."""
    engine = create_engine(_sqlite_url(path))
    try:
        Base.metadata.create_all(engine)
    finally:
        engine.dispose()


def _write_stamp(path, revision: str) -> None:
    con = sqlite3.connect(path)
    try:
        con.execute("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)")
        con.execute("INSERT INTO alembic_version VALUES (?)", (revision,))
        con.commit()
    finally:
        con.close()


def _run_bootstrap(monkeypatch, path) -> None:
    from app.core import config as config_mod
    from app import bootstrap_db

    monkeypatch.setattr(
        config_mod.settings, "DATABASE_URL",
        f"sqlite+aiosqlite:///{path}", raising=False,
    )
    monkeypatch.setattr(
        bootstrap_db.settings, "DATABASE_URL",
        f"sqlite+aiosqlite:///{path}", raising=False,
    )
    assert bootstrap_db.main() == 0


def _current_revision(path) -> str | None:
    engine = create_engine(_sqlite_url(path))
    try:
        with engine.connect() as conn:
            row = conn.execute(text("SELECT version_num FROM alembic_version")).fetchone()
            return row[0] if row else None
    finally:
        engine.dispose()


def _head_revision() -> str:
    from alembic.script import ScriptDirectory
    from app.bootstrap_db import _alembic_config

    return ScriptDirectory.from_config(_alembic_config()).get_current_head()


def test_db_kosong_dibangun_lalu_di_stamp(tmp_path, monkeypatch):
    """DB kosong: schema dibangun dari model, bukan lewat rantai migrasi.

    Rantai migrasi memuat ALTER constraint yang tidak didukung SQLite,
    sehingga instalasi `docker compose` baru (default SQLite) akan gagal
    boot kalau jalur ini memakai `upgrade head`.
    """
    db = tmp_path / "kosong.db"
    _run_bootstrap(monkeypatch, db)

    assert _current_revision(db) == _head_revision()
    engine = create_engine(_sqlite_url(db))
    try:
        assert "users" in set(inspect(engine).get_table_names())
    finally:
        engine.dispose()


def test_schema_lengkap_tanpa_stamp_di_stamp_saja(tmp_path, monkeypatch):
    """DB lama bikinan create_all, belum pernah kenal Alembic."""
    db = tmp_path / "tanpa_stamp.db"
    _build_schema(db)

    _run_bootstrap(monkeypatch, db)
    assert _current_revision(db) == _head_revision()


def test_stamp_basi_tidak_memicu_upgrade(tmp_path, monkeypatch):
    """KEADAAN PRODUKSI SAAT INSIDEN 2026-08-30.

    alembic_version menunjuk revisi lama, tapi schema sudah setara head.
    Ini HARUS di-stamp, bukan di-upgrade -- upgrade akan menabrak
    DuplicateColumn dan mengunci deploy dalam crash loop.
    """
    db = tmp_path / "stamp_basi.db"
    _build_schema(db)
    _write_stamp(db, STALE_REVISION)

    assert _current_revision(db) == STALE_REVISION
    _run_bootstrap(monkeypatch, db)
    assert _current_revision(db) == _head_revision()


def test_kolom_hilang_memicu_upgrade(tmp_path, monkeypatch):
    """Kalau ada objek model yang BELUM ada di DB, jalurnya upgrade.

    Menjaga agar perbaikan di atas tidak berubah jadi "selalu stamp",
    yang akan membuat migrasi asli tidak pernah dijalankan.
    """
    from app import bootstrap_db

    db = tmp_path / "kurang.db"
    _build_schema(db)

    from app.core import config as config_mod
    monkeypatch.setattr(
        config_mod.settings, "DATABASE_URL",
        f"sqlite+aiosqlite:///{db}", raising=False,
    )
    monkeypatch.setattr(
        bootstrap_db.settings, "DATABASE_URL",
        f"sqlite+aiosqlite:///{db}", raising=False,
    )

    import asyncio
    is_empty, missing = asyncio.run(bootstrap_db._schema_gap())
    assert not is_empty
    assert missing == [], "schema hasil create_all seharusnya lengkap"

    # Hapus satu kolom -> harus terdeteksi kurang. Index-nya dibuang
    # dulu: SQLite menolak DROP COLUMN yang masih dipakai index.
    engine = create_engine(_sqlite_url(db))
    try:
        with engine.begin() as conn:
            conn.execute(text("DROP INDEX IF EXISTS ix_projects_kind"))
            conn.execute(text("ALTER TABLE projects DROP COLUMN kind"))
    finally:
        engine.dispose()

    is_empty, missing = asyncio.run(bootstrap_db._schema_gap())
    assert not is_empty
    assert "projects.kind" in missing
