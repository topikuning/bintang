import { Link, useLocation } from "react-router"
import { FileText, Plus, Receipt, Search, ShoppingCart, Sparkles } from "lucide-react"
import { NotificationBell } from "./NotificationBell"
import { UserMenu } from "./UserMenu"
import { BrandMark } from "./BrandMark"
import { DESKTOP_NAV } from "./nav-config"

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
  const { pathname } = useLocation()
  const routeTitle = DESKTOP_NAV.flatMap((group) => group.items)
    .sort((a, b) => b.to.length - a.to.length)
    .find((item) => pathname === item.to || pathname.startsWith(`${item.to}/`))?.label

  return (
    <header className="sticky top-0 z-20 flex h-[72px] shrink-0 items-center gap-3 border-b border-white/70 bg-white/85 px-3 backdrop-blur-xl sm:px-6 pt-safe">
      {/* Brand mobile-only: Sidebar/NavRail hidden di <md, jadi tanpa
          ini area kiri Topbar kosong. Klik = ke /dashboard supaya
          double sebagai home-button. */}
      <Link
        to="/dashboard"
        className="-ml-1 flex items-center pr-1 md:hidden"
        aria-label="Beranda"
      >
        <BrandMark compact />
      </Link>

      {leftSlot}
      {title && (
        <div className="flex-1 min-w-0">
          <h1 className="truncate text-base font-semibold text-ink-900">
            {title}
          </h1>
        </div>
      )}
      {!title && (
        <div className="hidden min-w-0 flex-1 md:block">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-ink-400">
            <Sparkles className="h-3 w-3 text-brand-500" /> Ruang kerja
          </p>
          <p className="truncate text-[15px] font-semibold tracking-tight text-ink-900">{routeTitle ?? "Bintang"}</p>
        </div>
      )}
      {!title && <div className="flex-1 md:hidden" />}

      {showSearch && (
        <>
          {/* Desktop: pill-style trigger dgn hint Ctrl+K */}
          <button
            type="button"
            aria-label="Buka pencarian (Ctrl+K)"
            onClick={onCommandPaletteOpen}
            className="hidden h-10 w-72 items-center gap-2 rounded-xl border border-border bg-white px-3 text-[12px] text-ink-500 shadow-sm hover:border-brand-300 hover:text-ink-700 md:inline-flex"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="flex-1 text-left">Cari halaman, tx, invoice…</span>
            <kbd className="rounded-md border bg-ink-50 px-1.5 py-0.5 font-mono text-[10px] text-ink-500">
              Ctrl K
            </kbd>
          </button>
          {/* Mobile: cuma ikon */}
          <button
            type="button"
            aria-label="Cari"
            onClick={onCommandPaletteOpen}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-ink-700 hover:bg-ink-100 md:hidden"
          >
            <Search className="h-5 w-5" />
          </button>
        </>
      )}

      <details className="group relative hidden sm:block">
        <summary className="flex h-10 cursor-pointer list-none items-center gap-2 rounded-xl bg-ink-900 px-3.5 text-[12px] font-semibold text-white shadow-sm transition-colors hover:bg-ink-800 [&::-webkit-details-marker]:hidden">
          <Plus className="h-4 w-4" /> Buat baru
        </summary>
        <div className="absolute right-0 top-12 z-40 w-56 overflow-hidden rounded-xl border border-white bg-white p-1.5 shadow-[var(--app-shadow-raised)]">
          <QuickCreateLink to="/transactions?new=1" icon={FileText} label="Transaksi" hint="Catat kas masuk atau keluar" />
          <QuickCreateLink to="/invoices?new=1" icon={Receipt} label="Invoice" hint="Buat hutang atau piutang" />
          <QuickCreateLink to="/cash-requests?new=1" icon={Sparkles} label="Pengajuan dana" hint="Mulai alur persetujuan" />
          <QuickCreateLink to="/purchase-orders?new=1" icon={ShoppingCart} label="Purchase order" hint="Buat komitmen belanja" />
        </div>
      </details>

      <NotificationBell />
      <UserMenu />
    </header>
  )
}

function QuickCreateLink({
  to,
  icon: Icon,
  label,
  hint,
}: {
  to: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  hint: string
}) {
  return (
    <Link
      to={to}
      onClick={(event) => event.currentTarget.closest("details")?.removeAttribute("open")}
      className="flex items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-ink-50"
    >
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600"><Icon className="h-4 w-4" /></span>
      <span className="min-w-0">
        <span className="block text-[12px] font-semibold text-ink-800">{label}</span>
        <span className="block text-[10px] leading-4 text-ink-500">{hint}</span>
      </span>
    </Link>
  )
}
