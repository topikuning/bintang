import { describe, expect, it } from "vitest";
import type { RequestStatus, UserRole } from "@/generated/prisma/enums";
import { can, CAPABILITIES, isCrossProject } from "@/lib/authz";
import { assertRequestTransition, canTransitionRequest, canTransitionTx, requestStepIndex } from "@/lib/lifecycle";
import * as akses from "@/lib/pengajuan/akses";

const p = (status: RequestStatus, extra: Partial<akses.PengajuanRingkas> = {}): akses.PengajuanRingkas => ({
  status,
  kind: "pembayaran",
  requesterId: "pemohon",
  total: 1_000_000n,
  ...extra,
});
const a = (role: UserRole, id = "orang-lain"): akses.Aktor => ({ id, role });

describe("mesin transisi pengajuan", () => {
  it("alur normal", () => {
    expect(canTransitionRequest("draft", "diajukan")).toBe(true);
    expect(canTransitionRequest("diajukan", "disetujui")).toBe(true);
    expect(canTransitionRequest("disetujui", "dibayar")).toBe(true);
    expect(canTransitionRequest("dibayar", "lpj_diajukan")).toBe(true);
    expect(canTransitionRequest("lpj_diajukan", "selesai")).toBe(true);
  });
  it("tidak bisa melompat atau hidup lagi", () => {
    expect(canTransitionRequest("draft", "disetujui")).toBe(false);
    expect(canTransitionRequest("diajukan", "dibayar")).toBe(false);
    expect(canTransitionRequest("ditolak", "diajukan")).toBe(false);
    expect(canTransitionRequest("dibatalkan", "diajukan")).toBe(false);
    expect(canTransitionRequest("selesai", "dibayar")).toBe(false);
  });
  it("LPJ hanya untuk uang muka", () => {
    expect(() => assertRequestTransition("dibayar", "lpj_diajukan", "pembayaran")).toThrow(/uang muka/);
    expect(() => assertRequestTransition("dibayar", "lpj_diajukan", "uang_muka")).not.toThrow();
  });
  it("stepper", () => {
    expect(requestStepIndex("draft")).toBe(-1);
    expect(requestStepIndex("disetujui")).toBe(1);
    expect(requestStepIndex("selesai")).toBe(3);
  });
  it("transaksi terverifikasi hanya bisa dibatalkan", () => {
    expect(canTransitionTx("terverifikasi", "dibatalkan")).toBe(true);
    expect(canTransitionTx("terverifikasi", "ditolak")).toBe(false);
    expect(canTransitionTx("ditolak", "terverifikasi")).toBe(false);
  });
});

describe("wewenang pengajuan", () => {
  it("pemisahan tugas: pemohon tidak menyetujui pengajuannya sendiri", () => {
    expect(akses.bolehSetujui(a("finance", "pemohon"), p("diajukan"), 0n).boleh).toBe(false);
    expect(akses.bolehSetujui(a("director", "pemohon"), p("diajukan"), 0n).boleh).toBe(false);
    expect(akses.bolehSetujui(a("finance"), p("diajukan"), 0n).boleh).toBe(true);
  });
  it("batas persetujuan keuangan", () => {
    const besar = p("diajukan", { total: 150_000_000n });
    const tolak = akses.bolehSetujui(a("finance"), besar, 100_000_000n);
    expect(tolak.boleh).toBe(false);
    expect(!tolak.boleh && tolak.alasan).toMatch(/Pimpinan/);
    expect(akses.bolehSetujui(a("director"), besar, 100_000_000n).boleh).toBe(true);
    expect(akses.bolehSetujui(a("finance"), besar, 0n).boleh).toBe(true); // 0 = tanpa batas
  });
  it("staf & admin proyek tidak menyetujui atau membayar", () => {
    for (const r of ["staff", "project_admin", "viewer"] as UserRole[]) {
      expect(akses.bolehSetujui(a(r), p("diajukan"), 0n).boleh).toBe(false);
      expect(akses.bolehBayar(a(r), p("disetujui")).boleh).toBe(false);
    }
  });
  it("pimpinan menyetujui tapi tidak membayar; setujui & bayar butuh keduanya", () => {
    expect(akses.bolehBayar(a("director"), p("disetujui")).boleh).toBe(false);
    expect(akses.bolehSetujuiDanBayar(a("director"), p("diajukan"), 0n).boleh).toBe(false);
    expect(akses.bolehSetujuiDanBayar(a("finance"), p("diajukan"), 0n).boleh).toBe(true);
  });
  it("hanya pemohon yang mengubah & mengajukan LPJ", () => {
    expect(akses.bolehEdit(a("finance"), p("perlu_revisi")).boleh).toBe(false);
    expect(akses.bolehEdit(a("staff", "pemohon"), p("perlu_revisi")).boleh).toBe(true);
    expect(akses.bolehEdit(a("staff", "pemohon"), p("diajukan")).boleh).toBe(false);
    const um = p("dibayar", { kind: "uang_muka" });
    expect(akses.bolehAjukanLpj(a("staff", "pemohon"), um).boleh).toBe(true);
    expect(akses.bolehAjukanLpj(a("finance"), um).boleh).toBe(false);
    expect(akses.bolehAjukanLpj(a("staff", "pemohon"), p("dibayar")).boleh).toBe(false);
  });
  it("pemohon boleh membatalkan sebelum disetujui, setelahnya tidak", () => {
    expect(akses.bolehBatalkan(a("staff", "pemohon"), p("diajukan")).boleh).toBe(true);
    expect(akses.bolehBatalkan(a("staff", "pemohon"), p("disetujui")).boleh).toBe(false);
    expect(akses.bolehBatalkan(a("finance"), p("disetujui")).boleh).toBe(true);
    expect(akses.bolehBatalkan(a("finance"), p("dibayar")).boleh).toBe(false);
  });
});

describe("matriks capability", () => {
  it("admin sistem memegang semuanya", () => {
    for (const c of CAPABILITIES) expect(can("super_admin", c)).toBe(true);
  });
  it("pengamat hanya membaca", () => {
    for (const c of ["request.create", "request.approve", "request.pay", "tx.create", "master.manage", "user.manage"] as const) {
      expect(can("viewer", c)).toBe(false);
    }
  });
  it("lingkup proyek", () => {
    expect(isCrossProject("finance")).toBe(true);
    expect(isCrossProject("staff")).toBe(false);
    expect(isCrossProject("viewer", true)).toBe(true);
  });
});
