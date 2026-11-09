import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { ChangePasswordForm } from "./form";

export const metadata: Metadata = { title: "Ganti password" };

export default async function GantiPasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/masuk");
  return (
    <>
      <h1 className="mb-1 text-base font-semibold text-ink">Ganti password</h1>
      <p className="mb-5 text-[13px] text-ink-muted">
        {user.mustChangePassword
          ? `Halo ${user.fullName.split(" ")[0]}, demi keamanan ganti dulu password sementara Anda.`
          : "Semua perangkat lain akan otomatis keluar setelah password diganti."}
      </p>
      <ChangePasswordForm wajib={user.mustChangePassword} />
    </>
  );
}
