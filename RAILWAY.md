# Deploy Bintang ke Railway

Panduan ini memakai **dua service**: PostgreSQL dan satu service aplikasi
yang menyajikan SPA sekaligus API.

> **Berubah sejak 2026-06-13.** Dulu ada tiga service (Postgres + backend
> FastAPI + frontend nginx). Sekarang `Dockerfile` di root mem-build SPA
> lalu menyalinnya ke dalam image backend, jadi frontend bukan lagi
> service terpisah. Kalau project Railway Anda masih punya service
> `bintang-frontend`, lihat [Migrasi dari 3 service](#migrasi-dari-3-service)
> di bawah.

---

## 0. Yang dibutuhkan

- Akun Railway (Hobby plan sudah cukup).
- Repo ini sudah ada di GitHub.
- `SECRET_KEY` acak. Generate:
  ```bash
  python -c 'import secrets; print(secrets.token_urlsafe(48))'
  ```
  Nilai ini juga jadi kunci enkripsi untuk secret yang disimpan di DB
  (API key OCR, token bot). **Menggantinya membuat semua secret
  tersimpan tidak terbaca** dan harus diisi ulang lewat UI.

---

## 1. Bikin project di Railway

1. Dashboard Railway → **New Project** → **Deploy from GitHub repo**.
2. Pilih repo `bintang`.
3. Railway akan membuat satu service otomatis — kita atur di langkah 3.

---

## 2. Tambahkan PostgreSQL

1. Di dalam project → **New** → **Database** → **Add PostgreSQL**.
2. Railway menyediakan variabel `DATABASE_URL` di service Postgres.
   Formatnya `postgresql://...`; aplikasi butuh driver async, jadi di
   service aplikasi kita tulis ulang jadi `postgresql+asyncpg://...`
   (lihat langkah 3c).

---

## 3. Service aplikasi (SPA + API)

### 3a. Bikin service

1. **New** → **GitHub Repo** → pilih repo yang sama.
2. Settings → **Root Directory**: kosongkan / isi `/`
   — **root repo**, bukan `backend` dan bukan `frontend-v2`.
   `Dockerfile` di root yang mem-build keduanya.
3. Settings → **Watch Paths**: kosongkan (perubahan di backend maupun
   frontend sama-sama harus memicu build ulang).

### 3b. Build & deploy

`railway.toml` di root sudah menetapkan builder Dockerfile dan
healthcheck `/health`. Tidak ada `startCommand`: `ENTRYPOINT` image yang
menjalankan migrasi lalu uvicorn.

**Migrasi jalan otomatis.** `docker-entrypoint.sh` memanggil
`python -m app.bootstrap_db` sebelum uvicorn. Kalau migrasi gagal,
container berhenti dan deploy ditandai gagal — versi lama tetap
melayani, bukannya naik dengan schema setengah jadi.

### 3c. Volume untuk uploads

Lampiran disimpan di filesystem. Tanpa volume, semuanya hilang tiap
deploy.

1. Service aplikasi → tab **Volumes** → **New Volume**.
2. Mount Path: `/data`
3. Ukuran awal 5 GB sudah cukup untuk puluhan ribu bukti transaksi
   (gambar di-resize maksimal 2000px dan dikompres saat upload).

### 3d. Variabel lingkungan

Set di service aplikasi:

| Variabel | Nilai |
| --- | --- |
| `APP_ENV` | `prod` |
| `SECRET_KEY` | hasil generate di langkah 0 |
| `DATABASE_URL` | `postgresql+asyncpg://${{Postgres.PGUSER}}:${{Postgres.PGPASSWORD}}@${{Postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/${{Postgres.PGDATABASE}}` |
| `UPLOAD_DIR` | `/data/uploads` |
| `TRUSTED_PROXY_HOPS` | `1` |
| `ALLOWED_ORIGINS` | **tidak perlu di-set** (default sudah kosong) |
| `PUBLIC_BASE_URL` | isi setelah domain jadi (langkah 3e) |

Catatan penting:

- **`ALLOWED_ORIGINS` sengaja kosong**, dan defaultnya memang sudah
  kosong — jadi variabel ini tidak perlu ditambahkan sama sekali. SPA
  dan API satu origin, tidak ada request lintas-origin yang perlu
  diizinkan. Kalau environment lama masih membawa nilai berisi
  `localhost`, entri itu diabaikan otomatis (dengan peringatan di log)
  dan **tidak** menggagalkan boot.
- **`TRUSTED_PROXY_HOPS=1`** karena Railway menaruh satu edge proxy di
  depan aplikasi. Nilai ini menentukan bagaimana `X-Forwarded-For`
  dibaca saat rate-limit login; kalau salah, batas login bisa dilewati
  dengan header palsu.
- Aplikasi **menolak boot** di `APP_ENV=prod` kalau `SECRET_KEY` masih
  default/terlalu pendek, `ALLOWED_ORIGINS` berisi `*`, atau integrasi
  bot aktif tanpa webhook secret. Pesannya diawali `REFUSE_BOOT:` di
  deploy log. (Entri `localhost` TIDAK menggagalkan boot — hanya
  diabaikan.)

### 3e. Public domain

1. Service aplikasi → **Settings** → **Networking** → **Generate Domain**.
2. **Target port: `8000`.**

> **PALING SERING SALAH DI SINI.** Kalau service ini sebelumnya
> menjalankan frontend nginx, target port-nya masih tersimpan `80`.
> Mengubah Root Directory TIDAK ikut mengubahnya. Gejalanya: 502
> `connection refused` di semua path — **termasuk `/health`** — padahal
> log deploy menunjukkan `[entrypoint] menjalankan uvicorn di port 8000`
> dan tidak ada error sama sekali.
>
> Cara cepat memastikan: kalau `/health` ikut 502, itu bukan bug
> aplikasi. Endpoint itu tidak menyentuh database maupun autentikasi,
> jadi selama uvicorn hidup ia SELALU menjawab 200.
3. Salin domainnya, lalu set `PUBLIC_BASE_URL` ke URL itu (dipakai untuk
   registrasi webhook Telegram/WAHA). Redeploy setelah mengisinya.

Domain ini menyajikan aplikasi **dan** API:

- `https://<domain>/` → SPA
- `https://<domain>/api/v1/...` → API
- `https://<domain>/docs` → Swagger

---

## 4. Init schema + seed

Schema sudah dibuat migrasi saat deploy pertama. Tinggal isi data awal:

```bash
# 1. login & link project
railway login
railway link
# pilih project, environment (production), dan service aplikasi

# 2. eksekusi seed di dalam container
# clean install: 1 superadmin + 12 kategori default
railway run python -m app.seed_master

# atau demo data lengkap (3 perusahaan, 5 proyek, 30+ transaksi):
railway run python -m app.seed
```

Setelah seed sukses → buka domain → login `admin@bintang.me` / `admin123`.
**Ganti password default itu sebelum dipakai sungguhan.**

---

## 5. Verifikasi

| Cek | Cara |
| --- | --- |
| Aplikasi hidup | buka `https://<domain>/` — SPA muncul |
| API hidup | `https://<domain>/health` → `{"status":"ok"}` |
| Migrasi jalan | deploy log memuat `[bootstrap_db] schema up to date.` |
| Refresh route dalam | buka `https://<domain>/transactions` langsung — tidak 404 |
| Lampiran terlindungi | buka URL `/files/...` di jendela penyamaran → **401**, bukan gambar |
| Upload persist | upload bukti, redeploy, pastikan gambarnya masih ada |

Cek lampiran itu penting: sebelum 2026-06-13, `/files/*` terbuka untuk
siapa pun tanpa login. Kalau di jendela penyamaran gambarnya tetap
muncul, berarti versi lama yang sedang jalan.

---

## Migrasi dari 3 service

Kalau project Railway Anda dibuat sebelum perubahan ini:

1. Ubah **Root Directory** service backend dari `backend` menjadi `/`
   (root repo), lalu redeploy. Sekarang ia menyajikan SPA juga.
2. Pindahkan domain publik dari service frontend ke service ini
   (atau generate domain baru dan perbarui bookmark/tautan).
3. Hapus `ALLOWED_ORIGINS` dari variabel — tidak lagi diperlukan.
4. Tambahkan `TRUSTED_PROXY_HOPS=1`.
5. Kalau integrasi Telegram/WhatsApp aktif, pastikan webhook secret
   terisi (Pengaturan → Integrasi), kalau tidak boot akan ditolak.
6. Setelah service baru sehat, **hapus service `bintang-frontend`**.

### Apa yang terjadi pada data Anda saat deploy pertama

**Tidak ada.** Ini sudah diperiksa khusus:

`bootstrap_db.py` mendeteksi DB yang selama ini dikelola `create_all`
(punya tabel, tapi belum punya `alembic_version`) dan hanya melakukan
**`stamp head`** — mencatat posisi versi. Tidak ada `CREATE`, `ALTER`,
`DROP`, maupun `UPDATE` yang dijalankan.

Itu memang yang benar: `create_all` membangun schema dari model saat
ini, jadi struktur DB Anda sudah setara `head`. Kalau Alembic dipaksa
melakukan `upgrade` dari baseline, setiap migrasi akan mencoba membuat
kolom/tabel yang sudah ada dan deploy gagal di langkah pertama.

Konsekuensinya, dua *data migration* dilewati secara sengaja —
alasannya ditulis lengkap di `backend/app/bootstrap_db.py`. Ringkasnya:
enkripsi rekening bank aman dilewati karena kolomnya membaca plaintext
maupun ciphertext, dan merge tabel `funders` tidak relevan lagi.

Mulai deploy berikutnya, Alembic jadi sumber kebenaran dan migrasi baru
berjalan normal.

---

## Operasional

### Update kode

Push ke `main` → Railway build & deploy otomatis. Migrasi jalan sendiri
di entrypoint.

### Backup database

```bash
railway run --service Postgres pg_dump -Fc > bintang-$(date +%F).dump
```

### Backup uploads

```bash
railway run tar czf - /data/uploads > uploads-$(date +%F).tar.gz
```

### Custom domain

Service aplikasi → Settings → Networking → **Custom Domain**, lalu
arahkan CNAME sesuai instruksi Railway. Setelah aktif, perbarui
`PUBLIC_BASE_URL` dan daftarkan ulang webhook bot.

---

## Troubleshooting

**Deploy gagal, log memuat `REFUSE_BOOT:`**
Konfigurasi produksi ditolak dengan sengaja. Pesannya menyebutkan
variabel mana yang bermasalah — perbaiki lalu redeploy.

**502 `connection refused` di semua path (termasuk `/health`)**
Railway merutekan ke port yang salah — bukan masalah kode. Setel target
port domain ke `8000` (Settings → Networking). Lihat catatan di langkah
3e; ini biasanya sisa konfigurasi dari service frontend nginx yang
dulu memakai port 80.

**Deploy gagal di `[bootstrap_db]`**
Migrasi tidak bisa jalan. Baca error di bawah baris itu. Versi lama
masih melayani, jadi tidak ada downtime dan data tidak tersentuh.
Penyebab tersering: `DATABASE_URL` belum memakai `+asyncpg`, atau
kredensial Postgres berubah.

**Deploy gagal: `REFUSE_BOOT: integrasi bot aktif di prod tapi secret
webhook kosong`**
Ini disengaja. Sebelum perubahan ini, webhook Telegram/WhatsApp bisa
dipanggil siapa pun di internet — dan lewat bot, transaksi keuangan
bisa dibuat. Isi secretnya di **Pengaturan → Integrasi** (atau lewat env
`TELEGRAM_WEBHOOK_SECRET` / `WHATSAPP_WEBHOOK_SECRET`), lalu redeploy.
Kalau memang tidak memakai bot, kosongkan `TELEGRAM_BOT_TOKEN` dan
`WHATSAPP_BASE_URL`.

**SPA muncul tapi semua data gagal dimuat**
Cek `https://<domain>/health`. Kalau API sehat tapi UI tetap kosong,
biasanya build SPA memakai `VITE_API_BASE_URL` lama — di image gabungan
nilainya di-hardcode ke `/api/v1`, jadi pastikan build memakai
`Dockerfile` di root, bukan `frontend-v2` sebagai Root Directory.

**Lampiran tidak muncul (401 di tab Network)**
Cookie `bintang_files` tidak terkirim. Cookie itu di-set saat login dan
ber-scope path `/files`. Logout lalu login lagi. Kalau tetap gagal,
pastikan diakses lewat HTTPS — di `APP_ENV=prod` cookie ber-flag
`Secure`.

**Upload hilang setelah deploy**
Volume belum ter-mount di `/data`, atau `UPLOAD_DIR` tidak menunjuk ke
sana. Cek langkah 3c.
