import type { Metadata } from "next";
import { MasterCrud } from "@/components/master/master-crud";
import { PageHeader } from "@/components/ui";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { saldoRekening } from "@/lib/keuangan/queries";
import { simpanRekening } from "@/lib/master/actions";
import { formatIsian, rupiah } from "@/lib/uang";

export const metadata: Metadata = { title: "Rekening & kas" };

export default async function RekeningPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "master.manage");
  const [rows, saldo, companies] = await Promise.all([
    db.account.findMany({ orderBy: { name: "asc" } }),
    saldoRekening(),
    db.company.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const s = new Map(saldo.map((x) => [x.id, x.saldo]));
  return (
    <>
      <PageHeader back={{ href: "/master", label: "Data Master" }} title="Rekening & kas" description="Saldo = saldo awal + semua transaksi terverifikasi di rekening itu." />
      <MasterCrud
        entityLabel="rekening"
        addLabel="Tambah rekening"
        emptyText="Belum ada rekening. Tambahkan minimal satu supaya pembayaran bisa dicatat asalnya."
        action={simpanRekening}
        rows={rows.map((a) => ({
          id: a.id,
          title: a.name,
          badge: a.kind === "kas" ? "Kas tunai" : "Bank",
          subtitle: [a.bankName, a.accountNumber].filter(Boolean).join(" · ") || undefined,
          meta: rupiah(s.get(a.id) ?? a.openingBalance),
          active: a.isActive,
          values: {
            name: a.name, kind: a.kind, companyId: a.companyId ?? "", bankName: a.bankName ?? "", accountNumber: a.accountNumber ?? "",
            openingBalance: a.openingBalance < 0n ? `-${formatIsian((-a.openingBalance).toString())}` : formatIsian(a.openingBalance.toString()),
            isActive: a.isActive ? "1" : "",
          },
        }))}
        fields={[
          { name: "name", label: "Nama", type: "text", required: true, placeholder: "mis. BCA Operasional" },
          { name: "kind", label: "Jenis", type: "select", required: true, options: [{ value: "bank", label: "Rekening bank" }, { value: "kas", label: "Kas tunai" }] },
          { name: "bankName", label: "Bank", type: "text" },
          { name: "accountNumber", label: "Nomor rekening", type: "text" },
          { name: "companyId", label: "Milik perusahaan", type: "select", options: companies.map((c) => ({ value: c.id, label: c.name })), clearLabel: "–" },
          { name: "openingBalance", label: "Saldo awal", type: "money", help: "Saldo saat mulai memakai Bintang." },
          { name: "isActive", label: "Aktif", type: "checkbox", span: 2 },
        ]}
      />
    </>
  );
}
