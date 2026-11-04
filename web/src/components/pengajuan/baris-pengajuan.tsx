import { CalendarClock, ChevronRight, Paperclip, Zap } from "lucide-react";
import Link from "next/link";
import type { RequestKind, RequestStatus } from "@/generated/prisma/enums";
import { Avatar } from "@/components/ui/misc";
import { REQUEST_KIND_LABEL } from "@/lib/lifecycle";
import { fmtTanggal, relatif, selisihHari, tanggalKeKey } from "@/lib/tanggal";
import { rupiah } from "@/lib/uang";
import { StatusPengajuan } from "./status";

export type BarisPengajuanData = {
  id: string;
  number: string | null;
  title: string;
  kind: RequestKind;
  status: RequestStatus;
  urgent: boolean;
  total: bigint;
  neededDate: Date | null;
  payeeName: string | null;
  submittedAt: Date | null;
  updatedAt: Date;
  requester: { fullName: string };
  project: { code: string; name: string };
  _count: { attachments: number };
};

/**
 * Satu baris daftar pengajuan – dirancang untuk dipindai cepat oleh pemberi
 * persetujuan: judul & nominal sejajar di baris pertama, siapa & proyek di
 * baris kedua, sinyal penting (mendesak, tenggat, lampiran) sebagai ikon.
 */
export function BarisPengajuan({ r, today }: { r: BarisPengajuanData; today: string }) {
  const sisa = r.neededDate ? selisihHari(today, tanggalKeKey(r.neededDate)) : null;
  const terbuka = r.status === "diajukan" || r.status === "disetujui" || r.status === "perlu_revisi";
  return (
    <li>
      <Link
        href={`/pengajuan/${r.id}`}
        className="group flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-muted active:bg-surface-inset"
      >
        <Avatar name={r.requester.fullName} className="hidden sm:inline-flex" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 truncate text-sm font-semibold text-ink">
              {r.urgent ? <Zap aria-label="Mendesak" className="mr-1 -mt-0.5 inline size-3.5 text-danger" /> : null}
              {r.title}
            </p>
            <p className="tabular shrink-0 text-sm font-semibold text-ink">{rupiah(r.total)}</p>
          </div>
          <div className="mt-1 flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-[12.5px] text-ink-muted">
              <span className="tabular">{r.number ?? "Draf"}</span> · {r.requester.fullName} · {r.project.code}
              <span className="hidden md:inline"> – {r.project.name}</span>
            </p>
            <StatusPengajuan status={r.status} kind={r.kind} short />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-faint">
            <span>{REQUEST_KIND_LABEL[r.kind]}</span>
            {r.payeeName ? <span className="max-w-48 truncate">→ {r.payeeName}</span> : null}
            {sisa !== null && terbuka ? (
              <span className={`inline-flex items-center gap-1 ${sisa < 0 ? "font-medium text-danger" : sisa <= 2 ? "font-medium text-warning" : ""}`}>
                <CalendarClock aria-hidden className="size-3.5" />
                {sisa < 0 ? `lewat ${-sisa} hr` : sisa === 0 ? "hari ini" : fmtTanggal(r.neededDate, "d MMM")}
              </span>
            ) : null}
            {r._count.attachments ? (
              <span className="inline-flex items-center gap-1">
                <Paperclip aria-hidden className="size-3.5" />
                {r._count.attachments}
              </span>
            ) : null}
            <span className="ml-auto">{relatif(r.submittedAt ?? r.updatedAt)}</span>
          </div>
        </div>
        <ChevronRight aria-hidden className="hidden size-4 shrink-0 text-ink-faint group-hover:text-ink-muted sm:block" />
      </Link>
    </li>
  );
}
