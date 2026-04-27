import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { Card, StatCard } from "@/components/ui/Card";
import PageHeader from "@/components/ui/PageHeader";
import { Badge, statusTone } from "@/components/ui/Badge";
import CashflowChart from "@/components/charts/CashflowChart";
import BudgetProgress from "@/components/BudgetProgress";
import { formatIDR } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";
import { useAuthStore } from "@/store/auth";

export default function DashboardGlobal() {
  const user = useAuthStore((s) => s.user);
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-global"],
    queryFn: async () => (await api.get("/dashboard/global")).data,
  });

  return (
    <div>
      <PageHeader
        title={`Halo, ${user?.name?.split(" ")[0] || ""}`}
        subtitle="Ringkasan keuangan seluruh proyek"
      />

      {isLoading || !data ? (
        <div className="text-sm text-slate-500">Memuat...</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            <StatCard
              label="Uang Masuk"
              value={`Rp ${formatIDR(data.totals.in)}`}
              tone="good"
            />
            <StatCard
              label="Uang Keluar"
              value={`Rp ${formatIDR(data.totals.out)}`}
              tone="bad"
            />
            <StatCard
              label="Saldo"
              value={`Rp ${formatIDR(data.totals.balance)}`}
              tone={data.totals.balance < 0 ? "bad" : "good"}
            />
            <StatCard
              label="Proyek Aktif"
              value={`${data.active_projects} / ${data.total_projects}`}
            />
          </div>

          {data.warnings?.length > 0 && (
            <Card className="mt-3 border-amber-200 bg-amber-50">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <div className="font-medium text-amber-900">Peringatan</div>
                  <ul className="list-disc list-inside text-amber-800 text-xs">
                    {data.warnings.map((w: string) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </Card>
          )}

          {data.monthly_cashflow?.length > 0 && (
            <Card className="mt-3">
              <div className="mb-2 text-sm font-semibold">Arus Kas Bulanan</div>
              <CashflowChart data={data.monthly_cashflow} />
            </Card>
          )}

          <h2 className="mt-4 mb-2 text-sm font-semibold text-slate-700">
            Ringkasan per Proyek
          </h2>
          <div className="space-y-2.5">
            {data.projects.map((p: any) => (
              <Link key={p.id} to={`/projects/${p.id}`}>
                <Card className="active:bg-slate-50">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{p.name}</div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {p.code} · {p.company || "-"}
                      </div>
                    </div>
                    <Badge tone={statusTone(p.health)}>{p.health}</Badge>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <div className="text-slate-500">Masuk</div>
                      <div className="font-semibold text-emerald-700 tabular-nums">
                        Rp {formatIDR(p.total_in)}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Keluar</div>
                      <div className="font-semibold text-rose-700 tabular-nums">
                        Rp {formatIDR(p.total_out)}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Saldo</div>
                      <div
                        className={`font-semibold tabular-nums ${p.balance < 0 ? "text-rose-700" : "text-slate-900"}`}
                      >
                        Rp {formatIDR(p.balance)}
                      </div>
                    </div>
                  </div>
                  {p.budget?.amount > 0 && (
                    <div className="mt-3">
                      <BudgetProgress
                        pct={p.budget.usage_pct}
                        status={p.budget.status}
                      />
                    </div>
                  )}
                </Card>
              </Link>
            ))}
            {data.projects.length === 0 && (
              <Card>
                <div className="text-sm text-slate-500">Belum ada proyek.</div>
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}
