import "server-only";
import { createAdminClient, hasServiceKey, isSupabaseConfigured } from "@/lib/supabase/server";
import { SYSTEM_ACTOR } from "@/lib/supabase/actor-headers";
import { diagnoseEndpoint, diagnoseGraph, detectMailSettings, type DetectInput } from "@/lib/email/mail-connect";
import { updateMailboxStatus } from "@/lib/email/mailbox-status";
import {
  alternateAuthMethod, isPresetId, mergeMailboxSecrets, normalizeMailboxConfig, resolveIncoming, resolveSmtp, normalizeEmail, EMAIL_RE,
  SMTP_PASSWORD_SOURCE_LABEL, type DetectResult, type DiagResult, type ResolvedSmtp, type SecretChanges,
} from "@/lib/email/mail-config";
import { healSmtpPassword } from "@/lib/email/smtp-heal";
import { userActor } from "@/lib/supabase/actor-headers";
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
    out.smtp = b && smtp ? await recoverSmtpDiag(b, smtp, { mailboxId: input.mailboxId, stored: await storedConfig(input.mailboxId), userId: opts.userId }) : b;
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

/**
 * Test SMTP s odmítnutým heslem: stejná oprava jako při odeslání (smtp-recovery.ts) — vlastní SMTP heslo
 * → heslo příchozí pošty (projde-li a je to uložené heslo schránky, zastaralé SMTP heslo se smaže),
 * pak jednou druhý mechanismus AUTH. Výsledek říká, s jakým heslem a AUTH se zkoušelo.
 */
async function recoverSmtpDiag(
  first: DiagResult,
  smtp: ResolvedSmtp,
  ctx: { mailboxId?: string | null; stored: { config: MailboxConfig } | null; userId?: string | null },
): Promise<DiagResult> {
  if (first.ok || first.kind !== "auth") return first;
  const tried = [`${SMTP_PASSWORD_SOURCE_LABEL[smtp.passwordSource]} (AUTH ${first.authMethod ?? "dle serveru"}) → odmítnuto`];
  let cur: ResolvedSmtp = smtp;
  let last = first;
  if (smtp.passwordSource === "smtp" && smtp.incomingPassword) {
    cur = { ...smtp, password: smtp.incomingPassword, passwordSource: "incoming", incomingPassword: undefined };
    const r = await diagnoseEndpoint(cur);
    if (r.ok) {
      const storedStale = Boolean(ctx.mailboxId && ctx.stored?.config.smtp_password && ctx.stored.config.smtp_password === smtp.password);
      const healed = storedStale ? await healSmtpPassword(ctx.mailboxId!, smtp.password, { reason: "test", actor: ctx.userId ? userActor({ id: ctx.userId }) : undefined }) : false;
      return {
        ...r,
        note: healed
          ? "Uložené vlastní SMTP heslo server odmítl, heslo příchozí pošty přijal — zastaralé SMTP heslo jsem smazal, odesílání teď používá heslo schránky."
          : "Vlastní SMTP heslo server odmítl, heslo příchozí pošty přijal — odškrtni „SMTP má jiné heslo než schránka“ a ulož.",
      };
    }
    if (r.kind !== "auth") return { ...r, note: `Zkoušeno: ${tried.join("; ")}.` };
    tried.push(`${SMTP_PASSWORD_SOURCE_LABEL.incoming} (AUTH ${r.authMethod ?? "dle serveru"}) → odmítnuto`);
    last = r;
  }
  const alt = alternateAuthMethod(last.authMethod);
  const r2 = await diagnoseEndpoint({ ...cur, authMethod: alt });
  if (r2.ok) return { ...r2, note: `Přihlášení prošlo až mechanismem AUTH ${alt}.` };
  tried.push(`${SMTP_PASSWORD_SOURCE_LABEL[cur.passwordSource]} (AUTH ${alt}) → ${r2.kind === "auth" ? "odmítnuto" : "chyba"}`);
  return {
    ...last,
    error: `${last.error} Zkoušeno: ${tried.join("; ")}. Co dál: zadej heslo ke schránce znovu (Upravit → nové heslo) a zkus to znovu.`,
  };
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
  /** Šifrování zadaného SMTP (ručně, `none` = Outlook „Žádné"). */
  smtpTls?: string;
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
    smtpTls: req.smtpTls === "tls" || req.smtpTls === "starttls" || req.smtpTls === "none" ? req.smtpTls : undefined,
    user: req.user?.trim() || undefined,
    allowNameMismatch: req.allowNameMismatch === true,
    preset: isPresetId(req.preset) ? req.preset : undefined,
  };
  return detectMailSettings(input, { budgetMs: 40_000 });
}
