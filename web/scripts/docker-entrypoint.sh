#!/bin/sh
set -e

# Volume Railway dipasang milik root saat RUNTIME, sedangkan aplikasi berjalan
# sebagai `bintang`. `chown` saat build tidak menolong (ditimpa pemasangan
# volume), jadi direktori lampiran disiapkan DI SINI, lalu hak root dilepas.
# Pelajaran dari MARLIN (kejadian 2026-09-03: berkas hilang tiap deploy).
DIR="${UPLOAD_DIR:-/data/berkas}"

if [ "$(id -u)" = "0" ]; then
  if mkdir -p "$DIR" 2>/dev/null; then
    chown bintang:bintang "$DIR" 2>/dev/null || echo "[entrypoint] tidak bisa mengubah pemilik $DIR – unggahan lampiran akan gagal." >&2
  else
    echo "[entrypoint] tidak bisa membuat $DIR – unggahan lampiran akan gagal." >&2
  fi
fi

# Self-host (docker-compose) tanpa preDeploy: jalankan migrasi dulu.
if [ "${MIGRASI_SAAT_START:-0}" = "1" ]; then
  echo "[entrypoint] prisma migrate deploy…"
  prisma migrate deploy
fi

if [ "$(id -u)" = "0" ]; then
  exec gosu bintang "$@"
fi
exec "$@"
