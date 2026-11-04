#!/bin/sh
# Entrypoint aplikasi Bintang.
#
# Audit #D-01: migrasi dijalankan DI SINI, sebelum uvicorn, supaya
# schema selalu sudah benar saat request pertama masuk. Kalau migrasi
# gagal, container berhenti -- deploy Railway ditandai gagal dan versi
# lama tetap melayani, alih-alih naik dengan schema setengah jadi.
set -e

if [ "$(id -u)" = "0" ]; then
    mkdir -p /data/uploads
    chown -R bintang:bintang /data/uploads
    exec gosu bintang "$0" "$@"
fi

echo "[entrypoint] menyiapkan schema database..."
python -m app.bootstrap_db

echo "[entrypoint] memastikan akun awal dan master data tersedia..."
python -m app.seed_master --startup

echo "[entrypoint] menjalankan uvicorn di port ${PORT:-8000}..."
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
