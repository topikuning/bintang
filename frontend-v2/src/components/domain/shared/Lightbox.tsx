import { useEffect } from "react"
import { ChevronLeft, ChevronRight, X } from "lucide-react"
import { useLightbox } from "@/store/lightbox"
import { cn } from "@/lib/utils"

/**
 * Lightbox global -- listener tunggal di-mount sekali di App.
 * Render image fullscreen + navigation prev/next + close (Esc).
 *
 * Trigger:
 *   useLightbox.getState().show([{src:"https://..."}], 0)
 */
export function Lightbox() {
  const { open, images, index, close, next, prev } = useLightbox()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close()
      else if (e.key === "ArrowRight") next()
      else if (e.key === "ArrowLeft") prev()
    }
    document.addEventListener("keydown", onKey)
    // Lock body scroll saat lightbox aktif
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, close, next, prev])

  if (!open || images.length === 0) return null
  const cur = images[index]
  if (!cur) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90"
      onClick={close}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          close()
        }}
        className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
        aria-label="Tutup"
      >
        <X className="h-5 w-5" />
      </button>

      {images.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              prev()
            }}
            className="absolute left-3 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            aria-label="Sebelumnya"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              next()
            }}
            className="absolute right-3 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            aria-label="Berikutnya"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-[12px] text-white">
            {index + 1} / {images.length}
          </div>
        </>
      )}

      <img
        src={cur.src}
        alt={cur.alt ?? ""}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "max-h-[90vh] max-w-[92vw] select-none object-contain",
          "drop-shadow-2xl",
        )}
        draggable={false}
      />
    </div>
  )
}
