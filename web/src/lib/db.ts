import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "@/lib/env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  // adapter-pg menormalisasi timestamp seolah sesi selalu UTC – pin zonanya.
  const url = new URL(env.DATABASE_URL);
  const options = url.searchParams.get("options") ?? "";
  url.searchParams.set("options", `${options} -c timezone=UTC`.trim());
  const adapter = new PrismaPg({ connectionString: url.toString() });
  return new PrismaClient({ adapter, transactionOptions: { maxWait: 10_000, timeout: 30_000 } });
}

export const db = globalForPrisma.prisma ?? createClient();

if (env.APP_ENV !== "production") globalForPrisma.prisma = db;

/** Klien di dalam `db.$transaction(async (tx) => …)`. */
export type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];
