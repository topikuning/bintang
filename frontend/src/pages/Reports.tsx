import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Input";
import { useAuthStore } from "@/store/auth";
import type { Page, Project } from "@/types";
import { Download, Loader2 } from "lucide-react";

const REPORTS = [
  { key: "cashflow", label: "Arus Kas" },
  { key: "transactions-in", label: "Transaksi Masuk", path: "transactions", extra: { type: "IN" } },
  { key: "transactions-out", label: "Transaksi Keluar", path: "transactions", extra: { type: "OUT" } },
  { key: "invoices-in", label: "Invoice Masuk (Hutang)", path: "invoices", extra: { type: "IN" } },
  { key: "invoices-out", label: "Invoice Keluar (Piutang)", path: "invoices", extra: { type: "OUT" } },
  { key: "debts", label: "Hutang & Piutang" },
  { key: "budget", label: "Budget Control" },
  { key: "purchase-orders", label: "Purchase Order" },
  { key: "audit-logs", label: "Audit Log (Superadmin)" },
] as const;

export default function ReportsPage() {
  const user = useAuthStore((s) => s.user);
  const [filters, setFilters] = useState<{ project_id?: string; date_from?: string; date_to?: string }>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const projectsQ = useQuery({
    queryKey: ["projects-light"],
    queryFn: async () => (await api.get<Page<Project>>("/projects?size=1000")).data,
  });

  function reportPath(r: typeof REPORTS[number]) {
    return (r as any).path || r.key;
  }

  async function download(r: typeof REPORTS[number], format: "pdf" | "xlsx") {
    setError(null);
    setBusyKey(`${r.key}:${format}`);
    try {
      const params = new URLSearchParams({ format, ...((r as any).extra || {}) });
      if (filters.project_id) params.set("project_id", filters.project_id);
      if (filters.date_from) params.set("date_from", filters.date_from);
      if (filters.date_to) params.set("date_to", filters.date_to);

      const res = await api.get(`/reports/${reportPath(r)}?${params}`, {
        responseType: "blob",
      });
      const mime =
        format === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      const blob = new Blob([res.data], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${r.label.replace(/\W+/g, "_")}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      let detail = e?.response?.data?.detail || e?.message || "Gagal mengunduh";
      // Blob error body needs reading
      if (e?.response?.data instanceof Blob) {
        try {
          const text = await e.response.data.text();
          const j = JSON.parse(text);
          detail = j?.detail || text;
        } catch {
          /* ignore */
        }
      }
      setError(`${r.label}: ${detail}`);
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div>
      <PageHeader back title="Laporan" subtitle="Ekspor PDF atau Excel" />

      <Card className="mb-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Proyek">
            <Select
              value={filters.project_id || ""}
              onChange={(e) => setFilters({ ...filters, project_id: e.target.value })}
            >
              <option value="">Semua</option>
              {projectsQ.data?.items.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </Field>
          <div />
          <Field label="Dari Tanggal">
            <Input
              type="date"
              value={filters.date_from || ""}
              onChange={(e) => setFilters({ ...filters, date_from: e.target.value })}
            />
          </Field>
          <Field label="Sampai Tanggal">
            <Input
              type="date"
              value={filters.date_to || ""}
              onChange={(e) => setFilters({ ...filters, date_to: e.target.value })}
            />
          </Field>
        </div>
      </Card>

      {error && (
        <Card className="mb-3 border-rose-200 bg-rose-50">
          <div className="text-xs text-rose-700">{error}</div>
        </Card>
      )}

      <div className="space-y-2">
        {REPORTS.filter((r) => r.key !== "audit-logs" || user?.role === "SUPERADMIN").map((r) => {
          const pdfBusy = busyKey === `${r.key}:pdf`;
          const xlsxBusy = busyKey === `${r.key}:xlsx`;
          return (
            <Card key={r.key} className="!p-3 flex items-center gap-2">
              <div className="flex-1 text-sm font-medium">{r.label}</div>
              <Button size="sm" variant="secondary" disabled={pdfBusy} onClick={() => download(r, "pdf")}>
                {pdfBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} PDF
              </Button>
              <Button size="sm" disabled={xlsxBusy} onClick={() => download(r, "xlsx")}>
                {xlsxBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} XLSX
              </Button>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
