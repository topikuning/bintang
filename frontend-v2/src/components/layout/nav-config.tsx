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
  Database,
  FolderKanban,
  History,
  Home,
  type LucideIcon,
  MoreHorizontal,
  Receipt,
  ScanLine,
  Settings,
  ShoppingCart,
  Tag,
  Users,
} from "lucide-react"

export interface NavItem {
  label: string
  to: string
  icon: LucideIcon
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
      { label: "Dashboard", to: "/dashboard", icon: Home },
      { label: "Proyek", to: "/projects", icon: FolderKanban },
    ],
  },
  {
    label: "Operasional",
    items: [
      { label: "Transaksi", to: "/transactions", icon: ArrowLeftRight },
      { label: "Invoice", to: "/invoices", icon: Receipt },
      { label: "Purchase Order", to: "/purchase-orders", icon: ShoppingCart },
      { label: "Budget", to: "/budget", icon: BadgeDollarSign },
    ],
  },
  {
    label: "Laporan",
    items: [
      { label: "Laporan", to: "/reports", icon: BarChart3 },
      { label: "Audit Log", to: "/audit-log", icon: History },
    ],
  },
  {
    label: "Master Data",
    items: [
      { label: "Proyek", to: "/master/projects", icon: FolderKanban },
      { label: "Perusahaan", to: "/master/companies", icon: Building2 },
      { label: "Kategori", to: "/master/categories", icon: Tag },
      { label: "Vendor / Klien", to: "/master/vendors-clients", icon: ClipboardList },
      { label: "Pengguna", to: "/master/users", icon: Users },
    ],
  },
  {
    label: "Sistem",
    items: [
      { label: "Import Data", to: "/imports", icon: Database },
      { label: "Asisten OCR", to: "/ocr", icon: ScanLine },
      { label: "Pengaturan", to: "/settings", icon: Settings },
    ],
  },
]

/** Bottom nav mobile -- max 5 item utama, sisanya di /more. */
export const MOBILE_BOTTOM_NAV: NavItem[] = [
  { label: "Beranda", to: "/dashboard", icon: Home },
  { label: "Proyek", to: "/projects", icon: FolderKanban },
  { label: "Transaksi", to: "/transactions", icon: ArrowLeftRight },
  { label: "Invoice", to: "/invoices", icon: Receipt },
  { label: "Lainnya", to: "/more", icon: MoreHorizontal },
]

/** Halaman yang muncul di mobile /more. */
export const MOBILE_MORE_NAV: NavGroup[] = [
  {
    label: "Operasional",
    items: [
      { label: "Purchase Order", to: "/purchase-orders", icon: ShoppingCart },
      { label: "Budget", to: "/budget", icon: BadgeDollarSign },
    ],
  },
  {
    label: "Laporan",
    items: [
      { label: "Laporan", to: "/reports", icon: BarChart3 },
      { label: "Audit Log", to: "/audit-log", icon: History },
    ],
  },
  {
    label: "Master Data",
    items: [
      { label: "Proyek (CRUD)", to: "/master/projects", icon: FolderKanban },
      { label: "Perusahaan", to: "/master/companies", icon: Building2 },
      { label: "Kategori", to: "/master/categories", icon: Tag },
      { label: "Vendor / Klien", to: "/master/vendors-clients", icon: ClipboardList },
      { label: "Pengguna", to: "/master/users", icon: Users },
    ],
  },
  {
    label: "Sistem",
    items: [
      { label: "Import Data", to: "/imports", icon: Database },
      { label: "Asisten OCR", to: "/ocr", icon: ScanLine },
      { label: "Pengaturan", to: "/settings", icon: Settings },
    ],
  },
]

/** Tablet pakai semua item desktop, di-render sebagai rail icon-only. */
export const TABLET_NAV: NavItem[] = DESKTOP_NAV.flatMap((g) => g.items)
