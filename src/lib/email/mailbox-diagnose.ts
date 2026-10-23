import "server-only";
import { createAdminClient, hasServiceKey, isSupabaseConfigured } from "@/lib/supabase/server";
import { SYSTEM_ACTOR } from "@/lib/supabase/actor-headers";
import { diagnoseEndpoint, diagnoseGraph, detectMailSettings, type DetectInput } from "@/lib/email/mail-connect";
import { updateMailboxStatus } from "@/lib/email/mailbox-status";
import {
  isPresetId, mergeMailboxSecrets, normalizeMailboxConfig, resolveIncoming, resolveSmtp, normalizeEmail, EMAIL_RE,
  type DetectResult, type DiagResult, type SecretChanges,
} from "@/lib/email/mail-config";
import type { MailboxConfig, MailboxProvider } from "@/lib/supabase/database.types";

/**
 * Test připojení a automatické zjištění nastavení schránky na serveru. Tajné údaje uložené
 * schránky se doplní tady (do prohlížeče se nikdy neposílají) — „Otestovat připojení" u
 * existující schránky tak funguje i bez znovuzadání hesla.
 */

export interface MailboxTestInput {
  mailboxId?: string | null;
  provider: MailboxProvider;
  email: string;
  config: MailboxConfig;
  secrets?: SecretChanges;
}

export interface MailboxTestResponse {
  incoming: DiagResult | null;
  smtp: DiagResult | null;
  graph: DiagResult | null;
  /** Co chybí, aby šlo testovat. */
  missing?: string[];
  notes?: string[];
  error?: string;
}

async function storedConfig(mailboxId: string | null | undefined): Promise<{ config: MailboxConfig; email?: string } | null> {
  if (!mailboxId || !isSupabaseConfigured() || !hasServiceKey()) return null;
  const db = createAdminClient({ actor: SYSTEM_ACTOR });
  const { data } = await db.from("mailboxes").select("config, email").eq("id", mailboxId).maybeSingle();
  const row = data as { config: MailboxConfig | null; email: string } | null;
  return row ? { config: row.config ?? {}, email: row.email } : null;
}

/** Konfigurace k testu = formulář (normalizovaný) + uložená hesla schránky + nově zadaná hesla. */
export async function effectiveConfig(input: MailboxTestInput): Promise<{ config: MailboxConfig; errors: string[]; notes: string[] }> {
  const { config, errors, notes } = normalizeMailboxConfig(input.config);
  const stored = await storedConfig(input.mailboxId);
  return { config: mergeMailboxSecrets(stored?.config ?? {}, config, input.secrets ?? {}), errors, notes };
}

export async function testMailbox(input: MailboxTestInput, opts: { userId?: string | null } = {}): Promise<MailboxTestResponse> {
  const email = normalizeEmail(input.email);
  if (!EMAIL_RE.test(email)) return { incoming: null, smtp: null, graph: null, error: "Zadej platnou e-mailovou adresu schránky." };
  const { config, errors, notes } = await effectiveConfig(input);
  if (errors.length) return { incoming: null, smtp: null, graph: null, error: errors.join(" "), notes };
  const out: MailboxTestResponse = { incoming: null, smtp: null, graph: null, notes };

  if (input.provider === "outlook") {
    const missing = ["ms_graph_client_id", "ms_graph_tenant_id", "ms_graph_client_secret"].filter((k) => !config[k as keyof MailboxConfig]);
    if (missing.length) out.missing = missing.map((k) => ({ ms_graph_client_id: "Client ID", ms_graph_tenant_id: "Tenant ID", ms_graph_client_secret: "Client Secret" })[k]!);
    else out.graph = await diagnoseGraph(config, email);
  } else {
    const inc = resolveIncoming(config, email);
    const smtp = resolveSmtp(config, email);
    const missing: string[] = [];
    if (!config.imap_host) missing.push("příchozí server");
    if (!config.imap_password) missing.push("heslo");
    if (missing.length) out.missing = missing;
    const [a, b] = await Promise.all([inc ? diagnoseEndpoint(inc) : null, smtp ? diagnoseEndpoint(smtp) : null]);
    out.incoming = a;
    out.smtp = b;
  }

  if (input.mailboxId && (out.incoming || out.graph)) {
    const main = out.incoming ?? out.graph!;
    const errorsText = [main.ok ? null : main.error, out.smtp && !out.smtp.ok ? `SMTP: ${out.smtp.error}` : null].filter(Boolean).join(" · ");
    await updateMailboxStatus(input.mailboxId, {
      last_test_at: new Date().toISOString(),
      last_test_ok: main.ok && (!out.smtp || out.smtp.ok),
      last_test_error: errorsText || null,
      last_test: JSON.parse(JSON.stringify({ incoming: out.incoming, smtp: out.smtp, graph: out.graph })),
      last_test_by: opts.userId ?? null,
    });
  }
  return out;
}

export interface DetectRequest {
  mailboxId?: string | null;
  email: string;
  /** Nové heslo; bez něj se u existující schránky použije uložené. */
  password?: string;
  host?: string;
  port?: number;
  protocol?: "imap" | "pop3";
  smtpHost?: string;
  smtpPort?: number;
  user?: string;
  allowNameMismatch?: boolean;
  preset?: string;
}

export async function detectMailbox(req: DetectRequest): Promise<DetectResult> {
  const email = normalizeEmail(req.email);
  const empty: DetectResult = { ok: false, preset: null, evidence: [], attempts: [] };
  if (!EMAIL_RE.test(email)) return { ...empty, error: "Zadej platnou e-mailovou adresu schránky." };
  let password = typeof req.password === "string" && req.password !== "" ? req.password.replace(/[\r\n]+/g, "") : "";
  if (!password) password = (await storedConfig(req.mailboxId))?.config.imap_password ?? "";
  if (!password) return { ...empty, error: "Zadej heslo ke schránce — bez něj nejde ověřit, který server funguje." };
  const input: DetectInput = {
    email,
    password,
    host: req.host?.trim() || undefined,
    port: Number(req.port) || undefined,
    protocol: req.protocol === "pop3" ? "pop3" : req.protocol === "imap" ? "imap" : undefined,
    smtpHost: req.smtpHost?.trim() || undefined,
    smtpPort: Number(req.smtpPort) || undefined,
    user: req.user?.trim() || undefined,
    allowNameMismatch: req.allowNameMismatch === true,
    preset: isPresetId(req.preset) ? req.preset : undefined,
  };
  return detectMailSettings(input, { budgetMs: 40_000 });
}
