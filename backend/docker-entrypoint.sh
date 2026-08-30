#!/bin/sh
# Entrypoint aplikasi Bintang.
#
# Audit #D-01: migrasi dijalankan DI SINI, sebelum uvicorn, supaya
# schema selalu sudah benar saat request pertama masuk. Kalau migrasi
# gagal, container berhenti -- deploy Railway ditandai gagal dan versi
# lama tetap melayani, alih-alih naik dengan schema setengah jadi.
set -e

echo "[entrypoint] menyiapkan schema database..."
python -m app.bootstrap_db

PORT_USED="${PORT:-8000}"
if [ -z "${PORT:-}" ]; then
  echo "[entrypoint] PORT tidak di-set -- pakai default 8000."
  echo "[entrypoint] Kalau platform merutekan ke port lain, hasilnya 502."
fi
echo "[entrypoint] menjalankan uvicorn di port ${PORT_USED}..."
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT_USED}"
