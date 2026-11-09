import { hariIniKey, rentangBulan } from "@/lib/tanggal";

/** Pilihan periode cepat untuk laporan. */
export type Preset = "bulan-ini" | "bulan-lalu" | "tahun-ini" | "semua";

export const PRESET_LABEL: Record<Preset, string> = {
  "bulan-ini": "Bulan ini",
  "bulan-lalu": "Bulan lalu",
  "tahun-ini": "Tahun ini",
  semua: "Semua",
};

export function rentangPreset(p: Preset, today = hariIniKey()): { dari?: string; sampai?: string } {
  const [y, m] = today.split("-").map(Number);
  switch (p) {
    case "bulan-ini":
      return rentangBulan(today);
    case "bulan-lalu": {
      const d = new Date(Date.UTC(y, m - 2, 1));
      return rentangBulan(d.toISOString().slice(0, 10));
    }
    case "tahun-ini":
      return { dari: `${y}-01-01`, sampai: today };
    case "semua":
      return {};
  }
}

const KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Baca periode dari query: dari/sampai eksplisit menang atas preset. */
export function bacaPeriode(sp: { dari?: string; sampai?: string; periode?: string }) {
  const dari = sp.dari && KEY.test(sp.dari) ? sp.dari : undefined;
  const sampai = sp.sampai && KEY.test(sp.sampai) ? sp.sampai : undefined;
  if (dari || sampai) return { dari, sampai, preset: null as Preset | null };
  const preset = (Object.keys(PRESET_LABEL) as Preset[]).includes(sp.periode as Preset) ? (sp.periode as Preset) : "tahun-ini";
  return { ...rentangPreset(preset), preset };
}
