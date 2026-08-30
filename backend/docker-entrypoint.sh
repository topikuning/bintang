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

echo "[entrypoint] menjalankan uvicorn di port ${PORT:-8000}..."
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
