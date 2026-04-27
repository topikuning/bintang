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
import type { Page, VendorClient } from "@/types";
import { useAuthStore, isSuper } from "@/store/auth";

export default function VendorsPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [editing, setEditing] = useState<Partial<VendorClient> | null>(null);
  const [open, setOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ["vendors-clients"],
    queryFn: async () => (await api.get<Page<VendorClient>>("/vendors-clients?size=500")).data,
  });

  const save = useMutation({
    mutationFn: async (p: Partial<VendorClient>) => {
      if (p.id) return (await api.patch(`/vendors-clients/${p.id}`, p)).data;
      return (await api.post("/vendors-clients", p)).data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vendors-clients"] }); setOpen(false); setEditing(null); },
  });

  return (
    <div>
      <PageHeader
        back
        title="Vendor & Client"
        right={
          isSuper(user) && (
            <Button size="sm" onClick={() => { setEditing({ type: "VENDOR" }); setOpen(true); }}>
              <Plus className="h-4 w-4" /> Baru
            </Button>
          )
        }
      />
      <div className="space-y-2">
        {data?.items.map((v) => (
          <Card key={v.id} className="!p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium truncate">{v.name}</div>
                <div className="text-[11px] text-slate-500 truncate">{v.contact || v.phone || v.email || "-"}</div>
              </div>
              <Badge tone={v.type === "VENDOR" ? "info" : v.type === "CLIENT" ? "good" : "neutral"}>{v.type}</Badge>
              {isSuper(user) && (
                <button onClick={() => { setEditing(v); setOpen(true); }} className="grid h-8 w-8 place-items-center rounded-full bg-slate-100">
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
        title={editing?.id ? "Edit Vendor/Client" : "Vendor/Client Baru"}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Batal</Button>
            <Button onClick={() => save.mutate(editing!)} disabled={save.isPending}>Simpan</Button>
          </>
        }
      >
        <Field label="Nama"><Input value={editing?.name || ""} onChange={(e) => setEditing({ ...editing!, name: e.target.value })} /></Field>
        <Field label="Tipe">
          <Select value={editing?.type || "VENDOR"} onChange={(e) => setEditing({ ...editing!, type: e.target.value as any })}>
            <option value="VENDOR">Vendor</option>
            <option value="CLIENT">Client</option>
            <option value="BOTH">Vendor & Client</option>
          </Select>
        </Field>
        <Field label="Kontak"><Input value={editing?.contact || ""} onChange={(e) => setEditing({ ...editing!, contact: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Telepon"><Input value={editing?.phone || ""} onChange={(e) => setEditing({ ...editing!, phone: e.target.value })} /></Field>
          <Field label="Email"><Input value={editing?.email || ""} onChange={(e) => setEditing({ ...editing!, email: e.target.value })} /></Field>
        </div>
        <Field label="NPWP"><Input value={editing?.npwp || ""} onChange={(e) => setEditing({ ...editing!, npwp: e.target.value })} /></Field>
        <Field label="Rekening"><Input value={editing?.bank_account || ""} onChange={(e) => setEditing({ ...editing!, bank_account: e.target.value })} /></Field>
      </Modal>
    </div>
  );
}
