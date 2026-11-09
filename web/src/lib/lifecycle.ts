import type {
  ProjectStatus,
  RequestKind,
  RequestStatus,
  TransactionKind,
  TransactionStatus,
} from "@/generated/prisma/enums";

/**
 * Mesin transisi status (konsep MARLIN). MURNI – dipakai server action untuk
 * validasi, dipakai UI untuk label/warna, dan diuji unit.
 *
 * Status HANYA berubah lewat `assertRequestTransition` + riwayat ditulis.
 */

export type Tone = "neutral" | "info" | "warning" | "success" | "danger";

// ─── Pengajuan ───────────────────────────────────────────────

const REQUEST_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  draft: ["diajukan"],
  diajukan: ["disetujui", "perlu_revisi", "ditolak", "dibatalkan"],
  perlu_revisi: ["diajukan", "dibatalkan"],
  // Keuangan boleh mengembalikan pengajuan yang sudah disetujui bila data
  // penerima/rekening ternyata salah – wajib disetujui ulang.
  disetujui: ["dibayar", "perlu_revisi", "dibatalkan"],
  // dibayar → disetujui = pembayaran dibatalkan (salah catat), transaksi kasnya
  // ikut dibatalkan. Hanya sebelum LPJ.
  dibayar: ["lpj_diajukan", "disetujui"],
  // LPJ dikembalikan = kembali ke dibayar (uang muka masih dipegang).
  lpj_diajukan: ["selesai", "dibayar"],
  selesai: [],
  ditolak: [],
  dibatalkan: [],
};

export function canTransitionRequest(from: RequestStatus, to: RequestStatus): boolean {
  return REQUEST_TRANSITIONS[from].includes(to);
}

export class TransitionError extends Error {}

export function assertRequestTransition(from: RequestStatus, to: RequestStatus, kind?: RequestKind): void {
  if (!canTransitionRequest(from, to)) {
    throw new TransitionError(
      `Pengajuan berstatus "${REQUEST_STATUS_LABEL[from]}" tidak bisa diubah menjadi "${REQUEST_STATUS_LABEL[to]}".`,
    );
  }
  if (to === "lpj_diajukan" && kind && kind !== "uang_muka") {
    throw new TransitionError("LPJ hanya untuk pengajuan uang muka.");
  }
}

/** Status yang masih bisa diedit isinya oleh pemohon. */
export const EDITABLE_REQUEST_STATUSES: readonly RequestStatus[] = ["draft", "perlu_revisi"];

/** Status yang dianggap "selesai" untuk alur – tidak ada lagi yang perlu dikerjakan. */
export function isRequestClosed(status: RequestStatus, kind: RequestKind): boolean {
  if (status === "selesai" || status === "ditolak" || status === "dibatalkan") return true;
  return status === "dibayar" && kind !== "uang_muka";
}

/** Status yang masih "menunggu" uang keluar (komitmen). */
export const COMMITTED_REQUEST_STATUSES: readonly RequestStatus[] = ["diajukan", "disetujui"];

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  draft: "Draf",
  diajukan: "Menunggu persetujuan",
  perlu_revisi: "Perlu revisi",
  disetujui: "Disetujui – siap dibayar",
  dibayar: "Dibayar",
  lpj_diajukan: "LPJ diperiksa",
  selesai: "Selesai",
  ditolak: "Ditolak",
  dibatalkan: "Dibatalkan",
};

/** Label pendek untuk pill di daftar. */
export const REQUEST_STATUS_SHORT: Record<RequestStatus, string> = {
  draft: "Draf",
  diajukan: "Menunggu",
  perlu_revisi: "Revisi",
  disetujui: "Disetujui",
  dibayar: "Dibayar",
  lpj_diajukan: "LPJ",
  selesai: "Selesai",
  ditolak: "Ditolak",
  dibatalkan: "Batal",
};

export const REQUEST_STATUS_TONE: Record<RequestStatus, Tone> = {
  draft: "neutral",
  diajukan: "warning",
  perlu_revisi: "danger",
  disetujui: "info",
  dibayar: "success",
  lpj_diajukan: "warning",
  selesai: "success",
  ditolak: "danger",
  dibatalkan: "neutral",
};

/** Label status yang sadar jenis: uang muka yang sudah dibayar masih menunggu LPJ. */
export function requestStatusLabel(status: RequestStatus, kind: RequestKind, short = false): string {
  if (status === "dibayar" && kind === "uang_muka") return short ? "Tunggu LPJ" : "Dibayar – menunggu LPJ";
  return (short ? REQUEST_STATUS_SHORT : REQUEST_STATUS_LABEL)[status];
}

export function requestStatusTone(status: RequestStatus, kind: RequestKind): Tone {
  if (status === "dibayar" && kind === "uang_muka") return "info";
  return REQUEST_STATUS_TONE[status];
}

export const REQUEST_KIND_LABEL: Record<RequestKind, string> = {
  pembayaran: "Pembayaran",
  uang_muka: "Uang muka",
  penggantian: "Penggantian (reimburse)",
};

export const REQUEST_KIND_HINT: Record<RequestKind, string> = {
  pembayaran: "Bayar langsung ke vendor, tukang, atau tagihan.",
  uang_muka: "Dana dipegang dulu, nanti dipertanggungjawabkan dengan nota.",
  penggantian: "Anda sudah membayar pakai uang sendiri, minta diganti.",
};

/**
 * Langkah-langkah alur untuk penanda kemajuan (stepper) di layar detail.
 * Uang muka punya langkah tambahan LPJ.
 */
export function requestSteps(kind: RequestKind): { key: string; label: string }[] {
  const base = [
    { key: "diajukan", label: "Diajukan" },
    { key: "disetujui", label: "Disetujui" },
    { key: "dibayar", label: "Dibayar" },
  ];
  return kind === "uang_muka" ? [...base, { key: "selesai", label: "LPJ selesai" }] : base;
}

/** Indeks langkah yang SUDAH tercapai (−1 = belum diajukan). */
export function requestStepIndex(status: RequestStatus): number {
  switch (status) {
    case "draft":
    case "perlu_revisi":
      return -1;
    case "diajukan":
      return 0;
    case "disetujui":
      return 1;
    case "dibayar":
    case "lpj_diajukan":
      return 2;
    case "selesai":
      return 3;
    default:
      return -1;
  }
}

// ─── Transaksi ───────────────────────────────────────────────

const TX_TRANSITIONS: Record<TransactionStatus, TransactionStatus[]> = {
  menunggu_verifikasi: ["terverifikasi", "ditolak", "dibatalkan"],
  terverifikasi: ["dibatalkan"],
  ditolak: [],
  dibatalkan: [],
};

export function canTransitionTx(from: TransactionStatus, to: TransactionStatus): boolean {
  return TX_TRANSITIONS[from].includes(to);
}

export function assertTxTransition(from: TransactionStatus, to: TransactionStatus): void {
  if (!canTransitionTx(from, to)) {
    throw new TransitionError(
      `Transaksi berstatus "${TX_STATUS_LABEL[from]}" tidak bisa diubah menjadi "${TX_STATUS_LABEL[to]}".`,
    );
  }
}

export const TX_STATUS_LABEL: Record<TransactionStatus, string> = {
  menunggu_verifikasi: "Menunggu verifikasi",
  terverifikasi: "Terverifikasi",
  ditolak: "Ditolak",
  dibatalkan: "Dibatalkan",
};

export const TX_STATUS_TONE: Record<TransactionStatus, Tone> = {
  menunggu_verifikasi: "warning",
  terverifikasi: "success",
  ditolak: "danger",
  dibatalkan: "neutral",
};

export const TX_KIND_LABEL: Record<TransactionKind, string> = {
  pemasukan: "Pemasukan",
  pengeluaran: "Pengeluaran",
  uang_muka: "Uang muka",
  pengembalian_uang_muka: "Pengembalian uang muka",
  realisasi_uang_muka: "Realisasi uang muka",
};

/** Arah kas: +1 masuk, −1 keluar, 0 tidak menggerakkan kas. */
export const TX_CASH_SIGN: Record<TransactionKind, 1 | -1 | 0> = {
  pemasukan: 1,
  pengeluaran: -1,
  uang_muka: -1,
  pengembalian_uang_muka: 1,
  realisasi_uang_muka: 0,
};

// ─── Proyek ──────────────────────────────────────────────────

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  aktif: "Aktif",
  ditahan: "Ditahan",
  selesai: "Selesai",
  batal: "Batal",
};

export const PROJECT_STATUS_TONE: Record<ProjectStatus, Tone> = {
  aktif: "success",
  ditahan: "warning",
  selesai: "info",
  batal: "neutral",
};
