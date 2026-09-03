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
      // Core correctness rules. React Compiler-specific rules are omitted
      // because this app does not enable the compiler; enabling them would
      // flag valid state synchronization and third-party form/table APIs.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",

      // Aturan React Fast Refresh: komponen harus jadi satu-satunya
      // export dari berkasnya. Banyak berkas lama mengekspor helper di
      // samping komponen -- peringatan, bukan error, supaya tidak
      // memblokir CI sebelum sempat dirapikan.
      "react-refresh/only-export-components": "error",

      // `any` masih dipakai di beberapa jembatan tipe API. Turunkan ke
      // warn dulu; naikkan ke error setelah types/api.ts lengkap.
      "@typescript-eslint/no-explicit-any": "error",

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
  {
    files: [
      "src/components/layout/nav-config.tsx",
      "src/components/ui/sonner.tsx",
      "src/components/domain/project/ProjectForm.tsx",
      "src/components/forms/ScanButton.tsx",
      "src/routes.tsx",
    ],
    rules: {
      // These modules intentionally export route/config/helper values next
      // to their owning component; none of those values hold React state.
      "react-refresh/only-export-components": "off",
    },
  },
)
