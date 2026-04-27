import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Input";
import Modal from "@/components/Modal";
import { Plus, Pencil } from "lucide-react";
import type { Company, Page } from "@/types";
import { useAuthStore, isSuper } from "@/store/auth";

export default function CompaniesPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [editing, setEditing] = useState<Company | null>(null);
  const [open, setOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ["companies"],
    queryFn: async () => (await api.get<Page<Company>>("/companies?size=200")).data,
  });

  const save = useMutation({
    mutationFn: async (payload: Partial<Company>) => {
      if (editing?.id) {
        return (await api.patch(`/companies/${editing.id}`, payload)).data;
      }
      return (await api.post("/companies", payload)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["companies"] });
      setOpen(false);
      setEditing(null);
    },
  });

  return (
    <div>
      <PageHeader
        back
        title="Perusahaan"
        right={
          isSuper(user) && (
            <Button size="sm" onClick={() => { setEditing({} as Company); setOpen(true); }}>
              <Plus className="h-4 w-4" /> Baru
            </Button>
          )
        }
      />

      <div className="space-y-2.5">
        {data?.items.map((c) => (
          <Card key={c.id}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold truncate">{c.name}</div>
                <div className="text-xs text-slate-500 truncate">{c.address || "-"}</div>
                {c.npwp && <div className="text-[11px] text-slate-500">NPWP: {c.npwp}</div>}
              </div>
              {isSuper(user) && (
                <button
                  onClick={() => { setEditing(c); setOpen(true); }}
                  className="grid h-8 w-8 place-items-center rounded-full bg-slate-100"
                  aria-label="Edit"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </Card>
        ))}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing?.id ? "Edit Perusahaan" : "Perusahaan Baru"}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Batal</Button>
            <Button onClick={() => save.mutate(editing!)} disabled={save.isPending}>Simpan</Button>
          </>
        }
      >
        <Field label="Nama">
          <Input value={editing?.name || ""} onChange={(e) => setEditing({ ...editing!, name: e.target.value })} />
        </Field>
        <Field label="Alamat">
          <Textarea value={editing?.address || ""} onChange={(e) => setEditing({ ...editing!, address: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="NPWP">
            <Input value={editing?.npwp || ""} onChange={(e) => setEditing({ ...editing!, npwp: e.target.value })} />
          </Field>
          <Field label="Telepon">
            <Input value={editing?.phone || ""} onChange={(e) => setEditing({ ...editing!, phone: e.target.value })} />
          </Field>
        </div>
        <Field label="Email">
          <Input type="email" value={editing?.email || ""} onChange={(e) => setEditing({ ...editing!, email: e.target.value })} />
        </Field>
        <Field label="Direktur">
          <Input value={editing?.director_name || ""} onChange={(e) => setEditing({ ...editing!, director_name: e.target.value })} />
        </Field>
        <Field label="Logo URL (opsional)">
          <Input value={editing?.logo_url || ""} onChange={(e) => setEditing({ ...editing!, logo_url: e.target.value })} />
        </Field>
        <Field label="Rekening">
          <Input value={editing?.bank_account || ""} onChange={(e) => setEditing({ ...editing!, bank_account: e.target.value })} />
        </Field>
      </Modal>
    </div>
  );
}
