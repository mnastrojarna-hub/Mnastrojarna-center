import "server-only";
import { randomUUID } from "node:crypto";
import { categorizeEmail, draftReply, type EmailAnalysis } from "@/lib/ai/claude";
import { getAgentInstructions } from "@/lib/ai/corrections";
import { getImapConfig, getGraphConfig, getSetting, getAiConfig } from "@/lib/settings";
import { getModuleMode } from "@/lib/automation";
import { sendMail, isSmtpConfigured } from "@/lib/email/send";
import { matchPartyByEmail, type PartyRef } from "@/lib/email/match";
import { fetchIncoming, syncIncoming, type MailSyncState } from "@/lib/email/mail-fetch";
import { graphError } from "@/lib/email/mail-connect";
import {
  acquireSyncLock, authBlockedMessage, credentialFingerprint, getMailboxStatuses, isAuthBlocked, releaseSyncLock, saveSyncProgress,
} from "@/lib/email/mailbox-status";
import {
  classifyMailError, defaultTlsForPort, describeMailError, mailboxMissing, normalizeHost, rawErrorText, resolveIncoming,
} from "@/lib/email/mail-config";
import {
  isAiSwitchOn, filterMailboxesForSync, allowGlobalFallback, isDbEmailCategory, isPriorityLevel,
} from "@/lib/email/visibility";
import { ruleCategorize } from "@/lib/email/mail-rules";
import { decodePart, mimeLeaves, isAttachmentLeaf, type AttachmentMeta } from "@/lib/email/mime-parts";
import { replyHeaders, replySubject } from "@/lib/email/threading";
import { createAdminClient, hasServiceKey, isSupabaseConfigured } from "@/lib/supabase/server";
import { aiActor, cronActor, type ActorContext } from "@/lib/supabase/actor-headers";
import { logAudit } from "@/lib/audit";
import type { MailboxConfig, MailboxStatus } from "@/lib/supabase/database.types";

/**
 * Stahování a (volitelně) AI-analýza pošty.
 * Zdroje: IMAP / POP3 (hosting90 …) a Microsoft Graph (Outlook / M365) — CELÁ schránka po dávkách
 * (INBOX i Odeslané), kurzor v mailbox_status.sync_state (viz mail-fetch.ts).
 * Pošta patří vlastníkovi schránky (emails.owner_id = mailboxes.owner_id).
 *
 * Náklady AI (rozhodnutí „Pošta A"): AI třídí jen příchozí poštu mladší než `mail_ai_recent_days`
 * (výchozí 30 dní) a nejvýš `mail_ai_max_per_run` (výchozí 25) e-mailů za jedno stažení; ostatní
 * dostanou kategorii / spam / prioritu z pravidel (mail-rules.ts) a příznak `ai_pending` — AI je
 * dotřídí v dalších stažení (jen ty mladší) nebo na požádání tlačítkem u e-mailu. Návrh odpovědi
 * (modul 7) jen u e-mailů z posledních 72 hodin (stará pošta z prvního stažení se neodpovídá).
 * Už uložené zprávy se znovu nezpracovávají (duplicity podle Message-ID ve schránce).
 */

export interface RawEmail {
  messageId: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  body: string;
  receivedAt: string;
  /** Adresát(i) (volitelné — IMAP/Graph je znají). */
  toEmail?: string;
  ccEmail?: string;
  /** Vlákno: Message-ID, na který zpráva odpovídá, a References. */
  inReplyTo?: string;
  references?: string[];
  /** Hlavičky pro pravidla třídění (list-unsubscribe, precedence, x-spam-flag …). */
  headers?: Record<string, string | undefined>;
  /** Kde zpráva leží na serveru (stažení příloh později). */
  imapFolder?: string;
  imapUid?: number;
  /** UIDVALIDITY složky (UID platí jen s ní — příloha ze serveru se ověří). */
  imapUidValidity?: string;
  attachments?: AttachmentMeta[];
  /** Celý zdroj (POP3 — přílohy se uloží hned, později už stáhnout nejdou). */
  source?: Buffer;
  /** Příchozí (INBOX) nebo odchozí (složka Odeslané na serveru). */
  direction?: "in" | "out";
}

export interface SyncResult {
  source: "imap" | "graph" | "none";
  configured: boolean;
  fetched: number;
  ingested: number;
  /** Kolik schránek se stáhlo. */
  mailboxes?: number;
  /** Proběhla AI analýza (hlavní vypínač + klíč). */
  ai?: boolean;
  message?: string;
  /** Výsledek po schránkách (počty, chyba, co zbývá). */
  boxes?: MailboxSyncReport[];
  /** Zpráv na serveru celkem (všechny schránky, INBOX + Odeslané). */
  total?: number;
  /** Kolik zpráv ještě čeká — klient volá znovu, dokud není 0. */
  remaining?: number;
  /** Vše stažené (nic nečeká, žádná schránka nepřerušená časovým limitem). */
  done?: boolean;
}

export interface SyncOptions {
  /** Jen tyto schránky (bez filtru = všechny aktivní + globální přístupové údaje). */
  mailboxIds?: string[];
  /** Velikost dávky stahování (zpráv, 1–200, výchozí 50). Stahuje se dávka za dávkou do časového limitu. */
  limit?: number;
  /** Max. zpráv na schránku za jedno volání (živé stahování). Bez = do časového limitu. */
  maxMessages?: number;
  /**
   * Nejzazší konec (epoch ms) — pod maxDuration route. Nová schránka / další e-mail se začne jen
   * do `deadline − 60 s` (rezerva na rozběhnutou práci); zbytek se stáhne příště.
   */
  deadline?: number;
  /** Automatické stažení (otevření pošty, živé stahování): přeskočí schránky stažené před chvílí. */
  auto?: boolean;
  /** Minimální odstup automatického stažení jedné schránky (výchozí 2 min; živé stahování 45 s). */
  minIntervalMs?: number;
  /**
   * Ruční stažení (tlačítko „Stáhnout poštu", uložení schránky). Jen ručně se schránka přihlásí
   * i se známým odmítnutým heslem — automatika (otevření pošty, plánovač) ne (blokace IP).
   */
  manual?: boolean;
  /** Kdo synchronizaci spustil (uživatel / plánovač) — autor zápisů mimo AI. Výchozí = plánovač. */
  actor?: ActorContext;
}

/** Zásady AI pro jedno stažení (sdílený rozpočet napříč dávkami a schránkami). */
export interface AiPolicy {
  budget: { left: number };
  recentDays: number;
  /** Návrh odpovědi jen u e-mailů mladších než (hodiny). */
  replyWindowHours: number;
}

export interface IngestOptions {
  /** Vlastník e-mailů (vlastník schránky / kdo importoval). */
  ownerId?: string | null;
  /** Kdo stahování / import spustil; zápisy AI jdou jako ✨ AI (e-mail) za vlastníka schránky. */
  actor?: ActorContext;
  /** Epoch ms: po tomto okamžiku už další e-mail nezačínat (zbytek se zpracuje příště). */
  stopAt?: number;
  /** Zásady AI (bez = načtou se z nastavení pro toto volání). */
  ai?: AiPolicy;
}

export interface IngestProgress {
  /** Kolik e-mailů ze vstupu (od začátku, souvisle) je vyřízeno — uložených i duplicit. */
  processed: number;
  /** Kolik nových e-mailů se uložilo. */
  ingested: number;
}

/** Časový limit jednoho AI volání (kategorizace, návrh odpovědi) — jeden e-mail se vejde do rezervy synchronizace. */
export const AI_CALL_TIMEOUT_MS = 20_000;
export const DEFAULT_AI_RECENT_DAYS = 30;
export const DEFAULT_AI_MAX_PER_RUN = 25;
export const REPLY_WINDOW_HOURS = 72;

/** Autor zápisů ingestu: s AI = ✨ AI (e-mail) za vlastníka schránky, bez AI = kdo spustil (výchozí plánovač). */
export function ingestActor(useAi: boolean, opts: IngestOptions): ActorContext {
  return useAi ? aiActor(opts.ownerId ?? null, "email-ingest", "email") : opts.actor ?? cronActor("cron-mail");
}

/** Zásady AI z nastavení (integration_settings mail_ai_recent_days / mail_ai_max_per_run). */
export async function loadAiPolicy(): Promise<AiPolicy> {
  const num = (v: string | undefined, d: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) && v !== undefined && v !== "" ? Math.min(max, Math.max(min, Math.round(n))) : d;
  };
  const [days, max] = await Promise.all([getSetting("mail_ai_recent_days").catch(() => undefined), getSetting("mail_ai_max_per_run").catch(() => undefined)]);
  return {
    budget: { left: num(max, DEFAULT_AI_MAX_PER_RUN, 0, 500) },
    recentDays: num(days, DEFAULT_AI_RECENT_DAYS, 0, 3650),
    replyWindowHours: REPLY_WINDOW_HOURS,
  };
}

/** Je e-mail mladší než `days` dní? */
export function isRecent(receivedAt: string, days: number, now = Date.now()): boolean {
  const t = Date.parse(receivedAt);
  return Number.isFinite(t) && now - t <= days * 86_400_000;
}

type ImapCfg = { host?: string; port: number; user?: string; password?: string };
type GraphCfg = { clientId?: string; clientSecret?: string; tenantId?: string; user?: string };

const MAX_BODY = 12000;

// ── IMAP (globální přístupové údaje) ────────────────────────
/** Jedna dávka přes IMAP z globálních přístupových údajů (bez stavu — duplicity hlídá Message-ID). */
export async function fetchImapEmails(cfg: ImapCfg, limit = 20): Promise<RawEmail[]> {
  const port = Number(cfg.port) || 993;
  const res = await fetchIncoming(
    { protocol: "imap", host: normalizeHost(cfg.host).host, port, tls: defaultTlsForPort(port), user: cfg.user!, password: cfg.password! },
    cfg.user ?? "",
    {},
    limit,
  );
  return res.emails;
}

// ── Microsoft Graph (Outlook / M365) ────────────────────────
async function graphToken(cfg: GraphCfg): Promise<string> {
  const params = new URLSearchParams({
    client_id: cfg.clientId!,
    client_secret: cfg.clientSecret!,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId ?? "")}/oauth2/v2.0/token`,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params, signal: AbortSignal.timeout(10_000) },
  );
  if (!res.ok) throw await graphError(res, "Microsoft odmítl přihlášení aplikace");
  const data = await res.json();
  return data.access_token as string;
}

const GRAPH_SELECT = "$select=id,subject,from,toRecipients,ccRecipients,body,bodyPreview,receivedDateTime,hasAttachments";

function graphToRaw(m: Record<string, unknown>): RawEmail {
  const from = (m.from as { emailAddress?: { name?: string; address?: string } })?.emailAddress;
  const list = (k: string) => ((m[k] as { emailAddress?: { address?: string } }[] | undefined) ?? []).map((r) => r.emailAddress?.address).filter(Boolean).join(", ");
  const body = (m.body as { content?: string } | undefined)?.content || (m.bodyPreview as string) || "";
  return {
    messageId: String(m.id),
    fromName: from?.name || "",
    fromEmail: from?.address || "",
    subject: (m.subject as string) || "",
    body: body.slice(0, MAX_BODY),
    receivedAt: (m.receivedDateTime as string) || new Date().toISOString(),
    toEmail: list("toRecipients") || undefined,
    ccEmail: list("ccRecipients") || undefined,
    direction: "in",
  };
}

async function graphPage(token: string, url: string): Promise<{ emails: RawEmail[]; next: string | null }> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.body-content-type="text"' }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw await graphError(res, "Doručenou poštu z Microsoft 365 nelze stáhnout");
  const data = (await res.json()) as { value?: Record<string, unknown>[]; "@odata.nextLink"?: string };
  return { emails: (data.value ?? []).map(graphToRaw), next: data["@odata.nextLink"] ?? null };
}

export async function fetchGraphEmails(cfg: GraphCfg, userPrincipal: string, limit = 20): Promise<RawEmail[]> {
  const token = await graphToken(cfg);
  const base = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userPrincipal)}/mailFolders/inbox/messages`;
  return (await graphPage(token, `${base}?$top=${limit}&$orderby=receivedDateTime desc&${GRAPH_SELECT}`)).emails;
}

// ── Schránky s vlastní konfigurací ──────────────────────────
interface MailboxRow {
  id: string;
  provider: "imap" | "outlook" | "gmail";
  email: string;
  owner_id: string | null;
  config: MailboxConfig;
}

async function getActiveMailboxes(): Promise<MailboxRow[]> {
  if (!isSupabaseConfigured() || !hasServiceKey()) return [];
  try {
    const db = createAdminClient();
    const { data, error } = await db
      .from("mailboxes")
      .select("id, provider, email, owner_id, config")
      .eq("active", true);
    if (error || !data) return [];
    return data as MailboxRow[];
  } catch {
    return [];
  }
}

/** Hlavní vypínač AI + klíč. Bez nich žádné AI volání. */
export async function isMailAiEnabled(): Promise<boolean> {
  try {
    const [enabled, ai] = await Promise.all([getSetting("ai_enabled"), getAiConfig()]);
    return isAiSwitchOn(enabled) && Boolean(ai.apiKey);
  } catch {
    return false;
  }
}

type AdminDb = ReturnType<typeof createAdminClient>;

/** message_id zpráv, které už v DB jsou (stejná schránka / bez schránky). */
async function existingMessageIds(db: AdminDb, mailboxId: string | null, ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const unique = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    let q = db.from("emails").select("message_id").in("message_id", chunk);
    q = mailboxId ? q.eq("mailbox_id", mailboxId) : q.is("mailbox_id", null);
    const { data, error } = await q;
    if (error) {
      console.error(`[mail:ingest] Kontrola duplicit selhala: ${error.message}`);
      continue;
    }
    for (const r of (data ?? []) as { message_id: string | null }[]) if (r.message_id) out.add(r.message_id);
  }
  return out;
}

function clamp(n: unknown, min: number, max: number, fallback: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

const ATTACHMENT_BUCKET = "documents";
const MAX_STORED_ATTACHMENT = 10 * 1024 * 1024;

/** Přílohy uloženého e-mailu: metadata (IMAP — obsah se stáhne ze serveru až na požádání), u POP3 i obsah. */
async function saveAttachments(db: AdminDb, emailId: string, e: RawEmail): Promise<void> {
  const list = e.attachments ?? [];
  if (!list.length) return;
  const leaves = e.source ? mimeLeaves(e.source).filter(isAttachmentLeaf) : [];
  const rows: Record<string, unknown>[] = [];
  for (const a of list.slice(0, 50)) {
    let storagePath: string | null = null;
    const leaf = leaves.find((l) => l.partId === a.partId);
    if (leaf) {
      try {
        const content = decodePart(leaf);
        if (content.length <= MAX_STORED_ATTACHMENT) {
          const path = `mail/in/${emailId}/${randomUUID()}-${a.filename.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").slice(0, 150)}`;
          const { error } = await db.storage.from(ATTACHMENT_BUCKET).upload(path, content, { contentType: a.contentType || "application/octet-stream", upsert: false });
          if (!error) storagePath = path;
        }
      } catch {
        // obsah je best-effort
      }
    }
    rows.push({
      email_id: emailId, filename: a.filename, mime_type: a.contentType || null, size_bytes: a.size ?? null,
      storage_path: storagePath, imap_part: e.imapUid ? a.partId : null,
    });
  }
  const { error } = await db.from("email_attachments").insert(rows as never);
  if (error) console.error(`[mail:ingest] Uložení příloh selhalo: ${error.message}`);
}

// ── Uložení (s AI analýzou, pokud je zapnutá a e-mail je čerstvý) ──
export async function ingestEmails(
  emails: RawEmail[],
  mailboxId?: string | null,
  opts: IngestOptions = {},
): Promise<number> {
  return (await ingestEmailsProgress(emails, mailboxId, opts)).ingested;
}

/**
 * Jako ingestEmails, navíc vrací, kolik e-mailů ze vstupu je vyřízeno: s `stopAt` se po jeho
 * uplynutí další e-mail nezačne (stav stahování se posune jen o vyřízené).
 */
export async function ingestEmailsProgress(
  emails: RawEmail[],
  mailboxId?: string | null,
  opts: IngestOptions = {},
): Promise<IngestProgress> {
  const timeUp = () => opts.stopAt !== undefined && Date.now() > opts.stopAt;
  if (emails.length && timeUp()) return { processed: 0, ingested: 0 };
  if (!isSupabaseConfigured() || !hasServiceKey() || emails.length === 0) return { processed: emails.length, ingested: 0 };
  const useAi = await isMailAiEnabled();
  const policy = opts.ai ?? (await loadAiPolicy());
  const db = createAdminClient({ actor: ingestActor(useAi, opts) });
  const box = mailboxId ?? null;

  const existing = await existingMessageIds(db, box, emails.map((e) => e.messageId));
  const isFresh = emails.map((e) => {
    if (!e.messageId || existing.has(e.messageId)) return false;
    existing.add(e.messageId); // duplicity i v rámci jedné dávky
    return true;
  });
  if (!isFresh.some(Boolean)) return { processed: emails.length, ingested: 0 };

  const wantsAi = useAi && emails.some((e, i) => isFresh[i] && (e.direction ?? "in") === "in" && isRecent(e.receivedAt, policy.recentDays));
  const rules = wantsAi ? await getAgentInstructions("email") : undefined; // slovní pravidla agenta
  const replyMode = wantsAi ? await getModuleMode("reply") : "approval"; // 'full' = odeslat hned
  // odpověď jde ze schránky, kam e-mail přišel; pošta globálního účtu (bez schránky) = firemní schránka
  const replyFrom = box ? { mailboxId: box } : { system: true as const };
  const smtpReady = wantsAi && replyMode === "full" ? await isSmtpConfigured(replyFrom) : false;

  // Párování odesílatele / adresáta na zákazníka / dodavatele (přesná adresa → doména)
  const [{ data: customerRows }, { data: supplierRows }] = await Promise.all([
    db.from("customers").select("id, email"),
    db.from("suppliers").select("id, email"),
  ]);
  const customers = (customerRows ?? []) as PartyRef[];
  const suppliers = (supplierRows ?? []) as PartyRef[];
  let count = 0;

  for (let i = 0; i < emails.length; i++) {
    if (!isFresh[i]) continue;
    if (timeUp()) return { processed: i, ingested: count }; // zbytek příště
    const e = emails[i];
    const direction = e.direction ?? "in";
    let analysis: EmailAnalysis | null = null;
    if (direction === "in" && useAi && isRecent(e.receivedAt, policy.recentDays) && policy.budget.left > 0) {
      policy.budget.left--;
      try {
        analysis = await categorizeEmail({ from: e.fromEmail, subject: e.subject, body: e.body, rules, signal: AbortSignal.timeout(AI_CALL_TIMEOUT_MS) });
      } catch (err) {
        console.error(`[mail:ingest] AI kategorizace selhala: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const rule = direction === "in" && !analysis ? ruleCategorize({ fromEmail: e.fromEmail, fromName: e.fromName, subject: e.subject, body: e.body, headers: e.headers }) : null;
    const category = analysis && isDbEmailCategory(analysis.category) ? analysis.category : rule?.category ?? "ostatni";
    const isSpam = direction === "in" && Boolean(analysis ? analysis.is_spam || category === "spam" : rule?.isSpam);
    const party = direction === "out" ? (e.toEmail ?? "").split(",")[0]?.trim() ?? "" : e.fromEmail;
    const customerId = matchPartyByEmail(party, customers);
    const supplierId = customerId ? undefined : matchPartyByEmail(party, suppliers);

    const { data: inserted, error } = await db
      .from("emails")
      .upsert(
        {
          mailbox_id: box,
          owner_id: opts.ownerId ?? null,
          direction,
          customer_id: customerId ?? null,
          supplier_id: supplierId ?? null,
          message_id: e.messageId,
          in_reply_to: e.inReplyTo ?? null,
          message_refs: e.references?.length ? e.references : null,
          from_name: e.fromName,
          from_email: e.fromEmail,
          to_email: e.toEmail ?? null,
          cc_email: e.ccEmail ?? null,
          subject: e.subject,
          body_text: e.body,
          snippet: e.body.replace(/\s+/g, " ").trim().slice(0, 200),
          category: isSpam ? "spam" : category,
          priority: analysis && isPriorityLevel(analysis.priority) ? analysis.priority : rule?.priority ?? "stredni",
          importance: analysis ? Math.round(clamp(analysis.importance, 0, 100, 50)) : null,
          ai_confidence: analysis ? clamp(analysis.confidence, 0, 1, 0) : null,
          ai_summary: analysis?.summary ?? null,
          ai_pending: direction === "in" && !analysis && !isSpam,
          is_spam: isSpam,
          is_read: direction === "out",
          has_draft: false,
          has_attachments: Boolean(e.attachments?.length),
          imap_folder: e.imapFolder ?? null,
          imap_uid: e.imapUid ?? null,
          imap_uidvalidity: e.imapUidValidity ?? null,
          received_at: e.receivedAt,
        } as never,
        { onConflict: "mailbox_id,message_id", ignoreDuplicates: true },
      )
      .select("id")
      .maybeSingle();

    if (error) {
      console.error(`[mail:ingest] Uložení e-mailu selhalo: ${error.message}`);
      continue;
    }
    if (!inserted) continue; // souběžně už uloženo
    count++;
    const emailId = (inserted as { id: string }).id;
    await saveAttachments(db, emailId, e);

    // Návrh odpovědi jen s AI, ne u spamu a jen u čerstvé pošty: plná automatika = odeslat hned, jinak fronta
    if (!analysis || isSpam || !isRecent(e.receivedAt, policy.replyWindowHours / 24)) continue;
    try {
      const draft = await draftReply({ from: e.fromEmail, subject: e.subject, body: e.body, category, rules, signal: AbortSignal.timeout(AI_CALL_TIMEOUT_MS) });
      if (!draft.trim()) continue;

      let sentAuto = false;
      if (replyMode === "full" && smtpReady && e.fromEmail) {
        const h = replyHeaders({ messageId: e.messageId, references: e.references, subject: e.subject });
        const res = await sendMail({
          to: e.fromEmail,
          subject: replySubject(e.subject),
          text: draft,
          from: replyFrom,
          senderId: opts.ownerId ?? undefined,
          inReplyTo: h.inReplyTo ?? null,
          references: h.references,
          customerId: customerId ?? null,
          supplierId: supplierId ?? null,
        });
        sentAuto = res.sent;
      }

      const confidence = clamp(analysis.confidence, 0, 1, 0);
      await db.from("approval_queue").insert({
        type: "email_reply",
        title: `${sentAuto ? "Automaticky odesláno" : "Odpověď"}: ${e.subject}`.slice(0, 120),
        summary: analysis.summary,
        payload: { body: draft, subject: replySubject(e.subject) },
        target: e.fromEmail,
        ai_confidence: confidence,
        email_id: emailId,
        // #25: návrh odpovědi patří vlastníkovi schránky (fronta je vidět jen jemu a super adminovi)
        owner_id: opts.ownerId ?? null,
        ...(sentAuto ? { status: "auto_executed", resolved_at: new Date().toISOString() } : {}),
      } as never);
      if (!sentAuto) await db.from("emails").update({ has_draft: true } as never).eq("id", emailId);
    } catch (err) {
      console.error(`[mail:ingest] Návrh odpovědi selhal: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { processed: emails.length, ingested: count };
}

/**
 * AI dotřídění už uložených e-mailů (ai_pending): v synchronizaci jen čerstvé (rozpočet), na požádání
 * (tlačítko „Roztřídit AI") i starší. Bez návrhu odpovědi. Vrací počet roztříděných.
 */
export async function aiCategorizeStored(
  ids: string[],
  opts: { ownerId?: string | null; stopAt?: number; budget?: { left: number } } = {},
): Promise<{ done: number; error?: string }> {
  if (!ids.length || !isSupabaseConfigured() || !hasServiceKey()) return { done: 0 };
  if (!(await isMailAiEnabled())) return { done: 0, error: "AI je vypnutá nebo chybí Claude API klíč (Nastavení)." };
  const db = createAdminClient({ actor: aiActor(opts.ownerId ?? null, "email-ingest", "email") });
  const { data } = await db.from("emails").select("id, from_email, subject, body_text, owner_id").in("id", ids.slice(0, 100));
  const rules = await getAgentInstructions("email");
  let done = 0;
  for (const row of (data ?? []) as { id: string; from_email: string | null; subject: string | null; body_text: string | null }[]) {
    if (opts.stopAt !== undefined && Date.now() > opts.stopAt) break;
    if (opts.budget && opts.budget.left <= 0) break;
    if (opts.budget) opts.budget.left--;
    try {
      const a = await categorizeEmail({ from: row.from_email ?? "", subject: row.subject ?? "", body: row.body_text ?? "", rules, signal: AbortSignal.timeout(AI_CALL_TIMEOUT_MS) });
      const category = isDbEmailCategory(a.category) ? a.category : "ostatni";
      const spam = Boolean(a.is_spam || category === "spam");
      await db.from("emails").update({
        category: spam ? "spam" : category, is_spam: spam,
        priority: isPriorityLevel(a.priority) ? a.priority : "stredni",
        importance: Math.round(clamp(a.importance, 0, 100, 50)),
        ai_confidence: clamp(a.confidence, 0, 1, 0), ai_summary: a.summary ?? null, ai_pending: false,
      } as never).eq("id", row.id);
      done++;
    } catch (err) {
      console.error(`[mail:ai] Dotřídění selhalo: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { done };
}

/** Čerstvé e-maily schránky čekající na AI (po stažení, zbývá-li rozpočet). */
async function aiCatchUp(box: MailboxRow, policy: AiPolicy, stopAt: number): Promise<number> {
  if (policy.budget.left <= 0 || Date.now() > stopAt || !(await isMailAiEnabled())) return 0;
  const since = new Date(Date.now() - policy.recentDays * 86_400_000).toISOString();
  const { data } = await createAdminClient()
    .from("emails")
    .select("id")
    .eq("mailbox_id", box.id)
    .eq("ai_pending", true)
    .eq("direction", "in")
    .gte("received_at", since)
    .order("received_at", { ascending: false })
    .limit(policy.budget.left);
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  return (await aiCategorizeStored(ids, { ownerId: box.owner_id, stopAt, budget: policy.budget })).done;
}

/**
 * Synchronizace pošty. S `mailboxIds` jen vybrané schránky (bez globálního
 * fallbacku); bez filtru všechny aktivní schránky + globální přístupové údaje.
 * Kvůli zpětné kompatibilitě bere i číslo (= velikost dávky).
 */
export async function syncMailbox(opts: SyncOptions | number = {}): Promise<SyncResult> {
  const o: SyncOptions = typeof opts === "number" ? { limit: opts } : opts;
  const chunk = Math.round(clamp(o.limit ?? 50, 1, 200, 50));
  const ai = await isMailAiEnabled();
  const policy = await loadAiPolicy();

  // 1) Schránky s vlastní konfigurací — souběžně po 3, s časovým limitem
  const boxes = filterMailboxesForSync(await getActiveMailboxes(), o.mailboxIds);
  const deadline = o.deadline ?? Date.now() + DEFAULT_SYNC_MS;
  const stopAt = deadline - SYNC_RESERVE_MS; // novou schránku / e-mail začít jen s rezervou
  const statuses = await getMailboxStatuses(boxes.map((b) => b.id));
  const reports: MailboxSyncReport[] = new Array(boxes.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, boxes.length) }, async () => {
      while (next < boxes.length) {
        const i = next++;
        const box = boxes[i];
        if (Date.now() > stopAt) {
          const st = statuses.get(box.id);
          reports[i] = {
            id: box.id, email: box.email, ok: true, fetched: 0, ingested: 0, skipped: "deadline",
            remaining: st?.last_sync_remaining ?? undefined, total: totalOf(st),
            note: `${box.email}: nestihlo se v časovém limitu — stáhne se při příštím stažení.`,
          };
          continue;
        }
        reports[i] = await syncOneMailbox(box, {
          chunk,
          maxMessages: o.maxMessages,
          deadline,
          stopAt,
          actor: o.actor,
          auto: o.auto === true,
          minIntervalMs: o.minIntervalMs,
          manual: o.manual === true,
          status: statuses.get(box.id),
          policy,
        }).catch((err: unknown) => ({
          id: box.id, email: box.email, ok: false, fetched: 0, ingested: 0,
          error: `${box.email}: ${err instanceof Error ? err.message : "chyba"}`,
        }));
      }
    }),
  );

  const attempted = reports.filter((r) => r.skipped !== "incomplete");
  if (attempted.length > 0) {
    const ran = attempted.filter((r) => !r.skipped);
    const notes = reports.map((r) => r.error ?? r.note).filter((m): m is string => Boolean(m));
    const remaining = reports.reduce((s, r) => s + (r.ok && r.skipped !== "auth" ? r.remaining ?? 0 : 0), 0);
    return {
      source: ran.some((r) => r.source === "graph") ? "graph" : ran.length || attempted.length ? "imap" : "none",
      configured: true,
      fetched: reports.reduce((s, r) => s + r.fetched, 0),
      ingested: reports.reduce((s, r) => s + r.ingested, 0),
      mailboxes: ran.filter((r) => r.ok).length,
      ai,
      boxes: reports,
      total: reports.reduce((s, r) => s + (r.total ?? 0), 0),
      remaining,
      // „locked" = schránku právě stahuje jiný proces (živá pošta, plánovač) → klient to za chvíli zkusí znovu
      done: remaining === 0 && !reports.some((r) => r.ok && (r.skipped === "deadline" || r.skipped === "locked" || r.partial)),
      message: notes.length ? notes.join(" · ") : undefined,
    };
  }

  // Vybrané schránky (uživatel bez super admina) — globální účet se nepoužije
  if (!allowGlobalFallback(o)) {
    return {
      source: "none",
      configured: false,
      fetched: 0,
      ingested: 0,
      mailboxes: 0,
      ai,
      boxes: reports,
      done: true,
      message: boxes.length
        ? reports.map((r) => r.error).filter(Boolean).join(" · ") + " Oprav nastavení schránky v Můj účet → Moje e-mailová schránka."
        : "Žádná z vybraných schránek není aktivní — zapni ji v Můj účet → Moje e-mailová schránka.",
    };
  }

  // 2) Fallback: globální přístupové údaje (Nastavení → API klíče a integrace) — bez vlastníka (jen super admin)
  const imap = await getImapConfig();
  const graph = await getGraphConfig();
  const graphReady = Boolean(graph.clientId && graph.clientSecret && graph.tenantId);
  const imapReady = Boolean(imap.host && imap.user && imap.password);

  try {
    if (graphReady) {
      const user = graph.user || imap.user || "";
      const emails = await fetchGraphEmails(graph, user, chunk);
      const count = await ingestEmails(emails, null, { actor: o.actor, ai: policy });
      return { source: "graph", configured: true, fetched: emails.length, ingested: count, mailboxes: 1, ai, done: true };
    }
    if (imapReady) {
      const emails = await fetchImapEmails(imap, chunk);
      const count = await ingestEmails(emails, null, { actor: o.actor, ai: policy });
      return { source: "imap", configured: true, fetched: emails.length, ingested: count, mailboxes: 1, ai, done: true };
    }
    return {
      source: "none",
      configured: false,
      fetched: 0,
      ingested: 0,
      mailboxes: 0,
      ai,
      boxes: reports,
      done: true,
      message: reports.length
        ? `${reports.map((r) => r.error).filter(Boolean).join(" · ")}`
        : "Žádná schránka není nakonfigurována. Připoj schránku v Můj účet → Moje e-mailová schránka (firemní v Nastavení → E-mailové schránky).",
    };
  } catch (err) {
    const port = Number(imap.port) || 993;
    const kind = classifyMailError(err);
    return {
      source: graphReady ? "graph" : "imap",
      configured: true,
      fetched: 0,
      ingested: 0,
      ai,
      done: true,
      message: graphReady
        ? err instanceof Error ? err.message : "Chyba synchronizace"
        : `Globální IMAP: ${describeMailError(kind, { endpoint: { protocol: "imap", host: imap.host ?? "", port, tls: defaultTlsForPort(port) }, raw: rawErrorText(err), user: imap.user })}`,
    };
  }
}

// ── Jedna schránka ──────────────────────────────────────────
export interface MailboxSyncReport {
  id: string;
  email: string;
  ok: boolean;
  fetched: number;
  ingested: number;
  source?: "imap" | "pop3" | "graph";
  /** Zprávy, které zůstaly na serveru (časový limit) — stáhnou se při dalším volání. */
  remaining?: number;
  /** Zpráv na serveru (INBOX + Odeslané). */
  total?: number;
  /** Stahování přerušil časový limit (zbývající počet nemusí být úplný). */
  partial?: boolean;
  /** Kolik e-mailů dotřídila AI. */
  aiSorted?: number;
  error?: string;
  note?: string;
  /**
   * Proč se schránka nestahovala: neúplná, právě se stahuje, stažená před chvílí (automaticky),
   * nevešla se do časového limitu, známé odmítnuté heslo (automaticky se nepřihlašuje).
   */
  skipped?: "incomplete" | "locked" | "recent" | "deadline" | "auth";
  /** Uložený server nefungoval, použil se ověřený server poskytovatele (uloženo ke schránce). */
  healed?: string;
}

/** Zpráv na serveru při posledním stažení (mailbox_status.last_sync_total, migrace 20261029100000). */
function totalOf(st: MailboxStatus | undefined): number | undefined {
  const v = (st as (MailboxStatus & { last_sync_total?: number | null }) | undefined)?.last_sync_total;
  return typeof v === "number" ? v : undefined;
}

/** Výchozí nejzazší konec synchronizace (bez `deadline`). */
const DEFAULT_SYNC_MS = 110_000;
/** Rezerva: novou schránku ani další e-mail nezačínat, zbývá-li do konce méně (AI volání max. 2 × 20 s + uložení). */
export const SYNC_RESERVE_MS = 60_000;
const AUTO_MIN_INTERVAL_MS = 2 * 60_000;
const INGEST_CHUNK = 5;
/** Připojení ke schránce (všechny pokusy vč. serveru poskytovatele). */
const CONNECT_BUDGET_MS = 25_000;

/**
 * Uloží e-maily po dávkách; před každým e-mailem hlídá `stopAt`. `progress` se průběžně
 * aktualizuje (i když uložení spadne) a po každé dávce se zavolá `checkpoint`.
 */
export async function ingestInChunks(
  emails: RawEmail[],
  box: Pick<MailboxRow, "id" | "owner_id">,
  actor: ActorContext | undefined,
  stopAt: number,
  progress: IngestProgress = { processed: 0, ingested: 0 },
  checkpoint?: (processed: number) => Promise<void>,
  ai?: AiPolicy,
): Promise<IngestProgress> {
  const start = progress.processed;
  for (let i = 0; i < emails.length; i += INGEST_CHUNK) {
    const chunk = emails.slice(i, i + INGEST_CHUNK);
    const r = await ingestEmailsProgress(chunk, box.id, { ownerId: box.owner_id, actor, stopAt, ...(ai ? { ai } : {}) });
    progress.processed = start + i + r.processed;
    progress.ingested += r.ingested;
    if (r.processed > 0 && checkpoint) await checkpoint(i + r.processed);
    if (r.processed < chunk.length) break; // časový limit — zbytek příště (stav se posune jen o zpracované)
  }
  return progress;
}

interface OneOptions {
  chunk: number;
  maxMessages?: number;
  deadline: number;
  stopAt: number;
  actor?: ActorContext;
  auto: boolean;
  minIntervalMs?: number;
  manual: boolean;
  status?: MailboxStatus;
  policy: AiPolicy;
}

interface GraphSyncState {
  /** Nejnovější stažený receivedDateTime (nové zprávy = novější). */
  newest?: string;
  /** Odkaz na další (starší) stránku Doručené pošty; null = starší pošta stažená. */
  next?: string | null;
  done?: boolean;
}

async function syncGraphMailbox(box: MailboxRow, o: OneOptions, state: MailSyncState, progress: IngestProgress): Promise<{ state: MailSyncState; fetched: number; remaining: number; complete: boolean }> {
  const cfg = box.config ?? {};
  const token = await graphToken({ clientId: cfg.ms_graph_client_id, clientSecret: cfg.ms_graph_client_secret, tenantId: cfg.ms_graph_tenant_id });
  const base = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(box.email)}/mailFolders/inbox/messages`;
  let g: GraphSyncState = { ...((state.graph as GraphSyncState | undefined) ?? {}) };
  let fetched = 0;
  const left = () => (o.maxMessages ?? Infinity) - fetched;
  const ingest = async (emails: RawEmail[]) => {
    const r = await ingestInChunks(emails, box, o.actor, o.stopAt, progress, undefined, o.policy);
    fetched += emails.length;
    return r;
  };
  // 1) nové
  if (g.newest) {
    const filter = encodeURIComponent(`receivedDateTime gt ${g.newest}`);
    const { emails } = await graphPage(token, `${base}?$filter=${filter}&$orderby=receivedDateTime asc&$top=${Math.min(o.chunk, 100)}&${GRAPH_SELECT}`);
    if (emails.length) {
      const before = progress.processed;
      await ingest(emails);
      const done = progress.processed - before;
      if (done > 0) g.newest = emails[done - 1].receivedAt;
      if (done < emails.length) return { state: { ...state, graph: g }, fetched, remaining: emails.length - done, complete: false };
    }
  }
  // 2) starší pošta po stránkách (od nejnovější)
  while (!g.done && Date.now() < o.stopAt && left() > 0) {
    const url = g.next ?? `${base}?$top=${Math.min(o.chunk, 100)}&$orderby=receivedDateTime desc&${GRAPH_SELECT}`;
    const { emails, next } = await graphPage(token, url);
    if (!g.newest && emails[0]) g.newest = emails[0].receivedAt;
    const before = progress.processed;
    await ingest(emails);
    if (progress.processed - before < emails.length) return { state: { ...state, graph: g }, fetched, remaining: 1, complete: false };
    g = { ...g, next, done: !next };
    await saveSyncProgress(box.id, { ...state, graph: g });
  }
  return { state: { ...state, graph: g }, fetched, remaining: g.done ? 0 : 1, complete: Boolean(g.done) };
}

async function syncOneMailbox(box: MailboxRow, o: OneOptions): Promise<MailboxSyncReport> {
  const cfg = box.config ?? {};
  const base = { id: box.id, email: box.email, fetched: 0, ingested: 0 };
  const state = (o.status?.sync_state ?? {}) as MailSyncState;
  const missing = mailboxMissing(box.provider, cfg);
  if (missing.length) {
    return { ...base, ok: false, skipped: "incomplete", error: `Schránka ${box.email} nemá vyplněno: ${missing.join(", ")} — doplň v nastavení schránky (Můj účet → Moje e-mailová schránka).` };
  }
  // Známé odmítnuté heslo: automatika se nepřihlašuje, dokud se údaje nezmění (jen ručně)
  if (!o.manual && isAuthBlocked(o.status, box)) {
    return { ...base, ok: false, skipped: "auth", source: box.provider === "outlook" ? "graph" : cfg.incoming_protocol === "pop3" ? "pop3" : "imap", error: authBlockedMessage(box.email) };
  }
  // zámek jen do konce běhu (+ 30 s): přerušený běh (limit platformy) schránku nezablokuje na dlouho
  const lockMs = Math.max(60_000, o.deadline - Date.now() + 30_000);
  if (!(await acquireSyncLock(box.id, lockMs, o.auto ? o.minIntervalMs ?? AUTO_MIN_INTERVAL_MS : 0))) {
    return o.auto
      ? { ...base, ok: true, skipped: "recent", remaining: o.status?.last_sync_remaining ?? undefined, total: totalOf(o.status) }
      : { ...base, ok: true, skipped: "locked", note: `${box.email}: právě se stahuje (jiný proces) — zkus to za chvíli.` };
  }
  const now = () => new Date().toISOString();
  const okPatch = () => ({ last_sync_ok_at: now(), last_sync_error: null, last_sync_error_kind: null, last_sync_auth_fp: null });
  const progress: IngestProgress = { processed: 0, ingested: 0 };

  // Microsoft 365 (Graph)
  if (box.provider === "outlook") {
    try {
      const r = await syncGraphMailbox(box, o, state, progress);
      const aiSorted = await aiCatchUp(box, o.policy, o.stopAt).catch(() => 0);
      await releaseSyncLock(box.id, {
        ...okPatch(), last_sync_fetched: r.fetched, last_sync_new: progress.ingested, last_sync_remaining: r.remaining, sync_state: r.state,
      });
      return { ...base, ok: true, source: "graph", fetched: r.fetched, ingested: progress.ingested, remaining: r.remaining, partial: !r.complete, aiSorted };
    } catch (err) {
      const message = `${box.email}: ${err instanceof Error ? err.message : "Microsoft Graph chyba"}`;
      await releaseSyncLock(box.id, { last_sync_error: message, last_sync_error_kind: classifyMailError(err), last_sync_auth_fp: null });
      return { ...base, ok: false, source: "graph", ingested: progress.ingested, error: message };
    }
  }

  // IMAP / POP3 (hosting90 a další) — INBOX i Odeslané, dávka za dávkou do časového limitu
  const incoming = resolveIncoming(cfg, box.email)!;
  let lastState: MailSyncState = state;
  let started = false;
  try {
    const budgetMs = Math.max(5_000, Math.min(CONNECT_BUDGET_MS, o.stopAt - Date.now()));
    const res = await syncIncoming(
      incoming,
      box.email,
      state,
      { chunk: o.chunk, stopAt: o.stopAt, maxMessages: o.maxMessages, budgetMs },
      async (batch) => {
        started = true;
        const before = progress.processed;
        await ingestInChunks(batch.emails, box, o.actor, o.stopAt, progress, async (n) => {
          lastState = batch.stateAfter(n);
          await saveSyncProgress(box.id, lastState);
        }, o.policy);
        const n = progress.processed - before;
        lastState = batch.stateAfter(n);
        return n;
      },
    );
    lastState = res.state;
    let healed: string | undefined;
    if (res.healed) {
      healed = `${res.endpoint.host}:${res.endpoint.port}`;
      await saveHealedEndpoint(box, res.endpoint, o.actor);
    }
    const aiSorted = await aiCatchUp(box, o.policy, o.stopAt).catch(() => 0);
    const inboxEmpty = res.total === 0;
    const note = [
      healed ? `${box.email}: uložený server nefungoval — automaticky přepnuto na ${healed} (${res.endpoint.protocol.toUpperCase()}).` : "",
      inboxEmpty
        ? `${box.email}: INBOX na serveru je prázdný. Stahuje-li poštu Outlook přes POP3, zapni v něm „Ponechat kopii zpráv na serveru“ (nebo přepni Outlook na IMAP).`
        : "",
      res.remaining > 0 || !res.complete ? `${box.email}: stahuji dál — zbývá ${res.remaining > 0 ? res.remaining : "část"} zpráv.` : "",
    ].filter(Boolean).join(" ");
    await releaseSyncLock(box.id, {
      ...okPatch(), last_sync_fetched: res.fetched, last_sync_new: progress.ingested,
      last_sync_remaining: res.remaining, last_sync_total: res.total, sync_state: res.state,
    } as never);
    return {
      ...base, ok: true, source: res.endpoint.protocol === "pop3" ? "pop3" : "imap", fetched: res.fetched, ingested: progress.ingested,
      remaining: res.remaining, total: res.total, partial: !res.complete && res.remaining === 0, healed, aiSorted, note: note || undefined,
    };
  } catch (err) {
    const kind = classifyMailError(err);
    const message = started
      ? `${box.email}: uložení stažené pošty selhalo (${err instanceof Error ? err.message : "chyba"}) — zbytek se stáhne příště.`
      : `${box.email}: ${describeMailError(kind, { endpoint: incoming, raw: rawErrorText(err), user: incoming.user })}`;
    // zámek vždy uvolnit; už zpracované zprávy zůstanou zpracované (stav se posune jen o ně)
    await releaseSyncLock(box.id, {
      last_sync_error: message,
      last_sync_error_kind: started ? "other" : kind,
      last_sync_auth_fp: !started && kind === "auth" ? credentialFingerprint(box.provider, box.email, cfg) : null,
      ...(started ? { sync_state: lastState } : {}),
    });
    return { ...base, ok: false, source: incoming.protocol === "pop3" ? "pop3" : "imap", fetched: progress.processed, ingested: progress.ingested, error: message };
  }
}

/** Samooprava: fungující server poskytovatele uložit ke schránce (+ audit „kdo / co"). */
async function saveHealedEndpoint(box: MailboxRow, ep: { protocol: string; host: string; port: number; tls: "tls" | "starttls" }, actor?: ActorContext) {
  try {
    const who = actor ?? cronActor("cron-mail");
    const db = createAdminClient({ actor: who });
    const prev = box.config ?? {};
    const next: MailboxConfig = { ...prev, imap_host: ep.host, imap_port: ep.port, imap_tls: ep.tls, incoming_protocol: ep.protocol === "pop3" ? "pop3" : "imap" };
    delete next.imap_skip_name_check;
    await db.from("mailboxes").update({ config: next } as never).eq("id", box.id);
    await logAudit({
      action: "mailbox_autofixed",
      entity: "mailboxes",
      entityId: box.id,
      diff: { email: box.email, from: `${prev.imap_host}:${prev.imap_port ?? ""}`, to: `${ep.host}:${ep.port} ${ep.tls}`, protocol: ep.protocol },
      actor: who,
    });
  } catch (err) {
    console.error(`[mail:sync] Uložení opraveného serveru selhalo: ${err instanceof Error ? err.message : String(err)}`);
  }
}
