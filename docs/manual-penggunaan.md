# Manual Penggunaan — Bintang Finance & Project

**Versi**: 2.x  
**Aplikasi**: Manajemen Keuangan Multi-Proyek  
**Untuk**: Tim Finance, Project Manager, Eksekutif

---

## Daftar Isi

1. [Pengantar](#1-pengantar)
2. [Konsep & Istilah Akunting](#2-konsep--istilah-akunting)
3. [Login & Sesi](#3-login--sesi)
4. [Role & Akses (Permission)](#4-role--akses-permission)
5. [Navigasi & Layout](#5-navigasi--layout)
6. [Dashboard (Beranda)](#6-dashboard-beranda)
7. [Manajemen Proyek](#7-manajemen-proyek)
8. [Transaksi (3 Jenis Pengeluaran)](#8-transaksi-3-jenis-pengeluaran)
9. [Invoice (Hutang & Piutang)](#9-invoice-hutang--piutang)
10. [Purchase Order (PO)](#10-purchase-order-po)
11. [Dana Operasional (Kas Bon)](#11-dana-operasional-kas-bon)
12. [Asisten OCR (Ekstraksi Dokumen)](#12-asisten-ocr-ekstraksi-dokumen)
13. [Laporan & Export](#13-laporan--export)
14. [Master Data](#14-master-data)
15. [Integrasi Telegram & WhatsApp](#15-integrasi-telegram--whatsapp)
16. [Pengaturan Sistem (SUPERADMIN)](#16-pengaturan-sistem-superadmin)
17. [Alur Kerja Tipikal](#17-alur-kerja-tipikal)
18. [Troubleshooting](#18-troubleshooting)
19. [Glosarium](#19-glosarium)

---

## 1. Pengantar

**Bintang Finance & Project** adalah aplikasi web manajemen keuangan multi-proyek dengan standar akuntansi profesional (mirip Jurnal/Xero/QuickBooks, disesuaikan untuk konteks proyek konstruksi & jasa Indonesia).

### Fitur utama

- **Multi-proyek** dengan budget control + cashflow tracking per proyek
- **Transaksi** dengan 3 jenis akunting yang benar: Pembayaran Invoice, Dana Operasional (kas bon), Beban Langsung
- **Invoice** masuk & keluar (hutang/piutang) dengan alokasi pembayaran M:N
- **Purchase Order** dengan procurement chain ke transaksi & invoice
- **Dana Operasional** (cash advance) dengan workflow settlement
- **AR/AP aging** standar (0-30 / 31-60 / 61-90 / >90 hari)
- **Asisten OCR** untuk ekstraksi invoice/struk otomatis (Claude / Mistral)
- **Laporan** PDF + Excel dengan filter periode, proyek, kategori, jenis
- **Integrasi chat** Telegram & WhatsApp untuk input cepat
- **Role-based access** (SUPERADMIN, CENTRAL_ADMIN, PROJECT_ADMIN, EXECUTIVE)
- **Audit log** lengkap untuk seluruh perubahan data

### Untuk siapa

- **Direktur/Pemilik**: ringkasan posisi kas multi-proyek, AR/AP aging, profitabilitas
- **Project Manager**: budget vs realisasi, transaksi, invoice & PO per proyek
- **Bagian Keuangan**: input transaksi, rekonsiliasi invoice, audit trail
- **Auditor**: drilldown chain (PO → TX → Invoice), audit log, export laporan

---

## 2. Konsep & Istilah Akunting

### Tiga Jenis Transaksi Pengeluaran (TxnKind)

Sesuai kaidah PSAK/GAAP, **pengeluaran (OUT) harus dipilah** menurut sifatnya:

| Jenis | Contoh | Akunting | Bukti |
|---|---|---|---|
| **Bayar Invoice** (`INVOICE_PAYMENT`) | Bayar tagihan vendor (PT XYZ Rp 5jt utk material) | Dr. Hutang / Kr. Kas | Invoice formal vendor |
| **Dana Operasional** (`CASH_ADVANCE`) | Kasbon Rp 2jt ke Pak Joko untuk operasional lapangan | Dr. Uang Muka / Kr. Kas (saat keluar) → Dr. Beban / Kr. Uang Muka (saat lapor) | Voucher pencairan; rincian struk saat settlement |
| **Beban Langsung** (`DIRECT_EXPENSE`) | Beli ATK Rp 150rb di Indomaret (tanpa invoice formal) | Dr. Beban / Kr. Kas | Struk/kwitansi langsung |

**Mengapa harus dipisah?** Kalau semua dipaksa "invoice", maka:
- Saldo per karyawan (uang muka yang belum dilapor) tidak ter-track
- Beban vs piutang campur → laporan laba-rugi tidak akurat
- Audit trail rusak

### Invoice (Faktur/Tagihan)

| Tipe | Arti | Akun |
|---|---|---|
| **IN** (masuk) | Tagihan **dari vendor** ke kita → kita **HUTANG** | Dr. Beban/Aset / Kr. Hutang |
| **OUT** (keluar) | Tagihan **kita** ke klien → klien **PIUTANG** | Dr. Piutang / Kr. Pendapatan |

**Status invoice**: `DRAFT` → `ISSUED` → `PARTIALLY_PAID` → `PAID` (atau `OVERDUE` jika lewat jatuh tempo).

### Allocation (Alokasi Pembayaran)

Tabel **M:N** antara `Transaction` (pembayaran) dan `Invoice` (tagihan). Satu transaksi bisa membayar beberapa invoice; satu invoice bisa dibayar via beberapa transaksi (cicilan).

### Aging AR/AP

Bucket umur **invoice outstanding**:
- **0-30 hari** — fresh
- **31-60 hari** — watch
- **61-90 hari** — overdue ringan
- **>90 hari** — critical (kemungkinan macet)

### Purchase Order (PO)

Dokumen pemesanan ke vendor **sebelum** vendor terbit invoice. PO terikat ke proyek + vendor. Setelah barang/jasa diterima, vendor terbit invoice yang merefer PO ini.

---

## 3. Login & Sesi

### Halaman Login

URL: `https://proyek.cvbintang.com/login` (atau URL deploy Anda).

**Input**:
- Email
- Password

Klik **Masuk**. Setelah berhasil, redirect ke `/dashboard`.

### Lupa Password

Hubungi SUPERADMIN untuk reset password Anda (via master Pengguna → edit user → set password baru).

### Sesi

- Token JWT berlaku **12 jam** (default).
- Logout via menu profile (kanan-atas) atau ketika token expired.

---

## 4. Role & Akses (Permission)

### 4 Role

| Role | Akses utama |
|---|---|
| **SUPERADMIN** | God-mode. Akses semua. Bypass audit lock. Manage system settings & user permission. |
| **CENTRAL_ADMIN** | Admin pusat. Akses semua proyek. Tidak boleh hard-delete atau bypass verified-locked. |
| **PROJECT_ADMIN** | Akses proyek-proyek yang di-assign (lewat `project_users`). |
| **EXECUTIVE** | View-only. Bisa lihat laporan & dashboard. Dapat scope semua proyek (kalau `scope_all_projects=True`) atau hanya proyek tertentu. |

### Aturan Edit Transaksi

| Status | Siapa boleh edit? |
|---|---|
| **DRAFT / SUBMITTED / REJECTED** | Siapa pun dengan write access (PROJECT_ADMIN ke proyeknya, CENTRAL_ADMIN, SUPERADMIN) |
| **VERIFIED** | Hanya **SUPERADMIN** (god-mode bypass audit lock) |
| **CASH_ADVANCE settled** | Tidak ada (kunci penuh sampai settlement dihapus) |

### Menu per Role

SUPERADMIN dapat mengatur menu mana yang tampil untuk role tertentu via:
- **`Pengaturan → Akses Menu per Role`** (matrix checkbox 3 role × 20 menu)

Default: semua menu visible. Toggle off untuk sembunyikan menu dari role tertentu.

---

## 5. Navigasi & Layout

### Desktop (≥1024 px)

- **Sidebar kiri** (lebar 240px) — menu lengkap dikelompokkan:
  - **Beranda**: Dashboard, Proyek
  - **Operasional**: Transaksi, Dana Operasional, Invoice, PO, Budget
  - **Laporan**: Laporan, Detail Invoice, Audit Log
  - **Master Data**: Proyek, Perusahaan, Kategori, Vendor/Klien, Pendana, Pengguna
  - **Sistem**: Import, Asisten OCR, Pengaturan, Sistem (API Keys), Akses Menu per Role, File Orphan

### Tablet (768-1024 px)

- **Nav rail** (lebar 56px) — icon-only dengan tooltip

### Mobile (<768 px)

- **Bottom nav** 5 icon: Beranda · Proyek · Transaksi · Invoice · Lainnya
- **/more** — halaman overflow untuk menu di luar bottom-nav

### Top bar

- **Global search** (Ctrl+K) untuk lompat ke proyek/transaksi/invoice
- **Project switcher** untuk filter konteks proyek (di top bar)
- **User profile** (avatar) — link ke /settings

---

## 6. Dashboard (Beranda)

URL: `/dashboard`

### Konten

- **Stats global** (kalau "Semua Proyek"): saldo, total tx, active projects, pending verifikasi
- **Spending per proyek** (top 5)
- **Spending per kategori**
- **Monthly cashflow** chart 12 bulan terakhir
- **Pending warnings** (tx draft yang harus di-submit, invoice overdue, dll)

### Filter (multi-select)

- **Lokasi proyek**
- **Dinas/Klien**
- **Pendana**

Tombol "Bersihkan filter" reset semua filter.

---

## 7. Manajemen Proyek

### Hub Proyek

URL: `/projects`

- **Grid kartu** semua proyek dengan ringkasan keuangan (cashflow, budget, invoice open)
- **Filter** multi-select: lokasi, Dinas/Klien, Pendana, perusahaan
- **Search** by nama/kode
- **Status filter**: Aktif / Semua

Klik kartu proyek → masuk **Project Dashboard**.

### Project Dashboard

URL: `/projects/:id`

**Section yang tampil**:

1. **Header**: nama proyek, kode, lokasi, perusahaan, klien (jika ada), pendana (badge multi)
2. **Health badge** (hijau/kuning/merah berdasarkan budget usage + cashflow)
3. **Quick action**: Tambah Transaksi · Tambah Invoice · Tambah PO
4. **Stats Cashflow**: Masuk, Keluar, Saldo, Rasio Keluar/Masuk
5. **Posisi Kas (AR/AP) — aging widget**:
   - **Hutang ke Vendor (AP)** — invoice IN yang belum dibayar, dengan stacked bar 4-bucket (0-30 / 31-60 / 61-90 / >90)
   - **Piutang dari Klien (AR)** — invoice OUT yang belum diterima, sama buckets
6. **Budget vs Realisasi** (progress bar)
7. **Cashflow Bulanan** (chart)
8. **Spending per kategori** (chart)
9. **Invoice Proyek** (top 5, klik untuk buka detail)
10. **Recent Transactions** (top 5)
11. **Tim Proyek** (list project_users + tambah/hapus anggota)
12. **Dokumen Proyek** (kontrak, BAST, SPK, dll dengan kategori)

### Aksi pada Project Dashboard

- Klik **invoice** → buka detail (filter project_id otomatis)
- Klik **transaksi** → buka detail
- Klik **stat "Invoice Belum Lunas"** → list invoice ter-filter (project + status ISSUED)

### Edit Proyek (Master)

Master CRUD ada di `/master/projects`. SUPERADMIN & CENTRAL_ADMIN boleh edit.

### Proposal Proyek

User non-admin (PROJECT_ADMIN) dapat **mengajukan proyek baru** lewat tombol "Ajukan Proyek" di `/projects`. Status `MENUNGGU_PERSETUJUAN`. SUPERADMIN/CENTRAL_ADMIN approve/reject di queue.

---

## 8. Transaksi (3 Jenis Pengeluaran)

URL: `/transactions`

### Membuat Transaksi Baru

Klik **+ Tambah Transaksi**. Form muncul sebagai sheet.

#### Step 1: Pilih Arah

- **Pemasukan (IN)** — penerimaan dari klien (invoice OUT dilunasi, modal, dll)
- **Pengeluaran (OUT)** — keluar uang

#### Step 2: Pilih Jenis (untuk OUT)

Card radio 3 pilihan:

| Card | Kapan dipakai |
|---|---|
| **Bayar Invoice** | Pembayaran ke vendor lewat invoice/PO |
| **Dana Operasional** | Kasbon ke staff/karyawan internal — perlu pertanggungjawaban nanti |
| **Beban Langsung** | Pengeluaran tanpa invoice (struk/kwitansi) — rincian per item |

#### Step 3: Isi Detail (sesuai jenis)

**Bayar Invoice** (default):
- Tanggal, Nominal, Proyek, Kategori
- **Vendor/Klien** (master) atau **Nama Pihak** (free text fallback)
- Metode Pembayaran, No. Referensi, Deskripsi

**Dana Operasional**:
- Tanggal, Nominal, Proyek
- **Penerima User** (dropdown user; bisa dipilih siapa saja yang aktif) **ATAU** **Nama penerima** (free text untuk staff tanpa akun)
- Metode Pembayaran, Deskripsi

**Beban Langsung**:
- Tanggal, Proyek
- **Tabel Rincian** (multi-line items):
  - Deskripsi · Kategori · Nominal
  - Tambah/Hapus row
  - **Nominal total auto-sum** dari rincian
- Metode Pembayaran, Deskripsi

#### Step 4: Submit / Draft

Status awal selalu **DRAFT**. Klik **Submit untuk Verifikasi** ketika siap. Admin verifikasi → status `VERIFIED`.

### List Transaksi

- Grid card di mobile, table di desktop
- Setiap card menampilkan: tanggal, **#ID** (badge mono — gunakan untuk reference di chat), nominal, party, status, badge kind (Bayar Invoice / Dana Ops / Beban Langsung), badge top-up (jika tx dari settlement)
- **Bayar invoice**: row 3b menampilkan "Bayar invoice: INV-001, INV-002 +N lagi" (clickable di detail)

### Detail Transaksi

Klik card → drawer detail muncul:

- **Header**: arah, status, badge jenis, badge settlement (Dana Ops), #ID
- **Nominal**, tanggal full
- **Body fields**: pihak/penerima, proyek, kategori, deskripsi, metode, no.ref, ID parent advance (kalau top-up)
- **Rincian Pengeluaran** (kalau DIRECT_EXPENSE): list items + total
- **Membayar Invoice** (kalau ada alokasi): list invoice clickable
- **Lampiran/Bukti**: upload file gambar atau link eksternal (Google Drive)

### Aksi pada Detail

- **Edit** — hanya untuk DRAFT/SUBMITTED/REJECTED (admin); VERIFIED hanya SUPERADMIN
- **Submit** — kalau DRAFT/REJECTED → SUBMITTED
- **Verify** — admin → VERIFIED (lock)
- **Reject** — admin → REJECTED dengan alasan
- **Cancel** — soft-cancel (audit trail tetap ada)

### Aturan Khusus

- **Ubah jenis (kind)**: boleh selama status bukan VERIFIED dan belum ter-alokasi ke invoice. Pindah jenis akan reset field yang tidak berlaku (mis. invoice_id, recipient, items).
- **Hard delete**: hanya SUPERADMIN, hanya kalau tx tidak punya alokasi.

---

## 9. Invoice (Hutang & Piutang)

URL: `/invoices`

### List Invoice

- Tab filter: **Semua / Draft / Belum Lunas / Sebagian / Lunas / Jatuh Tempo / Dibatalkan**
- Tab tipe: **Semua / Hutang (IN) / Piutang (OUT)**
- Search by nomor/party

### Buat Invoice Baru

Klik **+ Tambah Invoice**.

**Field utama**:
- **Tipe**: IN (hutang ke vendor) atau OUT (piutang dari klien)
- **Nomor invoice** (manual atau auto-generate)
- **Proyek**, **Vendor/Klien**
- **Tanggal invoice**, **Tanggal jatuh tempo**
- **Items** (multi-line): deskripsi · qty · unit · harga satuan · total
- **PPN/PPh** (otomatis dari default proyek atau bisa override)
- **Subtotal, pajak, total** (auto-calc)
- **Lampiran** (PDF/gambar invoice asli)

### Detail Invoice

Klik invoice → drawer detail.

**Section**:
- **Header**: nomor, tipe, status, total, tanggal
- **Pihak**: vendor (untuk IN) atau klien (untuk OUT)
- **Proyek**
- **Items table** (rincian)
- **Pembayaran (Allocations)** — list transaksi yang membayar invoice ini:
  - Tx ID **clickable** → buka detail transaksi
  - Tanggal · metode · nominal alokasi
  - Untuk SUPERADMIN/admin: tombol hapus alokasi (jika perlu koreksi)
- **Outstanding** (sisa yang belum dibayar)

### Workflow Invoice IN (Hutang)

1. Vendor kirim invoice fisik/email → buat di sistem (status DRAFT)
2. Issue invoice → status ISSUED (siap dibayar)
3. Bayar lewat transaksi OUT kind=INVOICE_PAYMENT → otomatis create allocation
4. Status auto-update: PARTIALLY_PAID / PAID

### Workflow Invoice OUT (Piutang)

1. Buat invoice (status DRAFT)
2. Issue → kirim ke klien
3. Klien transfer → catat sebagai transaksi IN
4. Buat allocation manual (di detail invoice → klik "Tambah alokasi" → pilih transaksi)
5. Status auto-update

### Deep Link

- `/invoices?id=N` → buka detail invoice ID `N`
- `/invoices?project_id=X&status=ISSUED` → filter list ke proyek X + status ISSUED

---

## 10. Purchase Order (PO)

URL: `/purchase-orders`

### Konsep

PO adalah pemesanan **ke vendor** sebelum invoice. Berguna untuk:
- Mencatat komitmen pembelian
- Tracking realisasi (apakah vendor sudah terbit invoice untuk PO ini)
- Audit procurement

### Buat PO

Klik **+ Tambah PO**.

**Field**:
- Nomor PO (auto/manual)
- Tanggal PO, Tanggal kebutuhan
- **Vendor**, **Proyek**
- Termin pembayaran (mis. "30 hari setelah invoice")
- **Items** (deskripsi, qty, unit, harga, total)
- Subtotal, diskon, pajak, total (auto-calc)
- Catatan
- Lampiran

### Workflow PO

`DRAFT` → `ISSUED` → `APPROVED` → `PARTIALLY_FULFILLED` → `FULFILLED` (atau `CANCELLED`)

### Detail PO — Procurement Chain

Buka detail PO → section **"Procurement Chain"** menampilkan:

- **TX yang dibayar lewat PO ini** (via `tx.purchase_order_id`):
  - Tx #ID, tanggal, status, jumlah
- **Invoice yang dibayar oleh TX** (nested):
  - Indent dengan border kiri biru
  - Invoice nomor + status + jumlah alokasi
  - Clickable → drilldown ke detail invoice

```
PO #PO/2026/05/001 — Rp 50.000.000
├─ Tx #234 — Rp 25.000.000 (INVOICE_PAYMENT, VERIFIED)
│  └─ 📄 INV/2026/05/001 (PAID) — Rp 25.000.000
└─ Tx #235 — Rp 25.000.000 (INVOICE_PAYMENT, SUBMITTED)
   └─ 📄 INV/2026/05/002 (PARTIALLY_PAID) — Rp 25.000.000
```

---

## 11. Dana Operasional (Kas Bon)

URL: `/transactions/cash-advances`

### Konsep

**Cash Advance** = uang muka yang diberikan ke staff untuk operasional lapangan. **Bukan beban** sampai dipertanggungjawabkan.

Lifecycle:
1. **Pencairan** — kasir keluarkan uang ke staff (Dr. Uang Muka / Kr. Kas)
2. **Penggunaan** — staff pakai untuk bayar berbagai keperluan
3. **Pertanggungjawaban (Settlement)** — staff lapor rincian + struk
4. **Pelunasan** — sisa uang dikembalikan ke kas atau di-top-up kalau kurang

### Halaman Hub Dana Operasional

**2 tab**:

#### Tab "Belum di-settle"

List per-tx advance yang belum dipertanggungjawabkan:
- **Penerima**, tanggal, Tx #ID, deskripsi
- **Age warning** (≥14 hari → badge kuning, peringatan untuk follow-up)
- **Nominal**, tombol **"Settle →"**

#### Tab "Saldo per Penerima"

Grouping by recipient (User atau nama bebas). Per row:
- **Nama penerima**, jumlah advance count, jumlah unsettled
- **Outstanding** (warna warning kalau > 0)
- Progress: settled / total

### Workflow Settlement

Klik **"Settle"** pada advance tx yang masih outstanding → dialog terbuka:

**Form**:
- **Tanggal settle**
- **Dikembalikan ke kas** (sisa uang yang kembali)
- **Rincian** (multi-line items):
  - Per item: Deskripsi · Kategori · Nominal
  - **Bayar invoice (opsional)** — dropdown invoice OPEN dari proyek yang sama
    - Kalau dipilih → backend auto-bikin `InvoiceAllocation` dari advance tx ke invoice itu
    - Cocok untuk: "kas bon dipakai bayar tagihan listrik vendor"
- **Catatan** (opsional)

**Live summary** (di bawah form):
- Sum rincian + Dikembalikan + Total terhitung
- Bandingkan dengan advance amount
- Status:
  - `< advance` → **error** "must_match" (sisa harus masuk "Dikembalikan ke kas")
  - `= advance` → **OK, settle full**
  - `> advance` → **OK, sistem auto-create top-up tx** (kind=DIRECT_EXPENSE) untuk selisih

### Aturan Khusus

- Advance & invoice **harus dari proyek yang sama** — backend validate (`invoice_wrong_project`)
- Settlement bisa dihapus (untuk koreksi). Top-up tx (jika ada) ikut soft-delete. Invoice allocation juga di-soft-delete + status invoice di-recompute.

### View Sudah Settled (Read-only)

Klik tombol pada row yang sudah SETTLED → dialog read-only:
- List items dengan link ke invoice (jika ada)
- Total returned + top-up info
- Tombol "Hapus Settlement" (untuk koreksi)

---

## 12. Asisten OCR (Ekstraksi Dokumen)

URL: `/ocr`

**Akses**: SUPERADMIN & CENTRAL_ADMIN

### Konsep

Upload foto/PDF invoice/struk → AI ekstrak data ke draft invoice yang bisa di-review dan disimpan.

### Pilih Engine

Card radio 2 pilihan (yang aktif tergantung API key di Pengaturan):

| Engine | Kelebihan | Biaya per dokumen |
|---|---|---|
| **Claude Vision (Haiku)** | Akurasi tinggi, jago tulisan tangan rumit | ~$0.01 / gambar |
| **Mistral OCR** | Lebih murah, support PDF multi-page natif | ~$0.002 / halaman |

Setiap card punya tombol **"Test koneksi"** independen untuk verifikasi auth + latency.

### Upload

1. Pilih engine
2. Pilih **Jenis dokumen**: Invoice / Kuitansi / Purchase Order
3. Upload file (drag-drop atau pilih) — atau paste URL eksternal
4. Klik **Extract** → loading 10-30 detik
5. Hasil tampil sebagai **OCR Draft** dengan confidence score

### Review Draft

- **Confidence ≥85%** → hasil reliable, bisa langsung "Buat Invoice"
- **Confidence 50-70%** → tulisan tangan rapi, perlu review manual
- **Confidence <40%** → sulit dibaca, manual edit field

Klik **"Buat Invoice"** → form pre-filled, edit jika perlu, save.

### Discard Draft

Klik trash icon pada draft → hapus (kalau hasil OCR salah/blur dan tidak akan dipakai).

---

## 13. Laporan & Export

URL: `/reports`

### Section Laporan

Setiap section punya filter periode + proyek + extra filter spesifik. Tombol **PDF** + **Excel**.

#### Cashflow
- Total in/out per kategori per periode
- Hanya tx VERIFIED

#### Transaksi Detail
- Filter: Status, Arah (IN/OUT), **Jenis** (Bayar Invoice / Dana Operasional / Beban Langsung)
- Berguna untuk audit & rekonsiliasi

#### Dana Operasional
- Filter: Status Settle (Belum Lapor / Sudah Lapor)
- Kolom: Tanggal, Penerima, Proyek, Pengeluaran, Status, Sudah Lapor, Outstanding
- Summary: Total Disbursed, Total Settled, Total Outstanding, Avg Age

#### Beban Langsung
- Per **line item** (bukan per tx) — supaya breakdown kategori jelas
- Filter: Proyek, Kategori, Periode

#### Invoice
- Filter: Tipe (Hutang/Piutang), Status
- Riwayat lengkap

#### Detail Invoice (Interaktif)
- Tabel flatten semua item dari seluruh invoice
- Filter periode/proyek/tipe/status
- Export CSV langsung di browser

#### Hutang & Piutang
- Aging report — invoice outstanding dgn bucket umur

#### Budget
- Realisasi vs target per proyek

#### Purchase Order
- List PO + status fulfillment

#### Audit Log (SUPERADMIN/CENTRAL_ADMIN)
- Riwayat semua perubahan (create/update/delete/verify/cancel) per user

### Format Export

- **PDF**: dengan logo perusahaan, header, footer "Confidential", page numbering
- **Excel**: raw numbers (bisa SUM/formula langsung di Excel, locale-aware separator)

---

## 14. Master Data

URL: `/master/...`

### Proyek (`/master/projects`)

CRUD proyek. Field:
- Kode (immutable kalau sudah ada transaksi)
- Nama, Lokasi, **Dinas/Instansi/Klien** (tampil di header PDF PO/Invoice)
- Perusahaan, PIC, **Pendana** (multi-select)
- Periode (tanggal mulai-selesai)
- Status (Aktif/Selesai/Ditahan/Dibatalkan)
- **Budget control**: project_value, budget_amount, overbudget_tolerance_pct
- **Tax defaults**: PPN %, PPh %, marketing %

### Perusahaan (`/master/companies`)

Multi-tenant — satu instance bisa multi perusahaan. Field: nama, NPWP, alamat, telepon, email, **logo** (untuk header PDF), **letterhead**, nama direktur, bank account.

### Kategori (`/master/categories`)

Kategori untuk grouping transaksi & laporan. Tipe IN / OUT.

### Vendor / Klien (`/master/vendors-clients`)

Master pihak eksternal. Tipe: Vendor / Client / Both. Field: nama, NPWP, alamat, bank.

### Pendana (`/master/funders`)

Master sumber dana (APBN, APBD, Swasta, dll). Many-to-many ke proyek.

### Pengguna (`/master/users`)

CRUD user. Field:
- Email, Nama, Password
- **Role** (SUPERADMIN/CENTRAL_ADMIN/PROJECT_ADMIN/EXECUTIVE)
- Status aktif
- Telepon
- **Scope semua proyek** (untuk EXECUTIVE)
- **Force-link Telegram chat_id** (SUPERADMIN only)
- **Force-link nomor WhatsApp** (auto-convert ke `<msisdn>@c.us`)

### Akses Proyek (sub-section di edit user)

Untuk user non-scope-all, tambahkan proyek-proyek yang user boleh akses.

---

## 15. Integrasi Telegram & WhatsApp

### Setup Awal (SUPERADMIN)

#### Telegram
1. Buat bot via **@BotFather** di Telegram → dapat **Bot Token**
2. Buka `/settings/system` → section "Telegram Bot":
   - Set `TELEGRAM_BOT_TOKEN`
   - Set `TELEGRAM_WEBHOOK_SECRET` (random string)
3. Set `PUBLIC_BASE_URL` di section "Sistem" (mis. `https://api.cvbintang.com`)
4. **Restart deploy** — backend register webhook otomatis ke Telegram

#### WhatsApp (via WAHA)

Setup WhatsApp lebih panjang dari Telegram (perlu self-host WAHA +
scan QR). **Panduan lengkap step-by-step**: lihat
[`docs/setup-whatsapp.md`](setup-whatsapp.md).

Ringkasnya:
1. Deploy WAHA (Railway template / Docker / VPS)
2. Set di `/settings/system` section "WhatsApp (WAHA)":
   - `WHATSAPP_BASE_URL` (URL WAHA tanpa trailing slash)
   - `WHATSAPP_SESSION` (default `default`)
   - `WHATSAPP_API_KEY` (header `X-Api-Key` ke WAHA)
3. Set env `WHATSAPP_WEBHOOK_SECRET` (= `WAHA_HMAC_KEY` di WAHA) di
   backend
4. Pair nomor WhatsApp via tombol **Scan QR** di `/settings/system`

### Link Akun User

**Self-service** (via aplikasi):
- User buka `/settings` → generate kode link 6-digit
- Telegram: ketik `/link 123456` ke bot
- WhatsApp: kirim `/link 123456` ke nomor bot WAHA

**Force-link oleh SUPERADMIN**:
- Master Pengguna → edit user → isi "Telegram chat_id" atau "Nomor WhatsApp" langsung → simpan

### Cara Pakai Bot

Command yang didukung (Telegram & WhatsApp):

```
LIHAT DATA
  /saldo [kode]              - saldo semua/specific proyek
  /proyek                    - list proyek user
  /pending                   - tx submitted (admin verify queue)
  /invoice                   - invoice belum lunas
  /draft                     - tx draft milik Anda (siap submit)
  /lihat <tx_id>             - detail satu transaksi

CATAT TRANSAKSI (DRAFT)
  /keluar <kode> <nominal> <deskripsi>
                             - cepat input tx pengeluaran
  /masuk <kode> <nominal> <deskripsi>
                             - cepat input tx pemasukan
  Foto setelahnya: auto-attach ke tx terakhir.

WORKFLOW VALIDASI
  /submit <tx_id>            - kirim tx DRAFT/REJECTED utk validasi
                               (alias: /kirim)
  /verify <tx_id>            - admin verify tx SUBMITTED -> VERIFIED
                               (alias: /verifikasi, /validasi)
  /tolak <tx_id> <alasan>    - admin reject tx (alias: /reject)
  /batal <tx_id> <alasan>    - cancel tx (alias: /cancel)

LAMPIRAN
  /buktitx <tx_id>           - buka jendela 5 menit utk attach
                               foto/PDF (alias: /bukti, /lampiran)

AKUN
  /start                     - cek status akun
  /link <kode>               - hubungkan akun (kode 6 digit dr Pengaturan)
  /unlink                    - putus akun chat
  /help                      - daftar command
```

**Aturan permission**:
- Submit/cancel: user yg punya akses tx
- Verify/tolak: SUPERADMIN + CENTRAL_ADMIN saja
- Tx VERIFIED: hanya SUPERADMIN yg boleh cancel

Foto/gambar yang dikirim **setelah** `/keluar` atau `/masuk` (dalam jendela ~5 menit) **otomatis attach** ke transaksi terakhir.

---

## 16. Pengaturan Sistem (SUPERADMIN)

### `/settings` — Profil

User biasa: ganti nama, telepon, password, kode link Telegram/WhatsApp.

### `/settings/system` — API Keys & Integrasi

SUPERADMIN-only. Section:

- **OCR**: Anthropic API Key, Mistral API Key, default engine, model override
- **Telegram Bot**: Bot Token, Webhook Secret
- **WhatsApp (WAHA)**: Base URL, Session, API Key
- **Sistem**: Public Base URL

**Secret values di-encrypt at rest** dengan Fernet (master key dari `SECRET_KEY` env). Fallback ke env var kalau DB kosong.

**Status badge per row**:
- "Tersimpan" (di DB)
- "Dari env" (fallback)
- "Belum di-set"

### `/settings/role-menus` — Akses Menu per Role

SUPERADMIN-only. Matrix table 3 role × 20 menu. Cell click = toggle visible (hijau ✓) / hidden (merah ✗). Klik Simpan untuk apply.

### `/settings/orphan-files` — File Orphan

SUPERADMIN-only. Scan storage untuk file yang **tidak ter-link** ke entitas mana pun (akibat hard-delete tx/invoice). Bisa bulk delete untuk hemat disk.

**Stats**: Total File · Ter-link · Orphan · Ukuran Orphan.

---

## 17. Alur Kerja Tipikal

### Alur 1: Pembayaran Invoice Vendor

1. Vendor kirim invoice fisik ke kantor
2. Bagian keuangan buka `/invoices` → **+ Tambah Invoice**
   - Tipe: **IN (Hutang)**
   - Pilih vendor, proyek, isi items, total
   - Status: ISSUED
3. Saat siap bayar, buat transaksi:
   - `/transactions` → **+ Tambah Transaksi**
   - Pengeluaran → **Bayar Invoice**
   - Pilih invoice tsb (atau biarkan kosong dan link manual nanti)
   - Submit
4. Admin verify → status VERIFIED
5. Invoice otomatis ter-update jadi PAID (atau PARTIALLY_PAID)

### Alur 2: Pertanggungjawaban Dana Operasional

1. Kasir buat tx Pengeluaran → **Dana Operasional** Rp 5jt ke Pak Joko
2. Submit, admin verify
3. 1 minggu kemudian Pak Joko kembali dengan struk-struk + uang sisa
4. Buka `/transactions/cash-advances` → tab "Belum di-settle"
5. Klik tombol **"Settle"** pada baris Pak Joko
6. Input rincian:
   - Beli material — Rp 3.500.000 (kategori "Material")
   - Bayar tagihan listrik (link invoice INV-XXX) — Rp 1.000.000
   - Dikembalikan ke kas: Rp 500.000
7. Total = 5.000.000 — match
8. Simpan settlement

### Alur 3: Beban Langsung dengan Multi-item

1. Mandor lapangan beli ATK + bensin + parkir total Rp 350rb dengan struk-struk
2. Buat tx Pengeluaran → **Beban Langsung**
3. Tambah rincian:
   - ATK — kategori "ATK" — Rp 150rb
   - Bensin motor — kategori "Transportasi" — Rp 150rb
   - Parkir — kategori "Transportasi" — Rp 50rb
4. Nominal total auto-sum jadi Rp 350rb
5. Upload foto struk-struk sebagai lampiran
6. Submit

### Alur 4: Audit Trail PO → Invoice → Pembayaran

1. Admin buka PO yang sudah issue → buka detail
2. Section "Procurement Chain":
   - Lihat tx mana saja yang dibayar pakai PO ini
   - Lihat invoice mana saja yang sudah dibuat (via allocation)
3. Klik tx atau invoice → drilldown lengkap
4. Untuk export, buka `/reports` → laporan Purchase Order

---

## 18. Troubleshooting

### "Error 422 saat export PDF laporan"

**Penyebab**: filter wajib tidak diisi. Pastikan periode + tipe (jika ada) terisi sebelum download.

### "Error: dynamically imported module failed to load"

**Penyebab**: cache browser stale setelah deploy baru. **Auto-recovery**: aplikasi akan reload window otomatis. Jika tetap muncul, **Ctrl+Shift+R** (hard refresh).

### "Klik invoice di project dashboard tidak buka detail"

Pastikan menggunakan URL deploy terbaru. Fix sudah ada di build terbaru (`?id=N` deep-link).

### "Dropdown user kosong"

Endpoint `/users/lookup` mungkin belum aktif. Pastikan deploy backend terbaru.

### "OCR error: invalid model"

Pastikan `OCR_MODEL_CLAUDE` dan `OCR_MODEL_MISTRAL` di-set sesuai engine. Atau hapus override agar pakai default.

### "Settlement gagal: must_match"

Sum items + Dikembalikan ke kas **harus ≥** advance amount. Kalau kurang, sisanya harus masuk "Dikembalikan ke kas".

### "Verified locked"

Transaksi yang sudah VERIFIED tidak bisa di-edit non-SUPERADMIN. Untuk koreksi, **CANCEL** dulu lalu buat ulang.

### "kind_change_blocked"

Tx sudah ter-alokasi ke invoice. Hapus allocation/unlink dulu sebelum ubah jenis.

---

## 19. Glosarium

| Istilah | Arti |
|---|---|
| **AP** (Account Payable) | Hutang ke vendor (invoice IN belum dibayar) |
| **AR** (Account Receivable) | Piutang dari klien (invoice OUT belum diterima) |
| **Aging** | Pengelompokan umur invoice outstanding (0-30, 31-60, 61-90, >90 hari) |
| **Allocation** | Tabel M:N transaksi ↔ invoice — satu tx bisa bayar beberapa invoice |
| **Audit log** | Riwayat semua perubahan data dengan timestamp + user |
| **BAST** | Berita Acara Serah Terima (jenis dokumen proyek) |
| **Cash Advance / Dana Operasional** | Uang muka ke staff untuk operasional, perlu pertanggungjawaban |
| **DRAFT / SUBMITTED / VERIFIED / REJECTED / CANCELLED** | Status transaksi |
| **DPO** (Days Payable Outstanding) | Rata-rata umur AP |
| **DSO** (Days Sales Outstanding) | Rata-rata umur AR |
| **Force-link** | SUPERADMIN set kontak (TG/WA) user langsung tanpa OTP |
| **Funder / Pendana** | Sumber dana proyek (APBN, APBD, Swasta) |
| **God-mode** | Hak SUPERADMIN untuk bypass audit lock (mis. edit VERIFIED tx) |
| **Hard delete** | Hapus permanen dari DB. Hanya SUPERADMIN. |
| **OCR** | Optical Character Recognition — ekstraksi teks dari gambar/PDF |
| **Orphan file** | File di storage yang tidak ter-link ke entitas DB |
| **PO** (Purchase Order) | Pemesanan ke vendor sebelum invoice |
| **PPN** | Pajak Pertambahan Nilai (default 11%) |
| **PPh** | Pajak Penghasilan (default 2% untuk jasa) |
| **Procurement Chain** | PO → TX → Invoice drilldown untuk audit |
| **Settlement** | Pertanggungjawaban dana operasional dengan rincian struk |
| **SPK** | Surat Perintah Kerja (jenis dokumen proyek) |
| **TxnKind** | Sub-jenis transaksi pengeluaran (INVOICE_PAYMENT / CASH_ADVANCE / DIRECT_EXPENSE) |
| **WAHA** | WhatsApp HTTP API self-hosted untuk integrasi bot WA |

---

**Dokumen ini akan di-update mengikuti rilis fitur baru.**  
Pertanyaan / saran: hubungi SUPERADMIN tenant Anda.
