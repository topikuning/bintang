# Bintang v3

Pengajuan pembayaran & buku kas multi-proyek – dibangun ulang dari nol di atas
stack dan konsep [MARLIN](https://github.com/topikuning/marlin-gibaku).
Aplikasi lama (`../backend`, `../frontend-v2`) **tidak diubah** dan tetap bisa
berjalan sampai v3 siap menggantikannya.

## Stack

| Lapisan | Teknologi |
|---|---|
| Web | Next.js 16 (App Router, standalone) · React 19 · TypeScript 5.9 |
| Data | PostgreSQL 16+ · Prisma 7 (`@prisma/adapter-pg`, klien di `src/generated/prisma`) |
| UI | Tailwind CSS 4 (design token) · lucide-react · tanpa pustaka komponen |
| Auth | Sesi di DB (bisa dicabut) · argon2id · otorisasi berbasis *capability* |
| Validasi | Zod 4 di setiap batas (server action, route handler) |
| Uji | Vitest 4 – unit + integrasi ke PostgreSQL sungguhan |
| Deploy | Railway via Dockerfile (multi-stage, non-root, tini) |

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

## Deploy ke Railway (berdampingan dengan versi lama)

1. **Postgres baru** untuk v3. Jangan pakai database Bintang lama: nama tabelnya
   bertabrakan (`users`, `projects`, `transactions`, …).
2. Layanan baru dari repo ini: **Root Directory = `web`**, builder Dockerfile.
   `railway.json` menjalankan `prisma migrate deploy` sebagai *pre-deploy* dan
   memeriksa `/api/health`.
3. **Volume** di `/data` (lampiran disimpan di `/data/berkas`).
4. Variabel:
   - `DATABASE_URL` – referensi ke Postgres v3
   - `SESSION_SECRET` – `openssl rand -hex 32`
   - `APP_ENV=production`
   - `KUNCI_DATA` – disarankan; menyandikan nomor rekening (AES-256-GCM).
     **Jangan diganti** setelah ada data – nomor lama tidak bisa dibuka lagi.
   - `PENANDA_LINGKUNGAN` – hanya untuk server uji (bilah kuning "SERVER UJI").
5. Buka domainnya → layar **Mulai** → buat Admin Sistem. Lengkapi Data Master
   (rekening, kategori, penerima) dan proyek + anggotanya.

## Pindah dari Bintang lama

Importer satu kali, satu transaksi DB (gagal = tidak ada yang masuk):

```bash
DATABASE_URL=<postgres v3> DATABASE_URL_LAMA=<postgres lama> SECRET_KEY_LAMA=<SECRET_KEY lama> \
  pnpm impor:lama -- --kering     # uji: jalan penuh lalu dibatalkan, cetak ringkasan
DATABASE_URL=… DATABASE_URL_LAMA=… SECRET_KEY_LAMA=… pnpm impor:lama
```

- Pengguna masuk dengan **password lamanya** (hash bcrypt diganti argon2id
  otomatis saat login pertama).
- `SECRET_KEY_LAMA` membuka nomor rekening vendor yang dienkripsi versi lama.
- Uang kembali dari penyelesaian uang muka (`returned_to_kas`) kini tercatat
  sebagai kas masuk – versi lama tidak mencatatnya, jadi saldo v3 lebih besar
  sebesar jumlah itu. Itu koreksi, bukan galat.
- Diuji ke database hasil migrasi + seed Bintang lama: kas masuk/keluar
  terverifikasi cocok sampai rupiah (selisih hanya pembulatan sen).

## Belum dipindahkan dari versi lama

Sengaja ditunda agar inti (pengajuan → persetujuan → pembayaran) matang dulu:

- **Invoice (hutang/piutang) & Purchase Order** beserta PDF berkop. Pembayaran
  invoice tetap masuk sebagai transaksi; pembayaran ke vendor kini lewat
  pengajuan jenis "Bayar ke pihak lain".
- **OCR/AI** (ekstraksi invoice, auto-kategori) dan **bot Telegram/WhatsApp**.
- **Lampiran berkas lama** – ada di volume layanan lama; importer tidak
  menyalinnya.
- Impor Excel massal dan saklar "Catatan Non-Proyek per tahun" (diganti proyek
  jenis *Operasional* yang selalu ikut agregat).
- Notifikasi keluar aplikasi (email/WA) – saat ini notifikasi di dalam aplikasi.
