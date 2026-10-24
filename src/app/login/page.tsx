import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertCircle, CheckCircle2, Settings2, LogIn, LogOut, Mail } from "lucide-react";
import { AuthShell, AuthNotice } from "@/components/account/auth-shell";
import { PasswordInput } from "@/components/account/password-input";
import { SubmitButton } from "@/components/account/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signIn, signOut } from "@/app/auth/actions";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { prefillEmail, safeNextPath } from "@/lib/auth/login-diagnosis";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reset?: string; email?: string; next?: string }>;
}) {
  const { error, reset, email: emailParam, next: nextParam } = await searchParams;
  // odkaz, ze kterého přihlášení přišlo (např. „Otevřít nabídku“ z e-mailu) — po přihlášení tam
  const next = safeNextPath(nextParam);
  // Po neúspěšném pokusu zůstane v poli e-mail, který uživatel opravdu odeslal
  // (prohlížeč ho jinak přepíše uloženým účtem — typicky super admina).
  const email = prefillEmail(emailParam);
  const configured = isSupabaseConfigured();

  // Aktivní přihlášený uživatel rovnou do Knihy zakázek. Neaktivní zůstane
  // tady (jinak by se točil mezi /login a /orders) a může se odhlásit.
  const user = configured ? await getSessionUser() : null;
  if (user?.active) redirect(next ?? "/orders");
  const inactiveSession = Boolean(user && !user.active);

  return (
    <AuthShell
      title={configured ? "Vítej zpátky" : "Vítej v CNC Sales OS"}
      subtitle={configured ? "Přihlas se do Knihy zakázek." : "Nejdřív připojíme databázi — zabere to pár minut."}
      showHints
    >
      {!configured ? (
        <div className="space-y-4">
          <AuthNotice tone="warning" icon={AlertCircle}>
            Systém ještě není připojen k Supabase. Projdi krátkým průvodcem nastavením — vše se nastavuje
            přímo v aplikaci.
          </AuthNotice>
          <Button asChild className="w-full" size="lg">
            <Link href="/setup">
              <Settings2 className="h-4 w-4" /> Spustit průvodce nastavením
            </Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {reset === "1" && (
            <AuthNotice tone="success" icon={CheckCircle2}>
              Heslo bylo změněno — přihlas se novým heslem.
            </AuthNotice>
          )}
          {error && (
            <AuthNotice tone="error" icon={AlertCircle}>
              {error}
            </AuthNotice>
          )}
          {inactiveSession && (
            <form action={signOut}>
              <AuthNotice tone="warning" icon={AlertCircle}>
                <div className="space-y-2">
                  <p>
                    Jsi přihlášen(a) jako <strong>{user?.email}</strong>, ale účet zatím není aktivní.
                    Požádej super admina o aktivaci, nebo se přihlas jiným účtem.
                  </p>
                  <Button type="submit" variant="outline" size="sm">
                    <LogOut className="h-4 w-4" /> Odhlásit se
                  </Button>
                </div>
              </AuthNotice>
            </form>
          )}

          <form key={`${error ?? ""}|${email}`} action={signIn} className="space-y-4">
            {next && <input type="hidden" name="next" value={next} />}
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-sm font-medium">E-mail</label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  defaultValue={email}
                  placeholder="jmeno@mnastrojarna.cz"
                  className="h-11 pl-9 text-base sm:text-sm"
                  required
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="password" className="text-sm font-medium">Heslo</label>
                <Link
                  href="/forgot-password"
                  className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                >
                  Zapomenuté heslo?
                </Link>
              </div>
              <PasswordInput
                id="password"
                name="password"
                autoComplete="current-password"
                placeholder="••••••••"
                className="h-11 text-base sm:text-sm"
                required
              />
            </div>
            <SubmitButton className="h-11 w-full text-base" pendingText="Přihlašuji…">
              <LogIn className="h-4 w-4" /> Přihlásit se
            </SubmitButton>
          </form>

          <p className="text-center text-xs text-muted-foreground">
            Účet ti založí super admin. Nemáš ho ještě? Ozvi se mu.
          </p>
        </div>
      )}

      <p className="border-t pt-4 text-center text-xs text-muted-foreground">
        První spuštění nebo změna připojení?{" "}
        <Link href="/setup" className="font-medium text-primary hover:underline">Průvodce nastavením</Link>
      </p>
    </AuthShell>
  );
}
