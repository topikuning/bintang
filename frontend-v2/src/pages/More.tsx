import { ChevronRight } from "lucide-react"
import { Link } from "react-router-dom"
import { useAuthStore } from "@/store/auth"
import { MOBILE_MORE_NAV } from "@/components/layout/nav-config"

/**
 * Halaman /more -- mobile overflow menu utk fitur yg tidak muat di
 * bottom nav (5 item).
 *
 * Auto-filter berdasar role:
 *  - Audit Log: SUPERADMIN/CENTRAL_ADMIN
 *  - Pengguna: SUPERADMIN/CENTRAL_ADMIN
 */
export function MorePage() {
  const role = useAuthStore((s) => s.user?.role)
  const isAdmin = role === "SUPERADMIN" || role === "CENTRAL_ADMIN"

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-5">
      <div>
        <h1 className="text-xl font-bold text-ink-900">Lainnya</h1>
        <p className="text-[13px] text-ink-500 mt-0.5">
          Menu tambahan & pengaturan.
        </p>
      </div>

      {MOBILE_MORE_NAV.map((group) => {
        const items = group.items.filter((item) => {
          // Filter sensitive routes utk non-admin
          if (item.to === "/audit-log" || item.to === "/master/users") {
            return isAdmin
          }
          return true
        })
        if (items.length === 0) return null
        return (
          <div key={group.label} className="space-y-1.5">
            <div className="px-1 text-[11px] font-semibold uppercase tracking-wider text-ink-500">
              {group.label}
            </div>
            <ul className="flex flex-col divide-y rounded-md border bg-surface">
              {items.map((item) => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    className="flex items-center gap-3 px-3 py-3 hover:bg-surface-muted active:bg-ink-100"
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded bg-brand-50 text-brand-600 shrink-0">
                      <item.icon className="h-4 w-4" />
                    </span>
                    <span className="flex-1 text-sm font-medium">{item.label}</span>
                    <ChevronRight className="h-4 w-4 text-ink-300" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
