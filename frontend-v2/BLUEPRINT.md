# Bintang Financial OS — UI dan arsitektur frontend

Terakhir diperbarui: **2026-09-04**.

Bintang adalah workspace keuangan dan proyek yang adaptif: data padat pada
desktop, ringkasan dan tindakan utama pada mobile, serta satu kontrak data yang
sama pada seluruh viewport.

## Stack terkunci

- React 19.2 + React Router 8.3
- Vite 8.2 + TypeScript native 7.0
- Tailwind CSS 4.3 + Radix UI
- TanStack Query 5 dan Table 8
- React Hook Form 7 + Zod 4
- Recharts 3.10, Lucide React 1.40, Sonner 2
- pnpm 11 dengan `pnpm-lock.yaml`

## Prinsip produk

1. Angka dan status harus dapat dipindai sebelum dekorasi visual.
2. Semua nominal memakai tabular numerals dan alignment konsisten.
3. Tindakan keuangan destruktif atau final selalu memiliki review/konfirmasi.
4. Filter terlihat, dapat di-reset, dan tidak menciptakan scope global tersembunyi.
5. Informasi penting tidak disampaikan lewat warna saja.
6. Target sentuh minimal 44 px; fokus keyboard memakai outline 2 px kontras.
7. Desktop memakai tabel dan panel detail; mobile memakai card list dan sheet.
8. PDF/Excel tetap dibuat backend sebagai dokumen, bukan screenshot UI.

## Bahasa visual

- Canvas: cool neutral `#f4f6fa`; surface putih dengan border lembut.
- Navigasi: midnight navy `#0b1220` agar konteks aplikasi selalu jelas.
- Brand: indigo; hijau hanya untuk hasil finansial positif/sukses.
- Status: success, warning, danger, info—tanpa warna ad-hoc.
- Radius 8–16 px; shadow tipis untuk hierarki, bukan dekorasi berlebihan.
- Heading rapat dan kuat; body tenang; angka memakai JetBrains Mono fallback.

Sumber token global ada di `src/index.css`. Semua shell, navigasi, input,
button, card, tabel, filter, empty/error/loading state memakai token tersebut.

## Struktur aplikasi

- `src/components/ui`: primitive visual dan interaksi.
- `src/components/layout`: shell responsif, navigasi, pencarian, user controls.
- `src/components/data`: tabel, kartu ringkasan, filter, pagination, state.
- `src/components/domain`: workflow per domain keuangan.
- `src/pages`: komposisi route; tidak menduplikasi primitive.
- `src/hooks`: query/mutation dan invalidasi cache.
- `src/store`: state lintas-route yang benar-benar global.

Navigasi desktop memakai sidebar penuh, tablet memakai icon rail, dan mobile
memakai floating bottom dock. Isi halaman dibatasi hingga 1680 px agar tabel
besar tetap berguna tanpa membuat teks dan form terlalu lebar.

## Konvensi implementasi

- Import internal memakai alias `@/`.
- Nama berkas komponen PascalCase; hook camelCase berawalan `use`.
- Route di-lazy-load dan memiliki skeleton serta error boundary.
- Jangan menambah hex color di halaman; tambah token bila semantik baru sah.
- Setiap perubahan form harus diuji pada error, loading, empty, dan success.
- Gunakan `pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run build`.
