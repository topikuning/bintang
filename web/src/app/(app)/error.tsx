"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import Link from "next/link";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-danger-soft">
        <TriangleAlert aria-hidden className="size-6 text-danger" />
      </div>
      <h1 className="mt-4 text-lg font-semibold">Halaman ini gagal dimuat</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Biasanya karena koneksi putus sebentar. Coba muat ulang; kalau terus terjadi, kirimkan kode ini ke admin:
      </p>
      {error.digest ? <code className="mt-2 inline-block rounded bg-surface-inset px-2 py-1 text-xs">{error.digest}</code> : null}
      <div className="mt-5 flex justify-center gap-2">
        <button type="button" onClick={reset} className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white">
          <RotateCcw aria-hidden className="size-4" /> Coba lagi
        </button>
        <Link href="/" className="inline-flex h-10 items-center rounded-md border border-border bg-surface px-4 text-sm font-medium">
          Ke beranda
        </Link>
      </div>
    </div>
  );
}
