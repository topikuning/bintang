import { NavLink } from "react-router"
import * as Tooltip from "@radix-ui/react-tooltip"
import { cn } from "@/lib/utils"
import { useMenuConfig } from "@/hooks/useMenuConfig"
import { TABLET_NAV, filterNavItems } from "./nav-config"
import { BrandMark } from "./BrandMark"

export function NavRail() {
  const cfgQ = useMenuConfig()
  const allowed = cfgQ.data ? new Set(cfgQ.data.menu_ids) : undefined
  const items = filterNavItems(TABLET_NAV, allowed)
  return (
    <Tooltip.Provider delayDuration={300}>
      <aside className="sticky top-0 hidden h-[100dvh] w-[68px] shrink-0 self-start flex-col border-r border-white/5 bg-[var(--app-nav)] md:flex lg:hidden">
        <div className="flex h-[72px] shrink-0 items-center justify-center border-b border-white/8">
          <BrandMark compact />
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto py-3">
          <ul className="flex flex-col items-center gap-1.5">
            {items.map((item) => (
              <li key={item.to}>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <NavLink
                      to={item.to}
                      end={item.to === "/dashboard"}
                      className={({ isActive }) =>
                        cn(
                          "flex h-11 w-11 items-center justify-center rounded-xl transition-colors",
                          isActive
                            ? "bg-brand-500 text-white shadow-lg shadow-brand-900/30"
                            : "text-slate-400 hover:bg-white/[0.07] hover:text-white",
                        )
                      }
                    >
                      <item.icon className="h-5 w-5" />
                      <span className="sr-only">{item.label}</span>
                    </NavLink>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content
                      side="right"
                      sideOffset={8}
                      className="z-50 rounded-lg border border-white/10 bg-ink-900 px-2.5 py-1.5 text-[12px] text-white shadow-xl"
                    >
                      {item.label}
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
    </Tooltip.Provider>
  )
}
