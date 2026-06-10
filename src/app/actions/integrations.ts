"use server";

import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured, hasServiceKey } from "@/lib/supabase/server";
import { canModifySetup } from "@/lib/setup/guard";
import type { MailboxProvider, MailboxConfig } from "@/lib/supabase/database.types";

type Result = { ok: boolean; error?: string };

const NEED_OPERATOR =
  "Pro ukládání doplň servisní klíč Supabase (SUPABASE_SECRET_KEY) nebo se přihlas jako super admin.";
const GUARD_ERROR = "Tuto akci smí provádět jen přihlášený super admin.";

/** Uloží hodnoty integrací. Prázdné hodnoty u tajných klíčů přeskočí (nepřepíše). */
export async function saveIntegrationSettings(
  values: Record<string, string>,
  secretKeys: string[],
): Promise<Result> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase není nakonfigurováno — nelze uložit." };
  }
  try {
    const db = await createOperatorClient();
    const secrets = new Set(secretKeys);
    const updates = Object.entries(values).filter(
      ([key, val]) => !(secrets.has(key) && val.trim() === ""), // tajné prázdné = ponechat
    );
    let changed = 0;
    for (const [key, val] of updates) {
      const { data, error } = await db
        .from("integration_settings")
        .update({ value: val.trim() === "" ? null : val.trim() } as never)
        .eq("key", key)
        .select("key");
      if (error) return { ok: false, error: error.message };
      changed += data?.length ?? 0;
    }
    if (changed === 0) return { ok: false, error: hasServiceKey() ? "Nic se neuložilo." : NEED_OPERATOR };
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
  if (!payload.email.trim()) return { ok: false, error: "Zadej e-mailovou adresu." };
  if (!(await canModifySetup())) return { ok: false, error: GUARD_ERROR };
  try {
    const db = await createOperatorClient();
    const { data, error } = await db
      .from("mailboxes")
      .insert({
        provider: payload.provider,
        email: payload.email.trim(),
        display_name: payload.displayName?.trim() || null,
        config: sanitizeConfig(payload.config),
      } as never)
      .select("id");
    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) return { ok: false, error: NEED_OPERATOR };
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba" };
  }
}

/** Úprava schránky. Prázdná hesla = ponechat původní. */
export async function updateMailbox(id: string, payload: MailboxPayload): Promise<Result> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase není nakonfigurováno." };
  if (!(await canModifySetup())) return { ok: false, error: GUARD_ERROR };
  try {
    const db = await createOperatorClient();
    const { data: existing } = await db.from("mailboxes").select("config").eq("id", id).maybeSingle();
    const prev = ((existing as { config?: MailboxConfig } | null)?.config ?? {}) as MailboxConfig;
    const next = sanitizeConfig(payload.config);
    // tajné hodnoty: prázdné pole znamená „beze změny"
    for (const key of ["imap_password", "smtp_password", "ms_graph_client_secret"] as const) {
      if (!next[key] && prev[key]) next[key] = prev[key];
    }
    const { error } = await db
      .from("mailboxes")
      .update({
        provider: payload.provider,
        email: payload.email.trim(),
        display_name: payload.displayName?.trim() || null,
        config: next,
      } as never)
      .eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba" };
  }
}

export async function deleteMailbox(id: string): Promise<Result> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase není nakonfigurováno." };
  if (!(await canModifySetup())) return { ok: false, error: GUARD_ERROR };
  try {
    const db = await createOperatorClient();
    const { error } = await db.from("mailboxes").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/settings");
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
  if (!(await canModifySetup())) {
    const denied = { ok: false, error: GUARD_ERROR };
    return { imap: denied, smtp: denied, graph: null };
  }

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
