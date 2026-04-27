import { cn } from "@/lib/utils";

type Tone = "neutral" | "good" | "warn" | "bad" | "info";
const tones: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700",
  good: "bg-emerald-100 text-emerald-700",
  warn: "bg-amber-100 text-amber-800",
  bad: "bg-rose-100 text-rose-700",
  info: "bg-sky-100 text-sky-700",
};

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function statusTone(status: string): Tone {
  switch (status) {
    case "VERIFIED":
    case "PAID":
    case "APPROVED":
    case "FULFILLED":
    case "AKTIF":
    case "sehat":
    case "aman":
      return "good";
    case "OVERDUE":
    case "REJECTED":
    case "CANCELLED":
    case "DIBATALKAN":
    case "minus":
    case "overbudget":
      return "bad";
    case "SUBMITTED":
    case "ISSUED":
    case "PARTIALLY_PAID":
    case "DRAFT":
    case "DITAHAN":
    case "waspada":
    case "mendekati_batas":
      return "warn";
    default:
      return "neutral";
  }
}
