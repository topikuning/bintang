import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { filterNav, mobileNav } from "@/components/shell/nav-config";
import { logout } from "@/lib/auth/actions";
import { requireUser } from "@/lib/auth/session";
import { can, ROLE_LABEL } from "@/lib/authz";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { ambilPengaturan } from "@/lib/pengaturan";
import { tugasSaya } from "@/lib/pengajuan/queries";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const setting = await ambilPengaturan();
  const [unread, tugas] = await Promise.all([
    db.notification.count({ where: { userId: user.id, readAt: null } }),
    tugasSaya(user, setting.financeApproveCap),
  ]);
  const tindakan =
    (tugas.setujui?.n ?? 0) +
    (tugas.bayar?.n ?? 0) +
    (tugas.lpjPeriksa?.n ?? 0) +
    (tugas.revisi?.n ?? 0) +
    (tugas.lpjSaya?.n ?? 0);

  return (
    <AppShell
      appName={env.APP_NAME}
      orgName={setting.orgName}
      user={{ name: user.fullName, roleLabel: ROLE_LABEL[user.role] }}
      nav={filterNav(user.role)}
      mobileShortcuts={mobileNav(user.role)}
      canCreate={can(user.role, "request.create")}
      badges={{ tindakan }}
      unread={unread}
      penanda={env.PENANDA_LINGKUNGAN}
      logoutAction={logout}
    >
      {children}
    </AppShell>
  );
}
