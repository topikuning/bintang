import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import Modal from "@/components/Modal";
import { Badge } from "@/components/ui/Badge";
import { Plus, Pencil } from "lucide-react";
import { Link } from "react-router-dom";
import type { Company, Page, Project, User } from "@/types";
import { useAuthStore, isSuper } from "@/store/auth";
import { formatIDR } from "@/lib/utils";

export default function ProjectsPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [editing, setEditing] = useState<any>(null);
  const [open, setOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => (await api.get<Page<Project>>("/projects?size=200")).data,
  });
  const { data: companies } = useQuery({
    queryKey: ["companies"],
    queryFn: async () => (await api.get<Page<Company>>("/companies?size=500")).data,
  });
  const { data: users } = useQuery({
    enabled: isSuper(user),
    queryKey: ["users"],
    queryFn: async () => (await api.get<Page<User>>("/users?size=500")).data,
  });

  const save = useMutation({
    mutationFn: async (p: any) => {
      const payload = {
        ...p,
        budget_amount: String(p.budget_amount ?? "0"),
        overbudget_tolerance_pct: String(p.overbudget_tolerance_pct ?? "0"),
      };
      if (p.id) return (await api.patch(`/projects/${p.id}`, payload)).data;
      return (await api.post("/projects", payload)).data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["projects"] }); setOpen(false); setEditing(null); },
  });

  function newProject() {
    if (!companies || companies.items.length === 0) {
      alert("Tambah perusahaan dulu lewat menu Lainnya → Perusahaan.");
      return;
    }
    setEditing({
      code: "",
      name: "",
      company_id: companies.items[0].id,
      status: "AKTIF",
      currency: "IDR",
      budget_amount: 0,
      overbudget_tolerance_pct: 0,
    });
    setOpen(true);
  }

  return (
    <div>
      <PageHeader
        title="Proyek"
        right={
          isSuper(user) && (
            <Button size="sm" onClick={newProject}>
              <Plus className="h-4 w-4" /> Baru
            </Button>
          )
        }
      />
      <div className="space-y-2.5">
        {data?.items.map((p) => (
          <Card key={p.id}>
            <div className="flex items-start justify-between gap-2">
              <Link to={`/projects/${p.id}`} className="min-w-0 flex-1">
                <div className="font-semibold truncate">{p.name}</div>
                <div className="text-[11px] text-slate-500">{p.code}</div>
                <div className="mt-1 text-xs text-slate-600">
                  Budget: <span className="tabular-nums font-medium">Rp {formatIDR(p.budget_amount)}</span>
                </div>
              </Link>
              <div className="flex items-center gap-2 shrink-0">
                <Badge tone={p.status === "AKTIF" ? "good" : p.status === "DIBATALKAN" ? "bad" : "warn"}>
                  {p.status}
                </Badge>
                {isSuper(user) && (
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
          </Card>
        ))}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing?.id ? "Edit Proyek" : "Proyek Baru"}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Batal</Button>
            <Button onClick={() => save.mutate(editing)} disabled={save.isPending}>Simpan</Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-2">
          <Field label="Kode"><Input value={editing?.code || ""} onChange={(e) => setEditing({ ...editing, code: e.target.value })} /></Field>
          <Field label="Status">
            <Select value={editing?.status || "AKTIF"} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
              <option value="AKTIF">Aktif</option>
              <option value="DITAHAN">Ditahan</option>
              <option value="SELESAI">Selesai</option>
              <option value="DIBATALKAN">Dibatalkan</option>
            </Select>
          </Field>
        </div>
        <Field label="Nama"><Input value={editing?.name || ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
        <Field label="Lokasi"><Input value={editing?.location || ""} onChange={(e) => setEditing({ ...editing, location: e.target.value })} /></Field>
        <Field label="Perusahaan Penanggung Jawab">
          <Select value={editing?.company_id ?? ""} onChange={(e) => setEditing({ ...editing, company_id: Number(e.target.value) })}>
            {companies?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        {users && (
          <Field label="Admin Proyek (PIC)">
            <Select
              value={editing?.pic_user_id ?? ""}
              onChange={(e) => setEditing({ ...editing, pic_user_id: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">- pilih -</option>
              {users.items.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Field label="Mulai"><Input type="date" value={editing?.start_date || ""} onChange={(e) => setEditing({ ...editing, start_date: e.target.value })} /></Field>
          <Field label="Selesai (estimasi)"><Input type="date" value={editing?.end_date || ""} onChange={(e) => setEditing({ ...editing, end_date: e.target.value })} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Mata Uang"><Input value={editing?.currency || "IDR"} onChange={(e) => setEditing({ ...editing, currency: e.target.value })} /></Field>
          <Field label="Toleransi Overbudget %">
            <Input type="number" inputMode="decimal" value={editing?.overbudget_tolerance_pct ?? 0} onChange={(e) => setEditing({ ...editing, overbudget_tolerance_pct: e.target.value })} />
          </Field>
        </div>
        <Field label="Target Pengeluaran Maksimal">
          <Input type="number" inputMode="decimal" value={editing?.budget_amount ?? 0} onChange={(e) => setEditing({ ...editing, budget_amount: e.target.value })} />
        </Field>
        <Field label="Catatan"><Textarea value={editing?.notes || ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></Field>
      </Modal>
    </div>
  );
}
