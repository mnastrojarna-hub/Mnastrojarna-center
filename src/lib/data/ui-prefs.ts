import "server-only";
import { createAdminClient, createClient, hasServiceKey, isSupabaseConfigured } from "@/lib/supabase/server";
import { userActor } from "@/lib/supabase/actor-headers";
import { normalizeUiPrefs, type UiPrefKey, type UiPrefs } from "@/lib/ui-prefs";

/**
 * Osobní předvolby vzhledu (profiles.ui_prefs). Čtení i zápis vždy jen pro ověřeného uživatele (userId ze
 * session — volající ho ověří). DB bez migrace 20261102120000 = výchozí vzhled, zápis se tiše nepovede.
 */

export async function getUiPrefs(userId: string): Promise<UiPrefs> {
  if (!userId || !isSupabaseConfigured()) return {};
  try {
    const db = hasServiceKey() ? createAdminClient({ actor: null }) : await createClient();
    const { data, error } = await db.from("profiles").select("ui_prefs").eq("id", userId).maybeSingle();
    if (error) return {};
    return normalizeUiPrefs((data as { ui_prefs?: unknown } | null)?.ui_prefs);
  } catch {
    return {};
  }
}

/** Uloží jeden klíč (null = smazat → výchozí). Vrací nové předvolby, nebo chybu. */
export async function setUiPref(userId: string, key: UiPrefKey, value: number | boolean | null): Promise<{ ok: true; prefs: UiPrefs } | { ok: false; error: string }> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Databáze není nastavená." };
  try {
    // server: servisní klíč + ověřený uživatel (RPC jen pro service_role); jinak vlastní session (auth.uid())
    const { data, error } = hasServiceKey()
      ? await createAdminClient({ actor: userActor({ id: userId }) }).rpc("ui_prefs_set", { p_user: userId, p_key: key, p_value: value })
      : await (await createClient()).rpc("set_my_ui_pref" as never, { p_key: key, p_value: value } as never);
    if (error) return { ok: false, error: error.message };
    return { ok: true, prefs: normalizeUiPrefs(data) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Uložení se nepovedlo." };
  }
}
