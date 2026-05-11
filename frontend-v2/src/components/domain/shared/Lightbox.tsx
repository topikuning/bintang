import { useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react"
import { DismissableLayer } from "@radix-ui/react-dismissable-layer"
import { useLightbox } from "@/store/lightbox"
import { cn } from "@/lib/utils"

/**
 * Lightbox global -- listener tunggal di-mount sekali di App.
 * Render image fullscreen + navigation prev/next + close (Esc/swipe-down).
 *
 * Pakai Radix DismissableLayer supaya saat Lightbox terbuka di-atas Sheet
 * (mis. detail invoice/transaksi), Esc & pointer-down-outside SHEET tidak
 * fire -- karena Radix mengelola layer stack: hanya layer tertinggi yg
 * merespon Esc, dan layer dgn disableOutsidePointerEvents membuat layer
 * di bawahnya tdk dapat fire outside-detector mereka.
 *
 * UX patterns:
 *  1. Tap image -> toggle controls
 *  2. Top bar gradient hitam-transparan dgn title + actions
 *  3. Swipe down to close (drag image vertikal, threshold 100px)
 *  4. Tap di area gelap -> close
 *  5. Counter '1 / N' di top-center
 *  6. Keyboard: Esc/ArrowLeft/ArrowRight
 */
export function Lightbox() {
  const { open, images, index, close, next, prev } = useLightbox()
  const [controlsVisible, setControlsVisible] = useState(true)
  const [dragY, setDragY] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef<{ y: number; t: number } | null>(null)

  // Reset state setiap kali index berubah / lightbox dibuka
  useEffect(() => {
    setControlsVisible(true)
    setDragY(0)
  }, [open, index])

  // Body overflow lock + Arrow keys (DismissableLayer hanya handle Esc).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        e.stopPropagation()
        next()
      } else if (e.key === "ArrowLeft") {
        e.stopPropagation()
        prev()
      }
    }
    document.addEventListener("keydown", onKey, { capture: true })
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey, { capture: true })
      document.body.style.overflow = prevOverflow
    }
  }, [open, next, prev])

  if (!open || images.length === 0) return null
  const cur = images[index]
  if (!cur) return null

  const onImagePointerDown = (e: React.PointerEvent<HTMLImageElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragStart.current = { y: e.clientY, t: Date.now() }
    setIsDragging(true)
  }

  const onImagePointerMove = (e: React.PointerEvent<HTMLImageElement>) => {
    if (!isDragging || !dragStart.current) return
    const dy = e.clientY - dragStart.current.y
    setDragY(dy)
  }

  const onImagePointerUp = (e: React.PointerEvent<HTMLImageElement>) => {
    if (!dragStart.current) {
      setIsDragging(false)
      return
    }
    e.currentTarget.releasePointerCapture(e.pointerId)
    const dy = e.clientY - dragStart.current.y
    const dt = Date.now() - dragStart.current.t
    const velocity = Math.abs(dy) / Math.max(1, dt)
    dragStart.current = null
    setIsDragging(false)

    if (Math.abs(dy) > 100 || velocity > 0.6) {
      close()
    } else {
      setDragY(0)
    }
  }

  const stopProp = (e: React.SyntheticEvent) => e.stopPropagation()

  const dragProgress = Math.min(1, Math.abs(dragY) / 200)
  const overlayOpacity = 1 - dragProgress * 0.6
  const imageScale = 1 - dragProgress * 0.1

  return (
    <DismissableLayer
      // disableOutsidePointerEvents: bikin body pointer-events:none di luar
      // layer ini, sehingga Sheet/Dialog di bawahnya TIDAK fire outside
      // detector ketika user klik di Lightbox area.
      disableOutsidePointerEvents
      onEscapeKeyDown={(e) => {
        // Cegah default Radix close (kita panggil close() manual).
        // Stop propagation supaya listener Esc lain (mis. Sheet di bawah)
        // tdk ikut handle.
        e.preventDefault()
        e.stopPropagation()
        close()
      }}
      // onDismiss dipanggil saat outside event terjadi (tdk terjadi krn
      // disableOutsidePointerEvents=true) atau saat custom dismiss.
      onDismiss={close}
      asChild
    >
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center"
        onClick={close}
        style={{
          backgroundColor: `rgba(0, 0, 0, ${0.95 * overlayOpacity})`,
          transition: isDragging ? "none" : "background-color 200ms",
        }}
      >
      {/* Top bar: gradient hitam ke transparan, selalu accessible. */}
      <div
        onClick={stopProp}
        className={cn(
          "absolute inset-x-0 top-0 z-10 flex items-center gap-2 px-3 py-2 pt-safe transition-opacity duration-200",
          "bg-gradient-to-b from-black/70 via-black/40 to-transparent",
          controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
      >
        <button
          type="button"
          onClick={close}
          aria-label="Tutup"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-md hover:bg-white/25 active:bg-white/35 shrink-0"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex-1 min-w-0">
          {cur.alt && (
            <div className="truncate text-[13px] font-medium text-white">
              {cur.alt}
            </div>
          )}
          {images.length > 1 && (
            <div className="text-[11px] text-white/70">
              {index + 1} dari {images.length}
            </div>
          )}
        </div>

        <a
          href={cur.src}
          download
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Unduh"
          onClick={stopProp}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-md hover:bg-white/25 active:bg-white/35 shrink-0"
        >
          <Download className="h-5 w-5" />
        </a>
      </div>

      {/* Prev/Next button -- desktop visible always, mobile hide kalau
          controls tidak visible. Tetap di edge supaya jempol gampang. */}
      {images.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => {
              stopProp(e)
              prev()
            }}
            aria-label="Sebelumnya"
            className={cn(
              "absolute left-2 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-md hover:bg-white/25 active:bg-white/35 transition-opacity duration-200",
              controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none",
            )}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              stopProp(e)
              next()
            }}
            aria-label="Berikutnya"
            className={cn(
              "absolute right-2 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-md hover:bg-white/25 active:bg-white/35 transition-opacity duration-200",
              controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none",
            )}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      )}

      {/* Bottom dots indicator (multi image, mobile-friendly) */}
      {images.length > 1 && (
        <div
          onClick={stopProp}
          className={cn(
            "absolute bottom-0 inset-x-0 z-10 flex justify-center gap-1.5 pb-4 pb-safe transition-opacity duration-200",
            controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none",
          )}
        >
          {images.map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === index ? "w-6 bg-white" : "w-1.5 bg-white/40",
              )}
            />
          ))}
        </div>
      )}

      {/* Image -- tap to toggle controls + drag to close. */}
      <img
        src={cur.src}
        alt={cur.alt ?? ""}
        onPointerDown={onImagePointerDown}
        onPointerMove={onImagePointerMove}
        onPointerUp={onImagePointerUp}
        onPointerCancel={onImagePointerUp}
        onClick={(e) => {
          e.stopPropagation()
          // Tap (bukan drag) -> toggle controls
          setControlsVisible((v) => !v)
        }}
        className="max-h-[100vh] max-w-[100vw] select-none object-contain"
        style={{
          transform: `translateY(${dragY}px) scale(${imageScale})`,
          transition: isDragging ? "none" : "transform 200ms",
          touchAction: "none",
          cursor: isDragging ? "grabbing" : "grab",
        }}
        draggable={false}
      />
      </div>
    </DismissableLayer>
  )
}
