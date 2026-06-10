import "server-only";
import { createClient, createAdminClient, hasServiceKey, isSupabaseConfigured } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/database.types";

export interface CurrentUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  initials: string;
  roleLabel: string;
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super admin",
  obchodnik: "Obchodník",
  zamestnanec: "Zaměstnanec",
};

function initialsOf(name: string, email: string): string {
  const source = name.trim() || email;
  const parts = source.split(/[\s.@_-]+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "");
  return letters.join("") || "?";
}

/** Aktuálně přihlášený uživatel s profilem (jméno, role) — pro topbar a menu. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    let fullName = (user.user_metadata?.full_name as string | undefined) ?? "";
    let role: UserRole = "zamestnanec";
    if (hasServiceKey()) {
      const db = createAdminClient();
      const { data } = await db
        .from("profiles")
        .select("full_name, role")
        .eq("id", user.id)
        .maybeSingle();
      const profile = data as { full_name?: string; role?: UserRole } | null;
      if (profile?.full_name) fullName = profile.full_name;
      if (profile?.role) role = profile.role;
    }

    const email = user.email ?? "";
    return {
      id: user.id,
      email,
      fullName: fullName || email,
      role,
      initials: initialsOf(fullName, email),
      roleLabel: ROLE_LABELS[role] ?? role,
    };
  } catch {
    return null;
  }
}
