import { Mail, KeyRound, ShieldCheck, BrainCircuit } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AutomationSettings } from "@/components/automation-settings";
import { AgentRulesEditor } from "@/components/agent-rules-editor";
import { IntegrationSettingsEditor } from "@/components/integration-settings-editor";
import { MailboxManager } from "@/components/mailbox-manager";
import { getAgentRules } from "@/lib/ai/rules";
import { getIntegrationSettingsMeta, getMailboxes } from "@/lib/data/settings-data";

export default async function SettingsPage() {
  const [emailRules, settings, mailboxes] = await Promise.all([
    getAgentRules("email"),
    getIntegrationSettingsMeta(),
    getMailboxes(),
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
            Přidej libovolný počet schránek. Pošta se z nich stahuje a automaticky třídí AI.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MailboxManager mailboxes={mailboxes} />
        </CardContent>
      </Card>

      {/* Pravidla AI agenta pošty */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BrainCircuit className="h-4 w-4 text-muted-foreground" /> {emailRules.label}
          </CardTitle>
          <CardDescription>
            Řiď agenta běžnou řečí — co má dělat, co musí <b>vždy</b> a co <b>nikdy</b>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AgentRulesEditor rules={emailRules} />
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
          <AutomationSettings />
        </CardContent>
      </Card>
    </div>
  );
}
