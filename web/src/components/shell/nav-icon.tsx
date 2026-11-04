import {
  BarChart3,
  Database,
  FolderKanban,
  History,
  Home,
  Send,
  Settings,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { IconKey } from "./nav-config";

const ICONS: Record<IconKey, LucideIcon> = {
  home: Home,
  send: Send,
  wallet: Wallet,
  folder: FolderKanban,
  chart: BarChart3,
  database: Database,
  users: Users,
  settings: Settings,
  history: History,
};

export function NavIcon({ icon, className }: { icon: IconKey; className?: string }) {
  const I = ICONS[icon];
  return <I aria-hidden className={className} />;
}
