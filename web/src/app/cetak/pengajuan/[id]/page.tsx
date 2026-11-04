import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { bukaSandi } from "@/lib/kripto";
import { REQUEST_KIND_LABEL, requestStatusLabel } from "@/lib/lifecycle";
import { ambilPengaturan } from "@/lib/pengaturan";
import { detailPengajuan } from "@/lib/pengajuan/queries";
import { fmtTanggal, fmtWaktu, hariIniKey } from "@/lib/tanggal";
import { angka, rupiah, terbilang } from "@/lib/uang";
import { TombolCetak } from "../../tombol-cetak";

export const metadata: Metadata = { title: "Cetak pengajuan" };

const METODE: Record<string, string> = { transfer: "Transfer", tunai: "Tunai", qris: "QRIS", giro: "Giro", lainnya: "Lainnya" };

const kapital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default async function CetakPengajuanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const p = await detailPengajuan(user, id);
  if (!p || p.status === "draft") notFound();
  const setting = await ambilPengaturan();
  const perusahaan = p.project.company;
  const rekening = bukaSandi(p.bankAccount);
  const kota = perusahaan.city ?? "";

  const ttd = [
    { peran: "Diajukan oleh", nama: p.requester.fullName, waktu: p.submittedAt },
    { peran: "Disetujui oleh", nama: p.approver?.fullName, waktu: p.approvedAt },
    { peran: "Dibayar oleh", nama: p.payer?.fullName, waktu: p.paidAt },
    { peran: "Diterima oleh", nama: p.payeeName, waktu: null },
  ];

  return (
    <>
      <TombolCetak />
      <article className="mx-auto max-w-[210mm] bg-white px-[14mm] py-[12mm] text-[10.5pt] leading-snug text-black shadow-(--shadow-card) print:max-w-none print:p-0 print:shadow-none">
        <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-3">
          <div>
            <p className="text-[13pt] font-bold">{perusahaan.name}</p>
            {perusahaan.address ? <p className="text-[9pt]">{perusahaan.address}</p> : null}
          </div>
          <div className="text-right text-[9pt]">
            <p className="text-[12pt] font-bold tracking-wide">BUKTI PENGAJUAN PEMBAYARAN</p>
            <p>
              No. <span className="font-semibold">{p.number}</span>
            </p>
            <p>Status: {requestStatusLabel(p.status, p.kind)}</p>
          </div>
        </header>

        <table className="mt-4 w-full text-[10pt]">
          <tbody>
            {[
              ["Proyek", `${p.project.code} – ${p.project.name}`],
              ["Jenis", REQUEST_KIND_LABEL[p.kind]],
              ["Keperluan", p.title],
              ["Tanggal diajukan", p.submittedAt ? fmtWaktu(p.submittedAt) : "–"],
              ...(p.neededDate ? [["Dibutuhkan", fmtTanggal(p.neededDate)]] : []),
              ["Dibayarkan ke", p.payeeName ?? "–"],
              ...(rekening ? [["Rekening", `${p.bankName ?? ""} ${rekening}${p.bankHolder ? ` a.n. ${p.bankHolder}` : ""}`.trim()]] : []),
              ...(p.paidDate
                ? [["Pembayaran", `${fmtTanggal(p.paidDate)} · ${p.paymentMethod ? METODE[p.paymentMethod] : ""}${p.account ? ` dari ${p.account.name}` : ""}${p.paymentRef ? ` · Ref ${p.paymentRef}` : ""}`]]
                : []),
            ].map(([k, v]) => (
              <tr key={k}>
                <td className="w-40 py-0.5 align-top text-[9.5pt] text-neutral-600">{k}</td>
                <td className="py-0.5 align-top">: {v}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <table className="mt-4 w-full border-collapse text-[9.5pt]">
          <thead>
            <tr className="bg-neutral-100">
              <th className="border border-neutral-400 px-2 py-1 text-left">No</th>
              <th className="border border-neutral-400 px-2 py-1 text-left">Uraian</th>
              <th className="border border-neutral-400 px-2 py-1 text-left">Kategori</th>
              <th className="border border-neutral-400 px-2 py-1 text-right">Qty</th>
              <th className="border border-neutral-400 px-2 py-1 text-right">Harga satuan</th>
              <th className="border border-neutral-400 px-2 py-1 text-right">Jumlah (Rp)</th>
            </tr>
          </thead>
          <tbody>
            {p.items.map((it, i) => (
              <tr key={it.id} className="break-inside-avoid">
                <td className="border border-neutral-400 px-2 py-1 align-top">{i + 1}</td>
                <td className="border border-neutral-400 px-2 py-1 align-top">{it.description}</td>
                <td className="border border-neutral-400 px-2 py-1 align-top">{it.category?.name ?? "–"}</td>
                <td className="border border-neutral-400 px-2 py-1 text-right align-top">
                  {it.quantity !== null ? `${it.quantity.toString().replace(".", ",")} ${it.unit ?? ""}` : "–"}
                </td>
                <td className="border border-neutral-400 px-2 py-1 text-right align-top">{it.unitPrice !== null ? angka(it.unitPrice) : "–"}</td>
                <td className="border border-neutral-400 px-2 py-1 text-right align-top tabular-nums">{angka(it.amount)}</td>
              </tr>
            ))}
            <tr className="font-bold">
              <td colSpan={5} className="border border-neutral-400 px-2 py-1 text-right">
                TOTAL
              </td>
              <td className="border border-neutral-400 px-2 py-1 text-right tabular-nums">{angka(p.total)}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-2 text-[9.5pt] italic">
          Terbilang: {kapital(terbilang(p.total))}
        </p>

        {p.description ? (
          <p className="mt-3 text-[9.5pt]">
            <span className="font-semibold">Keterangan:</span> {p.description}
          </p>
        ) : null}

        <p className="mt-6 text-right text-[10pt]">
          {kota ? `${kota}, ` : ""}
          {fmtTanggal(hariIniKey(), "d MMMM yyyy")}
        </p>
        <table className="mt-2 w-full table-fixed text-center text-[9.5pt]">
          <tbody>
            <tr>
              {ttd.map((t) => (
                <td key={t.peran} className="px-2 align-top">
                  <p>{t.peran}</p>
                  <div className="h-16" />
                  <p className="border-t border-black pt-1 font-semibold">{t.nama ?? " "}</p>
                  <p className="text-[8pt] text-neutral-600">{t.waktu ? fmtWaktu(t.waktu) : " "}</p>
                </td>
              ))}
            </tr>
          </tbody>
        </table>

        <footer className="mt-8 border-t border-neutral-300 pt-2 text-[8pt] text-neutral-500">
          Dicetak dari {setting.orgName} oleh {user.fullName} · {fmtWaktu(new Date())}. Persetujuan & pembayaran tercatat
          elektronik di riwayat pengajuan.
        </footer>
      </article>
    </>
  );
}
