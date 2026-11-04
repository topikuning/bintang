import type { UserRole } from "@/generated/prisma/enums";
import { can, type Capability } from "@/lib/authz";

/**
 * Navigasi – serializable (ikon = kunci string) supaya aman dioper dari
 * Server Component ke klien. Penyaringan capability terjadi DI SINI; shell
 * tidak tahu soal otorisasi.
 */

export type IconKey =
  | "home"
  | "send"
  | "wallet"
  | "folder"
  | "chart"
  | "database"
  | "users"
  | "settings"
  | "history";

export type NavItem = {
  label: string;
  href: string;
  icon: IconKey;
  group: "utama" | "kelola";
  capability?: Capability;
  anyCapability?: Capability[];
  /** Kunci lencana angka (diisi layout). */
  badge?: "tindakan";
};

export const MAIN_NAV: NavItem[] = [
  { label: "Beranda", href: "/", icon: "home", group: "utama" },
  {
    label: "Pengajuan",
    href: "/pengajuan",
    icon: "send",
    group: "utama",
    anyCapability: ["request.create", "request.view_project"],
    badge: "tindakan",
  },
  { label: "Buku Kas", href: "/transaksi", icon: "wallet", group: "utama", capability: "tx.view" },
  { label: "Proyek", href: "/proyek", icon: "folder", group: "utama", capability: "project.view" },
  { label: "Laporan", href: "/laporan", icon: "chart", group: "utama", capability: "report.view" },
  { label: "Data Master", href: "/master", icon: "database", group: "kelola", capability: "master.manage" },
  { label: "Pengguna", href: "/pengguna", icon: "users", group: "kelola", capability: "user.manage" },
  { label: "Pengaturan", href: "/pengaturan", icon: "settings", group: "kelola", capability: "settings.manage" },
  { label: "Jejak Audit", href: "/audit", icon: "history", group: "kelola", capability: "audit.view" },
];

function allowed(role: UserRole, item: NavItem) {
  if (item.anyCapability) return item.anyCapability.some((c) => can(role, c));
  return !item.capability || can(role, item.capability);
}

export function filterNav(role: UserRole): NavItem[] {
  return MAIN_NAV.filter((i) => allowed(role, i));
}

/**
 * Nav bawah ponsel: 4 pintasan + tombol "Ajukan" di tengah. Tombol tengah
 * disediakan BottomNav sendiri bila user boleh membuat pengajuan.
 */
export function mobileNav(role: UserRole): NavItem[] {
  const urut = can(role, "tx.view")
    ? ["/", "/pengajuan", "/transaksi", "/proyek"]
    : ["/", "/pengajuan", "/proyek", "/laporan"];
  const semua = filterNav(role);
  return urut.map((h) => semua.find((i) => i.href === h)).filter((x): x is NavItem => !!x);
}
