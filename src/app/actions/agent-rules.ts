"use server";

import { revalidatePath } from "next/cache";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

export interface SaveRulesInput {
  agentKey: string;
  instructions: string;
  always: string[];
  never: string[];
}

export async function saveAgentRules(
  input: SaveRulesInput,
): Promise<{ ok: boolean; error?: string }> {
  const always = input.always.map((s) => s.trim()).filter(Boolean);
  const never = input.never.map((s) => s.trim()).filter(Boolean);

  if (!isSupabaseConfigured()) {
    // Bez DB nelze trvale uložit — vrátíme info (UI ponechá hodnoty lokálně).
    return { ok: false, error: "Supabase není nakonfigurováno — pravidla se neuložila trvale." };
  }

  try {
    const db = await createClient();
    const { error } = await db
      .from("ai_agent_rules")
      .update({
        instructions: input.instructions,
        always_rules: always,
        never_rules: never,
      } as never)
      .eq("agent_key", input.agentKey);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba ukládání" };
  }
}
