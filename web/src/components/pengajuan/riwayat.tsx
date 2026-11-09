import { Ban, Check, CircleDollarSign, FilePlus2, RotateCcw, Send, XCircle, ClipboardCheck } from "lucide-react";
import type { RequestStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/cn";
import { fmtWaktu } from "@/lib/tanggal";

type Event = {
  id: string;
  toStatus: RequestStatus;
  action: string;
  note: string | null;
  createdAt: Date;
  actor: { fullName: string };
};

const GAYA: Partial<Record<RequestStatus, { icon: typeof Check; cls: string }>> = {
  draft: { icon: FilePlus2, cls: "bg-surface-inset text-ink-muted" },
  diajukan: { icon: Send, cls: "bg-primary-100 text-primary-700" },
  perlu_revisi: { icon: RotateCcw, cls: "bg-warning-soft text-warning" },
  disetujui: { icon: Check, cls: "bg-info-soft text-info" },
  dibayar: { icon: CircleDollarSign, cls: "bg-success-soft text-success" },
  lpj_diajukan: { icon: ClipboardCheck, cls: "bg-primary-100 text-primary-700" },
  selesai: { icon: Check, cls: "bg-success-soft text-success" },
  ditolak: { icon: XCircle, cls: "bg-danger-soft text-danger" },
  dibatalkan: { icon: Ban, cls: "bg-surface-inset text-ink-muted" },
};

function kalimat(e: Event): string {
  const a = e.action;
  return a.charAt(0).toUpperCase() + a.slice(1);
}

export function Riwayat({ events }: { events: Event[] }) {
  return (
    <ol className="relative">
      {events.map((e, i) => {
        const g = GAYA[e.toStatus] ?? GAYA.draft!;
        const Ikon = g.icon;
        const terakhir = i === events.length - 1;
        return (
          <li key={e.id} className="relative flex gap-3 pb-5 last:pb-0">
            {!terakhir ? <span aria-hidden className="absolute top-8 bottom-0 left-[15px] w-px bg-border" /> : null}
            <span className={cn("relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full", g.cls)}>
              <Ikon aria-hidden className="size-4" />
            </span>
            <div className="min-w-0 pt-1">
              <p className="text-sm">
                <span className="font-semibold text-ink">{kalimat(e)}</span>
                <span className="text-ink-muted"> oleh {e.actor.fullName}</span>
              </p>
              <p className="text-xs text-ink-faint">{fmtWaktu(e.createdAt)}</p>
              {e.note ? (
                <p className="mt-1.5 rounded-md border border-border bg-surface-muted px-3 py-2 text-[13px] whitespace-pre-line text-ink">
                  {e.note}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
