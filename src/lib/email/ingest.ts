import "server-only";
import { categorizeEmail, draftReply } from "@/lib/ai/claude";
import { getAgentRules, buildRulesPrompt } from "@/lib/ai/rules";
import { createAdminClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { EmailCategory, PriorityLevel } from "@/lib/supabase/database.types";

/**
 * Stahování a AI-analýza příchozí pošty.
 * Zdroje: IMAP (hosting90) a Microsoft Graph (Outlook / M365).
 * Bez konfigurace vrací bezpečný stav (žádný pád).
 */

export interface RawEmail {
  messageId: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  body: string;
  receivedAt: string;
}

export interface SyncResult {
  source: "imap" | "graph" | "none";
  configured: boolean;
  fetched: number;
  ingested: number;
  message?: string;
}

function imapConfigured() {
  return Boolean(process.env.IMAP_HOST && process.env.IMAP_USER && process.env.IMAP_PASSWORD);
}

function graphConfigured() {
  return Boolean(process.env.MS_GRAPH_CLIENT_ID && process.env.MS_GRAPH_CLIENT_SECRET && process.env.MS_GRAPH_TENANT_ID);
}

// ── IMAP (hosting90) ────────────────────────────────────────
export async function fetchImapEmails(limit = 20): Promise<RawEmail[]> {
  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({
    host: process.env.IMAP_HOST!,
    port: Number(process.env.IMAP_PORT || 993),
    secure: true,
    auth: { user: process.env.IMAP_USER!, pass: process.env.IMAP_PASSWORD! },
    logger: false,
  });

  const out: RawEmail[] = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const mailbox = client.mailbox;
      const total = typeof mailbox === "object" ? mailbox.exists : 0;
      const start = Math.max(1, total - limit + 1);
      for await (const msg of client.fetch(`${start}:*`, { envelope: true, source: true })) {
        const env = msg.envelope;
        const fromAddr = env?.from?.[0];
        out.push({
          messageId: env?.messageId || String(msg.uid),
          fromName: fromAddr?.name || fromAddr?.address || "",
          fromEmail: fromAddr?.address || "",
          subject: env?.subject || "",
          body: msg.source ? msg.source.toString("utf8").slice(0, 8000) : "",
          receivedAt: (env?.date || new Date()).toISOString(),
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
async function graphToken(): Promise<string> {
  const params = new URLSearchParams({
    client_id: process.env.MS_GRAPH_CLIENT_ID!,
    client_secret: process.env.MS_GRAPH_CLIENT_SECRET!,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${process.env.MS_GRAPH_TENANT_ID}/oauth2/v2.0/token`,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params },
  );
  if (!res.ok) throw new Error(`Graph token chyba: ${res.status}`);
  const data = await res.json();
  return data.access_token as string;
}

export async function fetchGraphEmails(userPrincipal: string, limit = 20): Promise<RawEmail[]> {
  const token = await graphToken();
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userPrincipal)}/messages?$top=${limit}&$select=id,subject,from,bodyPreview,receivedDateTime`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Graph messages chyba: ${res.status}`);
  const data = await res.json();
  return (data.value ?? []).map((m: Record<string, unknown>) => {
    const from = (m.from as { emailAddress?: { name?: string; address?: string } })?.emailAddress;
    return {
      messageId: String(m.id),
      fromName: from?.name || "",
      fromEmail: from?.address || "",
      subject: (m.subject as string) || "",
      body: (m.bodyPreview as string) || "",
      receivedAt: (m.receivedDateTime as string) || new Date().toISOString(),
    } as RawEmail;
  });
}

// ── Uložení s AI analýzou ───────────────────────────────────
async function ingestEmails(emails: RawEmail[]): Promise<number> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SECRET_KEY) return 0;
  const db = createAdminClient();
  const rules = buildRulesPrompt(await getAgentRules("email")); // slovní pravidla agenta
  let count = 0;

  for (const e of emails) {
    const analysis = await categorizeEmail({ from: e.fromEmail, subject: e.subject, body: e.body, rules });
    const hasDraft = !analysis.is_spam && analysis.category !== "spam";

    const { data: inserted, error } = await db
      .from("emails")
      .upsert(
        {
          message_id: e.messageId,
          from_name: e.fromName,
          from_email: e.fromEmail,
          subject: e.subject,
          body_text: e.body,
          snippet: e.body.slice(0, 200),
          category: analysis.category as EmailCategory,
          priority: analysis.priority as PriorityLevel,
          importance: analysis.importance,
          ai_confidence: analysis.confidence,
          ai_summary: analysis.summary,
          is_spam: analysis.is_spam,
          has_draft: hasDraft,
          received_at: e.receivedAt,
        },
        { onConflict: "mailbox_id,message_id", ignoreDuplicates: false },
      )
      .select("id")
      .maybeSingle();

    if (error || !inserted) continue;
    count++;

    // Připrav návrh odpovědi do fronty ke schválení
    if (hasDraft) {
      const draft = await draftReply({ from: e.fromEmail, subject: e.subject, body: e.body, category: analysis.category, rules });
      await db.from("approval_queue").insert({
        type: "email_reply",
        title: `Odpověď: ${e.subject}`.slice(0, 120),
        summary: analysis.summary,
        payload: { body: draft },
        target: e.fromEmail,
        ai_confidence: analysis.confidence,
        email_id: inserted.id,
      });
    }
  }
  return count;
}

export async function syncMailbox(limit = 20): Promise<SyncResult> {
  try {
    if (graphConfigured()) {
      const user = process.env.MS_GRAPH_USER || process.env.IMAP_USER || "";
      const emails = await fetchGraphEmails(user, limit);
      const ingested = await ingestEmails(emails);
      return { source: "graph", configured: true, fetched: emails.length, ingested };
    }
    if (imapConfigured()) {
      const emails = await fetchImapEmails(limit);
      const ingested = await ingestEmails(emails);
      return { source: "imap", configured: true, fetched: emails.length, ingested };
    }
    return {
      source: "none",
      configured: false,
      fetched: 0,
      ingested: 0,
      message: "Žádná schránka není nakonfigurována (IMAP hosting90 nebo Microsoft Graph).",
    };
  } catch (err) {
    return {
      source: graphConfigured() ? "graph" : "imap",
      configured: true,
      fetched: 0,
      ingested: 0,
      message: err instanceof Error ? err.message : "Chyba synchronizace",
    };
  }
}
