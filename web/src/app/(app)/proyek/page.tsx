import { FolderKanban, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AnggaranBar } from "@/components/proyek/anggaran-bar";
import { Badge, ButtonLink, EmptyState, LinkTabs, PageHeader, qs } from "@/components/ui";
import type { ProjectStatus } from "@/generated/prisma/enums";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { accessibleProjectIds, requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { ringkasanPerProyek } from "@/lib/keuangan/queries";
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_TONE } from "@/lib/lifecycle";
import { rupiahRingkas } from "@/lib/uang";

export const metadata: Metadata = { title: "Proyek" };

export default async function ProyekPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status: st } = await searchParams;
  const user = await requireUser();
  requireCapabilityPage(user.role, "project.view");
  const status: ProjectStatus | "semua" = (["aktif", "ditahan", "selesai", "batal"] as const).includes(st as ProjectStatus)
    ? (st as ProjectStatus)
    : st === "semua"
      ? "semua"
      : "aktif";
  const ids = await accessibleProjectIds(user);
  const bolehUang = can(user.role, "tx.view");
  const [projects, per, pending] = await Promise.all([
    db.project.findMany({
      where: { ...(ids === null ? {} : { id: { in: ids } }), ...(status === "semua" ? {} : { status }) },
      orderBy: [{ kind: "asc" }, { code: "asc" }],
      include: { company: { select: { name: true } }, _count: { select: { members: true } } },
    }),
    bolehUang ? ringkasanPerProyek(ids) : Promise.resolve(new Map()),
    db.paymentRequest.groupBy({
      by: ["projectId"],
      where: { status: { in: ["diajukan", "disetujui"] }, ...(ids === null ? {} : { projectId: { in: ids } }) },
      _count: { _all: true },
    }),
  ]);
  const pendingMap = new Map(pending.map((p) => [p.projectId, p._count._all]));

  return (
    <>
      <PageHeader
        title="Proyek"
        description={ids === null ? "Semua proyek & buku operasional." : "Proyek yang ditugaskan kepada Anda."}
        actions={
          can(user.role, "project.manage") ? (
            <ButtonLink href="/proyek/baru" variant="primary">
              <Plus aria-hidden className="size-4" /> Proyek baru
            </ButtonLink>
          ) : undefined
        }
      />
      <LinkTabs
        className="mb-4"
        active={status}
        items={(["aktif", "ditahan", "selesai", "batal", "semua"] as const).map((s) => ({
          key: s,
          label: s === "semua" ? "Semua" : PROJECT_STATUS_LABEL[s],
          href: `/proyek${qs({ status: s === "aktif" ? undefined : s })}`,
        }))}
      />
      {projects.length === 0 ? (
        <EmptyState icon={FolderKanban} title="Tidak ada proyek di sini" description={ids !== null && ids.length === 0 ? "Anda belum ditugaskan ke proyek mana pun. Hubungi admin." : undefined} />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => {
            const r = per.get(p.id);
            const n = pendingMap.get(p.id) ?? 0;
            return (
              <li key={p.id} className="min-w-0">
                <Link
                  href={`/proyek/${p.id}`}
                  className="flex h-full flex-col rounded-xl border border-border bg-surface p-4 shadow-(--shadow-card) transition-colors hover:border-primary-300"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="tabular text-xs font-semibold text-ink-faint">{p.code}</p>
                      <p className="line-clamp-2 text-sm font-semibold text-ink">{p.name}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge tone={PROJECT_STATUS_TONE[p.status]}>{PROJECT_STATUS_LABEL[p.status]}</Badge>
                      {p.kind === "operasional" ? <Badge>Operasional</Badge> : null}
                    </div>
                  </div>
                  <p className="mt-1 truncate text-xs text-ink-muted">
                    {[p.client, p.location, p.company.name].filter(Boolean).join(" · ")}
                  </p>
                  <div className="mt-auto pt-4">
                    {bolehUang && r ? (
                      <>
                        <div className="mb-2 grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <p className="text-ink-muted">Nilai kontrak</p>
                            <p className="tabular font-semibold">{rupiahRingkas(p.contractValue)}</p>
                          </div>
                          <div>
                            <p className="text-ink-muted">Terpakai</p>
                            <p className="tabular font-semibold">{rupiahRingkas(r.terpakai)}</p>
                          </div>
                        </div>
                        <AnggaranBar terpakai={r.terpakai} anggaran={p.budget} ringkas />
                      </>
                    ) : bolehUang ? (
                      <AnggaranBar terpakai={0n} anggaran={p.budget} ringkas />
                    ) : null}
                    <p className="mt-2 text-xs text-ink-muted">
                      {p._count.members} anggota{n ? ` · ${n} pengajuan berjalan` : ""}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
