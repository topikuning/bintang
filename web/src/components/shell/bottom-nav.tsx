"use client";

import { Menu, Plus, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import type { NavItem } from "./nav-config";
import { NavIcon } from "./nav-icon";
import { isActive } from "./sidebar";

/**
 * Nav bawah ponsel. Tombol "+" di tengah = aksi paling sering: membuat
 * pengajuan baru, satu ketukan dari layar mana pun (pola "Foto Cepat" MARLIN –
 * aksi utama tidak boleh terkubur di menu).
 */
export function BottomNav({
  shortcuts,
  fullNav,
  canCreate,
  badges,
}: {
  shortcuts: NavItem[];
  fullNav: NavItem[];
  canCreate: boolean;
  badges: Partial<Record<NonNullable<NavItem["badge"]>, number>>;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [prev, setPrev] = useState(pathname);
  if (prev !== pathname) {
    // Laci tertutup ketika halaman BENAR-BENAR berganti, bukan saat diketuk –
    // supaya ketukan terbaca "sedang pindah", bukan "menu tertutup lalu diam".
    setPrev(pathname);
    setOpen(false);
  }
  const [siap, setSiap] = useState(false);
  useEffect(() => queueMicrotask(() => setSiap(true)), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    const semula = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = semula;
    };
  }, [open]);

  // Layar isian (form) memakai bilah aksinya sendiri di dasar layar – nav
  // bawah disembunyikan supaya tidak ada dua bilah bertumpuk dan tombol "+"
  // tidak mengajak membuka form yang sedang dibuka.
  const layarIsian = /\/(baru|ubah|lpj)$/.test(pathname);
  if (layarIsian) return null;

  const kiri = shortcuts.slice(0, 2);
  const kanan = shortcuts.slice(2, canCreate ? 3 : 4);

  const sel = (item: NavItem) => {
    const aktif = isActive(pathname, item.href);
    const n = item.badge ? badges[item.badge] : undefined;
    return (
      <li key={item.href} className="flex-1">
        <Link
          href={item.href}
          aria-current={aktif ? "page" : undefined}
          className={cn(
            "relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors active:bg-primary-50",
            aktif ? "text-primary-700" : "text-ink-muted",
          )}
        >
          <span className="relative">
            <NavIcon icon={item.icon} className="size-5.5" />
            {n ? (
              <span className="tabular absolute -top-1.5 -right-2.5 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] leading-4 font-semibold text-white">
                {n > 9 ? "9+" : n}
              </span>
            ) : null}
          </span>
          {item.label}
          {aktif ? <span aria-hidden className="absolute top-0 h-0.5 w-8 rounded-full bg-primary" /> : null}
        </Link>
      </li>
    );
  };

  return (
    <>
      <nav
        aria-label="Navigasi bawah"
        className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        <ul className="flex items-stretch">
          {kiri.map(sel)}
          {canCreate ? (
            <li className="flex flex-1 items-start justify-center">
              <Link
                href="/pengajuan/baru"
                aria-label="Ajukan pembayaran baru"
                className="-mt-5 flex size-14 items-center justify-center rounded-full bg-primary text-white shadow-(--shadow-pop) ring-4 ring-surface-muted transition-transform active:scale-95"
              >
                <Plus aria-hidden className="size-7" strokeWidth={2.5} />
              </Link>
            </li>
          ) : null}
          {kanan.map(sel)}
          <li className="flex-1">
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-expanded={open}
              className={cn(
                "flex min-h-14 w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
                open ? "text-primary-700" : "text-ink-muted",
              )}
            >
              <Menu aria-hidden className="size-5.5" />
              Menu
            </button>
          </li>
        </ul>
      </nav>

      {siap && open
        ? createPortal(
            <div className="fixed inset-0 z-[1200] lg:hidden" role="dialog" aria-modal="true" aria-label="Semua menu">
              <button type="button" aria-label="Tutup menu" onClick={() => setOpen(false)} className="absolute inset-0 bg-ink/45" />
              <div className="bintang-naik absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-2xl border-t border-border bg-surface p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-(--shadow-pop)">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-semibold text-ink">Semua menu</p>
                  <button
                    type="button"
                    aria-label="Tutup"
                    autoFocus
                    onClick={() => setOpen(false)}
                    className="flex size-9 items-center justify-center rounded-md text-ink-muted hover:bg-surface-inset"
                  >
                    <X aria-hidden className="size-4" />
                  </button>
                </div>
                <ul className="grid grid-cols-3 gap-2">
                  {fullNav.map((item) => {
                    const aktif = isActive(pathname, item.href);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          aria-current={aktif ? "page" : undefined}
                          className={cn(
                            "flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-center text-[12px] font-medium transition-colors active:bg-primary-100",
                            aktif ? "border-primary-300 bg-primary-50 text-primary-800" : "border-border text-ink-muted",
                          )}
                        >
                          <NavIcon icon={item.icon} className="size-5.5" />
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
