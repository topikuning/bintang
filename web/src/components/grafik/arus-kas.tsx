import { namaBulan } from "@/lib/tanggal";
import { rupiah, rupiahRingkas } from "@/lib/uang";

/**
 * Grafik batang arus kas bulanan (masuk vs keluar). SVG murni yang dirender di
 * server – tanpa pustaka grafik, tanpa JavaScript di peramban. Tabel di
 * bawahnya untuk pembaca layar.
 */
export function GrafikArusKas({ data }: { data: { tahun: number; bulan: number; masuk: bigint; keluar: bigint }[] }) {
  const maks = data.reduce((m, d) => (d.masuk > m ? d.masuk : d.keluar > m ? d.keluar : m), 0n);
  const W = 480;
  const H = 190;
  const padL = 50;
  const padB = 24;
  const padT = 8;
  const ch = H - padB - padT;
  const lebarKelompok = (W - padL) / Math.max(1, data.length);
  const lebarBatang = Math.min(22, lebarKelompok / 3);
  const skala = (v: bigint) => (maks === 0n ? 0 : Number((v * 10_000n) / maks) / 10_000) * ch;
  const garis = [0, 0.5, 1];
  const rapat = data.length > 7;

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Grafik arus kas bulanan">
        {garis.map((g) => {
          const y = padT + ch - g * ch;
          return (
            <g key={g}>
              <line x1={padL} x2={W} y1={y} y2={y} stroke="var(--color-border)" strokeDasharray={g === 0 ? undefined : "3 4"} />
              <text x={padL - 8} y={y + 4} textAnchor="end" fontSize="12" fill="var(--color-ink-faint)">
                {maks === 0n ? "0" : rupiahRingkas((maks * BigInt(Math.round(g * 100))) / 100n).replace("Rp ", "")}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const x0 = padL + i * lebarKelompok + lebarKelompok / 2;
          const hm = skala(d.masuk);
          const hk = skala(d.keluar);
          return (
            <g key={`${d.tahun}-${d.bulan}`}>
              <rect x={x0 - lebarBatang - 2} y={padT + ch - hm} width={lebarBatang} height={hm} rx="3" fill="var(--color-masuk)">
                <title>{`Masuk ${namaBulan(d.tahun, d.bulan, "MMMM yyyy")}: ${rupiah(d.masuk)}`}</title>
              </rect>
              <rect x={x0 + 2} y={padT + ch - hk} width={lebarBatang} height={hk} rx="3" fill="var(--color-keluar)" opacity="0.85">
                <title>{`Keluar ${namaBulan(d.tahun, d.bulan, "MMMM yyyy")}: ${rupiah(d.keluar)}`}</title>
              </rect>
              {/* Grafik panjang: nama bulan saja, tahun hanya di Januari & batang
                  pertama – "Des 25Jan 26" yang bertumpuk tidak terbaca. */}
              <text x={x0} y={H - 6} textAnchor="middle" fontSize={rapat ? 11 : 12} fill="var(--color-ink-muted)">
                {rapat && !(i === 0 || d.bulan === 1) ? namaBulan(d.tahun, d.bulan, "MMM") : namaBulan(d.tahun, d.bulan)}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-2 flex gap-4 text-xs text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-masuk" /> Kas masuk
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-keluar" /> Kas keluar
        </span>
      </figcaption>
      <table className="sr-only">
        <caption>Arus kas bulanan</caption>
        <thead>
          <tr>
            <th>Bulan</th>
            <th>Masuk</th>
            <th>Keluar</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={`${d.tahun}-${d.bulan}`}>
              <td>{namaBulan(d.tahun, d.bulan, "MMMM yyyy")}</td>
              <td>{rupiah(d.masuk)}</td>
              <td>{rupiah(d.keluar)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
