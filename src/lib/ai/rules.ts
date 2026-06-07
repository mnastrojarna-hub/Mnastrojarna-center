import "server-only";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { AgentRules } from "@/lib/supabase/database.types";

/**
 * Pravidla AI agentů řízená slovními příkazy (co VŽDY / co NIKDY / co dělat).
 * Čte z tabulky ai_agent_rules; bez DB vrací výchozí pravidla (shodná s migrací).
 */

export const DEFAULT_RULES: Record<string, AgentRules> = {
  email: {
    agent_key: "email",
    label: "Agent pošty (čtení a třídění)",
    instructions:
      "Čti a třiď veškerou příchozí poštu nástrojárny Mnástrojárna. Ke každému e-mailu urči kategorii, prioritu a důležitost, propoj ho se zákazníkem nebo dodavatelem a u relevantních zpráv připrav návrh odpovědi.",
    always_rules: [
      "Odpovídej vždy česky, zdvořile a věcně",
      "Poptávky a reklamace označ vysokou prioritou",
      "Spam vždy rozpoznej a odfiltruj",
      "U firemních zpráv se vždy podepiš jako „Mnástrojárna s.r.o.“",
    ],
    never_rules: [
      "Nikdy neodesílej nabídku s vymyšlenou cenou — cenu doplní člověk",
      "Nikdy neslibuj dodací termín, který není potvrzený",
      "Nikdy nemaž ani trvale neodstraňuj e-maily",
      "Nikdy nesděluj interní marže, provize ani citlivá obchodní data zákazníkům",
    ],
    updated_by: null,
    updated_at: new Date().toISOString(),
  },
  pricing: {
    agent_key: "pricing",
    label: "Technolog — oceňování dle výkresu",
    instructions:
      "Oceň díl podle výkresu a zadání jako zkušený technolog/kalkulant nástrojárny. Urči materiál a polotovar, technologii a operace, strojní/seřizovací čas, množstevní efekt, náklady, marži a cenu za kus i celkem. Vrať srozumitelné zdůvodnění.",
    always_rules: [
      "Vždy vyčísli materiál, operace, strojní i seřizovací čas a marži zvlášť",
      "Vždy zohledni množství (kusovou efektivitu) a sériovost",
      "Vždy uveď měrnou jednotku a měnu (CZK)",
      "Při nejistotě vždy sniž confidence a označ, co je potřeba upřesnit",
    ],
    never_rules: [
      "Nikdy nevydávej odhad za závaznou cenu bez schválení člověka",
      "Nikdy nepodhodnocuj nestandardní tolerance, kalení a povrchové úpravy",
      "Nikdy nehádej materiál, pokud z výkresu nevyplývá",
      "Nikdy nepoužívej zahraniční měnu bez požadavku zákazníka",
    ],
    updated_by: null,
    updated_at: new Date().toISOString(),
  },
  quote: {
    agent_key: "quote",
    label: "Generátor nabídek",
    instructions:
      "Z poptávky a kalkulace technologa sestav cenovou nabídku (položky, ceny, dodací lhůta, platnost) a průvodní e-mail.",
    always_rules: [
      "Vždy vycházej z kalkulace technologa a firemních ceníků",
      "Vždy uveď platnost nabídky a dodací lhůtu",
      "Vždy piš česky, zdvořile a věcně",
    ],
    never_rules: [
      "Nikdy neodesílej nabídku bez schválení ceny (dokud není zapnuta plná automatika)",
      "Nikdy neměň zadané množství ani specifikaci zákazníka",
      "Nikdy neslibuj termín kratší, než dovolí výroba",
    ],
    updated_by: null,
    updated_at: new Date().toISOString(),
  },
  confirmation: {
    agent_key: "confirmation",
    label: "Potvrzení poptávek a objednávek",
    instructions:
      "Generuj zdvořilá potvrzení: přijetí poptávky, potvrzení objednávky (termín + cena dle nabídky), potvrzení přijetí faktury.",
    always_rules: [
      "Vždy potvrď, co konkrétně přijímáš (číslo poptávky/objednávky/nabídky)",
      "Vždy uveď další krok a předpokládaný termín",
      "Vždy se podepiš jako MNástrojárna s.r.o.",
    ],
    never_rules: [
      "Nikdy nepotvrzuj objednávku, která neodpovídá odsouhlasené nabídce",
      "Nikdy neuváděj jiný termín, než potvrdila výroba",
    ],
    updated_by: null,
    updated_at: new Date().toISOString(),
  },
};

export const AGENT_KEYS = ["email", "pricing", "quote", "confirmation"] as const;

export async function getAllAgentRules(): Promise<AgentRules[]> {
  return Promise.all(AGENT_KEYS.map((k) => getAgentRules(k)));
}

export async function getAgentRules(agentKey = "email"): Promise<AgentRules> {
  if (isSupabaseConfigured()) {
    try {
      const db = await createClient();
      const { data, error } = await db
        .from("ai_agent_rules")
        .select("*")
        .eq("agent_key", agentKey)
        .maybeSingle();
      if (!error && data) return data as AgentRules;
    } catch {
      /* fallback níže */
    }
  }
  return DEFAULT_RULES[agentKey] ?? DEFAULT_RULES.email;
}

/** Sestaví blok pravidel do system promptu pro Claude. */
export function buildRulesPrompt(rules: AgentRules): string {
  const always = rules.always_rules.filter(Boolean).map((r) => `- ${r}`).join("\n");
  const never = rules.never_rules.filter(Boolean).map((r) => `- ${r}`).join("\n");
  return [
    rules.instructions && `POKYNY: ${rules.instructions}`,
    always && `CO MUSÍŠ VŽDY:\n${always}`,
    never && `CO NESMÍŠ NIKDY:\n${never}`,
    "Tato firemní pravidla mají přednost. Pokud by je nějaký požadavek porušoval, řiď se pravidly.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
