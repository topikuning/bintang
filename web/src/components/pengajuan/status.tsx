import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { RequestKind, RequestStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/cn";
import { requestStatusLabel, requestStatusTone, requestStepIndex, requestSteps } from "@/lib/lifecycle";

export function StatusPengajuan({ status, kind, short = false }: { status: RequestStatus; kind: RequestKind; short?: boolean }) {
  return (
    <Badge tone={requestStatusTone(status, kind)} dot>
      {requestStatusLabel(status, kind, short)}
    </Badge>
  );
}

/**
 * Penanda kemajuan: Diajukan → Disetujui → Dibayar (→ LPJ selesai).
 * Status buntu (ditolak/dibatalkan) tidak memakai stepper – banner lebih jujur.
 */
export function StepperPengajuan({ status, kind }: { status: RequestStatus; kind: RequestKind }) {
  const steps = requestSteps(kind);
  const idx = requestStepIndex(status);
  return (
    <ol className="flex items-center" aria-label="Kemajuan pengajuan">
      {steps.map((s, i) => {
        const selesai = i <= idx;
        const berikut = i === idx + 1;
        return (
          <li key={s.key} className={cn("flex items-center", i < steps.length - 1 && "flex-1")}>
            <div className="flex flex-col items-center gap-1">
              <span
                className={cn(
                  "flex size-7 items-center justify-center rounded-full border-2 text-xs font-semibold",
                  selesai
                    ? "border-success bg-success text-white"
                    : berikut
                      ? "border-primary-500 bg-primary-50 text-primary-700"
                      : "border-border-strong bg-surface text-ink-faint",
                )}
                aria-current={berikut ? "step" : undefined}
              >
                {selesai ? <Check aria-hidden className="size-4" strokeWidth={3} /> : i + 1}
              </span>
              <span className={cn("text-[11px] font-medium whitespace-nowrap", selesai ? "text-success" : berikut ? "text-primary-700" : "text-ink-faint")}>
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 ? (
              <span aria-hidden className={cn("mx-1 mb-5 h-0.5 flex-1 rounded-full", i < idx ? "bg-success" : "bg-border")} />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
