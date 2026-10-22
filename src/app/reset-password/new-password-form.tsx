"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuthNotice } from "@/components/account/auth-shell";
import { PasswordInput } from "@/components/account/password-input";
import { passwordProblem } from "@/components/users/password-tools";
import { updatePasswordAfterRecovery } from "@/app/auth/password";
import { cn } from "@/lib/utils";

/** Nové heslo po kliknutí na odkaz z e-mailu (session už existuje). */
export function NewPasswordForm({ email }: { email: string }) {
  const router = useRouter();
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [visible, setVisible] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const problem = passwordProblem(password, confirm);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      const res = await updatePasswordAfterRecovery(password);
      if (!res.ok) {
        setError(res.error ?? "Heslo se nepodařilo změnit.");
        return;
      }
      setDone(true);
      router.push("/orders");
      router.refresh();
    } catch {
      setError("Spojení se nepovedlo — zkontroluj internet a zkus to znovu.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="space-y-3 py-2 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success/15 text-success">
          <CheckCircle2 className="h-7 w-7" />
        </div>
        <p className="font-semibold">Heslo je změněné</p>
        <p className="text-sm text-muted-foreground">Přesměrovávám do Knihy zakázek…</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {/* skryté uživatelské jméno — správce hesel ho uloží ke správnému účtu */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      {error && (
        <AuthNotice tone="error" icon={AlertCircle}>
          {error}
        </AuthNotice>
      )}
      <div className="space-y-1.5">
        <label htmlFor="new-password" className="text-sm font-medium">Nové heslo</label>
        <PasswordInput
          id="new-password"
          autoComplete="new-password"
          autoFocus
          placeholder="alespoň 8 znaků"
          className="h-11 text-base sm:text-sm"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          visible={visible}
          onVisibleChange={setVisible}
          showStrength
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="new-password-confirm" className="text-sm font-medium">Nové heslo znovu</label>
        <PasswordInput
          id="new-password-confirm"
          autoComplete="new-password"
          placeholder="pro kontrolu"
          className={cn(
            "h-11 text-base sm:text-sm",
            confirm && confirm !== password && "border-destructive focus-visible:ring-destructive",
          )}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          visible={visible}
          onVisibleChange={setVisible}
        />
        {confirm && confirm !== password && <p className="text-xs text-destructive">Hesla se zatím neshodují.</p>}
      </div>
      <Button type="submit" variant="success" size="lg" className="h-11 w-full text-base" disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
        Uložit nové heslo
      </Button>
    </form>
  );
}
