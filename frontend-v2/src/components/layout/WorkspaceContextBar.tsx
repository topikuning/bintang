import { Link, useLocation } from "react-router"
import { ChevronRight } from "lucide-react"
import { useMenuConfig } from "@/hooks/useMenuConfig"
import { cn } from "@/lib/utils"

interface WorkspaceTab {
  label: string
  to: string
  id?: string
}

interface WorkspaceDefinition {
  label: string
  description: string
  matches: string[]
  tabs: WorkspaceTab[]
}

/**
 * Information architecture layer shared by every authenticated route.
 *
 * The sidebar answers "which business workflow?" while this bar answers
 * "where am I inside that workflow?". This keeps related modules one click
 * apart without introducing hidden global filters or duplicating page actions.
 */
const WORKSPACES: WorkspaceDefinition[] = [
  {
    label: "Command Center",
    description: "Posisi kas, risiko, dan keputusan hari ini",
    matches: ["/dashboard", "/action-center"],
    tabs: [
      { id: "dashboard", label: "Posisi Keuangan", to: "/dashboard" },
      { id: "dashboard", label: "Pusat Tindakan", to: "/action-center" },
    ],
  },
  {
    label: "Arus Kas",
    description: "Uang masuk, uang keluar, dan kewajiban",
    matches: ["/transactions", "/invoices"],
    tabs: [
      { id: "transactions", label: "Transaksi", to: "/transactions" },
      { id: "cash-advances", label: "Dana Operasional", to: "/transactions/cash-advances" },
      { id: "invoices", label: "Invoice", to: "/invoices" },
    ],
  },
  {
    label: "Kendali Belanja",
    description: "Permintaan, komitmen, dan realisasi budget",
    matches: ["/cash-requests", "/purchase-orders", "/budget"],
    tabs: [
      { id: "cash-requests", label: "Pengajuan Dana", to: "/cash-requests" },
      { id: "purchase-orders", label: "Purchase Order", to: "/purchase-orders" },
      { id: "budget", label: "Budget vs Aktual", to: "/budget" },
    ],
  },
  {
    label: "Portofolio",
    description: "Kinerja dan tata kelola seluruh proyek",
    matches: ["/projects", "/non-project"],
    tabs: [
      { id: "projects", label: "Kesehatan Proyek", to: "/projects" },
      { id: "projects", label: "Persetujuan", to: "/projects/approval-queue" },
      { id: "non-project", label: "Non-Proyek", to: "/non-project" },
    ],
  },
  {
    label: "Analisis",
    description: "Pelaporan, rekonsiliasi, dan eksplorasi data",
    matches: ["/reports", "/spreadsheet"],
    tabs: [
      { id: "reports", label: "Laporan", to: "/reports" },
      { id: "reports-invoice-items", label: "Detail Invoice", to: "/reports/invoice-items" },
      { id: "spreadsheet", label: "Eksplorasi Data", to: "/spreadsheet" },
    ],
  },
  {
    label: "Otomasi & Kontrol",
    description: "Pemrosesan dokumen, kualitas data, dan audit",
    matches: ["/ocr", "/imports", "/admin", "/audit-log"],
    tabs: [
      { id: "ocr", label: "Inbox Dokumen", to: "/ocr" },
      { id: "imports", label: "Import", to: "/imports" },
      { id: "admin-bulk-approval", label: "Persetujuan Massal", to: "/admin/bulk-approval" },
      { id: "admin-category-audit", label: "Kualitas Data", to: "/admin/category-audit" },
      { id: "admin-bulk-invoice-categorize", label: "Auto-Kategori", to: "/admin/bulk-invoice-categorize" },
      { id: "audit-log", label: "Jejak Audit", to: "/audit-log" },
    ],
  },
  {
    label: "Organisasi",
    description: "Sumber data utama untuk operasional keuangan",
    matches: ["/master"],
    tabs: [
      { id: "master-projects", label: "Proyek", to: "/master/projects" },
      { id: "master-companies", label: "Perusahaan", to: "/master/companies" },
      { id: "master-categories", label: "Kategori", to: "/master/categories" },
      { id: "master-vendors-clients", label: "Vendor & Klien", to: "/master/vendors-clients" },
      { id: "master-users", label: "Pengguna", to: "/master/users" },
    ],
  },
  {
    label: "Sistem",
    description: "Profil, akses, integrasi, dan konfigurasi AI",
    matches: ["/settings"],
    tabs: [
      { id: "settings", label: "Profil", to: "/settings" },
      { id: "settings-system", label: "Provider", to: "/settings/system" },
      { id: "settings-role-menus", label: "Akses", to: "/settings/role-menus" },
      { id: "settings-non-project", label: "Non-Proyek", to: "/settings/non-project" },
      { id: "settings-ai-prompts", label: "Prompt AI", to: "/settings/ai-prompts" },
      { id: "settings-ai-features", label: "Fitur AI", to: "/settings/ai-features" },
      { id: "settings-orphan-files", label: "Penyimpanan", to: "/settings/orphan-files" },
    ],
  },
]

export function WorkspaceContextBar() {
  const { pathname } = useLocation()
  const cfgQ = useMenuConfig()
  const allowed = cfgQ.data ? new Set(cfgQ.data.menu_ids) : undefined
  const workspace = WORKSPACES.find((item) =>
    item.matches.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)),
  )

  if (!workspace) return null

  const tabs = workspace.tabs.filter((tab) => !allowed || !tab.id || allowed.has(tab.id))

  return (
    <div className="workspace-context border-b border-ink-200/80 bg-white/72 backdrop-blur-xl">
      <div className="mx-auto flex min-h-14 w-full max-w-[1680px] items-center gap-4 px-3 sm:px-6">
        <div className="hidden min-w-[180px] shrink-0 xl:block">
          <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-400">
            Ruang kerja <ChevronRight className="h-3 w-3" />
          </div>
          <p className="text-[13px] font-semibold text-ink-800">{workspace.label}</p>
        </div>

        <nav className="min-w-0 flex-1 overflow-x-auto" aria-label={`Navigasi ${workspace.label}`}>
          <ul className="flex min-w-max items-center gap-1 py-2">
            {tabs.map((tab) => {
              const isActive = isWorkspaceTabActive(pathname, tab.to)
              return (
              <li key={tab.to}>
                <Link
                  to={tab.to}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "inline-flex h-9 items-center rounded-lg px-3 text-[12px] font-medium transition-colors",
                    isActive
                      ? "bg-ink-900 text-white shadow-sm"
                      : "text-ink-500 hover:bg-ink-100 hover:text-ink-900",
                  )}
                >
                  {tab.label}
                </Link>
              </li>
              )
            })}
          </ul>
        </nav>

        <p className="hidden max-w-[260px] text-right text-[11px] leading-snug text-ink-400 2xl:block">
          {workspace.description}
        </p>
      </div>
    </div>
  )
}

function isWorkspaceTabActive(pathname: string, to: string): boolean {
  if (pathname === to) return true
  if (to === "/projects") {
    return pathname.startsWith("/projects/") && pathname !== "/projects/approval-queue"
  }
  if (to === "/cash-requests") return pathname.startsWith("/cash-requests/")
  if (to === "/master/projects") return pathname.startsWith("/master/projects/")
  return false
}
