#!/bin/sh
# Cadangan harian Bintang v3 – dijalankan layanan `cadangan` di docker-compose.
#
# Tiap hari pukul CADANGAN_JAM menurut zona waktu kontainer (UTC kecuali TZ
# diisi – compose mengisi TZ=Asia/Jakarta):
#   1. pg_dump -Fc  → /cadangan/db/bintang-YYYYmmdd-HHMM.dump
#   2. berkas lampiran disalin TANPA MENIMPA ke /cadangan/berkas
#   3. dump yang lebih tua dari CADANGAN_SIMPAN_HARI dihapus
#
# Pulihkan:  pg_restore --clean --if-exists -d <db> bintang-….dump
set -eu

JAM="${CADANGAN_JAM:-02}"
SIMPAN="${CADANGAN_SIMPAN_HARI:-14}"
mkdir -p /cadangan/db /cadangan/berkas

cadangkan() {
  stamp="$(date +%Y%m%d-%H%M)"
  tujuan="/cadangan/db/bintang-$stamp.dump"
  echo "[cadangan] $stamp mulai"
  if pg_dump -Fc -f "$tujuan.part"; then
    mv "$tujuan.part" "$tujuan"
    echo "[cadangan] DB → $tujuan ($(du -h "$tujuan" | cut -f1))"
  else
    rm -f "$tujuan.part"
    echo "[cadangan] GAGAL pg_dump – dicoba lagi besok; periksa log ini." >&2
  fi
  # Lampiran: bernama acak & tidak pernah ditimpa → salin yang belum ada saja.
  (cd /data/berkas 2>/dev/null && find . -type f | while read -r f; do
    [ -e "/cadangan/berkas/$f" ] || { mkdir -p "/cadangan/berkas/$(dirname "$f")"; cp -p "$f" "/cadangan/berkas/$f"; }
  done) || echo "[cadangan] direktori berkas belum ada"
  find /cadangan/db -name 'bintang-*.dump' -mtime +"$SIMPAN" -delete
  date +%s > /cadangan/terakhir-berhasil
  echo "[cadangan] selesai"
}

# Sekali saat start (supaya ada cadangan pertama tanpa menunggu malam),
# lalu tiap hari pada jam yang ditentukan.
cadangkan
while true; do
  sekarang_jam="$(date +%H)"
  if [ "$sekarang_jam" = "$JAM" ]; then
    cadangkan
    sleep 3700
  else
    sleep 600
  fi
done
