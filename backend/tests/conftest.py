"""Pytest fixtures global.

Setup minimal: in-memory SQLite + AsyncSession + auto schema create_all.
Sengaja tidak share session antar test -- tiap test dapat session fresh
supaya isolated. Untuk test yg butuh `app` lifespan (mis. e2e via
httpx AsyncClient), tambah fixture tersendiri di file test masing-2.
"""
from __future__ import annotations

import asyncio
from typing import AsyncGenerator

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.db.base import Base
# IMPORTANT: import models supaya semua tabel ke-register di metadata
import app.models.models  # noqa: F401


# Tiap event loop scope = function (default) supaya fixture asyncio
# tidak bocor antar test.
@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


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
