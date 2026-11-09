import { Link, matchPath, useLocation } from "react-router"
import * as Tooltip from "@radix-ui/react-tooltip"
import { cn } from "@/lib/utils"
import { useMenuConfig } from "@/hooks/useMenuConfig"
import { TABLET_NAV, filterNavItems } from "./nav-config"
import { BrandMark } from "./BrandMark"

/** Rute yang hanya aktif bila sama persis (bukan untuk sub-halamannya). */
const PERSIS = new Set(["/dashboard", "/transactions", "/projects", "/reports", "/settings", "/master/projects"])

export function NavRail() {
  const cfgQ = useMenuConfig()
  const { pathname } = useLocation()
  const allowed = cfgQ.data ? new Set(cfgQ.data.menu_ids) : undefined
  const items = filterNavItems(TABLET_NAV, allowed)
  return (
    <Tooltip.Provider delayDuration={300}>
      <aside className="sticky top-0 hidden h-[100dvh] w-[68px] shrink-0 self-start flex-col border-r border-border bg-[var(--app-nav)] md:flex lg:hidden">
        <div className="flex h-[72px] shrink-0 items-center justify-center border-b border-border">
          <BrandMark compact />
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto py-3">
          <ul className="flex flex-col items-center gap-1.5">
            {items.map((item) => {
              // Bukan NavLink: Tooltip.Trigger asChild (Radix Slot) menggabungkan
              // className sebagai string, sehingga className-fungsi milik NavLink
              // berubah jadi teks dan gaya tidak pernah terpasang.
              const isActive = matchPath({ path: item.to, end: PERSIS.has(item.to) }, pathname) !== null
              return (
                <li key={item.to}>
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <Link
                        to={item.to}
                        aria-current={isActive ? "page" : undefined}
                        className={cn(
                          "flex h-11 w-11 items-center justify-center rounded-xl transition-colors",
                          isActive
                            ? "bg-brand-100 text-brand-700 ring-1 ring-inset ring-brand-200"
                            : "text-ink-500 hover:bg-surface-sunken hover:text-ink-900",
                        )}
                      >
                        <item.icon className="h-5 w-5" />
                        <span className="sr-only">{item.label}</span>
                      </Link>
                    </Tooltip.Trigger>
                    <Tooltip.Portal>
                      <Tooltip.Content
                        side="right"
                        sideOffset={8}
                        className="z-50 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12px] font-medium text-ink-800 shadow-[var(--app-shadow-raised)]"
                      >
                        {item.label}
                      </Tooltip.Content>
                    </Tooltip.Portal>
                  </Tooltip.Root>
                </li>
              )
            })}
          </ul>
        </nav>
      </aside>
    </Tooltip.Provider>
  )
}
