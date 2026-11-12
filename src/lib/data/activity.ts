import "server-only";
import { createAdminClient, createClient, hasServiceKey, isSupabaseConfigured } from "@/lib/supabase/server";
import { userActor } from "@/lib/supabase/actor-headers";
import { sanitizeActivityPath } from "@/lib/activity";

/**
 * Tep poslední aktivity (profiles.last_active_at / last_active_path, migrace 20261109140000) — vždy jen pro
 * ověřeného uživatele (userId ze session, volající ho ověří). DB zapíše jen když je uložený čas starší než 30 s.
 * Výsledek: true = zapsáno, false = nic (v intervalu, neaktivní účet, DB bez migrace, chyba — vše tiše).
 */
export async function touchActivity(userId: string, path: unknown): Promise<boolean> {
  if (!userId || !isSupabaseConfigured()) return false;
  const p_path = sanitizeActivityPath(path);
  try {
    // server: servisní klíč + ověřený uživatel (RPC jen pro service_role); jinak vlastní session (auth.uid())
    const { data, error } = hasServiceKey()
      ? await createAdminClient({ actor: userActor({ id: userId }) }).rpc("user_activity_touch", { p_user: userId, p_path })
      : await (await createClient()).rpc("touch_my_activity" as never, { p_path } as never);
    return !error && data === true;
  } catch {
    return false;
  }
}
