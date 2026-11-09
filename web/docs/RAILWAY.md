# Bintang v3 di Railway

v3 dipasang sebagai **layanan baru** di proyek Railway yang sama, dengan
Postgres dan volume **sendiri**. Layanan aplikasi lama tidak disentuh dan tetap
melayani seperti biasa; keduanya hidup berdampingan sampai hari pindah.

Server Lenovo tetap jalur jangka panjang (`docs/PINDAHAN.md`). Image-nya sama
(`web/Dockerfile`), jadi pindah Railway → Lenovo nanti cukup pindah data.

## 1. Layanan (sekali)

Di proyek Railway → **+ New**:

1. **Database → PostgreSQL**. Ganti namanya `Postgres-v3` supaya tidak tertukar
   dengan database aplikasi lama.
2. **GitHub Repo → `topikuning/bintang`**. Ganti namanya `bintang-v3`, lalu
   buka **Settings**:

| Pengaturan | Nilai |
|---|---|
| Source → Branch | `dev3` |
| Source → Root Directory | `/web` |
| Config-as-code → Railway Config File | `/web/railway.json` (jalur penuh dari akar repo) |
| Networking → Public Networking | *Generate Domain* (port 3000) |

`railway.json` sudah mengatur: build dari `web/Dockerfile`, hanya deploy bila
`web/**` berubah, `prisma migrate deploy` sebelum tiap deploy, healthcheck
`/api/health`.

3. Klik kanan layanan → **Attach Volume** → mount path **`/data`**. Lampiran
   (`/data/berkas`) dan cermin impor (`/data/impor-cermin`) tinggal di sini.
   Tanpa volume, semua lampiran hilang tiap deploy.

## 2. Variables layanan `bintang-v3`

| Nama | Nilai |
|---|---|
| `APP_ENV` | `production` |
| `DATABASE_URL` | `${{Postgres-v3.DATABASE_URL}}` |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `KUNCI_DATA` | `openssl rand -hex 32` – simpan di pengelola password, **jangan pernah diganti** setelah ada data |
| `APP_NAME` | `Bintang` |
| `PENANDA_LINGKUNGAN` | `UJI` selama masa coba (bilah kuning). Kosongkan saat dipakai sungguhan. |

Cookie sesi otomatis `Secure` (Railway selalu HTTPS). Deploy → buka domainnya
→ layar **Mulai** membuat Admin Sistem pertama. Atau langsung impor (§3).

## 3. Impor dari aplikasi lama

Volume hanya terpasang di container `bintang-v3`, jadi importer dijalankan di
dalamnya lewat Railway CLI (`npm i -g @railway/cli`, lalu `railway login` dan
`railway link` ke proyek ini).

1. Layanan aplikasi lama → Variables → `EKSPOR_V3_TOKEN` = nilai acak ≥ 32
   karakter → redeploy.
2. Layanan `bintang-v3` → Variables:
   - `SUMBER_LAMA_URL` = domain aplikasi lama (`https://…up.railway.app`), atau
     alamat privatnya (`http://<nama-layanan-lama>.railway.internal:<PORT>`) –
     lebih cepat, tanpa lalu lintas publik;
   - `EKSPOR_V3_TOKEN` = token yang sama.
3. Jangan buka v3 di peramban dulu (layar Mulai bisa membuat admin dan
   menggagalkan impor). Lalu:

```bash
railway ssh --service bintang-v3
```

Di dalam container:

```bash
bintang-impor --kering                     # gladi: jalan penuh lalu dibatalkan
nohup bintang-impor > /data/impor.log 2>&1 &   # sungguhan, tetap jalan bila SSH putus
tail -f /data/impor.log
```

Aturannya sama dengan di Lenovo (`docs/PINDAHAN.md` §3–4): satu transaksi DB,
gagal = tidak ada yang masuk; berkas dicerminkan dulu ke `/data/impor-cermin`
dan bisa dilanjutkan; impor kedua ditolak bila data sudah ada. Laporan
`laporan-*.tsv` ada di `/data/impor-cermin`.

Mengulang dari nol setelah impor sungguhan untuk coba-coba: hapus lalu buat
ulang `Postgres-v3`, dan hapus isi `/data/berkas` lewat `railway ssh`
(`rm -rf /data/berkas/*`). Cermin dibiarkan.

4. Selesai: **kosongkan** `EKSPOR_V3_TOKEN` di kedua layanan.

## 4. Cadangan

Jadwalkan **Backups** harian di volume `Postgres-v3` **dan** volume
`bintang-v3` (bila paket Railway Anda menyediakannya). Tanpa itu tidak ada
cadangan sama sekali – container cadangan harian hanya ada di versi Lenovo.

## 5. Cabang

v3 dikembangkan dan dideploy dari **`dev3`**. Railway (layanan `bintang-v3`) dan
Lenovo sama-sama mengikuti `dev3`. Layanan aplikasi lama tetap mengikuti `main`.
Jangan merge `dev3` ke `main` lewat PR selama opsi GitHub *Automatically delete
head branches* aktif – cabangnya ikut terhapus (itu yang terjadi pada #140).
