import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { useVisualViewportVars } from "@/hooks/useVisualViewportVars"
import { cn } from "@/lib/utils"

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close
export const DialogPortal = DialogPrimitive.Portal

export const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-40 bg-ink-900/40 backdrop-blur-[2px]",
      "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

/** Dipasang hanya selama dialog terbuka (anak Content). */
function VisualViewportVars() {
  useVisualViewportVars()
  return null
}

/** Ponsel: jangan langsung fokus ke kolom isian. Keyboard yang muncul
 *  begitu dialog dibuka menutupi separuh layar dan membuat tampilan
 *  meloncat. Fokus dipindah ke dialog itu sendiri (tetap terbaca pembaca
 *  layar); keyboard baru muncul saat pengguna mengetuk kolom. */
function fokusAwalPonsel(e: Event) {
  if (e.defaultPrevented || !window.matchMedia?.("(pointer: coarse)").matches) return
  e.preventDefault()
  const konten = e.target as HTMLElement | null
  const aktif = document.activeElement as HTMLElement | null
  if (aktif && konten?.contains(aktif)) aktif.blur()
  konten?.focus({ preventScroll: true })
}

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { hideClose?: boolean }
>(({ className, hideClose, children, onOpenAutoFocus, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      onOpenAutoFocus={(e) => {
        onOpenAutoFocus?.(e)
        fokusAwalPonsel(e)
      }}
      className={cn(
        "fixed left-1/2 top-1/2 z-50 grid w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-surface p-5 shadow-lg",
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        // Ponsel: panel dari bawah selebar layar, setinggi maksimal area yang
        // terlihat (ikut mengecil saat keyboard muncul), isi bisa digulir.
        // Tanpa ini dialog yang lebih tinggi dari layar terpotong atas-bawah
        // dan tombol simpan tidak terjangkau.
        "max-sm:left-0 max-sm:right-0 max-sm:top-auto max-sm:bottom-[var(--vv-bottom,0px)] max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0",
        "max-sm:max-h-[calc(var(--vv-h,100dvh)-0.75rem)] max-sm:overflow-y-auto max-sm:overscroll-contain",
        "max-sm:rounded-b-none max-sm:rounded-t-2xl max-sm:border-x-0 max-sm:border-b-0",
        // Ada DialogFooter: jarak bawah diurus footer (yang menempel di dasar).
        "max-sm:pb-[max(1.25rem,env(safe-area-inset-bottom))] max-sm:has-[[data-slot=dialog-footer]]:pb-0",
        className,
      )}
      {...props}
    >
      <VisualViewportVars />
      {children}
      {!hideClose && (
        <DialogPrimitive.Close className="absolute right-3 top-3 rounded p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-900 focus:outline-none">
          <X className="h-4 w-4" />
          <span className="sr-only">Tutup</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5 text-left", className)} {...props} />
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-2",
        // Ponsel: tombol selalu terlihat di dasar panel (menempel saat isi
        // digulir), berdampingan supaya tidak memakan tinggi layar.
        "max-sm:sticky max-sm:bottom-0 max-sm:z-10 max-sm:-mx-5",
        "max-sm:flex-row max-sm:flex-wrap max-sm:border-t max-sm:bg-surface max-sm:px-5 max-sm:pt-3",
        "max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))] max-sm:[&>*]:min-w-[7rem] max-sm:[&>*]:flex-1",
        className,
      )}
      {...props}
    />
  )
}

export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-base font-semibold text-ink-900", className)}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-[13px] text-ink-600 leading-relaxed", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName
