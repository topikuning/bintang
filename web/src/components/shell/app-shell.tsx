import { Bell } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { BottomNav } from "./bottom-nav";
import { BrandName } from "./brand";
import type { NavItem } from "./nav-config";
import { Sidebar } from "./sidebar";
import { UserMenu } from "./user-menu";

export function AppShell({
  appName,
  orgName,
  user,
  nav,
  mobileShortcuts,
  canCreate,
  badges,
  unread,
  penanda,
  logoutAction,
  children,
}: {
  appName: string;
  orgName: string;
  user: { name: string; roleLabel: string };
  nav: NavItem[];
  mobileShortcuts: NavItem[];
  canCreate: boolean;
  badges: Partial<Record<NonNullable<NavItem["badge"]>, number>>;
  unread: number;
  penanda?: string;
  logoutAction: () => Promise<void>;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh">
      {penanda ? (
        <div className="no-print sticky top-0 z-[60] bg-gold px-4 py-1 text-center text-xs font-semibold text-ink">
          SERVER UJI ({penanda}) – data di sini bukan data sungguhan
        </div>
      ) : null}
      <Sidebar appName={appName} nav={nav} badges={badges} />
      <div className="lg:pl-60">
        <header className="no-print sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border bg-surface/90 px-4 backdrop-blur lg:px-6">
          <Link href="/" className="lg:hidden">
            <BrandName name={appName} />
          </Link>
          <p className="hidden truncate text-sm text-ink-muted lg:block">{orgName}</p>
          <div className="flex items-center gap-1">
            <Link
              href="/notifikasi"
              aria-label={unread ? `Notifikasi, ${unread} belum dibaca` : "Notifikasi"}
              className="relative flex size-10 items-center justify-center rounded-md text-ink-muted hover:bg-surface-inset hover:text-ink"
            >
              <Bell aria-hidden className="size-5" />
              {unread ? (
                <span
                  className={cn(
                    "tabular absolute top-1.5 right-1.5 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] leading-4 font-semibold text-white",
                  )}
                >
                  {unread > 9 ? "9+" : unread}
                </span>
              ) : null}
            </Link>
            <UserMenu name={user.name} roleLabel={user.roleLabel} logoutAction={logoutAction} />
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 py-5 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:px-6 lg:pb-10">
          {children}
        </main>
      </div>
      <BottomNav shortcuts={mobileShortcuts} fullNav={nav} canCreate={canCreate} badges={badges} />
    </div>
  );
}
