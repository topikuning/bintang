/**
 * Definisi navigasi sekali, dipakai oleh Sidebar (desktop), NavRail
 * (tablet), dan BottomNav (mobile).
 */
import {
  ArrowLeftRight,
  BadgeDollarSign,
  BarChart3,
  Building2,
  ClipboardList,
  Coins,
  Database,
  FolderKanban,
  History,
  Home,
  KeyRound,
  type LucideIcon,
  MoreHorizontal,
  Receipt,
  ScanLine,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Tag,
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
    label: "Beranda",
    items: [
      { id: "dashboard", label: "Dashboard", to: "/dashboard", icon: Home },
      { id: "projects", label: "Proyek", to: "/projects", icon: FolderKanban },
    ],
  },
  {
    label: "Operasional",
    items: [
      { id: "transactions", label: "Transaksi", to: "/transactions", icon: ArrowLeftRight },
      { id: "cash-advances", label: "Dana Operasional", to: "/transactions/cash-advances", icon: Wallet },
      { id: "invoices", label: "Invoice", to: "/invoices", icon: Receipt },
      { id: "purchase-orders", label: "Purchase Order", to: "/purchase-orders", icon: ShoppingCart },
      { id: "budget", label: "Budget", to: "/budget", icon: BadgeDollarSign },
    ],
  },
  {
    label: "Laporan",
    items: [
      { id: "reports", label: "Laporan", to: "/reports", icon: BarChart3 },
      { id: "reports-invoice-items", label: "Detail Invoice", to: "/reports/invoice-items", icon: Receipt },
      { id: "audit-log", label: "Audit Log", to: "/audit-log", icon: History },
    ],
  },
  {
    label: "Master Data",
    items: [
      { id: "master-projects", label: "Proyek", to: "/master/projects", icon: FolderKanban },
      { id: "master-companies", label: "Perusahaan", to: "/master/companies", icon: Building2 },
      { id: "master-categories", label: "Kategori", to: "/master/categories", icon: Tag },
      { id: "master-vendors-clients", label: "Vendor / Klien", to: "/master/vendors-clients", icon: ClipboardList },
      { id: "master-funders", label: "Pendana", to: "/master/funders", icon: Coins },
      { id: "master-users", label: "Pengguna", to: "/master/users", icon: Users },
    ],
  },
  {
    label: "Sistem",
    items: [
      { id: "imports", label: "Import Data", to: "/imports", icon: Database },
      { id: "ocr", label: "Asisten OCR", to: "/ocr", icon: ScanLine },
      { id: "settings", label: "Pengaturan", to: "/settings", icon: Settings },
      { id: "settings-system", label: "Sistem (API Keys)", to: "/settings/system", icon: KeyRound },
      { id: "settings-role-menus", label: "Akses Menu per Role", to: "/settings/role-menus", icon: ShieldCheck },
    ],
  },
]

/** Bottom nav mobile -- max 5 item utama, sisanya di /more. */
export const MOBILE_BOTTOM_NAV: NavItem[] = [
  { id: "dashboard", label: "Beranda", to: "/dashboard", icon: Home },
  { id: "projects", label: "Proyek", to: "/projects", icon: FolderKanban },
  { id: "transactions", label: "Transaksi", to: "/transactions", icon: ArrowLeftRight },
  { id: "invoices", label: "Invoice", to: "/invoices", icon: Receipt },
  { label: "Lainnya", to: "/more", icon: MoreHorizontal },
]

/** Halaman yang muncul di mobile /more. */
export const MOBILE_MORE_NAV: NavGroup[] = [
  {
    label: "Operasional",
    items: [
      { id: "purchase-orders", label: "Purchase Order", to: "/purchase-orders", icon: ShoppingCart },
      { id: "budget", label: "Budget", to: "/budget", icon: BadgeDollarSign },
    ],
  },
  {
    label: "Laporan",
    items: [
      { id: "reports", label: "Laporan", to: "/reports", icon: BarChart3 },
      { id: "reports-invoice-items", label: "Detail Invoice", to: "/reports/invoice-items", icon: Receipt },
      { id: "audit-log", label: "Audit Log", to: "/audit-log", icon: History },
    ],
  },
  {
    label: "Master Data",
    items: [
      { id: "master-projects", label: "Proyek (CRUD)", to: "/master/projects", icon: FolderKanban },
      { id: "master-companies", label: "Perusahaan", to: "/master/companies", icon: Building2 },
      { id: "master-categories", label: "Kategori", to: "/master/categories", icon: Tag },
      { id: "master-vendors-clients", label: "Vendor / Klien", to: "/master/vendors-clients", icon: ClipboardList },
      { id: "master-funders", label: "Pendana", to: "/master/funders", icon: Coins },
      { id: "master-users", label: "Pengguna", to: "/master/users", icon: Users },
    ],
  },
  {
    label: "Sistem",
    items: [
      { id: "imports", label: "Import Data", to: "/imports", icon: Database },
      { id: "ocr", label: "Asisten OCR", to: "/ocr", icon: ScanLine },
      { id: "settings", label: "Pengaturan", to: "/settings", icon: Settings },
      { id: "settings-system", label: "Sistem (API Keys)", to: "/settings/system", icon: KeyRound },
      { id: "settings-role-menus", label: "Akses Menu per Role", to: "/settings/role-menus", icon: ShieldCheck },
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
