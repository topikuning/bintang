import { Outlet } from "react-router-dom"
import { Sidebar } from "./Sidebar"
import { NavRail } from "./NavRail"
import { BottomNav } from "./BottomNav"
import { Topbar } from "./Topbar"
import { ProjectSwitcher } from "./ProjectSwitcher"

/**
 * Layout shell tunggal yg adaptif lewat CSS responsive utilities --
 * tidak perlu re-render saat resize. Sidebar (lg+), NavRail (md),
 * BottomNav (<md). Bottom nav diberi space-filler 56px + safe-area.
 *
 * min-h-[100dvh] (dynamic viewport) > min-h-screen (100vh): di iOS Safari
 * 100vh termasuk URL bar yg shrinkable -> page scrollable melebihi viewport
 * visible padahal kontennya pendek. 100dvh menyesuaikan ke viewport aktual,
 * sehingga tidak ada empty-scroll setelah modal/sheet panjang ditutup.
 */
export function AppShell() {
  return (
    <div className="flex min-h-[100dvh] bg-surface-muted">
      <Sidebar />
      <NavRail />

      <div className="flex flex-1 flex-col min-w-0">
        <Topbar leftSlot={<ProjectSwitcher />} />

        {/* Main content. Padding bottom utk mobile bottom nav (56px + safe). */}
        <main className="flex-1 overflow-x-hidden pb-[calc(56px+env(safe-area-inset-bottom))] md:pb-0">
          <Outlet />
        </main>
      </div>

      <BottomNav />
    </div>
  )
}
