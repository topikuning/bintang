import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";

/** Buka notifikasi: tandai dibaca lalu arahkan ke tujuannya. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/masuk", req.url));
  const n = await db.notification.findFirst({ where: { id, userId: user.id } });
  if (!n) return NextResponse.redirect(new URL("/notifikasi", req.url));
  if (!n.readAt) await db.notification.update({ where: { id }, data: { readAt: new Date() } });
  const tujuan = n.href && n.href.startsWith("/") && !n.href.startsWith("//") ? n.href : "/notifikasi";
  return NextResponse.redirect(new URL(tujuan, req.url));
}
