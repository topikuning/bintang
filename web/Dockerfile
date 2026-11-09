# BINTANG v3 – satu image untuk server Lenovo (docker-compose.yml) dan Railway
# (railway.json). Debian slim (bukan alpine): kompatibel Prisma & OpenSSL.

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
    pnpm next build && \
    pnpm build:impor

# ── runner ───────────────────────────────────────────────────
FROM node:24.18.0-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    UPLOAD_DIR=/data/berkas \
    IMPOR_CERMIN=/data/impor-cermin \
    PRISMA_HIDE_UPDATE_MESSAGE=1 \
    CHECKPOINT_DISABLE=1

# tini = PID 1 (sinyal SIGTERM sampai ke Node), gosu = turun dari root ke
# `bintang` di entrypoint setelah menyiapkan volume.
RUN apt-get update && \
    apt-get install -y --no-install-recommends tini gosu ca-certificates openssl && \
    rm -rf /var/lib/apt/lists/*

# Prisma CLI (pinned) untuk `prisma migrate deploy` tiap start
# (scripts/docker-entrypoint.sh, MIGRASI_SAAT_START bawaan 1).
RUN npm install -g prisma@7.8.0 && npm cache clean --force

RUN groupadd --gid 1001 bintang && useradd --uid 1001 --gid bintang --create-home --shell /usr/sbin/nologin bintang
ENV HOME=/home/bintang

COPY --from=builder --chown=bintang:bintang /app/.next/standalone ./
COPY --from=builder --chown=bintang:bintang /app/.next/static ./.next/static
COPY --from=builder --chown=bintang:bintang /app/public ./public
COPY --from=builder --chown=bintang:bintang /app/prisma ./prisma
COPY --from=builder --chown=bintang:bintang /app/prisma.config.js ./prisma.config.js
COPY --from=builder --chmod=755 /app/scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# Importer Bintang lama (satu berkas) – lihat scripts/bintang-impor.sh.
COPY --from=builder --chown=bintang:bintang /app/dist/impor.mjs ./impor.mjs
COPY --from=builder --chmod=755 /app/scripts/bintang-impor.sh /usr/local/bin/bintang-impor

RUN mkdir -p /data/berkas && chown -R bintang:bintang /data

EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server.js"]
