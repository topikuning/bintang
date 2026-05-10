import { NavLink } from "react-router-dom"
import * as Tooltip from "@radix-ui/react-tooltip"
import { cn } from "@/lib/utils"
import { TABLET_NAV } from "./nav-config"

export function NavRail() {
  return (
    <Tooltip.Provider delayDuration={300}>
      <aside className="hidden md:flex lg:hidden w-14 shrink-0 flex-col border-r bg-surface">
        <div className="flex h-14 items-center justify-center border-b">
          <div className="flex h-7 w-7 items-center justify-center rounded bg-brand-500 text-white font-bold text-[13px]">
            B
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          <ul className="flex flex-col items-center gap-1">
            {TABLET_NAV.map((item) => (
              <li key={item.to}>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <NavLink
                      to={item.to}
                      end={item.to === "/dashboard"}
                      className={({ isActive }) =>
                        cn(
                          "flex h-10 w-10 items-center justify-center rounded transition-colors",
                          isActive
                            ? "bg-brand-50 text-brand-700"
                            : "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
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
                      className="z-50 rounded bg-ink-900 px-2 py-1 text-[12px] text-white shadow-lg"
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
