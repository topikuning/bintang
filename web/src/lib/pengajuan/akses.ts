import type { RequestKind, RequestStatus, UserRole } from "@/generated/prisma/enums";
import { can } from "@/lib/authz";
import { rupiah } from "@/lib/uang";

/**
 * Aturan "siapa boleh apa" untuk SATU pengajuan. MURNI: dipakai layar untuk
 * memutuskan tombol mana yang tampil, dan dipakai service untuk menegakkannya.
 * Jadi tombol yang tampil = aksi yang akan diterima server, tidak lebih.
 *
 * Akses proyek TIDAK diperiksa di sini (butuh DB) – pemanggil wajib sudah
 * memastikannya.
 */

export type Aktor = { id: string; role: UserRole };
export type PengajuanRingkas = {
  status: RequestStatus;
  kind: RequestKind;
  requesterId: string;
  total: bigint;
};
export type Keputusan = { boleh: true } | { boleh: false; alasan: string };

const YA: Keputusan = { boleh: true };
const tidak = (alasan: string): Keputusan => ({ boleh: false, alasan });

function pemohon(a: Aktor, p: PengajuanRingkas) {
  return a.id === p.requesterId;
}

export function bolehEdit(a: Aktor, p: PengajuanRingkas): Keputusan {
  if (p.status !== "draft" && p.status !== "perlu_revisi") return tidak("Pengajuan ini sudah tidak bisa diubah.");
  if (!pemohon(a, p) && a.role !== "super_admin") return tidak("Hanya pemohon yang bisa mengubah pengajuannya.");
  return YA;
}

export const bolehAjukan = bolehEdit;

export function bolehHapusDraft(a: Aktor, p: PengajuanRingkas): Keputusan {
  if (p.status !== "draft") return tidak("Hanya draf yang bisa dihapus.");
  if (!pemohon(a, p) && a.role !== "super_admin") return tidak("Hanya pemohon yang bisa menghapus drafnya.");
  return YA;
}

export function bolehBatalkan(a: Aktor, p: PengajuanRingkas): Keputusan {
  if (p.status === "diajukan" || p.status === "perlu_revisi") {
    if (pemohon(a, p)) return YA;
    if (can(a.role, "request.approve") || can(a.role, "request.pay")) return YA;
    return tidak("Hanya pemohon atau pemberi persetujuan yang bisa membatalkan.");
  }
  if (p.status === "disetujui") {
    if (can(a.role, "request.approve") || can(a.role, "request.pay")) return YA;
    return tidak("Pengajuan yang sudah disetujui hanya bisa dibatalkan Keuangan atau Pimpinan.");
  }
  return tidak("Pengajuan ini sudah tidak bisa dibatalkan.");
}

/**
 * Batas persetujuan: pengajuan di atas `cap` hanya untuk pemegang
 * `request.approve_any_amount` (Pimpinan, Admin Sistem). cap 0 = tanpa batas.
 */
export function bolehSetujui(a: Aktor, p: PengajuanRingkas, cap: bigint): Keputusan {
  if (p.status !== "diajukan") return tidak("Hanya pengajuan yang menunggu persetujuan yang bisa disetujui.");
  if (!can(a.role, "request.approve")) return tidak("Anda tidak berwenang menyetujui pengajuan.");
  if (pemohon(a, p) && a.role !== "super_admin") {
    return tidak("Pengajuan Anda sendiri harus disetujui orang lain.");
  }
  if (cap > 0n && p.total > cap && !can(a.role, "request.approve_any_amount")) {
    return tidak(`Nilainya di atas batas persetujuan Keuangan (${rupiah(cap)}). Perlu persetujuan Pimpinan.`);
  }
  return YA;
}

export function bolehMintaRevisi(a: Aktor, p: PengajuanRingkas): Keputusan {
  if (p.status === "diajukan") {
    if (!can(a.role, "request.approve")) return tidak("Anda tidak berwenang memeriksa pengajuan.");
    if (pemohon(a, p) && a.role !== "super_admin") return tidak("Tidak bisa meminta revisi atas pengajuan sendiri.");
    return YA;
  }
  if (p.status === "disetujui") {
    if (can(a.role, "request.pay") || can(a.role, "request.approve")) return YA;
    return tidak("Anda tidak berwenang mengembalikan pengajuan ini.");
  }
  return tidak("Pengajuan ini tidak sedang diperiksa.");
}

export function bolehTolak(a: Aktor, p: PengajuanRingkas): Keputusan {
  if (p.status !== "diajukan") return tidak("Hanya pengajuan yang menunggu persetujuan yang bisa ditolak.");
  if (!can(a.role, "request.approve")) return tidak("Anda tidak berwenang menolak pengajuan.");
  if (pemohon(a, p) && a.role !== "super_admin") return tidak("Batalkan saja pengajuan Anda sendiri.");
  return YA;
}

export function bolehBayar(a: Aktor, p: PengajuanRingkas): Keputusan {
  if (p.status !== "disetujui") return tidak("Pengajuan belum disetujui.");
  if (!can(a.role, "request.pay")) return tidak("Anda tidak berwenang mencatat pembayaran.");
  return YA;
}

/** Setujui + bayar dalam satu langkah, untuk yang memegang keduanya. */
export function bolehSetujuiDanBayar(a: Aktor, p: PengajuanRingkas, cap: bigint): Keputusan {
  const s = bolehSetujui(a, p, cap);
  if (!s.boleh) return s;
  if (!can(a.role, "request.pay")) return tidak("Anda tidak berwenang mencatat pembayaran.");
  return YA;
}

export function bolehBatalkanPembayaran(a: Aktor, p: PengajuanRingkas): Keputusan {
  if (p.status !== "dibayar") return tidak("Pembayaran hanya bisa dibatalkan sebelum LPJ diajukan.");
  if (!can(a.role, "request.pay")) return tidak("Anda tidak berwenang membatalkan pembayaran.");
  return YA;
}

export function bolehAjukanLpj(a: Aktor, p: PengajuanRingkas): Keputusan {
  if (p.kind !== "uang_muka") return tidak("LPJ hanya untuk uang muka.");
  if (p.status !== "dibayar") return tidak("LPJ diajukan setelah uang muka dibayar.");
  if (!pemohon(a, p) && a.role !== "super_admin") return tidak("Hanya pemegang uang muka yang mengajukan LPJ.");
  return YA;
}

export function bolehPeriksaLpj(a: Aktor, p: PengajuanRingkas): Keputusan {
  if (p.status !== "lpj_diajukan") return tidak("Tidak ada LPJ yang perlu diperiksa.");
  if (!can(a.role, "request.verify_lpj")) return tidak("Anda tidak berwenang memeriksa LPJ.");
  return YA;
}

/** Semua keputusan sekaligus – untuk layar detail. */
export function semuaAksi(a: Aktor, p: PengajuanRingkas, cap: bigint) {
  return {
    edit: bolehEdit(a, p),
    hapus: bolehHapusDraft(a, p),
    batal: bolehBatalkan(a, p),
    setujui: bolehSetujui(a, p, cap),
    setujuiBayar: bolehSetujuiDanBayar(a, p, cap),
    revisi: bolehMintaRevisi(a, p),
    tolak: bolehTolak(a, p),
    bayar: bolehBayar(a, p),
    batalBayar: bolehBatalkanPembayaran(a, p),
    lpj: bolehAjukanLpj(a, p),
    periksaLpj: bolehPeriksaLpj(a, p),
  };
}
