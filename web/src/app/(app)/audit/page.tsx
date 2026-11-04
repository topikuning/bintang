import { History } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Avatar, Card, EmptyState, PageHeader, Pagination, qs } from "@/components/ui";
import { FilterBar } from "@/components/ui/filter-bar";
import type { Prisma } from "@/generated/prisma/client";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { fmtWaktu } from "@/lib/tanggal";

export const metadata: Metadata = { title: "Jejak Audit" };

const LABEL: Record<string, string> = {
  "user.login": "Masuk",
  "user.logout": "Keluar",
  "user.change_password": "Ganti password",
  "user.create": "Buat pengguna",
  "user.update": "Ubah pengguna",
  "user.profile": "Ubah profil",
  "request.create": "Buat pengajuan",
  "request.update": "Ubah pengajuan",
  "request.submit": "Ajukan",
  "request.approve": "Setujui",
  "request.revise": "Minta revisi",
  "request.reject": "Tolak",
  "request.cancel": "Batalkan pengajuan",
  "request.pay": "Bayar",
  "request.unpay": "Batalkan pembayaran",
  "request.lpj_submit": "Ajukan LPJ",
  "request.lpj_return": "Kembalikan LPJ",
  "request.lpj_accept": "Terima LPJ",
  "request.delete_draft": "Hapus draf",
  "tx.create": "Catat kas",
  "tx.verify": "Verifikasi kas",
  "tx.reject": "Tolak kas",
  "tx.cancel": "Batalkan kas",
  "settings.update": "Ubah pengaturan",
};

const PER = 50;

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ q?: string; pengguna?: string; hal?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  requireCapabilityPage(user.role, "audit.view");
  const page = Math.max(1, Number(sp.hal) || 1);
  const where: Prisma.AuditLogWhereInput = {
    ...(sp.pengguna ? { userId: sp.pengguna } : {}),
    ...(sp.q ? { OR: [{ action: { contains: sp.q, mode: "insensitive" } }, { resourceType: { contains: sp.q, mode: "insensitive" } }, { resourceId: { contains: sp.q } }] } : {}),
  };
  const [rows, total, users] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PER, take: PER, include: { user: { select: { fullName: true } } } }),
    db.auditLog.count({ where }),
    db.user.findMany({ orderBy: { fullName: "asc" }, select: { id: true, fullName: true } }),
  ]);
  return (
    <>
      <PageHeader title="Jejak Audit" description="Setiap perubahan uang, status, dan akses – tidak bisa diubah atau dihapus." />
      <Suspense>
        <FilterBar
          className="mb-4"
          placeholder="Cari aksi atau id dokumen…"
          selects={[{ param: "pengguna", label: "Pengguna", allLabel: "Semua pengguna", options: users.map((u) => ({ value: u.id, label: u.fullName })) }]}
        />
      </Suspense>
      {rows.length === 0 ? (
        <EmptyState icon={History} title="Tidak ada catatan" />
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id} className="px-4 py-3">
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
                    <Avatar name={r.user?.fullName ?? "Sistem"} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">
                        <span className="font-medium">{r.user?.fullName ?? "Sistem"}</span>{" "}
                        <span className="text-ink-muted">· {LABEL[r.action] ?? r.action}</span>
                      </p>
                      <p className="truncate text-xs text-ink-faint">
                        {fmtWaktu(r.createdAt)} · {r.resourceType}
                        {r.ip ? ` · ${r.ip}` : ""}
                      </p>
                    </div>
                  </summary>
                  {r.payload ? (
                    <pre className="mt-2 overflow-x-auto rounded-md bg-surface-inset p-3 text-xs text-ink-muted">{JSON.stringify(r.payload, null, 2)}</pre>
                  ) : null}
                </details>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Pagination page={page} pages={Math.max(1, Math.ceil(total / PER))} total={total} href={(h) => `/audit${qs({ q: sp.q, pengguna: sp.pengguna, hal: h })}`} />
    </>
  );
}
