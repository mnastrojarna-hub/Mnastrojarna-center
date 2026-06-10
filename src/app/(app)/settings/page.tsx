import Link from "next/link";
import { Mail, KeyRound, ShieldCheck, BrainCircuit, Database, ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AutomationSettings } from "@/components/automation-settings";
import { AgentRulesEditor } from "@/components/agent-rules-editor";
import { IntegrationSettingsEditor } from "@/components/integration-settings-editor";
import { MailboxManager } from "@/components/mailbox-manager";
import { getAllAgentRules } from "@/lib/ai/rules";
import { getRecentCorrections } from "@/lib/ai/corrections";
import { getIntegrationSettingsMeta, getMailboxes } from "@/lib/data/settings-data";
import { getAllModuleModes } from "@/lib/automation";
import { CorrectionsList } from "@/components/corrections-list";
import { GraduationCap } from "lucide-react";
import { isSupabaseConfigured, hasServiceKey } from "@/lib/supabase/server";
import { getSupabaseEnv } from "@/lib/supabase/config";

export default async function SettingsPage() {
  const [agentRules, settings, mailboxes, moduleModes, corrections] = await Promise.all([
    getAllAgentRules(),
    getIntegrationSettingsMeta(),
    getMailboxes(),
    getAllModuleModes(),
    getRecentCorrections(),
  ]);
  const configured = isSupabaseConfigured();
  const serviceKey = hasServiceKey();
  const { url } = getSupabaseEnv();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nastavení"
        description="Schránky, API klíče, pravidla AI a režim automatizace."
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

      {/* API klíče a integrace */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 text-muted-foreground" /> API klíče a integrace
          </CardTitle>
          <CardDescription>
            Claude API, IMAP (hosting90) a Microsoft 365. Tajné klíče se ukládají bezpečně na serveru
            (jen super admin) a nezobrazují se zpět.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <IntegrationSettingsEditor settings={settings} />
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

      {/* Pravidla AI agentů — řízení slovními příkazy */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BrainCircuit className="h-4 w-4 text-muted-foreground" /> Pravidla AI agentů
          </CardTitle>
          <CardDescription>
            Laď každého agenta běžnou řečí — co má dělat, co musí <b>vždy</b> a co <b>nikdy</b>.
            Platí pro třídění pošty, oceňování dle výkresu (jako technolog), nabídky i potvrzení.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue={agentRules[0]?.agent_key}>
            <TabsList className="mb-4 flex-wrap">
              {agentRules.map((r) => (
                <TabsTrigger key={r.agent_key} value={r.agent_key}>{r.label}</TabsTrigger>
              ))}
            </TabsList>
            {agentRules.map((r) => (
              <TabsContent key={r.agent_key} value={r.agent_key}>
                <AgentRulesEditor rules={r} />
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>

      {/* Naučené korekce */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <GraduationCap className="h-4 w-4 text-muted-foreground" /> Naučené korekce
          </CardTitle>
          <CardDescription>
            Tvoje opravy výstupů AI. Vkládají se do promptů, takže AI stejnou chybu v plné automatice neudělá.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CorrectionsList corrections={corrections} />
        </CardContent>
      </Card>

      {/* Režim automatizace per modul */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" /> Režim automatizace
          </CardTitle>
          <CardDescription>
            Pro každou činnost zvol, zda ji AI provede sama (100 %), nebo počká na tvé schválení.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AutomationSettings initial={moduleModes} />
        </CardContent>
      </Card>
    </div>
  );
}
