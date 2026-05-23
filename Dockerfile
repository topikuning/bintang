# Combined-service Dockerfile (FE + Backend dalam 1 image, 1 service Railway).
#
# Build context = repo root.
# Aktif hanya di service Railway yang punya Root Directory = `/` dan
# dockerfilePath = `Dockerfile` (sesuai railway.toml di root repo).
#
# Service backend & frontend eksisting TIDAK menggunakan file ini --
# mereka punya Dockerfile sendiri di `backend/` dan `frontend-v2/` yg
# dipakai karena Root Directory service mereka di-set ke folder masing-2.
#
# Hasil image: FastAPI uvicorn serve API di /api/v1/* + serve SPA
# (React build) di / via env STATIC_DIR=/app/static.

# =============================================================
# Stage 1 -- Build FE (Vite + React + TypeScript)
# =============================================================
FROM node:20-alpine AS fe-builder

WORKDIR /fe

# Install deps dgn lockfile (reproducible build).
COPY frontend-v2/package.json frontend-v2/package-lock.json ./
RUN npm ci --no-audit --no-fund

# Copy source FE. Konfigurasi ts/postcss/vite ikut tercopy.
COPY frontend-v2/ ./

# VITE_API_BASE_URL relative supaya FE call ke same-origin /api/v1.
# Tidak butuh build arg lagi (vs Dockerfile FE eksisting yg butuh
# pass build arg saat deploy).
ENV VITE_API_BASE_URL=/api/v1

RUN npm run build
# Output: /fe/dist


# =============================================================
# Stage 2 -- Backend FastAPI (Python 3.13) + serve FE static
# =============================================================
FROM python:3.13-slim

# WeasyPrint native deps (sama dgn backend/Dockerfile eksisting --
# wajib utk render PDF invoice/PO/reports).
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpango-1.0-0 libpangoft2-1.0-0 libcairo2 libgdk-pixbuf-2.0-0 \
    libffi-dev libssl-dev shared-mime-info fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy file backend yg dibutuhkan utk pip install.
COPY backend/pyproject.toml backend/README.md backend/alembic.ini ./
COPY backend/app ./app

# Install backend deps via uv (lebih cepat dari pip vanilla).
RUN pip install --no-cache-dir uv \
 && uv pip install --system --no-cache .

# Copy FE build dari stage 1 ke /app/static.
COPY --from=fe-builder /fe/dist /app/static

ENV PYTHONUNBUFFERED=1 \
    UPLOAD_DIR=/data/uploads \
    STATIC_DIR=/app/static \
    PORT=8000

# Volume mount-point default Railway (/data) -- service combined ini
# harus juga punya volume Railway di-mount ke /data utk persist uploads.
RUN mkdir -p /data/uploads

EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
