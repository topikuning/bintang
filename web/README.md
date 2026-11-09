# Bintang v3

Pengajuan pembayaran & buku kas multi-proyek – dibangun ulang dari nol di atas
stack dan konsep [MARLIN](https://github.com/topikuning/marlin-gibaku).
Aplikasi lama (`../backend`, `../frontend-v2`, di Railway) **tidak diubah** dan
tetap berjalan sampai hari pindah. v3 berjalan di **server Lenovo**.

## Stack

| Lapisan | Teknologi |
|---|---|
| Web | Next.js 16 (App Router, standalone) · React 19 · TypeScript 5.9 |
| Data | PostgreSQL 16+ · Prisma 7 (`@prisma/adapter-pg`, klien di `src/generated/prisma`) |
| UI | Tailwind CSS 4 (design token) · lucide-react · tanpa pustaka komponen |
| Auth | Sesi di DB (bisa dicabut) · argon2id · otorisasi berbasis *capability* |
| Validasi | Zod 4 di setiap batas (server action, route handler) |
| Uji | Vitest 4 – unit + integrasi ke PostgreSQL sungguhan |
| Deploy | Server Lenovo: Docker Compose (multi-stage, non-root, tini) + cadangan harian + Cloudflare Tunnel |

Konsep MARLIN yang dipakai: mesin transisi status (`src/lib/lifecycle.ts`),
*calculation layer* tunggal untuk angka uang (`src/lib/keuangan/hitung.ts`),
`requireCapability` + `auditIn` di setiap mutasi (uang & status tidak pernah
berubah tanpa jejak di transaksi DB yang sama), penyimpanan berkas satu pintu,
Combobox bisa-dicari untuk semua dropdown (dijaga lint), kontrol 16 px di ponsel.

## Alur pengajuan pembayaran

```
draf ─▶ diajukan ─▶ disetujui ─▶ dibayar ──────────────▶ (selesai untuk pembayaran & penggantian)
          │   ▲         │            └─▶ LPJ diajukan ─▶ selesai   (uang muka)
          ▼   │         ▼                    │
     perlu revisi   dibatalkan          dikembalikan ─▶ dibayar
          │
          ▼
       ditolak / dibatalkan
```

- **Tiga jenis**: *bayar ke pihak lain* (vendor, tukang, tagihan), *uang muka*
  (dipegang dulu, wajib LPJ), *penggantian* (sudah bayar pakai uang sendiri).
- **Setujui & bayar** dalam satu langkah untuk orang yang memegang keduanya.
- **Menandai dibayar** otomatis membuat transaksi kas terverifikasi (nomor
  `TRX/…`), lengkap dengan rekening sumber, cara bayar, referensi, bukti.
- **LPJ uang muka** menghitung selisih: sisa → kas masuk, kurang → dibayarkan.
  Biaya per kategori baru diakui saat LPJ diterima.
- **Batas persetujuan Keuangan** (Pengaturan): di atasnya hanya Pimpinan.
- Pemohon **tidak bisa** menyetujui pengajuannya sendiri. Kategori wajib saat
  mengajukan. Nomor `PGJ/2026/11/0001` diberikan saat diajukan, aman dari
  pengiriman bersamaan.
- Setiap langkah: riwayat di layar detail, notifikasi ke orang yang perlu
  bertindak, jejak audit append-only (dijaga trigger DB).

## Peran

| Peran | Bisa |
|---|---|
| Admin Sistem | semuanya, termasuk pengguna & pengaturan |
| Pimpinan | menyetujui berapa pun nilainya, melihat semua |
| Keuangan | menyetujui (sampai batas), membayar, memeriksa LPJ, mencatat & memverifikasi kas, data master |
| Admin Proyek | mengajukan & mencatat kas di proyek yang ditugaskan (kas menunggu verifikasi) |
| Staf | mengajukan & memantau pengajuannya sendiri |
| Pengamat | hanya melihat (bisa dibatasi per proyek) |

Matriks lengkap: `src/lib/authz.ts`.

## Menjalankan lokal

```bash
corepack enable
pnpm install
cp .env.example .env          # isi DATABASE_URL + SESSION_SECRET
pnpm prisma migrate deploy
pnpm db:seed                  # data demo – password semua: bintang123
pnpm dev                      # http://localhost:3000
```

Akun demo: `admin`, `hery` (Pimpinan), `rina` (Keuangan), `budi` & `sari`
(Admin Proyek), `agus` (Staf), `investor` (Pengamat).

Database kosong tanpa seed → buka aplikasi, layar **Mulai** membuat Admin Sistem
pertama beserta kategori bawaan.

## Verifikasi

```bash
pnpm typecheck && pnpm lint
pnpm vitest run tests/unit
DATABASE_URL=postgresql://…/bintang_test APP_ENV=test pnpm prisma migrate deploy
DATABASE_URL=postgresql://…/bintang_test APP_ENV=test pnpm vitest run tests/integration
pnpm build
```

## Server Lenovo (produksi)

v3 berjalan di server sendiri (Linux + Docker), **bukan Railway**. Cabang: `main`
(satu repo dengan aplikasi lama; image Railway tidak menyalin `web/`).

```bash
git clone https://github.com/topikuning/bintang /opt/bintang
cd /opt/bintang/web
cp .env.lenovo.example .env && chmod 600 .env   # isi DB_PASSWORD, SESSION_SECRET, KUNCI_DATA, DATA_DIR
docker compose up -d --build                   # db + app + cadangan harian
docker compose --profile tunnel up -d          # + Cloudflare Tunnel untuk HTTPS publik
```

- Buka `http://<ip-lenovo>:3000` → layar **Mulai** membuat Admin Sistem pertama
  (atau langsung impor dari Bintang lama, lihat di bawah).
- Semua data di `DATA_DIR`: `postgres/`, `berkas/` (lampiran), `cadangan/`
  (dump harian + salinan lampiran), `impor-cermin/` (salinan berkas lama).
- Mati listrik/reboot: semua layanan `restart: unless-stopped`. Pastikan Docker
  aktif saat boot (`systemctl enable docker`).
- Migrasi DB berjalan otomatis tiap app start.
- Cookie sesi otomatis `Secure` hanya bila diakses lewat HTTPS (tunnel), jadi
  login lewat IP LAN tetap jalan (`COOKIE_AMAN`).
- Pembaruan: `git pull && docker compose up -d --build`.

**Cadangan masih di mesin yang sama.** Salin `DATA_DIR/cadangan` ke luar mesin
(Google Drive, R2, NAS) – misalnya `rclone sync /srv/bintang/cadangan remote:bintang-cadangan`
lewat cron harian. Tanpa itu, satu disk rusak menghapus data DAN cadangannya.
Pulihkan DB: `pg_restore --clean --if-exists -d bintang <dump>`.

## Pindah dari Bintang lama

Runbook lengkap (gladi, hari pindah, setelahnya): [`docs/PINDAHAN.md`](./docs/PINDAHAN.md).

Singkatnya, v3 **menarik** data + semua lampiran dari aplikasi lama lewat API
ekspor sekali pakai (`backend/app/api/v1/ekspor_v3.py`, aktif bila `EKSPOR_V3_TOKEN` terisi):

```bash
# di .env Lenovo: SUMBER_LAMA_URL=https://<app-lama> dan EKSPOR_V3_TOKEN=<token sama>
docker compose --profile impor run --rm impor --kering   # gladi: jalan penuh lalu dibatalkan
docker compose --profile impor run --rm impor            # sungguhan
```

- Satu transaksi DB – gagal = tidak ada yang masuk. Berkas dicerminkan dulu ke
  `impor-cermin/` (bisa dilanjutkan bila putus, dicek ukurannya), baru disalin.
- Pengguna masuk dengan **password lamanya** (bcrypt → argon2id saat login).
- Nomor rekening dibuka di server lama, disandikan ulang dengan `KUNCI_DATA`.
- Lampiran transaksi → transaksi; nota LPJ → pengajuannya; dokumen proyek &
  berkas invoice → *Dokumen proyek*; invoice & PO → arsip Excel per proyek.
- Tautan luar & berkas yang tercatat tapi tidak ada → `laporan-*.tsv` di cermin.
- Uang kembali penyelesaian uang muka (`returned_to_kas`) kini tercatat sebagai
  kas masuk – versi lama tidak mencatatnya, jadi saldo v3 lebih besar sebesar
  itu. Koreksi, bukan galat.
- Tanpa API (data saja): `DATABASE_URL_LAMA=<postgres lama>` (+ `SECRET_KEY_LAMA`
  untuk rekening) – berkas tidak ikut.

## Belum dipindahkan dari versi lama

Sengaja ditunda agar inti (pengajuan → persetujuan → pembayaran) matang dulu:

- **Invoice (hutang/piutang) & Purchase Order** sebagai modul. Datanya ikut
  pindah sebagai arsip Excel per proyek (bisa dibaca, tidak bisa diolah di v3);
  pembayaran invoice tetap masuk sebagai transaksi; pembayaran ke vendor kini
  lewat pengajuan jenis "Bayar ke pihak lain".
- **OCR/AI** (ekstraksi invoice, auto-kategori) dan **bot Telegram/WhatsApp**.
- Impor Excel massal dan saklar "Catatan Non-Proyek per tahun" (diganti proyek
  jenis *Operasional* yang selalu ikut agregat).
- Notifikasi keluar aplikasi (email/WA) – saat ini notifikasi di dalam aplikasi.
