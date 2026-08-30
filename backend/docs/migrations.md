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

## Workflow prod (Railway) — SUDAH OTOMATIS sejak 2026-06-13

Migrasi dijalankan `docker-entrypoint.sh` sebelum uvicorn, lewat
`python -m app.bootstrap_db`. Tidak ada langkah manual.

`bootstrap_db.py` menangani tiga keadaan:

1. **DB kosong** -> `alembic upgrade head` (rantai penuh).
2. **DB lama tanpa `alembic_version`** -> `alembic stamp head`, TANPA
   DDL dan tanpa menyentuh data. Ini kasus DB produksi yang selama ini
   dikelola `create_all`: strukturnya sudah setara head, jadi
   meng-`upgrade` dari baseline justru gagal (DuplicateColumn /
   DuplicateTable) di langkah pertama.
3. **DB sudah ter-stamp** -> `alembic upgrade head` seperti biasa.

Baca komentar di `app/bootstrap_db.py` untuk daftar data migration yang
sengaja dilewati pada jalur (2) beserta alasannya.

Kalau migrasi gagal, container exit non-zero -> deploy Railway ditandai
gagal dan versi lama tetap melayani.

<details>
<summary>Cara lama (sudah tidak dipakai)</summary>

Dulu instruksinya: update `startCommand` di `railway.toml` secara
manual. Itu tidak pernah dikerjakan, sehingga selama berbulan-bulan
20 migrasi ada di repo tapi tidak pernah jalan (audit 2026-06-13 #D-01).

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

</details>

## Setelah menambah migrasi baru

Tidak ada langkah deploy tambahan -- push ke `main` sudah cukup. Yang
perlu diperhatikan hanya satu: `Base.metadata.create_all` MASIH
dipanggil di `app/main.py` sebagai jaring pengaman. Urutannya aman
(alembic jalan di entrypoint, sebelum app start), tapi artinya perubahan
model TANPA migrasi tetap akan diam-diam terbentuk oleh `create_all` dan
membuat DB melenceng dari riwayat Alembic.

Jadi: **selalu buat migrasi untuk tiap perubahan model.** Rencana
berikutnya adalah menghapus `create_all` sepenuhnya setelah satu-dua
rilis berjalan lancar dengan Alembic.
