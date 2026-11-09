"""Normalisasi URL database dari platform deployment."""

from app.core.config import Settings


def test_railway_postgres_url_dinormalisasi_ke_asyncpg():
    settings = Settings(
        _env_file=None,
        DATABASE_URL="postgresql://user:password@postgres.railway.internal:5432/railway",
    )

    assert settings.DATABASE_URL == (
        "postgresql+asyncpg://user:password@postgres.railway.internal:5432/railway"
    )


def test_postgres_alias_lama_juga_dinormalisasi():
    settings = Settings(
        _env_file=None,
        DATABASE_URL="postgres://user:password@host/database",
    )

    assert settings.DATABASE_URL == "postgresql+asyncpg://user:password@host/database"


def test_url_async_dan_sqlite_tidak_diubah():
    async_url = "postgresql+asyncpg://user:password@host/database"
    sqlite_url = "sqlite+aiosqlite:///./bintang.db"

    assert Settings(_env_file=None, DATABASE_URL=async_url).DATABASE_URL == async_url
    assert Settings(_env_file=None, DATABASE_URL=sqlite_url).DATABASE_URL == sqlite_url
