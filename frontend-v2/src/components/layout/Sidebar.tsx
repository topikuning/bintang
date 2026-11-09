import { NavLink } from "react-router"
import { cn } from "@/lib/utils"
import { useMenuConfig } from "@/hooks/useMenuConfig"
import { DESKTOP_NAV, filterNavGroups } from "./nav-config"
import { BrandMark } from "./BrandMark"

export function Sidebar() {
  const cfgQ = useMenuConfig()
  const allowed = cfgQ.data ? new Set(cfgQ.data.menu_ids) : undefined
  const groups = filterNavGroups(DESKTOP_NAV, allowed)
  return (
    <aside className="sticky top-0 hidden h-[100dvh] w-[264px] shrink-0 self-start flex-col border-r border-border bg-[var(--app-nav)] text-ink-700 lg:flex">
      <div className="flex h-[72px] shrink-0 items-center border-b border-border px-5">
        <BrandMark />
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-5">
        {groups.map((group) => (
          <div key={group.label} className="mb-5">
            <div className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-ink-400">
              {group.label}
            </div>
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === "/dashboard" || item.to === "/transactions" || item.to === "/projects" || item.to === "/reports" || item.to === "/settings" || item.to === "/master/projects"}
                    className={({ isActive }) =>
                      cn(
                        "group relative flex h-10 items-center gap-3 rounded-lg px-3 text-[13px] transition-colors",
                        isActive
                          ? "bg-brand-50 font-semibold text-brand-700 shadow-[inset_3px_0_0_0] shadow-brand-600"
                          : "text-ink-600 hover:bg-surface-sunken hover:text-ink-900",
                      )
                    }
                  >
                    <item.icon className="h-[18px] w-[18px]" />
                    <span>{item.label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-border px-5 py-4 text-[10px] tracking-wide text-ink-400">
        BINTANG · {new Date().getFullYear()}
      </div>
    </aside>
  )
}
