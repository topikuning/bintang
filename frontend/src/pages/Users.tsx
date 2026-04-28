import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Input";
import Modal from "@/components/Modal";
import { Badge } from "@/components/ui/Badge";
import { Plus } from "lucide-react";
import type { Page, User } from "@/types";

export default function UsersPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<any>(null);
  const [open, setOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ["users"],
    queryFn: async () => (await api.get<Page<User>>("/users?size=200")).data,
  });

  const save = useMutation({
    mutationFn: async (p: any) => {
      if (p.id) {
        const { id, ...rest } = p;
        if (!rest.password) delete rest.password;
        return (await api.patch(`/users/${id}`, rest)).data;
      }
      return (await api.post("/users", p)).data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["users"] }); setOpen(false); setEditing(null); },
  });

  return (
    <div>
      <PageHeader back title="Pengguna"
        right={<Button size="sm" onClick={() => { setEditing({ role: "PROJECT_ADMIN" }); setOpen(true); }}>
          <Plus className="h-4 w-4" /> Baru
        </Button>}
      />
      <div className="space-y-2">
        {data?.items.map((u) => (
          <Card key={u.id} className="!p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium">{u.name}</div>
                <div className="text-[11px] text-slate-500">{u.email}</div>
              </div>
              <Badge tone={u.role === "SUPERADMIN" ? "info" : "neutral"}>{u.role}</Badge>
              <button
                onClick={() => { setEditing({ ...u, password: "" }); setOpen(true); }}
                className="text-xs text-slate-600 underline"
              >
                Edit
              </button>
            </div>
          </Card>
        ))}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing?.id ? "Edit Pengguna" : "Pengguna Baru"}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Batal</Button>
            <Button onClick={() => save.mutate(editing)} disabled={save.isPending}>Simpan</Button>
          </>
        }
      >
        <Field label="Nama"><Input value={editing?.name || ""} onChange={(e) => setEditing({ ...editing!, name: e.target.value })} /></Field>
        <Field label="Email"><Input type="email" value={editing?.email || ""} disabled={!!editing?.id} onChange={(e) => setEditing({ ...editing!, email: e.target.value })} /></Field>
        <Field label="Role">
          <Select value={editing?.role || "PROJECT_ADMIN"} onChange={(e) => setEditing({ ...editing!, role: e.target.value })}>
            <option value="PROJECT_ADMIN">Project Admin (admin proyek)</option>
            <option value="CENTRAL_ADMIN">Admin Pusat (manage semua proyek)</option>
            <option value="SUPERADMIN">Superadmin (god-mode)</option>
          </Select>
        </Field>
        <Field label={editing?.id ? "Password (kosong = tidak ganti)" : "Password"}>
          <Input type="password" value={editing?.password || ""} onChange={(e) => setEditing({ ...editing!, password: e.target.value })} />
        </Field>
      </Modal>
    </div>
  );
}
