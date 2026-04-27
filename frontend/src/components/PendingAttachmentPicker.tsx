import { useEffect, useRef, useState } from "react";
import { Camera, FileText, Image as ImageIcon, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";

export default function PendingAttachmentPicker({
  files,
  onChange,
}: {
  files: File[];
  onChange: (f: File[]) => void;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<string[]>([]);

  useEffect(() => {
    const urls = files.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : ""));
    setPreviews(urls);
    return () => {
      urls.forEach((u) => u && URL.revokeObjectURL(u));
    };
  }, [files]);

  function add(list: FileList | null) {
    if (!list || list.length === 0) return;
    onChange([...files, ...Array.from(list)]);
    if (cameraRef.current) cameraRef.current.value = "";
    if (galleryRef.current) galleryRef.current.value = "";
    if (fileRef.current) fileRef.current.value = "";
  }

  function remove(i: number) {
    onChange(files.filter((_, j) => j !== i));
  }

  return (
    <div>
      <div className="text-xs font-medium text-slate-600 mb-2">
        Lampiran (akan di-upload setelah disimpan)
      </div>

      {files.length > 0 && (
        <div className="grid grid-cols-3 gap-2 mb-2">
          {files.map((f, i) => (
            <div
              key={i}
              className="relative rounded-lg overflow-hidden border border-slate-200 bg-slate-50"
            >
              {f.type.startsWith("image/") ? (
                <img src={previews[i]} alt={f.name} className="h-24 w-full object-cover" />
              ) : (
                <div className="grid h-24 place-items-center text-slate-500">
                  <FileText className="h-7 w-7" />
                </div>
              )}
              <button
                type="button"
                onClick={() => remove(i)}
                className="absolute top-1 right-1 grid h-7 w-7 place-items-center rounded-full bg-white/90 text-rose-600 shadow"
                aria-label="Hapus"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <div className="px-1.5 py-1 text-[10px] text-slate-600 truncate">{f.name}</div>
            </div>
          ))}
        </div>
      )}

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
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => add(e.target.files)}
        />
        <input
          ref={galleryRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => add(e.target.files)}
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => add(e.target.files)}
        />
      </div>
    </div>
  );
}
