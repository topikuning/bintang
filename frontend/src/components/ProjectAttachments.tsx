import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fileUrl } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FileText, Image as ImageIcon, Loader2, Paperclip, Trash2, Upload } from "lucide-react";
import { canWrite, useAuthStore } from "@/store/auth";
import { formatDate } from "@/lib/utils";

interface ProjectAttachment {
  id: number;
  label: string | null;
  file_name: string;
  file_size: number;
  mime_type: string;
  url: string;
  uploaded_by_id: number;
  created_at: string;
}

const PRESET_LABELS = ["Kontrak", "Surat Penunjukan", "Surat Perintah Kerja", "BAST", "Berita Acara"];

export default function ProjectAttachments({
  projectId,
  readOnly = false,
}: {
  projectId: number;
  readOnly?: boolean;
}) {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const fileRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState<string>(PRESET_LABELS[0]);
  const [error, setError] = useState<string | null>(null);

  const editable = !readOnly && canWrite(user);

  const listQ = useQuery({
    queryKey: ["project-attachments", projectId],
    queryFn: async () =>
      (await api.get<ProjectAttachment[]>(`/projects/${projectId}/attachments`)).data,
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const params = new URLSearchParams();
      if (label.trim()) params.set("label", label.trim());
      const { data } = await api.post<ProjectAttachment>(
        `/projects/${projectId}/attachments?${params}`,
        fd,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-attachments", projectId] });
      setError(null);
    },
    onError: (e: any) => setError(e?.response?.data?.detail || "Gagal upload"),
  });

  const del = useMutation({
    mutationFn: async (aid: number) =>
      api.delete(`/projects/${projectId}/attachments/${aid}`),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["project-attachments", projectId] }),
  });

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) upload.mutate(f);
    e.target.value = "";
  }

  const items = listQ.data || [];

  return (
    <div>
      <div className="text-xs font-medium text-slate-600 mb-2 flex items-center gap-2">
        <Paperclip className="h-3.5 w-3.5" />
        Dokumen Proyek ({items.length})
      </div>

      {items.length === 0 ? (
        <div className="text-xs text-slate-500 italic mb-2">
          Belum ada dokumen. {editable && "Upload kontrak, surat penunjukan, BAST, dll di bawah."}
        </div>
      ) : (
        <ul className="space-y-1.5 mb-3">
          {items.map((a) => {
            const isImage = a.mime_type.startsWith("image/");
            return (
              <li
                key={a.id}
                className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5"
              >
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-slate-100 text-slate-500 shrink-0">
                  {isImage ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  {a.label && (
                    <div className="text-[10px] uppercase tracking-wide font-medium text-slate-500">
                      {a.label}
                    </div>
                  )}
                  <a
                    href={fileUrl(a.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-slate-900 hover:underline truncate block"
                    title={a.file_name}
                  >
                    {a.file_name}
                  </a>
                  <div className="text-[10px] text-slate-500">
                    {(a.file_size / 1024).toFixed(1)} KB · {formatDate(a.created_at)}
                  </div>
                </div>
                {editable && (
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Hapus ${a.file_name}?`)) del.mutate(a.id);
                    }}
                    className="grid h-7 w-7 place-items-center rounded-full bg-rose-100 text-rose-600 hover:bg-rose-200 shrink-0"
                    aria-label="Hapus"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {editable && (
        <div className="rounded-lg border border-slate-200 bg-white p-2.5 space-y-2">
          <div>
            <div className="text-[11px] text-slate-500 mb-1">Jenis dokumen (opsional)</div>
            <Input
              list="proj-att-labels"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="cth: Kontrak, BAST, ..."
            />
            <datalist id="proj-att-labels">
              {PRESET_LABELS.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/*"
            className="hidden"
            onChange={pickFile}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-full"
            disabled={upload.isPending}
            onClick={() => fileRef.current?.click()}
          >
            {upload.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {upload.isPending ? "Mengunggah..." : "Tambah Dokumen"}
          </Button>
          {error && <div className="text-xs text-rose-600">{error}</div>}
          <div className="text-[11px] text-slate-500">
            Format: PDF atau gambar. Tidak ada batas jumlah file.
          </div>
        </div>
      )}
    </div>
  );
}
