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

      // --- Aturan React Compiler (eslint-plugin-react-hooks v7) ---
      // v7 membawa aturan dari React Compiler. Berguna, tapi di repo ini
      // langsung menghasilkan 22 error, jadi diturunkan ke `warn` supaya
      // CI tidak terblokir sementara backlog-nya dicicil. Ratchet
      // `--max-warnings` di package.json yang mencegah jumlahnya naik.
      //
      // `set-state-in-effect` (21x): setState sinkron di dalam useEffect
      // memicu render berantai. Nyata, layak dibereskan, tapi tersebar
      // di banyak halaman dan bukan pekerjaan yang pantas dikerjakan
      // sesaat sebelum deploy.
      "react-hooks/set-state-in-effect": "warn",
      //
      // `static-components` (1x): SATU-SATUNYA kemunculan di
      // pages/AuditLog.tsx:330 sudah diperiksa manual dan merupakan
      // FALSE POSITIVE -- `getEntityIcon()` mengembalikan komponen ikon
      // dari lookup konstan (`ENTITY_OPTIONS[].icon` atau `FileText`),
      // yang referensinya stabil antar render. Aturan ini tidak bisa
      // membuktikan kestabilan itu, jadi ia melapor konservatif.
      // JANGAN "perbaiki" dgn useMemo -- itu menambah kerumitan untuk
      // masalah yang tidak ada.
      "react-hooks/static-components": "warn",

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
