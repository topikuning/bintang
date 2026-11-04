import { Bell, CheckCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Button, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { cn } from "@/lib/cn";
import { db } from "@/lib/db";
import { tandaiSemuaDibaca } from "@/lib/pengguna/actions";
import { relatif } from "@/lib/tanggal";

export const metadata: Metadata = { title: "Notifikasi" };

export default async function NotifikasiPage() {
  const user = await requireUser();
  const rows = await db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 100 });
  const belum = rows.filter((r) => !r.readAt).length;
  return (
    <>
      <PageHeader
        title="Notifikasi"
        description={belum ? `${belum} belum dibaca` : "Semua sudah dibaca"}
        actions={
          belum ? (
            <form action={tandaiSemuaDibaca}>
              <Button type="submit" variant="secondary">
                <CheckCheck aria-hidden className="size-4" /> Tandai semua dibaca
              </Button>
            </form>
          ) : undefined
        }
      />
      {rows.length === 0 ? (
        <EmptyState icon={Bell} title="Belum ada notifikasi" description="Kabar soal pengajuan Anda – disetujui, dibayar, perlu revisi – akan muncul di sini." />
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {rows.map((n) => (
              <li key={n.id}>
                <Link href={`/notifikasi/${n.id}`} className={cn("flex gap-3 px-4 py-3 hover:bg-surface-muted", !n.readAt && "bg-primary-50/50")}>
                  <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-primary-600")} />
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm", !n.readAt ? "font-semibold" : "font-medium text-ink-muted")}>{n.title}</p>
                    {n.body ? <p className="line-clamp-2 text-[13px] text-ink-muted">{n.body}</p> : null}
                    <p className="mt-0.5 text-xs text-ink-faint">{relatif(n.createdAt)}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
