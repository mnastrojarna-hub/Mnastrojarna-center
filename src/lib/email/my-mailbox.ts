import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { userActor } from "@/lib/supabase/actor-headers";
import { logAudit } from "@/lib/audit";
import { getMailboxStatuses, isAuthBlocked, updateMailboxStatus } from "@/lib/email/mailbox-status";
import { detectMailbox, testMailbox, type MailboxTestResponse } from "@/lib/email/mailbox-diagnose";
import {
  describeConfigChanges, endpointLabel, mailboxMissing, mergeMailboxSecrets, normalizeEmail, normalizeMailboxConfig, providerForPreset,
  resolveIncoming, resolveSmtp, validateMailboxConfig, isPresetId, EMAIL_RE, type DetectResult,
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
  incomplete: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  authBlocked: boolean;
  /** Assigned by admin (vlastník nastaven adminem — schránka je moje, smím ji spravovat). */
  createdByOther: boolean;
  remaining: number | null;
  total: number | null;
}

type Row = { id: string; email: string; display_name: string | null; active: boolean | null; provider: MailboxProvider; config: MailboxConfig | null; owner_id: string | null; created_by?: string | null };

function db(userId?: string): SupabaseClient {
  return createAdminClient(userId ? { actor: userActor({ id: userId }) } : undefined) as unknown as SupabaseClient;
}

function describe(row: Row, status: MailboxStatus | undefined, userId: string): MyMailbox {
  const cfg = row.config ?? {};
  const inc = resolveIncoming(cfg, row.email);
  const smtp = resolveSmtp(cfg, row.email);
  const st = status as (MailboxStatus & { last_sync_total?: number | null }) | undefined;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    active: row.active !== false,
    provider: row.provider,
    incoming: inc ? endpointLabel(inc) : null,
    smtp: smtp ? endpointLabel(smtp) : row.provider === "outlook" ? "Microsoft 365 (Graph)" : null,
    canSend: Boolean(smtp) || (row.provider === "outlook" && Boolean(cfg.ms_graph_client_secret)),
    passwordStored: Boolean(cfg.imap_password),
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
  const statuses = await getMailboxStatuses(rows.map((r) => r.id));
  return rows.map((r) => describe(r, statuses.get(r.id), userId));
}

async function ownRow(userId: string, mailboxId: string | null | undefined): Promise<Row | null> {
  if (!mailboxId) return null;
  const { data } = await db().from("mailboxes").select("id, email, display_name, active, provider, config, owner_id, created_by").eq("id", mailboxId).maybeSingle();
  const row = data as Row | null;
  return row && row.owner_id === userId ? row : null;
}

const NOT_MINE = "Schránka nenalezena (spravuješ jen svou vlastní).";

/** Najít nastavení automaticky (IMAP/POP3 + SMTP) pro mou schránku. */
export async function detectMine(userId: string, input: { mailboxId?: string | null; email: string; password?: string; preset?: string; host?: string; smtpHost?: string; user?: string; allowNameMismatch?: boolean }): Promise<DetectResult> {
  if (input.mailboxId && !(await ownRow(userId, input.mailboxId))) return { ok: false, preset: null, evidence: [], attempts: [], error: NOT_MINE };
  return detectMailbox({ ...input, mailboxId: input.mailboxId ?? null });
}

export interface SaveMineInput {
  mailboxId?: string | null;
  email: string;
  displayName?: string;
  password?: string;
  /** SMTP heslo, je-li jiné (výjimečně). */
  smtpPassword?: string;
  /** Konfigurace z automatického zjištění / ručně (bez hesel). */
  config: MailboxConfig;
}

export async function saveMine(userId: string, input: SaveMineInput): Promise<{ ok: boolean; error?: string; id?: string; warning?: string; notes?: string[] }> {
  const email = normalizeEmail(input.email);
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Zadej platnou e-mailovou adresu." };
  const prevRow = input.mailboxId ? await ownRow(userId, input.mailboxId) : null;
  if (input.mailboxId && !prevRow) return { ok: false, error: NOT_MINE };
  const { config, errors, notes } = normalizeMailboxConfig(input.config ?? {});
  if (errors.length) return { ok: false, error: errors.join(" ") };
  const next = mergeMailboxSecrets(prevRow?.config ?? {}, config, { imap_password: input.password, smtp_password: input.smtpPassword });
  const preset = isPresetId(next.preset) ? next.preset : "other";
  const provider: MailboxProvider = preset === "m365" ? "outlook" : providerForPreset(preset);
  const invalid = validateMailboxConfig({ provider, email, config: next });
  if (invalid) return { ok: false, error: invalid };
  const c = db(userId);
  // stejná adresa už připojená někým jiným (firemní / kolegy) → nepřebírat potichu
  const { data: dup } = await c.from("mailboxes").select("id, owner_id").ilike("email", email);
  const other = ((dup ?? []) as { id: string; owner_id: string | null }[]).find((d) => d.id !== prevRow?.id);
  if (other) {
    return { ok: false, error: other.owner_id === userId ? `Schránku ${email} už máš připojenou.` : `Schránka ${email} je už v aplikaci připojená (firemní nebo kolegy) — požádej admina, aby ti ji přiřadil.` };
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
    ? "Odchozí server (SMTP) se nepodařilo najít — stahování pošty funguje, odesílání z aplikace ne. Doplň SMTP v Upřesnit a klikni na Vyzkoušet odeslání."
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
