import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fileUrl } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Input";
import Modal from "@/components/Modal";
import { Image as ImageIcon, Pencil, Plus, Upload } from "lucide-react";
import type { Company, Page } from "@/types";
import { useAuthStore, isSuper, isAdmin } from "@/store/auth";

export default function CompaniesPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [editing, setEditing] = useState<Company | null>(null);
  const [open, setOpen] = useState(false);
  const logoRef = useRef<HTMLInputElement>(null);
  const letterheadRef = useRef<HTMLInputElement>(null);

  const { data } = useQuery({
    queryKey: ["companies"],
    queryFn: async () => (await api.get<Page<Company>>("/companies?size=200")).data,
  });

  const save = useMutation({
    mutationFn: async (payload: Partial<Company>) => {
      if (editing?.id) {
        return (await api.patch<Company>(`/companies/${editing.id}`, payload)).data;
      }
      return (await api.post<Company>("/companies", payload)).data;
    },
    onSuccess: (saved: Company) => {
      qc.invalidateQueries({ queryKey: ["companies"] });
      // pastikan editing tetap konsisten supaya upload logo bisa langsung
      setEditing(saved);
    },
  });

  const uploadAsset = useMutation({
    mutationFn: async ({ kind, file }: { kind: "logo" | "letterhead"; file: File }) => {
      if (!editing?.id) throw new Error("Simpan perusahaan dulu sebelum upload logo.");
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post<Company>(`/companies/${editing.id}/upload/${kind}`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return data;
    },
    onSuccess: (updated) => {
      setEditing(updated);
      qc.invalidateQueries({ queryKey: ["companies"] });
    },
    onError: (e: any) =>
      alert(e?.response?.data?.detail || e.message || "Gagal upload"),
  });

  return (
    <div>
      <PageHeader
        back
        title="Perusahaan"
        right={
          isAdmin(user) && (
            <Button size="sm" onClick={() => { setEditing({} as Company); setOpen(true); }}>
              <Plus className="h-4 w-4" /> Baru
            </Button>
          )
        }
      />

      <div className="space-y-2.5">
        {data?.items.map((c) => (
          <Card key={c.id}>
            <div className="flex items-start gap-3">
              {c.logo_url ? (
                <img
                  src={fileUrl(c.logo_url)}
                  alt={c.name}
                  className="h-12 w-12 rounded-lg object-contain bg-white border border-slate-200"
                />
              ) : (
                <div className="h-12 w-12 rounded-lg bg-slate-100 grid place-items-center text-slate-400">
                  <ImageIcon className="h-5 w-5" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="font-semibold truncate">{c.name}</div>
                <div className="text-xs text-slate-500 truncate">{c.address || "-"}</div>
                {c.npwp && <div className="text-[11px] text-slate-500">NPWP: {c.npwp}</div>}
              </div>
              {isAdmin(user) && (
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
        onClose={() => { setOpen(false); setEditing(null); }}
        title={editing?.id ? "Edit Perusahaan" : "Perusahaan Baru"}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setOpen(false); setEditing(null); }}>Tutup</Button>
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
        <Field label="Rekening">
          <Input value={editing?.bank_account || ""} onChange={(e) => setEditing({ ...editing!, bank_account: e.target.value })} />
        </Field>

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs font-medium text-slate-600 mb-2">Logo & Kop Surat</div>
          {editing?.id ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[11px] text-slate-500 mb-1">Logo</div>
                {editing?.logo_url ? (
                  <img
                    src={fileUrl(editing.logo_url)}
                    alt="logo"
                    className="h-20 w-full rounded-lg border bg-white object-contain"
                  />
                ) : (
                  <div className="h-20 w-full rounded-lg border bg-white grid place-items-center text-slate-300">
                    <ImageIcon className="h-6 w-6" />
                  </div>
                )}
                <input
                  ref={logoRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadAsset.mutate({ kind: "logo", file: f });
                    e.target.value = "";
                  }}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-2 w-full"
                  onClick={() => logoRef.current?.click()}
                  disabled={uploadAsset.isPending}
                >
                  <Upload className="h-3.5 w-3.5" /> Ganti
                </Button>
              </div>
              <div>
                <div className="text-[11px] text-slate-500 mb-1">Kop Surat</div>
                {editing?.letterhead_url ? (
                  <img
                    src={fileUrl(editing.letterhead_url)}
                    alt="kop"
                    className="h-20 w-full rounded-lg border bg-white object-contain"
                  />
                ) : (
                  <div className="h-20 w-full rounded-lg border bg-white grid place-items-center text-slate-300">
                    <ImageIcon className="h-6 w-6" />
                  </div>
                )}
                <input
                  ref={letterheadRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadAsset.mutate({ kind: "letterhead", file: f });
                    e.target.value = "";
                  }}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-2 w-full"
                  onClick={() => letterheadRef.current?.click()}
                  disabled={uploadAsset.isPending}
                >
                  <Upload className="h-3.5 w-3.5" /> Ganti
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-[11px] text-slate-500 italic">
              Simpan perusahaan dulu, lalu kembali ke sini untuk upload logo & kop surat.
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
