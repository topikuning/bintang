import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import Combobox from "@/components/ui/Combobox";
import { Badge } from "@/components/ui/Badge";
import { useState } from "react";
import { Trash2, UserPlus } from "lucide-react";
import type { Page, User } from "@/types";

interface AssignedUser {
  id: number;
  email: string;
  name: string;
  role: string;
}

export default function TeamManager({ projectId }: { projectId: number }) {
  const qc = useQueryClient();
  const [picked, setPicked] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const teamQ = useQuery({
    queryKey: ["project-team", projectId],
    queryFn: async () =>
      (await api.get<AssignedUser[]>(`/projects/${projectId}/users`)).data,
  });

  const usersQ = useQuery({
    queryKey: ["users"],
    queryFn: async () => (await api.get<Page<User>>("/users?size=200")).data,
  });

  const assigned = teamQ.data || [];
  const assignedIds = new Set(assigned.map((a) => a.id));
  const candidates = (usersQ.data?.items || []).filter(
    (u) => u.is_active && !assignedIds.has(u.id),
  );

  const addM = useMutation({
    mutationFn: async (userId: number) =>
      api.post(`/users/${userId}/projects/${projectId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-team", projectId] });
      setPicked(null);
      setError(null);
    },
    onError: (e: any) =>
      setError(e?.response?.data?.detail || "Gagal menambah anggota"),
  });

  const removeM = useMutation({
    mutationFn: async (userId: number) =>
      api.delete(`/users/${userId}/projects/${projectId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project-team", projectId] }),
    onError: (e: any) =>
      setError(e?.response?.data?.detail || "Gagal menghapus anggota"),
  });

  return (
    <div>
      <div className="text-xs font-medium text-slate-600 mb-2">
        Tim Admin Proyek ({assigned.length})
      </div>

      {assigned.length === 0 ? (
        <div className="text-xs text-slate-500 italic mb-2">
          Belum ada admin. Tambahkan di bawah.
        </div>
      ) : (
        <ul className="space-y-1.5 mb-3">
          {assigned.map((u) => (
            <li
              key={u.id}
              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5"
            >
              <div className="grid h-7 w-7 place-items-center rounded-full bg-slate-200 text-xs font-bold text-slate-700">
                {u.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{u.name}</div>
                <div className="text-[11px] text-slate-500 truncate">{u.email}</div>
              </div>
              <Badge tone={u.role === "SUPERADMIN" ? "info" : "neutral"}>{u.role}</Badge>
              {u.role !== "SUPERADMIN" && (
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Keluarkan ${u.name} dari proyek?`)) removeM.mutate(u.id);
                  }}
                  className="grid h-7 w-7 place-items-center rounded-full bg-rose-100 text-rose-600 hover:bg-rose-200"
                  aria-label="Keluarkan"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-2">
        <div className="flex-1 min-w-0">
          <Combobox
            value={picked}
            onChange={(v) => setPicked(v == null ? null : Number(v))}
            options={candidates.map((u) => ({
              value: u.id,
              label: u.name,
              hint: `${u.email} · ${u.role}`,
            }))}
            placeholder={
              candidates.length === 0
                ? "Semua pengguna sudah ditambahkan"
                : "Cari pengguna..."
            }
            disabled={candidates.length === 0}
          />
        </div>
        <Button
          type="button"
          size="sm"
          disabled={!picked || addM.isPending}
          onClick={() => picked && addM.mutate(picked)}
        >
          <UserPlus className="h-4 w-4" /> Tambah
        </Button>
      </div>
      {error && <div className="mt-2 text-xs text-rose-600">{error}</div>}
      <div className="mt-2 text-[11px] text-slate-500">
        Superadmin otomatis punya akses ke semua proyek dan tidak perlu ditambahkan.
      </div>
    </div>
  );
}
