import Link from "next/link";
import type { Metadata } from "next";
import { AlertCircle, Settings2 } from "lucide-react";
import { AuthShell, AuthNotice } from "@/components/account/auth-shell";
import { Button } from "@/components/ui/button";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { ForgotPasswordFlow } from "./forgot-password-flow";

export const metadata: Metadata = { title: "Zapomenuté heslo — Mnástrojárna" };

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;
  const configured = isSupabaseConfigured();

  return (
    <AuthShell
      title="Zapomenuté heslo"
      subtitle="Nevadí — pošleme ti kód a nastavíš si nové heslo. Zabere to minutku."
    >
      {configured ? (
        <ForgotPasswordFlow initialEmail={typeof email === "string" ? email.slice(0, 254) : ""} />
      ) : (
        <div className="space-y-4">
          <AuthNotice tone="warning" icon={AlertCircle}>
            Systém ještě není připojen k Supabase, obnova hesla zatím nefunguje.
          </AuthNotice>
          <Button asChild className="w-full">
            <Link href="/setup">
              <Settings2 className="h-4 w-4" /> Průvodce nastavením
            </Link>
          </Button>
        </div>
      )}
    </AuthShell>
  );
}
