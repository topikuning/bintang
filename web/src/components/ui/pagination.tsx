import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";

/** Navigasi halaman sederhana; `buat(page)` membentuk URL dengan filter yang sama. */
export function Pagination({
  page,
  pages,
  total,
  href,
}: {
  page: number;
  pages: number;
  total: number;
  href: (page: number) => string;
}) {
  if (pages <= 1) return null;
  const tombol = "inline-flex h-9 items-center gap-1 rounded-md border border-border bg-surface px-3 text-[13px] font-medium";
  return (
    <nav aria-label="Halaman" className="mt-4 flex items-center justify-between gap-3">
      <p className="text-[13px] text-ink-muted">
        Halaman {page} dari {pages} · {total} data
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className={cn(tombol, "hover:bg-surface-muted")}>
            <ChevronLeft aria-hidden className="size-4" /> Sebelumnya
          </Link>
        ) : null}
        {page < pages ? (
          <Link href={href(page + 1)} className={cn(tombol, "hover:bg-surface-muted")}>
            Berikutnya <ChevronRight aria-hidden className="size-4" />
          </Link>
        ) : null}
      </div>
    </nav>
  );
}

/** Bangun query string dari objek, abaikan nilai kosong. */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}
