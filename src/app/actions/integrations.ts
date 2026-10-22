"use server";

import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured, hasServiceKey } from "@/lib/supabase/server";
import { superAdminExists } from "@/lib/setup/guard";
import { checkFeature } from "@/lib/auth/session";
import { isUuidLike } from "@/lib/email/visibility";
import { logAudit } from "@/lib/audit";
import { invalidateSettingsCache } from "@/lib/settings";
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
        .upsert({ key, value: val.trim() === "" ? null : val.trim() } as never, { onConflict: "key" })
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

// ── Schránky ────────────────────────────────────────────────

export interface MailboxPayload {
  provider: MailboxProvider;
  email: string;
  displayName?: string;
  config: MailboxConfig;
  /** Vlastník schránky (vidí její poštu). Undefined = beze změny, null = bez vlastníka. */
  ownerId?: string | null;
}

/** Kontrola vstupu schránky; vrací chybu, nebo null. */
function validateMailbox(payload: MailboxPayload): string | null {
  if (!payload || typeof payload !== "object") return "Chybí údaje schránky.";
  if (!VALID_PROVIDERS.includes(payload.provider)) return "Neznámý typ schránky.";
  const email = String(payload.email ?? "").trim();
  if (!email) return "Zadej e-mailovou adresu.";
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) return "Neplatná e-mailová adresa.";
  if (payload.ownerId !== undefined && payload.ownerId !== null && !isUuidLike(payload.ownerId)) {
    return "Neplatný vlastník schránky.";
  }
  return null;
}

/** Vyčistí konfiguraci: prázdné hodnoty pryč, porty na čísla. */
function sanitizeConfig(config: MailboxConfig): MailboxConfig {
  const out: Record<string, string | number> = {};
  for (const [key, raw] of Object.entries(config)) {
    if (raw === undefined || raw === null) continue;
    const val = String(raw).trim();
    if (!val) continue;
    out[key] = key.endsWith("_port") ? Number(val) : val;
  }
  return out as MailboxConfig;
}

export async function addMailbox(payload: MailboxPayload): Promise<Result> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase není nakonfigurováno." };
  const invalid = validateMailbox(payload);
  if (invalid) return { ok: false, error: invalid };
  const denied = await guardSettings();
  if (denied) return { ok: false, error: denied };
  try {
    const db = await createOperatorClient();
    const { data, error } = await db
      .from("mailboxes")
      .insert({
        provider: payload.provider,
        email: payload.email.trim(),
        display_name: payload.displayName?.trim() || null,
        config: sanitizeConfig(payload.config ?? {}),
        owner_id: payload.ownerId ?? null,
      } as never)
      .select("id");
    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) return { ok: false, error: NEED_OPERATOR };
    await logAudit({
      action: "mailbox_added",
      entity: "mailboxes",
      entityId: (data[0] as { id: string }).id,
      diff: { email: payload.email, provider: payload.provider, owner_id: payload.ownerId ?? null },
    });
    revalidatePath("/settings");
    revalidatePath("/users");
    revalidatePath("/inbox");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba" };
  }
}

/** Úprava schránky. Prázdná hesla = ponechat původní. */
export async function updateMailbox(id: string, payload: MailboxPayload): Promise<Result> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase není nakonfigurováno." };
  if (!isUuidLike(id)) return { ok: false, error: "Schránka nenalezena." };
  const invalid = validateMailbox(payload);
  if (invalid) return { ok: false, error: invalid };
  const denied = await guardSettings();
  if (denied) return { ok: false, error: denied };
  try {
    const db = await createOperatorClient();
    const { data: existing } = await db.from("mailboxes").select("config, owner_id").eq("id", id).maybeSingle();
    if (!existing) return { ok: false, error: "Schránka nenalezena." };
    const prevRow = existing as { config?: MailboxConfig; owner_id?: string | null };
    const prev = (prevRow.config ?? {}) as MailboxConfig;
    const next = sanitizeConfig(payload.config ?? {});
    // tajné hodnoty: prázdné pole znamená „beze změny"
    for (const key of ["imap_password", "smtp_password", "ms_graph_client_secret"] as const) {
      if (!next[key] && prev[key]) next[key] = prev[key];
    }
    const ownerChanged = payload.ownerId !== undefined && (payload.ownerId ?? null) !== (prevRow.owner_id ?? null);
    const { error } = await db
      .from("mailboxes")
      .update({
        provider: payload.provider,
        email: payload.email.trim(),
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
    await logAudit({
      action: "mailbox_updated",
      entity: "mailboxes",
      entityId: id,
      diff: { email: payload.email, provider: payload.provider, ...(ownerChanged ? { owner_id: payload.ownerId ?? null } : {}) },
    });
    revalidatePath("/settings");
    if (ownerChanged) {
      revalidatePath("/users");
      revalidatePath("/inbox");
    }
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

/** Otestuje IMAP (příchozí), SMTP (odchozí) a případně Microsoft Graph. */
export async function testMailboxConnection(config: MailboxConfig): Promise<MailboxTestResult> {
  const guard = await guardSettings();
  if (guard) {
    const denied = { ok: false, error: guard };
    return { imap: denied, smtp: denied, graph: null };
  }
  if (!config || typeof config !== "object") return { imap: null, smtp: null, graph: null };

  const result: MailboxTestResult = { imap: null, smtp: null, graph: null };

  if (config.imap_host && config.imap_user && config.imap_password) {
    try {
      const { ImapFlow } = await import("imapflow");
      const client = new ImapFlow({
        host: config.imap_host,
        port: Number(config.imap_port || 993),
        secure: true,
        auth: { user: config.imap_user, pass: config.imap_password },
        logger: false,
      });
      await client.connect();
      await client.logout();
      result.imap = { ok: true };
    } catch (err) {
      result.imap = { ok: false, error: err instanceof Error ? err.message : "IMAP chyba" };
    }
  }

  if (config.smtp_host && config.smtp_user && config.smtp_password) {
    try {
      const nodemailer = (await import("nodemailer")).default;
      const port = Number(config.smtp_port || 465);
      const transport = nodemailer.createTransport({
        host: config.smtp_host,
        port,
        secure: port === 465,
        auth: { user: config.smtp_user, pass: config.smtp_password },
        connectionTimeout: 8000,
      });
      await transport.verify();
      result.smtp = { ok: true };
    } catch (err) {
      result.smtp = { ok: false, error: err instanceof Error ? err.message : "SMTP chyba" };
    }
  }

  if (config.ms_graph_client_id && config.ms_graph_client_secret && config.ms_graph_tenant_id) {
    try {
      const params = new URLSearchParams({
        client_id: config.ms_graph_client_id,
        client_secret: config.ms_graph_client_secret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      });
      const res = await fetch(
        `https://login.microsoftonline.com/${config.ms_graph_tenant_id}/oauth2/v2.0/token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params,
          signal: AbortSignal.timeout(8000),
        },
      );
      result.graph = res.ok
        ? { ok: true }
        : { ok: false, error: `Microsoft odmítl přihlášení (HTTP ${res.status}).` };
    } catch (err) {
      result.graph = { ok: false, error: err instanceof Error ? err.message : "Graph chyba" };
    }
  }

  return result;
}
