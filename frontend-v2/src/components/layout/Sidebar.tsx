import { NavLink } from "react-router-dom"
import { cn } from "@/lib/utils"
import { useMenuConfig } from "@/hooks/useMenuConfig"
import { DESKTOP_NAV, filterNavGroups } from "./nav-config"

export function Sidebar() {
  const cfgQ = useMenuConfig()
  const allowed = cfgQ.data ? new Set(cfgQ.data.menu_ids) : undefined
  const groups = filterNavGroups(DESKTOP_NAV, allowed)
  return (
    <aside className="hidden lg:flex w-60 shrink-0 flex-col border-r bg-surface sticky top-0 h-[100dvh] self-start">
      <div className="flex h-14 items-center gap-2 px-5 border-b shrink-0">
        <div className="flex h-7 w-7 items-center justify-center rounded bg-brand-500 text-white font-bold text-[13px]">
          C
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-bold">CACAK</span>
          <span className="text-[10px] uppercase tracking-wider text-ink-500">
            Catatan Arus Cash &amp; Anggaran Kerja
          </span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3 min-h-0">
        {groups.map((group) => (
          <div key={group.label} className="mb-4">
            <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
              {group.label}
            </div>
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === "/dashboard"}
                    className={({ isActive }) =>
                      cn(
                        "flex h-9 items-center gap-2.5 rounded px-3 text-sm transition-colors",
                        isActive
                          ? "bg-brand-50 text-brand-700 font-semibold"
                          : "text-ink-700 hover:bg-ink-100 hover:text-ink-900",
                      )
                    }
                  >
                    <item.icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t p-3 text-[11px] text-ink-500 shrink-0">
        CACAK v2.0 · {new Date().getFullYear()}
      </div>
    </aside>
  )
}
