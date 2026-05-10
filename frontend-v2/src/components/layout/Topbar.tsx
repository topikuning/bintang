import { Search } from "lucide-react"
import { UserMenu } from "./UserMenu"

interface TopbarProps {
  /** Override judul (kalau tidak, child page bisa render judul sendiri di main). */
  title?: React.ReactNode
  /** Slot di kiri (mis. project switcher). */
  leftSlot?: React.ReactNode
  /** Render tombol search. Mobile = ikon, desktop = input. */
  showSearch?: boolean
}

export function Topbar({ title, leftSlot, showSearch = true }: TopbarProps) {
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b bg-surface px-3 sm:px-5 pt-safe">
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
          {/* Desktop search */}
          <div className="hidden md:flex relative w-72">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
            <input
              type="search"
              placeholder="Cari transaksi, invoice, vendor…"
              className="h-9 w-full rounded border border-border bg-surface-muted pl-8 pr-3 text-sm placeholder:text-ink-400 focus:outline-none focus:border-brand-500 focus:bg-surface"
            />
          </div>
          {/* Mobile search icon */}
          <button
            type="button"
            aria-label="Cari"
            className="md:hidden flex h-10 w-10 items-center justify-center rounded text-ink-700 hover:bg-ink-100"
          >
            <Search className="h-5 w-5" />
          </button>
        </>
      )}

      <UserMenu />
    </header>
  )
}
