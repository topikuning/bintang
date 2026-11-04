import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Masuk" };

export default async function MasukPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const user = await getCurrentUser();
  if (user) redirect("/");
  const { next } = await searchParams;
  return (
    <>
      <h1 className="mb-1 text-base font-semibold text-ink">Masuk</h1>
      <p className="mb-5 text-[13px] text-ink-muted">Pakai username atau email yang diberikan admin.</p>
      <LoginForm next={next} />
    </>
  );
}
