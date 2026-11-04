// Prisma CLI config (v7) – JavaScript polos supaya CLI global di image
// produksi bisa memuatnya tanpa loader TypeScript.
try {
  process.loadEnvFile();
} catch {
  // .env tidak ada (CI/produksi – env dari platform)
}

const { normalizeDatabaseUrl } = require("./prisma/db-url.cjs");

module.exports = {
  schema: "prisma/schema.prisma",
  datasource: {
    url: normalizeDatabaseUrl(process.env.DATABASE_URL ?? ""),
  },
  migrations: {
    path: "prisma/migrations",
    seed: "tsx --require ./scripts/stub-server-only.cjs prisma/seed.ts",
  },
};
