import { Construction } from "lucide-react"

interface PlaceholderProps {
  title: string
  description?: string
}

/**
 * Halaman skeleton sementara utk route yg modulnya belum dibangun.
 * Akan diganti saat masing-masing modul masuk Phase 1+.
 */
export function Placeholder({ title, description }: PlaceholderProps) {
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-2xl rounded-2xl border border-dashed border-ink-300 bg-white/75 p-8 text-center shadow-sm sm:p-12">
        <Construction className="mx-auto h-10 w-10 text-ink-400" />
        <h2 className="mt-4 text-lg font-semibold text-ink-900">{title}</h2>
        <p className="mt-1 text-sm text-ink-500">
          {description ?? "Halaman ini akan dibangun di phase berikutnya. Untuk sekarang, masih placeholder."}
        </p>
      </div>
    </div>
  )
}
