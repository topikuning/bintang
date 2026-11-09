#!/bin/sh
set -e

# Volume/bind mount dipasang milik root saat RUNTIME, sedangkan aplikasi berjalan
# sebagai `bintang`. `chown` saat build tidak menolong (ditimpa pemasangan
# volume), jadi direktori lampiran disiapkan DI SINI, lalu hak root dilepas.
# Pelajaran dari MARLIN (kejadian 2026-09-03: berkas hilang tiap deploy).
DIR="${UPLOAD_DIR:-/data/berkas}"

if [ "$(id -u)" = "0" ]; then
  # IMPOR_CERMIN: cermin berkas impor dari Bintang lama (lihat bintang-impor).
  for d in "$DIR" ${IMPOR_CERMIN:-}; do
    if mkdir -p "$d" 2>/dev/null; then
      chown bintang:bintang "$d" 2>/dev/null || echo "[entrypoint] tidak bisa mengubah pemilik $d – penulisan berkas akan gagal." >&2
    else
      echo "[entrypoint] tidak bisa membuat $d – penulisan berkas akan gagal." >&2
    fi
  done
fi

# Migrasi DB tiap start (bawaan: ya). Aman diulang – `migrate deploy` hanya
# menerapkan yang belum, dan dikunci advisory lock bila dua container start
# bersamaan. Jangan bergantung pada pre-deploy platform saja: di Railway ia
# hanya jalan bila "Railway Config File" = /web/railway.json, dan tanpa itu
# aplikasi hidup dengan database kosong ("table public.users does not exist").
# MIGRASI_SAAT_START=0 untuk mematikan.
if [ "${MIGRASI_SAAT_START:-1}" = "1" ]; then
  echo "[entrypoint] prisma migrate deploy…"
  prisma migrate deploy
fi

if [ "$(id -u)" = "0" ]; then
  exec gosu bintang "$@"
fi
exec "$@"
