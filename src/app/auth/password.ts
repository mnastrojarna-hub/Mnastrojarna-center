"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient, createAdminClient, hasServiceKey, isSupabaseConfigured } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { logAudit } from "@/lib/audit";
import { userActor } from "@/lib/supabase/actor-headers";
import { sendMail, isSmtpConfigured } from "@/lib/email/send";
import { passwordResetEmail } from "@/lib/email/templates";
import { refreshCompanyFromSettings } from "@/lib/company-server";
import {
  generateResetCode, hashResetCode, verifyResetCode, normalizeEmail, normalizeResetCode,
  isResetCodeFormat, isPlausibleEmail, originFrom, resetCodeExpiry, resetWindowStart,
  remainingAttempts, attemptsLabel, dailyWindowStart, dailyAttemptsExceeded,
  RESET_CODE_TTL_MIN, RESET_MAX_ATTEMPTS, RESET_MAX_REQUESTS,
} from "@/lib/auth/reset-code";
import { passwordProblem } from "@/components/users/password-tools";
import type { PasswordResetCode } from "@/lib/supabase/database.types";

/**
 * Hesla: obnova kódem z e-mailu (pro každého uživatele), změna vlastního hesla
 * a úprava vlastního profilu. Kódy čte a zapisuje jen server se servisním klíčem.
 */

type ResetChannel = "code" | "supabase";

const NOT_CONFIGURED = "Systém ještě není připojen k Supabase — obnovu hesla zatím nelze použít.";
const GENERIC_FAIL = "Něco se nepovedlo — zkus to prosím za chvíli znovu.";

interface ResetTarget {
  id: string;
  email: string;
  fullName: string;
  active: boolean;
}

/** Admin klient (servisní klíč) — netypovaný, výsledky přetypováváme na řádky z database.types. */
type AdminDb = ReturnType<typeof createAdminClient>;

function secret(): string {
  return process.env.SUPABASE_SECRET_KEY ?? "";
}

async function appOrigin(): Promise<string> {
  const h = await headers();
  return originFrom({
    proto: h.get("x-forwarded-proto"),
    host: h.get("x-forwarded-host") ?? h.get("host"),
    fallback: process.env.NEXT_PUBLIC_APP_URL,
  });
}

/** Najde uživatele podle e-mailu: nejdřív profiles.email, pak stránkování auth.users. */
async function findResetTarget(db: AdminDb, email: string): Promise<ResetTarget | null> {
  const { data: profile } = await db
    .from("profiles")
    .select("id, email, full_name, active")
    .eq("email", email)
    .maybeSingle();
  if (profile) {
    const p = profile as { id: string; full_name: string | null; active: boolean | null };
    return { id: p.id, email, fullName: p.full_name ?? "", active: p.active !== false };
  }

  // Fallback: e-mail v profilu chybí / liší se (např. změna e-mailu)
  const perPage = 200;
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage });
    if (error || !data) break;
    const users = (data.users ?? []) as { id: string; email?: string | null }[];
    const hit = users.find((u) => normalizeEmail(u.email) === email);
    if (hit) {
      const { data: byId } = await db
        .from("profiles")
        .select("full_name, active")
        .eq("id", hit.id)
        .maybeSingle();
      const p = byId as { full_name: string | null; active: boolean | null } | null;
      // bez profilu = neaktivní účet (registrace bez pozvánky)
      return { id: hit.id, email, fullName: p?.full_name ?? "", active: Boolean(p) && p?.active !== false };
    }
    if (users.length < perPage) break;
  }
  return null;
}

/** Obnova přes vestavěný e-mail Supabase (odkaz, příp. kód {{ .Token }} v šabloně). */
async function sendSupabaseRecovery(email: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const origin = await appOrigin();
    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/auth/callback?next=/reset-password`,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : GENERIC_FAIL };
  }
}

/** Uživatel si nastavil vlastní heslo → zrušit vynucenou změnu (best-effort). */
async function clearPasswordChangeRequired(userId: string): Promise<void> {
  if (!hasServiceKey()) return;
  try {
    await createAdminClient({ actor: userActor({ id: userId }) })
      .from("profiles").update({ password_change_required: false } as never).eq("id", userId);
  } catch {
    // příznak nesmí shodit změnu hesla
  }
}

/**
 * Krok 1: pošle 6místný kód na e-mail. Odpověď neprozradí, zda účet existuje.
 * Bez SMTP spadne na e-mail ze Supabase (channel „supabase").
 */
export async function requestPasswordReset(
  rawEmail: string,
): Promise<{ ok: boolean; error?: string; channel?: ResetChannel }> {
  const email = normalizeEmail(rawEmail);
  if (!isPlausibleEmail(email)) return { ok: false, error: "Zadej platný e-mail." };
  if (!isSupabaseConfigured()) return { ok: false, error: NOT_CONFIGURED };

  // Bez servisního klíče nejde ověřit účet ani uložit kód → jen Supabase e-mail
  if (!hasServiceKey()) {
    const r = await sendSupabaseRecovery(email);
    return r.ok ? { ok: true, channel: "supabase" } : { ok: false, error: GENERIC_FAIL };
  }

  try {
    const db: AdminDb = createAdminClient();
    // kanál podle konfigurace, ne podle existence účtu (anti-enumerace)
    const smtpReady = await isSmtpConfigured({ system: true }).catch(() => false);
    const channel: ResetChannel = smtpReady ? "code" : "supabase";

    const target = await findResetTarget(db, email);
    if (!target || !target.active) return { ok: true, channel };

    if (!smtpReady) {
      const r = await sendSupabaseRecovery(target.email);
      if (!r.ok) return { ok: false, error: GENERIC_FAIL };
      await logAudit({ action: "password_reset_requested", entity: "profiles", entityId: target.id, diff: { channel: "supabase" } });
      return { ok: true, channel: "supabase" };
    }

    // Limit: max. RESET_MAX_REQUESTS kódů za RESET_CODE_TTL_MIN minut na e-mail
    const { count } = await db
      .from("password_reset_codes")
      .select("id", { count: "exact", head: true })
      .eq("email", email)
      .gte("created_at", resetWindowStart().toISOString());
    if ((count ?? 0) >= RESET_MAX_REQUESTS) return { ok: true, channel };

    // Starší nepoužité kódy přestanou platit
    const nowIso = new Date().toISOString();
    await db.from("password_reset_codes").update({ used_at: nowIso }).eq("email", email).is("used_at", null);

    const code = generateResetCode();
    const { data: inserted, error: insertError } = await db
      .from("password_reset_codes")
      .insert({
        user_id: target.id,
        email,
        code_hash: hashResetCode(target.id, code, secret()),
        expires_at: resetCodeExpiry().toISOString(),
      })
      .select("id")
      .maybeSingle();
    if (insertError) return { ok: false, error: GENERIC_FAIL };

    await refreshCompanyFromSettings();
    const mail = passwordResetEmail({ code, name: target.fullName, minutes: RESET_CODE_TTL_MIN });
    const sent = await sendMail({ to: email, subject: mail.subject, text: mail.text, html: mail.html, log: false, from: { system: true } });

    if (!sent.sent) {
      // SMTP selhalo → náš kód zneplatnit (jinak by blokoval ověření OTP ze Supabase)
      const insertedId = (inserted as { id: string } | null)?.id;
      if (insertedId) await db.from("password_reset_codes").update({ used_at: nowIso }).eq("id", insertedId);
      const r = await sendSupabaseRecovery(email);
      if (!r.ok) return { ok: false, error: GENERIC_FAIL };
      await logAudit({
        action: "password_reset_requested",
        entity: "profiles",
        entityId: target.id,
        diff: { channel: "supabase", smtp_error: sent.reason ?? null },
      });
      return { ok: true, channel: "supabase" };
    }

    await logAudit({ action: "password_reset_requested", entity: "profiles", entityId: target.id, diff: { channel: "code" } });
    return { ok: true, channel: "code" };
  } catch {
    return { ok: false, error: GENERIC_FAIL };
  }
}

async function signInAfterReset(email: string, password: string, userId: string): Promise<boolean> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return false;
    if (hasServiceKey()) {
      await createAdminClient()
        .from("profiles")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", userId);
    }
    return true;
  } catch {
    return false;
  }
}

/** Ověření OTP ze Supabase e-mailu (když SMTP chybí a šablona obsahuje {{ .Token }}). */
async function resetWithSupabaseOtp(
  email: string,
  code: string,
  newPassword: string,
): Promise<{ ok: boolean; error?: string; signedIn?: boolean }> {
  if (!isResetCodeFormat(code, "otp")) return { ok: false, error: "Kód nesouhlasí nebo vypršel." };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ email, token: code, type: "recovery" });
  if (error || !data.user) return { ok: false, error: "Kód nesouhlasí nebo vypršel — vyžádej si nový." };

  const userId = data.user.id;
  if (hasServiceKey()) {
    const { data: profile } = await createAdminClient()
      .from("profiles")
      .select("active")
      .eq("id", userId)
      .maybeSingle();
    if (!profile || (profile as { active: boolean }).active === false) {
      await supabase.auth.signOut();
      return { ok: false, error: "Účet není aktivní. Požádej super admina o aktivaci." };
    }
  }

  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
  if (updateError) return { ok: false, error: translateAuthError(updateError.message) };
  await clearPasswordChangeRequired(userId);
  await logAudit({
    action: "password_reset", entity: "profiles", entityId: userId, diff: { channel: "supabase_otp" }, actor: userActor({ id: userId }),
  });
  return { ok: true, signedIn: true };
}

/** Krok 2: ověří kód, nastaví nové heslo a rovnou přihlásí. */
export async function resetPasswordWithCode(
  rawEmail: string,
  rawCode: string,
  newPassword: string,
): Promise<{ ok: boolean; error?: string; signedIn?: boolean }> {
  const email = normalizeEmail(rawEmail);
  const code = normalizeResetCode(rawCode);
  if (!isPlausibleEmail(email)) return { ok: false, error: "Zadej platný e-mail." };
  if (code.length < 6) return { ok: false, error: "Zadej 6místný kód z e-mailu." };
  const problem = passwordProblem(newPassword);
  if (problem) return { ok: false, error: problem };
  if (!isSupabaseConfigured()) return { ok: false, error: NOT_CONFIGURED };

  try {
    if (!hasServiceKey()) return await resetWithSupabaseOtp(email, code, newPassword);

    const db: AdminDb = createAdminClient();
    const { data: rows } = await db
      .from("password_reset_codes")
      .select("*")
      .eq("email", email)
      .gte("created_at", dailyWindowStart().toISOString())
      .order("created_at", { ascending: false })
      .limit(50);
    const all = (rows ?? []) as PasswordResetCode[];
    if (dailyAttemptsExceeded(all)) {
      return { ok: false, error: "Příliš mnoho pokusů za dnešek — zkus to zítra, nebo požádej super admina o nové heslo." };
    }
    const now = Date.now();
    const active = all.find((r) => !r.used_at && new Date(r.expires_at).getTime() > now);

    if (!active) {
      // Vlastní kód není → zkus OTP ze Supabase e-mailu
      const otp = await resetWithSupabaseOtp(email, code, newPassword);
      if (otp.ok || all.length === 0) return otp;
      return { ok: false, error: "Kód nesouhlasí nebo vypršel — zkontroluj ho, případně si vyžádej nový." };
    }

    if (active.attempts >= RESET_MAX_ATTEMPTS) {
      return { ok: false, error: "Příliš mnoho pokusů — vyžádej si nový kód." };
    }

    // Každý pokus se nejdřív „rezervuje" podmíněným updatem — paralelní pokusy
    // tak nemohou obejít limit (UPDATE … WHERE attempts = n je atomický).
    const attempts = active.attempts + 1;
    const { data: claimed } = await db
      .from("password_reset_codes")
      .update({ attempts })
      .eq("id", active.id)
      .eq("attempts", active.attempts)
      .is("used_at", null)
      .select("id");
    if (!claimed || (claimed as unknown[]).length === 0) {
      return { ok: false, error: "Kód se právě ověřuje — zkus to prosím znovu." };
    }

    if (!isResetCodeFormat(code) || !verifyResetCode(active.code_hash, active.user_id, code, secret())) {
      const left = remainingAttempts(attempts);
      if (left === 0) return { ok: false, error: "Příliš mnoho pokusů — vyžádej si nový kód." };
      return { ok: false, error: `Kód nesouhlasí. ${attemptsLabel(left)}.` };
    }

    const { data: profile } = await db
      .from("profiles")
      .select("active")
      .eq("id", active.user_id)
      .maybeSingle();
    if (!profile || (profile as { active: boolean }).active === false) {
      return { ok: false, error: "Účet není aktivní. Požádej super admina o aktivaci." };
    }

    // Kód je jednorázový — zabrat ho dřív, než se změní heslo
    const { data: used } = await db
      .from("password_reset_codes")
      .update({ used_at: new Date().toISOString() })
      .eq("id", active.id)
      .is("used_at", null)
      .select("id");
    if (!used || (used as unknown[]).length === 0) {
      return { ok: false, error: "Kód už byl použit — vyžádej si nový." };
    }

    const { error: updateError } = await db.auth.admin.updateUserById(active.user_id, { password: newPassword });
    if (updateError) {
      // heslo neprošlo pravidly Supabase → kód vrátit, ať jde zkusit jiné heslo
      await db.from("password_reset_codes").update({ used_at: null }).eq("id", active.id);
      return { ok: false, error: translateAuthError(updateError.message) };
    }

    const { data: authUser } = await db.auth.admin.getUserById(active.user_id);
    const loginEmail = (authUser?.user?.email as string | undefined) ?? email;
    const signedIn = await signInAfterReset(loginEmail, newPassword, active.user_id);
    await clearPasswordChangeRequired(active.user_id);
    await logAudit({
      action: "password_reset", entity: "profiles", entityId: active.user_id, diff: { channel: "code" },
      actor: userActor({ id: active.user_id }),
    });
    return { ok: true, signedIn };
  } catch {
    return { ok: false, error: GENERIC_FAIL };
  }
}

/** Nové heslo po příchodu z odkazu Supabase (session už existuje). */
export async function updatePasswordAfterRecovery(newPassword: string): Promise<{ ok: boolean; error?: string }> {
  const problem = passwordProblem(newPassword);
  if (problem) return { ok: false, error: problem };
  if (!isSupabaseConfigured()) return { ok: false, error: NOT_CONFIGURED };
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Odkaz vypršel — vyžádej si nový kód na stránce Zapomenuté heslo." };
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { ok: false, error: translateAuthError(error.message) };
    await clearPasswordChangeRequired(user.id);
    await logAudit({
      action: "password_reset", entity: "profiles", entityId: user.id, diff: { channel: "supabase_link" }, actor: userActor(user),
    });
    return { ok: true };
  } catch {
    return { ok: false, error: GENERIC_FAIL };
  }
}

/** Změna vlastního hesla (Můj účet) — vyžaduje současné heslo. */
export async function changeOwnPassword(
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Nejsi přihlášen — přihlas se znovu." };
  if (!user.active) return { ok: false, error: "Účet není aktivní." };
  if (!currentPassword) return { ok: false, error: "Zadej současné heslo." };
  const problem = passwordProblem(newPassword);
  if (problem) return { ok: false, error: problem };
  if (currentPassword === newPassword) return { ok: false, error: "Nové heslo musí být jiné než současné." };

  try {
    // Ověření současného hesla na samostatném klientovi (nesahá na session v cookies)
    const verifier = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
    );
    const { error: verifyError } = await verifier.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });
    if (verifyError) return { ok: false, error: "Současné heslo nesouhlasí." };
    await verifier.auth.signOut({ scope: "local" }).catch(() => undefined);

    if (hasServiceKey()) {
      const { error } = await createAdminClient().auth.admin.updateUserById(user.id, { password: newPassword });
      if (error) return { ok: false, error: translateAuthError(error.message) };
    } else {
      const supabase = await createClient();
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) return { ok: false, error: translateAuthError(error.message) };
    }
    await clearPasswordChangeRequired(user.id);
    await logAudit({ action: "password_changed", entity: "profiles", entityId: user.id, actor: userActor(user) });
    return { ok: true };
  } catch {
    return { ok: false, error: GENERIC_FAIL };
  }
}

/** Úprava vlastního profilu (jen jméno a telefon). */
export async function updateOwnProfile(input: {
  fullName: string;
  phone?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Nejsi přihlášen — přihlas se znovu." };
  if (!user.active) return { ok: false, error: "Účet není aktivní." };

  const fullName = String(input.fullName ?? "").trim().replace(/\s+/g, " ");
  const phone = String(input.phone ?? "").trim();
  if (!fullName) return { ok: false, error: "Vyplň jméno." };
  if (fullName.length > 120) return { ok: false, error: "Jméno je příliš dlouhé." };
  if (phone.length > 40) return { ok: false, error: "Telefon je příliš dlouhý." };
  if (phone && !/^[+\d\s()/.-]+$/.test(phone)) return { ok: false, error: "Telefon smí obsahovat jen číslice, mezery a +()-/." };

  try {
    const update = { full_name: fullName, phone: phone || null };
    if (hasServiceKey()) {
      const db: AdminDb = createAdminClient({ actor: userActor(user) });
      const { error } = await db.from("profiles").update(update).eq("id", user.id);
      if (error) return { ok: false, error: error.message };
      // jméno i v auth metadatech (e-maily ze Supabase, fallback bez profilu)
      await db.auth.admin.updateUserById(user.id, { user_metadata: { full_name: fullName } }).catch(() => undefined);
    } else {
      const supabase = await createClient();
      const { error } = await supabase.from("profiles").update(update as never).eq("id", user.id);
      if (error) return { ok: false, error: error.message };
    }
    await logAudit({
      action: "profile_updated", entity: "profiles", entityId: user.id, diff: { full_name: fullName, phone: phone || null },
      actor: userActor(user),
    });
    revalidatePath("/account");
    revalidatePath("/", "layout");
    return { ok: true };
  } catch {
    return { ok: false, error: GENERIC_FAIL };
  }
}

/** Srozumitelné české chyby ze Supabase Auth. */
function translateAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("should be different") || m.includes("same password")) return "Nové heslo musí být jiné než současné.";
  if (m.includes("weak") || m.includes("at least") || m.includes("characters")) {
    return "Heslo je příliš slabé — použij delší heslo s písmeny i číslicemi.";
  }
  if (m.includes("reauthentication")) return "Pro změnu hesla se nejdřív znovu přihlas.";
  if (m.includes("rate limit") || m.includes("too many")) return "Příliš mnoho pokusů — chvíli počkej a zkus to znovu.";
  return message;
}
