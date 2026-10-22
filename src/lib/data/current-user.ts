import "server-only";
import { createClient, createAdminClient, hasServiceKey, isSupabaseConfigured } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/database.types";
import { ROLE_LABELS } from "@/lib/auth/permissions";

export interface CurrentUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  initials: string;
  roleLabel: string;
  /** Super admin tomuto uživateli povolil AI. */
  aiAccess: boolean;
  /** Neaktivní účet nesmí nic vidět (registrace bez pozvánky / deaktivace). */
  active: boolean;
  /** Profil v DB existuje (jinak jde o účet bez profilu → neaktivní). */
  hasProfile: boolean;
}

export function initialsOf(name: string, email: string): string {
  const source = name.trim() || email;
  const parts = source.split(/[\s.@_-]+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "");
  return letters.join("") || "?";
}

/** Aktuálně přihlášený uživatel s profilem (jméno, role, AI přístup, aktivita). */
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
    let aiAccess = false;
    let active = false;
    let hasProfile = false;

    // Profil: servisním klíčem, jinak vlastní session (RLS povoluje číst sám sebe).
    const db = hasServiceKey() ? createAdminClient() : supabase;
    const { data } = await db
      .from("profiles")
      .select("full_name, role, ai_access, active")
      .eq("id", user.id)
      .maybeSingle();
    const profile = data as { full_name?: string; role?: UserRole; ai_access?: boolean; active?: boolean } | null;
    if (profile) {
      hasProfile = true;
      if (profile.full_name) fullName = profile.full_name;
      if (profile.role) role = profile.role;
      aiAccess = Boolean(profile.ai_access);
      active = profile.active !== false;
    }

    const email = user.email ?? "";
    return {
      id: user.id,
      email,
      fullName: fullName || email,
      role,
      initials: initialsOf(fullName, email),
      roleLabel: ROLE_LABELS[role] ?? role,
      aiAccess,
      active: hasProfile && active,
      hasProfile,
    };
  } catch {
    return null;
  }
}
