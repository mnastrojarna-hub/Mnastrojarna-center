"use server";

import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured, hasServiceKey } from "@/lib/supabase/server";
import type { AutomationMode } from "@/lib/supabase/database.types";

type Result = { ok: boolean; error?: string };

const NEED = "Pro uložení doplň servisní klíč Supabase nebo se přihlas jako super admin.";

export async function setGlobalMode(mode: AutomationMode): Promise<Result> {
  if (!isSupabaseConfigured()) return { ok: true }; // bez DB jen lokálně
  try {
    const db = await createOperatorClient();
    const { data, error } = await db
      .from("automation_global")
      .update({ mode } as never)
      .eq("id", true)
      .select("id");
    if (error) return { ok: false, error: error.message };
    if ((!data || data.length === 0) && hasServiceKey()) {
      await db.from("automation_global").insert({ id: true, mode } as never);
    } else if (!data || data.length === 0) {
      return { ok: false, error: NEED };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba" };
  }
}

export async function setModuleMode(module: string, mode: AutomationMode): Promise<Result> {
  if (!isSupabaseConfigured()) return { ok: true };
  try {
    const db = await createOperatorClient();
    const { data, error } = await db
      .from("automation_settings")
      .update({ mode } as never)
      .eq("module", module)
      .select("module");
    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) return { ok: false, error: hasServiceKey() ? "Modul nenalezen." : NEED };
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba" };
  }
}
