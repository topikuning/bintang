import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatIDR(n: number | string | undefined | null): string {
  const num = Number(n ?? 0);
  if (!isFinite(num)) return "0";
  return num.toLocaleString("id-ID", { maximumFractionDigits: 2 });
}

export function formatDate(iso?: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleDateString("id-ID", { year: "numeric", month: "short", day: "2-digit" });
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
