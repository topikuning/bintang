from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import Enum as SAEnum
from sqlalchemy import text

from app.api.v1 import api_router
from app.core.config import settings
from app.db.base import Base
from app.db.session import engine


async def _sync_pg_enums(conn) -> None:
    """Postgres: pastikan tiap nilai enum di model ada di type DB.
    `create_all` tidak update enum yang sudah ada, sehingga value baru
    yang ditambahkan di kode (mis. UserRole.CENTRAL_ADMIN) gagal di
    INSERT. Kita lakukan `ALTER TYPE ... ADD VALUE IF NOT EXISTS` untuk
    setiap nilai (idempoten, butuh PG 12+).
    """
    seen: set[tuple[str, str]] = set()
    for table in Base.metadata.tables.values():
        for column in table.columns:
            t = column.type
            if not isinstance(t, SAEnum) or not t.name:
                continue
            for val in t.enums:
                key = (t.name, val)
                if key in seen:
                    continue
                seen.add(key)
                # Aman karena enum name & value semuanya literal Python sumber.
                safe = val.replace("'", "''")
                await conn.execute(
                    text(f"ALTER TYPE {t.name} ADD VALUE IF NOT EXISTS '{safe}'")
                )


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Pastikan tabel ada untuk dev (SQLite). Untuk prod gunakan Alembic.
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    # Sync enum (hanya Postgres). SQLite simpan enum sebagai VARCHAR -- tidak perlu.
    if not settings.is_sqlite:
        try:
            async with engine.begin() as conn:
                await _sync_pg_enums(conn)
        except Exception as e:  # noqa: BLE001
            # jangan blok startup; cetak warning saja
            print(f"[startup] enum sync warning: {e}")
    Path(settings.UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(
    title=f"{settings.APP_NAME} API",
    description="Bintang - Biaya, Investasi dan Tata Anggaran Gerak",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

upload_path = Path(settings.UPLOAD_DIR)
upload_path.mkdir(parents=True, exist_ok=True)
app.mount("/files", StaticFiles(directory=str(upload_path)), name="files")

app.include_router(api_router, prefix="/api/v1")


@app.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    return {"status": "ok", "app": settings.APP_NAME}
