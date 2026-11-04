import { ChevronRight } from "lucide-react"
import { Link } from "react-router"
import { useAuthStore } from "@/store/auth"
import { useMenuConfig } from "@/hooks/useMenuConfig"
import { MOBILE_MORE_NAV, filterNavGroups } from "@/components/layout/nav-config"

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
  const cfgQ = useMenuConfig()
  const allowed = cfgQ.data ? new Set(cfgQ.data.menu_ids) : undefined
  const filteredGroups = filterNavGroups(MOBILE_MORE_NAV, allowed)

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6 lg:p-8">
      <div>
        <div className="mb-2 h-1 w-10 rounded-full bg-brand-500" />
        <h1 className="text-2xl font-bold text-ink-900 sm:text-3xl">Lainnya</h1>
        <p className="text-[13px] text-ink-500 mt-0.5">
          Menu tambahan & pengaturan.
        </p>
      </div>

      {filteredGroups.map((group) => {
        const items = group.items.filter((item) => {
          // Defensive: audit-log + master-users tetap di-gate ke admin
          // (selain dari policy admin DB).
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
            <ul className="flex flex-col divide-y rounded-xl border border-white/80 bg-surface shadow-[var(--app-shadow)] ring-1 ring-ink-200/60">
              {items.map((item) => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    className="flex items-center gap-3 px-3 py-3 hover:bg-surface-muted active:bg-ink-100"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
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
