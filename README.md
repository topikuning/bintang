# Bintang

**Bintang — Biaya, Investasi dan Tata Anggaran Gerak.**
Aplikasi web pencatatan & monitoring keuangan multi-proyek, mobile-first.

## Fitur utama

- Multi proyek dengan dashboard global & per proyek.
- Pencatatan transaksi masuk/keluar (DRAFT → SUBMITTED → VERIFIED → REJECTED/CANCELLED).
- Upload bukti (kamera HP, galeri, PDF, multi-file) — siap untuk OCR/AI invoice extraction.
- Invoice masuk (hutang) & keluar (piutang) dengan status auto (draft/issued/partially paid/paid/overdue/cancelled).
- Purchase Order dengan **nomor otomatis**, **PDF berkop perusahaan** (WeasyPrint).
- Kontrol budget per proyek (aman / mendekati batas / overbudget).
- Laporan: Cashflow, Transaksi, Invoice, Hutang/Piutang, Budget, PO, Audit log — **export PDF & XLSX**.
- Audit log otomatis untuk semua perubahan data keuangan.
- Soft delete, role-based access (Superadmin / Project Admin).
- AI Invoice Extraction (Claude Vision / Mistral Document AI, bisa diatur dari UI).

## Stack

- **Backend**: FastAPI 0.136, Python 3.13, SQLAlchemy 2.0 (async), Pydantic 2, WeasyPrint, openpyxl, JWT.
- **Frontend**: React 19.2, Vite 8.2, TypeScript 6 (tooling-compatible) + TypeScript Native 7, Tailwind CSS 4.3, TanStack Query 5 + Table 8, React Router 8.3, Radix UI, Recharts 3.10.
- **DB**: SQLite (dev) / PostgreSQL 18 (prod).

### Satu service, satu origin

Sejak 2026-06-13 frontend dan backend **tidak lagi terpisah**. `Dockerfile`
di root mem-build SPA lalu menyalinnya ke dalam image backend, dan FastAPI
yang menyajikannya. Konsekuensinya:

- Railway cukup **dua** service: Postgres + aplikasi ini.
- SPA dan API satu origin, jadi CORS tidak lagi berperan (`ALLOWED_ORIGINS`
  boleh kosong) dan `VITE_API_BASE_URL` tidak perlu diisi per-environment.
- Lampiran di `/files/*` **wajib login** dan dicek akses proyeknya; tag
  `<img>` tetap bekerja lewat cookie HttpOnly ber-scope `/files` yang
  di-set saat login.

## Quick start (Docker)

```bash
cp .env.example .env
docker compose build
docker compose up -d

# Migrasi dijalankan otomatis di entrypoint sebelum app start.
# Lalu pilih salah satu seed:
# A) clean install (1 admin + 12 kategori default, tanpa data demo)
docker compose exec app python -m app.seed_master
# B) demo data lengkap (3 perusahaan, 5 proyek, 30+ transaksi, dst)
docker compose exec app python -m app.seed

# Buka -- SPA dan API di port yang SAMA:
# http://localhost:8000       (aplikasi)
# http://localhost:8000/docs  (Swagger)
```

## Deploy ke Railway

Lihat [`RAILWAY.md`](./RAILWAY.md) untuk panduan rinci — **2 service**: Postgres + aplikasi (SPA & API dalam satu image), dengan persistent volume untuk uploads.

## Quick start (lokal tanpa Docker)

Saat dev, backend dan frontend tetap dijalankan terpisah supaya HMR Vite
bekerja. Vite sudah punya proxy ke `/api` dan `/files`, jadi tidak perlu
mengatur CORS.

### Backend

```bash
cd backend
uv venv
source .venv/bin/activate
uv pip install -e ".[dev]"
python -m app.seed
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend-v2
corepack enable
pnpm install --frozen-lockfile
pnpm run dev
# http://localhost:5174
```

### Cek sebelum push

```bash
cd frontend-v2 && pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run build
cd backend     && uv sync --frozen --extra dev && uv run ruff check app tests && uv run pytest -q
```

## Default credentials (dari seed)

| Role             | Email                 | Password   | Akses               |
| ---------------- | --------------------- | ---------- | ------------------- |
| Superadmin       | admin@bintang.me      | admin123   | Semua proyek        |
| PM Budi          | budi@bintang.me       | pm123      | PRJ-001, PRJ-002    |
| PM Sari          | sari@bintang.me       | pm123      | PRJ-003, PRJ-004    |
| PM Agus          | agus@bintang.me       | pm123      | PRJ-005             |

Demo data: 3 perusahaan, 5 proyek (status sehat / waspada / overbudget / minus),
12 kategori, 7 vendor/client, 30+ transaksi, 6 invoice (paid / partial / overdue / draft), 3 PO.

## Struktur

```
bintang/
├── Dockerfile           # SPA + API jadi satu image (dipakai Railway)
├── railway.toml         # service tunggal; Root Directory = root repo
├── docker-compose.yml   # Postgres + app
├── backend/
│   └── app/
│       ├── core/        # config, security, deps, net_guard (guard SSRF)
│       ├── db/          # base, session
│       ├── models/      # semua model SQLAlchemy
│       ├── schemas/     # Pydantic
│       ├── api/
│       │   ├── files.py # penyajian lampiran (auth + cek akses proyek)
│       │   └── v1/      # endpoint routers
│       ├── services/    # audit, budget, pdf, excel, storage, ocr, ai, bot
│       ├── alembic/     # migrasi (dijalankan entrypoint saat start)
│       └── bootstrap_db.py
├── frontend-v2/         # Vite + React + Tailwind 4 (SPA aktif)
│   └── src/
│       ├── pages/       # halaman utama
│       ├── components/  # ui primitives, layout, domain
│       ├── hooks/       # data hooks (TanStack Query)
│       ├── lib/         # api client, format, utils
│       └── store/       # zustand (auth, ui prefs)
└── docs/
```

## API utama (selengkapnya di Swagger UI)

```
POST  /api/v1/auth/login
GET   /api/v1/auth/me
GET   /api/v1/dashboard/global
GET   /api/v1/dashboard/project/{id}
CRUD  /api/v1/users, /companies, /projects, /categories, /vendors-clients
CRUD  /api/v1/transactions  (+ /submit /verify /reject /cancel)
POST  /api/v1/transactions/{id}/attachments
CRUD  /api/v1/invoices      (+ /issue /cancel /attachments)
CRUD  /api/v1/purchase-orders (+ /issue /approve /cancel /pdf)
GET   /api/v1/reports/{cashflow|transactions|invoices|debts|budget|purchase-orders|audit-logs}?format=pdf|xlsx
GET   /api/v1/audit-logs
POST  /api/v1/ocr/extract      # OCR via URL (guard SSRF + path traversal)
POST  /api/v1/ocr/extract-upload
GET   /files/{path}            # lampiran -- WAJIB login + cek akses proyek
```

## Dokumentasi lain

| Berkas | Isi |
| --- | --- |
| [`RAILWAY.md`](./RAILWAY.md) | Panduan deploy (2 service) + migrasi dari 3 service |
| [`docs/pemutakhiran-tertunda.md`](./docs/pemutakhiran-tertunda.md) | Rilis mayor dependency yang sengaja ditunda, beserta risiko & cara verifikasinya |
| [`backend/docs/migrations.md`](./backend/docs/migrations.md) | Alur migrasi Alembic (otomatis di entrypoint) |
| [`docs/manual-penggunaan.md`](./docs/manual-penggunaan.md) | Manual pengguna |
| [`docs/setup-whatsapp.md`](./docs/setup-whatsapp.md) | Setup integrasi WAHA |

## Roadmap

- [ ] PWA offline draft transaksi (background sync) -- v2 belum PWA.
- [ ] Notifikasi (overdue invoice, transaksi besar belum verified).
- [ ] Multi-currency dengan FX rate.
- [ ] **Storage backend tambahan**:
  - [ ] S3 / MinIO (object storage)
  - [ ] **Google Drive** via Service Account + Shared Drive
        (proxy stream via backend untuk privasi; tulis adapter
        `backend/app/services/storage/gdrive.py` mengikuti interface
        `local.py`).
- [ ] Cetak PDF Invoice (analog ke PO PDF) dengan kop perusahaan.

## Lisensi

Open source. Gunakan dan modifikasi sesuai kebutuhan internal.
