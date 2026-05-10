import { AlertTriangle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface ErrorStateProps {
  title?: string
  description?: React.ReactNode
  onRetry?: () => void
  className?: string
}

export function ErrorState({
  title = "Gagal memuat data",
  description,
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-md border bg-danger-50 p-6 text-center",
        className,
      )}
    >
      <AlertTriangle className="h-8 w-8 text-danger-600" />
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-danger-700">{title}</h3>
        {description && (
          <p className="text-sm text-danger-600 max-w-md">{description}</p>
        )}
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RefreshCw className="h-4 w-4" />
          Coba lagi
        </Button>
      )}
    </div>
  )
}
