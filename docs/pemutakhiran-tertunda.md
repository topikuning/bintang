# Pemutakhiran dependency yang sengaja ditunda

Terakhir diperiksa: **2026-08-30**

Semua pemutakhiran patch/minor sudah diterapkan dan terverifikasi
(typecheck, lint, 23 test, build, `npm audit` bersih). Berkas ini
mencatat **rilis mayor yang sengaja belum diambil**, beserta alasannya —
supaya keputusannya terlihat, bukan terlupa.

## Kenapa ditunda

Kriterianya satu: **apakah "build hijau" benar-benar membuktikan
"berfungsi"?**

Untuk pustaka UI runtime, tidak. `tsc` dan `vite build` memverifikasi
tipe dan bundling, bukan bahwa grafik tetap tergambar atau toast tetap
muncul. Pemutakhiran di bawah butuh verifikasi visual di browser, yang
tidak bisa dilakukan di lingkungan tempat perubahan ini dibuat.

Lakukan **setelah** deploy penggabungan service ini terbukti stabil,
satu per satu, dengan aplikasi terbuka di browser.

## Daftar

| Paket | Sekarang | Terbaru | Risiko | Yang perlu diperiksa manual |
|---|---|---|---|---|
| `recharts` | 2.15.4 | 3.10.1 | **Tinggi** | v3 mengubah API chart. Buka Dashboard, Dashboard Proyek, dan Laporan — pastikan tiap grafik tergambar, tooltip & legend jalan. |
| `zod` | 3.25.76 | 4.5.4 | **Tinggi** | v4 mengubah API skema & pesan error. Dipakai validasi form via `@hookform/resolvers`. Uji submit + kasus error di TransactionForm, InvoiceForm, POForm. |
| `@tanstack/react-table` | 8.21.3 | 9.2.4 | **Tinggi** | v9 breaking. Uji sortir, filter, paginasi di TransactionsListPage & InvoicesListPage. |
| `vite` | 6.4.3 | 8.2.2 | Sedang | Dua lompatan mayor. Bundling berubah; build hijau belum menjamin runtime. Uji seluruh aplikasi setelah upgrade. |
| `@vitejs/plugin-react` | 4.7.0 | 6.1.1 | Sedang | Naikkan bersama Vite, bukan sendiri. |
| `typescript` | 5.6.3 | 7.0.2 | Sedang | TS 7 adalah kompilator hasil port ke Go. Kemungkinan besar memunculkan error tipe baru. Compile-time saja — tidak memengaruhi bundle. |
| `lucide-react` | 0.451.0 | 1.37.0 | Rendah | Beberapa nama ikon bisa berubah/dihapus. Typecheck akan menangkap yang hilang. |
| `sonner` | 1.7.4 | 2.0.8 | Rendah | API toast berubah. Permukaan pemakaian kecil. |
| `tailwind-merge` | 2.6.1 | 3.6.0 | Rendah | Perilaku penggabungan class berubah di kasus pinggir — bisa muncul sebagai regresi visual halus. |

## Yang SUDAH dimutakhirkan (2026-08-30)

**Frontend** — seluruh patch/minor, plus mayor perkakas-saja:

- `react-router` 7.15.0 → **7.18.3** — memperbaiki 3 kerentanan HIGH
  (CSRF, open redirect, XSS). Ini pemutakhiran keamanan, bukan sekadar
  kerapian.
- `eslint` 9 → **10**, `eslint-plugin-react-hooks` 5 → **7**,
  `eslint-plugin-react-refresh` 0.4 → **0.5**, `globals` 15 → **17**
- `vitest` 3 → **4**, `@types/node` 22 → **26**
- react, react-dom, semua `@radix-ui/*`, `@tanstack/react-query`,
  `react-hook-form`, `tailwindcss`, `zustand`, `autoprefixer`,
  `@hookform/resolvers` — ke patch/minor terbaru.

Perkakas dipisahkan dari pustaka runtime dengan sengaja: eslint dan
vitest tidak ikut ke bundle produksi, jadi hasil hijau di situ benar-benar
membuktikan kebenarannya.

**Backend** — batas versi dirapikan, bukan sekadar dinaikkan. Karena
belum ada lockfile, build tanpa batas atas SELALU memasang versi
terbaru; jadi menaikkan batas bawah ke versi terkini tidak mengubah apa
pun yang ter-deploy, hanya mendokumentasikan dasar yang teruji dan
mencegah penurunan versi tak sengaja.

## Efek samping yang tercatat

Naiknya `eslint-plugin-react-hooks` ke v7 membawa aturan React Compiler,
sehingga ratchet `--max-warnings` naik **15 → 89**. Tambahan itu bukan
regresi baru — ia menyorot backlog yang selama ini memang ada tapi tidak
terlihat:

- 56 × `react-refresh/only-export-components`
- 21 × `react-hooks/set-state-in-effect` — setState sinkron di dalam
  `useEffect` memicu render berantai. **Layak dibereskan**, tersebar di
  banyak halaman.
- 8 × `react-hooks/incompatible-library`
- 1 × `react-hooks/static-components` di `pages/AuditLog.tsx:330` —
  sudah diperiksa manual: **false positive**. `getEntityIcon()`
  mengembalikan komponen ikon dari lookup konstan yang referensinya
  stabil antar render. Jangan "diperbaiki" dengan `useMemo`.

Turunkan angka ratchet-nya tiap kali sebagian dibereskan.
