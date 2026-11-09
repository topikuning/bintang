// Bundel importer Bintang lama jadi SATU berkas (dist/impor.mjs) supaya bisa
// dijalankan di image aplikasi biasa – tanpa tsx/node_modules lengkap.
// Railway: volume lampiran hanya terpasang di container aplikasi, jadi impor
// harus berjalan di sana (`railway ssh` → `bintang-impor`).
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const akar = fileURLToPath(new URL("..", import.meta.url));

await build({
  absWorkingDir: akar,
  entryPoints: ["scripts/impor-bintang-lama.ts"],
  outfile: "dist/impor.mjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  tsconfig: "tsconfig.json",
  // `server-only` melempar galat di luar bundler Next; skrip tepercaya ini
  // memakai modul kosong (sama seperti scripts/stub-server-only.cjs).
  alias: { "server-only": "./scripts/server-only-kosong.mjs" },
  // Modul native: dipakai dari node_modules standalone bila diperlukan.
  external: ["@node-rs/argon2", "pg-native"],
  // Paket CJS di dalam bundel ESM masih memanggil require().
  banner: { js: "import { createRequire as __buatRequire } from 'node:module'; const require = __buatRequire(import.meta.url);" },
  logLevel: "warning",
});
