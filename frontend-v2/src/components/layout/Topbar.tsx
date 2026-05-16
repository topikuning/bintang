import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeftRight, ClipboardList, Receipt, Search, X } from "lucide-react"
import { UserMenu } from "./UserMenu"
import { cn } from "@/lib/utils"

interface TopbarProps {
  /** Override judul (kalau tidak, child page bisa render judul sendiri di main). */
  title?: React.ReactNode
  /** Slot di kiri (mis. project switcher). */
  leftSlot?: React.ReactNode
  /** Render tombol search. Mobile = ikon, desktop = input. */
  showSearch?: boolean
}

export function Topbar({ title, leftSlot, showSearch = true }: TopbarProps) {
  const [mobileOpen, setMobileOpen] = useState(false)

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
          <div className="hidden md:block">
            <GlobalSearch />
          </div>
          {/* Mobile search icon -- toggle row di bawah header */}
          <button
            type="button"
            aria-label="Cari"
            onClick={() => setMobileOpen((v) => !v)}
            className="md:hidden flex h-10 w-10 items-center justify-center rounded text-ink-700 hover:bg-ink-100"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Search className="h-5 w-5" />}
          </button>
        </>
      )}

      <UserMenu />

      {showSearch && mobileOpen && (
        <div className="md:hidden absolute left-0 right-0 top-full border-b bg-surface px-3 py-2 shadow-sm">
          <GlobalSearch onPicked={() => setMobileOpen(false)} fullWidth />
        </div>
      )}
    </header>
  )
}

interface SearchTarget {
  label: string
  icon: React.ComponentType<{ className?: string }>
  to: (q: string) => string
}

const TARGETS: SearchTarget[] = [
  {
    label: "Transaksi",
    icon: ArrowLeftRight,
    to: (q) => `/transactions?q=${encodeURIComponent(q)}`,
  },
  {
    label: "Invoice",
    icon: Receipt,
    to: (q) => `/invoices?q=${encodeURIComponent(q)}`,
  },
  {
    label: "Vendor / Klien",
    icon: ClipboardList,
    to: (q) => `/master/vendors-clients?q=${encodeURIComponent(q)}`,
  },
]

function GlobalSearch({
  fullWidth,
  onPicked,
}: {
  fullWidth?: boolean
  onPicked?: () => void
}) {
  const navigate = useNavigate()
  const [q, setQ] = useState("")
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Close dropdown when click outside.
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  const trimmed = q.trim()
  const showDropdown = open && trimmed.length > 0

  const handlePick = (target: SearchTarget) => {
    navigate(target.to(trimmed))
    setOpen(false)
    setQ("")
    onPicked?.()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown) return
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActiveIdx((i) => (i + 1) % TARGETS.length)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActiveIdx((i) => (i - 1 + TARGETS.length) % TARGETS.length)
    } else if (e.key === "Enter") {
      e.preventDefault()
      const target = TARGETS[activeIdx]
      if (target) handlePick(target)
    } else if (e.key === "Escape") {
      e.preventDefault()
      setOpen(false)
      inputRef.current?.blur()
    }
  }

  return (
    <div
      ref={containerRef}
      className={cn("relative", fullWidth ? "w-full" : "w-72")}
    >
      <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
      <input
        ref={inputRef}
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
          setActiveIdx(0)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder="Cari transaksi, invoice, vendor…"
        className="h-9 w-full rounded border border-border bg-surface-muted pl-8 pr-3 text-sm placeholder:text-ink-400 focus:outline-none focus:border-brand-500 focus:bg-surface"
      />
      {showDropdown && (
        <div className="absolute left-0 right-0 top-full mt-1 z-40 rounded-md border bg-surface shadow-lg overflow-hidden">
          <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-ink-500 border-b">
            Cari "<span className="text-ink-700 font-semibold">{trimmed}</span>" di
          </div>
          <ul>
            {TARGETS.map((t, i) => {
              const Icon = t.icon
              const active = i === activeIdx
              return (
                <li key={t.label}>
                  <button
                    type="button"
                    onClick={() => handlePick(t)}
                    onMouseEnter={() => setActiveIdx(i)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-sm",
                      active ? "bg-brand-50 text-brand-800" : "hover:bg-ink-50 text-ink-800",
                    )}
                  >
                    <Icon className={cn("h-4 w-4", active ? "text-brand-600" : "text-ink-500")} />
                    <span>{t.label}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="px-3 py-1.5 border-t text-[10px] text-ink-500 bg-surface-muted">
            <kbd className="rounded border bg-surface px-1 font-mono text-[10px]">↑↓</kbd> pilih ·{" "}
            <kbd className="rounded border bg-surface px-1 font-mono text-[10px]">Enter</kbd> buka ·{" "}
            <kbd className="rounded border bg-surface px-1 font-mono text-[10px]">Esc</kbd> tutup
          </div>
        </div>
      )}
    </div>
  )
}
