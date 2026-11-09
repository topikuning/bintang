"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { BrandName } from "./brand";
import type { NavItem } from "./nav-config";
import { NavIcon } from "./nav-icon";

export function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

const GROUP_LABEL = { utama: "Menu", kelola: "Kelola" } as const;

export function Sidebar({
  appName,
  nav,
  badges,
}: {
  appName: string;
  nav: NavItem[];
  badges: Partial<Record<NonNullable<NavItem["badge"]>, number>>;
}) {
  const pathname = usePathname();
  const groups = (["utama", "kelola"] as const)
    .map((g) => ({ g, items: nav.filter((i) => i.group === g) }))
    .filter((x) => x.items.length > 0);
  return (
    <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-surface lg:flex">
      <div className="flex h-14 items-center border-b border-border px-4">
        <Link href="/" className="min-w-0">
          <BrandName name={appName} />
        </Link>
      </div>
      <nav aria-label="Navigasi utama" className="flex-1 overflow-y-auto px-3 py-4">
        {groups.map(({ g, items }) => (
          <div key={g} className="mb-5">
            <p className="mb-1.5 px-2 text-[11px] font-semibold tracking-wider text-ink-faint uppercase">
              {GROUP_LABEL[g]}
            </p>
            <ul className="space-y-0.5">
              {items.map((item) => {
                const aktif = isActive(pathname, item.href);
                const n = item.badge ? badges[item.badge] : undefined;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={aktif ? "page" : undefined}
                      className={cn(
                        "flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium transition-colors",
                        aktif ? "bg-primary-50 text-primary-800" : "text-ink-muted hover:bg-surface-muted hover:text-ink",
                      )}
                    >
                      <NavIcon icon={item.icon} className={cn("size-4.5", aktif ? "text-primary-700" : "text-ink-faint")} />
                      <span className="flex-1 truncate">{item.label}</span>
                      {n ? (
                        <span className="tabular rounded-full bg-danger px-1.5 text-[11px] leading-5 font-semibold text-white">
                          {n > 99 ? "99+" : n}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
