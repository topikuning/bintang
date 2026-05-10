# Multi-stage Dockerfile utk Bintang Finance v2.
# Stage 1: build SPA dgn Node + Vite.
# Stage 2: serve dgn nginx alpine (~25MB final image).

# =============================================================
# Stage 1 -- Build
# =============================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install deps dgn lockfile (reproducible).
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Copy source.
COPY . .

# Vite membaca env var berawalan VITE_* SAAT BUILD. Railway meneruskan
# env service sebagai build args otomatis (sejak 2023). Declare di sini
# supaya bisa dibaca:
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

# Build production bundle ke dist/.
RUN npm run build

# =============================================================
# Stage 2 -- Serve dgn nginx
# =============================================================
FROM nginx:1.27-alpine

# Copy build artefacts ke document root nginx.
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy template config -- nginx alpine akan otomatis envsubst
# *.template di startup, mengganti ${PORT} dgn nilai dr Railway.
COPY nginx.conf /etc/nginx/templates/default.conf.template

# Default port; di-override Railway via env PORT.
ENV PORT=80
EXPOSE 80

# nginx:alpine entrypoint default sudah menjalankan envsubst lalu
# nginx -g 'daemon off;'. Tidak perlu CMD custom.
