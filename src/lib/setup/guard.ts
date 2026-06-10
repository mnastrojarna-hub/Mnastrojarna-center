import "server-only";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createAdminClient, createClient, hasServiceKey } from "@/lib/supabase/server";

/** Existuje v systému alespoň jeden super admin? */
export async function superAdminExists(): Promise<boolean> {
  if (!isSupabaseConfigured() || !hasServiceKey()) return false;
  try {
    const db = createAdminClient();
    const { count, error } = await db
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "super_admin");
    if (error) return false;
    return (count ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Je aktuálně přihlášený uživatel super admin? */
export async function isCurrentUserSuperAdmin(): Promise<boolean> {
  if (!isSupabaseConfigured() || !hasServiceKey()) return false;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;
    const db = createAdminClient();
    const { data } = await db.from("profiles").select("role").eq("id", user.id).maybeSingle();
    return (data as { role?: string } | null)?.role === "super_admin";
  } catch {
    return false;
  }
}

/**
 * Smí volající měnit systémové nastavení (Supabase připojení, superadmin, schránky)?
 * Dokud systém není plně zprovozněn (chybí konfigurace / servisní klíč / žádný
 * super admin), je nastavování otevřené — jinak vyžaduje přihlášeného super admina.
 */
export async function canModifySetup(): Promise<boolean> {
  if (!isSupabaseConfigured()) return true;
  if (!hasServiceKey()) return true;
  if (!(await superAdminExists())) return true;
  return isCurrentUserSuperAdmin();
}
