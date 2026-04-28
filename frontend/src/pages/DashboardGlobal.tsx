import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { Card, StatCard } from "@/components/ui/Card";
import PageHeader from "@/components/ui/PageHeader";
import { Badge, statusTone } from "@/components/ui/Badge";
import CashflowChart from "@/components/charts/CashflowChart";
import SpendingPie from "@/components/charts/SpendingPie";
import BudgetProgress from "@/components/BudgetProgress";
import Combobox from "@/components/ui/Combobox";
import { Input } from "@/components/ui/Input";
import { formatIDR } from "@/lib/utils";
import { AlertTriangle, Flame, TrendingUp, TrendingDown, Clock, Link2Off, Search } from "lucide-react";
import { useAuthStore } from "@/store/auth";
import type { Company, Page } from "@/types";

export default function DashboardGlobal() {
  const user = useAuthStore((s) => s.user);
  const [q, setQ] = useState("");
  const [companyId, setCompanyId] = useState<number | null>(null);

  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (companyId) params.set("company_id", String(companyId));

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-global", q, companyId],
    queryFn: async () => (await api.get(`/dashboard/global?${params}`)).data,
  });

  const { data: companies } = useQuery({
    queryKey: ["companies"],
    queryFn: async () => (await api.get<Page<Company>>("/companies?size=500")).data,
  });

  return (
    <div>
      <PageHeader
        title={`Halo, ${user?.name?.split(" ")[0] || ""}`}
        subtitle={
          q || companyId
            ? "Ringkasan terfilter"
            : "Ringkasan keuangan seluruh proyek"
        }
      />

      {/* Filter bar */}
      <Card className="mb-3 !p-2.5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari nama / kode proyek..."
              className="pl-9"
            />
          </div>
          <Combobox
            value={companyId}
            onChange={(v) => setCompanyId(v == null ? null : Number(v))}
            options={(companies?.items || []).map((c) => ({
              value: c.id,
              label: c.name,
            }))}
            placeholder="Semua perusahaan"
          />
        </div>
      </Card>

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

          {(data.totals.pending_in > 0 || data.totals.pending_out > 0) && (
            <div className="mt-2 text-[11px] text-slate-500">
              Termasuk pending: +Rp {formatIDR(data.totals.pending_in)} / −Rp{" "}
              {formatIDR(data.totals.pending_out)}
            </div>
          )}

          {(data.pending_count > 0 || data.unlinked_out_count > 0) && (
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              {data.pending_count > 0 && (
                <Link to="/transactions?status=DRAFT">
                  <Card className="!p-3 border-amber-200 bg-amber-50/60 active:bg-amber-100">
                    <div className="flex items-start gap-2">
                      <Clock className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <div className="text-[11px] uppercase font-medium text-amber-700/80">
                          Belum Verifikasi
                        </div>
                        <div className="text-base font-bold tabular-nums text-amber-900">
                          {data.pending_count} transaksi
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
                <Link to="/transactions?type=OUT">
                  <Card className="!p-3 border-sky-200 bg-sky-50/60 active:bg-sky-100">
                    <div className="flex items-start gap-2">
                      <Link2Off className="h-5 w-5 text-sky-600 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <div className="text-[11px] uppercase font-medium text-sky-700/80">
                          OUT Tanpa Invoice
                        </div>
                        <div className="text-base font-bold tabular-nums text-sky-900">
                          {data.unlinked_out_count} transaksi
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

          {data.top_spender && (
            <Card className="mt-3 border-rose-200 bg-rose-50/60">
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-full bg-rose-100 text-rose-600">
                  <Flame className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] uppercase tracking-wide text-rose-700/80 font-medium">
                    Proyek Paling Boros
                  </div>
                  <div className="font-semibold truncate">{data.top_spender.name}</div>
                  <div className="text-sm tabular-nums">
                    Rp {formatIDR(data.top_spender.total)}
                  </div>
                </div>
                {data.totals.out > 0 && (
                  <div className="text-right shrink-0">
                    <div className="text-[11px] text-slate-500">% dari total</div>
                    <div className="text-base font-bold tabular-nums text-rose-700">
                      {((data.top_spender.total / data.totals.out) * 100).toFixed(1)}%
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )}

          {data.monthly_cashflow?.length > 0 && (
            <Card className="mt-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <TrendingUp className="h-4 w-4 text-emerald-600" />
                <TrendingDown className="h-4 w-4 text-rose-600" />
                Arus Kas Bulanan
              </div>
              <CashflowChart data={data.monthly_cashflow} />
            </Card>
          )}

          {data.spending_by_project?.length > 0 && (
            <Card className="mt-3">
              <div className="mb-1 text-sm font-semibold">Proporsi Pengeluaran per Proyek</div>
              <div className="text-[11px] text-slate-500 mb-1">
                Total Rp {formatIDR(data.totals.out)}
              </div>
              <SpendingPie
                data={data.spending_by_project.map((s: any) => ({
                  name: s.name,
                  value: s.total,
                }))}
              />
            </Card>
          )}

          {data.spending_by_category?.length > 0 && (
            <Card className="mt-3">
              <div className="mb-2 text-sm font-semibold">Proporsi Pengeluaran per Kategori</div>
              <SpendingPie
                data={data.spending_by_category.map((s: any) => ({
                  name: s.category,
                  value: s.total,
                }))}
              />
              <ul className="mt-2 space-y-1 text-xs">
                {data.spending_by_category.slice(0, 5).map((c: any) => {
                  const pct = data.totals.out > 0 ? (c.total / data.totals.out) * 100 : 0;
                  return (
                    <li key={c.category} className="flex justify-between">
                      <span className="text-slate-700 truncate">{c.category}</span>
                      <span className="tabular-nums font-medium">
                        Rp {formatIDR(c.total)}{" "}
                        <span className="text-slate-500">({pct.toFixed(1)}%)</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
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
