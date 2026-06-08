import "server-only";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAgentRules, buildRulesPrompt } from "@/lib/ai/rules";
import type { Correction } from "@/lib/supabase/database.types";

/**
 * Učení z korekcí: uživatelské opravy se vkládají do promptu jako "naučené korekce",
 * aby AI v plné automatice stejnou chybu neopakovala.
 */

export async function getCorrections(agentKey: string, limit = 20): Promise<Correction[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const db = await createOperatorClient();
    const { data, error } = await db
      .from("ai_corrections")
      .select("*")
      .eq("agent_key", agentKey)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data as Correction[];
  } catch {
    return [];
  }
}

export async function getRecentCorrections(limit = 50): Promise<Correction[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const db = await createOperatorClient();
    const { data, error } = await db
      .from("ai_corrections")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data as Correction[];
  } catch {
    return [];
  }
}

export function buildCorrectionsPrompt(rows: Correction[]): string {
  if (!rows.length) return "";
  const lines = rows.map((c) => {
    const parts: string[] = [];
    if (c.context) parts.push(`Situace: ${c.context}`);
    if (c.ai_value) parts.push(`AI dříve chybně: ${c.ai_value}`);
    parts.push(`Správně: ${c.corrected_value}`);
    if (c.note) parts.push(`Pravidlo: ${c.note}`);
    return `- ${parts.join(" | ")}`;
  });
  return (
    "NAUČENÉ KOREKCE (uživatel toto dříve opravil — NIKDY tyto chyby neopakuj a řiď se opravami):\n" +
    lines.join("\n")
  );
}

/**
 * Kompletní instrukce pro agenta = firemní pravidla (vždy/nikdy) + naučené korekce.
 * Toto se vkládá do system promptů místo samotného buildRulesPrompt.
 */
export async function getAgentInstructions(agentKey: string): Promise<string> {
  const [rules, corrections] = await Promise.all([
    getAgentRules(agentKey),
    getCorrections(agentKey),
  ]);
  const rulesPrompt = buildRulesPrompt(rules);
  const corrPrompt = buildCorrectionsPrompt(corrections);
  return [rulesPrompt, corrPrompt].filter(Boolean).join("\n\n");
}
