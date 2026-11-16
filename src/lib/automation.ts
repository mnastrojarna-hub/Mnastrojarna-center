import "server-only";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { AutomationMode } from "@/lib/supabase/database.types";
import { effectiveAutomationMode } from "@/lib/automation-mode";

/**
 * Efektivní režim automatizace pro modul: přepínač nahoře (globální) je hlavní vypínač; při plné automatice
 * platí nastavení modulu. Výchozí 'approval'.
 * Čte z DB (automation_settings / automation_global) přes operátorský klient.
 */
export async function getModuleMode(module: string): Promise<AutomationMode> {
  if (!isSupabaseConfigured()) return "approval";
  try {
    const db = await createOperatorClient();
    const [{ data: m }, { data: g }] = await Promise.all([
      db.from("automation_settings").select("mode, enabled").eq("module", module).maybeSingle(),
      db.from("automation_global").select("mode").maybeSingle(),
    ]);
    // přepínač nahoře je hlavní vypínač (16. 11.) — viz automation-mode.ts
    return effectiveAutomationMode((g as { mode: AutomationMode } | null)?.mode, m as { mode: AutomationMode; enabled: boolean } | null);
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
