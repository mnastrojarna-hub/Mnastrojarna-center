import Link from "next/link";
import { Mail, KeyRound, Database, ArrowRight, SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IntegrationSettingsEditor } from "@/components/integration-settings-editor";
import { MailboxManager } from "@/components/mailbox-manager";
import { getIntegrationSettingsMeta, getMailboxes } from "@/lib/data/settings-data";
import { isSupabaseConfigured, hasServiceKey } from "@/lib/supabase/server";
import { getSupabaseEnv } from "@/lib/supabase/config";

export default async function SettingsPage() {
  const [settings, mailboxes] = await Promise.all([
    getIntegrationSettingsMeta(),
    getMailboxes(),
  ]);
  const configured = isSupabaseConfigured();
  const serviceKey = hasServiceKey();
  const { url } = getSupabaseEnv();
  // Parametry kalkulace se ladí v Nacenění / Ladění & korekce — tady jen systém
  const systemSettings = settings.filter((s) => s.category !== "pricing");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nastavení"
        description="Připojení, klíče, firemní údaje a schránky. Ladění AI najdeš v sekci Ladění & korekce."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/tuning">
              <SlidersHorizontal className="h-4 w-4" /> Ladění &amp; korekce
            </Link>
          </Button>
        }
      />

      {/* Připojení Supabase */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4 text-muted-foreground" /> Připojení Supabase
          </CardTitle>
          <CardDescription>
            Databáze, přihlašování a úložiště. Připojení se nastavuje v průvodci — funguje na
            localhostu i na Vercelu.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Badge variant={configured ? "success" : "destructive"}>
            {configured ? "připojeno" : "nepřipojeno"}
          </Badge>
          <Badge variant={serviceKey ? "success" : "warning"}>
            {serviceKey ? "servisní klíč nastaven" : "servisní klíč chybí"}
          </Badge>
          {configured && url && (
            <span className="text-sm text-muted-foreground">{url}</span>
          )}
          <Button variant="outline" size="sm" asChild className="ml-auto">
            <Link href="/setup">
              Otevřít průvodce nastavením <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>

      {/* API klíče, firma a integrace */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 text-muted-foreground" /> API klíče, firemní údaje a integrace
          </CardTitle>
          <CardDescription>
            Claude API, firemní údaje na doklady a globální e-mailové klíče. Tajné klíče se
            ukládají bezpečně na serveru (jen super admin) a nezobrazují se zpět.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <IntegrationSettingsEditor settings={systemSettings} />
        </CardContent>
      </Card>

      {/* Schránky */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4 text-muted-foreground" /> E-mailové schránky
          </CardTitle>
          <CardDescription>
            Každá schránka má vlastní servery příchozí (IMAP) a odchozí (SMTP) pošty, porty
            a heslo. Připojení si můžeš rovnou otestovat. Bez vlastních serverů platí globální
            klíče výše.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MailboxManager mailboxes={mailboxes} />
        </CardContent>
      </Card>
    </div>
  );
}
