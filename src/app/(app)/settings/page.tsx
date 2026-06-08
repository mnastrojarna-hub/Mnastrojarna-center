import { Mail, KeyRound, ShieldCheck, BrainCircuit } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AutomationSettings } from "@/components/automation-settings";
import { AgentRulesEditor } from "@/components/agent-rules-editor";
import { IntegrationSettingsEditor } from "@/components/integration-settings-editor";
import { MailboxManager } from "@/components/mailbox-manager";
import { getAgentRules, getAllAgentRules } from "@/lib/ai/rules";
import { getIntegrationSettingsMeta, getMailboxes } from "@/lib/data/settings-data";
import { getAllModuleModes } from "@/lib/automation";

export default async function SettingsPage() {
  const [agentRules, settings, mailboxes, moduleModes] = await Promise.all([
    getAllAgentRules(),
    getIntegrationSettingsMeta(),
    getMailboxes(),
    getAllModuleModes(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nastavení"
        description="Schránky, API klíče, pravidla AI a režim automatizace."
      />

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
            Evidence schránek. Stahování pošty zatím probíhá přes globální přístup (IMAP/Microsoft 365)
            zadaný výše v sekci API klíče.
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
