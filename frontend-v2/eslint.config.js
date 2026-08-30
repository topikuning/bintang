// Konfigurasi ESLint untuk Bintang frontend-v2.
//
// Audit 2026-06-13 #D-02: sebelum ini repo TIDAK punya berkas config
// eslint sama sekali, dan `eslint` bahkan tidak ada di
// devDependencies -- padahal CI menjalankan langkah "Lint". Langkah itu
// gagal dgn "command not found", lalu `|| true` menelan kegagalannya,
// sehingga CI selalu hijau dan backlog lint tidak pernah terukur.
//
// Aturan di sini sengaja dimulai dari rekomendasi standar, bukan set
// yang lebih ketat: tujuannya supaya CI bisa segera hijau TANPA `||
// true`, dan pengetatan berikutnya dilakukan bertahap dgn perubahan yg
// terlihat di diff.

import js from "@eslint/js"
import globals from "globals"
import reactHooks from "eslint-plugin-react-hooks"
import reactRefresh from "eslint-plugin-react-refresh"
import tseslint from "typescript-eslint"

export default tseslint.config(
  {
    ignores: ["dist", "node_modules", "coverage"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // CATATAN -- eslint tetap di v9, BUKAN v10.
      //
      // Sempat dinaikkan ke eslint 10 + eslint-plugin-react-hooks v7
      // (2026-08-30) untuk mendapat aturan React Compiler. Dibatalkan:
      // eslint 10 membutuhkan ajv@6 sementara paket lain di pohon
      // dependency membutuhkan ajv@8, dan npm menulis lockfile yang
      // kemudian DITOLAK oleh `npm ci` sendiri ("lock file's ajv@6.15.0
      // does not satisfy ajv@8.20.0"). CI jadi merah di langkah install
      // sebelum sempat menjalankan apa pun.
      //
      // Yang hilang cuma peringatan tambahan; bug nyata yang ditemukan
      // lint (hook dipanggil kondisional di ProjectsHubPage) tertangkap
      // oleh `rules-of-hooks` yang sudah ada di v5. Coba lagi setelah
      // eslint/ajv beres di upstream.

      // Aturan React Fast Refresh: komponen harus jadi satu-satunya
      // export dari berkasnya. Banyak berkas lama mengekspor helper di
      // samping komponen -- peringatan, bukan error, supaya tidak
      // memblokir CI sebelum sempat dirapikan.
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],

      // `any` masih dipakai di beberapa jembatan tipe API. Turunkan ke
      // warn dulu; naikkan ke error setelah types/api.ts lengkap.
      "@typescript-eslint/no-explicit-any": "warn",

      // Argumen tak terpakai berawalan `_` adalah konvensi sengaja di
      // repo ini (mis. `_admin: User = Depends(...)` di sisi backend,
      // dan handler yang mengabaikan event).
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
)
