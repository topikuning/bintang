"use client";

import { Eye, EyeOff } from "lucide-react";
import { useActionState, useState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { login, type LoginState } from "@/lib/auth/actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, undefined);
  const [lihat, setLihat] = useState(false);
  return (
    <form action={action} className="space-y-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      <div>
        <Label htmlFor="identifier">Username atau email</Label>
        <Input
          id="identifier"
          name="identifier"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          autoFocus
        />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={lihat ? "text" : "password"}
            autoComplete="current-password"
            required
            className="pr-11"
          />
          <button
            type="button"
            onClick={() => setLihat((v) => !v)}
            aria-label={lihat ? "Sembunyikan password" : "Tampilkan password"}
            className="absolute top-1/2 right-1 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-ink-muted hover:text-ink"
          >
            {lihat ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
          </button>
        </div>
      </div>
      <Button type="submit" size="lg" className="w-full" loading={pending}>
        {pending ? "Memeriksa…" : "Masuk"}
      </Button>
      <p className="text-center text-[12px] text-ink-faint">Lupa password? Minta admin untuk meresetnya.</p>
    </form>
  );
}
