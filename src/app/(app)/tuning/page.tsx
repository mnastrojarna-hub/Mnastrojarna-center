import { BrainCircuit, GraduationCap, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AutomationSettings } from "@/components/automation-settings";
import { AgentRulesEditor } from "@/components/agent-rules-editor";
import { IntegrationSettingsEditor } from "@/components/integration-settings-editor";
import { CorrectionsList } from "@/components/corrections-list";
import { getAllAgentRules } from "@/lib/ai/rules";
import { getRecentCorrections } from "@/lib/ai/corrections";
import { getIntegrationSettingsMeta } from "@/lib/data/settings-data";
import { getAllModuleModes } from "@/lib/automation";

/**
 * Ladění & korekce — mikromanagement AI, dokud se vše nenaučí:
 * pravidla agentů řečí, parametry kalkulace, naučené korekce a režim automatizace.
 */
export default async function TuningPage() {
  const [agentRules, settings, moduleModes, corrections] = await Promise.all([
    getAllAgentRules(),
    getIntegrationSettingsMeta(),
    getAllModuleModes(),
    getRecentCorrections(),
  ]);
  const pricingParams = settings.filter((s) => s.category === "pricing");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ladění & korekce"
        description="Tady AI vychováváš: pravidla běžnou řečí, parametry, naučené opravy a míra automatiky. Každou odchylku od tvé představy tu narovnáš."
      />

      {/* Pravidla AI agentů — řízení slovními příkazy */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BrainCircuit className="h-4 w-4 text-muted-foreground" /> Pravidla AI agentů
          </CardTitle>
          <CardDescription>
            Laď každého agenta běžnou řečí — co má dělat, co musí <b>vždy</b> a co <b>nikdy</b>.
            Platí pro třídění pošty, čtení výkresů, nacenění, nabídky i potvrzení.
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

      {/* Parametry kalkulace */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <SlidersHorizontal className="h-4 w-4 text-muted-foreground" /> Parametry kalkulace
          </CardTitle>
          <CardDescription>
            Hodinové sazby, marže, inflace a doprava — vstupy pro AI technologa při nacenění.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <IntegrationSettingsEditor settings={pricingParams} />
        </CardContent>
      </Card>

      {/* Naučené korekce */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <GraduationCap className="h-4 w-4 text-muted-foreground" /> Naučené korekce
          </CardTitle>
          <CardDescription>
            Tvoje opravy výstupů AI (kategorie, texty, ceny). Vkládají se do promptů,
            takže AI stejnou chybu nezopakuje. Nepotřebnou korekci smaž.
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
            Doporučení: začni vše se schválením a po odladění postupně přepínej na automatiku.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AutomationSettings initial={moduleModes} />
        </CardContent>
      </Card>
    </div>
  );
}
