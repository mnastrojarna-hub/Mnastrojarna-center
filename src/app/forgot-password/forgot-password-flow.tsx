"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle, ArrowLeft, CheckCircle2, KeyRound, Loader2, Mail, MailCheck, RotateCw, Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthNotice } from "@/components/account/auth-shell";
import { PasswordInput } from "@/components/account/password-input";
import { passwordProblem } from "@/components/users/password-tools";
import { requestPasswordReset, resetPasswordWithCode } from "@/app/auth/password";
import { cn } from "@/lib/utils";

const RESEND_COOLDOWN_S = 60;

type Step = "email" | "code" | "done";
type Channel = "code" | "supabase";

/**
 * Zapomenuté heslo ve dvou krocích na jedné stránce (bez reloadu):
 * 1) e-mail → kód, 2) kód + nové heslo → přihlášení a Kniha zakázek.
 */
export function ForgotPasswordFlow({ initialEmail = "" }: { initialEmail?: string }) {
  const router = useRouter();
  const [step, setStep] = React.useState<Step>("email");
  const [channel, setChannel] = React.useState<Channel>("code");
  const [email, setEmail] = React.useState(initialEmail);
  const [code, setCode] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [visible, setVisible] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [resent, setResent] = React.useState(false);
  const [cooldownUntil, setCooldownUntil] = React.useState(0);
  const [now, setNow] = React.useState(() => Date.now());
  const codeRef = React.useRef<HTMLInputElement>(null);

  const secondsLeft = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));

  React.useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [cooldownUntil]);

  React.useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  const sendCode = async (isResend: boolean) => {
    setBusy(true);
    setError(null);
    setResent(false);
    try {
      const res = await requestPasswordReset(email);
      if (!res.ok) {
        setError(res.error ?? "Kód se nepodařilo odeslat.");
        return;
      }
      setChannel(res.channel ?? "code");
      setCooldownUntil(Date.now() + RESEND_COOLDOWN_S * 1000);
      setNow(Date.now());
      setStep("code");
      if (isResend) setResent(true);
    } catch {
      setError("Spojení se nepovedlo — zkontroluj internet a zkus to znovu.");
    } finally {
      setBusy(false);
    }
  };

  const submitEmail = (e: React.FormEvent) => {
    e.preventDefault();
    void sendCode(false);
  };

  const submitReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const digits = code.replace(/\D/g, "");
    if (digits.length < 6) {
      setError("Zadej 6místný kód z e-mailu.");
      codeRef.current?.focus();
      return;
    }
    const problem = passwordProblem(password, confirm);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      const res = await resetPasswordWithCode(email, digits, password);
      if (!res.ok) {
        setError(res.error ?? "Heslo se nepodařilo změnit.");
        return;
      }
      setStep("done");
      if (res.signedIn) {
        router.push("/orders");
        router.refresh();
      } else {
        router.push("/login?reset=1");
      }
    } catch {
      setError("Spojení se nepovedlo — zkontroluj internet a zkus to znovu.");
    } finally {
      setBusy(false);
    }
  };

  if (step === "done") {
    return (
      <div className="space-y-4 py-2 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success/15 text-success">
          <CheckCircle2 className="h-7 w-7" />
        </div>
        <div className="space-y-1">
          <p className="font-semibold">Heslo je změněné</p>
          <p className="text-sm text-muted-foreground">Přesměrovávám…</p>
        </div>
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Steps step={step} />

      {error && (
        <AuthNotice tone="error" icon={AlertCircle}>
          {error}
        </AuthNotice>
      )}

      {step === "email" ? (
        <form onSubmit={submitEmail} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <label htmlFor="reset-email" className="text-sm font-medium">E-mail k účtu</label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="reset-email"
                type="email"
                inputMode="email"
                autoComplete="username"
                autoCapitalize="none"
                autoFocus
                placeholder="jmeno@mnastrojarna.cz"
                className="h-11 pl-9 text-base sm:text-sm"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <p className="text-xs text-muted-foreground">Pošleme ti 6místný kód, který platí 15 minut.</p>
          </div>
          <Button type="submit" variant="send" size="lg" className="h-11 w-full text-base" disabled={busy || !email.trim()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Poslat kód
          </Button>
        </form>
      ) : (
        <form onSubmit={submitReset} className="space-y-4" noValidate>
          <AuthNotice tone="info" icon={MailCheck}>
            {channel === "code" ? (
              <>
                Pokud účet s e-mailem <strong className="break-all">{email.trim()}</strong> existuje, poslali jsme na
                něj kód. Mrkni i do spamu.
              </>
            ) : (
              <>
                Pokud účet s e-mailem <strong className="break-all">{email.trim()}</strong> existuje, poslali jsme na
                něj e-mail s <strong>odkazem</strong> pro nastavení nového hesla. Stačí na odkaz kliknout — nebo
                sem opiš kód, pokud ho e-mail obsahuje.
              </>
            )}
          </AuthNotice>
          {resent && (
            <AuthNotice tone="success" icon={CheckCircle2}>
              Poslali jsme nový kód — platí jen ten nejnovější.
            </AuthNotice>
          )}

          <div className="space-y-1.5">
            <label htmlFor="reset-code" className="text-sm font-medium">Kód z e-mailu</label>
            <Input
              id="reset-code"
              ref={codeRef}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={10}
              placeholder="000000"
              className="h-14 text-center font-mono text-3xl font-bold tracking-[0.45em] placeholder:text-muted-foreground/40"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 10))}
              aria-describedby="reset-code-hint"
            />
            <p id="reset-code-hint" className="text-xs text-muted-foreground">6 číslic, platí 15 minut.</p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="reset-password" className="text-sm font-medium">Nové heslo</label>
            <PasswordInput
              id="reset-password"
              autoComplete="new-password"
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
            <label htmlFor="reset-confirm" className="text-sm font-medium">Nové heslo znovu</label>
            <PasswordInput
              id="reset-confirm"
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
            Nastavit nové heslo a přihlásit
          </Button>

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <button
              type="button"
              onClick={() => {
                setStep("email");
                setError(null);
                setCode("");
                setResent(false);
              }}
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Jiný e-mail
            </button>
            <button
              type="button"
              onClick={() => void sendCode(true)}
              disabled={busy || secondsLeft > 0}
              className="inline-flex items-center gap-1 font-medium text-primary disabled:cursor-not-allowed disabled:text-muted-foreground"
            >
              <RotateCw className="h-3.5 w-3.5" />
              {secondsLeft > 0 ? `Poslat znovu za ${secondsLeft} s` : "Poslat kód znovu"}
            </button>
          </div>
        </form>
      )}

      <p className="border-t pt-4 text-center text-sm text-muted-foreground">
        Vzpomněl(a) sis?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">Zpět na přihlášení</Link>
      </p>
    </div>
  );
}

function Steps({ step }: { step: Step }) {
  const items = [
    { key: "email", label: "E-mail" },
    { key: "code", label: "Kód a nové heslo" },
  ];
  const activeIndex = step === "email" ? 0 : 1;
  return (
    <ol className="flex items-center gap-2 text-xs font-medium">
      {items.map((it, i) => (
        <li key={it.key} className="flex flex-1 items-center gap-2">
          <span
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-colors",
              i < activeIndex && "bg-success text-success-foreground",
              i === activeIndex && "bg-primary text-primary-foreground",
              i > activeIndex && "bg-muted text-muted-foreground",
            )}
          >
            {i < activeIndex ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
          </span>
          <span className={cn(i === activeIndex ? "text-foreground" : "text-muted-foreground")}>{it.label}</span>
          {i < items.length - 1 && <span className="h-px flex-1 bg-border" />}
        </li>
      ))}
    </ol>
  );
}
