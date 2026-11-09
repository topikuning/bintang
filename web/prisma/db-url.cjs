/**
 * Rapikan DATABASE_URL sebelum sampai ke Prisma/pg.
 *
 * Railway lama Bintang memakai bentuk SQLAlchemy `postgresql+asyncpg://`.
 * Kalau variabel itu disalin apa adanya ke layanan baru, Prisma menolaknya
 * dengan pesan yang tidak menyebut sebabnya. Dibetulkan di satu tempat.
 */
function normalizeDatabaseUrl(raw) {
  if (!raw) return raw;
  return raw.replace(/^postgres(ql)?\+[a-z0-9]+:\/\//i, "postgresql://").replace(/^postgres:\/\//i, "postgresql://");
}

module.exports = { normalizeDatabaseUrl };
