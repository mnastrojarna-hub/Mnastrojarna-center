"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient, hasServiceKey, isSupabaseConfigured } from "@/lib/supabase/server";
import { userActor } from "@/lib/supabase/actor-headers";
import { checkFeature } from "@/lib/auth/session";
import { invalidateSettingsCache } from "@/lib/settings";
import { logAudit } from "@/lib/audit";

/**
 * Přístup k AI (Uživatelé → AI přístup): hlavní vypínač a AI čtení dokladů
 * pro všechny. Per uživatel se AI zapíná v seznamu uživatelů (profiles.ai_access).
 */
export async function saveAiAccessSettings(input: {
  aiEnabled: boolean;
  aiCaptureForAll: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const access = await checkFeature("users");
  if ("error" in access) return { ok: false, error: access.error };
  if (!isSupabaseConfigured() || !hasServiceKey()) {
    return { ok: false, error: "Nejdřív dokonči připojení Supabase (servisní klíč)." };
  }
  if (typeof input?.aiEnabled !== "boolean" || typeof input?.aiCaptureForAll !== "boolean") {
    return { ok: false, error: "Neplatné hodnoty nastavení." };
  }

  try {
    const db = createAdminClient({ actor: userActor(access.user) });
    const now = new Date().toISOString();
    const rows = [
      {
        key: "ai_enabled",
        category: "ai_access",
        label: "AI zapnuto (hlavní vypínač)",
        is_secret: false,
        value: input.aiEnabled ? "true" : "false",
        updated_by: access.user.id,
        updated_at: now,
      },
      {
        key: "ai_capture_for_all",
        category: "ai_access",
        label: "AI čtení dokladů z fotky pro všechny uživatele",
        is_secret: false,
        value: input.aiCaptureForAll ? "true" : "false",
        updated_by: access.user.id,
        updated_at: now,
      },
    ];
    const { error } = await db.from("integration_settings").upsert(rows, { onConflict: "key" });
    if (error) return { ok: false, error: error.message };

    invalidateSettingsCache();
    await logAudit({
      action: "ai_access_updated",
      entity: "integration_settings",
      diff: { ai_enabled: input.aiEnabled, ai_capture_for_all: input.aiCaptureForAll },
    });
    // oprávnění se promítají do navigace všech stránek
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba" };
  }
}
