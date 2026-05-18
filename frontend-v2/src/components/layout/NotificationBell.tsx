import { Bell, CheckCircle2 } from "lucide-react"
import { Link } from "react-router-dom"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useNotifications } from "@/hooks/useNotifications"
import { cn } from "@/lib/utils"

const TONE_DOT = {
  info: "bg-info-500",
  warning: "bg-warning-500",
  danger: "bg-danger-500",
} as const

/**
 * Bell di topbar dgn badge count. Klik = dropdown panel dgn list
 * notifikasi actionable (klik = navigate ke filtered list).
 *
 * Polled via useNotifications (60s + on window focus).
 */
export function NotificationBell() {
  const q = useNotifications()
  const summary = q.data
  const total = summary?.total ?? 0
  const items = summary?.items ?? []
  const showBadge = total > 0

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Notifikasi${total > 0 ? ` (${total})` : ""}`}
          className="relative flex h-10 w-10 items-center justify-center rounded text-ink-700 hover:bg-ink-100"
        >
          <Bell className="h-5 w-5" />
          {showBadge && (
            <span
              className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger-500 px-1 text-[10px] font-bold text-white"
              aria-hidden="true"
            >
              {total > 99 ? "99+" : total}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="border-b px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Notifikasi</span>
            {showBadge && (
              <span className="text-[11px] text-ink-500">
                {total} item perlu perhatian
              </span>
            )}
          </div>
        </div>
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-3 py-6 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-success-50 text-success-600">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div className="text-sm font-medium text-ink-900">Semua lancar</div>
            <div className="text-[12px] text-ink-500">
              Tidak ada yang perlu tindakan saat ini.
            </div>
          </div>
        ) : (
          <ul className="max-h-80 overflow-y-auto">
            {items.map((it) => (
              <li key={it.kind}>
                <Link
                  to={it.to}
                  className="flex items-start gap-2.5 px-3 py-2.5 hover:bg-ink-50 border-b last:border-b-0"
                >
                  <span
                    className={cn(
                      "mt-1 h-2 w-2 rounded-full shrink-0",
                      TONE_DOT[it.tone],
                    )}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-ink-900">
                      {it.label}
                    </div>
                  </div>
                  <span className="text-[18px] text-ink-300 leading-none">›</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t bg-surface-muted/40 px-3 py-1.5 text-center text-[10px] text-ink-500">
          Refresh otomatis tiap 60 detik
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
