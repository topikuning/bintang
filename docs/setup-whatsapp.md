# Setup WhatsApp Bot (via WAHA)

Panduan setup integrasi WhatsApp untuk Bintang. Backend memakai
[WAHA](https://waha.devlike.pro/) (WhatsApp HTTP API self-hosted)
sebagai bridge — Bintang tidak konek langsung ke WhatsApp.

```
[User HP]   <->   [WAHA server]   <->   [Bintang backend]
  WhatsApp        REST API/Webhook       /api/v1/whatsapp/webhook
```

WAHA pegang sesi WhatsApp Web (perlu scan QR sekali), backend cuma
panggil HTTP API-nya dan terima webhook.

> **Kontras dengan Telegram**: Telegram pakai Bot API resmi
> (`api.telegram.org`), tidak perlu self-host apa pun. WhatsApp tidak
> menyediakan Bot API publik — WAHA mensimulasikan WhatsApp Web di
> Chromium headless.

---

## Daftar isi

1. [Pre-requisite](#1-pre-requisite)
2. [Deploy WAHA server](#2-deploy-waha-server)
3. [Konfigurasi backend Bintang](#3-konfigurasi-backend-bintang)
4. [Pair nomor WhatsApp (scan QR)](#4-pair-nomor-whatsapp-scan-qr)
5. [Daftarkan webhook di WAHA](#5-daftarkan-webhook-di-waha)
6. [Test koneksi](#6-test-koneksi)
7. [End-user: link akun ke bot](#7-end-user-link-akun-ke-bot)
8. [Troubleshooting](#8-troubleshooting)
9. [Referensi](#9-referensi)

---

## 1. Pre-requisite

- Backend Bintang sudah deploy & accessible dari internet
  (`PUBLIC_BASE_URL` ke-set, mis. `https://api.bintang.example.com`).
- Nomor WhatsApp khusus untuk bot (disarankan nomor terpisah, bukan
  nomor pribadi). Bisa nomor virtual (Twilio, Vonage) atau eSIM.
- Akses admin (`SUPERADMIN`) di Bintang untuk halaman
  `/settings/system`.
- Server untuk WAHA (RAM minimal 1 GB, butuh Chromium running terus).

---

## 2. Deploy WAHA server

Pilih salah satu opsi. **Railway template paling cepat untuk MVP**.

### Opsi A: Railway (1-click)

1. Buka https://railway.app/template/waha (atau cari "WAHA" di
   template marketplace Railway).
2. Klik **Deploy** → pilih GitHub account.
3. Env yang perlu di-set di project WAHA:

   | Env | Nilai | Catatan |
   |---|---|---|
   | `WHATSAPP_API_KEY` | (random, mis. `openssl rand -hex 24`) | Wajib di prod. Backend kirim header `X-Api-Key`. |
   | `WHATSAPP_HOOK_URL` | `https://api.bintang.example.com/api/v1/whatsapp/webhook` | URL webhook backend Bintang. |
   | `WHATSAPP_HOOK_EVENTS` | `message,message.any,session.status` | Event yg dibutuhkan. |
   | `WAHA_HMAC_KEY` | (random, mis. `openssl rand -hex 32`) | Untuk signature webhook. **Catat nilainya** — masuk ke env Bintang juga (`WHATSAPP_WEBHOOK_SECRET`). |

4. Setelah deploy, generate domain publik (Settings → Networking →
   Generate Domain). Catat URL-nya, mis. `https://waha-prod.up.railway.app`.

### Opsi B: Docker (self-host VPS)

```bash
docker run -d \
  --name waha \
  --restart unless-stopped \
  -p 3000:3000 \
  -e WHATSAPP_API_KEY="$(openssl rand -hex 24)" \
  -e WHATSAPP_HOOK_URL="https://api.bintang.example.com/api/v1/whatsapp/webhook" \
  -e WHATSAPP_HOOK_EVENTS="message,message.any,session.status" \
  -e WAHA_HMAC_KEY="$(openssl rand -hex 32)" \
  -v waha-data:/app/.sessions \
  devlikeapro/waha:latest
```

> **Penting**: volume `/app/.sessions` mounted — sesi WhatsApp
> persistent setelah restart. Tanpa ini, harus scan QR ulang.

Pasang di balik Nginx/Caddy + TLS. Catat nilai `WHATSAPP_API_KEY` dan
`WAHA_HMAC_KEY` — perlu untuk konfigurasi backend.

### Opsi C: WAHA Plus (multi-session, lisensi berbayar)

Untuk yang butuh > 1 session WhatsApp simultan (mis. multi-tenant),
pakai [WAHA Plus](https://waha.devlike.pro/plus). Bintang sudah
support `WHATSAPP_SESSION` field — tinggal set nama session per
deployment.

---

## 3. Konfigurasi backend Bintang

Bintang menyimpan setting WAHA di tabel `app_settings` (bisa
diubah dari UI tanpa redeploy), bukan env var langsung. Tapi env var
default tetap berfungsi sebagai initial value kalau row belum ada.

### Via UI (rekomendasi)

1. Login sebagai `SUPERADMIN`.
2. Buka **Pengaturan → Sistem** (`/settings/system`).
3. Cari section **WhatsApp (WAHA)**, isi:
   - `WHATSAPP_BASE_URL`: URL WAHA tanpa trailing slash, mis.
     `https://waha-prod.up.railway.app`
   - `WHATSAPP_SESSION`: nama session, default `default`
   - `WHATSAPP_API_KEY`: API key yg di-set di WAHA tadi
4. Klik **Simpan**. Setting cache di-invalidate otomatis.

### Via env var (initial / fallback)

Set di Railway / `.env` backend (catatan: setting UI menang kalau row
ada):

```bash
WHATSAPP_BASE_URL=https://waha-prod.up.railway.app
WHATSAPP_SESSION=default
WHATSAPP_API_KEY=<sama dengan yg di WAHA>
WHATSAPP_WEBHOOK_SECRET=<sama dengan WAHA_HMAC_KEY di WAHA>
```

> **`WHATSAPP_WEBHOOK_SECRET`**: ini env var, **bukan** disetel via UI
> (alasan keamanan). Wajib match dengan `WAHA_HMAC_KEY` di WAHA, atau
> webhook akan ditolak (401). Boleh kosong untuk dev, tapi jangan di
> prod.

---

## 4. Pair nomor WhatsApp (scan QR)

Setelah `WHATSAPP_BASE_URL` di-set, halaman `/settings/system` akan
menampilkan section status & QR code.

1. Buka `/settings/system`.
2. Section **Status WhatsApp** akan menampilkan satu dari:
   - `STOPPED` → klik **Start Session**.
   - `SCAN_QR_CODE` → QR code muncul; lanjut step 3.
   - `WORKING` → sudah ter-pair, skip.
   - `FAILED` → klik **Restart Session** dan tunggu.
3. Buka WhatsApp di HP nomor bot → menu **Linked Devices** →
   **Link a Device**.
4. Scan QR yg muncul di halaman Bintang. Status berubah jadi
   `WORKING` dalam beberapa detik.

> Kalau QR habis (refresh diperlukan), klik tombol **Refresh QR** —
> WAHA generate QR baru.

### Endpoint reference

| Method | Endpoint | Fungsi |
|---|---|---|
| `GET` | `/api/v1/whatsapp/session` | Status session (admin) |
| `GET` | `/api/v1/whatsapp/qr` | PNG QR code (admin) |
| `POST` | `/api/v1/whatsapp/restart` | Restart session (admin) |
| `POST` | `/api/v1/whatsapp/logout` | Logout/unpair (admin) |

---

## 5. Daftarkan webhook di WAHA

Kalau pakai env `WHATSAPP_HOOK_URL` (step 2), webhook sudah otomatis
terdaftar. Verifikasi via WAHA dashboard atau API:

```bash
curl https://waha-prod.up.railway.app/api/sessions/default \
  -H "X-Api-Key: $WHATSAPP_API_KEY" | jq .config.webhooks
```

Output harus include URL Bintang. Kalau belum:

```bash
curl -X PUT https://waha-prod.up.railway.app/api/sessions/default \
  -H "X-Api-Key: $WHATSAPP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "webhooks": [{
        "url": "https://api.bintang.example.com/api/v1/whatsapp/webhook",
        "events": ["message", "message.any", "session.status"],
        "hmac": {"key": "<WAHA_HMAC_KEY>"}
      }]
    }
  }'
```

> **HMAC**: kalau `hmac.key` diset di WAHA, WAHA akan tanda-tangani
> setiap webhook dengan `X-Webhook-Hmac` header (SHA-512). Backend
> Bintang verifikasi pakai `WHATSAPP_WEBHOOK_SECRET`. Wajib match.

---

## 6. Test koneksi

### A. Status integrasi

Buka `GET /api/v1/whatsapp/health` (perlu auth) atau lihat UI
`/settings/system`. Harus ada:

```json
{
  "configured": true,
  "toggle_enabled": true,
  "waha_reachable": true,
  "session_status": "WORKING",
  "session_name": "default",
  "waha_url": "https://waha-prod.up.railway.app",
  "engine": "WEBJS"
}
```

`waha_reachable=true` + `session_status=WORKING` = ready.

### B. Test kirim pesan dari UI

Section **Test Koneksi** di `/settings/system` punya tombol "Kirim
pesan tes":

1. Isi nomor tujuan (format `08xxx` atau `628xxx`).
2. Tulis pesan singkat (mis. "Halo dari Bintang").
3. Klik **Kirim** — pesan harus sampai di WhatsApp tujuan dalam < 5
   detik.

### C. Test bot reply

Kirim `/help` ke nomor bot dari HP lain. Bot harus reply daftar
perintah. Kalau tidak reply:

- Cek log backend: `app.api.v1.whatsapp` — webhook masuk?
- Cek WAHA log: webhook delivery success?
- Cek `WHATSAPP_WEBHOOK_SECRET` match dengan `WAHA_HMAC_KEY`.

---

## 7. End-user: link akun ke bot

Setiap user yang mau pakai bot harus link akun web mereka ke chat
WhatsApp masing-masing. Flow:

1. User buka **Pengaturan** di web → section **WhatsApp Bot** → klik
   **Generate Kode Tautan**.
2. Bintang issue kode 6 digit (TTL 10 menit).
3. User kirim `/link 123456` ke nomor bot WhatsApp.
4. Bot reply "✅ Terhubung sebagai <nama>". Bintang isi
   `User.whatsapp_chat_id` dengan chat_id WA user.
5. Selanjutnya user bisa pakai semua perintah bot (`/saldo`,
   `/keluar`, `/po`, dst).

### Alternatif: admin force-link

`SUPERADMIN` / `CENTRAL_ADMIN` bisa link langsung dari master user
tanpa kode:

1. **Master → Pengguna** → edit user.
2. Field **Nomor WhatsApp** (`whatsapp_chat_id`) isi langsung dengan
   nomor (format `628xxx`). Backend auto-convert ke
   `628xxx@c.us`.
3. Simpan.

Berguna untuk on-boarding cepat tanpa user perlu kirim apa-apa.

---

## 8. Troubleshooting

| Gejala | Kemungkinan penyebab | Fix |
|---|---|---|
| `waha_reachable: false` di health | URL salah / WAHA mati / firewall | Cek `WHATSAPP_BASE_URL` (tanpa trailing slash), curl WAHA dari server backend, cek port |
| Webhook 401 ke backend | `WHATSAPP_WEBHOOK_SECRET` mismatch dengan `WAHA_HMAC_KEY` | Set keduanya sama, restart kedua service |
| Bot tidak reply `/help` | User belum link, atau `whatsapp_chat_id` belum di-set | Cek tabel `users` row → field `whatsapp_chat_id` |
| Pesan kirim sukses tapi tidak sampai | Nomor format salah, atau receiver tidak punya WhatsApp | Pastikan format `<msisdn>@c.us` (no `+`, no `-`) |
| Sesi WORKING → FAILED tiba-tiba | WhatsApp logout dari Linked Devices, atau WAHA crash | Klik **Restart Session** di UI, scan QR ulang kalau perlu |
| Media (foto/PDF) tidak ke-download | URL media di webhook host internal WAHA | Sudah di-handle backend (`_rewrite_to_external`) — kalau masih gagal cek log `whatsapp` di backend |
| `/po` parsing salah | AI feature `po_chat_parser` perlu prompt tweaking | Edit prompt di **Pengaturan → AI Settings** → feature "Parser Chat -> PO" |
| Webhook delay (> 30 detik) | WAHA queue penuh / Chromium hang | Restart WAHA service (container restart) |

### Log mana yang dilihat

- Backend Bintang: log level `INFO` di module `app.api.v1.whatsapp`
  (webhook in) dan `app.services.whatsapp.client` (outbound).
- WAHA: container log via Railway / `docker logs waha`.

### Reset penuh

Kalau semua macet, urut langkah ini:

1. Stop bot toggle di **Pengaturan → Sistem** (master switch).
2. WAHA: logout session (`POST /api/v1/whatsapp/logout`).
3. WAHA: restart container.
4. Backend: pastikan `WHATSAPP_BASE_URL` + `WHATSAPP_API_KEY` benar.
5. Scan QR baru dari `/settings/system`.
6. Test ulang dari step 6.

---

## 9. Referensi

### Env var backend

| Env | Wajib | Default | Catatan |
|---|---|---|---|
| `WHATSAPP_BASE_URL` | ya (di UI/env) | `""` | URL WAHA, tanpa trailing slash. Boleh dipindah lewat UI tanpa redeploy. |
| `WHATSAPP_SESSION` | tidak | `"default"` | Nama session WAHA. Pakai > 1 kalau Plus. |
| `WHATSAPP_API_KEY` | rekomendasi | `""` | Header `X-Api-Key`. Wajib kalau WAHA pakai auth. |
| `WHATSAPP_WEBHOOK_SECRET` | rekomendasi | `""` | Match `WAHA_HMAC_KEY`. Wajib di prod. |

### Env var WAHA (sisi server WAHA)

| Env | Tujuan |
|---|---|
| `WHATSAPP_API_KEY` | Auth API (sama dengan backend) |
| `WHATSAPP_HOOK_URL` | URL webhook backend Bintang |
| `WHATSAPP_HOOK_EVENTS` | `message,message.any,session.status` |
| `WAHA_HMAC_KEY` | Signature webhook (= `WHATSAPP_WEBHOOK_SECRET` Bintang) |

### Endpoint backend WhatsApp

| Method | Path | Auth | Fungsi |
|---|---|---|---|
| `GET` | `/api/v1/whatsapp/health` | login | Status integrasi |
| `GET` | `/api/v1/whatsapp/session` | superadmin | Detail session WAHA |
| `GET` | `/api/v1/whatsapp/qr` | superadmin | QR PNG untuk pairing |
| `POST` | `/api/v1/whatsapp/restart` | superadmin | Restart session |
| `POST` | `/api/v1/whatsapp/logout` | superadmin | Unpair |
| `POST` | `/api/v1/whatsapp/webhook` | HMAC | Receiver event WAHA |
| `POST` | `/api/v1/whatsapp/me/link-code` | login | Generate kode link 6 digit |
| `POST` | `/api/v1/whatsapp/me/unlink` | login | Putuskan tautan |
| `GET` | `/api/v1/whatsapp/me/status` | login | Status link user |

### Perintah bot yang didukung

Sama dengan Telegram (lihat `app/services/whatsapp/commands.py`):

| Perintah | Fungsi |
|---|---|
| `/help` | Daftar perintah |
| `/link <kode>` | Hubungkan akun web |
| `/unlink` | Putuskan akun |
| `/saldo [kode]` | Saldo proyek |
| `/proyek` | Daftar proyek aktif |
| `/pending` | TX belum diverifikasi (admin) |
| `/invoice` | Invoice belum lunas |
| `/draft` | TX draft milik user |
| `/lihat <id>` | Detail TX |
| `/keluar <kode> <jumlah> <deskripsi>` | Buat TX OUT (DRAFT) |
| `/masuk <kode> <jumlah> <deskripsi>` | Buat TX IN (DRAFT) |
| `/buktitx <id>` | Buka jendela 5 menit upload bukti |
| `/submit <id>` / `/verify <id>` / `/tolak <id>` / `/batal <id>` | Workflow validasi |
| `/po` + body multi-baris | **Buat PO via AI parser** (lihat di bawah) |
| `/tanya <pertanyaan>` | Tanya laporan natural (admin) |
| `/ringkas` | Ringkasan executive hari ini (admin) |

### Format `/po` (AI parser)

User kirim 1 pesan:

```
/po
Besi 10 polos = 270 lonjor
Besi 8 polos = 290 lonjor @ 95000
Wiremesh M8 bulat = 228 lembar
proyek BMJ1
vendor PT Sumber Besi
catatan: kirim sebelum jumat
```

Bot AI-parse → reply preview (proyek, vendor, daftar item, estimasi
total) → user balas **ya** untuk simpan sebagai PO **DRAFT**. Balas
**batal** untuk batalkan. Session TTL 10 menit.

- Harga satuan **opsional** (`@ 95000` / `harga 95000`). Kalau hilang,
  unit_price default `0` — user lengkapi di web.
- Proyek dicari by code exact (case-insensitive) lalu by name partial
  (ilike). Scoped ke proyek yg user punya akses, status `AKTIF`.
- Vendor dicari di master `vendors_clients` (ilike). Tidak ketemu →
  dipakai sebagai string di `PO.vendor_name`.

---

## Diff vs Telegram

| Aspek | Telegram | WhatsApp (WAHA) |
|---|---|---|
| Bridge | Bot API resmi (gratis) | Self-host WAHA (Chromium) |
| Pairing | Token dari @BotFather sekali | Scan QR per device, bisa logout |
| Multi-session | Per token | Per WAHA instance (Core) atau multi-session (Plus) |
| Cost | $0 | $5-15/bulan VPS atau Railway |
| Reliability | Sangat tinggi | Tergantung WhatsApp Web stability |
| Format reply | HTML | Markdown WhatsApp (`*bold*`, `_italic_`) |

Saran: pakai **Telegram untuk admin/internal** (reliable, gratis),
**WhatsApp untuk user lapangan** (sudah pasti pakai WA, no install).
