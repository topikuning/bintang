import Link from "next/link";
import { cn } from "@/lib/cn";

export type TabItem = { key: string; label: string; href: string; count?: number; highlight?: boolean };

/**
 * Tab berbasis tautan (state di URL – bisa dibagikan, tombol kembali bekerja).
 * Di ponsel bergulir mendatar, bukan melipat jadi dua baris.
 */
export function LinkTabs({ items, active, className }: { items: TabItem[]; active: string; className?: string }) {
  return (
    <nav aria-label="Saring" className={cn("-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0", className)}>
      <ul className="flex w-max gap-1.5 pb-1">
        {items.map((t) => {
          const aktif = t.key === active;
          return (
            <li key={t.key}>
              <Link
                href={t.href}
                aria-current={aktif ? "page" : undefined}
                scroll={false}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors pointer-coarse:h-10",
                  aktif
                    ? "border-primary bg-primary text-white"
                    : "border-border bg-surface text-ink-muted hover:border-border-strong hover:text-ink",
                )}
              >
                {t.label}
                {t.count !== undefined && t.count > 0 ? (
                  <span
                    className={cn(
                      "tabular rounded-full px-1.5 text-[11px] leading-5 font-semibold",
                      aktif ? "bg-white/20 text-white" : t.highlight ? "bg-danger text-white" : "bg-surface-inset text-ink-muted",
                    )}
                  >
                    {t.count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Pilihan tersegmen (radio bergaya tombol) untuk form. */
export function Segmented({
  name,
  options,
  value,
  onChange,
  className,
}: {
  name: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <div role="radiogroup" className={cn("inline-flex rounded-lg border border-border bg-surface-inset p-0.5", className)}>
      {options.map((o) => (
        <label
          key={o.value}
          className={cn(
            "cursor-pointer rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors pointer-coarse:py-2",
            value === o.value ? "bg-surface text-ink shadow-xs" : "text-ink-muted hover:text-ink",
          )}
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            className="sr-only"
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}
