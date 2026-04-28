import { ExternalLink, FileText, Paperclip } from "lucide-react";
import { fileUrl } from "@/lib/api";
import { isExternalLink, useLightbox } from "@/store/lightbox";
import type { Attachment } from "@/types";

/**
 * Strip thumbnail/icon attachment yang clickable.
 * Image dan PDF dibuka di lightbox overlay; link eksternal (Google Drive
 * dll) buka tab baru karena layanan tsb. tidak bisa di-iframe.
 */
export default function AttachmentStrip({
  attachments,
  max = 4,
}: {
  attachments: Attachment[] | undefined;
  max?: number;
}) {
  const showLightbox = useLightbox((s) => s.show);
  if (!attachments || attachments.length === 0) return null;
  const shown = attachments.slice(0, max);
  const extra = attachments.length - shown.length;

  return (
    <div className="mt-1.5 flex items-center gap-1 flex-wrap">
      <Paperclip className="h-3 w-3 text-slate-400 shrink-0" />
      {shown.map((a, i) => {
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
              if (isLink) {
                const u = fileUrl(a.url);
                if (u) window.open(u, "_blank", "noopener");
              } else {
                showLightbox(attachments, i);
              }
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
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            // open lightbox starting from first non-shown if any non-link,
            // otherwise just from index 0
            const firstNonLink = attachments.findIndex((x) => !isExternalLink(x));
            showLightbox(attachments, firstNonLink >= 0 ? firstNonLink : 0);
          }}
          className="text-[11px] text-slate-500 hover:text-slate-900 ml-0.5"
        >
          +{extra}
        </button>
      )}
    </div>
  );
}
