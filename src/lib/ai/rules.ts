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
};

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
