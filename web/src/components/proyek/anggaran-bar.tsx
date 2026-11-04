import { ProgressBar } from "@/components/ui/misc";
import { statusAnggaran, STATUS_ANGGARAN_LABEL } from "@/lib/keuangan/hitung";
import { cn } from "@/lib/cn";
import { rupiah, rupiahRingkas } from "@/lib/uang";

/** Pemakaian anggaran: bar + persen + sisa. Rumusnya dari calculation layer. */
export function AnggaranBar({ terpakai, anggaran, ringkas = false }: { terpakai: bigint; anggaran: bigint; ringkas?: boolean }) {
  const s = statusAnggaran(terpakai, anggaran);
  if (s.status === "tanpa_anggaran") {
    return <p className="text-xs text-ink-faint">Anggaran belum diisi · terpakai {rupiahRingkas(terpakai)}</p>;
  }
  const tone = s.status === "lewat" ? "danger" : s.status === "waspada" ? "warning" : "success";
  const fmt = ringkas ? rupiahRingkas : rupiah;
  return (
    <div>
      <ProgressBar value={s.persen ?? 0} tone={tone} label="Pemakaian anggaran" />
      <div className="mt-1 flex items-center justify-between gap-2 text-xs">
        <span className={cn("font-medium", s.status === "lewat" ? "text-danger" : s.status === "waspada" ? "text-warning" : "text-ink-muted")}>
          {s.persen?.toLocaleString("id-ID")}% · {STATUS_ANGGARAN_LABEL[s.status]}
        </span>
        <span className="tabular text-ink-muted">
          {s.sisa >= 0n ? `sisa ${fmt(s.sisa)}` : `lebih ${fmt(-s.sisa)}`}
        </span>
      </div>
    </div>
  );
}
