import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ComboOption {
  value: number | string;
  label: string;
  hint?: string;
}

export default function Combobox({
  options,
  value,
  onChange,
  placeholder = "Cari & pilih...",
  disabled,
  emptyText = "Tidak ada hasil",
  clearable = true,
}: {
  options: ComboOption[];
  value: number | string | null | undefined;
  onChange: (v: number | string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  emptyText?: string;
  clearable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => String(o.value) === String(value));

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const filtered = query.trim()
    ? options.filter((o) =>
        (o.label + " " + (o.hint || "")).toLowerCase().includes(query.toLowerCase()),
      )
    : options;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        className={cn(
          "flex h-11 w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 text-left text-sm",
          "outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200",
          disabled && "opacity-50 cursor-not-allowed",
        )}
      >
        <span className={cn("truncate flex-1", !selected && "text-slate-400")}>
          {selected ? selected.label : placeholder}
        </span>
        {clearable && selected && !disabled && (
          <span
            role="button"
            aria-label="Bersihkan"
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
            }}
            className="grid h-6 w-6 place-items-center rounded-full hover:bg-slate-100"
          >
            <X className="h-3.5 w-3.5" />
          </span>
        )}
        <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
            <Search className="h-4 w-4 text-slate-400 shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari..."
              className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
            />
          </div>
          <ul className="max-h-64 overflow-y-auto py-1 text-sm">
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-slate-400 italic">{emptyText}</li>
            )}
            {filtered.map((o) => {
              const active = String(o.value) === String(value);
              return (
                <li key={o.value}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(o.value);
                      setOpen(false);
                      setQuery("");
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-left",
                      active ? "bg-slate-100" : "hover:bg-slate-50",
                    )}
                  >
                    <Check
                      className={cn(
                        "h-4 w-4 shrink-0",
                        active ? "text-emerald-600" : "text-transparent",
                      )}
                    />
                    <span className="flex-1 min-w-0">
                      <span className="truncate block">{o.label}</span>
                      {o.hint && (
                        <span className="text-[11px] text-slate-500 truncate block">
                          {o.hint}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
