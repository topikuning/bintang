# Deploy Bintang ke Railway

Panduan rinci untuk men-deploy aplikasi **Bintang** di [Railway](https://railway.app).
Stack: FastAPI (backend) + Vite/React PWA (frontend) + PostgreSQL + Volume persistent untuk uploads.

---

## Arsitektur deploy

```
┌─────────────────────────────────────────────────────────────┐
│                    Railway Project: bintang                 │
│                                                             │
│   ┌──────────────┐    ┌──────────────┐   ┌──────────────┐  │
│   │  postgres    │    │   backend    │   │  frontend    │  │
│   │  (database)  │◄───┤  (FastAPI)   │◄──┤  (nginx)     │  │
│   │              │    │  /data vol   │   │              │  │
│   └──────────────┘    └──────────────┘   └──────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

3 service Railway:
1. **postgres** — PostgreSQL plugin (otomatis Railway).
2. **backend** — FastAPI di `/backend`, expose port 8000.
3. **frontend** — Vite build → nginx, expose port 80.

---

## Persiapan

### Yang Anda butuhkan
- Akun [Railway.app](https://railway.app) (free tier sudah cukup untuk uji coba).
- Repository di GitHub yang sudah berisi project ini, branch `claude/multi-project-finance-app-Gn3rz` (atau merge ke `main`).
- Railway CLI (opsional, untuk debug): `npm i -g @railway/cli`.

### Estimasi biaya
- Free trial: $5 credit/bulan, biasanya cukup untuk demo.
- Production: ~$5–15/bulan tergantung traffic, tergantung plan Railway.

---

## Langkah 1 — Buat project Railway

1. Login ke [railway.app](https://railway.app).
2. **New Project** → **Deploy from GitHub repo** → pilih repo Bintang.
3. Railway otomatis mendeteksi monorepo. Kita akan setup 3 service manual berikutnya.

> Tip: kalau Railway tanpa sengaja membuat 1 service umum, hapus. Kita atur sendiri per direktori.

---

## Langkah 2 — Tambah PostgreSQL

1. Di project, klik **+ New** → **Database** → **Add PostgreSQL**.
2. Tunggu sampai status hijau. Klik service Postgres → tab **Variables** → catat `DATABASE_URL` (format `postgresql://user:pass@host:port/db`).
3. Bintang butuh driver async: ubah prefiks ke `postgresql+asyncpg://...` saat menyalin ke env backend.

---

## Langkah 3 — Service Backend (FastAPI)

### 3a. Tambah service
1. **+ New** → **GitHub Repo** → pilih repo yang sama → **Add a service**.
2. Beri nama: `bintang-backend`.
3. Tab **Settings** → **Source** → **Root Directory**: isi `backend`.
4. Tab **Settings** → **Build**:
   - **Builder**: `Dockerfile` (Railway akan pakai `backend/Dockerfile` yang sudah disiapkan).
5. Tab **Settings** → **Deploy**:
   - **Start Command**: kosongkan (Dockerfile sudah set CMD `uvicorn app.main:app ...`).
   - **Healthcheck Path**: `/health`.
   - **Port**: `8000` (ikuti `EXPOSE` di Dockerfile).

### 3b. Volume untuk uploads
1. Tab **Settings** → scroll ke **Volumes** → **+ New Volume**.
2. **Mount Path**: `/data`.
3. Size: 5–10 GB (sesuaikan kebutuhan).

> Sudah cocok dengan `Dockerfile` kita: `UPLOAD_DIR=/data/uploads`, dan dibuat otomatis saat startup.

### 3c. Variabel lingkungan (Variables)

| Key | Value |
|---|---|
| `APP_ENV` | `prod` |
| `SECRET_KEY` | string acak ≥32 karakter (generate via `python -c "import secrets;print(secrets.token_urlsafe(48))"`) |
| `DATABASE_URL` | `postgresql+asyncpg://...` (salin dari postgres service, ganti prefiks) |
| `UPLOAD_DIR` | `/data/uploads` |
| `MAX_UPLOAD_MB` | `20` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `720` |
| `ALLOWED_ORIGINS` | `https://<frontend-domain-nanti>` (isi setelah frontend punya domain, lihat langkah 4) |

> **Catatan referensi DATABASE_URL**: Railway menyediakan placeholder `${{Postgres.DATABASE_URL}}`. Pakai itu agar otomatis ter-update kalau pass berubah. Tapi defaultnya `postgresql://`, tambahkan `+asyncpg` manual.

Contoh value:
```
postgresql+asyncpg://${{Postgres.PGUSER}}:${{Postgres.PGPASSWORD}}@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}
```

### 3d. Public domain
1. Tab **Settings** → **Networking** → **Generate Domain**.
2. Catat URL, mis: `https://bintang-backend-production.up.railway.app`.

### 3e. Init schema + seed
Railway tidak punya UI exec. Pakai Railway CLI:

```bash
railway login
railway link              # pilih project & service bintang-backend
railway run python -m app.seed_master   # clean install (admin + 12 kategori)
# atau:
railway run python -m app.seed          # demo dataset lengkap
```

> `seed_master` = 1 superadmin + 12 kategori default. **WAJIB ganti password** lewat menu Pengguna setelah login pertama.

---

## Langkah 4 — Service Frontend (Vite + nginx)

### 4a. Tambah service
1. **+ New** → **GitHub Repo** → pilih repo yang sama.
2. Nama: `bintang-frontend`.
3. **Settings** → **Source** → **Root Directory**: `frontend`.
4. **Settings** → **Build**:
   - **Builder**: `Dockerfile`.
   - **Build Args**: tambah `VITE_API_BASE_URL` = `https://<backend-domain>/api/v1` (URL dari langkah 3d).
5. **Settings** → **Deploy** → **Port**: `80`.

### 4b. Public domain
1. **Settings** → **Networking** → **Generate Domain**.
2. Catat URL, mis: `https://bintang-production.up.railway.app`.

### 4c. Update CORS backend
Kembali ke service `bintang-backend` → tab **Variables** → set `ALLOWED_ORIGINS` ke domain frontend. Contoh:
```
ALLOWED_ORIGINS=https://bintang-production.up.railway.app
```
Save → backend akan otomatis re-deploy.

### 4d. Sesuaikan nginx (opsional)
Default `frontend/nginx.conf` proxy `/api/` ke `http://backend:8000` (untuk docker-compose lokal). Di Railway, frontend & backend punya domain berbeda — frontend langsung memanggil backend lewat URL absolut karena `VITE_API_BASE_URL` sudah di-bake di build time.

Jika Anda mau frontend dan backend di **satu domain** (no CORS), gunakan Railway custom domain + reverse proxy. Tapi paling simpel: dua domain berbeda.

---

## Langkah 5 — Verifikasi

1. Buka domain frontend di browser.
2. Login: `admin@bintang.me` / `admin123`.
3. **WAJIB**: lewat menu **Lainnya → Pengguna**, buat akun admin baru dengan password kuat, lalu nonaktifkan/hapus akun default ATAU minimal ganti passwordnya.
4. Cek Swagger backend: `https://<backend-domain>/docs`.

---

## Langkah 6 — Setup pemakaian harian

### Update kode
Setiap push ke branch yang di-track (atau `main`), Railway otomatis rebuild & redeploy backend dan/atau frontend (sesuai folder yang berubah).

### Database migration
Saat ini schema dibuat lewat `Base.metadata.create_all` di startup (lifespan). Kalau ada perubahan schema breaking:
1. **Best**: pakai Alembic. Project sudah include `alembic` di deps. Generate migration & jalankan via `railway run alembic upgrade head`.
2. **Dev shortcut** (tidak direkomendasikan untuk prod yang sudah ada data): `railway run python -c "import asyncio; from app.db.base import Base; from app.db.session import engine; asyncio.run(engine.begin().__aenter__()); ..."`.

### Backup database
1. Di service Postgres, klik **Data** → **Backups** → **Create Backup**.
2. Atau pakai pg_dump:
   ```bash
   railway run --service Postgres pg_dump $DATABASE_URL > backup.sql
   ```

### Backup uploads
Volume di-mount di `/data/uploads`. Untuk backup:
```bash
railway run --service bintang-backend tar czf - /data/uploads > uploads-backup.tgz
```

---

## Variabel lingkungan ringkasan

### Backend
```
APP_ENV=prod
SECRET_KEY=<random 48+ chars>
DATABASE_URL=postgresql+asyncpg://...
UPLOAD_DIR=/data/uploads
MAX_UPLOAD_MB=20
ACCESS_TOKEN_EXPIRE_MINUTES=720
ALLOWED_ORIGINS=https://your-frontend-domain.up.railway.app
```

### Frontend (build args, bukan runtime)
```
VITE_API_BASE_URL=https://your-backend-domain.up.railway.app/api/v1
```

---

## Troubleshooting

### Backend gagal start dengan `module not found`
Biasanya path mount salah. Pastikan **Root Directory** = `backend` dan Dockerfile di-detect.

### `connection refused` ke Postgres
- Cek `DATABASE_URL` pakai prefiks `postgresql+asyncpg://` (bukan `postgresql://`).
- Pastikan service Postgres sudah running (status hijau).

### Frontend bisa load tapi login 404
- Cek **Networking** frontend & backend punya domain berbeda.
- Cek build arg `VITE_API_BASE_URL` sudah benar (lihat di tab **Settings → Build**).
- Kalau ubah build arg, Railway tidak otomatis rebuild — klik **Redeploy**.

### CORS error di console
- Update `ALLOWED_ORIGINS` di backend ke domain frontend persis (https + tanpa trailing slash).

### Upload gagal "413 Request Entity Too Large"
- Naikkan `MAX_UPLOAD_MB` di backend env.
- Railway proxy default punya batas ~10 MB; jika perlu lebih besar, gunakan storage external (S3/R2/Drive — lihat roadmap).

### Volume penuh
Resize volume via Settings, atau pindah storage ke S3-compatible.

---

## Setelah deploy berhasil

- Update README.md hardcoded credential agar tidak jadi backdoor.
- Aktifkan rate-limit / WAF kalau exposed publik (Cloudflare di depan Railway domain).
- Set jadwal backup mingguan.
- Pertimbangkan custom domain: **Settings → Networking → Custom Domain** → tambah DNS CNAME ke Railway.

Selesai. Kalau menemui error spesifik selama deploy, kirim log Railway-nya.
