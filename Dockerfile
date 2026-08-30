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
FROM node:20-alpine AS frontend

WORKDIR /build

# Lockfile dulu supaya layer npm ci ter-cache selama dependency
# tidak berubah.
COPY frontend-v2/package.json frontend-v2/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY frontend-v2/ ./

# Satu origin -> API selalu di path relatif. Di-hardcode di sini
# supaya tidak ada env yang bisa salah isi saat deploy.
ENV VITE_API_BASE_URL=/api/v1
RUN npm run build

# -------------------------------------------------------------
# Stage 2 -- runtime: Python + hasil build SPA
# -------------------------------------------------------------
FROM python:3.13-slim

# Native deps WeasyPrint (render PDF PO & laporan).
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpango-1.0-0 libpangoft2-1.0-0 libcairo2 libgdk-pixbuf-2.0-0 \
    libffi-dev libssl-dev shared-mime-info fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/pyproject.toml backend/README.md backend/alembic.ini ./
COPY backend/app ./app

# Network resilience: retry kalau PyPI connection reset.
ENV UV_HTTP_TIMEOUT=120 \
    UV_CONCURRENT_DOWNLOADS=8 \
    PIP_DEFAULT_TIMEOUT=120 \
    PIP_RETRIES=5
RUN pip install --no-cache-dir uv && \
    ok=0; \
    for i in 1 2 3 4 5; do \
        if uv pip install --system --no-cache .; then ok=1; break; fi; \
        echo "uv pip install failed (attempt $i/5), retrying in $((i*5))s..."; \
        sleep $((i*5)); \
    done; \
    test "$ok" = "1"

# SPA hasil stage 1. Path ini yang dibaca settings.FRONTEND_DIST.
COPY --from=frontend /build/dist ./frontend_dist

COPY backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV PYTHONUNBUFFERED=1 \
    UPLOAD_DIR=/data/uploads \
    FRONTEND_DIST=/app/frontend_dist \
    PORT=8000
RUN mkdir -p /data/uploads

# CATATAN -- kenapa masih root:
#
# Menjalankan container sebagai non-root itu benar secara prinsip, TAPI
# volume Railway di /data sudah berisi lampiran milik root dari deploy
# sebelumnya. `chown` saat BUILD tidak berpengaruh: volume di-mount saat
# RUNTIME dan menimpa direktori hasil build. Efeknya user non-root tidak
# bisa menulis ke /data/uploads -- semua upload akan gagal setelah
# deploy, dan itu justru mengganggu produksi.
#
# Untuk pindah ke non-root nanti, butuh langkah eksplisit:
#   1. tambahkan `gosu` (atau `su-exec`) di image;
#   2. di entrypoint, saat masih root: `chown -R bintang /data`;
#   3. lalu `exec gosu bintang uvicorn ...`.
# Lakukan itu terpisah dari perubahan ini supaya kalau ada masalah
# permission, penyebabnya jelas.

EXPOSE 8000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
