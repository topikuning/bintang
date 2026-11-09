"use client";

import { Check, ChevronDown, Plus, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * Pengganti <select> yang BISA DICARI (konsep MARLIN). Tetap drop-in untuk
 * form Server Action: nilai terpilih ada di <input type="hidden" name=…>.
 * Kotak cari muncul otomatis bila opsi > `searchThreshold`.
 *
 * Tambahan Bintang: `onCreate` – tombol "Tambah '…'" di dasar daftar ketika
 * yang dicari tidak ada (mis. vendor baru langsung dari form pengajuan).
 */

export type ComboOption = { value: string; label: string; hint?: string; disabled?: boolean };

export interface ComboboxProps {
  name?: string;
  id?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  options: ComboOption[];
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  searchThreshold?: number;
  /** Teks saat cari kosong. */
  emptyText?: string;
  onCreate?: (query: string) => void;
  createLabel?: string;
  /** Opsi kosong di atas daftar, mis. "Semua proyek". */
  clearLabel?: string;
  "aria-label"?: string;
}

const CONTROL =
  "flex h-10 w-full items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 text-base sm:text-sm text-ink pointer-coarse:min-h-11 " +
  "hover:border-border-strong focus-visible:outline-2 focus-visible:outline-primary-600 disabled:cursor-not-allowed disabled:bg-surface-inset disabled:text-ink-faint";

export function Combobox({
  name,
  id,
  value,
  defaultValue,
  onChange,
  options,
  placeholder = "Pilih…",
  invalid,
  disabled,
  required,
  className,
  searchThreshold = 7,
  emptyText = "Tidak ada yang cocok",
  onCreate,
  createLabel = "Tambah",
  clearLabel,
  "aria-label": ariaLabel,
}: ComboboxProps) {
  const items = useMemo(
    () => (clearLabel !== undefined ? [{ value: "", label: clearLabel }, ...options] : options),
    [options, clearLabel],
  );
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState(defaultValue ?? "");
  const selected = isControlled ? value : internal;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const showSearch = items.length > searchThreshold || !!onCreate;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? items.filter((o) => o.label.toLowerCase().includes(q) || o.hint?.toLowerCase().includes(q))
      : items;
  }, [items, query]);

  const selectedOpt = items.find((o) => o.value === selected);
  const selectedLabel = selected === "" && clearLabel === undefined ? "" : (selectedOpt?.label ?? "");

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  useEffect(() => {
    if (open && showSearch) searchRef.current?.focus();
  }, [open, showSearch]);

  function commit(v: string) {
    if (!isControlled) setInternal(v);
    onChange?.(v);
    setOpen(false);
    setQuery("");
  }

  function openMenu() {
    if (disabled) return;
    setOpen(true);
    const idx = filtered.findIndex((o) => o.value === selected);
    setActive(idx >= 0 ? idx : 0);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = filtered[active];
      if (opt && !opt.disabled) commit(opt.value);
      else if (onCreate && query.trim()) {
        onCreate(query.trim());
        setOpen(false);
        setQuery("");
      }
    }
  }

  const q = query.trim();
  const persis = items.some((o) => o.label.toLowerCase() === q.toLowerCase());

  return (
    <div ref={rootRef} className={cn("relative min-w-0", className)}>
      {name ? <input type="hidden" name={name} value={selected} /> : null}
      <button
        type="button"
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        aria-required={required || undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
        className={cn(CONTROL, invalid && "border-danger", open && "border-primary-400")}
      >
        <span className={cn("truncate text-left", !selectedLabel && "text-ink-faint")}>
          {selectedLabel || placeholder}
        </span>
        <ChevronDown aria-hidden className={cn("size-4 shrink-0 text-ink-muted transition-transform", open && "rotate-180")} />
      </button>

      {open ? (
        <div className="bintang-naik absolute z-50 mt-1 w-max max-w-[min(32rem,calc(100vw-2rem))] min-w-full overflow-hidden rounded-lg border border-border bg-surface shadow-(--shadow-pop)">
          {showSearch ? (
            <div className="flex items-center gap-2 border-b border-border px-2.5">
              <Search aria-hidden className="size-4 shrink-0 text-ink-muted" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onKeyDown}
                placeholder="Ketik untuk mencari…"
                className="h-10 w-full bg-transparent text-base text-ink outline-none placeholder:text-ink-faint sm:text-sm"
              />
            </div>
          ) : null}
          <ul id={listId} role="listbox" className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 && !(onCreate && q) ? (
              <li className="px-3 py-2.5 text-sm text-ink-faint">{emptyText}</li>
            ) : (
              filtered.map((o, i) => {
                const isSel = o.value === selected;
                return (
                  <li key={o.value || `_${i}`} role="option" aria-selected={isSel}>
                    <button
                      type="button"
                      disabled={o.disabled}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => commit(o.value)}
                      className={cn(
                        "flex w-full items-start justify-between gap-2 px-3 py-2 text-left text-sm text-ink pointer-coarse:py-2.5",
                        i === active && "bg-surface-muted",
                        o.disabled && "cursor-not-allowed text-ink-faint",
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block break-words whitespace-normal">{o.label}</span>
                        {o.hint ? <span className="block text-xs text-ink-muted">{o.hint}</span> : null}
                      </span>
                      {isSel ? <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-primary-600" /> : null}
                    </button>
                  </li>
                );
              })
            )}
            {onCreate && q && !persis ? (
              <li>
                <button
                  type="button"
                  onClick={() => {
                    onCreate(q);
                    setOpen(false);
                    setQuery("");
                  }}
                  className="flex w-full items-center gap-2 border-t border-border px-3 py-2.5 text-left text-sm font-medium text-primary hover:bg-primary-50"
                >
                  <Plus aria-hidden className="size-4" />
                  {createLabel} &ldquo;{q}&rdquo;
                </button>
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
