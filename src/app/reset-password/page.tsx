import Link from "next/link";
import type { Metadata } from "next";
import { AlertCircle, KeyRound, LogIn } from "lucide-react";
import { AuthShell, AuthNotice } from "@/components/account/auth-shell";
import { Button } from "@/components/ui/button";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { NewPasswordForm } from "./new-password-form";

export const metadata: Metadata = { title: "Nové heslo — Mnástrojárna" };

/** Příchod z odkazu Supabase (/auth/callback nebo /auth/confirm) → nastavení nového hesla. */
export default async function ResetPasswordPage() {
  let email: string | null = null;
  if (isSupabaseConfigured()) {
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      email = user?.email ?? null;
    } catch {
      email = null;
    }
  }

  if (!email) {
    return (
      <AuthShell title="Nové heslo" subtitle="Odkaz pro nastavení hesla už neplatí.">
        <div className="space-y-4">
          <AuthNotice tone="warning" icon={AlertCircle}>
            Odkaz z e-mailu vypršel, už byl použit, nebo byl otevřen v jiném prohlížeči. Nic se neděje —
            vyžádej si nový kód, platí 15 minut.
          </AuthNotice>
          <Button asChild variant="send" size="lg" className="h-11 w-full text-base">
            <Link href="/forgot-password">
              <KeyRound className="h-4 w-4" /> Vyžádat nový kód
            </Link>
          </Button>
          <Button asChild variant="outline" className="w-full">
            <Link href="/login">
              <LogIn className="h-4 w-4" /> Zpět na přihlášení
            </Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Nastav si nové heslo" subtitle={`Pro účet ${email}. Pak tě rovnou pustíme do Knihy zakázek.`}>
      <NewPasswordForm email={email} />
    </AuthShell>
  );
}
