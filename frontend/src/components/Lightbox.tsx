import { useEffect } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  X,
} from "lucide-react";
import { fileUrl } from "@/lib/api";
import {
  isExternalLink,
  isImageAttachment,
  isPdfAttachment,
  useLightbox,
} from "@/store/lightbox";

export default function Lightbox() {
  const { open, items, index, close, next, prev } = useLightbox();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, close, next, prev]);

  if (!open || items.length === 0) return null;
  const cur = items[Math.min(index, items.length - 1)];
  if (!cur) return null;

  const url = fileUrl(cur.url);
  const isImage = isImageAttachment(cur);
  const isPdf = isPdfAttachment(cur);
  const isExt = isExternalLink(cur);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 grid place-items-center select-none"
      onClick={close}
    >
      {/* Top bar */}
      <div
        className="absolute top-0 inset-x-0 flex items-center justify-between gap-2 p-3 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-medium truncate flex-1">
          {cur.file_name}
          {items.length > 1 && (
            <span className="ml-2 text-white/60">
              {index + 1} / {items.length}
            </span>
          )}
        </div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="grid h-9 w-9 place-items-center rounded-full bg-white/10 hover:bg-white/20"
          title="Buka di tab baru"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
        {!isExt && (
          <a
            href={url}
            download={cur.file_name}
            className="grid h-9 w-9 place-items-center rounded-full bg-white/10 hover:bg-white/20"
            title="Download"
          >
            <Download className="h-4 w-4" />
          </a>
        )}
        <button
          type="button"
          onClick={close}
          aria-label="Tutup"
          className="grid h-9 w-9 place-items-center rounded-full bg-white/10 hover:bg-white/20"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Content */}
      <div
        className="max-w-[95vw] max-h-[85vh] flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {isImage && url && (
          <img
            src={url}
            alt={cur.file_name}
            className="max-w-[95vw] max-h-[85vh] object-contain"
          />
        )}
        {isPdf && url && (
          <iframe
            src={url}
            title={cur.file_name}
            className="w-[95vw] h-[85vh] bg-white rounded"
          />
        )}
        {isExt && (
          <div className="bg-white rounded-2xl p-6 max-w-md text-center">
            <ExternalLink className="h-10 w-10 text-sky-500 mx-auto mb-3" />
            <div className="font-semibold mb-1">Link Eksternal</div>
            <div className="text-sm text-slate-600 mb-1 break-all">
              {cur.file_name}
            </div>
            <div className="text-xs text-slate-500 mb-4 break-all">{cur.url}</div>
            <p className="text-xs text-slate-500 mb-3">
              Layanan eksternal seperti Google Drive tidak mengizinkan
              di-preview di dalam aplikasi. Klik tombol di bawah untuk buka di
              tab baru.
            </p>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white px-4 py-2 text-sm font-medium"
            >
              <ExternalLink className="h-4 w-4" /> Buka Link
            </a>
          </div>
        )}
        {!isImage && !isPdf && !isExt && (
          <div className="bg-white rounded-2xl p-6 max-w-md text-center">
            <FileText className="h-10 w-10 text-slate-400 mx-auto mb-3" />
            <div className="font-semibold mb-1">{cur.file_name}</div>
            <p className="text-xs text-slate-500 mb-3">
              Format ini tidak bisa dipreview. Klik tombol di bawah untuk
              membuka.
            </p>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 text-white px-4 py-2 text-sm font-medium"
            >
              <ExternalLink className="h-4 w-4" /> Buka File
            </a>
          </div>
        )}
      </div>

      {/* Nav */}
      {items.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              prev();
            }}
            disabled={index === 0}
            className="absolute left-3 top-1/2 -translate-y-1/2 grid h-12 w-12 place-items-center rounded-full bg-white/10 hover:bg-white/20 text-white disabled:opacity-30"
            aria-label="Sebelumnya"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              next();
            }}
            disabled={index >= items.length - 1}
            className="absolute right-3 top-1/2 -translate-y-1/2 grid h-12 w-12 place-items-center rounded-full bg-white/10 hover:bg-white/20 text-white disabled:opacity-30"
            aria-label="Berikutnya"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        </>
      )}
    </div>
  );
}
