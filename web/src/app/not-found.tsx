import { SearchX } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-primary-50">
        <SearchX aria-hidden className="size-6 text-primary-600" />
      </div>
      <h1 className="mt-4 text-lg font-semibold">Halaman tidak ditemukan</h1>
      <p className="mt-1 max-w-sm text-sm text-ink-muted">Mungkin sudah dihapus, alamatnya salah, atau Anda tidak punya akses ke sana.</p>
      <Link href="/" className="mt-5 inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-white">
        Ke beranda
      </Link>
    </div>
  );
}
