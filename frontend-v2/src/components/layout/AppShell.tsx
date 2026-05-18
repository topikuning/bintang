import { useState } from "react"
import { Outlet } from "react-router-dom"
import { Sidebar } from "./Sidebar"
import { NavRail } from "./NavRail"
import { BottomNav } from "./BottomNav"
import { Topbar } from "./Topbar"
import { CommandPalette } from "./CommandPalette"
import { useGlobalShortcut } from "@/hooks/useGlobalShortcut"

/**
 * Layout shell tunggal yg adaptif lewat CSS responsive utilities --
 * tidak perlu re-render saat resize. Sidebar (lg+), NavRail (md),
 * BottomNav (<md).
 *
 * NB: tidak ada global project switcher di topbar (sengaja). Dashboard
 * selalu menampilkan ringkasan semua proyek; setiap halaman list punya
 * filter proyek sendiri; drilldown ke detail satu proyek lewat Hub
 * Proyek -> /projects/:id. Pola ini sama dgn Jurnal / QuickBooks utk
 * menghindari "hidden global state" yg bikin user bingung.
 */
export function AppShell() {
  const [paletteOpen, setPaletteOpen] = useState(false)

  // Cmd/Ctrl + K toggle command palette. Esc juga close (handled di
  // palette internally lewat backdrop click, plus Esc shortcut di sini
  // utk lebih responsive).
  useGlobalShortcut(() => setPaletteOpen((v) => !v), {
    combos: ["Meta+k", "Control+k"],
  })
  useGlobalShortcut(() => setPaletteOpen(false), {
    combos: ["Escape"],
    skipInInputs: false,
  })

  return (
    <div className="flex min-h-[100dvh] bg-surface-muted">
      <Sidebar />
      <NavRail />

      <div className="flex flex-1 flex-col min-w-0">
        <Topbar onCommandPaletteOpen={() => setPaletteOpen(true)} />

        {/* Main content. Padding bottom utk mobile bottom nav (56px + safe). */}
        <main className="flex-1 overflow-x-hidden pb-[calc(56px+env(safe-area-inset-bottom))] md:pb-0">
          <Outlet />
        </main>
      </div>

      <BottomNav />

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  )
}
