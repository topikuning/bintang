import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import Modal from "@/components/Modal";
import Combobox from "@/components/ui/Combobox";
import TeamManager from "@/components/TeamManager";
import ProjectAttachments from "@/components/ProjectAttachments";
import BudgetProgress from "@/components/BudgetProgress";
import { Badge, statusTone } from "@/components/ui/Badge";
import { Building2, Pencil, Plus, Search } from "lucide-react";
import { formatIDR } from "@/lib/utils";
import { useAuthStore, isAdmin } from "@/store/auth";
import type { Company, Page, User } from "@/types";

interface ProjectStats {
  id: number;
  code: string;
  name: string;
  location?: string | null;
  status: string;
  currency: string;
  company_id: number | null;
  company: string | null;
  project_value: number;
  budget_amount: number;
  total_in: number;
  total_out: number;
  balance: number;
  invoice_open: number;
  budget: {
    amount: number;
    spent: number;
    remaining: number;
    usage_pct: number;
    status: string;
  };
  health: string;
}

export default function ProjectsPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [editing, setEditing] = useState<any>(null);
  const [open, setOpen] = useState(false);

  // filter
  const [q, setQ] = useState("");
  const [companyId, setCompanyId] = useState<number | null>(null);

  const filterParams = new URLSearchParams();
  if (q.trim()) filterParams.set("q", q.trim());
  if (companyId) filterParams.set("company_id", String(companyId));

  const { data: stats, isLoading } = useQuery<ProjectStats[]>({
    queryKey: ["projects-stats", q, companyId],
    queryFn: async () =>
      (await api.get<ProjectStats[]>(`/projects/stats?${filterParams}`)).data,
  });

  const { data: companies } = useQuery({
    queryKey: ["companies"],
    queryFn: async () => (await api.get<Page<Company>>("/companies?size=500")).data,
  });
  const { data: users } = useQuery({
    enabled: isAdmin(user),
    queryKey: ["users"],
    queryFn: async () => (await api.get<Page<User>>("/users?size=500")).data,
  });

  const save = useMutation({
    mutationFn: async (p: any) => {
      const payload = {
        ...p,
        project_value: String(p.project_value ?? "0"),
        budget_amount: String(p.budget_amount ?? "0"),
        overbudget_tolerance_pct: String(p.overbudget_tolerance_pct ?? "0"),
        company_id: p.company_id ? Number(p.company_id) : null,
        pic_user_id: p.pic_user_id ? Number(p.pic_user_id) : null,
      };
      if (p.id) return (await api.patch(`/projects/${p.id}`, payload)).data;
      return (await api.post("/projects", payload)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects-stats"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["projects-light"] });
      setOpen(false);
      setEditing(null);
    },
  });

  function newProject() {
    setEditing({
      code: "",
      name: "",
      company_id: null,
      pic_user_id: null,
      status: "AKTIF",
      currency: "IDR",
      project_value: 0,
      budget_amount: 0,
      overbudget_tolerance_pct: 0,
    });
    setOpen(true);
  }

  const noCompanies = companies !== undefined && companies.items.length === 0;

  return (
    <div>
      <PageHeader
        title="Proyek"
        right={
          isAdmin(user) && (
            <Button size="sm" onClick={newProject}>
              <Plus className="h-4 w-4" /> Baru
            </Button>
          )
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

      {isLoading ? (
        <div className="text-sm text-slate-500">Memuat...</div>
      ) : (stats?.length ?? 0) === 0 ? (
        <div className="text-sm text-slate-500 italic text-center py-8">
          Tidak ada proyek yang cocok dengan filter.
        </div>
      ) : (
        <div className="space-y-2.5">
          {stats!.map((p) => (
            <Card key={p.id} className="!p-3">
              <div className="flex items-start justify-between gap-2 mb-2">
                <Link to={`/projects/${p.id}`} className="min-w-0 flex-1">
                  <div className="font-semibold truncate">{p.name}</div>
                  <div className="text-[11px] text-slate-500 truncate flex items-center gap-1">
                    <span>{p.code}</span>
                    {p.company && (
                      <>
                        <span>·</span>
                        <Building2 className="h-3 w-3" />
                        <span className="truncate">{p.company}</span>
                      </>
                    )}
                  </div>
                </Link>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Badge tone={statusTone(p.health)}>{p.health}</Badge>
                  {isAdmin(user) && (
                    <button
                      onClick={() => { setEditing({ ...p }); setOpen(true); }}
                      className="grid h-8 w-8 place-items-center rounded-full bg-slate-100"
                      aria-label="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Nilai proyek + target */}
              <div className="grid grid-cols-2 gap-2 mb-2 text-xs">
                <div>
                  <div className="text-slate-500">Nilai Proyek</div>
                  <div className="font-semibold tabular-nums">Rp {formatIDR(p.project_value)}</div>
                </div>
                <div>
                  <div className="text-slate-500">Target Pengeluaran</div>
                  <div className="font-semibold tabular-nums">Rp {formatIDR(p.budget_amount)}</div>
                </div>
              </div>

              {/* Cashflow + balance + invoice open */}
              <div className="grid grid-cols-4 gap-2 text-[11px] border-t border-slate-100 pt-2">
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
                <div>
                  <div className="text-slate-500">Invoice Open</div>
                  <div className="font-semibold tabular-nums">
                    Rp {formatIDR(p.invoice_open)}
                  </div>
                </div>
              </div>

              {p.budget.amount > 0 && (
                <div className="mt-2">
                  <BudgetProgress pct={p.budget.usage_pct} status={p.budget.status} />
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Modal edit/create */}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing?.id ? "Edit Proyek" : "Proyek Baru"}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Batal</Button>
            <Button
              onClick={() => save.mutate(editing)}
              disabled={save.isPending || !editing?.code || !editing?.name || !editing?.company_id}
            >
              Simpan
            </Button>
          </>
        }
      >
        {!editing?.id && noCompanies && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 mb-3 text-xs text-amber-800">
            Belum ada perusahaan. Tambahkan dulu lewat menu <b>Lainnya → Perusahaan</b>,
            lalu kembali ke sini.
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Field label="Kode">
            <Input value={editing?.code || ""} onChange={(e) => setEditing({ ...editing, code: e.target.value })} />
          </Field>
          <Field label="Status">
            <Select value={editing?.status || "AKTIF"} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
              <option value="AKTIF">Aktif</option>
              <option value="DITAHAN">Ditahan</option>
              <option value="SELESAI">Selesai</option>
              <option value="DIBATALKAN">Dibatalkan</option>
            </Select>
          </Field>
        </div>

        <Field label="Nama Proyek">
          <Input value={editing?.name || ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
        </Field>

        <Field label="Lokasi">
          <Input value={editing?.location || ""} onChange={(e) => setEditing({ ...editing, location: e.target.value })} />
        </Field>

        <Field label="Perusahaan Penanggung Jawab">
          <Combobox
            value={editing?.company_id ?? null}
            onChange={(v) => setEditing({ ...editing, company_id: v == null ? null : Number(v) })}
            options={(companies?.items || []).map((c) => ({
              value: c.id, label: c.name, hint: c.npwp ?? undefined,
            }))}
            placeholder="Cari perusahaan..."
            clearable={false}
            disabled={noCompanies}
          />
        </Field>

        {users && (
          <Field
            label="Penanggung Jawab Utama (PIC)"
            hint="Untuk header dokumen / PDF. Tim admin lainnya bisa ditambahkan setelah simpan."
          >
            <Combobox
              value={editing?.pic_user_id ?? null}
              onChange={(v) => setEditing({ ...editing, pic_user_id: v == null ? null : Number(v) })}
              options={users.items.map((u) => ({
                value: u.id, label: u.name, hint: u.email,
              }))}
              placeholder="Pilih PIC (opsional)"
            />
          </Field>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Field label="Mulai">
            <Input type="date" value={editing?.start_date || ""} onChange={(e) => setEditing({ ...editing, start_date: e.target.value })} />
          </Field>
          <Field label="Selesai (estimasi)">
            <Input type="date" value={editing?.end_date || ""} onChange={(e) => setEditing({ ...editing, end_date: e.target.value })} />
          </Field>
        </div>

        <BudgetFields editing={editing} setEditing={setEditing} />

        <Field label="Catatan">
          <Textarea value={editing?.notes || ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
        </Field>

        {editing?.id && (
          <>
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <TeamManager projectId={editing.id} />
            </div>
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <ProjectAttachments projectId={editing.id} />
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

/**
 * Nilai Proyek + Target Pengeluaran.
 *
 * - Nilai proyek = nilai kontrak / SPK.
 * - Target = budget ceiling pengeluaran. Default 70% dari nilai proyek
 *   pada saat user ngetik nilai proyek (kalau belum ada budget atau
 *   user belum ngetik target manual).
 */
function BudgetFields({
  editing,
  setEditing,
}: {
  editing: any;
  setEditing: (v: any) => void;
}) {
  const [touched, setTouched] = useState(false);
  const auto70 = useMemo(() => {
    const pv = Number(editing?.project_value || 0);
    return Math.round(pv * 0.7);
  }, [editing?.project_value]);

  // saat user ubah project_value, auto-set budget kalau belum disentuh
  useEffect(() => {
    if (touched) return;
    if (!editing) return;
    const newBudget = auto70;
    if (Number(editing.budget_amount || 0) !== newBudget) {
      setEditing({ ...editing, budget_amount: newBudget });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto70]);

  return (
    <>
      <Field label="Nilai Proyek (kontrak / SPK)">
        <Input
          type="number"
          inputMode="decimal"
          value={editing?.project_value ?? 0}
          onChange={(e) => setEditing({ ...editing, project_value: e.target.value })}
        />
      </Field>
      <Field
        label="Target Pengeluaran (budget ceiling)"
        hint={
          touched
            ? "Manual."
            : `Otomatis 70% dari nilai proyek. Edit field ini untuk override.`
        }
      >
        <Input
          type="number"
          inputMode="decimal"
          value={editing?.budget_amount ?? 0}
          onChange={(e) => {
            setTouched(true);
            setEditing({ ...editing, budget_amount: e.target.value });
          }}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Mata Uang">
          <Input value={editing?.currency || "IDR"} onChange={(e) => setEditing({ ...editing, currency: e.target.value })} />
        </Field>
        <Field label="Toleransi Overbudget %">
          <Input
            type="number"
            inputMode="decimal"
            value={editing?.overbudget_tolerance_pct ?? 0}
            onChange={(e) => setEditing({ ...editing, overbudget_tolerance_pct: e.target.value })}
          />
        </Field>
      </div>
    </>
  );
}
