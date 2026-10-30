import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { userActor } from "@/lib/supabase/actor-headers";
import { logAudit } from "@/lib/audit";
import { getMailboxStatuses, isAuthBlocked, updateMailboxStatus } from "@/lib/email/mailbox-status";
import { detectMailbox, testMailbox, type MailboxTestResponse } from "@/lib/email/mailbox-diagnose";
import {
  describeConfigChanges, endpointLabel, mailboxMissing, mergeMailboxSecrets, normalizeEmail, normalizeMailboxConfig, presetOf, providerForPreset,
  resolveIncoming, resolveSmtp, validateMailboxConfig, isPresetId, EMAIL_RE, type DetectResult, type PresetId,
} from "@/lib/email/mail-config";
import { sendTestMail, type SendResult } from "@/lib/email/send";
import { sentCopyLabel } from "@/lib/email/mail-folders";
import type { MailboxConfig, MailboxProvider, MailboxStatus } from "@/lib/supabase/database.types";

/**
 * „Moje e-mailová schránka" (Můj účet): každý uživatel si schránku připojí sám — e-mail + heslo →
 * automatické zjištění IMAP/POP3 i SMTP (stejné předvolby jako admin: hosting90, Gmail, …), test
 * příjmu a odeslání, úprava, odpojení. owner_id = já; cizí schránku nevidím ani neměním. Hesla se
 * do prohlížeče nikdy nevracejí (jen příznak „heslo uloženo").
 */

export interface MyMailbox {
  id: string;
  email: string;
  displayName: string | null;
  active: boolean;
  provider: MailboxProvider;
  /** Příchozí server (popis), odchozí server (popis) — bez hesel. */
  incoming: string | null;
  smtp: string | null;
  canSend: boolean;
  passwordStored: boolean;
  /** Uložené vlastní SMTP heslo (jiné než heslo schránky) — „Upravit" ho nahradí heslem schránky. */
  smtpPasswordSeparate?: boolean;
  incomplete: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  authBlocked: boolean;
  /** Assigned by admin (vlastník nastaven adminem — schránka je moje, smím ji spravovat). */
  createdByOther: boolean;
  remaining: number | null;
  total: number | null;
  /** Servery bez hesel — předvyplní „Servery ručně" ve formuláři (Pošta → Nastavení pošty). */
  settings: MyMailboxSettings;
  /** Smím ji upravit sám (false = Microsoft 365 / Graph — nastavuje super admin). */
  editable: boolean;
  /** Proč ji upravit nejde a koho požádat (česky). */
  lockedReason: string | null;
}

/** Nastavení příjmu a odesílání bez hesel (do prohlížeče). */
export interface MyMailboxSettings {
  preset: PresetId | null;
  incomingProtocol: "imap" | "pop3";
  imapHost: string;
  imapPort: number | null;
  imapTls: "" | "tls" | "starttls";
  imapUser: string;
  smtpHost: string;
  smtpPort: number | null;
  smtpTls: "" | "tls" | "starttls" | "none";
  smtpUser: string;
  /** Uživatel dřív potvrdil šifrování bez ověření jména v certifikátu (zůstává, dokud se nezmění server). */
  imapSkipNameCheck: boolean;
  smtpSkipNameCheck: boolean;
}

type Row = { id: string; email: string; display_name: string | null; active: boolean | null; provider: MailboxProvider; config: MailboxConfig | null; owner_id: string | null; created_by?: string | null };

function db(userId?: string): SupabaseClient {
  return createAdminClient(userId ? { actor: userActor({ id: userId }) } : undefined) as unknown as SupabaseClient;
}

function settingsOf(provider: MailboxProvider, cfg: MailboxConfig): MyMailboxSettings {
  return {
    preset: presetOf(provider, cfg),
    incomingProtocol: cfg.incoming_protocol === "pop3" ? "pop3" : "imap",
    imapHost: String(cfg.imap_host ?? ""),
    imapPort: Number(cfg.imap_port) || null,
    imapTls: cfg.imap_tls === "tls" || cfg.imap_tls === "starttls" ? cfg.imap_tls : "",
    imapUser: String(cfg.imap_user ?? ""),
    smtpHost: String(cfg.smtp_host ?? ""),
    smtpPort: Number(cfg.smtp_port) || null,
    smtpTls: cfg.smtp_tls === "tls" || cfg.smtp_tls === "starttls" || cfg.smtp_tls === "none" ? cfg.smtp_tls : "",
    smtpUser: String(cfg.smtp_user ?? ""),
    imapSkipNameCheck: cfg.imap_skip_name_check === true,
    smtpSkipNameCheck: cfg.smtp_skip_name_check === true,
  };
}

/** Koho požádat o změnu, kterou uživatel sám udělat nemůže: „super admina (Jméno, Jméno)". */
export async function adminContact(): Promise<string> {
  try {
    const { data } = await db().from("profiles").select("full_name, email, active").eq("role", "super_admin").order("full_name").limit(3);
    const names = ((data ?? []) as { full_name: string | null; email: string | null; active: boolean | null }[])
      .filter((p) => p.active !== false)
      .map((p) => (p.full_name ?? "").trim() || p.email || "")
      .filter(Boolean);
    return names.length ? `super admina (${names.join(", ")})` : "super admina";
  } catch {
    return "super admina";
  }
}

function describe(row: Row, status: MailboxStatus | undefined, userId: string, admin = "super admina"): MyMailbox {
  const cfg = row.config ?? {};
  const inc = resolveIncoming(cfg, row.email);
  const smtp = resolveSmtp(cfg, row.email);
  const st = status as (MailboxStatus & { last_sync_total?: number | null }) | undefined;
  const graph = row.provider === "outlook";
  return {
    settings: settingsOf(row.provider, cfg),
    editable: !graph,
    lockedReason: graph
      ? `Schránka Microsoft 365 se připojuje přes aplikaci v Microsoftu (Client ID a tajný klíč) — tu nastavuje ${admin} v Nastavení → E-mailové schránky. Požádej ho o změnu; poštu z ní tady normálně čteš i odesíláš.`
      : null,
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    active: row.active !== false,
    provider: row.provider,
    incoming: inc ? endpointLabel(inc) : null,
    smtp: smtp ? endpointLabel(smtp) : row.provider === "outlook" ? "Microsoft 365 (Graph)" : null,
    canSend: Boolean(smtp) || (row.provider === "outlook" && Boolean(cfg.ms_graph_client_secret)),
    passwordStored: Boolean(cfg.imap_password),
    smtpPasswordSeparate: Boolean(cfg.smtp_password),
    incomplete: mailboxMissing(row.provider, cfg).length > 0,
    lastSyncAt: st?.last_sync_ok_at ?? null,
    lastSyncError: st?.last_sync_error ?? null,
    authBlocked: isAuthBlocked(st, { provider: row.provider, email: row.email, config: cfg }),
    createdByOther: Boolean(row.created_by && row.created_by !== userId),
    remaining: st?.last_sync_remaining ?? null,
    total: typeof st?.last_sync_total === "number" ? st.last_sync_total : null,
  };
}

export async function listMyMailboxes(userId: string): Promise<MyMailbox[]> {
  const { data } = await db().from("mailboxes").select("id, email, display_name, active, provider, config, owner_id, created_by").eq("owner_id", userId).order("created_at");
  const rows = (data ?? []) as Row[];
  const [statuses, admin] = await Promise.all([
    getMailboxStatuses(rows.map((r) => r.id)),
    rows.some((r) => r.provider === "outlook") ? adminContact() : Promise.resolve("super admina"),
  ]);
  return rows.map((r) => describe(r, statuses.get(r.id), userId, admin));
}

async function ownRow(userId: string, mailboxId: string | null | undefined): Promise<Row | null> {
  if (!mailboxId) return null;
  const { data } = await db().from("mailboxes").select("id, email, display_name, active, provider, config, owner_id, created_by").eq("id", mailboxId).maybeSingle();
  const row = data as Row | null;
  return row && row.owner_id === userId ? row : null;
}

const NOT_MINE = "Schránka nenalezena (spravuješ jen svou vlastní).";

/** Najít nastavení automaticky (IMAP/POP3 + SMTP) pro mou schránku. */
export async function detectMine(userId: string, input: {
  mailboxId?: string | null; email: string; password?: string; preset?: string; host?: string; port?: number; protocol?: string;
  smtpHost?: string; smtpPort?: number; smtpTls?: string; user?: string; allowNameMismatch?: boolean;
}): Promise<DetectResult> {
  const row = input.mailboxId ? await ownRow(userId, input.mailboxId) : null;
  if (input.mailboxId && !row) return { ok: false, preset: null, evidence: [], attempts: [], error: NOT_MINE };
  if (row?.provider === "outlook") return { ok: false, preset: null, evidence: [], attempts: [], error: OUTLOOK_LOCKED };
  return detectMailbox({ ...input, protocol: input.protocol === "pop3" ? "pop3" : input.protocol === "imap" ? "imap" : undefined, mailboxId: input.mailboxId ?? null });
}

const OUTLOOK_LOCKED = "Schránku Microsoft 365 nastavuje super admin (Nastavení → E-mailové schránky).";

export interface TestDraftInput {
  mailboxId?: string | null;
  email: string;
  password?: string;
  /** Zaškrtnuté „SMTP má jiné heslo" + nové SMTP heslo (prázdné = ponechat uložené). */
  separateSmtp?: boolean;
  smtpPassword?: string;
  /** Servery z formuláře (bez hesel). */
  config: MailboxConfig;
}

/**
 * „Otestovat připojení" ve formuláři (před uložením): příjem (IMAP/POP3 přihlášení + INBOX) i odesílání
 * (SMTP přihlášení) přesně s tím, co je vyplněné; chybějící hesla doplní uložená (jen u mé schránky).
 */
export async function testDraftMine(userId: string, input: TestDraftInput): Promise<MailboxTestResponse> {
  const row = input.mailboxId ? await ownRow(userId, input.mailboxId) : null;
  if (input.mailboxId && !row) return { incoming: null, smtp: null, graph: null, error: NOT_MINE };
  if (row?.provider === "outlook") return { incoming: null, smtp: null, graph: null, error: OUTLOOK_LOCKED };
  const preset = isPresetId(input.config?.preset) && input.config.preset !== "m365" ? input.config.preset : "other";
  return testMailbox({
    mailboxId: row?.id ?? null,
    provider: providerForPreset(preset),
    email: input.email,
    config: { ...(input.config ?? {}), preset },
    secrets: {
      imap_password: input.password || undefined,
      smtp_password: input.separateSmtp && input.smtpPassword ? input.smtpPassword : undefined,
      ...(input.separateSmtp ? { keep_smtp_password: true } : { clear_smtp_password: true }),
    },
  }, { userId });
}

export interface SaveMineInput {
  mailboxId?: string | null;
  email: string;
  displayName?: string;
  password?: string;
  /** SMTP heslo, je-li jiné (výjimečně). */
  smtpPassword?: string;
  /** Zaškrtnuté „SMTP má jiné heslo" bez nového zadání → uložené SMTP heslo ponechat. */
  keepSmtpPassword?: boolean;
  /** Konfigurace z automatického zjištění / ručně (bez hesel). */
  config: MailboxConfig;
}

export async function saveMine(userId: string, input: SaveMineInput): Promise<{ ok: boolean; error?: string; id?: string; warning?: string; notes?: string[] }> {
  const email = normalizeEmail(input.email);
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Zadej platnou e-mailovou adresu." };
  const prevRow = input.mailboxId ? await ownRow(userId, input.mailboxId) : null;
  if (input.mailboxId && !prevRow) return { ok: false, error: NOT_MINE };
  if (prevRow?.provider === "outlook") return { ok: false, error: OUTLOOK_LOCKED };
  const { config, errors, notes } = normalizeMailboxConfig(input.config ?? {});
  if (errors.length) return { ok: false, error: errors.join(" ") };
  // Bez zaškrtnutého „SMTP má jiné heslo": odesílání ověřilo „Najít nastavení" heslem schránky → staré vlastní
  // SMTP heslo (zbytek staršího formuláře, server ho odmítal — 535) se smaže, pokud nové nepřišlo výslovně
  const keep = input.keepSmtpPassword === true && !input.smtpPassword;
  const next = mergeMailboxSecrets(prevRow?.config ?? {}, config, {
    imap_password: input.password, smtp_password: input.smtpPassword,
    ...(keep ? { keep_smtp_password: true } : { clear_smtp_password: !input.smtpPassword }),
  });
  const preset = isPresetId(next.preset) ? next.preset : "other";
  const provider: MailboxProvider = preset === "m365" ? "outlook" : providerForPreset(preset);
  const invalid = validateMailboxConfig({ provider, email, config: next });
  if (invalid) return { ok: false, error: invalid };
  const c = db(userId);
  // stejná adresa už připojená někým jiným (firemní / kolegy) → nepřebírat potichu
  const { data: dup } = await c.from("mailboxes").select("id, owner_id").ilike("email", email);
  const other = ((dup ?? []) as { id: string; owner_id: string | null }[]).find((d) => d.id !== prevRow?.id);
  if (other) {
    if (other.owner_id === userId) return { ok: false, error: `Schránku ${email} už máš připojenou.` };
    const admin = await adminContact();
    return {
      ok: false,
      error: `Schránka ${email} je už v aplikaci připojená (${other.owner_id ? "má ji kolega" : "jako firemní schránka"}), takže ji tady připojit nejde. Požádej ${admin}, ať ti ji v Nastavení → E-mailové schránky přiřadí (Čí je schránka → ty) — pak ji uvidíš tady a heslo i servery si upravíš sám.`,
    };
  }
  let id = prevRow?.id;
  if (prevRow) {
    const { error } = await c.from("mailboxes").update({ email, provider, display_name: input.displayName?.trim() || null, config: next }).eq("id", prevRow.id).eq("owner_id", userId);
    if (error) return { ok: false, error: error.message };
    const p = prevRow.config ?? {};
    if (p.imap_host !== next.imap_host || (p.incoming_protocol ?? "imap") !== (next.incoming_protocol ?? "imap") || p.imap_user !== next.imap_user || prevRow.email !== email) {
      await updateMailboxStatus(prevRow.id, { sync_state: {}, last_sync_error: null });
      // jiný účet / server: UID dřív stažených zpráv už neplatí (příloha se dohledá podle Message-ID)
      await c.from("emails").update({ imap_uid: null, imap_uidvalidity: null }).eq("mailbox_id", prevRow.id).not("imap_uid", "is", null);
    }
  } else {
    const { data, error } = await c.from("mailboxes").insert({ email, provider, display_name: input.displayName?.trim() || null, config: next, owner_id: userId }).select("id").single();
    if (error) return { ok: false, error: error.message };
    id = (data as { id: string }).id;
  }
  await logAudit({
    action: prevRow ? "mailbox_updated" : "mailbox_added", entity: "mailboxes", entityId: id,
    diff: { email, provider, owner_id: userId, self_service: true, changes: describeConfigChanges(prevRow?.config ?? {}, next) },
    actor: userActor({ id: userId }),
  });
  const warning = !resolveSmtp(next, email) && provider !== "outlook"
    ? "Odchozí server (SMTP) se nepodařilo najít — stahování pošty funguje, odesílání z aplikace ne. Doplň SMTP v Upravit → Servery ručně a klikni na Vyzkoušet odeslání."
    : undefined;
  return { ok: true, id, warning, notes };
}

export async function testMine(userId: string, mailboxId: string): Promise<MailboxTestResponse> {
  const row = await ownRow(userId, mailboxId);
  if (!row) return { incoming: null, smtp: null, graph: null, error: NOT_MINE };
  return testMailbox({ mailboxId, provider: row.provider, email: row.email, config: row.config ?? {} }, { userId });
}

export async function testSendMine(userId: string, mailboxId: string, who?: string): Promise<SendResult & { to?: string; text: string }> {
  const row = await ownRow(userId, mailboxId);
  if (!row) return { sent: false, reason: NOT_MINE, text: NOT_MINE };
  const res = await sendTestMail(mailboxId, who);
  await logAudit({ action: "mailbox_test_send", entity: "mailboxes", entityId: mailboxId, diff: { ok: res.sent, sentCopy: res.sentCopy }, actor: userActor({ id: userId }) });
  return { ...res, text: testSendText(res) };
}

export function testSendText(res: SendResult & { to?: string }): string {
  if (!res.sent) return res.reason ?? "Odeslání selhalo.";
  return `Odesláno z ${res.fromAddress} na ${res.to}. ${sentCopyLabel(res.sentCopy, res.sentCopyError)}`.trim();
}

export async function removeMine(userId: string, mailboxId: string): Promise<{ ok: boolean; error?: string }> {
  const row = await ownRow(userId, mailboxId);
  if (!row) return { ok: false, error: NOT_MINE };
  const c = db(userId);
  // stažená pošta zůstane uživateli (owner_id), jen bez schránky
  const { error } = await c.from("mailboxes").delete().eq("id", mailboxId).eq("owner_id", userId);
  if (error) return { ok: false, error: error.message };
  await logAudit({ action: "mailbox_deleted", entity: "mailboxes", entityId: mailboxId, diff: { email: row.email, self_service: true }, actor: userActor({ id: userId }) });
  return { ok: true };
}

export async function setMineActive(userId: string, mailboxId: string, active: boolean): Promise<{ ok: boolean; error?: string }> {
  const row = await ownRow(userId, mailboxId);
  if (!row) return { ok: false, error: NOT_MINE };
  const { error } = await db(userId).from("mailboxes").update({ active: active === true }).eq("id", mailboxId).eq("owner_id", userId);
  if (error) return { ok: false, error: error.message };
  await logAudit({ action: "mailbox_updated", entity: "mailboxes", entityId: mailboxId, diff: { active: active === true, self_service: true }, actor: userActor({ id: userId }) });
  return { ok: true };
}
