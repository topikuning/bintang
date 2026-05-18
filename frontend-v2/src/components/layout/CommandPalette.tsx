import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  ArrowLeftRight,
  ArrowRight,
  BadgeDollarSign,
  Building2,
  FolderKanban,
  History,
  Home,
  PieChart,
  Receipt,
  Search,
  Settings,
  ShoppingCart,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react"
import { useTransactions } from "@/hooks/useTransactions"
import { useInvoices } from "@/hooks/useInvoices"
import { usePOs } from "@/hooks/usePOs"
import { useProjects } from "@/hooks/useProjects"
import { cn } from "@/lib/utils"
import { fmtCompact } from "@/lib/format"

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
}

interface PaletteItem {
  id: string
  label: string
  hint?: string
  icon: LucideIcon
  group: string
  to: string
}

const NAV_ITEMS: PaletteItem[] = [
  { id: "nav-home", label: "Beranda", icon: Home, group: "Navigasi", to: "/dashboard" },
  { id: "nav-tx", label: "Transaksi", icon: ArrowLeftRight, group: "Navigasi", to: "/transactions" },
  { id: "nav-tx-draft", label: "Transaksi Draft", icon: ArrowLeftRight, group: "Navigasi", to: "/transactions?status=DRAFT", hint: "Belum di-submit" },
  { id: "nav-tx-pending", label: "Transaksi Menunggu Verifikasi", icon: ArrowLeftRight, group: "Navigasi", to: "/transactions?status=SUBMITTED" },
  { id: "nav-tx-cash-advance", label: "Dana Operasional", icon: Wallet, group: "Navigasi", to: "/transactions/cash-advances" },
  { id: "nav-inv", label: "Invoice", icon: Receipt, group: "Navigasi", to: "/invoices" },
  { id: "nav-inv-overdue", label: "Invoice Lewat Jatuh Tempo", icon: Receipt, group: "Navigasi", to: "/invoices?status=OVERDUE" },
  { id: "nav-po", label: "Purchase Order", icon: ShoppingCart, group: "Navigasi", to: "/purchase-orders" },
  { id: "nav-budget", label: "Budget vs Actual", icon: BadgeDollarSign, group: "Navigasi", to: "/budget" },
  { id: "nav-reports", label: "Laporan", icon: PieChart, group: "Navigasi", to: "/reports" },
  { id: "nav-audit", label: "Audit Log", icon: History, group: "Navigasi", to: "/audit-log" },
  { id: "nav-projects-hub", label: "Hub Proyek", icon: FolderKanban, group: "Navigasi", to: "/projects" },
  { id: "nav-master-projects", label: "Master Proyek", icon: FolderKanban, group: "Navigasi", to: "/master/projects" },
  { id: "nav-master-companies", label: "Master Perusahaan", icon: Building2, group: "Navigasi", to: "/master/companies" },
  { id: "nav-master-vendors", label: "Master Vendor / Klien", icon: Users, group: "Navigasi", to: "/master/vendors-clients" },
  { id: "nav-master-users", label: "Master User", icon: Users, group: "Navigasi", to: "/master/users" },
  { id: "nav-settings", label: "Pengaturan", icon: Settings, group: "Navigasi", to: "/settings" },
]

/**
 * Command palette (Cmd/Ctrl+K).
 *
 * Goal: jump cepat ke page apapun + cari entity (tx/invoice/PO/proyek)
 * tanpa harus klik menu satu-satu. Pattern Linear / Notion / Raycast.
 *
 * Implementation:
 * - Hand-rolled (no cmdk lib) supaya zero dep.
 * - Debounce 250ms query input -> trigger parallel fetch tx/inv/po/project.
 * - Keyboard: ↑/↓ navigate, Enter open, Esc close.
 * - Auto-focus input saat open. Result selected = first row.
 */
export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate()
  const [q, setQ] = useState("")
  const [debouncedQ, setDebouncedQ] = useState("")
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Debounce query 250ms.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250)
    return () => clearTimeout(t)
  }, [q])

  // Reset state saat dibuka/ditutup.
  useEffect(() => {
    if (open) {
      setQ("")
      setDebouncedQ("")
      setActiveIdx(0)
      // Focus async supaya animasi modal sempat mulai.
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  // Fetch hanya kalau ada query (efisien -- jangan blast endpoint
  // saat palette baru buka tanpa input).
  const enabled = open && debouncedQ.length >= 2
  const txQ = useTransactions(enabled ? { q: debouncedQ, size: 5 } : {})
  const invQ = useInvoices(enabled ? { q: debouncedQ, size: 5 } : {})
  const poQ = usePOs(enabled ? { q: debouncedQ, size: 5 } : {})
  const projQ = useProjects(enabled ? { q: debouncedQ, size: 5 } : {})

  // Build flat list of palette items (nav + entity hits) -- urutan
  // ini juga keyboard nav order.
  const items = useMemo<PaletteItem[]>(() => {
    const trimmed = debouncedQ.toLowerCase()
    const navMatched = trimmed
      ? NAV_ITEMS.filter((n) => n.label.toLowerCase().includes(trimmed))
      : NAV_ITEMS

    const navResult = navMatched.slice(0, trimmed ? 6 : NAV_ITEMS.length)

    if (!enabled) {
      return navResult
    }

    const txItems: PaletteItem[] = (txQ.data?.items ?? []).slice(0, 5).map((t) => ({
      id: `tx-${t.id}`,
      label: `#${t.id} · ${t.party_name || t.description || "-"}`,
      hint: `${t.type === "IN" ? "Masuk" : "Keluar"} · Rp ${fmtCompact(t.amount)}`,
      icon: ArrowLeftRight,
      group: "Transaksi",
      to: `/transactions?id=${t.id}`,
    }))

    const invItems: PaletteItem[] = (invQ.data?.items ?? []).slice(0, 5).map((i) => ({
      id: `inv-${i.id}`,
      label: `${i.number} · ${i.party_name ?? "-"}`,
      hint: `${i.type === "IN" ? "Hutang" : "Piutang"} · ${i.status}`,
      icon: Receipt,
      group: "Invoice",
      to: `/invoices?id=${i.id}`,
    }))

    const poItems: PaletteItem[] = (poQ.data?.items ?? []).slice(0, 5).map((p) => ({
      id: `po-${p.id}`,
      label: `${p.number} · ${p.vendor_name ?? "-"}`,
      hint: p.status,
      icon: ShoppingCart,
      group: "Purchase Order",
      to: `/purchase-orders?id=${p.id}`,
    }))

    const projItems: PaletteItem[] = (projQ.data?.items ?? []).slice(0, 5).map((p) => ({
      id: `proj-${p.id}`,
      label: `${p.name}`,
      hint: p.code,
      icon: FolderKanban,
      group: "Proyek",
      to: `/projects/${p.id}`,
    }))

    return [...navResult, ...txItems, ...invItems, ...poItems, ...projItems]
  }, [debouncedQ, enabled, txQ.data, invQ.data, poQ.data, projQ.data])

  // Clamp activeIdx saat items berubah.
  useEffect(() => {
    if (activeIdx >= items.length) setActiveIdx(Math.max(0, items.length - 1))
  }, [items.length, activeIdx])

  // Group items utk render section header.
  const grouped = useMemo(() => {
    const g: Record<string, PaletteItem[]> = {}
    items.forEach((it) => {
      ;(g[it.group] ??= []).push(it)
    })
    return Object.entries(g)
  }, [items])

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (items.length === 0) return
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActiveIdx((i) => (i + 1) % items.length)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActiveIdx((i) => (i - 1 + items.length) % items.length)
    } else if (e.key === "Enter") {
      e.preventDefault()
      const it = items[activeIdx]
      if (it) {
        navigate(it.to)
        onClose()
      }
    }
  }

  if (!open) return null

  const isLoading = enabled && (txQ.isFetching || invQ.isFetching || poQ.isFetching || projQ.isFetching)

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink-900/40 backdrop-blur-sm pt-16 sm:pt-24 px-3"
      onClick={onClose}
      role="dialog"
      aria-label="Command palette"
    >
      <div
        className="w-full max-w-xl rounded-lg border bg-surface shadow-2xl overflow-hidden flex flex-col max-h-[70vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-2 px-3 py-3 border-b">
          <Search className="h-4 w-4 text-ink-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setActiveIdx(0)
            }}
            onKeyDown={handleKey}
            placeholder="Cari halaman, transaksi, invoice, PO, proyek… (Ctrl+K)"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-ink-400"
            autoComplete="off"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              aria-label="Hapus query"
              className="flex h-6 w-6 items-center justify-center rounded text-ink-400 hover:bg-ink-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Result */}
        <div className="flex-1 overflow-y-auto py-1">
          {items.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-ink-500">
              {debouncedQ.length < 2
                ? "Mulai ketik untuk cari."
                : isLoading
                  ? "Memuat hasil…"
                  : "Tidak ada hasil."}
            </div>
          ) : (
            grouped.map(([groupName, groupItems]) => (
              <div key={groupName}>
                <div className="sticky top-0 bg-surface px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider font-semibold text-ink-500">
                  {groupName}
                </div>
                <ul>
                  {groupItems.map((it) => {
                    const idx = items.indexOf(it)
                    const active = idx === activeIdx
                    const Icon = it.icon
                    return (
                      <li key={it.id}>
                        <button
                          type="button"
                          onClick={() => {
                            navigate(it.to)
                            onClose()
                          }}
                          onMouseEnter={() => setActiveIdx(idx)}
                          className={cn(
                            "flex w-full items-center gap-2.5 px-3 py-2 text-left",
                            active ? "bg-brand-50 text-brand-800" : "hover:bg-ink-50 text-ink-800",
                          )}
                        >
                          <Icon
                            className={cn(
                              "h-4 w-4 shrink-0",
                              active ? "text-brand-600" : "text-ink-400",
                            )}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-medium truncate">{it.label}</div>
                            {it.hint && (
                              <div
                                className={cn(
                                  "text-[11px] truncate",
                                  active ? "text-brand-700/80" : "text-ink-500",
                                )}
                              >
                                {it.hint}
                              </div>
                            )}
                          </div>
                          {active && (
                            <ArrowRight className="h-3.5 w-3.5 text-brand-500 shrink-0" />
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="border-t bg-surface-muted/40 px-3 py-1.5 text-[10px] text-ink-500 flex items-center justify-between gap-3">
          <span>
            <kbd className="rounded border bg-surface px-1 font-mono text-[10px]">↑↓</kbd>{" "}
            navigasi ·{" "}
            <kbd className="rounded border bg-surface px-1 font-mono text-[10px]">Enter</kbd>{" "}
            buka ·{" "}
            <kbd className="rounded border bg-surface px-1 font-mono text-[10px]">Esc</kbd>{" "}
            tutup
          </span>
          <span>{items.length} hasil</span>
        </div>
      </div>
    </div>
  )
}
