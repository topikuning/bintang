import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge, statusTone } from "@/components/ui/Badge";
import { Select } from "@/components/ui/Input";
import AttachmentStrip from "@/components/AttachmentStrip";
import { formatDate, formatIDR } from "@/lib/utils";
import { Link2, Plus } from "lucide-react";
import { canWrite, useAuthStore } from "@/store/auth";
import type { Page, Project, Transaction } from "@/types";

export default function TransactionsPage() {
  const user = useAuthStore((s) => s.user);
  const [params, setParams] = useSearchParams();
  const projectId = params.get("project_id") || "";
  const type = params.get("type") || "";
  const status = params.get("status") || "";

  const { data: projects } = useQuery({
    queryKey: ["projects-light"],
    queryFn: async () => (await api.get<Page<Project>>("/projects?size=1000")).data,
  });

  const qs = new URLSearchParams();
  if (projectId) qs.set("project_id", projectId);
  if (type) qs.set("type", type);
  if (status) qs.set("status", status);
  qs.set("size", "100");

  const { data, isLoading } = useQuery({
    queryKey: ["transactions", qs.toString()],
    queryFn: async () => (await api.get<Page<Transaction>>(`/transactions?${qs}`)).data,
  });

  function setQ(k: string, v: string) {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p);
  }

  return (
    <div>
      <PageHeader
        title="Transaksi"
        subtitle="Catatan uang masuk & keluar"
        right={
          canWrite(user) && (
            <Link to="/transactions/new">
              <Button size="sm">
                <Plus className="h-4 w-4" /> Baru
              </Button>
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
          <option value="IN">Masuk</option>
          <option value="OUT">Keluar</option>
        </Select>
        <Select value={status} onChange={(e) => setQ("status", e.target.value)}>
          <option value="">Semua Status</option>
          <option value="DRAFT">Draft</option>
          <option value="SUBMITTED">Submitted</option>
          <option value="VERIFIED">Verified</option>
          <option value="REJECTED">Rejected</option>
          <option value="CANCELLED">Cancelled</option>
        </Select>
      </div>

      {isLoading ? (
        <div className="text-sm text-slate-500">Memuat...</div>
      ) : (
        <div className="space-y-2">
          {data?.items.map((t) => (
            <Card key={t.id} className="!p-3">
              <Link
                to={`/transactions/${t.id}`}
                className="flex items-start gap-3 active:bg-slate-50 -m-3 p-3 rounded-2xl"
              >
                <div
                  className={`h-9 w-9 shrink-0 rounded-full grid place-items-center text-sm font-semibold ${
                    t.type === "IN" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                  }`}
                >
                  {t.type === "IN" ? "+" : "-"}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">
                    {t.description || t.party_name || "Transaksi"}
                  </div>
                  <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                    <span>{formatDate(t.tx_date)} · {t.payment_method}</span>
                    {t.invoice_id && (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-sky-100 text-sky-700 px-1.5 py-0.5">
                        <Link2 className="h-3 w-3" />
                        INV#{t.invoice_id}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div
                    className={`tabular-nums font-semibold text-sm ${
                      t.type === "IN" ? "text-emerald-700" : "text-rose-700"
                    }`}
                  >
                    Rp {formatIDR(t.amount)}
                  </div>
                  <Badge tone={statusTone(t.status)}>{t.status}</Badge>
                </div>
              </Link>
              <AttachmentStrip attachments={t.attachments} />
            </Card>
          ))}
          {data?.items.length === 0 && <div className="text-sm text-slate-500">Tidak ada transaksi.</div>}
        </div>
      )}
    </div>
  );
}
