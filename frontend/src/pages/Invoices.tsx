import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Input";
import { Badge, statusTone } from "@/components/ui/Badge";
import { formatDate, formatIDR } from "@/lib/utils";
import { Plus } from "lucide-react";
import { canWrite, useAuthStore } from "@/store/auth";
import type { Invoice, Page, Project } from "@/types";

export default function InvoicesPage() {
  const [params, setParams] = useSearchParams();
  const projectId = params.get("project_id") || "";
  const type = params.get("type") || "";
  const status = params.get("status") || "";

  const { data: projects } = useQuery({
    queryKey: ["projects-light"],
    queryFn: async () => (await api.get<Page<Project>>("/projects?size=200")).data,
  });

  const qs = new URLSearchParams();
  if (projectId) qs.set("project_id", projectId);
  if (type) qs.set("type", type);
  if (status) qs.set("status", status);

  const { data, isLoading } = useQuery({
    queryKey: ["invoices", qs.toString()],
    queryFn: async () => (await api.get<Page<Invoice>>(`/invoices?${qs}`)).data,
  });

  function setQ(k: string, v: string) {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v); else p.delete(k);
    setParams(p);
  }

  const user = useAuthStore((s) => s.user);

  return (
    <div>
      <PageHeader
        title="Invoice"
        subtitle="Tagihan masuk & keluar"
        right={
          canWrite(user) && (
            <Link to="/invoices/new">
              <Button size="sm"><Plus className="h-4 w-4" /> Baru</Button>
            </Link>
          )
        }
      />

      <div className="grid grid-cols-3 gap-2 mb-3">
        <Select value={projectId} onChange={(e) => setQ("project_id", e.target.value)}>
          <option value="">Semua Proyek</option>
          {projects?.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <Select value={type} onChange={(e) => setQ("type", e.target.value)}>
          <option value="">Semua Tipe</option>
          <option value="OUT">Piutang (uang akan masuk)</option>
          <option value="IN">Hutang (uang akan keluar)</option>
        </Select>
        <Select value={status} onChange={(e) => setQ("status", e.target.value)}>
          <option value="">Semua Status</option>
          <option value="DRAFT">Draft</option>
          <option value="ISSUED">Issued</option>
          <option value="PARTIALLY_PAID">Partially Paid</option>
          <option value="PAID">Paid</option>
          <option value="OVERDUE">Overdue</option>
          <option value="CANCELLED">Cancelled</option>
        </Select>
      </div>

      {isLoading ? (
        <div className="text-sm text-slate-500">Memuat...</div>
      ) : (
        <div className="space-y-2">
          {data?.items.map((inv) => (
            <Link key={inv.id} to={`/invoices/${inv.id}`}>
              <Card className="!p-3 active:bg-slate-50">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge tone={inv.type === "IN" ? "bad" : "good"}>{inv.type === "IN" ? "Hutang" : "Piutang"}</Badge>
                      <span className="text-xs text-slate-500 truncate">{inv.number}</span>
                    </div>
                    <div className="text-sm font-medium truncate mt-0.5">{inv.party_name || "-"}</div>
                    <div className="text-[11px] text-slate-500">
                      {formatDate(inv.invoice_date)} · jatuh tempo {formatDate(inv.due_date)}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="tabular-nums font-semibold text-sm">Rp {formatIDR(inv.total)}</div>
                    <div className="text-[11px] text-slate-500">Sisa: Rp {formatIDR(inv.remaining)}</div>
                    <Badge tone={statusTone(inv.status)}>{inv.status}</Badge>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
          {data?.items.length === 0 && <div className="text-sm text-slate-500">Belum ada invoice.</div>}
        </div>
      )}
    </div>
  );
}
