"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createAdminClient, hasServiceKey, isSupabaseConfigured } from "@/lib/supabase/server";
import { checkFeature } from "@/lib/auth/session";
import { logAudit } from "@/lib/audit";
import { sendMail } from "@/lib/email/send";
import { welcomeUserEmail } from "@/lib/email/templates";
import { refreshCompanyFromSettings } from "@/lib/company-server";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { setMailboxOwner } from "@/app/actions/mailbox-owner";
import { requestPasswordReset } from "@/app/auth/password";
import {
  normalizeEmail, isPlausibleEmail, originFrom, resetWindowStart, RESET_MAX_REQUESTS,
} from "@/lib/auth/reset-code";
import { passwordProblem } from "@/components/users/password-tools";
import {
  userChangeProblem, deleteUserProblem, parseCommissionPercent, cleanText, cleanPhone, isUserRole,
  type GuardTarget,
} from "@/components/users/user-rules";
import type { CurrentUser } from "@/lib/data/current-user";
import type { UserRole } from "@/lib/supabase/database.types";

/**
 * Správa uživatelů — jen super admin (funkce „users"). Účty zakládá a maže
 * servisní klíč; každá akce se zapisuje do audit logu.
 */

type Result = { ok: boolean; error?: string };

/** Admin klient (servisní klíč) — netypovaný, výsledky přetypováváme na řádky z database.types. */
type AdminDb = ReturnType<typeof createAdminClient>;

async function guard(): Promise<{ user: CurrentUser; db: AdminDb } | { error: string }> {
  const access = await checkFeature("users");
  if ("error" in access) return { error: access.error };
  if (!isSupabaseConfigured() || !hasServiceKey()) {
    return { error: "Nejdřív dokonči připojení Supabase (servisní klíč)." };
  }
  return { user: access.user, db: createAdminClient() };
}

async function loadTarget(db: AdminDb, id: string): Promise<(GuardTarget & { email: string | null; full_name: string }) | null> {
  if (!id || typeof id !== "string") return null;
  const { data } = await db
    .from("profiles")
    .select("id, role, active, email, full_name")
    .eq("id", id)
    .maybeSingle();
  return (data as (GuardTarget & { email: string | null; full_name: string }) | null) ?? null;
}

async function countActiveSuperAdmins(db: AdminDb): Promise<number> {
  const { count } = await db
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "super_admin")
    .eq("active", true);
  return count ?? 0;
}

async function appOrigin(): Promise<string> {
  const h = await headers();
  return originFrom({
    proto: h.get("x-forwarded-proto"),
    host: h.get("x-forwarded-host") ?? h.get("host"),
    fallback: process.env.NEXT_PUBLIC_APP_URL,
  });
}

function revalidateUsers() {
  revalidatePath("/users");
  revalidatePath("/settings");
}

function authErrorCz(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("already") && (m.includes("registered") || m.includes("exists"))) {
    return "Uživatel s tímto e-mailem už existuje.";
  }
  if (m.includes("weak") || m.includes("password should")) return "Heslo je příliš slabé — použij delší heslo s písmeny i číslicemi.";
  if (m.includes("invalid") && m.includes("email")) return "E-mail není platný.";
  return message;
}

export interface CreateUserInput {
  email: string;
  password: string;
  fullName: string;
  role: UserRole;
  phone?: string | null;
  position?: string | null;
  /** V procentech, např. 8 nebo 8,5. */
  commissionRate?: number | string | null;
  aiAccess?: boolean;
  mailboxId?: string | null;
  sendWelcome?: boolean;
}

/** Založí účet s heslem, profil (role, provize, AI), volitelně schránku a uvítací e-mail. */
export async function createUser(
  input: CreateUserInput,
): Promise<{ ok: boolean; error?: string; userId?: string; welcomeSent?: boolean; warnings?: string[] }> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: g.error };
  const { db } = g;

  const email = normalizeEmail(input?.email);
  if (!isPlausibleEmail(email)) return { ok: false, error: "Zadej platný e-mail." };
  const pwProblem = passwordProblem(String(input.password ?? ""));
  if (pwProblem) return { ok: false, error: pwProblem };
  if (!isUserRole(input.role)) return { ok: false, error: "Vyber roli uživatele." };
  const name = cleanText(input.fullName, "Jméno", 120);
  if (name.error) return { ok: false, error: name.error };
  const phone = cleanPhone(input.phone);
  if (phone.error) return { ok: false, error: phone.error };
  const position = cleanText(input.position, "Funkce", 80);
  if (position.error) return { ok: false, error: position.error };
  const commission = parseCommissionPercent(input.commissionRate);
  if ("error" in commission) return { ok: false, error: commission.error };

  const fullName = name.value ?? email.split("@")[0];
  const role = input.role;
  const warnings: string[] = [];

  try {
    const { data, error } = await db.auth.admin.createUser({
      email,
      password: input.password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
      app_metadata: { role, invited: true },
    });
    if (error || !data?.user?.id) return { ok: false, error: authErrorCz(error?.message ?? "Účet se nepodařilo založit.") };
    const id = data.user.id as string;

    // Trigger handle_new_user už profil založil — doplníme vše ostatní
    const { error: profileError } = await db.from("profiles").upsert(
      {
        id,
        email,
        full_name: fullName,
        role,
        phone: phone.value,
        position: position.value,
        commission_rate: commission.rate,
        ai_access: Boolean(input.aiAccess),
        active: true,
      },
      { onConflict: "id" },
    );
    if (profileError) {
      // bez profilu by účet nefungoval → vrátit zpět
      await db.auth.admin.deleteUser(id).catch(() => undefined);
      return { ok: false, error: `Profil se nepodařilo uložit: ${profileError.message}` };
    }

    if (input.mailboxId) {
      const r = await setMailboxOwner(input.mailboxId, id);
      if (!r.ok) warnings.push(`Schránku se nepodařilo přiřadit: ${r.error ?? "chyba"}`);
    }

    let welcomeSent = false;
    if (input.sendWelcome) {
      const origin = await appOrigin();
      await refreshCompanyFromSettings();
      const mail = welcomeUserEmail({
        name: fullName,
        email,
        loginUrl: `${origin}/login`,
        forgotUrl: `${origin}/forgot-password`,
        password: input.password,
        roleLabel: ROLE_LABELS[role],
      });
      const sent = await sendMail({
        to: email,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        log: false,
        from: { ownerId: g.user.id },
      });
      welcomeSent = sent.sent;
      if (!sent.sent) warnings.push(`Uvítací e-mail se nepodařilo odeslat: ${sent.reason ?? "chyba"}`);
    }

    await logAudit({
      action: "user_created",
      entity: "profiles",
      entityId: id,
      diff: { email, role, ai_access: Boolean(input.aiAccess), mailbox_id: input.mailboxId ?? null, welcome_sent: welcomeSent },
    });
    revalidateUsers();
    return { ok: true, userId: id, welcomeSent, warnings: warnings.length ? warnings : undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba" };
  }
}

export interface UpdateUserChanges {
  role?: UserRole;
  /** V procentech. */
  commissionRate?: number | string | null;
  active?: boolean;
  fullName?: string;
  phone?: string | null;
  position?: string | null;
  aiAccess?: boolean;
}

/** Úprava uživatele. Nelze odebrat sám sobě super admina ani se deaktivovat; poslední aktivní super admin zůstává. */
export async function updateUser(id: string, changes: UpdateUserChanges): Promise<Result> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: g.error };
  const { db, user: actor } = g;

  try {
    const target = await loadTarget(db, id);
    if (!target) return { ok: false, error: "Uživatel nenalezen." };

    const update: Record<string, unknown> = {};
    if (changes.role !== undefined) {
      if (!isUserRole(changes.role)) return { ok: false, error: "Neplatná role." };
      if (changes.role !== target.role) update.role = changes.role;
    }
    if (changes.active !== undefined) {
      if (Boolean(changes.active) !== target.active) update.active = Boolean(changes.active);
    }
    if (changes.fullName !== undefined) {
      const n = cleanText(changes.fullName, "Jméno", 120);
      if (n.error) return { ok: false, error: n.error };
      if (!n.value) return { ok: false, error: "Jméno nesmí být prázdné." };
      update.full_name = n.value;
    }
    if (changes.phone !== undefined) {
      const p = cleanPhone(changes.phone);
      if (p.error) return { ok: false, error: p.error };
      update.phone = p.value;
    }
    if (changes.position !== undefined) {
      const p = cleanText(changes.position, "Funkce", 80);
      if (p.error) return { ok: false, error: p.error };
      update.position = p.value;
    }
    if (changes.commissionRate !== undefined) {
      const c = parseCommissionPercent(changes.commissionRate);
      if ("error" in c) return { ok: false, error: c.error };
      update.commission_rate = c.rate;
    }
    if (changes.aiAccess !== undefined) update.ai_access = Boolean(changes.aiAccess);
    if (Object.keys(update).length === 0) return { ok: true };

    if (update.role !== undefined || update.active !== undefined) {
      const problem = userChangeProblem({
        actorId: actor.id,
        target,
        change: { role: update.role as UserRole | undefined, active: update.active as boolean | undefined },
        activeSuperAdmins: await countActiveSuperAdmins(db),
      });
      if (problem) return { ok: false, error: problem };
    }

    const { error } = await db.from("profiles").update(update).eq("id", id);
    if (error) return { ok: false, error: error.message };

    // Metadata v Auth držíme v souladu (role jen v app_metadata — nastavuje ji pouze server)
    if (update.role !== undefined || update.full_name !== undefined) {
      const attrs: Record<string, unknown> = {};
      if (update.role !== undefined) attrs.app_metadata = { role: update.role, invited: true };
      if (update.full_name !== undefined) attrs.user_metadata = { full_name: update.full_name };
      await db.auth.admin.updateUserById(id, attrs).catch(() => undefined);
    }

    await logAudit({ action: "user_updated", entity: "profiles", entityId: id, diff: update });
    revalidateUsers();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba" };
  }
}

/** Super admin nastaví uživateli nové heslo. */
export async function setUserPassword(id: string, password: string): Promise<Result> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: g.error };
  const problem = passwordProblem(String(password ?? ""));
  if (problem) return { ok: false, error: problem };
  try {
    const target = await loadTarget(g.db, id);
    if (!target) return { ok: false, error: "Uživatel nenalezen." };
    const { error } = await g.db.auth.admin.updateUserById(id, { password });
    if (error) return { ok: false, error: authErrorCz(error.message) };
    // rozpracované kódy pro obnovu už nejsou potřeba
    await g.db
      .from("password_reset_codes")
      .update({ used_at: new Date().toISOString() })
      .eq("user_id", id)
      .is("used_at", null);
    await logAudit({ action: "user_password_set", entity: "profiles", entityId: id });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba" };
  }
}

/** Smaže účet. Nikdy sebe, nikdy posledního aktivního super admina, ne s historií provizí. */
export async function deleteUser(id: string): Promise<Result> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: g.error };
  const { db, user: actor } = g;
  try {
    const target = await loadTarget(db, id);
    if (!target) return { ok: false, error: "Uživatel nenalezen." };
    const problem = deleteUserProblem({ actorId: actor.id, target, activeSuperAdmins: await countActiveSuperAdmins(db) });
    if (problem) return { ok: false, error: problem };

    // Provize jsou na uživatele navázané kaskádou — smazáním by zmizela historie
    const { count: commissions } = await db
      .from("commission_entries")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", id);
    if ((commissions ?? 0) > 0) {
      return {
        ok: false,
        error: "Uživatel má záznamy provizí — místo smazání ho deaktivuj, historie tak zůstane zachovaná.",
      };
    }

    const { error } = await db.auth.admin.deleteUser(id);
    if (error) {
      return { ok: false, error: `Smazání se nepovedlo (${error.message}). Uživatele můžeš místo toho deaktivovat.` };
    }
    await logAudit({
      action: "user_deleted",
      entity: "profiles",
      entityId: id,
      diff: { email: target.email, role: target.role, full_name: target.full_name },
    });
    revalidateUsers();
    revalidatePath("/inbox");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba" };
  }
}

/** Pošle uživateli e-mailem kód pro obnovu hesla (stejný tok jako „Zapomenuté heslo"). */
export async function sendUserResetCode(id: string): Promise<{ ok: boolean; error?: string; channel?: "code" | "supabase" }> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: g.error };
  try {
    const target = await loadTarget(g.db, id);
    if (!target) return { ok: false, error: "Uživatel nenalezen." };
    const email = normalizeEmail(target.email);
    if (!email) return { ok: false, error: "Uživatel nemá vyplněný e-mail." };
    if (!target.active) return { ok: false, error: "Účet je neaktivní — nejdřív ho aktivuj." };

    const { count } = await g.db
      .from("password_reset_codes")
      .select("id", { count: "exact", head: true })
      .eq("email", email)
      .gte("created_at", resetWindowStart().toISOString());
    if ((count ?? 0) >= RESET_MAX_REQUESTS) {
      return { ok: false, error: `Kód už byl v posledních 15 minutách odeslán ${RESET_MAX_REQUESTS}× — zkus to později.` };
    }

    const r = await requestPasswordReset(email);
    if (!r.ok) return { ok: false, error: r.error ?? "Kód se nepodařilo odeslat." };
    await logAudit({ action: "user_reset_code_sent", entity: "profiles", entityId: id, diff: { channel: r.channel ?? null } });
    return { ok: true, channel: r.channel };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba" };
  }
}
