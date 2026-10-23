"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/account/password-input";
import { passwordProblem } from "@/components/users/password-tools";
import { changeOwnPassword } from "@/app/auth/password";
import { cn } from "@/lib/utils";

/** Změna vlastního hesla: současné + nové + potvrzení. */
export function ChangePasswordForm({ email }: { email: string }) {
  const router = useRouter();
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [visible, setVisible] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus(null);
    if (!current) return setStatus({ ok: false, text: "Zadej současné heslo." });
    const problem = passwordProblem(next, confirm);
    if (problem) return setStatus({ ok: false, text: problem });
    setBusy(true);
    try {
      const res = await changeOwnPassword(current, next);
      if (!res.ok) setStatus({ ok: false, text: res.error ?? "Heslo se nepodařilo změnit." });
      else if (res.signedOut) {
        // relace skončila se změnou hesla a nové přihlášení se nepovedlo → přihlásit znovu
        router.push(`/login?reset=1&email=${encodeURIComponent(email)}`);
      } else {
        setStatus({ ok: true, text: "Heslo je změněné. Příště se přihlas novým heslem." });
        setCurrent("");
        setNext("");
        setConfirm("");
        router.refresh(); // zruší výzvu ke změně počátečního hesla
      }
    } catch {
      setStatus({ ok: false, text: "Spojení se nepovedlo — zkus to znovu." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <div className="space-y-1.5">
        <label htmlFor="pw-current" className="text-sm font-medium">Současné heslo</label>
        <PasswordInput
          id="pw-current"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="pw-new" className="text-sm font-medium">Nové heslo</label>
          <PasswordInput
            id="pw-new"
            autoComplete="new-password"
            placeholder="alespoň 8 znaků"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            visible={visible}
            onVisibleChange={setVisible}
            showStrength
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="pw-confirm" className="text-sm font-medium">Nové heslo znovu</label>
          <PasswordInput
            id="pw-confirm"
            autoComplete="new-password"
            placeholder="pro kontrolu"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            visible={visible}
            onVisibleChange={setVisible}
            className={cn(confirm && confirm !== next && "border-destructive focus-visible:ring-destructive")}
          />
          {confirm && confirm !== next && <p className="text-xs text-destructive">Hesla se zatím neshodují.</p>}
        </div>
      </div>

      {status && (
        <div
          role={status.ok ? "status" : "alert"}
          className={cn(
            "flex items-start gap-2 rounded-lg border p-3 text-sm",
            status.ok ? "border-success/25 bg-success/10 text-success" : "border-destructive/25 bg-destructive/10 text-destructive",
          )}
        >
          {status.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>{status.text}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="submit" variant="success" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Změnit heslo
        </Button>
        <Link
          href={`/forgot-password?email=${encodeURIComponent(email)}`}
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Nevíš současné heslo? Pošli si kód
        </Link>
      </div>
    </form>
  );
}
