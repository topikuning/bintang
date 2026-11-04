import type { UserRole } from "@/generated/prisma/enums";

/**
 * Otorisasi berbasis CAPABILITY (konsep MARLIN). Peran hanyalah kumpulan
 * capability; kode memeriksa capability, bukan nama peran.
 *
 * Frontend hanya menyembunyikan menu/tombol. Setiap server action & route
 * handler WAJIB memeriksa lagi lewat `requireCapability` + cek akses proyek.
 */
export const CAPABILITIES = [
  "dashboard.view",
  "project.view",
  "project.manage",
  /** Membuat & mengajukan pengajuan pembayaran (miliknya sendiri). */
  "request.create",
  /** Melihat pengajuan ORANG LAIN di proyek yang bisa diakses. Tanpa ini: hanya miliknya. */
  "request.view_project",
  "request.approve",
  /** Menyetujui di atas batas Keuangan (Pengaturan → batas persetujuan). */
  "request.approve_any_amount",
  "request.pay",
  "request.verify_lpj",
  "tx.view",
  "tx.create",
  "tx.verify",
  /** Menambah vendor/penerima baru langsung dari form pengajuan. */
  "party.create",
  "master.manage",
  "report.view",
  "user.manage",
  "audit.view",
  "settings.manage",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const ALL = new Set<Capability>(CAPABILITIES);

const MATRIX: Record<UserRole, ReadonlySet<Capability>> = {
  super_admin: ALL,
  director: new Set<Capability>([
    "dashboard.view",
    "project.view",
    "project.manage",
    "request.create",
    "request.view_project",
    "request.approve",
    "request.approve_any_amount",
    "tx.view",
    "party.create",
    "report.view",
    "audit.view",
  ]),
  finance: new Set<Capability>([
    "dashboard.view",
    "project.view",
    "project.manage",
    "request.create",
    "request.view_project",
    "request.approve",
    "request.pay",
    "request.verify_lpj",
    "tx.view",
    "tx.create",
    "tx.verify",
    "party.create",
    "master.manage",
    "report.view",
  ]),
  project_admin: new Set<Capability>([
    "dashboard.view",
    "project.view",
    "request.create",
    "request.view_project",
    "tx.view",
    "tx.create",
    "party.create",
    "report.view",
  ]),
  staff: new Set<Capability>(["dashboard.view", "project.view", "request.create", "party.create"]),
  viewer: new Set<Capability>([
    "dashboard.view",
    "project.view",
    "request.view_project",
    "tx.view",
    "report.view",
  ]),
};

export function can(role: UserRole, capability: Capability): boolean {
  return MATRIX[role].has(capability);
}

/** Peran yang otomatis melihat SEMUA proyek (bukan hanya yang ditugaskan). */
const CROSS_PROJECT: ReadonlySet<UserRole> = new Set(["super_admin", "director", "finance"]);

export function isCrossProject(role: UserRole, allProjects = false): boolean {
  return CROSS_PROJECT.has(role) || allProjects;
}

export const ROLE_LABEL: Record<UserRole, string> = {
  super_admin: "Admin Sistem",
  director: "Pimpinan",
  finance: "Keuangan",
  project_admin: "Admin Proyek",
  staff: "Staf",
  viewer: "Pengamat",
};

export const ROLE_DESCRIPTION: Record<UserRole, string> = {
  super_admin: "Semua wewenang, termasuk pengguna dan pengaturan.",
  director: "Menyetujui pengajuan berapa pun nilainya dan melihat semua proyek.",
  finance: "Menyetujui, membayar, mencatat kas, dan mengelola data master.",
  project_admin: "Mengajukan dan mencatat kas di proyek yang ditugaskan.",
  staff: "Mengajukan pembayaran dan memantau pengajuannya sendiri.",
  viewer: "Hanya melihat dasbor, buku kas, dan laporan.",
};

export const ROLES: UserRole[] = ["super_admin", "director", "finance", "project_admin", "staff", "viewer"];
