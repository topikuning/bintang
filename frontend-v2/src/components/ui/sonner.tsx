import { Toaster as SonnerToaster, type ToasterProps } from "sonner"

export function Toaster(props: ToasterProps) {
  return (
    <SonnerToaster
      position="top-right"
      richColors
      closeButton
      duration={4000}
      toastOptions={{
        // Audit 2026-05-24: tambah `select-text` supaya keterangan
        // error bisa dicopy user (default sonner pakai user-select:none).
        classNames: {
          toast:
            "group rounded-md border bg-surface text-ink-900 shadow-lg select-text",
          title: "text-sm font-semibold select-text",
          description: "text-[13px] text-ink-500 select-text",
        },
      }}
      {...props}
    />
  )
}

export { toast } from "sonner"
