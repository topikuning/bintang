import { useRef, useState } from "react";
import { api, fileUrl } from "@/lib/api";
import {
  Camera,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Link2,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { Attachment } from "@/types";

const EXTERNAL_MIME = "external/link";

function isExternalLink(a: Attachment) {
  return a.mime_type === EXTERNAL_MIME || /^https?:\/\//.test(a.url);
}

export default function AttachmentUploader({
  attachments,
  onChange,
  uploadUrl,
  deleteUrl,
  linkUrl,
  disabled,
}: {
  attachments: Attachment[];
  onChange: (att: Attachment[]) => void;
  uploadUrl: string;
  deleteUrl: (id: number) => string;
  linkUrl?: string;
  disabled?: boolean;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const newOnes: Attachment[] = [];
      for (const f of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", f);
        const { data } = await api.post(uploadUrl, fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        newOnes.push(data);
      }
      onChange([...attachments, ...newOnes]);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Upload gagal");
    } finally {
      setBusy(false);
      if (cameraRef.current) cameraRef.current.value = "";
      if (galleryRef.current) galleryRef.current.value = "";
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function addLink() {
    if (!linkUrl) return;
    const url = window.prompt(
      "Masukkan URL link (mis. Google Drive yang sudah di-share):",
    );
    if (!url || !url.trim()) return;
    const label =
      window.prompt("Nama / label dokumen (opsional):", "Bukti via link") || "";
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post(linkUrl, {
        url: url.trim(),
        label: label.trim() || null,
      });
      onChange([...attachments, data]);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Gagal menambahkan link");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (!confirm("Hapus lampiran ini?")) return;
    try {
      await api.delete(deleteUrl(id));
      onChange(attachments.filter((a) => a.id !== id));
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Gagal menghapus");
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-medium text-slate-600">Lampiran</div>
        {busy && <div className="text-[11px] text-slate-500">Memproses...</div>}
      </div>
      {error && <div className="mb-2 text-xs text-rose-600">{error}</div>}

      <div className="grid grid-cols-3 gap-2 mb-2">
        {attachments.map((a) => {
          const isLink = isExternalLink(a);
          const isImg = a.mime_type.startsWith("image/") && !isLink;
          return (
            <div
              key={a.id}
              className="relative rounded-lg overflow-hidden border border-slate-200 bg-slate-50"
            >
              {isImg ? (
                <a href={fileUrl(a.url)} target="_blank" rel="noopener noreferrer">
                  <img
                    src={fileUrl(a.url)}
                    alt={a.file_name}
                    className="h-24 w-full object-cover"
                    loading="lazy"
                  />
                </a>
              ) : isLink ? (
                <a
                  href={fileUrl(a.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="grid h-24 place-items-center text-sky-600 bg-sky-50"
                >
                  <ExternalLink className="h-7 w-7" />
                </a>
              ) : (
                <a
                  href={fileUrl(a.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="grid h-24 place-items-center text-slate-500"
                >
                  <FileText className="h-7 w-7" />
                </a>
              )}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => remove(a.id)}
                  className="absolute top-1 right-1 grid h-7 w-7 place-items-center rounded-full bg-white/90 text-rose-600 shadow"
                  aria-label="Hapus"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
              <div className="px-1.5 py-1 text-[10px] text-slate-600 truncate flex items-center gap-1">
                {isLink && <Link2 className="h-3 w-3 text-sky-500 shrink-0" />}
                <span className="truncate">{a.file_name}</span>
              </div>
            </div>
          );
        })}
      </div>

      {!disabled && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => cameraRef.current?.click()}>
            <Camera className="h-4 w-4" /> Kamera
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => galleryRef.current?.click()}>
            <ImageIcon className="h-4 w-4" /> Galeri
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4" /> File / PDF
          </Button>
          {linkUrl && (
            <Button type="button" variant="secondary" size="sm" onClick={addLink}>
              <Link2 className="h-4 w-4" /> Link
            </Button>
          )}
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => upload(e.target.files)}
          />
          <input
            ref={galleryRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => upload(e.target.files)}
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            className="hidden"
            onChange={(e) => upload(e.target.files)}
          />
        </div>
      )}
    </div>
  );
}
