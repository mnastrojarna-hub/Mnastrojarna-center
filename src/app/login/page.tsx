import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertCircle, Settings2 } from "lucide-react";
import { Logo } from "@/components/logo";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signIn } from "@/app/auth/actions";
import { isSupabaseConfigured, createClient } from "@/lib/supabase/server";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const configured = isSupabaseConfigured();

  if (configured) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <Logo showSlogan />
          <p className="mt-2 text-sm text-muted-foreground">
            Přihlas se do CNC Sales OS
          </p>
        </div>

        {!configured ? (
          <Card>
            <CardContent className="space-y-4 p-6">
              <div className="flex items-start gap-2 rounded-lg bg-warning/10 p-3 text-sm">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <span>
                  Systém ještě není připojen k Supabase. Projdi krátkým průvodcem nastavením —
                  vše se nastavuje přímo v aplikaci.
                </span>
              </div>
              <Button asChild className="w-full">
                <Link href="/setup">
                  <Settings2 className="h-4 w-4" /> Spustit průvodce nastavením
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-6">
              {error && (
                <div className="mb-4 flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              <form action={signIn} className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="email" className="text-sm font-medium">E-mail</label>
                  <Input id="email" name="email" type="email" placeholder="obchod@nastrojarna.cz" required />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="password" className="text-sm font-medium">Heslo</label>
                  <Input id="password" name="password" type="password" placeholder="••••••••" required />
                </div>
                <Button type="submit" className="w-full">Přihlásit se</Button>
              </form>
            </CardContent>
          </Card>
        )}

        <p className="text-center text-xs text-muted-foreground">
          První spuštění nebo změna připojení?{" "}
          <Link href="/setup" className="text-primary hover:underline">Průvodce nastavením</Link>
        </p>
      </div>
    </div>
  );
}
