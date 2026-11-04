// Skrip CLI (seed, impor, uji) memuat modul server di luar bundler Next.
// Paket `server-only` sengaja melempar galat di luar kondisi "react-server";
// di sini ia diganti modul kosong lewat cache require – proteksinya tetap
// utuh di aplikasi, hanya skrip tepercaya yang memakai berkas ini.
const p = require.resolve("server-only");
require.cache[p] = { id: p, filename: p, loaded: true, exports: {} };
