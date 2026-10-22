"use server";

import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured, hasServiceKey } from "@/lib/supabase/server";
import { checkFeature } from "@/lib/auth/session";

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
  // učení z oprav: smí každý aktivní uživatel s Knihou zakázek (čtení dokladů, ruční opravy)
  const auth = await checkFeature("orders");
  if ("error" in auth) return { ok: false, error: auth.error };
  if (typeof input?.agentKey !== "string" || !input.agentKey.trim()) return { ok: false, error: "Chybí agent." };
  if (typeof input.correctedValue !== "string" || !input.correctedValue.trim()) return { ok: false, error: "Chybí správná hodnota." };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase není nakonfigurováno." };
  try {
    const db = await createOperatorClient();
    const { data, error } = await db
      .from("ai_corrections")
      .insert({
        agent_key: input.agentKey.trim().slice(0, 60),
        field: typeof input.field === "string" ? input.field.slice(0, 120) : null,
        context: typeof input.context === "string" ? input.context.slice(0, 4000) : null,
        ai_value: typeof input.aiValue === "string" ? input.aiValue.slice(0, 8000) : null,
        corrected_value: input.correctedValue.trim().slice(0, 8000),
        note: typeof input.note === "string" ? input.note.trim().slice(0, 2000) || null : null,
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
  const auth = await checkFeature("ai_tuning");
  if ("error" in auth) return { ok: false, error: auth.error };
  if (typeof id !== "string" || !id) return { ok: false, error: "Chybí korekce." };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase není nakonfigurováno." };
  try {
    const db = await createOperatorClient();
    const { error } = await db.from("ai_corrections").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/settings");
    revalidatePath("/tuning");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba" };
  }
}
