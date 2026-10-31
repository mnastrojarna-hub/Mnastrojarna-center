import "server-only";
import { createClient, createAdminClient, hasServiceKey, isSupabaseConfigured } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/database.types";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { getVerifiedAuthUser } from "@/lib/supabase/verified-claims";

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
  /** Počáteční heslo od admina — musí si nastavit vlastní. */
  mustChangePassword: boolean;
  /**
   * Nabídky uživatele musí před odesláním schválit super admin (profil, 31. 10.; super admin nikdy).
   * Neuvedeno = ano. Rozhoduje DB (quote_author_needs_admin) — tady jen pro texty a nabídku akcí.
   */
  quoteNeedsApproval?: boolean;
  /**
   * 31. 10.: „Smí schvalovat nabídky ostatních" (profiles.can_approve_quotes; super admin smí vždy) → quote_approval.
   * Kterou nabídku smí schválit, rozhoduje mayManageQuoteApproval (a DB quote_user_may_approve).
   */
  canApproveQuotes?: boolean;
  /**
   * 31. 10.: „Smí poptávat dodavatele" (profiles.can_rfq) → funkce „rfq" i bez práva na marže (zaměstnanec Šponer):
   * poptávkové kolo u dodavatelů a jejich ceny v porovnání. Obchodník a super admin smí vždy.
   */
  canRfq?: boolean;
}

/**
 * Schvalovatelé nabídek, kteří nejsou super admin (31. 10. — „Smí schvalovat nabídky ostatních"; aktivní),
 * pro texty „čeká na schválení (V. Volný nebo super admin)". Chyba / DB bez migrace = prázdný seznam.
 */
export async function listQuoteApprovers(): Promise<{ id: string; name: string }[]> {
  if (!isSupabaseConfigured() || !hasServiceKey()) return [];
  try {
    const db = createAdminClient({ actor: null });
    const { data, error } = await db.from("profiles").select("id, full_name, email")
      .eq("can_approve_quotes", true).eq("active", true).neq("role", "super_admin").order("full_name");
    if (error) return [];
    return ((data ?? []) as { id: string; full_name: string | null; email: string | null }[])
      .map((p) => ({ id: p.id, name: (p.full_name ?? "").trim() || (p.email ?? "").trim() }))
      .filter((p) => p.name);
  } catch {
    return [];
  }
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
    // podpis tokenu ověřen lokálně (bez síťového volání na Auth, viz verified-claims.ts)
    const user = await getVerifiedAuthUser(supabase);
    if (!user) return null;

    let fullName = (user.user_metadata?.full_name as string | undefined) ?? "";
    let role: UserRole = "zamestnanec";
    let aiAccess = false;
    let active = false;
    let hasProfile = false;
    let mustChangePassword = false;
    let quoteNeedsApproval = true;
    let canApproveQuotes = false;
    let canRfq = false;

    // Profil: servisním klíčem, jinak vlastní session (RLS povoluje číst sám sebe).
    const db = hasServiceKey() ? createAdminClient() : supabase;
    const base = "full_name, role, ai_access, active, password_change_required";
    let res = await db.from("profiles").select(`${base}, quote_needs_approval, can_approve_quotes, can_rfq`).eq("id", user.id).maybeSingle();
    // DB bez migrace 20261031160000 (can_rfq) — bez příznaku poptávek, zbytek beze změny
    if (res.error && /can_rfq/.test(res.error.message ?? "")) {
      res = await db.from("profiles").select(`${base}, quote_needs_approval, can_approve_quotes`).eq("id", user.id).maybeSingle() as typeof res;
    }
    // DB bez migrace 20261030200000 (nasazení kódu před migrací) — přihlášení nesmí spadnout
    if (res.error && /quote_needs_approval|can_approve_quotes/.test(res.error.message ?? "")) {
      res = await db.from("profiles").select(base).eq("id", user.id).maybeSingle() as typeof res;
    }
    const profile = res.data as {
      full_name?: string; role?: UserRole; ai_access?: boolean; active?: boolean; password_change_required?: boolean;
      quote_needs_approval?: boolean | null; can_approve_quotes?: boolean | null; can_rfq?: boolean | null;
    } | null;
    if (profile) {
      hasProfile = true;
      if (profile.full_name) fullName = profile.full_name;
      if (profile.role) role = profile.role;
      aiAccess = Boolean(profile.ai_access);
      active = profile.active !== false;
      mustChangePassword = Boolean(profile.password_change_required);
      quoteNeedsApproval = role !== "super_admin" && profile.quote_needs_approval !== false;
      canApproveQuotes = role === "super_admin" || profile.can_approve_quotes === true;
      canRfq = role === "super_admin" || role === "obchodnik" || profile.can_rfq === true;
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
      mustChangePassword,
      quoteNeedsApproval: role !== "super_admin" && quoteNeedsApproval,
      canApproveQuotes,
      canRfq,
    };
  } catch {
    return null;
  }
}
