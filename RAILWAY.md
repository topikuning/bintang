# Deploy Bintang ke Railway

Panduan rinci deploy ke [Railway](https://railway.com) per **April 2026**.
Stack: FastAPI + Vite/React PWA + PostgreSQL + Volume persistent untuk uploads.

> **Penting tentang seed**: kesalahan klasik adalah memakai `railway run python ...`.
> Itu menjalankan command **secara LOKAL** dengan env vars Railway ter-inject —
> bukan masuk ke container. Untuk seed kita pakai `railway ssh` (eksekusi di
> dalam container yang sudah di-deploy). Lihat **Langkah 6**.

---

## 0. Yang dibutuhkan

- Akun [railway.com](https://railway.com).
- Repository di GitHub berisi project ini (branch `claude/multi-project-finance-app-Gn3rz` atau `main`).
- **Railway CLI** (wajib untuk seed): `npm i -g @railway/cli` atau `brew install railway`.
- Login CLI: `railway login`.

Estimasi biaya: ~$5–15/bulan tergantung traffic. Trial $5 cukup untuk uji coba.

---

## 1. Bikin project di Railway

1. Login → **New Project** → **Deploy from GitHub repo** → pilih repo Bintang.
2. Railway akan stage 1 service. **Hapus dulu** karena kita atur sendiri 3 service di langkah-langkah berikut.

---

## 2. Tambahkan PostgreSQL

1. Di canvas project, tekan **⌘K** (atau **Ctrl+K**) untuk Command Palette → **Database** → **PostgreSQL**.
2. Tunggu sampai service Postgres aktif (status hijau).
3. Klik service Postgres → tab **Variables** → catat `DATABASE_URL` Railway. Variable yang akan kita pakai sebagai reference di service backend:
   - `${{Postgres.DATABASE_URL}}` — URL lengkap (perlu kita prefix `+asyncpg`).

---

## 3. Service Backend (FastAPI)

### 3a. Bikin service
1. **⌘K** → **GitHub Repo** → pilih repo yang sama → **Add Service**.
2. Setelah service ter-create, klik service-nya → tab **Settings**:
   - **Service Name**: `bintang-backend`
   - **Root Directory**: `backend`
   - **Watch Paths** (opsional, agar redeploy hanya saat backend berubah):
     ```
     backend/**
     ```

### 3b. Build & deploy
File `backend/railway.toml` sudah disiapkan, jadi Railway otomatis tahu:
- Builder: `DOCKERFILE`
- Start command: `uvicorn ... --port $PORT`
- Healthcheck: `/health`

Tidak perlu set manual di UI.

### 3c. Volume untuk uploads
Volume **wajib di-mount sebelum deploy pertama** supaya direktori upload persist.

**Via UI:**
1. Klik service → **⌘K** dengan service ter-fokus → **Add Volume** (atau klik kanan service → **Add Volume**).
2. **Mount Path**: `/data`
3. Size: 5 GB awalnya (bisa di-resize live tanpa downtime nanti).

**Atau via CLI:**
```bash
railway link            # pilih project & service bintang-backend
railway volume add
# prompt: Mount Path → /data
```

Volume otomatis follow region service. Bintang menulis ke `/data/uploads`
(sesuai env `UPLOAD_DIR=/data/uploads` di Dockerfile).

> **Catatan**: data yang ditulis ke direktori volume saat **build time** TIDAK
> akan persist — volume baru di-attach saat container start. Bintang
> membuat folder `uploads/` saat startup, jadi aman.

### 3d. Variabel lingkungan

Tab **Variables** → **+ New Variable**:

| Key | Value |
|---|---|
| `APP_ENV` | `prod` |
| `SECRET_KEY` | string random ≥32 char |
| `DATABASE_URL` | `postgresql+asyncpg://${{Postgres.PGUSER}}:${{Postgres.PGPASSWORD}}@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}` |
| `UPLOAD_DIR` | `/data/uploads` |
| `MAX_UPLOAD_MB` | `20` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `720` |
| `ALLOWED_ORIGINS` | (isi nanti di Langkah 5 setelah frontend punya domain) |

Generate `SECRET_KEY` di terminal lokal:
```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

> **Kenapa harus `+asyncpg`**: SQLAlchemy 2 yang kita pakai mode async,
> butuh driver `asyncpg`. Default `${{Postgres.DATABASE_URL}}` Railway
> menghasilkan prefiks `postgresql://` yang sync (psycopg). Salah prefiks
> = backend crash saat startup.

> Railway juga auto-inject `PORT` ke service. Backend Bintang sudah
> bind ke `${PORT}` (dari `railway.toml`).

### 3e. Public domain
1. **Settings** → **Networking** → **Public Networking** → **Generate Domain**.
2. Catat URL, mis: `https://bintang-backend-production.up.railway.app`.
3. Cek health: buka `<url>/health` di browser → harus respond `{"status":"ok"}`.

---

## 4. Service Frontend (Vite + nginx)

### 4a. Bikin service
1. **⌘K** → **GitHub Repo** → pilih repo yang sama → **Add Service**.
2. **Settings**:
   - **Service Name**: `bintang-frontend`
   - **Root Directory**: `frontend`
   - **Watch Paths**: `frontend/**`

### 4b. Build args
Frontend perlu tahu URL backend di **build time** (Vite menyimpan env var
ke bundle JS). Settings → **Build** → **Build Args** (atau tambahkan
sebagai Variable kalau Railway memperlakukan build args sebagai env var
saat build):

| Key | Value |
|---|---|
| `VITE_API_BASE_URL` | `https://<backend-domain>/api/v1` (URL dari 3e) |

> Setiap kali ubah `VITE_API_BASE_URL`, **klik Redeploy** secara manual.
> Railway tidak rebuild otomatis hanya karena variable berubah.

### 4c. Public domain
**Settings → Networking → Generate Domain**. Catat URL, mis: `https://bintang-production.up.railway.app`.

---

## 5. Update CORS di backend

Kembali ke service `bintang-backend` → **Variables** → set:
```
ALLOWED_ORIGINS=https://bintang-production.up.railway.app
```
(persis, https + tanpa trailing slash; pisahkan koma kalau lebih dari satu domain).

Save → backend auto-redeploy.

---

## 6. Init schema + seed (yang gagal sebelumnya)

Schema otomatis dibuat saat backend pertama kali start (lifespan event
`Base.metadata.create_all`). Tapi kita masih perlu seed superadmin +
kategori default.

**JANGAN pakai `railway run`** — itu menjalankan command di mesin lokal Anda
dengan env Railway ter-inject. Itulah penyebab error
`No such file or directory (os error 2)`: command `python` atau path
`app.seed_master` tidak ada di mesin lokal.

**Pakai `railway ssh`** (eksekusi di dalam container yang sudah running):

```bash
# 1. login & link project
railway login
railway link
# pilih project, environment (production), dan service bintang-backend

# 2. eksekusi seed di dalam container
railway ssh python -m app.seed_master
# clean install: 1 superadmin + 12 kategori default

# atau demo data lengkap:
railway ssh python -m app.seed
```

> Catatan: `railway ssh` Railway tidak pakai protokol SSH biasa — pakai
> websocket. Tetap aman untuk command interaktif maupun one-off.

Alternatif via dashboard (hanya kalau CLI bermasalah):
1. Klik service backend → kanan-atas ada ikon terminal **"Open Shell"**.
2. Ketik: `python -m app.seed_master`.

Setelah seed sukses → buka frontend → login `admin@bintang.me` / `admin123`
→ **WAJIB ganti password** lewat menu Pengguna.

---

## 7. Verifikasi

| Cek | URL / langkah |
|---|---|
| Backend live | `https://<backend-domain>/health` → `{"status":"ok"}` |
| Swagger | `https://<backend-domain>/docs` |
| Frontend | `https://<frontend-domain>` |
| Login | `admin@bintang.me` / `admin123` |
| Volume bekerja | upload bukti transaksi → reload halaman → preview tetap muncul |
| Postgres connect | login & lihat halaman Beranda; data dashboard berarti DB OK |

---

## 8. Operasional

### Update kode
Push ke branch yang di-track Railway = otomatis rebuild & redeploy.
Watch Paths memastikan hanya service yang relevan yang ter-redeploy.

### Backup database
Service Postgres → **Data** tab → **Backups** → **Create Backup** (Railway juga
ada scheduled backup di plan Pro).

Atau manual via CLI:
```bash
railway link    # link ke service Postgres
railway ssh "pg_dump $DATABASE_URL" > backup.sql
```

### Backup uploads
```bash
railway link    # link ke service bintang-backend
railway ssh "tar czf - /data/uploads" > uploads-backup.tgz
```

### Resize volume
Settings → Volumes → ubah size. Live, tanpa downtime — filesystem
auto-extend.

### Custom domain
Settings → Networking → **Custom Domain** → tambah domain → ikuti
instruksi DNS (CNAME ke target Railway).

---

## 9. Troubleshooting

### `No such file or directory (os error 2)` saat seed
Pakai `railway ssh python -m app.seed_master`, **bukan** `railway run`.
Lihat Langkah 6.

### Backend crash di startup, log: `connection refused` atau `module asyncpg not found`
- Cek `DATABASE_URL` benar-benar pakai prefiks `postgresql+asyncpg://`.
- Variabel ter-resolve atau masih literal? Cek **Service Variables → Resolved**.

### Backend tidak respond / port salah
- Cek log apakah uvicorn listen di `0.0.0.0:$PORT` (bukan 8000).
- Pastikan `railway.toml` di-pickup (tab **Deployments** → klik latest → **Deploy Logs**).

### Frontend bisa load tapi semua API gagal
- Buka DevTools → Network → cek URL request. Harus mengarah ke domain backend, bukan `/api/v1` relatif.
- Kalau salah, ubah `VITE_API_BASE_URL` di Variables → klik **Redeploy** manual.

### CORS error di console browser
- Pastikan `ALLOWED_ORIGINS` di backend sesuai dengan domain frontend persis (https + tanpa slash di akhir).

### Upload `413 Request Entity Too Large`
- Naikkan `MAX_UPLOAD_MB` di backend.
- Railway proxy default support file besar; kalau butuh > 50 MB pertimbangkan storage external (S3/R2/Drive — lihat roadmap).

### Volume kosong setelah redeploy
- Pastikan mount path `/data` (bukan `/data/uploads` langsung).
- Jangan tulis ke `/data` saat build time — hanya di runtime.

### Healthcheck gagal terus
- Buka backend domain `/health` di browser. Kalau 502 dari Railway, kemungkinan service belum listen di `$PORT`.
- Buka **Deploy Logs** untuk lihat startup error.

---

## 10. Setelah deploy live

- [ ] Ganti password superadmin default.
- [ ] Tambah Cloudflare di depan domain (rate-limit, WAF, cache statis).
- [ ] Aktifkan scheduled backup Postgres.
- [ ] Atur jadwal `tar` uploads ke storage external (cron via service kecil atau dari laptop).
- [ ] Set `APP_ENV=prod` (sudah).
- [ ] Audit log siapa-melakukan-apa via menu Lainnya → Audit Log.

Kalau kena error spesifik: kirim 20 baris terakhir dari **Deploy Logs**
service yang error, saya bantu diagnosis.

---

## Sumber

- [Railway Docs — Volumes](https://docs.railway.com/reference/volumes)
- [Railway Docs — railway ssh](https://docs.railway.com/cli/ssh)
- [Railway Docs — railway run](https://docs.railway.com/cli/run) (untuk eksekusi LOKAL dengan env Railway)
- [Railway Docs — Monorepo](https://docs.railway.com/guides/monorepo)
- [Railway Docs — Build Configuration](https://docs.railway.com/builds/build-configuration)
