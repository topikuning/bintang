import { NextResponse } from "next/server";
import { getCurrentUser, accessibleProjectIds } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { scopePengajuan } from "@/lib/pengajuan/queries";
import { ambilBerkas } from "@/lib/penyimpanan";

/**
 * Sajikan lampiran – WAJIB login dan lolos lingkup akses yang sama dengan
 * dokumen induknya. Tidak ada URL publik; kunci penyimpanan tidak bocor.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Silakan masuk dulu.", { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Tidak ditemukan.", { status: 404 });

  const a = await db.attachment.findUnique({
    where: { id },
    select: {
      storageKey: true,
      fileName: true,
      mimeType: true,
      requestId: true,
      projectId: true,
      transaction: { select: { projectId: true } },
    },
  });
  if (!a) return new NextResponse("Tidak ditemukan.", { status: 404 });

  let boleh = false;
  if (a.requestId) {
    const scope = await scopePengajuan(user);
    boleh = (await db.paymentRequest.count({ where: { AND: [{ id: a.requestId }, scope] } })) > 0;
  } else if (a.transaction && can(user.role, "tx.view")) {
    const ids = await accessibleProjectIds(user);
    boleh = ids === null || ids.includes(a.transaction.projectId);
  } else if (a.projectId && can(user.role, "project.view")) {
    const ids = await accessibleProjectIds(user);
    boleh = ids === null || ids.includes(a.projectId);
  }
  // 404, bukan 403: jangan membocorkan bahwa berkasnya ada.
  if (!boleh) return new NextResponse("Tidak ditemukan.", { status: 404 });

  try {
    const buf = await ambilBerkas(a.storageKey);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": a.mimeType,
        "Content-Length": String(buf.length),
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(a.fileName)}`,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        // PDF/gambar milik pengguna tidak boleh menjalankan skrip di origin ini.
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch {
    return new NextResponse("Berkas tidak ada di penyimpanan.", { status: 410 });
  }
}
