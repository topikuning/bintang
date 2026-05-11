import {
  BadgeDollarSign,
  BarChart3,
  CreditCard,
  FileMinus,
  FilePlus,
  FileText,
  History,
  ShoppingCart,
  TrendingUp,
} from "lucide-react"
import { Link } from "react-router-dom"
import { ReportSection } from "@/components/reports/ReportSection"
import { useAuthStore } from "@/store/auth"

/**
 * Halaman Laporan -- single page dgn 7 section vertikal.
 * Setiap section punya filter independen + tombol Download PDF & Excel.
 *
 * Backend: GET /reports/{slug}?format=pdf|xlsx&...filter -> file response.
 * Helper downloadFile (lib/download) hadle auth header + blob conversion.
 */
export function ReportsPage() {
  const role = useAuthStore((s) => s.user?.role)
  const isSuperAdmin = role === "SUPERADMIN"

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-5 lg:p-6">
      <div>
        <h1 className="text-xl font-bold text-ink-900 sm:text-2xl">Laporan</h1>
        <p className="text-[13px] text-ink-500 mt-0.5">
          Generate laporan PDF / Excel dengan filter periode & proyek.
          File langsung diunduh -- siap untuk arsip, owner, atau direksi.
        </p>
      </div>

      <ReportSection
        slug="cashflow"
        title="Cashflow"
        description="Arus kas (pemasukan vs pengeluaran) per periode + breakdown per kategori. Hanya transaksi tervalidasi yg dihitung."
        icon={TrendingUp}
      />

      <ReportSection
        slug="transactions"
        title="Transaksi Detail"
        description="Daftar lengkap transaksi dgn filter status & arah. Cocok utk audit & rekonsiliasi."
        icon={CreditCard}
        extraFilters={[
          {
            name: "status",
            label: "Status",
            type: "select",
            options: [
              { value: "DRAFT", label: "Draft" },
              { value: "SUBMITTED", label: "Menunggu Validasi" },
              { value: "VERIFIED", label: "Tervalidasi" },
              { value: "REJECTED", label: "Ditolak" },
              { value: "CANCELLED", label: "Dibatalkan" },
            ],
          },
          {
            name: "type",
            label: "Arah",
            type: "select",
            options: [
              { value: "IN", label: "Pemasukan" },
              { value: "OUT", label: "Pengeluaran" },
            ],
          },
        ]}
      />

      <ReportSection
        slug="invoices"
        title="Invoice"
        description="Daftar invoice (hutang & piutang) dgn detail pembayaran. Filter by tipe & status."
        icon={FilePlus}
        extraFilters={[
          {
            name: "type",
            label: "Tipe",
            type: "select",
            options: [
              { value: "IN", label: "Hutang (masuk)" },
              { value: "OUT", label: "Piutang (keluar)" },
            ],
          },
          {
            name: "status",
            label: "Status",
            type: "select",
            options: [
              { value: "DRAFT", label: "Draft" },
              { value: "ISSUED", label: "Belum Lunas" },
              { value: "PARTIALLY_PAID", label: "Sebagian" },
              { value: "PAID", label: "Lunas" },
              { value: "OVERDUE", label: "Jatuh Tempo" },
              { value: "CANCELLED", label: "Dibatalkan" },
            ],
          },
        ]}
      />

      {/* Laporan interaktif: tampilan + export CSV langsung di browser.
          Beda dgn ReportSection lain yg generate PDF/XLSX di server. */}
      <Link
        to="/reports/invoice-items"
        className="group flex items-start gap-3 rounded-md border bg-surface p-4 hover:border-brand-300 hover:shadow-sm transition-colors"
      >
        <div className="grid h-10 w-10 place-items-center rounded bg-brand-50 text-brand-600 shrink-0">
          <FileText className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-semibold text-ink-900 group-hover:text-brand-700">
              Detail Invoice (Per Item)
            </h3>
            <span className="rounded bg-info-50 text-info-700 px-1.5 py-0.5 text-[10px] font-semibold uppercase">
              Interaktif
            </span>
          </div>
          <p className="text-[12px] text-ink-500 mt-0.5">
            Tabel flatten semua item dr seluruh invoice. Filter periode/proyek/tipe/status,
            export CSV langsung. Untuk audit cepat & cetak rincian.
          </p>
        </div>
      </Link>

      <ReportSection
        slug="debts"
        title="Hutang & Piutang"
        description="Outstanding hutang ke vendor & piutang dr klien dgn aging (umur tagihan)."
        icon={FileMinus}
      />

      <ReportSection
        slug="budget"
        title="Budget vs Realisasi"
        description="Perbandingan target budget vs realisasi pengeluaran per kategori & proyek."
        icon={BadgeDollarSign}
      />

      <ReportSection
        slug="purchase-orders"
        title="Purchase Order"
        description="Daftar PO dgn workflow status (Draft → Issued → Approved)."
        icon={ShoppingCart}
        extraFilters={[
          {
            name: "status",
            label: "Status",
            type: "select",
            options: [
              { value: "DRAFT", label: "Draft" },
              { value: "ISSUED", label: "Diajukan" },
              { value: "APPROVED", label: "Disetujui" },
              { value: "CANCELLED", label: "Dibatalkan" },
            ],
          },
        ]}
      />

      {isSuperAdmin && (
        <ReportSection
          slug="audit-logs"
          title="Audit Log"
          description="Riwayat semua perubahan data (siapa, kapan, apa, sebelum-sesudah). Hanya SUPERADMIN."
          icon={History}
          hideProjectFilter
        />
      )}

      {!isSuperAdmin && (
        <div className="rounded-md border border-dashed bg-surface-muted p-4 text-center">
          <BarChart3 className="mx-auto h-6 w-6 text-ink-400 mb-2" />
          <p className="text-[12px] text-ink-500">
            Audit Log hanya tersedia untuk SUPERADMIN.
          </p>
        </div>
      )}
    </div>
  )
}
