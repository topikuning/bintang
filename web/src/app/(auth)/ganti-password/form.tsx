"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { HelpText, Input, Label } from "@/components/ui/field";
import { changePassword, type ChangePasswordState } from "@/lib/auth/actions";

export function ChangePasswordForm({ wajib }: { wajib: boolean }) {
  const [state, action, pending] = useActionState<ChangePasswordState, FormData>(changePassword, undefined);
  return (
    <form action={action} className="space-y-4">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      <div>
        <Label htmlFor="currentPassword">Password sekarang</Label>
        <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
      </div>
      <div>
        <Label htmlFor="newPassword">Password baru</Label>
        <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" minLength={8} required />
        <HelpText>Minimal 8 karakter. Gabungan kata yang mudah Anda ingat lebih aman daripada kata pendek yang rumit.</HelpText>
      </div>
      <div>
        <Label htmlFor="confirmPassword">Ulangi password baru</Label>
        <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required />
      </div>
      <Button type="submit" size="lg" className="w-full" loading={pending}>
        Simpan password
      </Button>
      {!wajib ? (
        <p className="text-center">
          <Link href="/" className="text-[13px] text-ink-muted hover:text-ink">
            Batal, kembali ke beranda
          </Link>
        </p>
      ) : null}
    </form>
  );
}
