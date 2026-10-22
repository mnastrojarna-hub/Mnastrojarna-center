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
import { requireFeature } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

/** Barevná ikona sekce. */
function SectionIcon({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg [&_svg]:h-4 [&_svg]:w-4", tone)}>{children}</span>
  );
}

/**
 * Ladění & korekce — mikromanagement AI, dokud se vše nenaučí:
 * pravidla agentů řečí, parametry kalkulace, naučené korekce a režim automatizace.
 */
export default async function TuningPage() {
  await requireFeature("ai_tuning");
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
          <CardTitle className="flex items-center gap-2.5 text-base">
            <SectionIcon tone="bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300"><BrainCircuit /></SectionIcon> Pravidla AI agentů
          </CardTitle>
          <CardDescription>
            Laď každého agenta běžnou řečí — co má dělat, co musí <b>vždy</b> a co <b>nikdy</b>.
            Platí pro třídění pošty, čtení výkresů, nacenění, nabídky i potvrzení.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {agentRules.length === 0 && (
            <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
              Pravidla agentů se načtou z databáze (tabulka ai_agent_rules) — zkontroluj migrace v Nastavení.
            </p>
          )}
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
          <CardTitle className="flex items-center gap-2.5 text-base">
            <SectionIcon tone="bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"><SlidersHorizontal /></SectionIcon> Parametry kalkulace
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
          <CardTitle className="flex items-center gap-2.5 text-base">
            <SectionIcon tone="bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300"><GraduationCap /></SectionIcon> Naučené korekce
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
          <CardTitle className="flex items-center gap-2.5 text-base">
            <SectionIcon tone="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"><ShieldCheck /></SectionIcon> Režim automatizace
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
