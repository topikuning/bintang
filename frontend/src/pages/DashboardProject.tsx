import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import { Card, StatCard } from "@/components/ui/Card";
import { Badge, statusTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import CashflowChart from "@/components/charts/CashflowChart";
import SpendingPie from "@/components/charts/SpendingPie";
import BudgetProgress from "@/components/BudgetProgress";
import ProjectAttachments from "@/components/ProjectAttachments";
import AttachmentStrip from "@/components/AttachmentStrip";
import { formatDate, formatIDR } from "@/lib/utils";
import { AlertTriangle, Clock, FileText, Link2, Link2Off, Plus, Users } from "lucide-react";
import { canWrite, useAuthStore } from "@/store/auth";
import type { Page, Transaction } from "@/types";

interface AssignedUser {
  id: number;
  email: string;
  name: string;
  role: string;
}

export default function DashboardProject() {
  const { id } = useParams();
  const user = useAuthStore((s) => s.user);
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
  const txQ = useQuery({
    queryKey: ["project-transactions", id],
    queryFn: async () =>
      (await api.get<Page<Transaction>>(`/transactions?project_id=${id}&size=20`)).data,
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

      {canWrite(user) && (
        <div className="mb-3 grid grid-cols-2 gap-2">
          <Link to={`/transactions/new?project_id=${id}`}>
            <Button size="sm" className="w-full">
              <Plus className="h-4 w-4" /> Transaksi
            </Button>
          </Link>
          <Link to={`/invoices/new?project_id=${id}`}>
            <Button size="sm" variant="secondary" className="w-full">
              <FileText className="h-4 w-4" /> Invoice
            </Button>
          </Link>
        </div>
      )}

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
                      Sisa Belum Dialokasi
                    </div>
                    <div className="text-base font-bold tabular-nums text-sky-900">
                      {data.unlinked_out_count} txn
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

      {data.finance && data.finance.nilai_kontrak > 0 && (
        <Card className="mt-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold">Rincian Keuangan</div>
            <div className="text-[11px] text-slate-500">
              PPn {data.finance.ppn_pct}% · PPh {data.finance.pph_pct}% · Mkt {data.finance.marketing_pct}%
            </div>
          </div>
          <ul className="text-sm divide-y divide-slate-100">
            <li className="py-1.5 flex justify-between">
              <span className="text-slate-600">Nilai Kontrak</span>
              <span className="tabular-nums font-semibold">
                Rp {formatIDR(data.finance.nilai_kontrak)}
              </span>
            </li>
            <li className="py-1.5 flex justify-between">
              <span className="text-slate-600">DPP</span>
              <span className="tabular-nums">Rp {formatIDR(data.finance.dpp)}</span>
            </li>
            <li className="py-1.5 flex justify-between">
              <span className="text-slate-600">PPn ({data.finance.ppn_pct}%)</span>
              <span className="tabular-nums text-rose-700">
                − Rp {formatIDR(data.finance.ppn)}
              </span>
            </li>
            <li className="py-1.5 flex justify-between">
              <span className="text-slate-600">PPh ({data.finance.pph_pct}%)</span>
              <span className="tabular-nums text-rose-700">
                − Rp {formatIDR(data.finance.pph)}
              </span>
            </li>
            <li className="py-1.5 flex justify-between bg-emerald-50/50 -mx-3 px-3 rounded">
              <span className="font-semibold text-emerald-800">Nilai Cair</span>
              <span className="tabular-nums font-bold text-emerald-800">
                Rp {formatIDR(data.finance.nilai_cair)}
              </span>
            </li>
            <li className="py-1.5 flex justify-between">
              <span className="text-slate-600">Marketing ({data.finance.marketing_pct}%)</span>
              <span className="tabular-nums text-rose-700">
                − Rp {formatIDR(data.finance.marketing)}
              </span>
            </li>
            <li className="py-1.5 flex justify-between">
              <span className="text-slate-600">Biaya Aktual (realisasi)</span>
              <span className="tabular-nums text-rose-700">
                − Rp {formatIDR(data.finance.biaya_aktual)}
              </span>
            </li>
            <li className="py-1.5 flex justify-between">
              <span className="text-slate-600">Biaya Proyeksi (target)</span>
              <span className="tabular-nums text-rose-700">
                − Rp {formatIDR(data.finance.biaya_proyeksi)}
              </span>
            </li>
            <li
              className={`py-2 mt-1 flex justify-between rounded-lg px-2 ${
                data.finance.profit_now < 0 ? "bg-rose-50" : "bg-slate-50"
              }`}
            >
              <span className="font-semibold">Profit Saat Ini</span>
              <span
                className={`tabular-nums font-bold ${
                  data.finance.profit_now < 0 ? "text-rose-700" : "text-slate-900"
                }`}
              >
                Rp {formatIDR(data.finance.profit_now)}
              </span>
            </li>
            <li
              className={`py-2 flex justify-between rounded-lg px-2 ${
                data.finance.profit_proj < 0 ? "bg-rose-50" : "bg-emerald-50"
              }`}
            >
              <span className="font-semibold">Profit Proyeksi</span>
              <span
                className={`tabular-nums font-bold ${
                  data.finance.profit_proj < 0 ? "text-rose-700" : "text-emerald-800"
                }`}
              >
                Rp {formatIDR(data.finance.profit_proj)}
              </span>
            </li>
          </ul>
          <div className="mt-2 text-[11px] text-slate-500 leading-relaxed">
            DPP = Nilai Kontrak ÷ (1 + PPn%). Profit Saat Ini pakai realisasi
            pengeluaran; Profit Proyeksi pakai target pengeluaran (budget).
            Persentase pajak & marketing bisa diubah lewat menu Edit proyek.
          </div>
        </Card>
      )}

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

      {id && (
        <Card className="mt-3">
          <ProjectAttachments projectId={Number(id)} readOnly />
        </Card>
      )}

      {(data.invoices?.length ?? 0) > 0 && (
        <>
          <div className="mt-3 mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold">Invoice Proyek</div>
            <Link to={`/invoices?project_id=${id}`} className="text-xs text-slate-500">
              Lihat semua
            </Link>
          </div>
          <div className="space-y-2">
            {data.invoices.map((inv: any) => {
              const total = Number(inv.total || 0);
              const paid = Number(inv.paid_amount || 0);
              const outstanding = Number(inv.outstanding_amount || 0);
              const pct = total > 0 ? Math.min(100, (paid / total) * 100) : 0;
              const isPiutang = inv.type === "OUT";
              return (
                <Card key={inv.id} className="!p-3">
                  <Link
                    to={`/invoices/${inv.id}`}
                    className="block active:bg-slate-50 -m-3 p-3 rounded-2xl"
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`h-9 w-9 shrink-0 rounded-full grid place-items-center text-xs font-bold ${
                          isPiutang
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-rose-100 text-rose-700"
                        }`}
                      >
                        {isPiutang ? "P" : "H"}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">
                          INV {inv.number}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate">
                          {formatDate(inv.invoice_date)}
                          {inv.due_date && ` · jatuh tempo ${formatDate(inv.due_date)}`}
                          {inv.party_name ? ` · ${inv.party_name}` : ""}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="tabular-nums font-semibold text-sm">
                          Rp {formatIDR(total)}
                        </div>
                        <Badge tone={statusTone(inv.status)}>{inv.status}</Badge>
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                      <div>
                        <div className="text-slate-500">Dibayar</div>
                        <div className="tabular-nums font-semibold text-emerald-700">
                          Rp {formatIDR(paid)}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">Sisa</div>
                        <div
                          className={`tabular-nums font-semibold ${
                            outstanding > 0 ? "text-rose-700" : "text-slate-500"
                          }`}
                        >
                          Rp {formatIDR(outstanding)}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">Tipe</div>
                        <div className="font-semibold">
                          {isPiutang ? "Piutang (OUT)" : "Hutang (IN)"}
                        </div>
                      </div>
                    </div>
                    {total > 0 && (
                      <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className="h-full bg-emerald-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    )}
                  </Link>
                </Card>
              );
            })}
          </div>
        </>
      )}

      <div className="mt-3 mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold">Transaksi Terbaru</div>
        <Link to={`/transactions?project_id=${id}`} className="text-xs text-slate-500">
          Lihat semua
        </Link>
      </div>
      <div className="space-y-2">
        {txQ.isLoading && (
          <div className="text-sm text-slate-500">Memuat transaksi...</div>
        )}
        {!txQ.isLoading &&
          (txQ.data?.items || []).map((t) => (
            <Card key={t.id} className="!p-3">
              <Link
                to={`/transactions/${t.id}`}
                className="flex items-start gap-3 active:bg-slate-50 -m-3 p-3 rounded-2xl"
              >
                <div
                  className={`h-9 w-9 shrink-0 rounded-full grid place-items-center text-sm font-semibold ${
                    t.type === "IN"
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-rose-100 text-rose-700"
                  }`}
                >
                  {t.type === "IN" ? "+" : "-"}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">
                    {t.description || t.party_name || "Transaksi"}
                  </div>
                  <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                    <span>
                      {formatDate(t.tx_date)} · {t.payment_method}
                    </span>
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
        {!txQ.isLoading && (txQ.data?.items.length ?? 0) === 0 && (
          <Card>
            <div className="py-2 text-sm text-slate-500">Belum ada transaksi.</div>
          </Card>
        )}
      </div>
    </div>
  );
}
