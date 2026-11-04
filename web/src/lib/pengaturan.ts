import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";

/** Pengaturan organisasi (satu baris), di-cache per request. */
export const ambilPengaturan = cache(async () => {
  const s = await db.setting.findUnique({ where: { id: 1 } });
  return s ?? (await db.setting.create({ data: { id: 1 } }));
});
