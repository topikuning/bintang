import { Building2, ChevronRight, Landmark, Tags, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Data Master" };

export default async function MasterPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "master.manage");
  const [c, k, p, r] = await Promise.all([
    db.company.count({ where: { isActive: true } }),
    db.category.count({ where: { isActive: true } }),
    db.party.count({ where: { isActive: true } }),
    db.account.count({ where: { isActive: true } }),
  ]);
  const items = [
    { href: "/master/pihak", label: "Penerima & vendor", ket: "Vendor, tukang, klien, beserta rekeningnya", n: p, icon: Users },
    { href: "/master/kategori", label: "Kategori", ket: "Pengelompokan biaya & pemasukan untuk laporan", n: k, icon: Tags },
    { href: "/master/rekening", label: "Rekening & kas", ket: "Asal dan tujuan uang, beserta saldo awal", n: r, icon: Landmark },
    { href: "/master/perusahaan", label: "Perusahaan", ket: "Badan usaha pemilik proyek – tampil di kop cetak", n: c, icon: Building2 },
  ];
  return (
    <>
      <PageHeader title="Data Master" description="Data rujukan yang dipakai semua formulir." />
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map((i) => (
          <li key={i.href} className="min-w-0">
            <Link href={i.href} className="flex items-center gap-4 rounded-xl border border-border bg-surface p-4 shadow-(--shadow-card) hover:border-primary-300">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
                <i.icon aria-hidden className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{i.label}</span>
                <span className="block truncate text-xs text-ink-muted">{i.ket}</span>
              </span>
              <span className="tabular text-lg font-semibold text-ink-muted">{i.n}</span>
              <ChevronRight aria-hidden className="size-4 text-ink-faint" />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
