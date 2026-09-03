# =============================================================
# Bintang -- image tunggal: SPA (Vite) + API (FastAPI).
#
# Sebelumnya frontend dan backend adalah dua service Railway
# terpisah (nginx + uvicorn). Sekarang SPA di-build lalu disalin
# ke dalam image backend, dan FastAPI yang menyajikannya.
#
# Konsekuensi yang disengaja:
#  - Railway cukup 2 service: Postgres + aplikasi ini.
#  - SPA dan API satu origin -> CORS tidak lagi berperan, dan
#    cookie berkas HttpOnly (lihat app/api/files.py) bisa dipakai
#    supaya <img src="/files/..."> tetap jalan tanpa membuka
#    lampiran ke publik.
#  - Tidak ada lagi VITE_API_BASE_URL yang perlu diisi per-env:
#    path relatif /api/v1 selalu benar.
# =============================================================

# -------------------------------------------------------------
# Stage 1 -- build SPA
# -------------------------------------------------------------
FROM node:26-alpine AS frontend

WORKDIR /build

# Lockfile dulu supaya layer pnpm ter-cache selama dependency
# tidak berubah.
COPY frontend-v2/package.json frontend-v2/pnpm-lock.yaml ./
RUN npm install --global pnpm@11.25.0 && \
    pnpm install --frozen-lockfile

COPY frontend-v2/ ./

# Satu origin -> API selalu di path relatif. Di-hardcode di sini
# supaya tidak ada env yang bisa salah isi saat deploy.
ENV VITE_API_BASE_URL=/api/v1
RUN pnpm run build

# -------------------------------------------------------------
# Stage 2 -- runtime: Python + hasil build SPA
# -------------------------------------------------------------
FROM python:3.14-slim

# Native deps WeasyPrint (render PDF PO & laporan).
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpango-1.0-0 libpangoft2-1.0-0 libcairo2 libgdk-pixbuf-2.0-0 \
    libffi-dev libssl-dev shared-mime-info fonts-dejavu-core gosu \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/pyproject.toml backend/README.md backend/uv.lock backend/alembic.ini ./

# Network resilience: retry kalau PyPI connection reset.
ENV UV_HTTP_TIMEOUT=120 \
    UV_CONCURRENT_DOWNLOADS=8 \
    PIP_DEFAULT_TIMEOUT=120 \
    PIP_RETRIES=5
RUN pip install --no-cache-dir uv==0.12.9 && \
    ok=0; \
    for i in 1 2 3 4 5; do \
        if uv export --frozen --no-dev --no-emit-project --output-file /tmp/requirements.txt && \
           uv pip install --system --no-cache --requirement /tmp/requirements.txt; \
        then ok=1; break; fi; \
        echo "locked dependency install failed (attempt $i/5), retrying in $((i*5))s..."; \
        sleep $((i*5)); \
    done; \
    test "$ok" = "1"

COPY backend/app ./app

# SPA hasil stage 1. Path ini yang dibaca settings.FRONTEND_DIST.
COPY --from=frontend /build/dist ./frontend_dist

COPY backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# PORT di-set eksplisit dan HARUS cocok dgn target port domain di
# Railway (lihat RAILWAY.md langkah 3e). Sempat dipertimbangkan untuk
# menghapus baris ini supaya PORT dari platform selalu menang -- tapi
# deployment yang berjalan sekarang bersandar pada nilai ini, jadi
# jangan diubah tanpa alasan kuat.
ENV PYTHONUNBUFFERED=1 \
    UPLOAD_DIR=/data/uploads \
    FRONTEND_DIST=/app/frontend_dist \
    PORT=8000
RUN useradd --system --uid 10001 --home-dir /app --shell /usr/sbin/nologin bintang && \
    mkdir -p /data/uploads && \
    chown -R bintang:bintang /app /data/uploads

# Entrypoint mulai sebagai root hanya untuk memperbaiki ownership volume
# Railway lama, lalu langsung re-exec sebagai UID 10001 sebelum migrasi
# dan uvicorn. Proses aplikasi tidak berjalan dengan hak root.

EXPOSE 8000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
