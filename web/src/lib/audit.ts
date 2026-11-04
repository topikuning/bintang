import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { requestIp } from "@/lib/auth/session";
import { db } from "@/lib/db";

type AuditData = Prisma.AuditLogUncheckedCreateInput;
type AuditTx = { auditLog: { create: (args: { data: AuditData }) => Promise<unknown> } };

function auditData(
  userId: string | null,
  action: string,
  resourceType: string,
  resourceId: string | null | undefined,
  payload: Record<string, unknown> | undefined,
  ip: string | null,
): AuditData {
  return {
    userId,
    action,
    resourceType,
    resourceId: resourceId ?? null,
    ip,
    payload: payload
      ? (JSON.parse(
          JSON.stringify(payload, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
        ) as Prisma.InputJsonValue)
      : undefined,
  };
}

/**
 * Audit BEST-EFFORT – gagal menulis tidak menggagalkan aksi (login, logout).
 * JANGAN untuk mutasi uang/status: pakai `auditIn` di transaksi yang sama.
 */
export async function audit(
  userId: string | null,
  action: string,
  resourceType: string,
  resourceId?: string | null,
  payload?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.auditLog.create({
      data: auditData(userId, action, resourceType, resourceId, payload, (await requestIp()) ?? null),
    });
  } catch (err) {
    console.error("[audit] gagal menulis audit log:", action, err);
  }
}

/**
 * Audit DI DALAM transaksi pemanggil – gagal = seluruh transaksi batal.
 * Uang dan status tidak boleh berubah tanpa jejak.
 */
export async function auditIn(
  tx: AuditTx,
  userId: string | null,
  action: string,
  resourceType: string,
  resourceId?: string | null,
  payload?: Record<string, unknown>,
  ip?: string | null,
): Promise<void> {
  await tx.auditLog.create({
    data: auditData(userId, action, resourceType, resourceId, payload, ip ?? (await requestIp()) ?? null),
  });
}
