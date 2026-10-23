import "server-only";
import { categorizeEmail, draftReply, type EmailAnalysis } from "@/lib/ai/claude";
import { getAgentInstructions } from "@/lib/ai/corrections";
import { getImapConfig, getGraphConfig, getSetting, getAiConfig } from "@/lib/settings";
import { getModuleMode } from "@/lib/automation";
import { sendMail, isSmtpConfigured } from "@/lib/email/send";
import { matchPartyByEmail, type PartyRef } from "@/lib/email/match";
import { fetchIncoming, type MailSyncState } from "@/lib/email/mail-fetch";
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
import { createAdminClient, hasServiceKey, isSupabaseConfigured } from "@/lib/supabase/server";
import { aiActor, cronActor, type ActorContext } from "@/lib/supabase/actor-headers";
import { logAudit } from "@/lib/audit";
import type { MailboxConfig, MailboxStatus } from "@/lib/supabase/database.types";

/**
 * Stahování a (volitelně) AI-analýza příchozí pošty.
 * Zdroje: IMAP (hosting90) a Microsoft Graph (Outlook / M365).
 * Pošta patří vlastníkovi schránky (emails.owner_id = mailboxes.owner_id).
 * AI běží jen se zapnutým hlavním vypínačem a klíčem — jinak se e-mail jen uloží.
 * Už uložené zprávy se znovu nezpracovávají (žádné opakované AI volání ani návrhy).
 * Bez konfigurace vrací bezpečný stav (žádný pád).
 */

export interface RawEmail {
  messageId: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  body: string;
  receivedAt: string;
  /** Adresát (volitelné — IMAP/Graph ho znají). */
  toEmail?: string;
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
}

export interface SyncOptions {
  /** Jen tyto schránky (bez filtru = všechny aktivní + globální přístupové údaje). */
  mailboxIds?: string[];
  /** Kolik nových zpráv stáhnout ze schránky najednou (1–100, výchozí 20). */
  limit?: number;
  /**
   * Nejzazší konec (epoch ms) — pod maxDuration route. Nová schránka / další e-mail se začne jen
   * do `deadline − 60 s` (rezerva na rozběhnutou práci); zbytek se stáhne příště.
   */
  deadline?: number;
  /** Automatické stažení (otevření Přijaté pošty): přeskočí schránky stažené před < 2 min. */
  auto?: boolean;
  /**
   * Ruční stažení (tlačítko „Stáhnout poštu", uložení schránky). Jen ručně se schránka přihlásí
   * i se známým odmítnutým heslem — automatika (otevření pošty, plánovač) ne (blokace IP).
   */
  manual?: boolean;
  /** Kdo synchronizaci spustil (uživatel / plánovač) — autor zápisů mimo AI. Výchozí = plánovač. */
  actor?: ActorContext;
}

export interface IngestOptions {
  /** Vlastník e-mailů (vlastník schránky / kdo importoval). */
  ownerId?: string | null;
  /** Kdo stahování / import spustil; zápisy AI jdou jako ✨ AI (e-mail) za vlastníka schránky. */
  actor?: ActorContext;
  /** Epoch ms: po tomto okamžiku už další e-mail nezačínat (zbytek se zpracuje příště). */
  stopAt?: number;
}

export interface IngestProgress {
  /** Kolik e-mailů ze vstupu (od začátku, souvisle) je vyřízeno — uložených i duplicit. */
  processed: number;
  /** Kolik nových e-mailů se uložilo. */
  ingested: number;
}

/** Časový limit jednoho AI volání (kategorizace, návrh odpovědi) — jeden e-mail se vejde do rezervy synchronizace. */
export const AI_CALL_TIMEOUT_MS = 20_000;

/** Autor zápisů ingestu: s AI = ✨ AI (e-mail) za vlastníka schránky, bez AI = kdo spustil (výchozí plánovač). */
export function ingestActor(useAi: boolean, opts: IngestOptions): ActorContext {
  return useAi ? aiActor(opts.ownerId ?? null, "email-ingest", "email") : opts.actor ?? cronActor("cron-mail");
}

type ImapCfg = { host?: string; port: number; user?: string; password?: string };
type GraphCfg = { clientId?: string; clientSecret?: string; tenantId?: string; user?: string };

const MAX_BODY = 12000;

// ── IMAP (globální přístupové údaje) ────────────────────────
/**
 * Nejnovějších `limit` zpráv přes IMAP — šifrování podle portu (993 TLS / 143 STARTTLS),
 * krátké časové limity, při chybě sítě / certifikátu ověřený server poskytovatele (hosting90).
 */
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

export async function fetchGraphEmails(cfg: GraphCfg, userPrincipal: string, limit = 20): Promise<RawEmail[]> {
  const token = await graphToken(cfg);
  // Jen Doručená pošta (ne odeslané); tělo jako prostý text
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userPrincipal)}/mailFolders/inbox/messages` +
      `?$top=${limit}&$orderby=receivedDateTime desc&$select=id,subject,from,toRecipients,body,bodyPreview,receivedDateTime`,
    { headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.body-content-type="text"' }, signal: AbortSignal.timeout(20_000) },
  );
  if (!res.ok) throw await graphError(res, "Doručenou poštu z Microsoft 365 nelze stáhnout");
  const data = await res.json();
  return (data.value ?? []).map((m: Record<string, unknown>) => {
    const from = (m.from as { emailAddress?: { name?: string; address?: string } })?.emailAddress;
    const to = (m.toRecipients as { emailAddress?: { address?: string } }[] | undefined)?.[0]?.emailAddress;
    const body = (m.body as { content?: string } | undefined)?.content || (m.bodyPreview as string) || "";
    return {
      messageId: String(m.id),
      fromName: from?.name || "",
      fromEmail: from?.address || "",
      subject: (m.subject as string) || "",
      body: body.slice(0, MAX_BODY),
      receivedAt: (m.receivedDateTime as string) || new Date().toISOString(),
      toEmail: to?.address || undefined,
    } as RawEmail;
  });
}

// ── Schránky s vlastní konfigurací (Nastavení → E-mailové schránky) ──
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

// ── Uložení (s AI analýzou, pokud je zapnutá) ───────────────
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
  const db = createAdminClient({ actor: ingestActor(useAi, opts) });
  const box = mailboxId ?? null;

  const existing = await existingMessageIds(db, box, emails.map((e) => e.messageId));
  const isFresh = emails.map((e) => {
    if (!e.messageId || existing.has(e.messageId)) return false;
    existing.add(e.messageId); // duplicity i v rámci jedné dávky
    return true;
  });
  if (!isFresh.some(Boolean)) return { processed: emails.length, ingested: 0 };

  const rules = useAi ? await getAgentInstructions("email") : undefined; // slovní pravidla agenta
  const replyMode = useAi ? await getModuleMode("reply") : "approval"; // 'full' = odeslat hned
  // odpověď jde ze schránky, kam e-mail přišel; pošta globálního účtu (bez schránky) = firemní schránka
  const replyFrom = box ? { mailboxId: box } : { system: true as const };
  const smtpReady = useAi && replyMode === "full" ? await isSmtpConfigured(replyFrom) : false;

  // Párování odesílatele na zákazníka / dodavatele (přesná adresa → doména)
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
    let analysis: EmailAnalysis | null = null;
    if (useAi) {
      try {
        analysis = await categorizeEmail({ from: e.fromEmail, subject: e.subject, body: e.body, rules, signal: AbortSignal.timeout(AI_CALL_TIMEOUT_MS) });
      } catch (err) {
        console.error(`[mail:ingest] AI kategorizace selhala: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const category = analysis && isDbEmailCategory(analysis.category) ? analysis.category : "ostatni";
    const isSpam = Boolean(analysis && (analysis.is_spam || category === "spam"));
    const customerId = matchPartyByEmail(e.fromEmail, customers);
    const supplierId = customerId ? undefined : matchPartyByEmail(e.fromEmail, suppliers);

    const { data: inserted, error } = await db
      .from("emails")
      .upsert(
        {
          mailbox_id: box,
          owner_id: opts.ownerId ?? null,
          direction: "in",
          customer_id: customerId ?? null,
          supplier_id: supplierId ?? null,
          message_id: e.messageId,
          from_name: e.fromName,
          from_email: e.fromEmail,
          to_email: e.toEmail ?? null,
          subject: e.subject,
          body_text: e.body,
          snippet: e.body.replace(/\s+/g, " ").trim().slice(0, 200),
          category: isSpam ? "spam" : category,
          priority: analysis && isPriorityLevel(analysis.priority) ? analysis.priority : "stredni",
          importance: analysis ? Math.round(clamp(analysis.importance, 0, 100, 50)) : null,
          ai_confidence: analysis ? clamp(analysis.confidence, 0, 1, 0) : null,
          ai_summary: analysis?.summary ?? null,
          is_spam: isSpam,
          has_draft: false,
          received_at: e.receivedAt,
        },
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

    // Návrh odpovědi jen s AI a ne u spamu: plná automatika = odeslat hned, jinak fronta ke schválení
    if (!analysis || isSpam) continue;
    try {
      const draft = await draftReply({ from: e.fromEmail, subject: e.subject, body: e.body, category, rules, signal: AbortSignal.timeout(AI_CALL_TIMEOUT_MS) });
      if (!draft.trim()) continue;

      let sentAuto = false;
      if (replyMode === "full" && smtpReady && e.fromEmail) {
        const res = await sendMail({
          to: e.fromEmail,
          subject: `Re: ${e.subject}`,
          text: draft,
          from: replyFrom,
          senderId: opts.ownerId ?? undefined,
        });
        sentAuto = res.sent;
      }

      const confidence = clamp(analysis.confidence, 0, 1, 0);
      await db.from("approval_queue").insert({
        type: "email_reply",
        title: `${sentAuto ? "Automaticky odesláno" : "Odpověď"}: ${e.subject}`.slice(0, 120),
        summary: analysis.summary,
        payload: { body: draft },
        target: e.fromEmail,
        ai_confidence: confidence,
        email_id: inserted.id,
        ...(sentAuto ? { status: "auto_executed", resolved_at: new Date().toISOString() } : {}),
      });
      if (!sentAuto) await db.from("emails").update({ has_draft: true }).eq("id", inserted.id);
    } catch (err) {
      console.error(`[mail:ingest] Návrh odpovědi selhal: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { processed: emails.length, ingested: count };
}

/**
 * Synchronizace pošty. S `mailboxIds` jen vybrané schránky (bez globálního
 * fallbacku); bez filtru všechny aktivní schránky + globální přístupové údaje.
 * Kvůli zpětné kompatibilitě bere i číslo (= limit).
 */
export async function syncMailbox(opts: SyncOptions | number = {}): Promise<SyncResult> {
  const o: SyncOptions = typeof opts === "number" ? { limit: opts } : opts;
  const limit = Math.round(clamp(o.limit ?? 20, 1, 100, 20));
  const ai = await isMailAiEnabled();

  // 1) Schránky s vlastní konfigurací (servery/porty/hesla per schránka) — souběžně po 3, s časovým limitem
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
          reports[i] = {
            id: box.id, email: box.email, ok: true, fetched: 0, ingested: 0, skipped: "deadline",
            note: `${box.email}: nestihlo se v časovém limitu — stáhne se při příštím stažení.`,
          };
          continue;
        }
        reports[i] = await syncOneMailbox(box, {
          limit,
          deadline,
          stopAt,
          actor: o.actor,
          auto: o.auto === true,
          manual: o.manual === true,
          status: statuses.get(box.id),
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
    return {
      source: ran.some((r) => r.source === "graph") ? "graph" : ran.length || attempted.length ? "imap" : "none",
      configured: true,
      fetched: reports.reduce((s, r) => s + r.fetched, 0),
      ingested: reports.reduce((s, r) => s + r.ingested, 0),
      mailboxes: ran.filter((r) => r.ok).length,
      ai,
      boxes: reports,
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
      message: boxes.length
        ? reports.map((r) => r.error).filter(Boolean).join(" · ") + " Požádej super admina."
        : "Žádná z vybraných schránek není aktivní — požádej super admina.",
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
      const emails = await fetchGraphEmails(graph, user, limit);
      const count = await ingestEmails(emails, null, { actor: o.actor });
      return { source: "graph", configured: true, fetched: emails.length, ingested: count, mailboxes: 1, ai };
    }
    if (imapReady) {
      const emails = await fetchImapEmails(imap, limit);
      const count = await ingestEmails(emails, null, { actor: o.actor });
      return { source: "imap", configured: true, fetched: emails.length, ingested: count, mailboxes: 1, ai };
    }
    return {
      source: "none",
      configured: false,
      fetched: 0,
      ingested: 0,
      mailboxes: 0,
      ai,
      boxes: reports,
      message: reports.length
        ? `${reports.map((r) => r.error).filter(Boolean).join(" · ")}`
        : "Žádná schránka není nakonfigurována. Přidej schránku (servery, porty, heslo) v Nastavení → E-mailové schránky.",
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
  /** Nové zprávy, které zůstaly na serveru (limit dávky / časový limit) — stáhnou se příště. */
  remaining?: number;
  /** Zpráv v INBOXu na serveru. */
  total?: number;
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
): Promise<IngestProgress> {
  for (let i = 0; i < emails.length; i += INGEST_CHUNK) {
    const chunk = emails.slice(i, i + INGEST_CHUNK);
    const r = await ingestEmailsProgress(chunk, box.id, { ownerId: box.owner_id, actor, stopAt });
    progress.processed = i + r.processed;
    progress.ingested += r.ingested;
    if (r.processed > 0 && checkpoint) await checkpoint(progress.processed);
    if (r.processed < chunk.length) break; // časový limit — zbytek příště (stav se posune jen o zpracované)
  }
  return progress;
}

async function syncOneMailbox(
  box: MailboxRow,
  o: { limit: number; deadline: number; stopAt: number; actor?: ActorContext; auto: boolean; manual: boolean; status?: MailboxStatus },
): Promise<MailboxSyncReport> {
  const cfg = box.config ?? {};
  const base = { id: box.id, email: box.email, fetched: 0, ingested: 0 };
  const state = (o.status?.sync_state ?? {}) as MailSyncState;
  const missing = mailboxMissing(box.provider, cfg);
  if (missing.length) {
    return { ...base, ok: false, skipped: "incomplete", error: `Schránka ${box.email} nemá vyplněno: ${missing.join(", ")} — doplň v Nastavení → E-mailové schránky.` };
  }
  // Známé odmítnuté heslo: automatika se nepřihlašuje, dokud se údaje nezmění (jen ručně)
  if (!o.manual && isAuthBlocked(o.status, box)) {
    return { ...base, ok: false, skipped: "auth", source: box.provider === "outlook" ? "graph" : cfg.incoming_protocol === "pop3" ? "pop3" : "imap", error: authBlockedMessage(box.email) };
  }
  // zámek jen do konce běhu (+ 30 s): přerušený běh (limit platformy) schránku nezablokuje na dlouho
  const lockMs = Math.max(60_000, o.deadline - Date.now() + 30_000);
  if (!(await acquireSyncLock(box.id, lockMs, o.auto ? AUTO_MIN_INTERVAL_MS : 0))) {
    return o.auto
      ? { ...base, ok: true, skipped: "recent" }
      : { ...base, ok: true, skipped: "locked", note: `${box.email}: právě se stahuje (jiný proces) — zkus to za chvíli.` };
  }
  const now = () => new Date().toISOString();
  const okPatch = () => ({ last_sync_ok_at: now(), last_sync_error: null, last_sync_error_kind: null, last_sync_auth_fp: null });
  const progress: IngestProgress = { processed: 0, ingested: 0 };

  // Microsoft 365 (Graph)
  if (box.provider === "outlook") {
    try {
      const emails = await fetchGraphEmails(
        { clientId: cfg.ms_graph_client_id, clientSecret: cfg.ms_graph_client_secret, tenantId: cfg.ms_graph_tenant_id },
        box.email,
        o.limit,
      );
      const { processed, ingested } = await ingestInChunks(emails.slice().reverse(), box, o.actor, o.stopAt, progress);
      await releaseSyncLock(box.id, {
        ...okPatch(), last_sync_fetched: emails.length, last_sync_new: ingested,
        last_sync_remaining: emails.length - processed,
      });
      return { ...base, ok: true, source: "graph", fetched: emails.length, ingested, remaining: emails.length - processed };
    } catch (err) {
      const message = `${box.email}: ${err instanceof Error ? err.message : "Microsoft Graph chyba"}`;
      await releaseSyncLock(box.id, { last_sync_error: message, last_sync_error_kind: classifyMailError(err), last_sync_auth_fp: null });
      return { ...base, ok: false, source: "graph", ingested: progress.ingested, error: message };
    }
  }

  // IMAP / POP3 (hosting90 a další)
  const incoming = resolveIncoming(cfg, box.email)!;
  let fetched: Awaited<ReturnType<typeof fetchIncoming>> | null = null;
  try {
    const budgetMs = Math.max(5_000, Math.min(CONNECT_BUDGET_MS, o.stopAt - Date.now()));
    const res = await fetchIncoming(incoming, box.email, state, o.limit, { budgetMs });
    fetched = res;
    const { processed, ingested } = await ingestInChunks(res.emails, box, o.actor, o.stopAt, progress, (n) =>
      saveSyncProgress(box.id, res.stateAfter(n)),
    );
    const remaining = res.remaining + (res.emails.length - processed);
    let healed: string | undefined;
    if (res.healed) {
      healed = `${res.endpoint.host}:${res.endpoint.port}`;
      await saveHealedEndpoint(box, res.endpoint, o.actor);
    }
    const note = [
      healed ? `${box.email}: uložený server nefungoval — automaticky přepnuto na ${healed} (${res.endpoint.protocol.toUpperCase()}).` : "",
      res.total === 0
        ? `${box.email}: INBOX na serveru je prázdný. Stahuje-li poštu Outlook přes POP3, zapni v něm „Ponechat kopii zpráv na serveru“ (nebo přepni Outlook na IMAP).`
        : "",
      remaining > 0 ? `${box.email}: dalších ${remaining} zpráv se stáhne při příštím stažení.` : "",
    ].filter(Boolean).join(" ");
    await releaseSyncLock(box.id, {
      ...okPatch(), last_sync_fetched: res.emails.length, last_sync_new: ingested,
      last_sync_remaining: remaining, sync_state: res.stateAfter(processed),
    });
    return { ...base, ok: true, source: res.endpoint.protocol === "pop3" ? "pop3" : "imap", fetched: res.emails.length, ingested, remaining, total: res.total, healed, note: note || undefined };
  } catch (err) {
    const kind = classifyMailError(err);
    const message = fetched
      ? `${box.email}: uložení stažené pošty selhalo (${err instanceof Error ? err.message : "chyba"}) — zbytek se stáhne příště.`
      : `${box.email}: ${describeMailError(kind, { endpoint: incoming, raw: rawErrorText(err), user: incoming.user })}`;
    // zámek vždy uvolnit; už zpracované zprávy zůstanou zpracované (stav se posune jen o ně)
    await releaseSyncLock(box.id, {
      last_sync_error: message,
      last_sync_error_kind: fetched ? "other" : kind,
      last_sync_auth_fp: !fetched && kind === "auth" ? credentialFingerprint(box.provider, box.email, cfg) : null,
      ...(fetched ? { sync_state: fetched.stateAfter(progress.processed) } : {}),
    });
    return { ...base, ok: false, source: incoming.protocol === "pop3" ? "pop3" : "imap", fetched: fetched?.emails.length ?? 0, ingested: progress.ingested, error: message };
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
