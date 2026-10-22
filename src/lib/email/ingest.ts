import "server-only";
import { categorizeEmail, draftReply, type EmailAnalysis } from "@/lib/ai/claude";
import { getAgentInstructions } from "@/lib/ai/corrections";
import { getImapConfig, getGraphConfig, getSetting, getAiConfig } from "@/lib/settings";
import { getModuleMode } from "@/lib/automation";
import { sendMail, isSmtpConfigured } from "@/lib/email/send";
import { matchPartyByEmail, type PartyRef } from "@/lib/email/match";
import { parseEmailFile } from "@/lib/email/parse";
import {
  isAiSwitchOn, filterMailboxesForSync, allowGlobalFallback, isDbEmailCategory, isPriorityLevel,
} from "@/lib/email/visibility";
import { createAdminClient, hasServiceKey, isSupabaseConfigured } from "@/lib/supabase/server";
import type { MailboxConfig } from "@/lib/supabase/database.types";

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
}

export interface SyncOptions {
  /** Jen tyto schránky (bez filtru = všechny aktivní + globální přístupové údaje). */
  mailboxIds?: string[];
  /** Kolik nejnovějších zpráv stáhnout ze schránky (1–100, výchozí 20). */
  limit?: number;
}

export interface IngestOptions {
  /** Vlastník e-mailů (vlastník schránky / kdo importoval). */
  ownerId?: string | null;
}

type ImapCfg = { host?: string; port: number; user?: string; password?: string };
type GraphCfg = { clientId?: string; clientSecret?: string; tenantId?: string; user?: string };

const MAX_SOURCE_BYTES = 512 * 1024; // celé zprávy s velkými přílohami nestahujeme
const MAX_BODY = 12000;

// ── IMAP (hosting90) ────────────────────────────────────────
export async function fetchImapEmails(cfg: ImapCfg, limit = 20): Promise<RawEmail[]> {
  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({
    host: cfg.host!,
    port: cfg.port,
    secure: true,
    auth: { user: cfg.user!, pass: cfg.password! },
    logger: false,
  });

  const out: RawEmail[] = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const mailbox = client.mailbox;
      const total = typeof mailbox === "object" ? mailbox.exists : 0;
      if (!total) return out;
      const start = Math.max(1, total - limit + 1);
      for await (const msg of client.fetch(`${start}:*`, { envelope: true, source: { maxLength: MAX_SOURCE_BYTES } })) {
        const env = msg.envelope;
        const fromAddr = env?.from?.[0];
        const toAddr = env?.to?.[0];
        // Tělo: dekódovaný MIME (text/plain, jinak HTML → text), ne surový zdroj s hlavičkami
        let body = "";
        if (msg.source) {
          const parsed = parseEmailFile("zprava.eml", msg.source);
          body = parsed.ok && parsed.email ? parsed.email.body : "";
        }
        out.push({
          messageId: env?.messageId || String(msg.uid),
          fromName: fromAddr?.name || fromAddr?.address || "",
          fromEmail: fromAddr?.address || "",
          subject: env?.subject || "",
          body: body.slice(0, MAX_BODY),
          receivedAt: (env?.date || new Date()).toISOString(),
          toEmail: toAddr?.address || undefined,
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
  return out;
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
    `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params },
  );
  if (!res.ok) throw new Error(`Graph token chyba: ${res.status}`);
  const data = await res.json();
  return data.access_token as string;
}

export async function fetchGraphEmails(cfg: GraphCfg, userPrincipal: string, limit = 20): Promise<RawEmail[]> {
  const token = await graphToken(cfg);
  // Jen Doručená pošta (ne odeslané); tělo jako prostý text
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userPrincipal)}/mailFolders/inbox/messages` +
      `?$top=${limit}&$orderby=receivedDateTime desc&$select=id,subject,from,toRecipients,body,bodyPreview,receivedDateTime`,
    { headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.body-content-type="text"' } },
  );
  if (!res.ok) throw new Error(`Graph messages chyba: ${res.status}`);
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
  if (!isSupabaseConfigured() || !hasServiceKey() || emails.length === 0) return 0;
  const db = createAdminClient();
  const box = mailboxId ?? null;

  const existing = await existingMessageIds(db, box, emails.map((e) => e.messageId));
  const fresh = emails.filter((e) => {
    if (!e.messageId || existing.has(e.messageId)) return false;
    existing.add(e.messageId); // duplicity i v rámci jedné dávky
    return true;
  });
  if (fresh.length === 0) return 0;

  const useAi = await isMailAiEnabled();
  const rules = useAi ? await getAgentInstructions("email") : undefined; // slovní pravidla agenta
  const replyMode = useAi ? await getModuleMode("reply") : "approval"; // 'full' = odeslat hned
  const smtpReady = useAi && replyMode === "full" ? await isSmtpConfigured(box ? { mailboxId: box } : {}) : false;

  // Párování odesílatele na zákazníka / dodavatele (přesná adresa → doména)
  const [{ data: customerRows }, { data: supplierRows }] = await Promise.all([
    db.from("customers").select("id, email"),
    db.from("suppliers").select("id, email"),
  ]);
  const customers = (customerRows ?? []) as PartyRef[];
  const suppliers = (supplierRows ?? []) as PartyRef[];
  let count = 0;

  for (const e of fresh) {
    let analysis: EmailAnalysis | null = null;
    if (useAi) {
      try {
        analysis = await categorizeEmail({ from: e.fromEmail, subject: e.subject, body: e.body, rules });
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
      const draft = await draftReply({ from: e.fromEmail, subject: e.subject, body: e.body, category, rules });
      if (!draft.trim()) continue;

      let sentAuto = false;
      if (replyMode === "full" && smtpReady && e.fromEmail) {
        const res = await sendMail({
          to: e.fromEmail,
          subject: `Re: ${e.subject}`,
          text: draft,
          from: box ? { mailboxId: box } : undefined,
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
  return count;
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

  // 1) Schránky s vlastní konfigurací (servery/porty/hesla per schránka)
  const boxes = filterMailboxesForSync(await getActiveMailboxes(), o.mailboxIds);
  let fetched = 0;
  let ingested = 0;
  let synced = 0;
  let used: SyncResult["source"] = "none";
  const errors: string[] = [];

  for (const box of boxes) {
    const cfg = box.config ?? {};
    try {
      if (box.provider !== "outlook" && cfg.imap_host && cfg.imap_user && cfg.imap_password) {
        const emails = await fetchImapEmails(
          {
            host: cfg.imap_host,
            port: Number(cfg.imap_port || 993),
            user: cfg.imap_user,
            password: cfg.imap_password,
          },
          limit,
        );
        fetched += emails.length;
        ingested += await ingestEmails(emails, box.id, { ownerId: box.owner_id });
        used = used === "graph" ? used : "imap";
      } else if (
        box.provider === "outlook" &&
        cfg.ms_graph_client_id &&
        cfg.ms_graph_client_secret &&
        cfg.ms_graph_tenant_id
      ) {
        const emails = await fetchGraphEmails(
          {
            clientId: cfg.ms_graph_client_id,
            clientSecret: cfg.ms_graph_client_secret,
            tenantId: cfg.ms_graph_tenant_id,
          },
          box.email,
          limit,
        );
        fetched += emails.length;
        ingested += await ingestEmails(emails, box.id, { ownerId: box.owner_id });
        used = "graph";
      } else {
        continue; // schránka bez přístupových údajů → přeskočit (globální fallback níže)
      }
      synced++;
      const db = createAdminClient();
      await db
        .from("mailboxes")
        .update({ last_sync_at: new Date().toISOString() })
        .eq("id", box.id);
    } catch (err) {
      errors.push(`${box.email}: ${err instanceof Error ? err.message : "chyba"}`);
    }
  }

  if (used !== "none" || errors.length > 0) {
    return {
      source: used,
      configured: true,
      fetched,
      ingested,
      mailboxes: synced,
      ai,
      message: errors.length ? errors.join(" · ") : undefined,
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
      message: boxes.length
        ? "Tvoje schránka nemá vyplněné přístupové údaje (server, uživatel, heslo) — požádej super admina."
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
      const count = await ingestEmails(emails);
      return { source: "graph", configured: true, fetched: emails.length, ingested: count, mailboxes: 1, ai };
    }
    if (imapReady) {
      const emails = await fetchImapEmails(imap, limit);
      const count = await ingestEmails(emails);
      return { source: "imap", configured: true, fetched: emails.length, ingested: count, mailboxes: 1, ai };
    }
    return {
      source: "none",
      configured: false,
      fetched: 0,
      ingested: 0,
      mailboxes: 0,
      ai,
      message:
        "Žádná schránka není nakonfigurována. Přidej schránku (servery, porty, heslo) v Nastavení → E-mailové schránky.",
    };
  } catch (err) {
    return {
      source: graphReady ? "graph" : "imap",
      configured: true,
      fetched: 0,
      ingested: 0,
      ai,
      message: err instanceof Error ? err.message : "Chyba synchronizace",
    };
  }
}
