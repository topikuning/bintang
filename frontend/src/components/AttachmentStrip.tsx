import { ExternalLink, FileText, Paperclip } from "lucide-react";
import { fileUrl } from "@/lib/api";
import type { Attachment } from "@/types";

const EXTERNAL_MIME = "external/link";

function isExternalLink(a: Attachment) {
  return a.mime_type === EXTERNAL_MIME || /^https?:\/\//.test(a.url);
}

/**
 * Strip thumbnail/icon attachment yang clickable (buka di tab baru).
 * Dipakai di list transaksi/invoice supaya bisa cek bukti tanpa masuk detail.
 */
export default function AttachmentStrip({
  attachments,
  max = 4,
}: {
  attachments: Attachment[] | undefined;
  max?: number;
}) {
  if (!attachments || attachments.length === 0) return null;
  const shown = attachments.slice(0, max);
  const extra = attachments.length - shown.length;

  return (
    <div className="mt-1.5 flex items-center gap-1 flex-wrap">
      <Paperclip className="h-3 w-3 text-slate-400 shrink-0" />
      {shown.map((a) => {
        const isLink = isExternalLink(a);
        const isImage = a.mime_type.startsWith("image/") && !isLink;
        return (
          <button
            key={a.id}
            type="button"
            title={a.file_name}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const u = fileUrl(a.url);
              if (u) window.open(u, "_blank", "noopener");
            }}
            className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 overflow-hidden bg-white hover:ring-2 hover:ring-slate-300 active:scale-95 transition shrink-0"
          >
            {isImage ? (
              <img
                src={fileUrl(a.url)}
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : isLink ? (
              <ExternalLink className="h-4 w-4 text-sky-600" />
            ) : (
              <FileText className="h-4 w-4 text-slate-500" />
            )}
          </button>
        );
      })}
      {extra > 0 && (
        <span className="text-[11px] text-slate-500 ml-0.5">+{extra}</span>
      )}
    </div>
  );
}
