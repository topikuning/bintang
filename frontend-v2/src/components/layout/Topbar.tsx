import { Link } from "react-router-dom"
import { Search } from "lucide-react"
import { NotificationBell } from "./NotificationBell"
import { UserMenu } from "./UserMenu"

interface TopbarProps {
  /** Override judul (kalau tidak, child page bisa render judul sendiri di main). */
  title?: React.ReactNode
  /** Slot di kiri (mis. project switcher). Currently unused tapi tetap
   * di-export utk extensibility. */
  leftSlot?: React.ReactNode
  /** Render search trigger (default true). Klik = open Command Palette. */
  showSearch?: boolean
  /** Handler buka command palette -- di-pass dari AppShell. */
  onCommandPaletteOpen?: () => void
}

/**
 * Topbar app shell. Berisi: brand mobile, search trigger,
 * notification bell, user menu.
 *
 * Search trigger di-replace dgn Command Palette (Cmd+K) -- 1 entry
 * point ergonomic utk jump navigasi + cari entity. Sebelumnya pakai
 * dropdown search per-target yg butuh user pilih kategori dulu.
 */
export function Topbar({
  title,
  leftSlot,
  showSearch = true,
  onCommandPaletteOpen,
}: TopbarProps) {
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b bg-surface px-3 sm:px-5 pt-safe">
      {/* Brand mobile-only: Sidebar/NavRail hidden di <md, jadi tanpa
          ini area kiri Topbar kosong. Klik = ke /dashboard supaya
          double sebagai home-button. */}
      <Link
        to="/dashboard"
        className="md:hidden flex items-center gap-2 -ml-1 pr-1"
        aria-label="Beranda"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded bg-brand-500 text-white font-bold text-[13px]">
          B
        </span>
        <span className="text-sm font-bold text-ink-900">Bintang</span>
      </Link>

      {leftSlot}
      {title && (
        <div className="flex-1 min-w-0">
          <h1 className="truncate text-base font-semibold text-ink-900">
            {title}
          </h1>
        </div>
      )}
      {!title && <div className="flex-1" />}

      {showSearch && (
        <>
          {/* Desktop: pill-style trigger dgn hint Ctrl+K */}
          <button
            type="button"
            aria-label="Buka pencarian (Ctrl+K)"
            onClick={onCommandPaletteOpen}
            className="hidden md:inline-flex h-9 items-center gap-2 rounded border border-border bg-surface-muted px-3 text-[12px] text-ink-500 hover:bg-ink-100 hover:text-ink-700 w-72"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="flex-1 text-left">Cari halaman, tx, invoice…</span>
            <kbd className="rounded border bg-surface px-1.5 py-0.5 font-mono text-[10px] text-ink-500">
              Ctrl K
            </kbd>
          </button>
          {/* Mobile: cuma ikon */}
          <button
            type="button"
            aria-label="Cari"
            onClick={onCommandPaletteOpen}
            className="md:hidden flex h-10 w-10 items-center justify-center rounded text-ink-700 hover:bg-ink-100"
          >
            <Search className="h-5 w-5" />
          </button>
        </>
      )}

      <NotificationBell />
      <UserMenu />
    </header>
  )
}
