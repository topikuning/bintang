import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, children, id }: { className?: string; children: ReactNode; id?: string }) {
  return (
    <section
      id={id}
      // min-w-0: kartu hampir selalu anak grid/flex; tanpa ini satu baris teks
      // panjang melebarkan seluruh halaman di ponsel (MARLIN DECISIONS 217).
      className={cn("min-w-0 rounded-lg border border-border bg-surface shadow-(--shadow-card)", className)}
    >
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
  icon,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
  icon?: ReactNode;
}) {
  return (
    <header
      className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3", className)}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        {icon ? <div className="mt-0.5 shrink-0 text-ink-muted">{icon}</div> : null}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-[13px] text-ink-muted">{subtitle}</p> : null}
        </div>
      </div>
      {action ? <div className="min-w-0">{action}</div> : null}
    </header>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("px-4 py-3", className)}>{children}</div>;
}
