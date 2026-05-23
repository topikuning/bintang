# CACAK Backend

FastAPI backend untuk aplikasi pencatatan keuangan multi-proyek.

## Quick start (lokal, tanpa Docker)

```bash
# install uv (jika belum): https://docs.astral.sh/uv/
uv venv
source .venv/bin/activate
uv pip install -e ".[dev]"

# init db & seed demo data
alembic upgrade head
python -m app.seed

# run dev server
uvicorn app.main:app --reload --port 8000
```

Swagger UI: http://localhost:8000/docs

## Default credentials (dari seed)
- Superadmin: `admin@cacak.app` / `admin123` (akses semua proyek)
- PM Budi: `budi@cacak.app` / `pm123` (PRJ-001, PRJ-002)
- PM Sari: `sari@cacak.app` / `pm123` (PRJ-003, PRJ-004)
- PM Agus: `agus@cacak.app` / `pm123` (PRJ-005)

## Telegram bot (opsional)

Aktifkan dengan tiga env var (jangan commit):

```bash
TELEGRAM_BOT_TOKEN=<token dari @BotFather>
TELEGRAM_WEBHOOK_SECRET=<random panjang, mis. `openssl rand -hex 24`>
PUBLIC_BASE_URL=https://api.domainmu.com    # tanpa trailing slash
```

Saat startup, server akan register webhook ke
`PUBLIC_BASE_URL/api/v1/telegram/webhook` lengkap dengan secret. Kalau
`PUBLIC_BASE_URL` kosong, registrasi dilewati — daftarkan manual lewat
`POST https://api.telegram.org/bot<TOKEN>/setWebhook`.

User mengaktifkan bot dari halaman **Pengaturan** web → tombol
*Buat Kode Tautan* → kirim `/link 123456` ke bot.

Perintah yang sudah ada:

| Perintah | Fungsi |
|---|---|
| `/help` | daftar perintah |
| `/saldo` | saldo semua proyek user |
| `/saldo PRJ-001` | saldo + budget proyek tertentu |
| `/proyek` | list proyek |
| `/pending` | transaksi belum diverifikasi (admin) |
| `/invoice` | invoice belum lunas |
| `/keluar PRJ-001 5000000 Beli semen` | buat transaksi OUT (DRAFT) |
| `/masuk PRJ-001 10000000 Termin 1` | buat transaksi IN (DRAFT) |
| `/link 123456` | hubungkan akun |
| `/unlink` | putuskan akun |

Foto/PDF yang dikirim ke bot dalam 5 menit setelah `/keluar` atau
`/masuk` otomatis dilampirkan ke transaksi yang baru dibuat.

Notifikasi keluar (best-effort, tidak blok response):
- transaksi di-submit → admin proyek terkait yang sudah link kebagian ping
- diverifikasi/ditolak → pembuat transaksi diberi tahu
