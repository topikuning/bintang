# Code Review — perubahan lokal (belum di-commit)

**Direview**: 2026-08-30
**Basis**: `c3ce8c2`
**Cakupan**: 34 berkas diubah, 11 baru, 65 dihapus
**Keputusan**: **REQUEST CHANGES → sudah diperbaiki → APPROVE**
**Skill ECC**: `ecc:code-review`, lalu `ecc:security-review`

## Ringkasan

Review atas perbaikan audit 2026-06-13 + penggabungan service. Menemukan
**1 CRITICAL** yang akan menggagalkan setiap deploy ke Postgres, dan
1 MEDIUM ketahanan kode. Keduanya sudah diperbaiki dalam sesi ini.

Nilai review ini terletak persis di area yang paling lemah verifikasinya:
test backend tidak bisa dijalankan di mesin ini (butuh Python 3.13,
tersedia 3.9.6; Docker tidak ada), jadi bug integrasi tidak akan
tertangkap oleh pemeriksaan statis yang saya jalankan sebelumnya.

## Temuan

### CRITICAL

**C1 — `bootstrap_db.py` memakai driver DB yang tidak terpasang**
`backend/app/bootstrap_db.py` (versi awal)

Kode inspeksi membuat engine sync dari URL yang di-strip:

```python
url.replace("+asyncpg", "")      # -> "postgresql://..."
create_engine(url)
```

Dialek sync default SQLAlchemy untuk `postgresql://` adalah **psycopg2**,
dan psycopg2 **tidak ada** di `pyproject.toml` — proyek ini hanya memakai
`asyncpg`. Akibatnya:

```
ModuleNotFoundError: No module named 'psycopg2'
```

Karena `bootstrap_db` dipanggil `docker-entrypoint.sh` sebelum uvicorn,
container **tidak pernah start**. Setiap deploy ke Railway gagal.

Ironisnya ini justru diperkenalkan oleh perbaikan #D-01 (menjalankan
migrasi otomatis) — sebelumnya tidak ada kode yang menyentuh DB di luar
jalur async.

*Dampak data*: nol. Deploy gagal sebelum apa pun berjalan, versi lama
tetap melayani.

*Perbaikan*: pakai `create_async_engine` + `conn.run_sync(inspect)`,
konsisten dengan `app/alembic/env.py` yang memang sudah async.

### HIGH

Tidak ada.

### MEDIUM

**M1 — `ALLOWED_MIME` dan `_EXT_BY_MIME` dua daftar terpisah**
`backend/app/services/storage/local.py`

`save_upload` melakukan `_EXT_BY_MIME[file.content_type]` setelah
memvalidasi terhadap `ALLOWED_MIME`. Selama keduanya ditulis manual,
menambah satu MIME ke whitelist tanpa menambah ekstensinya menghasilkan
`KeyError` — upload gagal dengan 500, bukan pesan yang berguna.

*Perbaikan*: `ALLOWED_MIME` dan `BOT_ALLOWED_MIME` sekarang **diturunkan**
dari `_EXT_BY_MIME`. Invarian "setiap MIME yang diizinkan punya ekstensi"
dijamin oleh konstruksi, bukan oleh kedisiplinan.

### LOW

**L1 — cookie berkas tidak dihapus pada logout sisi klien**
`frontend-v2/src/lib/api.ts:39`

Interceptor 401 memanggil `useAuthStore.logout()` tanpa memanggil
`POST /auth/logout`, jadi cookie `bintang_files` bertahan sampai
kedaluwarsa. **Bukan lubang keamanan**: `/files` memvalidasi ulang JWT di
dalam cookie setiap request, jadi token yang sudah dicabut atau
kedaluwarsa tetap ditolak. Dibiarkan.

## Yang diperiksa dan bersih

| Aspek | Hasil |
|---|---|
| Urutan route | Catch-all SPA terdaftar paling akhir (L464); `/docs`, `/api/v1`, `/files`, `/health` semua lebih dulu |
| Impor model di `files.py` | Keenam nama ada via `models.py` (`from ._refs import *` dst) |
| Traversal | `resolve_upload_path` menolak `..`, path absolut, symlink keluar; 6 pemanggil sudah dialihkan |
| Impor melingkar | `auth.py → files.py → core.deps`; `files.py` tidak mengimpor `auth.py` |
| Nama tak terdefinisi | 0 di seluruh berkas yang disentuh |
| Rahasia ter-hardcode | Tidak ada |
| SQL injection | Tidak ada; semua lewat ORM / parameter binding |

## Validasi

| Cek | Hasil |
|---|---|
| Typecheck (frontend) | **Pass** |
| Lint (frontend) | **Pass** — 0 error, 15 warning (di bawah batas 15) |
| Test (frontend) | **Pass** — 23/23 |
| Build (frontend) | **Pass** |
| Syntax (backend) | **Pass** — seluruh modul |
| Nama tak terdefinisi (backend) | **Pass** |
| Pytest (backend) | **Skipped** — butuh Python 3.13, mesin ini 3.9.6 |
| Build image | **Skipped** — Docker tidak tersedia |

## Sisa risiko

Dua cek yang tidak bisa dijalankan di sini akan berjalan di CI
(`.github/workflows/ci.yml` menjalankan pytest di Python 3.13 dan
`docker build` untuk image gabungan). **Jalankan CI sebelum deploy** —
C1 di atas adalah contoh persis kelas bug yang hanya ketahuan di sana.


---

# Lanjutan — pass `ecc:security-review`

Checklist keamanan ECC diterapkan ke perubahan yang sama. Empat item
menghasilkan perubahan nyata; sisanya sudah terpenuhi.

## Temuan tambahan

### HIGH

**H1 — 3 kerentanan HIGH di `react-router` (terlewat di audit awal)**
`frontend-v2/package.json`

`npm audit` melaporkan react-router 7.15.0 rentan terhadap CSRF via
PUT/PATCH/DELETE, open redirect via backslash di `<Link>`, XSS di
RSCErrorHandler, dan DoS via route matching tidak efisien.

Audit awal saya memeriksa dependency dari sisi *pinning* dan
reproducibility (#D-03) tapi **tidak pernah menjalankan `npm audit`** —
kelalaian yang jelas untuk aplikasi keuangan.

*Perbaikan*: `npm audit fix` → react-router 7.18.3. Typecheck, lint,
23 test, dan build tetap hijau setelah upgrade. `npm audit` sekarang
bersih (0 kerentanan).

### MEDIUM

**M2 — Tidak ada Content-Security-Policy**
`backend/app/main.py`

Middleware header keamanan secara eksplisit melewati CSP dengan alasan
"butuh audit per-page". Alasan itu **tidak berlaku lagi** setelah
penggabungan service: seluruh sumber daya SPA kini same-origin, dan
build Vite tidak punya `<script>` inline (diverifikasi langsung di
`dist/index.html`).

Ini juga melengkapi #S-05: kalau suatu saat ada berkas berbahaya lolos
ke storage, CSP jadi lapis pertahanan kedua.

*Perbaikan*: CSP ketat (`default-src 'self'`, `object-src 'none'`,
`frame-ancestors 'none'`) dikirim sebagai **Report-Only** secara default,
dengan `CSP_ENFORCE=true` untuk menegakkannya. Report-only dipilih karena
CSP yang salah menghasilkan halaman putih tanpa pesan jelas, dan
aplikasinya tidak bisa saya muat di browser dari sini. `/docs` dan
`/redoc` dikecualikan (Swagger memuat aset dari CDN jsdelivr).

**M3 — Detail exception upstream bocor ke klien**
`backend/app/api/v1/ocr.py:189, 200, 272`

`HTTPException(502, f"ocr_failed: {e}")` meneruskan pesan mentah dari
httpx / provider OCR ke pemanggil — bisa memuat URL, header, atau
potongan respons upstream.

*Perbaikan*: detail lengkap ke `log.exception()`, klien dapat pesan
ringkas. Pesan ValueError buatan kita sendiri (`url_blocked`,
`url_returned_html`, dst) DIPERTAHANKAN — itu memang informatif dan
sudah dipetakan ke bahasa Indonesia di `lib/api.ts`.

### LOW

**L2 — Cookie berkas bisa lebih ketat dari `Lax`**
`backend/app/api/v1/auth.py`

Checklist ECC meminta `SameSite=Strict`. Saya semula memilih `Lax`
untuk berjaga kalau URL `/files` dikirim ke chat WhatsApp/Telegram —
dengan Strict, tautan seperti itu akan selalu 401.

*Diverifikasi*: `send_image_url()` di `whatsapp/client.py` **tidak
pernah dipanggil**; bot hanya mengirim teks. Jadi Strict aman.

*Perbaikan*: dinaikkan ke `SameSite=Strict`, dengan catatan di kode
bahwa ini HARUS turun ke `Lax` kalau bot mulai mengirim tautan berkas.

## Item checklist yang sudah terpenuhi

| Item | Status |
|---|---|
| Rahasia ter-hardcode | Bersih |
| Secrets di env / bukan di git | Bersih (`.env` di .gitignore) |
| SQL injection | Bersih — ORM sepenuhnya |
| Validasi upload (ukuran, tipe, ekstensi) | Ketiganya ada (#S-05) |
| Token di httpOnly cookie | Untuk `/files`; API tetap Bearer (by design) |
| Cek otorisasi sebelum operasi sensitif | `ensure_project_access` (#S-03, #S-09) |
| Rate limiting | Login (IP + akun), OCR, link bot |
| HTTPS dipaksa di prod | HSTS 1 tahun |
| Security headers | X-Frame-Options, nosniff, Referrer-Policy, + CSP |
| Lock file di-commit | `package-lock.json` ya; `uv.lock` belum dibuat (#D-03) |
| Dependabot | Ditambahkan (#D-04) |
| CORS | Kosong = same-origin only |

## Catatan

Rate limiting hanya ada di tiga endpoint termahal, bukan di semua API
seperti diminta checklist. Untuk alat internal dengan puluhan user di
belakang login, itu proporsional — dicatat di sini supaya keputusannya
terlihat, bukan terlewat.
