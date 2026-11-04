import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { FormMulai } from "./form";

export const metadata: Metadata = { title: "Mulai" };
export const dynamic = "force-dynamic";

export default async function MulaiPage() {
  if ((await db.user.count()) > 0) redirect("/masuk");
  return (
    <>
      <h1 className="mb-1 text-base font-semibold text-ink">Selamat datang</h1>
      <p className="mb-5 text-[13px] text-ink-muted">Buat akun Admin Sistem pertama. Layar ini hanya muncul sekali, saat belum ada pengguna.</p>
      <FormMulai />
    </>
  );
}
