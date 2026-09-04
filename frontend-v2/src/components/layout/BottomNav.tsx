import { NavLink } from "react-router"
import { cn } from "@/lib/utils"
import { useMenuConfig } from "@/hooks/useMenuConfig"
import { MOBILE_BOTTOM_NAV, filterNavItems } from "./nav-config"

export function BottomNav() {
  const cfgQ = useMenuConfig()
  const allowed = cfgQ.data ? new Set(cfgQ.data.menu_ids) : undefined
  const items = filterNavItems(MOBILE_BOTTOM_NAV, allowed)
  return (
    <nav className="fixed inset-x-3 bottom-3 z-30 rounded-2xl border border-white/10 bg-[var(--app-nav)] p-1.5 shadow-[0_18px_50px_rgb(15_23_42/0.35)] pb-safe md:hidden">
      <ul className="flex gap-0.5">
        {items.map((item) => (
          <li key={item.to} className="flex-1">
            <NavLink
              to={item.to}
              end={item.to === "/dashboard" || item.to === "/transactions" || item.to === "/projects"}
              className={({ isActive }) =>
                cn(
                  "flex h-14 flex-col items-center justify-center gap-1 rounded-xl text-[10px] transition-colors",
                  isActive
                    ? "bg-brand-500 font-semibold text-white shadow-lg shadow-brand-950/30"
                    : "text-slate-400 hover:bg-white/[0.06] hover:text-white",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon
                    className={cn("h-5 w-5", isActive && "stroke-[2.4]")}
                  />
                  <span>{item.label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
