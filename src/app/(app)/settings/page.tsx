import type { ComponentProps } from "react";
import Link from "next/link";
import {
  Mail, KeyRound, Database, ArrowRight, SlidersHorizontal, FileUp, Users, Sparkles, ShieldCheck, ScrollText, EyeOff,
} from "lucide-react";
import { DrawingAnonSettings } from "@/components/settings/drawing-anon-settings";
import { getAnonSettingsPanel } from "@/lib/data/anonymize";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IntegrationSettingsEditor } from "@/components/integration-settings-editor";
import { MailboxManager } from "@/components/mailbox-manager";
import { OutlookImport } from "@/components/outlook-import";
import { getIntegrationSettingsMeta, getMailboxes, getUsers } from "@/lib/data/settings-data";
import { getAccess, requireFeature } from "@/lib/auth/session";
import { isSupabaseConfigured, hasServiceKey } from "@/lib/supabase/server";
import { getSupabaseEnv } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  // Data se čtou servisním klíčem → nejdřív oprávnění
  await requireFeature("settings");
  const [settings, mailboxes, users, anon, access] = await Promise.all([
    getIntegrationSettingsMeta(),
    getMailboxes(),
    getUsers(),
    getAnonSettingsPanel(),
    getAccess(),
  ]);
  const configured = isSupabaseConfigured();
  const serviceKey = hasServiceKey();
  const { url } = getSupabaseEnv();
  // Parametry kalkulace se ladí v Nacenění / Ladění & korekce, AI přístup v Uživatelích — tady jen systém
  const systemSettings = settings.filter((s) => s.category !== "pricing" && s.category !== "ai_access" && s.key !== "quote_approval_limit");
  // Vlastník schránky = uživatel, který vidí její poštu
  const mailboxUsers = users.map((u) => ({ id: u.id, full_name: u.full_name || u.email || "Bez jména", email: u.email }));
  // MailboxManager bere { mailboxes, users } (výběr vlastníka schránky); cast drží kompatibilitu i se starší signaturou
  const mailboxProps = { mailboxes, users: mailboxUsers } as ComponentProps<typeof MailboxManager>;

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

      {/* Schvalování nabídek (#25: limit částky zrušen — kolegy schvaluje super admin vždy) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" /> Schvalování nabídek
          </CardTitle>
          <CardDescription>
            Kdo a kdy nabídku schválil, je vidět u každé nabídky. Fronta „Ke schválení“ je v Nabídkách a v AI přehledu.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground" data-approval-limit-retired>
            Nabídky kolegů schvaluje super admin vždy, tvoje nabídky schválení nepotřebují — limit částky se už nepoužívá.
          </p>
        </CardContent>
      </Card>

      {/* Anonymizace výkresů pro dodavatele */}
      {anon && (
        <Card id="anonymizace">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <EyeOff className="h-4 w-4 text-muted-foreground" /> Anonymizace výkresů
            </CardTitle>
            <CardDescription>
              Z výkresů pro dodavatele se smaže firma, kdo kreslil, logo a cesty na disk — technické údaje zůstanou.
              Běží automaticky u výkresů z e-mailu, fotek i nahraných souborů; ručně tlačítkem v Poptávkách.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DrawingAnonSettings {...anon} canEdit={access.user?.role === "super_admin"} />
          </CardContent>
        </Card>
      )}

      {/* Audit — samostatná stránka */}
      <Link href="/settings/audit" className="group block">
        <Card className="transition-all group-hover:-translate-y-0.5 group-hover:border-teal-500/30 group-hover:shadow-md">
          <CardContent className="flex items-center gap-4 p-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-500/10 text-teal-600">
              <ScrollText className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">Audit — kdo, kdy a co změnil</div>
              <div className="text-sm text-muted-foreground">
                Všechny změny nastavení, uživatelů, adresáře a mazání s autorem — filtr podle osoby, entity a období.
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </CardContent>
        </Card>
      </Link>

      {/* Uživatelé — samostatná stránka */}
      <Link href="/users" className="group block">
        <Card className="transition-all group-hover:-translate-y-0.5 group-hover:border-rose-500/30 group-hover:shadow-md">
          <CardContent className="flex items-center gap-4 p-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/10 text-rose-500">
              <Users className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">Uživatelé, role, hesla a AI přístup</div>
              <div className="text-sm text-muted-foreground">
                Přidání účtů, přiřazení schránek, obnova hesla a kdo smí používat AI čtení dokladů.
              </div>
            </div>
            <Badge variant="outline" className="hidden gap-1 sm:inline-flex">
              <Sparkles className="h-3 w-3 text-violet-500" /> {users.length} {users.length === 1 ? "uživatel" : users.length >= 2 && users.length <= 4 ? "uživatelé" : "uživatelů"}
            </Badge>
            <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </CardContent>
        </Card>
      </Link>

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
          <MailboxManager {...mailboxProps} />
        </CardContent>
      </Card>

      {/* Import e-mailů z Outlooku */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileUp className="h-4 w-4 text-muted-foreground" /> Import e-mailů z Outlooku
          </CardTitle>
          <CardDescription>
            Nahraj kompletní e-maily exportované z Outlooku (.msg / .eml). AI je zpracuje stejně jako
            staženou poštu — roztřídí, propojí se zákazníkem a připraví návrh odpovědi.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OutlookImport />
        </CardContent>
      </Card>
    </div>
  );
}
