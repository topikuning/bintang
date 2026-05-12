import { NavLink } from "react-router-dom"
import { cn } from "@/lib/utils"
import { useMenuConfig } from "@/hooks/useMenuConfig"
import { MOBILE_BOTTOM_NAV, filterNavItems } from "./nav-config"

export function BottomNav() {
  const cfgQ = useMenuConfig()
  const allowed = cfgQ.data ? new Set(cfgQ.data.menu_ids) : undefined
  const items = filterNavItems(MOBILE_BOTTOM_NAV, allowed)
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t bg-surface pb-safe">
      <ul className="flex">
        {items.map((item) => (
          <li key={item.to} className="flex-1">
            <NavLink
              to={item.to}
              end={item.to === "/dashboard"}
              className={({ isActive }) =>
                cn(
                  "flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] transition-colors",
                  isActive
                    ? "text-brand-600 font-semibold"
                    : "text-ink-500 hover:text-ink-700 active:bg-ink-100",
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
