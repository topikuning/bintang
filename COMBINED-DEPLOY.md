# Deploy 1-Service di Railway (Backend + Frontend dalam 1 image)

> **Branch ini terpisah dari `main`.** Jangan merge sampai test di Railway selesai.
>
> **TIDAK** memengaruhi service Railway eksisting (`bintang-backend`,
> `bintang-frontend`, `Postgres`, `WAHA`). File ini menambah opsi baru,
> bukan mengganti yang lama.

## Apa yang berubah di branch ini

| File | Status |
|---|---|
| `Dockerfile` (root) | **Baru** — multi-stage: build FE (Vite) + backend (FastAPI), hasilkan 1 image |
| `railway.toml` (root) | **Baru** — config Railway untuk service combined |
| `backend/app/main.py` | **Diubah** — tambah SPA serving conditional di akhir, gated env `STATIC_DIR`. Default off → behavior identik dengan deploy multi-service. |
| `COMBINED-DEPLOY.md` | **Baru** — dokumen ini |
| `backend/Dockerfile`, `backend/railway.toml`, `frontend-v2/Dockerfile`, `frontend-v2/railway.toml` | **TIDAK disentuh** — service eksisting tetap jalan apa adanya |

## Setup di Railway (manual)

Lakukan di project Railway yang sama dengan service eksisting (`bintang-backend`, `bintang-frontend`, `Postgres`).

### 1. Bikin service baru (sementara, untuk test)

1. **⌘K** → **GitHub Repo** → pilih `topikuning/bintang`.
2. Setelah service ter-create, klik service → tab **Settings**:
   - **Service Name**: `bintang-combined-test`
   - **Root Directory**: `/` (root repo, bukan subfolder)
   - **Branch**: `claude/combined-service-deploy`
   - **Watch Paths**: kosongkan (deploy setiap push ke branch)
3. Builder otomatis pakai `Dockerfile` di root + `railway.toml` di root.

### 2. Tambah volume

- Klik service → **Add Volume** (atau via CLI: `railway volume add`).
- **Mount Path**: `/data`
- Size: 1 GB cukup untuk test.

> Volume baru ini **terpisah** dari volume backend eksisting. Upload yang dibuat
> di service test tidak muncul di service production, dan sebaliknya. Untuk
> test full data, lihat opsi #5 di bawah.

### 3. Variabel lingkungan

Tab **Variables** → set minimal:

| Key | Value | Catatan |
|---|---|---|
| `APP_ENV` | `prod` | Sama dengan production. |
| `SECRET_KEY` | string random ≥32 char | **Generate baru**, jangan pakai dari service eksisting. |
| `DATABASE_URL` | `postgresql+asyncpg://${{Postgres.PGUSER}}:${{Postgres.PGPASSWORD}}@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}` | **Hati-hati**: kalau pakai DB Postgres production yang sama, login + data shared dengan service eksisting (OK untuk smoke test, tapi hindari operasi destruktif). |
| `UPLOAD_DIR` | `/data/uploads` | Sudah default di Dockerfile, tapi explicit lebih aman. |
| `STATIC_DIR` | `/app/static` | Sudah default di Dockerfile. Penting: ini env yang trigger SPA serving. |
| `MAX_UPLOAD_MB` | `20` | Sama dengan production. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `720` | Sama. |
| `ALLOWED_ORIGINS` | (kosong atau isi `https://proyek.cvbintang.com` dst) | Tidak relevan karena same-origin, tapi set kalau ada tools eksternal yang call API. |
| `APP_DATA_ENCRYPTION_KEY` | sama dengan production (kalau di-set) | Supaya secret yang sudah encrypted di DB bisa dibaca. Kalau test pakai DB baru, generate baru. |

Generate `SECRET_KEY`:
```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

### 4. Public domain

- **Settings** → **Networking** → **Generate Domain**.
- Akan dapat URL `https://bintang-combined-test-xxxxx.up.railway.app`.
- Healthcheck `/health` harus respond `{"status":"ok"}` setelah ~1 menit (deploy first time lebih lama karena build FE).

### 5. Test

Buka URL di browser:

| Test | Ekspektasi |
|---|---|
| `/` (root) | SPA load — halaman Login muncul |
| `/health` | `{"status":"ok","app":"Bintang"}` |
| `/api/v1/auth/login` (POST) | Login standar |
| `/docs` | Swagger UI |
| Setelah login: navigate `/transactions` | SPA fallback ke `index.html`, React Router handle route |
| Buka `/files/xxx.pdf` (kalau ada uploads) | Volume baru = belum ada file. Upload baru dulu via form. |

## Migrasi DNS (saat siap ganti permanen)

Setelah verify service combined jalan stabil 1-2 hari:

1. **Cloudflare/DNS provider** → ubah CNAME `proyek.cvbintang.com` dari frontend service ke `bintang-combined-test`.
2. Tunggu DNS propagation (TTL biasanya 5 menit).
3. Hapus service `bintang-frontend` dan `bintang-backend` (atau pause dulu beberapa hari).
4. **Custom domain di Railway**: pindahkan custom domain `proyek.cvbintang.com` dari service FE lama ke service combined.

> **Jangan langsung hapus FE service lama** — kalau ada issue, balik DNS ke service lama.

## Cara revert (kalau perlu balik ke multi-service)

Branch ini tidak di-merge ke main, jadi:

- **Service combined**: cukup pause/delete service di Railway.
- **DNS**: balikkan CNAME ke frontend service lama.
- **No code revert needed** — main tetap multi-service.

## Konsumsi sumber daya

| Aspek | Multi-service (sekarang) | Combined (branch ini) |
|---|---|---|
| Service count | 4 (BE, FE, DB, WAHA) | 3 (Combined, DB, WAHA) |
| Memory | BE ~150MB + FE nginx ~10MB | Combined ~160MB |
| Build time | BE ~30s, FE ~60s parallel | ~100s sequential (build FE lalu BE) |
| CORS config | Wajib | Tidak relevan (same-origin) |
| FE chunk hash mismatch | Mungkin (race deploy) | Tidak (atomic) |
| Hobby plan cost | Lebih tinggi (4 service) | Lebih rendah (3 service) |

## Catatan teknis

- **SPA cache strategy**: `index.html` no-cache, `/assets/*` served by FastAPI StaticFiles (default 1 hour cache). Vite hash-name file di `/assets/` → safe untuk long cache.
- **`/files/*`**: serve dari volume `/data/uploads` (sama seperti backend eksisting).
- **Routing priority**: FastAPI match exact route dulu (`/api/v1/*`, `/files/*`, `/health`, `/docs`, `/openapi.json`, `/redoc`), catch-all `/{full_path:path}` paling akhir. Aman.
- **Database**: schema bootstrap (`create_all` + `_sync_pg_columns`) tetap jalan di lifespan. Kalau pakai DB production, idempoten — tidak akan rusak data.
