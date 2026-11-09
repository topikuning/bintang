import { cn } from "@/lib/cn";

/** Logo bintang – emas di atas indigo. Murni SVG, tanpa berkas gambar. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary shadow-xs", className)}
    >
      <svg viewBox="0 0 24 24" className="size-[62%]" fill="none">
        <path
          d="M12 2.8l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6-4.5-4.2 6.1-.7L12 2.8z"
          fill="var(--color-gold)"
          stroke="var(--color-gold)"
          strokeWidth="1"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function BrandName({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <BrandMark />
      <span className="text-[15px] font-semibold tracking-tight text-ink">{name}</span>
    </span>
  );
}
