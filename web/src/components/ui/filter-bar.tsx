"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { cn } from "@/lib/cn";
import { Combobox, type ComboOption } from "./combobox";

/**
 * Bilah saring: kotak cari (otomatis setelah berhenti mengetik) + pilihan.
 * Semua keadaan di URL – bisa dibagikan & tombol kembali bekerja.
 */
export function FilterBar({
  placeholder = "Cari…",
  selects = [],
  className,
  search = true,
}: {
  search?: boolean;
  placeholder?: string;
  selects?: { param: string; options: ComboOption[]; allLabel: string; label: string }[];
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [pending, start] = useTransition();

  function set(param: string, value: string) {
    const next = new URLSearchParams(sp.toString());
    if (value) next.set(param, value);
    else next.delete(param);
    next.delete("hal");
    start(() => router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false }));
  }

  useEffect(() => {
    const awal = sp.get("q") ?? "";
    if (q === awal) return;
    const t = setTimeout(() => set("q", q.trim()), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className={cn("flex flex-col gap-2 sm:flex-row", className)}>
      {search ? (
      <div className="relative min-w-0 flex-1">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className={cn(
            "h-10 w-full rounded-md border border-border bg-surface pr-9 pl-9 text-base text-ink placeholder:text-ink-faint hover:border-border-strong focus-visible:outline-2 focus-visible:outline-primary-600 sm:text-sm pointer-coarse:h-11",
            pending && "opacity-70",
          )}
        />
        {q ? (
          <button
            type="button"
            aria-label="Hapus pencarian"
            onClick={() => setQ("")}
            className="absolute top-1/2 right-1.5 flex size-7 -translate-y-1/2 items-center justify-center rounded text-ink-faint hover:text-ink"
          >
            <X aria-hidden className="size-4" />
          </button>
        ) : null}
      </div>
      ) : null}
      {selects.map((s) => (
        <Combobox
          key={s.param}
          aria-label={s.label}
          className="sm:w-56"
          options={s.options}
          clearLabel={s.allLabel}
          value={sp.get(s.param) ?? ""}
          onChange={(v) => set(s.param, v)}
        />
      ))}
    </div>
  );
}
