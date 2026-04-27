import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Input";
import { useAuthStore } from "@/store/auth";
import type { Page, Project } from "@/types";
import { Download } from "lucide-react";

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
  const projectsQ = useQuery({
    queryKey: ["projects-light"],
    queryFn: async () => (await api.get<Page<Project>>("/projects?size=200")).data,
  });

  function buildUrl(r: typeof REPORTS[number], format: "pdf" | "xlsx") {
    const path = (r as any).path || r.key;
    const extra = (r as any).extra || {};
    const params = new URLSearchParams({ format, ...extra });
    if (filters.project_id) params.set("project_id", filters.project_id);
    if (filters.date_from) params.set("date_from", filters.date_from);
    if (filters.date_to) params.set("date_to", filters.date_to);
    return `${import.meta.env.VITE_API_BASE_URL || "/api/v1"}/reports/${path}?${params}`;
  }

  return (
    <div>
      <PageHeader back title="Laporan" subtitle="Ekspor PDF atau Excel" />

      <Card className="mb-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Proyek">
            <Select value={filters.project_id || ""} onChange={(e) => setFilters({ ...filters, project_id: e.target.value })}>
              <option value="">Semua</option>
              {projectsQ.data?.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <div />
          <Field label="Dari Tanggal"><Input type="date" value={filters.date_from || ""} onChange={(e) => setFilters({ ...filters, date_from: e.target.value })} /></Field>
          <Field label="Sampai Tanggal"><Input type="date" value={filters.date_to || ""} onChange={(e) => setFilters({ ...filters, date_to: e.target.value })} /></Field>
        </div>
      </Card>

      <div className="space-y-2">
        {REPORTS.filter((r) => r.key !== "audit-logs" || user?.role === "SUPERADMIN").map((r) => (
          <Card key={r.key} className="!p-3 flex items-center gap-2">
            <div className="flex-1 text-sm font-medium">{r.label}</div>
            <a href={buildUrl(r, "pdf")} target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="secondary"><Download className="h-4 w-4" /> PDF</Button>
            </a>
            <a href={buildUrl(r, "xlsx")} target="_blank" rel="noopener noreferrer">
              <Button size="sm"><Download className="h-4 w-4" /> XLSX</Button>
            </a>
          </Card>
        ))}
      </div>
    </div>
  );
}
