/**
 * Definisi navigasi sekali, dipakai oleh Sidebar (desktop), NavRail
 * (tablet), dan BottomNav (mobile).
 *
 * Information architecture 2026-09-04: modules are grouped by the
 * financial decision they support instead of their technical entity type.
 */
import {
  ArrowLeftRight,
  BadgeDollarSign,
  BarChart3,
  Building2,
  CheckCheck,
  CircleGauge,
  ClipboardList,
  Database,
  FileText,
  FolderKanban,
  HardDrive,
  History,
  Home,
  KeyRound,
  type LucideIcon,
  MoreHorizontal,
  ListTodo,
  Notebook,
  Receipt,
  FileSpreadsheet,
  ScanLine,
  Settings,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  Tag,
  UserCircle,
  Users,
  Wallet,
} from "lucide-react"

export interface NavItem {
  label: string
  to: string
  icon: LucideIcon
  /** Menu ID utk policy SUPERADMIN. Selalu visible kalau undefined
   *  (mis. /more aggregator, /dashboard). Cocokkan dgn MENU_REGISTRY
   *  di backend services/menu_policy.py. */
  id?: string
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

/** Sidebar desktop -- menu lengkap, dikelompokkan. */
export const DESKTOP_NAV: NavGroup[] = [
  {
    label: "Command Center",
    items: [
      { id: "dashboard", label: "Posisi Keuangan", to: "/dashboard", icon: CircleGauge },
      { id: "dashboard", label: "Pusat Tindakan", to: "/action-center", icon: ListTodo },
    ],
  },
  {
    label: "Arus Kas",
    items: [
      { id: "transactions", label: "Transaksi", to: "/transactions", icon: ArrowLeftRight },
      { id: "cash-advances", label: "Dana Operasional", to: "/transactions/cash-advances", icon: Wallet },
      { id: "invoices", label: "Invoice", to: "/invoices", icon: Receipt },
    ],
  },
  {
    label: "Kendali Belanja",
    items: [
      { id: "cash-requests", label: "Pengajuan Dana", to: "/cash-requests", icon: FileText },
      { id: "purchase-orders", label: "Purchase Order", to: "/purchase-orders", icon: ShoppingCart },
      { id: "budget", label: "Budget vs Aktual", to: "/budget", icon: BadgeDollarSign },
    ],
  },
  {
    label: "Portofolio",
    items: [
      { id: "projects", label: "Kesehatan Proyek", to: "/projects", icon: FolderKanban },
      { id: "projects", label: "Persetujuan Proyek", to: "/projects/approval-queue", icon: CheckCheck },
      { id: "non-project", label: "Catatan Non-Proyek", to: "/non-project", icon: Notebook },
    ],
  },
  {
    label: "Analisis",
    items: [
      { id: "reports", label: "Laporan", to: "/reports", icon: BarChart3 },
      { id: "reports-invoice-items", label: "Detail Invoice", to: "/reports/invoice-items", icon: Receipt },
      { id: "spreadsheet", label: "Eksplorasi Data", to: "/spreadsheet", icon: FileSpreadsheet },
    ],
  },
  {
    label: "Otomasi & Kontrol",
    items: [
      { id: "ocr", label: "Inbox Dokumen", to: "/ocr", icon: ScanLine },
      { id: "imports", label: "Import Data", to: "/imports", icon: Database },
      { id: "admin-bulk-approval", label: "Persetujuan Massal", to: "/admin/bulk-approval", icon: CheckCheck },
      { id: "admin-category-audit", label: "Audit Kategorisasi", to: "/admin/category-audit", icon: Tag },
      { id: "admin-bulk-invoice-categorize", label: "Auto-Kategori Invoice", to: "/admin/bulk-invoice-categorize", icon: Sparkles },
      { id: "audit-log", label: "Jejak Audit", to: "/audit-log", icon: History },
    ],
  },
  {
    label: "Organisasi",
    items: [
      { id: "master-projects", label: "Proyek", to: "/master/projects", icon: FolderKanban },
      { id: "master-companies", label: "Perusahaan", to: "/master/companies", icon: Building2 },
      { id: "master-categories", label: "Kategori", to: "/master/categories", icon: Tag },
      { id: "master-vendors-clients", label: "Vendor / Klien", to: "/master/vendors-clients", icon: ClipboardList },
      // NOTE: "Pendana" merged ke User EXECUTIVE -- gunakan shortcut filter
      // di Master Pengguna (?role=EXECUTIVE).
      { id: "master-users", label: "Pengguna", to: "/master/users", icon: Users },
    ],
  },
  {
    label: "Sistem",
    items: [
      { id: "settings", label: "Profil Saya", to: "/settings", icon: UserCircle },
      { id: "settings-system", label: "API Keys & Provider", to: "/settings/system", icon: KeyRound },
      { id: "settings-role-menus", label: "Akses Menu per Role", to: "/settings/role-menus", icon: ShieldCheck },
      { id: "settings-non-project", label: "Inklusi Catatan Non-Proyek", to: "/settings/non-project", icon: SlidersHorizontal },
      { id: "settings-ai-prompts", label: "Prompt AI", to: "/settings/ai-prompts", icon: Sparkles },
      { id: "settings-ai-features", label: "Setting AI per Fitur", to: "/settings/ai-features", icon: Settings },
      { id: "settings-orphan-files", label: "File Orphan", to: "/settings/orphan-files", icon: HardDrive },
    ],
  },
]

/** Bottom nav mobile -- max 5 item utama, sisanya di /more. */
export const MOBILE_BOTTOM_NAV: NavItem[] = [
  { id: "dashboard", label: "Beranda", to: "/dashboard", icon: Home },
  { id: "dashboard", label: "Tindakan", to: "/action-center", icon: ListTodo },
  { id: "projects", label: "Proyek", to: "/projects", icon: FolderKanban },
  { id: "transactions", label: "Transaksi", to: "/transactions", icon: ArrowLeftRight },
  { label: "Lainnya", to: "/more", icon: MoreHorizontal },
]

/** Halaman yang muncul di mobile /more. Mirror struktur DESKTOP_NAV
 *  kecuali item yg sudah ada di bottom nav (dashboard, projects,
 *  transactions, invoices). */
export const MOBILE_MORE_NAV: NavGroup[] = [
  {
    label: "Arus Kas",
    items: [
      { id: "cash-advances", label: "Dana Operasional", to: "/transactions/cash-advances", icon: Wallet },
      { id: "invoices", label: "Invoice", to: "/invoices", icon: Receipt },
    ],
  },
  {
    label: "Kendali Belanja",
    items: [
      { id: "cash-requests", label: "Pengajuan Dana", to: "/cash-requests", icon: FileText },
      { id: "purchase-orders", label: "Purchase Order", to: "/purchase-orders", icon: ShoppingCart },
      { id: "budget", label: "Budget vs Aktual", to: "/budget", icon: BadgeDollarSign },
    ],
  },
  {
    label: "Portofolio",
    items: [
      { id: "projects", label: "Persetujuan Proyek", to: "/projects/approval-queue", icon: CheckCheck },
      { id: "non-project", label: "Catatan Non-Proyek", to: "/non-project", icon: Notebook },
    ],
  },
  {
    label: "Analisis",
    items: [
      { id: "reports", label: "Laporan", to: "/reports", icon: BarChart3 },
      { id: "reports-invoice-items", label: "Detail Invoice", to: "/reports/invoice-items", icon: Receipt },
      { id: "spreadsheet", label: "Eksplorasi Data", to: "/spreadsheet", icon: FileSpreadsheet },
    ],
  },
  {
    label: "Otomasi & Kontrol",
    items: [
      { id: "ocr", label: "Inbox Dokumen", to: "/ocr", icon: ScanLine },
      { id: "imports", label: "Import Data", to: "/imports", icon: Database },
      { id: "admin-bulk-approval", label: "Persetujuan Massal", to: "/admin/bulk-approval", icon: CheckCheck },
      { id: "admin-category-audit", label: "Audit Kategorisasi", to: "/admin/category-audit", icon: Tag },
      { id: "admin-bulk-invoice-categorize", label: "Auto-Kategori Invoice", to: "/admin/bulk-invoice-categorize", icon: Sparkles },
      { id: "audit-log", label: "Jejak Audit", to: "/audit-log", icon: History },
    ],
  },
  {
    label: "Organisasi",
    items: [
      { id: "master-projects", label: "Proyek (CRUD)", to: "/master/projects", icon: FolderKanban },
      { id: "master-companies", label: "Perusahaan", to: "/master/companies", icon: Building2 },
      { id: "master-categories", label: "Kategori", to: "/master/categories", icon: Tag },
      { id: "master-vendors-clients", label: "Vendor / Klien", to: "/master/vendors-clients", icon: ClipboardList },
      // NOTE: "Pendana" merged ke User EXECUTIVE -- gunakan shortcut filter
      // di Master Pengguna (?role=EXECUTIVE).
      { id: "master-users", label: "Pengguna", to: "/master/users", icon: Users },
    ],
  },
  {
    label: "Sistem",
    items: [
      { id: "settings", label: "Profil Saya", to: "/settings", icon: UserCircle },
      { id: "settings-system", label: "API Keys & Provider", to: "/settings/system", icon: KeyRound },
      { id: "settings-role-menus", label: "Akses Menu per Role", to: "/settings/role-menus", icon: ShieldCheck },
      { id: "settings-non-project", label: "Inklusi Catatan Non-Proyek", to: "/settings/non-project", icon: SlidersHorizontal },
      { id: "settings-ai-prompts", label: "Prompt AI", to: "/settings/ai-prompts", icon: Sparkles },
      { id: "settings-ai-features", label: "Setting AI per Fitur", to: "/settings/ai-features", icon: Settings },
      { id: "settings-orphan-files", label: "File Orphan", to: "/settings/orphan-files", icon: HardDrive },
    ],
  },
]

/** Filter NavGroup[] berdasarkan list menu IDs yg user boleh lihat.
 *  Item tanpa `id` -> selalu visible (mis. Lainnya aggregator). */
export function filterNavGroups(
  groups: NavGroup[],
  allowedIds: Set<string> | undefined,
): NavGroup[] {
  if (!allowedIds) return groups
  return groups
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => !i.id || allowedIds.has(i.id)),
    }))
    .filter((g) => g.items.length > 0)
}

export function filterNavItems(
  items: NavItem[],
  allowedIds: Set<string> | undefined,
): NavItem[] {
  if (!allowedIds) return items
  return items.filter((i) => !i.id || allowedIds.has(i.id))
}

/** Tablet pakai semua item desktop, di-render sebagai rail icon-only. */
export const TABLET_NAV: NavItem[] = DESKTOP_NAV.flatMap((g) => g.items)
