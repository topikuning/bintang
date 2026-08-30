"""Pytest fixtures global.

Setup minimal: in-memory SQLite + AsyncSession + auto schema create_all.
Sengaja tidak share session antar test -- tiap test dapat session fresh
supaya isolated. Untuk test yg butuh `app` lifespan (mis. e2e via
httpx AsyncClient), tambah fixture tersendiri di file test masing-2.
"""
from __future__ import annotations

from typing import AsyncGenerator

import pytest_asyncio
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.db.base import Base
# IMPORTANT: import models supaya semua tabel ke-register di metadata
import app.models.models  # noqa: F401


# CATATAN 2026-08-30: fixture `event_loop` kustom DIHAPUS.
#
# pytest-asyncio menandai override `event_loop` sebagai deprecated di
# 0.23 dan menghapus dukungannya di 1.0. Karena dependency backend tidak
# pernah dikunci, CI sebenarnya sudah lama memakai pytest-asyncio 1.x --
# fixture ini cuma jadi kode mati yang menyesatkan pembaca berikutnya.
#
# Dengan `asyncio_mode = "auto"` di pyproject.toml, tiap test async
# otomatis dapat event loop baru per fungsi, yang persis perilaku yang
# ingin dicapai komentar lama ("tidak bocor antar test").


@pytest_asyncio.fixture
async def db() -> AsyncGenerator[AsyncSession, None]:
    """Async DB session fresh -- in-memory SQLite, schema baru.

    Pakai pool StaticPool supaya semua connection share DB yg sama
    (`:memory:` default beda DB per connection).
    """
    from sqlalchemy.pool import StaticPool

    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    async with Session() as session:
        yield session
    await engine.dispose()
