import type { ReactNode } from "react";
import { BrandMark } from "@/components/shell/brand";

export default function AuthLayout({ children }: { children: ReactNode }) {
  const app = process.env.APP_NAME || "Bintang";
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-10">
      {/* Latar: pendar lembut indigo + emas, tanpa gambar. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60rem 30rem at 10% -10%, rgb(99 102 241 / 0.14), transparent 60%), radial-gradient(40rem 24rem at 100% 110%, rgb(245 158 11 / 0.12), transparent 60%)",
        }}
      />
      <div className="mb-6 flex flex-col items-center gap-3 text-center">
        <BrandMark className="size-12 rounded-xl" />
        <div>
          <p className="text-xl font-semibold tracking-tight text-ink">{app}</p>
          <p className="text-[13px] text-ink-muted">Pengajuan pembayaran & buku kas proyek</p>
        </div>
      </div>
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-5 shadow-(--shadow-card) sm:p-6">
        {children}
      </div>
    </div>
  );
}
