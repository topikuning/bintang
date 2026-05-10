# Deploy frontend-v2 ke Railway

Setup minimal untuk service Railway baru yang men-serve `frontend-v2`.

## 1. Konfigurasi service di Railway dashboard

| Setting | Nilai |
|---|---|
| **Service Source** | GitHub repo `topikuning/bintang` |
| **Branch** | `claude/pengembangan` |
| **Root Directory** | `frontend-v2` ← penting (monorepo) |
| **Builder** | Otomatis dibaca dari `railway.toml` (Nixpacks) |
| **Build Command** | Otomatis dari `railway.toml` (`npm ci && npm run build`) |
| **Start Command** | Otomatis dari `railway.toml` (`npm run start`) |
| **Healthcheck Path** | Otomatis dari `railway.toml` (`/`) |

Setelah set Root Directory, Railway hanya akan men-trigger build kalau file di dalam `frontend-v2/` berubah. Push ke `backend/` tidak akan men-deploy frontend service.

## 2. Environment Variables (WAJIB)

Set di tab **Variables** service frontend-v2:

```
VITE_API_BASE_URL=https://<URL_BACKEND_RAILWAY>/api/v1
```

Ganti `<URL_BACKEND_RAILWAY>` dengan URL public service backend kamu, misal:

```
VITE_API_BASE_URL=https://bintang-backend.up.railway.app/api/v1
```

> Catatan: `VITE_*` env var dibaca saat **build time**, bukan runtime. Jadi setiap kali ganti URL backend, harus trigger redeploy ulang frontend.

## 3. Update CORS di service backend

Backend FastAPI memvalidasi origin lewat env var `ALLOWED_ORIGINS` (comma-separated). Tambah URL frontend-v2 ke daftar:

```
ALLOWED_ORIGINS=https://bintang-frontend-v2.up.railway.app,https://bintang-frontend.up.railway.app
```

Kalau belum di-set, tambah dulu (jangan replace yg ada — tambahkan saja). Setelah save, backend service akan auto-restart.

## 4. Generate domain Railway

Di tab **Settings → Networking** → klik **Generate Domain**. Railway akan kasih URL semacam:

```
bintang-frontend-v2.up.railway.app
```

URL ini yang dipakai untuk akses + dimasukkan ke `ALLOWED_ORIGINS` backend.

## 5. Verifikasi deploy berhasil

Setelah deploy selesai:

1. Buka URL frontend → harus muncul halaman **Login** (warna gradient navy + form)
2. Login pakai akun yang ada di backend
3. Cek **Network tab** browser DevTools — request ke `/api/v1/auth/login` harus ke URL backend Railway, bukan localhost
4. Setelah login, browse ke `/transactions` — list muncul
5. Refresh halaman `/transactions` — masih muncul (kalau 404, berarti `serve -s` flag tidak aktif)

## 6. Troubleshooting

| Masalah | Penyebab & Solusi |
|---|---|
| Login gagal "Network Error" | `VITE_API_BASE_URL` salah. Cek nilai di Variables, redeploy. |
| Login berhasil tapi list kosong dan ada error 401 di console | Token tidak ke-attach. Cek apakah login response mengandung `access_token`. |
| Login error "CORS policy" di console | URL frontend belum masuk `ALLOWED_ORIGINS` backend. Tambahkan, restart backend. |
| Refresh `/transactions` jadi 404 | `npm run start` tidak pakai `-s` flag. Cek `package.json` script `start` ada `-s dist`. |
| Build gagal "package not found" | `npm ci` gagal karena lockfile out-of-sync. Hapus `package-lock.json` dari `.gitignore` lalu commit lockfile. |
| Asset 404 setelah deploy | Build sukses tapi static files tidak ter-serve. Cek log Railway, pastikan `serve` jalan dan `dist/` ada. |
| Bundle size warning di build log | Wajar (753KB), gzip 232KB masih sehat. Code-splitting bisa dikerjakan nanti. |

## 7. Custom domain (opsional)

Tab **Settings → Networking → Custom Domain** → tambah CNAME ke domain kamu. Jangan lupa update `ALLOWED_ORIGINS` backend lagi setelahnya.

## 8. Fast iteration loop

Setiap push ke branch `claude/pengembangan` akan auto-trigger build:
- Build ~2-3 menit (Nixpacks install + vite build)
- Deploy ~30 detik
- Total: ~3 menit dari `git push` sampai live

Untuk lihat progress real-time: tab **Deployments** service frontend-v2 → klik build terbaru → tab **Build logs** / **Deploy logs**.
