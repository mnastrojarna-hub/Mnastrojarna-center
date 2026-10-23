"use server";

import { redirect } from "next/navigation";
import { createClient, createAdminClient, hasServiceKey, isSupabaseConfigured } from "@/lib/supabase/server";
import { normalizeEmail } from "@/lib/auth/reset-code";
import {
  INACTIVE,
  describeInvalidCredentials,
  isInvalidCredentials,
  loginError,
  loginRedirectUrl,
  type LoginAccountState,
} from "@/lib/auth/login-diagnosis";
import { logAudit } from "@/lib/audit";

/** Stav účtu podle e-mailu (service key) — pro přesnou hlášku po špatném heslu. */
async function accountState(email: string): Promise<(LoginAccountState & { id?: string }) | null> {
  if (!hasServiceKey()) return null;
  try {
    const db = createAdminClient();
    const { data, error } = await db
      .from("profiles")
      .select("id, active, password_change_required")
      .eq("email", email)
      .limit(1)
      .maybeSingle();
    if (error) return null;
    const p = data as { id: string; active: boolean | null; password_change_required: boolean | null } | null;
    if (!p) return { exists: false, active: false, initialPassword: false };
    return { id: p.id, exists: true, active: p.active !== false, initialPassword: p.password_change_required === true };
  } catch {
    return null;
  }
}

export async function signIn(formData: FormData) {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const password = String(formData.get("password") ?? "");

  if (!isSupabaseConfigured()) {
    redirect("/setup");
  }
  if (!email || !password) {
    redirect(loginRedirectUrl("Vyplň e-mail a heslo.", email));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    let message = loginError(error?.message ?? "Přihlášení se nepovedlo.");
    if (isInvalidCredentials(error?.message)) {
      const state = await accountState(email);
      message = describeInvalidCredentials(email, state);
      // pokus o přihlášení do existujícího účtu → audit (kdo kdy zkoušel, proč neprošlo)
      if (state?.exists) {
        await logAudit({
          action: "login_failed",
          entity: "profiles",
          entityId: state.id,
          diff: { email, reason: state.active ? "wrong_password" : "inactive", initial_password: state.initialPassword },
        });
      }
    }
    redirect(loginRedirectUrl(message, email));
  }

  // Neaktivní účet (registrace bez pozvánky / deaktivace) se nepustí dál
  if (hasServiceKey()) {
    let active = true;
    try {
      const db = createAdminClient();
      const { data: profile, error: profileError } = await db
        .from("profiles")
        .select("active")
        .eq("id", data.user.id)
        .maybeSingle();
      // chyba dotazu ≠ neaktivní účet (aktivitu stejně hlídá requireUser na každé stránce)
      if (!profileError) active = Boolean(profile) && (profile as { active: boolean }).active !== false;
      if (active) {
        // naposledy přihlášen — best-effort
        await db.from("profiles").update({ last_seen_at: new Date().toISOString() }).eq("id", data.user.id);
      }
    } catch {
      // výpadek kontroly neblokuje přihlášení — aktivitu hlídá i každá stránka
    }
    if (!active) {
      await supabase.auth.signOut();
      redirect(loginRedirectUrl(INACTIVE, email));
    }
  }

  redirect("/orders");
}

/** Ukončí relaci na serveru (smaže auth cookies) bez přesměrování — přesměruje volající. */
export async function endSession(): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const supabase = await createClient();
  await supabase.auth.signOut();
}

export async function signOut() {
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}
