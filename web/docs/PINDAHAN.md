# Pindahan: Bintang lama (Railway) → Bintang v3 (server Lenovo)

Satu kali pindah, dua hal sekaligus: **server** (Railway → Lenovo) dan
**versi** (FastAPI/React → v3). Itu aman dilakukan bersamaan karena keduanya
tidak saling menimpa: aplikasi lama tetap utuh di Railway sampai hari pindah,
v3 memakai database dan penyimpanan sendiri di Lenovo, dan datanya ditarik
lewat API ekspor yang bisa diulang berkali-kali.

Yang **tidak** disarankan: memindahkan aplikasi lama ke Lenovo dulu, baru
kemudian pindah versi. Itu dua kali pindahan, dua kali risiko, untuk aplikasi
yang akan dipensiunkan.

---

## 0. Putuskan dulu (sebelum menyentuh server)

| Pertanyaan | Kenapa penting |
|---|---|
| Apakah modul **Invoice / PO** masih dipakai harian? | v3 belum punya modulnya. Datanya ikut sebagai arsip Excel per proyek (bisa dibaca, tidak bisa diolah). Kalau masih dipakai aktif, tunda hari pindah sampai modul itu ada di v3. |
| Bot Telegram/WhatsApp & OCR masih dipakai? | Belum ada di v3. |
| Diakses dari mana? | Hanya dari kantor → cukup `http://<ip-lenovo>:3000`. Dari luar kantor → Cloudflare Tunnel (HTTPS, tanpa membuka port router). |
| Ke mana cadangan dibawa keluar mesin? | Lenovo adalah satu mesin. Tanpa salinan di luar mesin, satu disk rusak = data hilang. |

## 1. Aplikasi lama: aktifkan API ekspor

API ekspor ada di cabang **`dev`** aplikasi lama (`/api/v1/ekspor-v3/*`).
Ia harus berjalan di **layanan Railway yang memegang data & volume produksi**
– layanan uji dengan volume lain tidak membawa lampiran yang sebenarnya.

1. Gabungkan `dev` ke cabang yang dideploy layanan produksi (atau arahkan
   layanan produksi ke `dev`), tunggu deploy hijau.
2. Railway → layanan produksi → Variables → `EKSPOR_V3_TOKEN` =
   `python -c 'import secrets; print(secrets.token_urlsafe(48))'` → redeploy.
3. Cek dari mana saja:
   ```bash
   curl -s -H "X-Ekspor-Token: <token>" https://<app-lama>/api/v1/ekspor-v3/manifest
   ```
   Tanpa header → `401`. Token kosong di Railway → `404` (API mati).

Selama token terisi, pemegangnya bisa mengambil **seluruh** data termasuk hash
password dan nomor rekening. Jangan kirim lewat chat; kosongkan setelah selesai.

## 2. Server Lenovo: pasang v3 (sekali)

```bash
sudo apt install -y docker.io docker-compose-v2 git   # atau Docker resmi
sudo systemctl enable --now docker
sudo git clone -b dev3 https://github.com/topikuning/bintang /opt/bintang
cd /opt/bintang/web
sudo cp .env.lenovo.example .env && sudo chmod 600 .env
sudo nano .env      # DB_PASSWORD, SESSION_SECRET, KUNCI_DATA, DATA_DIR=/srv/bintang
sudo docker compose up -d --build
curl -s http://127.0.0.1:3000/api/health      # {"ok":true}
```

Simpan `KUNCI_DATA` di pengelola password: tanpa itu nomor rekening di
database dan di cadangan tidak bisa dibuka.

Akses luar kantor (opsional): Cloudflare Zero Trust → Networks → Tunnels →
buat tunnel → *Public hostname* `bintang.<domain>` → service `http://app:3000`
→ salin token ke `TUNNEL_TOKEN` → `docker compose --profile tunnel up -d`.
Kalau hanya lewat tunnel, set `BIND=127.0.0.1` supaya port 3000 tidak terbuka
di LAN.

Cadangan keluar mesin (wajib untuk produksi), contoh dengan rclone:
```bash
# crontab -e   (tiap hari 03.30, setelah dump 02.00)
30 3 * * * rclone sync /srv/bintang/cadangan gdrive:bintang-cadangan --log-file /var/log/bintang-rclone.log
```
Periksa `DATA_DIR/cadangan/terakhir-berhasil` (epoch detik) bila ragu
cadangan masih jalan.

## 3. Gladi (boleh diulang, aplikasi lama tetap dipakai seperti biasa)

Isi `SUMBER_LAMA_URL` dan `EKSPOR_V3_TOKEN` di `.env` Lenovo, lalu:

```bash
docker compose --profile impor run --rm impor --kering
```

Gladi kering menjalankan SEMUANYA – unduh semua berkas ke
`DATA_DIR/impor-cermin`, impor ke DB, salin lampiran – lalu membatalkan
transaksi DB dan membuang berkas yang sempat ditulis. Cermin tetap disimpan,
jadi impor berikutnya hanya mengunduh berkas yang baru.

Baca ringkasannya. Yang perlu diperhatikan:
- `laporan-tautan-luar.tsv` – lampiran berupa tautan (Google Drive, dsb.).
- `laporan-berkas-hilang.tsv` – tercatat di DB lama tapi berkasnya sudah tidak
  ada di volume. Itu kerusakan lama, bukan akibat pindahan.
- "top-up penyelesaian belum diverifikasi" – uang muka berjalan akan negatif
  sampai top-up itu diverifikasi di v3.

Mau melihat hasilnya di layar sebelum hari H? Impor sungguhan, periksa, lalu
kosongkan lagi:
```bash
docker compose --profile impor run --rm impor
# … periksa di http://<ip-lenovo>:3000 dengan akun lama …
docker compose down
sudo rm -rf /srv/bintang/postgres /srv/bintang/berkas   # cermin & cadangan dibiarkan
docker compose up -d
```

## 4. Hari pindah

1. Umumkan jam berhenti input di aplikasi lama (cukup 30–60 menit).
2. Setelah jam itu tidak ada lagi yang mengetik: pastikan DB v3 masih kosong
   (lihat langkah kosongkan di §3 bila pernah gladi sungguhan), lalu
   ```bash
   docker compose --profile impor run --rm impor
   ```
3. Cocokkan, minimal:
   - total kas masuk & keluar terverifikasi per proyek (Laporan lama vs
     Laporan v3) – beda yang wajar hanya pembulatan sen dan pengembalian
     uang muka yang dulu tidak tercatat;
   - 3–5 lampiran acak terbuka;
   - satu orang dari tiap peran bisa masuk dengan password lamanya.
4. Bagikan alamat baru. Isi **rekening & kas** di Data Master v3 (versi lama
   tidak punya konsep rekening; transaksi lama tampil sebagai "tanpa rekening").
5. Kosongkan `EKSPOR_V3_TOKEN` di Railway **dan** di `.env` Lenovo.

## 5. Setelah pindah

- Biarkan aplikasi lama hidup 2–4 minggu **hanya untuk dilihat** (minta
  semua orang berhenti mengetik di sana; data yang masuk ke sana setelah hari
  pindah tidak ikut ke v3).
- Sebelum mematikan Railway: ambil `pg_dump` terakhir database lama dan simpan
  bersama `impor-cermin` – itu salinan utuh sistem lama.
- Matikan layanan Railway.

## Kalau impor gagal di tengah

Semua impor berjalan dalam satu transaksi DB: gagal = tidak ada baris yang
masuk dan berkas yang sempat ditulis dibuang. Unduhan berkas yang sudah selesai
tetap di cermin. Perbaiki penyebabnya (pesan galat menyebutkannya), lalu
jalankan perintah yang sama lagi.
