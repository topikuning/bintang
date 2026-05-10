import { Toaster as SonnerToaster, type ToasterProps } from "sonner"

export function Toaster(props: ToasterProps) {
  return (
    <SonnerToaster
      position="top-right"
      richColors
      closeButton
      duration={4000}
      toastOptions={{
        classNames: {
          toast:
            "group rounded-md border bg-surface text-ink-900 shadow-lg",
          title: "text-sm font-semibold",
          description: "text-[13px] text-ink-500",
        },
      }}
      {...props}
    />
  )
}

export { toast } from "sonner"
