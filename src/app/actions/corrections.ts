"use server";

import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured, hasServiceKey } from "@/lib/supabase/server";

type Result = { ok: boolean; error?: string };

const NEED = "Pro uložení korekce doplň servisní klíč Supabase nebo se přihlas.";

export async function recordCorrection(input: {
  agentKey: string;
  field?: string;
  context?: string;
  aiValue?: string;
  correctedValue: string;
  note?: string;
}): Promise<Result> {
  if (!input.correctedValue?.trim()) return { ok: false, error: "Chybí správná hodnota." };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase není nakonfigurováno." };
  try {
    const db = await createOperatorClient();
    const { data, error } = await db
      .from("ai_corrections")
      .insert({
        agent_key: input.agentKey,
        field: input.field ?? null,
        context: input.context ?? null,
        ai_value: input.aiValue ?? null,
        corrected_value: input.correctedValue.trim(),
        note: input.note?.trim() || null,
      } as never)
      .select("id");
    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) return { ok: false, error: NEED };
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba" };
  }
}

export async function deleteCorrection(id: string): Promise<Result> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase není nakonfigurováno." };
  try {
    const db = await createOperatorClient();
    const { error } = await db.from("ai_corrections").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba" };
  }
}
