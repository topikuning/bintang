# BINTANG v3 – multi-stage build untuk Railway (builder DOCKERFILE).
# Debian slim (bukan alpine): kompatibel Prisma engine & OpenSSL.
# Dijalankan di server Lenovo lewat docker-compose.yml (lihat README).

# ── base ─────────────────────────────────────────────────────
FROM node:24.18.0-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

# ── dependencies ─────────────────────────────────────────────
FROM base AS dependencies
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

# ── builder ──────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
# Nilai env palsu hanya supaya validasi zod saat build lolos; nilai asli dari
# .env server saat runtime.
RUN pnpm prisma generate && \
    DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    SESSION_SECRET="build-placeholder-secret-0123456789abcdef" \
    APP_ENV="production" \
    pnpm next build

# ── alat ─────────────────────────────────────────────────────
# Image untuk pekerjaan sekali jalan (impor dari Bintang lama). Berisi
# node_modules lengkap + skrip, TIDAK dipakai untuk melayani pengguna.
#   docker compose --profile impor run --rm impor --kering
# Diletakkan SEBELUM runner supaya target bawaan `docker build` tetap runner.
FROM builder AS alat
RUN apt-get update && \
    apt-get install -y --no-install-recommends gosu ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    groupadd --gid 1001 bintang && \
    useradd --uid 1001 --gid bintang --create-home --shell /usr/sbin/nologin bintang
COPY --chmod=755 scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
ENV UPLOAD_DIR=/data/berkas IMPOR_CERMIN=/data/impor-cermin
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh", "node_modules/.bin/tsx", "--require", "./scripts/stub-server-only.cjs", "scripts/impor-bintang-lama.ts"]

# ── runner ───────────────────────────────────────────────────
FROM node:24.18.0-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    UPLOAD_DIR=/data/berkas \
    PRISMA_HIDE_UPDATE_MESSAGE=1 \
    CHECKPOINT_DISABLE=1

# tini = PID 1 (sinyal SIGTERM sampai ke Node), gosu = turun dari root ke
# `bintang` di entrypoint setelah menyiapkan volume.
RUN apt-get update && \
    apt-get install -y --no-install-recommends tini gosu ca-certificates openssl && \
    rm -rf /var/lib/apt/lists/*

# Prisma CLI (pinned) untuk `prisma migrate deploy` saat start
# (MIGRASI_SAAT_START=1 di docker-compose).
RUN npm install -g prisma@7.8.0 && npm cache clean --force

RUN groupadd --gid 1001 bintang && useradd --uid 1001 --gid bintang --create-home --shell /usr/sbin/nologin bintang
ENV HOME=/home/bintang

COPY --from=builder --chown=bintang:bintang /app/.next/standalone ./
COPY --from=builder --chown=bintang:bintang /app/.next/static ./.next/static
COPY --from=builder --chown=bintang:bintang /app/public ./public
COPY --from=builder --chown=bintang:bintang /app/prisma ./prisma
COPY --from=builder --chown=bintang:bintang /app/prisma.config.js ./prisma.config.js
COPY --from=builder --chmod=755 /app/scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN mkdir -p /data/berkas && chown -R bintang:bintang /data

EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server.js"]
