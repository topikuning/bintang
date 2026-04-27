import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Input";
import Modal from "@/components/Modal";
import { Badge } from "@/components/ui/Badge";
import { Plus, Pencil } from "lucide-react";
import type { Category, Page } from "@/types";
import { useAuthStore, isSuper } from "@/store/auth";

export default function CategoriesPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [editing, setEditing] = useState<Partial<Category> | null>(null);
  const [open, setOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => (await api.get<Page<Category>>("/categories?size=500")).data,
  });

  const save = useMutation({
    mutationFn: async (p: Partial<Category>) => {
      if (p.id) return (await api.patch(`/categories/${p.id}`, p)).data;
      return (await api.post("/categories", p)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories"] });
      setOpen(false);
      setEditing(null);
    },
  });

  return (
    <div>
      <PageHeader
        back
        title="Kategori"
        right={
          isSuper(user) && (
            <Button size="sm" onClick={() => { setEditing({ type: "OUT" }); setOpen(true); }}>
              <Plus className="h-4 w-4" /> Baru
            </Button>
          )
        }
      />
      <div className="space-y-2">
        {data?.items.map((c) => (
          <Card key={c.id} className="!p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium">{c.name}</div>
                <div className="text-[11px] text-slate-500 truncate">{c.description || "-"}</div>
              </div>
              <Badge tone={c.type === "IN" ? "good" : "bad"}>{c.type}</Badge>
              {isSuper(user) && (
                <button
                  onClick={() => { setEditing(c); setOpen(true); }}
                  className="grid h-8 w-8 place-items-center rounded-full bg-slate-100"
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
        title={editing?.id ? "Edit Kategori" : "Kategori Baru"}
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
        <Field label="Tipe">
          <Select value={editing?.type || "OUT"} onChange={(e) => setEditing({ ...editing!, type: e.target.value as any })}>
            <option value="IN">IN (Pemasukan)</option>
            <option value="OUT">OUT (Pengeluaran)</option>
          </Select>
        </Field>
        <Field label="Deskripsi">
          <Input value={editing?.description || ""} onChange={(e) => setEditing({ ...editing!, description: e.target.value })} />
        </Field>
      </Modal>
    </div>
  );
}
