import type { ReactNode } from "react";

/** Halaman cetak: tanpa shell aplikasi, kertas A4. */
export default function CetakLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-surface-inset py-6 print:bg-white print:py-0">
      <style>{`@page { size: A4; margin: 14mm 14mm 16mm; }`}</style>
      {children}
    </div>
  );
}
