import { Inbox, Plus } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { BarisPengajuan } from "@/components/pengajuan/baris-pengajuan";
import { ButtonLink, Card, EmptyState, LinkTabs, PageHeader, Pagination, qs } from "@/components/ui";
import { FilterBar } from "@/components/ui/filter-bar";
import type { RequestKind } from "@/generated/prisma/enums";
import { requireUser, accessibleProjectIds } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { ambilPengaturan } from "@/lib/pengaturan";
import { daftarPengajuan, hitungTab, TAB_LABEL, type TabPengajuan } from "@/lib/pengajuan/queries";
import { hariIniKey } from "@/lib/tanggal";
import { rupiah } from "@/lib/uang";

export const metadata: Metadata = { title: "Pengajuan" };

const TABS_PENGELOLA: TabPengajuan[] = ["tindakan", "menunggu", "disetujui", "lpj", "selesai", "draf", "ditolak", "semua"];
const TABS_PEMOHON: TabPengajuan[] = ["tindakan", "menunggu", "disetujui", "lpj", "selesai", "draf", "ditolak", "semua"];

const KOSONG: Record<TabPengajuan, { title: string; description: string }> = {
  tindakan: { title: "Tidak ada yang menunggu Anda", description: "Semua beres. Pengajuan yang perlu Anda setujui, bayar, atau perbaiki akan muncul di sini." },
  menunggu: { title: "Tidak ada pengajuan yang menunggu", description: "Pengajuan yang baru dikirim atau dikembalikan untuk revisi muncul di sini." },
  disetujui: { title: "Tidak ada yang menunggu dibayar", description: "Pengajuan yang sudah disetujui tampil di sini sampai dibayar." },
  dibayar: { title: "Belum ada yang dibayar", description: "" },
  lpj: { title: "Tidak ada uang muka berjalan", description: "Uang muka yang sudah dibayar tampil di sini sampai LPJ-nya diterima." },
  selesai: { title: "Belum ada yang selesai", description: "" },
  draf: { title: "Tidak ada draf", description: "Pengajuan yang disimpan tanpa dikirim muncul di sini." },
  ditolak: { title: "Tidak ada yang ditolak atau batal", description: "" },
  semua: { title: "Belum ada pengajuan", description: "Mulai dengan tombol Ajukan di atas." },
  saya: { title: "Anda belum pernah mengajukan", description: "" },
};

export default async function PengajuanPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; proyek?: string; jenis?: string; hal?: string }>;
}) {
  const sp = await searchParams;
  const user = await requireUser();
  const setting = await ambilPengaturan();
  const tabs = can(user.role, "request.view_project") ? TABS_PENGELOLA : TABS_PEMOHON;
  const counts = await hitungTab(user, setting.financeApproveCap, tabs);
  const awal: TabPengajuan = counts.tindakan > 0 ? "tindakan" : "semua";
  const tab = (tabs.includes(sp.tab as TabPengajuan) ? sp.tab : awal) as TabPengajuan;
  const kind = ["pembayaran", "uang_muka", "penggantian"].includes(sp.jenis ?? "") ? (sp.jenis as RequestKind) : undefined;
  const page = Number(sp.hal) || 1;

  const ids = await accessibleProjectIds(user);
  const [data, projects] = await Promise.all([
    daftarPengajuan(user, { tab, q: sp.q, projectId: sp.proyek, kind, page }, setting.financeApproveCap),
    db.project.findMany({
      where: ids === null ? {} : { id: { in: ids } },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
  ]);
  const today = hariIniKey();
  const base = { tab, q: sp.q, proyek: sp.proyek, jenis: sp.jenis };

  return (
    <>
      <PageHeader
        title="Pengajuan pembayaran"
        description="Ajukan, setujui, dan bayar – semua jejaknya tercatat di sini."
        actions={
          can(user.role, "request.create") ? (
            <ButtonLink href="/pengajuan/baru" variant="primary">
              <Plus aria-hidden className="size-4" /> Ajukan
            </ButtonLink>
          ) : undefined
        }
      />

      <LinkTabs
        className="mb-3"
        active={tab}
        items={tabs.map((t) => ({
          key: t,
          label: TAB_LABEL[t],
          href: `/pengajuan${qs({ ...base, tab: t, hal: undefined })}`,
          count: t === "semua" ? undefined : counts[t],
          highlight: t === "tindakan",
        }))}
      />
      <Suspense>
        <FilterBar
          className="mb-4"
          placeholder="Cari judul, nomor, penerima, atau pemohon…"
          selects={[
            {
              param: "proyek",
              label: "Proyek",
              allLabel: "Semua proyek",
              options: projects.map((p) => ({ value: p.id, label: `${p.code} – ${p.name}` })),
            },
            {
              param: "jenis",
              label: "Jenis",
              allLabel: "Semua jenis",
              options: [
                { value: "pembayaran", label: "Pembayaran" },
                { value: "uang_muka", label: "Uang muka" },
                { value: "penggantian", label: "Penggantian" },
              ],
            },
          ]}
        />
      </Suspense>

      {data.rows.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={sp.q ? "Tidak ada yang cocok dengan pencarian" : KOSONG[tab].title}
          description={sp.q ? "Coba kata lain atau hapus saringan." : KOSONG[tab].description}
          action={
            tab === "semua" && can(user.role, "request.create") && !sp.q ? (
              <ButtonLink href="/pengajuan/baru" variant="primary">
                <Plus aria-hidden className="size-4" /> Ajukan pembayaran
              </ButtonLink>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5 text-[13px] text-ink-muted">
            <span>{data.total} pengajuan</span>
            <span>
              Total <span className="tabular font-semibold text-ink">{rupiah(data.jumlahNilai)}</span>
            </span>
          </div>
          <ul className="divide-y divide-border">
            {data.rows.map((r) => (
              <BarisPengajuan key={r.id} r={r} today={today} />
            ))}
          </ul>
        </Card>
      )}
      <Pagination page={data.page} pages={data.pages} total={data.total} href={(h) => `/pengajuan${qs({ ...base, hal: h })}`} />
    </>
  );
}
