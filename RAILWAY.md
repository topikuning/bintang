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

## Jalur aman: jalankan `dev` berdampingan dengan `main`

Gunakan **dua Railway Environment yang terisolasi**, bukan dua service
yang menunjuk database/volume yang sama:

| Railway Environment | Branch | Database | Volume upload | Domain |
| --- | --- | --- | --- | --- |
| `production` | `main` | Postgres production | volume production `/data` | domain production |
| `dev` | `dev` | Postgres dev | volume dev `/data` | domain Railway terpisah |

Railway mengisolasi network, database, volume, variable, dan deployment
per environment. Jangan menyalin URL database mentah, volume, domain,
atau kredensial bot production ke `dev`.

### A. Buat environment `dev`

1. Buka project Railway production yang sudah ada.
2. Klik pemilih environment di bagian atas → **New Environment**.
3. Pilih **Duplicate Environment**, sumber `production`, nama `dev`.
   Duplikasi ini memberi susunan service yang sama tetapi instance
   database, volume, network, dan deployment tetap terpisah.
4. Pastikan pemilih environment di bagian atas sekarang menampilkan
   **`dev`** sebelum mengubah apa pun.
5. Jangan klik deploy final sebelum langkah B–E selesai. Perubahan Railway
   bersifat staged, sehingga semuanya dapat diperiksa lebih dulu.

> Sealed variable tidak ikut tersalin saat environment diduplikasi.
> Ini memang aman; isi secret khusus dev pada langkah C.

### B. Kunci source service aplikasi ke branch `dev`

Di environment `dev`, buka service aplikasi → **Settings**:

1. Source repository: `topikuning/bintang`.
2. Trigger branch: **`dev`**.
3. Root Directory: **`/`** atau kosong (root repository).
4. Watch Paths: kosong.
5. Aktifkan **Wait for CI** agar Railway hanya deploy setelah GitHub
   Actions branch `dev` berhasil.
6. Pastikan builder membaca `railway.toml` dan `Dockerfile` di root.
7. Jangan isi Start Command. Image memakai `docker-entrypoint.sh`, yang
   menjalankan migrasi lalu Uvicorn.

Kembali sebentar ke environment `production` dan pastikan trigger branch
service production masih **`main`**. Setelah itu kembali ke `dev`.

### C. Set variable khusus dev

Di service aplikasi environment `dev` → **Variables**, set:

```dotenv
APP_ENV=prod
APP_NAME=Bintang Dev
DATABASE_URL=${{Postgres.DATABASE_URL}}
UPLOAD_DIR=/data/uploads
TRUSTED_PROXY_HOPS=1
CSP_ENFORCE=true
OCR_ENGINE=stub
PUBLIC_BASE_URL=
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
WHATSAPP_BASE_URL=
WHATSAPP_API_KEY=
WHATSAPP_WEBHOOK_SECRET=
ANTHROPIC_API_KEY=
MISTRAL_API_KEY=
```

Tambahkan `SECRET_KEY` kuat yang **berbeda dari production**. Gunakan
terminal lokal:

```bash
python -c 'import secrets; print(secrets.token_urlsafe(48))'
```

Lalu masukkan hasilnya sebagai `SECRET_KEY` dan seal variable tersebut.

`DATABASE_URL` harus dibuat sebagai **reference variable** ke service
Postgres pada environment `dev`, bukan hasil copy-paste URL production.
Aplikasi otomatis menormalisasi URL Railway `postgresql://...` menjadi
driver async `postgresql+asyncpg://...`.

Jangan set `ALLOWED_ORIGINS`; SPA dan API memakai origin yang sama.
Integrasi Telegram, WhatsApp, dan AI sengaja dikosongkan pada deploy
pertama agar dev tidak mengambil alih webhook production atau memakai
API berbayar.

### D. Periksa Postgres dan volume dev

1. Di canvas environment `dev`, buka service **Postgres** dan pastikan
   itu milik environment `dev`.
2. Kembali ke service aplikasi → **Volumes**.
3. Pastikan ada volume environment `dev` dengan mount path **`/data`**.
   Jika belum ada, buat **New Volume** dan mount ke `/data`.
4. Gunakan satu replica aplikasi. Rate limiter saat ini masih in-memory,
   dan Railway tidak memasang satu volume ke beberapa deployment aktif.
5. Jangan attach/detach volume dari environment `production`.

Data production tidak diperlukan untuk smoke test. Gunakan database dev
kosong atau restore dump yang sudah dianonimkan secara sengaja; jangan
menghubungkan aplikasi dev langsung ke Postgres production.

### E. Buat domain dev dan deploy

1. Service aplikasi dev → **Settings → Networking → Generate Domain**.
2. Target port: **`8000`**.
3. Salin domain dev, misalnya `https://bintang-dev.up.railway.app`.
4. Set `PUBLIC_BASE_URL` ke domain dev tersebut.
5. Review seluruh staged changes. Pastikan banner masih menyebut
   environment **`dev`**, lalu klik **Deploy**.

Build yang benar harus memperlihatkan penggunaan `Dockerfile` root.
Deploy log yang sehat berurutan seperti ini:

```text
[entrypoint] menyiapkan schema database...
[bootstrap_db] ...
[entrypoint] menjalankan uvicorn di port 8000...
```

`railway.toml` memberi healthcheck `/health` waktu 300 detik. Railway baru
mengalihkan traffic setelah endpoint itu mengembalikan HTTP 200. Karena
service memiliki volume, redeploy dapat mengalami jeda singkat; Railway
tidak menjalankan dua deployment yang memasang volume yang sama sekaligus.

### F. Seed dan smoke test dev

Untuk database dev baru, jalankan seed **di container**, bukan dengan
`railway run` (perintah itu berjalan di mesin lokal):

```bash
railway login
railway link --project <nama-atau-id-project> --environment dev --service <nama-service-app>
railway status
railway ssh -- python -m app.seed_master
```

Sebelum seed, hasil `railway status` wajib menunjukkan environment `dev`.
Jangan jalankan `app.seed` kecuali memang menginginkan demo data lengkap.

Lakukan smoke test berikut:

1. `https://<domain-dev>/health` → `{"status":"ok"}`.
2. Buka `/`, login, lalu ganti password admin hasil seed.
3. Buka langsung `/transactions`, refresh, dan pastikan tidak 404.
4. Buat proyek, transaksi, invoice, dan upload satu lampiran.
5. Redeploy service dev; pastikan lampiran tetap tersedia setelah login.
6. Buka URL lampiran dari incognito tanpa login; hasilnya harus **401**.
7. Periksa deploy log: tidak boleh ada `REFUSE_BOOT`, traceback, atau
   kegagalan `[bootstrap_db]`.
8. Pastikan production masih membuka branch `main`, domain production,
   data production, dan tidak menerima perubahan data smoke test dev.

### G. Aktifkan integrasi dev hanya jika diperlukan

- Telegram: gunakan bot token dan webhook secret khusus dev.
- WhatsApp: gunakan instance/session WAHA khusus dev. Jangan arahkan satu
  session WAHA ke dua environment.
- OCR/AI: gunakan key dev atau limit terpisah sebelum mengubah
  `OCR_ENGINE` dari `stub`.

### H. Promosi ke production

1. Pastikan seluruh smoke test dev lulus.
2. Di Postgres production → **Backups**, buat manual backup dan tunggu
   hingga selesai.
3. Buat PR GitHub dari `dev` ke `main`; jangan mengubah trigger branch
   production menjadi `dev`.
4. Tunggu seluruh GitHub Actions lulus, lalu merge PR.
5. Railway production yang tetap terhubung ke `main` akan membangun
   commit merge dan menjalankan migrasi otomatis.
6. Pantau log sampai `/health` lulus, lalu uji login, dashboard,
   transaksi, invoice, dan satu lampiran production.

Migrasi release ini hanya menambahkan `ai_extractions.user_id`, foreign
key, dan indeks. Ia tidak menghapus atau menulis ulang data lama.

Jika aplikasi baru sudah memigrasikan database lalu harus kembali ke
image lama, jangan langsung memakai Railway Rollback: image lama tidak
mengenal revision Alembic baru. Pilihan utama adalah memperbaiki maju.
Untuk rollback penuh yang benar-benar diperlukan, selama image baru masih
aktif jalankan:

```bash
railway ssh -- python -m alembic downgrade n9c7e2f4d6a3
```

Baru setelah downgrade berhasil, lakukan rollback deployment aplikasi.
Downgrade ini menghapus kolom ownership baru, sehingga nilai ownership
yang tercatat setelah deploy akan hilang. Gunakan hanya dalam insiden.

---

## 1. Bikin project di Railway

1. Dashboard Railway → **New Project** → **Deploy from GitHub repo**.
2. Pilih repo `bintang`.
3. Railway akan membuat satu service otomatis — kita atur di langkah 3.

---

## 2. Tambahkan PostgreSQL

1. Di dalam project → **New** → **Database** → **Add PostgreSQL**.
2. Railway menyediakan variabel `DATABASE_URL` di service Postgres.
   Aplikasi otomatis menormalisasinya ke driver asyncpg.

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
| `DATABASE_URL` | reference variable `${{Postgres.DATABASE_URL}}` |
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
  default/terlalu pendek atau `ALLOWED_ORIGINS` berisi `*`. Pesannya
  diawali `REFUSE_BOOT:` di deploy log. Telegram tidak mendaftarkan
  webhook tanpa secret; WhatsApp mengikuti pengecualian operasional yang
  dijelaskan di `docs/setup-whatsapp.md`.

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
railway ssh -- python -m app.seed_master

# atau demo data lengkap (3 perusahaan, 5 proyek, 30+ transaksi):
railway ssh -- python -m app.seed
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

**WhatsApp jalan sebentar lalu berhenti**
Kalau `WHATSAPP_WEBHOOK_SECRET` diisi, WAHA harus menyertakan tanda
tangan HMAC di tiap webhook — tapi **WAHA Core menyimpan kuncinya di
memori** dan kehilangannya tiap restart/reconnect session. Akibatnya
webhook mulai ditolak `401` beberapa menit setelah WAHA hidup, tanpa
sebab yang terlihat dari sisi Bintang.

Solusi paling praktis: **kosongkan `WHATSAPP_WEBHOOK_SECRET`**.
Verifikasi dilewati dan webhook jalan terus. Isi lagi hanya kalau WAHA
sudah punya penyimpanan persisten (WAHA Plus, atau WAHA Core dengan
volume yang di-mount).

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
