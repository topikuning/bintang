import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * DraggableSheet -- bottom sheet mobile dgn:
 *   1. Drag handle visible di top (afford pull-down).
 *   2. Pull-down gesture utk close (threshold ~80px atau velocity tinggi).
 *   3. Tombol close (X) di kanan atas, ukuran 44x44 (touch-friendly).
 *   4. Animasi drag follow finger; release di bawah threshold -> snap-back,
 *      di atas threshold atau swipe cepat -> close.
 *   5. Header sticky (drag handle + close + title) + body scrollable.
 *
 * Rationale: Radix Sheet default menutup hanya via tombol X kecil.
 * Untuk mobile UX modern, swipe-to-close adalah ekspektasi standar
 * (Material/iOS bottom sheets). Implementasi via pointer events --
 * tidak butuh library tambahan.
 *
 * Untuk desktop (lg+), gunakan komponen Sheet biasa (side="right").
 */

interface DraggableSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Maksimum tinggi sheet, default 92vh. */
  maxHeight?: string
  /** Render judul di header (sticky). */
  title?: React.ReactNode
  /** Render aksi tambahan di header kanan (di samping tombol close). */
  headerAction?: React.ReactNode
  /** Body content -- akan auto-scrollable. */
  children: React.ReactNode
  /** Footer sticky (mis. action buttons). */
  footer?: React.ReactNode
  /** Class tambahan utk container sheet. */
  className?: string
}

export function DraggableSheet({
  open,
  onOpenChange,
  maxHeight = "92vh",
  title,
  headerAction,
  children,
  footer,
  className,
}: DraggableSheetProps) {
  const [dragY, setDragY] = React.useState(0)
  const [isDragging, setIsDragging] = React.useState(false)
  const dragStartRef = React.useRef<{ y: number; t: number } | null>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const scrollRef = React.useRef<HTMLDivElement>(null)

  // Reset position saat sheet ditutup/dibuka
  React.useEffect(() => {
    if (!open) {
      setDragY(0)
      setIsDragging(false)
    }
  }, [open])

  /**
   * Pointer drag dimulai HANYA dari drag-handle / header area, bukan
   * dari body scrollable. Ini supaya user yg scroll konten panjang
   * tidak accidentally close sheet.
   */
  const onHandlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragStartRef.current = { y: e.clientY, t: Date.now() }
    setIsDragging(true)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || !dragStartRef.current) return
    const dy = e.clientY - dragStartRef.current.y
    // Hanya allow drag ke bawah (positif). Negatif (drag ke atas) clamp ke 0.
    setDragY(Math.max(0, dy))
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    const dy = e.clientY - dragStartRef.current.y
    const dt = Date.now() - dragStartRef.current.t
    const velocity = dy / Math.max(1, dt) // px/ms
    dragStartRef.current = null
    setIsDragging(false)

    // Threshold: distance > 80px ATAU velocity > 0.5 px/ms (swipe cepat)
    if (dy > 80 || velocity > 0.5) {
      onOpenChange(false)
    } else {
      // Snap back
      setDragY(0)
    }
  }

  // Allow swipe-down dari area body kalau scroll sudah di top
  const onBodyPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse") return // hanya touch yg trigger from body
    const sc = scrollRef.current
    if (!sc) return
    if (sc.scrollTop > 0) return // user lagi scroll konten -> jangan drag
    onHandlePointerDown(e)
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-40 bg-ink-900/40 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        />
        <DialogPrimitive.Content
          ref={contentRef}
          aria-describedby={undefined}
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-2xl bg-surface shadow-2xl outline-none",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
            !isDragging && "transition-transform duration-200",
            className,
          )}
          style={{
            maxHeight,
            transform: `translateY(${dragY}px)`,
            paddingBottom: "env(safe-area-inset-bottom)",
            touchAction: "none",
          }}
        >
          {/* Header sticky -- juga drag handle area */}
          <div
            className="relative shrink-0 select-none"
            onPointerDown={onHandlePointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            style={{ touchAction: "none" }}
          >
            {/* Drag bar visual */}
            <div className="flex justify-center pt-2 pb-1.5">
              <div className="h-1 w-10 rounded-full bg-ink-300" />
            </div>

            {/* Title row + close button */}
            <div className="flex items-center gap-2 px-4 pb-3 border-b">
              {title && (
                <DialogPrimitive.Title className="flex-1 text-base font-semibold text-ink-900 truncate">
                  {title}
                </DialogPrimitive.Title>
              )}
              {!title && <div className="flex-1" />}
              {headerAction}
              <DialogPrimitive.Close
                aria-label="Tutup"
                className="flex h-11 w-11 items-center justify-center rounded-full bg-ink-100 text-ink-700 transition-colors hover:bg-ink-200 active:bg-ink-300"
              >
                <X className="h-5 w-5" />
              </DialogPrimitive.Close>
            </div>
          </div>

          {/* Body scrollable */}
          <div
            ref={scrollRef}
            onPointerDown={onBodyPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="flex-1 overflow-y-auto overscroll-contain"
            style={{ touchAction: isDragging ? "none" : "pan-y" }}
          >
            {children}
          </div>

          {/* Footer sticky kalau ada */}
          {footer && (
            <div className="shrink-0 border-t bg-surface">{footer}</div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
