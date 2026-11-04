"use client";

import { ChevronDown, KeyRound, LogOut, UserCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/misc";

export function UserMenu({
  name,
  roleLabel,
  logoutAction,
}: {
  name: string;
  roleLabel: string;
  logoutAction: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex h-10 items-center gap-2 rounded-md px-1.5 hover:bg-surface-inset sm:px-2"
      >
        <Avatar name={name} />
        <span className="hidden min-w-0 text-left sm:block">
          <span className="block max-w-40 truncate text-[13px] leading-tight font-semibold text-ink">{name}</span>
          <span className="block text-[11px] leading-tight text-ink-muted">{roleLabel}</span>
        </span>
        <ChevronDown aria-hidden className="hidden size-4 text-ink-muted sm:block" />
      </button>
      {open ? (
        <div
          role="menu"
          className="bintang-naik absolute right-0 z-50 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-(--shadow-pop)"
        >
          <div className="border-b border-border px-3 py-2 sm:hidden">
            <p className="truncate text-sm font-semibold">{name}</p>
            <p className="text-xs text-ink-muted">{roleLabel}</p>
          </div>
          <Link role="menuitem" href="/profil" onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-surface-muted">
            <UserCircle aria-hidden className="size-4 text-ink-muted" /> Profil & rekening saya
          </Link>
          <Link role="menuitem" href="/ganti-password" onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-surface-muted">
            <KeyRound aria-hidden className="size-4 text-ink-muted" /> Ganti password
          </Link>
          <form action={logoutAction}>
            <button role="menuitem" type="submit" className="flex w-full items-center gap-2.5 border-t border-border px-3 py-2.5 text-sm text-danger hover:bg-danger-soft">
              <LogOut aria-hidden className="size-4" /> Keluar
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
