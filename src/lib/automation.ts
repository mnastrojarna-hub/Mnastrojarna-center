import "server-only";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { AutomationMode } from "@/lib/supabase/database.types";

/**
 * Efektivní režim automatizace pro modul: per-modul nastavení → globální → default 'approval'.
 * Čte z DB (automation_settings / automation_global) přes operátorský klient.
 */
export async function getModuleMode(module: string): Promise<AutomationMode> {
  if (!isSupabaseConfigured()) return "approval";
  try {
    const db = await createOperatorClient();
    const { data: m } = await db
      .from("automation_settings")
      .select("mode, enabled")
      .eq("module", module)
      .maybeSingle();
    const row = m as { mode: AutomationMode; enabled: boolean } | null;
    if (row && row.enabled === false) return "approval"; // vypnuto = jen schválení
    if (row?.mode) return row.mode;

    const { data: g } = await db.from("automation_global").select("mode").maybeSingle();
    return ((g as { mode: AutomationMode } | null)?.mode) ?? "approval";
  } catch {
    return "approval";
  }
}

export async function getAllModuleModes(): Promise<Record<string, AutomationMode>> {
  if (!isSupabaseConfigured()) return {};
  try {
    const db = await createOperatorClient();
    const { data } = await db.from("automation_settings").select("module, mode");
    const map: Record<string, AutomationMode> = {};
    for (const r of (data as { module: string; mode: AutomationMode }[] | null) ?? []) {
      map[r.module] = r.mode;
    }
    return map;
  } catch {
    return {};
  }
}

export async function getGlobalMode(): Promise<AutomationMode> {
  if (!isSupabaseConfigured()) return "approval";
  try {
    const db = await createOperatorClient();
    const { data } = await db.from("automation_global").select("mode").maybeSingle();
    return ((data as { mode: AutomationMode } | null)?.mode) ?? "approval";
  } catch {
    return "approval";
  }
}
