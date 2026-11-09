#!/bin/sh
# Impor dari Bintang lama, dijalankan DI DALAM container aplikasi:
#   Railway : railway ssh  →  bintang-impor --kering
#   Lenovo  : docker compose --profile impor run --rm impor --kering
# Berjalan sebagai `bintang` (bukan root) supaya folder lampiran yang dibuat
# importer tetap bisa ditulisi aplikasi sesudahnya.
set -e
export UPLOAD_DIR="${UPLOAD_DIR:-/data/berkas}"
export IMPOR_CERMIN="${IMPOR_CERMIN:-/data/impor-cermin}"
cd /app

if [ "$(id -u)" = "0" ]; then
  for d in "$UPLOAD_DIR" "$IMPOR_CERMIN"; do
    mkdir -p "$d"
    chown bintang:bintang "$d"
  done
  exec gosu bintang node /app/impor.mjs "$@"
fi
exec node /app/impor.mjs "$@"
