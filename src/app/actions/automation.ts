"use server";

import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured, hasServiceKey } from "@/lib/supabase/server";
import type { AutomationMode } from "@/lib/supabase/database.types";
import { checkFeature } from "@/lib/auth/session";
import { userActor } from "@/lib/supabase/actor-headers";
import { logAudit } from "@/lib/audit";

type Result = { ok: boolean; error?: string };

const NEED = "Pro uložení doplň servisní klíč Supabase nebo se přihlas jako super admin.";

const MODES: AutomationMode[] = ["full", "approval"];
/** Moduly, které jdou nastavit (řádek se případně založí — např. „capture" přibyl později). */
const MODULES = ["categorize", "spam", "reply", "quote", "supplier_request", "order_match", "drawing_extract", "capture", "purchase_order"];

/** Režim automatiky je systémové nastavení: ladění AI + nastavení (super admin). */
async function begin(): Promise<{ user: { id: string } } | { error: string }> {
  const tuning = await checkFeature("ai_tuning");
  if ("error" in tuning) return tuning;
  const settings = await checkFeature("settings");
  if ("error" in settings) return settings;
  return { user: tuning.user };
}

export async function setGlobalMode(mode: AutomationMode): Promise<Result> {
  const auth = await begin();
  if ("error" in auth) return { ok: false, error: auth.error };
  if (!MODES.includes(mode)) return { ok: false, error: "Neplatný režim." };
  if (!isSupabaseConfigured()) return { ok: true }; // bez DB jen lokálně
  try {
    const actor = userActor(auth.user);
    const db = await createOperatorClient({ actor });
    const { data: prev } = await db.from("automation_global").select("mode").eq("id", true).maybeSingle();
    const from = (prev as { mode: AutomationMode } | null)?.mode ?? null;
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
    if (from !== mode) {
      await logAudit({ action: "automation_mode_changed", entity: "automation_global", entityId: "global", diff: { from, to: mode }, actor });
    }
    revalidatePath("/settings");
    revalidatePath("/tuning");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba" };
  }
}

export async function setModuleMode(module: string, mode: AutomationMode): Promise<Result> {
  const auth = await begin();
  if ("error" in auth) return { ok: false, error: auth.error };
  if (!MODES.includes(mode) || typeof module !== "string" || !MODULES.includes(module)) return { ok: false, error: "Neplatný režim." };
  if (!isSupabaseConfigured()) return { ok: true };
  try {
    const actor = userActor(auth.user);
    const db = await createOperatorClient({ actor });
    const { data: prev } = await db.from("automation_settings").select("mode").eq("module", module).maybeSingle();
    const from = (prev as { mode: AutomationMode } | null)?.mode ?? null;
    const { data, error } = await db
      .from("automation_settings")
      .upsert({ module, mode, updated_by: auth.user.id, updated_at: new Date().toISOString() } as never, { onConflict: "module" })
      .select("module");
    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) return { ok: false, error: hasServiceKey() ? "Modul nenalezen." : NEED };
    if (from !== mode) {
      await logAudit({ action: "automation_mode_changed", entity: "automation_settings", entityId: module, diff: { module, from, to: mode }, actor });
    }
    revalidatePath("/settings");
    revalidatePath("/tuning");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba" };
  }
}
