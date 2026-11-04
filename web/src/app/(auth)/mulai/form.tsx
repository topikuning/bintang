"use client";

import { useActionState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { HelpText, Input, Label } from "@/components/ui/field";
import { mulai, type MulaiState } from "@/lib/mulai/actions";

export function FormMulai() {
  const [state, action, pending] = useActionState<MulaiState, FormData>(mulai, undefined);
  return (
    <form action={action} className="space-y-4">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      <div>
        <Label htmlFor="orgName">Nama perusahaan / organisasi</Label>
        <Input id="orgName" name="orgName" required maxLength={120} autoFocus />
      </div>
      <div>
        <Label htmlFor="fullName">Nama Anda</Label>
        <Input id="fullName" name="fullName" required maxLength={120} />
      </div>
      <div>
        <Label htmlFor="username">Username</Label>
        <Input id="username" name="username" required autoCapitalize="none" autoComplete="username" maxLength={50} />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
        <HelpText>Minimal 8 karakter.</HelpText>
      </div>
      <div>
        <Label htmlFor="confirm">Ulangi password</Label>
        <Input id="confirm" name="confirm" type="password" required autoComplete="new-password" />
      </div>
      <Button type="submit" size="lg" className="w-full" loading={pending}>
        Buat admin & mulai
      </Button>
    </form>
  );
}
