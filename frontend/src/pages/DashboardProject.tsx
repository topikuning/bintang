import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import { Card, StatCard } from "@/components/ui/Card";
import { Badge, statusTone } from "@/components/ui/Badge";
import CashflowChart from "@/components/charts/CashflowChart";
import SpendingPie from "@/components/charts/SpendingPie";
import BudgetProgress from "@/components/BudgetProgress";
import { formatDate, formatIDR } from "@/lib/utils";
import { AlertTriangle, Clock, Link2Off, Users } from "lucide-react";

interface AssignedUser {
  id: number;
  email: string;
  name: string;
  role: string;
}

export default function DashboardProject() {
  const { id } = useParams();
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-project", id],
    queryFn: async () => (await api.get(`/dashboard/project/${id}`)).data,
    enabled: !!id,
  });
  const teamQ = useQuery({
    queryKey: ["project-team", id],
    queryFn: async () => (await api.get<AssignedUser[]>(`/projects/${id}/users`)).data,
    enabled: !!id,
  });

  if (isLoading || !data) return <div className="p-2 text-sm text-slate-500">Memuat...</div>;

  return (
    <div>
      <PageHeader
        back
        title={data.project.name}
        subtitle={`${data.project.code} · ${data.project.status}`}
        right={<Badge tone={statusTone(data.health)}>{data.health}</Badge>}
      />

      <div className="grid grid-cols-2 gap-2.5">
        <StatCard label="Masuk" value={`Rp ${formatIDR(data.totals.in)}`} tone="good" />
        <StatCard label="Keluar" value={`Rp ${formatIDR(data.totals.out)}`} tone="bad" />
        <StatCard
          label="Saldo"
          value={`Rp ${formatIDR(data.totals.balance)}`}
          tone={data.totals.balance < 0 ? "bad" : "good"}
        />
        <StatCard
          label="Pengeluaran/Pemasukan"
          value={data.expense_to_income_ratio_pct == null ? "-" : `${data.expense_to_income_ratio_pct.toFixed(1)}%`}
        />
      </div>

      <Card className="mt-3">
        <div className="text-xs text-slate-500">Budget</div>
        <div className="mt-1 flex items-baseline justify-between gap-2">
          <div className="text-base font-semibold tabular-nums">
            Rp {formatIDR(data.budget.spent)}{" "}
            <span className="text-xs text-slate-500">
              / Rp {formatIDR(data.budget.amount)}
            </span>
          </div>
          <Badge tone={statusTone(data.budget.status)}>{data.budget.status}</Badge>
        </div>
        <div className="mt-2">
          <BudgetProgress pct={data.budget.usage_pct} status={data.budget.status} />
        </div>
        <div className="mt-1 text-[11px] text-slate-500">
          Sisa: Rp {formatIDR(data.budget.remaining)}
        </div>
      </Card>

      {(data.totals.pending_in > 0 || data.totals.pending_out > 0) && (
        <div className="mt-2 text-[11px] text-slate-500">
          Termasuk pending: +Rp {formatIDR(data.totals.pending_in)} / −Rp{" "}
          {formatIDR(data.totals.pending_out)}
        </div>
      )}

      {(data.pending_count > 0 || data.unlinked_out_count > 0) && (
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          {data.pending_count > 0 && (
            <Link to={`/transactions?project_id=${id}&status=DRAFT`}>
              <Card className="!p-3 border-amber-200 bg-amber-50/60">
                <div className="flex items-start gap-2">
                  <Clock className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-[11px] uppercase font-medium text-amber-700/80">
                      Belum Verifikasi
                    </div>
                    <div className="text-base font-bold tabular-nums text-amber-900">
                      {data.pending_count}
                    </div>
                    <div className="text-[11px] text-amber-800 tabular-nums truncate">
                      Rp {formatIDR(data.pending_total)}
                    </div>
                  </div>
                </div>
              </Card>
            </Link>
          )}
          {data.unlinked_out_count > 0 && (
            <Link to={`/transactions?project_id=${id}&type=OUT`}>
              <Card className="!p-3 border-sky-200 bg-sky-50/60">
                <div className="flex items-start gap-2">
                  <Link2Off className="h-5 w-5 text-sky-600 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-[11px] uppercase font-medium text-sky-700/80">
                      OUT Tanpa Invoice
                    </div>
                    <div className="text-base font-bold tabular-nums text-sky-900">
                      {data.unlinked_out_count}
                    </div>
                    <div className="text-[11px] text-sky-800 tabular-nums truncate">
                      Rp {formatIDR(data.unlinked_out_total)}
                    </div>
                  </div>
                </div>
              </Card>
            </Link>
          )}
        </div>
      )}

      {data.warnings?.length > 0 && (
        <Card className="mt-3 border-amber-200 bg-amber-50">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <ul className="text-xs text-amber-800 list-disc list-inside">
              {data.warnings.map((w: string) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-2.5 mt-3">
        <StatCard label="Invoice Belum Lunas" value={`Rp ${formatIDR(data.invoice_open_total)}`} />
        <StatCard label="Invoice Lunas" value={`Rp ${formatIDR(data.invoice_paid_total)}`} tone="good" />
      </div>

      {data.monthly_cashflow?.length > 0 && (
        <Card className="mt-3">
          <div className="mb-2 text-sm font-semibold">Cashflow Bulanan</div>
          <CashflowChart data={data.monthly_cashflow} />
        </Card>
      )}

      {data.by_category?.length > 0 && (
        <Card className="mt-3">
          <div className="mb-2 text-sm font-semibold">Pengeluaran per Kategori</div>
          <SpendingPie
            data={data.by_category.map((c: any) => ({ name: c.category, value: c.total }))}
          />
          <ul className="mt-2 space-y-1.5">
            {data.by_category.map((c: any) => {
              const pct = data.totals.out > 0 ? (c.total / data.totals.out) * 100 : 0;
              return (
                <li key={c.category} className="flex justify-between text-sm">
                  <span className="text-slate-700">{c.category}</span>
                  <span className="tabular-nums font-medium">
                    Rp {formatIDR(c.total)}{" "}
                    <span className="text-slate-500 text-xs">({pct.toFixed(1)}%)</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {teamQ.data && teamQ.data.length > 0 && (
        <Card className="mt-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Users className="h-4 w-4 text-slate-500" />
            Tim Admin Proyek ({teamQ.data.length})
          </div>
          <ul className="space-y-1.5">
            {teamQ.data.map((u) => (
              <li key={u.id} className="flex items-center gap-2 text-sm">
                <div className="grid h-7 w-7 place-items-center rounded-full bg-slate-200 text-xs font-bold text-slate-700">
                  {u.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{u.name}</div>
                  <div className="text-[11px] text-slate-500 truncate">{u.email}</div>
                </div>
                <Badge tone={u.role === "SUPERADMIN" ? "info" : "neutral"}>{u.role}</Badge>
              </li>
            ))}
          </ul>
          <div className="mt-2 text-[11px] text-slate-500">
            Untuk mengubah tim, buka menu Proyek → ikon edit pada proyek ini.
          </div>
        </Card>
      )}

      <Card className="mt-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold">Transaksi Terbaru</div>
          <Link to={`/transactions?project_id=${id}`} className="text-xs text-slate-500">
            Lihat semua
          </Link>
        </div>
        <ul className="divide-y">
          {data.recent_transactions.map((t: any) => (
            <li key={t.id} className="py-2 flex items-center gap-2">
              <div
                className={`h-8 w-8 rounded-full grid place-items-center text-xs font-semibold ${
                  t.type === "IN"
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-rose-100 text-rose-700"
                }`}
              >
                {t.type === "IN" ? "+" : "-"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{t.description || t.party || "Transaksi"}</div>
                <div className="text-[11px] text-slate-500">
                  {formatDate(t.date)} · {t.status}
                </div>
              </div>
              <div
                className={`tabular-nums text-sm font-semibold ${
                  t.type === "IN" ? "text-emerald-700" : "text-rose-700"
                }`}
              >
                Rp {formatIDR(t.amount)}
              </div>
            </li>
          ))}
          {data.recent_transactions.length === 0 && (
            <li className="py-3 text-sm text-slate-500">Belum ada transaksi.</li>
          )}
        </ul>
      </Card>
    </div>
  );
}
