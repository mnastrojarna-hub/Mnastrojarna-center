"use server";

import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured, hasServiceKey } from "@/lib/supabase/server";
import { superAdminExists } from "@/lib/setup/guard";
import { checkFeature } from "@/lib/auth/session";
import { isUuidLike } from "@/lib/email/visibility";
import { logAudit } from "@/lib/audit";
import { userActor } from "@/lib/supabase/actor-headers";
import { invalidateSettingsCache } from "@/lib/settings";
import {
  describeConfigChanges, mergeMailboxSecrets, normalizeEmail, normalizeMailboxConfig, validateMailboxConfig, type SecretChanges,
} from "@/lib/email/mail-config";
import { testMailbox } from "@/lib/email/mailbox-diagnose";
import { updateMailboxStatus } from "@/lib/email/mailbox-status";
import type { MailboxProvider, MailboxConfig } from "@/lib/supabase/database.types";

type Result = { ok: boolean; error?: string };

const NEED_OPERATOR =
  "Pro ukládání doplň servisní klíč Supabase (SUPABASE_SECRET_KEY) nebo se přihlas jako super admin.";

/**
 * Nastavení a schránky smí měnit jen super admin (funkce „settings").
 * Výjimka: první zprovoznění (bez servisního klíče / bez super admina) — průvodce.
 * Vrací chybu, nebo null = povoleno.
 */
async function guardSettings(): Promise<string | null> {
  if (!isSupabaseConfigured() || !hasServiceKey()) return null;
  if (!(await superAdminExists())) return null;
  const access = await checkFeature("settings");
  return "error" in access ? access.error : null;
}

const VALID_PROVIDERS: MailboxProvider[] = ["imap", "outlook", "gmail"];

/** Uloží hodnoty integrací. Prázdné hodnoty u tajných klíčů přeskočí (nepřepíše). */
export async function saveIntegrationSettings(
  values: Record<string, string>,
  secretKeys: string[],
): Promise<Result> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase není nakonfigurováno — nelze uložit." };
  }
  const denied = await guardSettings();
  if (denied) return { ok: false, error: denied };
  if (!values || typeof values !== "object") return { ok: false, error: "Chybí hodnoty." };
  try {
    const db = await createOperatorClient();
    const secrets = new Set(Array.isArray(secretKeys) ? secretKeys : []);
    const updates = Object.entries(values).filter(
      ([key, val]) => !(secrets.has(key) && val.trim() === ""), // tajné prázdné = ponechat
    );
    let changed = 0;
    for (const [key, val] of updates) {
      // upsert: klíč nemusí být předem zaveden migrací (nové verze přidávají klíče)
      const { data, error } = await db
        .from("integration_settings")
        // hesla se neořezávají (mezera může být součástí hesla) — jen konce řádků
        .upsert({ key, value: val.trim() === "" ? null : secrets.has(key) ? val.replace(/[\r\n]+/g, "") : val.trim() } as never, { onConflict: "key" })
        .select("key");
      if (error) return { ok: false, error: error.message };
      changed += data?.length ?? 0;
    }
    if (changed === 0) return { ok: false, error: hasServiceKey() ? "Nic se neuložilo." : NEED_OPERATOR };
    invalidateSettingsCache(); // nové klíče / vypínač AI platí hned
    await logAudit({ action: "settings_updated", entity: "integration_settings", diff: { keys: updates.map(([k]) => k) } });
    revalidatePath("/settings");
    revalidatePath("/setup");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba ukládání" };
  }
}

// ── Limit schválení nabídek (čtyři oči nad částkou, R10) ────
const QUOTE_APPROVAL_LIMIT_KEY = "quote_approval_limit";

/**
 * Nabídka nad limitem (Kč bez DPH) potřebuje schválení; vlastní nabídku nad limitem schválí jen
 * super admin. null / 0 = vypnuto. DB počítá approval_required při každém zápisu nabídky.
 */
export async function saveQuoteApprovalLimit(limit: number | null): Promise<Result> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase není nakonfigurováno — nelze uložit." };
  const access = await checkFeature("settings");
  if ("error" in access) return { ok: false, error: access.error };
  const value = limit === null || limit === 0 ? null : Number(limit);
  if (value !== null && (!Number.isFinite(value) || value < 0 || value > 1e10)) return { ok: false, error: "Limit musí být kladná částka v Kč." };
  try {
    const actor = userActor(access.user);
    const db = await createOperatorClient({ actor });
    const { data: prev } = await db.from("integration_settings").select("value").eq("key", QUOTE_APPROVAL_LIMIT_KEY).maybeSingle();
    const from = (prev as { value: string | null } | null)?.value ?? null;
    const next = value === null ? null : String(Math.round(value));
    const { error } = await db.from("integration_settings").upsert({
      key: QUOTE_APPROVAL_LIMIT_KEY, value: next, category: "firma", label: "Limit schválení nabídek (Kč bez DPH)", is_secret: false,
    } as never, { onConflict: "key" });
    if (error) return { ok: false, error: error.message };
    invalidateSettingsCache();
    if (from !== next) {
      await logAudit({ action: "settings_updated", entity: "integration_settings", entityId: QUOTE_APPROVAL_LIMIT_KEY, diff: { key: QUOTE_APPROVAL_LIMIT_KEY, from, to: next }, actor });
    }
    revalidatePath("/settings");
    revalidatePath("/quotes");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba ukládání" };
  }
}

// ── Schránky ────────────────────────────────────────────────

export interface MailboxPayload {
  provider: MailboxProvider;
  email: string;
  displayName?: string;
  /** Servery, porty, uživatelé, šifrování. Hesla sem nepatří (starší volání je tu smí mít). */
  config: MailboxConfig;
  /** Nová hesla — jen po výslovném „Změnit heslo"; prázdné / chybějící = beze změny. */
  secrets?: SecretChanges;
  /** Vlastník schránky (vidí její poštu). Undefined = beze změny, null = bez vlastníka. */
  ownerId?: string | null;
}

/** Kontrola vstupu schránky (typ, adresa, vlastník, povinná pole podle typu); vrací chybu, nebo null. */
function validateMailbox(payload: MailboxPayload, config: MailboxConfig, errors: string[]): string | null {
  if (!payload || typeof payload !== "object") return "Chybí údaje schránky.";
  if (!VALID_PROVIDERS.includes(payload.provider)) return "Neznámý typ schránky.";
  if (payload.ownerId !== undefined && payload.ownerId !== null && !isUuidLike(payload.ownerId)) {
    return "Neplatný vlastník schránky.";
  }
  if (errors.length) return errors.join(" ");
  return validateMailboxConfig({ provider: payload.provider, email: payload.email, config });
}

/** Normalizovaná konfigurace + hesla (nová přednostně, jinak uložená). */
function prepareConfig(payload: MailboxPayload, prev: MailboxConfig | null) {
  const { config, errors, notes } = normalizeMailboxConfig(payload.config ?? {});
  return { config: mergeMailboxSecrets(prev, config, payload.secrets ?? {}), errors, notes };
}

export async function addMailbox(payload: MailboxPayload): Promise<Result & { id?: string; notes?: string[] }> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase není nakonfigurováno." };
  const { config, errors, notes } = prepareConfig(payload, null);
  const invalid = validateMailbox(payload, config, errors);
  if (invalid) return { ok: false, error: invalid };
  const denied = await guardSettings();
  if (denied) return { ok: false, error: denied };
  try {
    const db = await createOperatorClient();
    const email = normalizeEmail(payload.email);
    const { data: dup } = await db.from("mailboxes").select("id").ilike("email", email).limit(1);
    if (dup && dup.length) return { ok: false, error: `Schránka ${email} už existuje — uprav ji v seznamu.` };
    const { data, error } = await db
      .from("mailboxes")
      .insert({
        provider: payload.provider,
        email,
        display_name: payload.displayName?.trim() || null,
        config,
        owner_id: payload.ownerId ?? null,
      } as never)
      .select("id");
    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) return { ok: false, error: NEED_OPERATOR };
    const id = (data[0] as { id: string }).id;
    await logAudit({
      action: "mailbox_added",
      entity: "mailboxes",
      entityId: id,
      diff: { email, provider: payload.provider, owner_id: payload.ownerId ?? null, changes: describeConfigChanges({}, config) },
    });
    revalidatePath("/settings");
    revalidatePath("/users");
    revalidatePath("/inbox");
    return { ok: true, id, notes };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba" };
  }
}

/** Úprava schránky. Hesla se mění jen výslovně (`secrets`); prázdná = ponechat původní. */
export async function updateMailbox(id: string, payload: MailboxPayload): Promise<Result & { notes?: string[] }> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase není nakonfigurováno." };
  if (!isUuidLike(id)) return { ok: false, error: "Schránka nenalezena." };
  const denied = await guardSettings();
  if (denied) return { ok: false, error: denied };
  try {
    const db = await createOperatorClient();
    const { data: existing } = await db.from("mailboxes").select("config, owner_id, provider, email, display_name").eq("id", id).maybeSingle();
    if (!existing) return { ok: false, error: "Schránka nenalezena." };
    const prevRow = existing as { config?: MailboxConfig; owner_id?: string | null; provider: MailboxProvider; email: string; display_name: string | null };
    const prev = (prevRow.config ?? {}) as MailboxConfig;
    const { config: next, errors, notes } = prepareConfig(payload, prev);
    const invalid = validateMailbox(payload, next, errors);
    if (invalid) return { ok: false, error: invalid };
    const email = normalizeEmail(payload.email);
    const ownerChanged = payload.ownerId !== undefined && (payload.ownerId ?? null) !== (prevRow.owner_id ?? null);
    const { error } = await db
      .from("mailboxes")
      .update({
        provider: payload.provider,
        email,
        display_name: payload.displayName?.trim() || null,
        config: next,
        ...(ownerChanged ? { owner_id: payload.ownerId ?? null } : {}),
      } as never)
      .eq("id", id);
    if (error) return { ok: false, error: error.message };
    if (ownerChanged) {
      // Už stažená pošta schránky patří novému vlastníkovi (stejně jako setMailboxOwner)
      await db.from("emails").update({ owner_id: payload.ownerId ?? null } as never).eq("mailbox_id", id).eq("direction", "in");
    }
    // Jiný server / protokol → stav stahování začne znovu (UID / UIDL platí jen pro jeden server)
    if (prev.imap_host !== next.imap_host || (prev.incoming_protocol ?? "imap") !== (next.incoming_protocol ?? "imap") || prev.imap_user !== next.imap_user) {
      await updateMailboxStatus(id, { sync_state: {}, last_sync_error: null });
    }
    await logAudit({
      action: "mailbox_updated",
      entity: "mailboxes",
      entityId: id,
      diff: {
        email,
        provider: payload.provider,
        ...(prevRow.provider !== payload.provider ? { provider_from: prevRow.provider } : {}),
        ...(ownerChanged ? { owner_id: payload.ownerId ?? null } : {}),
        changes: describeConfigChanges(prev, next),
      },
    });
    revalidatePath("/settings");
    revalidatePath("/inbox");
    if (ownerChanged) revalidatePath("/users");
    return { ok: true, notes };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba" };
  }
}

/** Zapnutí / vypnutí schránky (vypnutá se nestahuje ani se z ní neodesílá). */
export async function setMailboxActive(id: string, active: boolean): Promise<Result> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase není nakonfigurováno." };
  if (!isUuidLike(id)) return { ok: false, error: "Schránka nenalezena." };
  const denied = await guardSettings();
  if (denied) return { ok: false, error: denied };
  try {
    const db = await createOperatorClient();
    const { error } = await db.from("mailboxes").update({ active: active === true } as never).eq("id", id);
    if (error) return { ok: false, error: error.message };
    await logAudit({ action: "mailbox_updated", entity: "mailboxes", entityId: id, diff: { active: active === true } });
    revalidatePath("/settings");
    revalidatePath("/inbox");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba" };
  }
}

export async function deleteMailbox(id: string): Promise<Result> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase není nakonfigurováno." };
  if (!isUuidLike(id)) return { ok: false, error: "Schránka nenalezena." };
  const denied = await guardSettings();
  if (denied) return { ok: false, error: denied };
  try {
    const db = await createOperatorClient();
    const { error } = await db.from("mailboxes").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    await logAudit({ action: "mailbox_deleted", entity: "mailboxes", entityId: id });
    revalidatePath("/settings");
    revalidatePath("/users");
    revalidatePath("/inbox");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba" };
  }
}

// ── Test připojení schránky ─────────────────────────────────

export interface MailboxTestResult {
  imap: { ok: boolean; error?: string } | null;
  smtp: { ok: boolean; error?: string } | null;
  graph: { ok: boolean; error?: string } | null;
}

/**
 * Otestuje příchozí (IMAP/POP3), odchozí (SMTP) a případně Microsoft Graph — postupně po krocích.
 * UI volá /api/mailboxes/diagnose (vlastní maxDuration); tato akce zůstává pro starší volání.
 * S `mailboxId` doplní uložená hesla schránky (do prohlížeče se neposílají).
 */
export async function testMailboxConnection(
  config: MailboxConfig,
  opts: { mailboxId?: string; email?: string; provider?: MailboxProvider; secrets?: SecretChanges } = {},
): Promise<MailboxTestResult> {
  const guard = await guardSettings();
  if (guard) {
    const denied = { ok: false, error: guard };
    return { imap: denied, smtp: denied, graph: null };
  }
  if (!config || typeof config !== "object") return { imap: null, smtp: null, graph: null };
  const provider: MailboxProvider = opts.provider ?? (config.ms_graph_client_id ? "outlook" : "imap");
  const email = opts.email ?? config.imap_user ?? "";
  const r = await testMailbox({ mailboxId: opts.mailboxId && isUuidLike(opts.mailboxId) ? opts.mailboxId : null, provider, email, config, secrets: opts.secrets });
  const short = (d: { ok: boolean; error?: string } | null) => (d ? { ok: d.ok, error: d.error } : null);
  return { imap: short(r.incoming) ?? (r.error ? { ok: false, error: r.error } : null), smtp: short(r.smtp), graph: short(r.graph) };
}
