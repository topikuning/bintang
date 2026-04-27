# Bintang

**Bintang — Biaya, Investasi dan Tata Anggaran Gerak.**
Aplikasi web pencatatan & monitoring keuangan multi-proyek (mobile-first PWA).

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
- AI Invoice Extraction adapter (stub) yang siap di-swap ke Tesseract / Document AI / Claude Vision.

## Stack (April 2026, latest stable)

- **Backend**: FastAPI 0.136, Python 3.13, SQLAlchemy 2.0.49 (async), Pydantic 2.13, WeasyPrint, openpyxl, JWT.
- **Frontend**: React 19.2, Vite 8, TypeScript 6, Tailwind CSS 4.2, vite-plugin-pwa (Workbox 7), TanStack Query 5, React Router 7, Recharts.
- **DB**: SQLite (dev) / PostgreSQL 18 (prod).

## Quick start (Docker)

```bash
cp .env.example .env
docker compose build
docker compose up -d
# init demo data
docker compose exec backend python -m app.seed
# Open
# http://localhost:8080  (PWA)
# http://localhost:8000/docs (Swagger)
```

## Quick start (lokal tanpa Docker)

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
cd frontend
pnpm install   # atau npm install
pnpm dev
# http://localhost:5173
```

## Default credentials (dari seed)

| Role          | Email                 | Password   |
| ------------- | --------------------- | ---------- |
| Superadmin    | admin@bintang.me   | admin123   |
| Project Admin | pm1@bintang.me     | pm123      |

## Struktur

```
bintang/
├── backend/             # FastAPI + SQLAlchemy
│   └── app/
│       ├── core/        # config, security, deps
│       ├── db/          # base, session
│       ├── models/      # all SQLAlchemy models
│       ├── schemas/     # Pydantic
│       ├── api/v1/      # endpoint routers
│       └── services/    # audit, budget, invoice_status, pdf, excel, storage, ocr
├── frontend/            # Vite + React + Tailwind 4 + PWA
│   └── src/
│       ├── pages/       # halaman utama
│       ├── components/  # UI primitives, AppShell, AttachmentUploader
│       ├── lib/         # api client, utils
│       ├── store/       # zustand auth store
│       └── types/
├── docker-compose.yml
└── README.md
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
POST  /api/v1/ocr/extract      # stub (future: real OCR/AI)
```

## Roadmap

- [ ] OCR provider beneran (Tesseract / Document AI / Claude Vision).
- [ ] PWA offline draft transaksi (background sync).
- [ ] Notifikasi (overdue invoice, transaksi besar belum verified).
- [ ] Multi-currency dengan FX rate.
- [ ] S3/MinIO storage di prod.

## Lisensi

Open source. Gunakan dan modifikasi sesuai kebutuhan internal.
