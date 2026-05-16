# Database migrations (Alembic)

Sebelumnya schema di-manage runtime (`Base.metadata.create_all` +
`_sync_pg_columns`). Itu cocok utk dev, tapi prod butuh history
migration utk rollback aman & data-loss visibility.

## Setup awal (one-time)

Alembic sudah di-scaffold:
- `backend/alembic.ini` — config CLI
- `backend/app/alembic/env.py` — env script (pakai metadata dari
  `Base`, DB URL dari `app.core.config`)
- `backend/app/alembic/versions/` — migration files
- Baseline migration `20260516_0946_baseline_schema.py` snapshot dari
  schema saat ini.

## Workflow dev

Setelah ubah model di `app/models/models.py`:

```bash
cd backend
# Generate migration baru
DATABASE_URL="..." alembic revision --autogenerate -m "deskripsi_singkat"

# Review file yg di-generate -- autogenerate TIDAK selalu sempurna:
# - Drop+create column tanpa data migration
# - Type change yg butuh USING clause (Postgres)
# - Rename tabel/kolom (autogen think it's drop+create)

# Apply ke dev DB
DATABASE_URL="..." alembic upgrade head
```

## Workflow prod (Railway)

Jalankan migration SEBELUM app start. Update `startCommand` di
`railway.toml`:

```toml
[deploy]
startCommand = "cd backend && alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT"
```

Untuk DB existing yg sudah dibuat lewat `create_all` (bukan Alembic),
stamp baseline dulu satu kali sebelum upgrade ke migration berikutnya:

```bash
DATABASE_URL="$RAILWAY_DB_URL" alembic stamp d05180aff149
```

(SHA `d05180aff149` = revision id baseline; cek file di
`versions/` kalau berbeda.)

## Rollback

```bash
alembic downgrade -1       # turun 1 step
alembic downgrade <rev>    # ke revision tertentu
alembic downgrade base     # rollback semua
```

## Coexistence dgn `create_all` + `_sync_pg_columns`

Saat ini lifespan still call `create_all` (idempotent — tidak
overwrite tabel ada) + `_sync_pg_columns` (ALTER TABLE additions for
legacy DBs).

Strategi transisi:
1. Phase 1 (sekarang): Alembic available, prod tetap pakai `create_all`
   + `_sync_pg_columns`. Setiap perubahan model di-cover oleh BOTH
   migration baru DAN `_sync_pg_columns` patch.
2. Phase 2 (setelah verifikasi): hapus `create_all` di prod lifespan,
   pure Alembic.
3. Phase 3: hapus `_sync_pg_columns` setelah semua DB prod stamped &
   migrated ke clean state.
