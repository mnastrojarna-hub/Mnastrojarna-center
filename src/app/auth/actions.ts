"use server";

import { redirect } from "next/navigation";
import { createClient, createAdminClient, hasServiceKey, isSupabaseConfigured } from "@/lib/supabase/server";
import { normalizeEmail } from "@/lib/auth/reset-code";

const INACTIVE = "Účet není aktivní. Požádej super admina o aktivaci.";

/** Srozumitelná česká chyba přihlášení. */
function loginError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "Nesprávný e-mail nebo heslo.";
  if (m.includes("email not confirmed")) return "E-mail ještě není potvrzený — požádej super admina o aktivaci účtu.";
  if (m.includes("banned")) return INACTIVE;
  if (m.includes("rate limit") || m.includes("too many")) return "Příliš mnoho pokusů — chvíli počkej a zkus to znovu.";
  return message;
}

export async function signIn(formData: FormData) {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const password = String(formData.get("password") ?? "");

  if (!isSupabaseConfigured()) {
    redirect("/setup");
  }
  if (!email || !password) {
    redirect(`/login?error=${encodeURIComponent("Vyplň e-mail a heslo.")}`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    redirect(`/login?error=${encodeURIComponent(loginError(error?.message ?? "Přihlášení se nepovedlo."))}`);
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
      redirect(`/login?error=${encodeURIComponent(INACTIVE)}`);
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
