import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getMailScope, type MailScope } from "@/lib/data/mail";
import { canSeeEmail, categoryCodeFromLabel, isDbEmailCategory, isUuidLike, NO_MAILBOX, usefulAiSummary } from "@/lib/email/visibility";
import { emailCategoryLabel } from "@/lib/data/labels";
import { sortThread } from "@/lib/email/threading";
import type { EmailCategory } from "@/lib/data/types";
import type { EmailCategory as DbEmailCategory } from "@/lib/supabase/database.types";
import {
  EMPTY_COUNTS, type FolderCounts, type ThreadDetail, type ThreadMessage, type ThreadPage, type ThreadQuery, type ThreadShare,
  type ThreadSummary,
} from "@/lib/email/mail-types";

/**
 * Vlákna Přijaté pošty (RPC mail_threads / mail_folder_counts, migrace 20261029100000). Čte se
 * servisním klíčem — viditelnost předává a hlídá tento modul (super admin vše, ostatní své schránky,
 * e-maily přiřazené sobě a vlákna, která jim kolega předal).
 */

async function rawDb(): Promise<SupabaseClient | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    return (await createOperatorClient()) as unknown as SupabaseClient;
  } catch {
    return null;
  }
}

function clean(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

function label(c: unknown): EmailCategory {
  return emailCategoryLabel[isDbEmailCategory(c) ? c : "ostatni"] as EmailCategory;
}

/** Hledaná slova (bez znaků LIKE). */
export function searchWords(query: string | null | undefined): string[] {
  return (query ?? "")
    .split(/\s+/)
    .map((w) => w.trim().replace(/[\\%_]/g, (c) => `\\${c}`))
    .filter(Boolean)
    .slice(0, 8);
}

function scopeArgs(scope: MailScope, mailboxId: string | null | undefined) {
  const box = mailboxId && mailboxId !== NO_MAILBOX && isUuidLike(mailboxId) ? mailboxId : null;
  // filtr na cizí schránku (ne super admin) = nic
  const foreign = Boolean(box && !scope.all && !scope.ownedMailboxIds.includes(box));
  return {
    p_user: scope.userId,
    p_all: scope.all,
    p_owned: scope.ownedMailboxIds,
    p_mailbox: foreign ? "00000000-0000-0000-0000-000000000000" : box,
    p_no_mailbox: mailboxId === NO_MAILBOX,
  };
}

type ThreadRow = {
  thread_id: string; email_id: string; mailbox_id: string | null; direction: string; from_name: string | null; from_email: string | null;
  to_email: string | null; subject: string | null; snippet: string | null; category: string | null; ai_confidence: number | null;
  ai_summary: string | null; order_id: string | null; job_number: string | null; customer_name: string | null; mailbox_email: string | null;
  has_draft: boolean; message_count: number; unread_count: number; flagged: boolean; priority_rank: number; manual_priority: boolean;
  has_attachments: boolean; ai_pending: boolean; last_at: string; share_note: string | null; share_by_name: string | null;
  share_unread: boolean | null; total_count: number;
  // Pošta B (migrace 20261029145000)
  job_title?: string | null; job_link_source?: string | null; job_link_actor?: string | null;
  sugg_id?: string | null; sugg_job_id?: string | null; sugg_job_number?: string | null; sugg_job_title?: string | null; sugg_score?: number | null;
  sugg_email_id?: string | null;
};

export function toThreadSummary(r: ThreadRow): ThreadSummary {
  const out = r.direction === "out";
  return {
    threadId: r.thread_id,
    emailId: r.email_id,
    mailboxId: r.mailbox_id,
    mailboxEmail: r.mailbox_email ?? undefined,
    direction: out ? "out" : "in",
    from: out ? `Komu: ${clean(r.to_email) || "—"}` : clean(r.from_name) || clean(r.from_email) || "—",
    fromEmail: clean(r.from_email),
    toEmail: clean(r.to_email) || undefined,
    subject: clean(r.subject),
    preview: clean(r.snippet).slice(0, 200),
    category: label(r.category),
    aiConfidence: Number(r.ai_confidence ?? 0) || 0,
    aiSummary: usefulAiSummary(r.ai_summary),
    lastAt: r.last_at,
    jobId: r.order_id ?? undefined,
    jobNumber: r.job_number ?? undefined,
    customer: r.customer_name ?? undefined,
    hasDraft: Boolean(r.has_draft),
    messageCount: Number(r.message_count) || 1,
    unreadCount: Number(r.unread_count) || 0,
    flagged: Boolean(r.flagged),
    priority: Math.min(5, Math.max(1, Number(r.priority_rank) || 3)),
    priorityManual: Boolean(r.manual_priority),
    hasAttachments: Boolean(r.has_attachments),
    aiPending: Boolean(r.ai_pending),
    ...(r.share_note !== null || r.share_by_name !== null || r.share_unread !== null && r.share_unread !== false
      ? { share: { note: r.share_note, by: r.share_by_name, unread: Boolean(r.share_unread) } }
      : {}),
    ...(r.order_id && r.job_title ? { jobTitle: clean(r.job_title) } : {}),
    ...(r.order_id && r.job_link_source ? { jobLinkSource: r.job_link_source } : {}),
    ...(r.order_id && r.job_link_actor ? { jobLinkActor: r.job_link_actor } : {}),
    // návrh vlákna bez zakázky, nebo otázka k jedné zprávě vlákna jiné zakázky („Patří k Z-…?")
    ...(r.sugg_id && r.sugg_job_id && r.sugg_job_id !== r.order_id
      ? { suggestion: {
        id: r.sugg_id, jobId: r.sugg_job_id, jobNumber: r.sugg_job_number ?? "", jobTitle: clean(r.sugg_job_title) || undefined, score: Number(r.sugg_score) || 0,
        ...(r.order_id ? { forMessage: true, ...(r.sugg_email_id ? { emailId: r.sugg_email_id } : {}) } : {}),
      } }
      : {}),
  };
}

const PAGE = 50;

/** Stránka vláken složky. */
export async function listThreads(q: ThreadQuery): Promise<ThreadPage> {
  const empty: ThreadPage = { items: [], total: 0, offset: 0, hasMore: false };
  const scope = await getMailScope();
  if (!scope) return empty;
  const db = await rawDb();
  if (!db) return empty;
  const limit = Math.min(Math.max(Math.trunc(q.limit ?? PAGE) || PAGE, 1), 200);
  const offset = Math.max(0, Math.trunc(q.offset ?? 0) || 0);
  const words = searchWords(q.query);
  const { data, error } = await db.rpc("mail_threads", {
    ...scopeArgs(scope, q.mailboxId),
    p_folder: q.folder,
    p_words: words.length ? words : null,
    p_priority_max: q.priorityMax && q.priorityMax >= 1 && q.priorityMax <= 5 ? Math.trunc(q.priorityMax) : null,
    p_unread_only: Boolean(q.unreadOnly),
    p_sort: q.sort ?? "date",
    p_limit: limit,
    p_offset: offset,
    p_category: q.category ? categoryCodeFromLabel(q.category) : null,
  });
  if (error) {
    console.error(`[mail:threads] ${error.message}`);
    return empty;
  }
  const rows = (data ?? []) as ThreadRow[];
  const total = rows.length ? Number(rows[0].total_count) || rows.length : 0;
  return { items: rows.map(toThreadSummary), total, offset, hasMore: offset + rows.length < total };
}

export async function getFolderCounts(mailboxId?: string | null): Promise<FolderCounts> {
  const scope = await getMailScope();
  if (!scope) return EMPTY_COUNTS;
  const db = await rawDb();
  if (!db) return EMPTY_COUNTS;
  const { data, error } = await db.rpc("mail_folder_counts", scopeArgs(scope, mailboxId));
  if (error) {
    console.error(`[mail:counts] ${error.message}`);
    return EMPTY_COUNTS;
  }
  const r = ((data ?? []) as Record<string, number>[])[0] ?? {};
  return {
    inboxUnread: Number(r.inbox_unread) || 0, flagged: Number(r.flagged) || 0, spam: Number(r.spam) || 0,
    shared: Number(r.shared) || 0, sharedUnread: Number(r.shared_unread) || 0, aiPending: Number(r.ai_pending) || 0,
    jobsUnread: Number(r.jobs_unread) || 0, jobSuggestions: Number(r.job_suggestions) || 0,
  };
}

/** Razítko poslední změny pošty, kterou vidím (živé obnovení seznamu). */
export async function getMailStamp(): Promise<string | null> {
  const scope = await getMailScope();
  if (!scope) return null;
  const db = await rawDb();
  if (!db) return null;
  const { data } = await db.rpc("mail_threads", { ...scopeArgs(scope, null), p_folder: "all", p_limit: 1, p_offset: 0 });
  const r = ((data ?? []) as ThreadRow[])[0];
  return r ? `${r.last_at}|${r.email_id}|${r.total_count}` : "";
}

/**
 * Předání mně: schránky, ze kterých smím vidět zprávy vlákna (klíč = mailbox_id, „-" = pošta bez
 * schránky). Předání otevírá jen zprávy ZE SCHRÁNKY předaného e-mailu — nikdy kopie stejné zprávy
 * nebo odpovědi v cizích osobních schránkách (stejné vlákno nesmí propojit dvě schránky).
 */
export function shareKey(mailboxId: string | null | undefined): string {
  return mailboxId ?? "-";
}

/** Smím zprávu vidět: vlastním právem (canSeeEmail) nebo přes předání ze stejné schránky. */
export function visibleViaShare(
  scope: MailScope,
  row: { owner_id: string | null; mailbox_id: string | null },
  sharedBoxes: ReadonlySet<string>,
): boolean {
  return canSeeEmail(scope, row, scope.ownedMailboxIds) || sharedBoxes.has(shareKey(row.mailbox_id));
}

async function sharedBoxesFor(db: SupabaseClient, threadId: string, userId: string): Promise<Set<string>> {
  const { data } = await db.from("email_shares").select("mailbox_id").eq("thread_id", threadId).eq("shared_with", userId);
  return new Set(((data ?? []) as { mailbox_id: string | null }[]).map((r) => shareKey(r.mailbox_id)));
}

/** E-maily vlákna, které smím vidět (akce nad vláknem: vlaječka, priorita, přečteno, předání). */
export async function visibleThreadEmails(threadId: string): Promise<{
  scope: MailScope; rows: { id: string; owner_id: string | null; mailbox_id: string | null; direction: string; is_read: boolean; ai_pending: boolean }[]; sharedToMe: boolean;
} | null> {
  const scope = await getMailScope();
  if (!scope || typeof threadId !== "string" || !threadId || threadId.length > 400) return null;
  const db = await rawDb();
  if (!db) return null;
  const [{ data }, boxes] = await Promise.all([
    db.from("emails").select("id, owner_id, mailbox_id, direction, is_read, ai_pending").eq("thread_id", threadId).order("received_at", { ascending: true }).limit(500),
    sharedBoxesFor(db, threadId, scope.userId),
  ]);
  const rows = ((data ?? []) as { id: string; owner_id: string | null; mailbox_id: string | null; direction: string; is_read: boolean; ai_pending: boolean }[])
    .filter((r) => visibleViaShare(scope, r, boxes));
  return rows.length ? { scope, rows, sharedToMe: boxes.size > 0 } : null;
}

const MSG_SELECT = [
  "id, thread_id, mailbox_id, owner_id, direction, message_id, message_refs, from_name, from_email, to_email, cc_email, bcc_email",
  "subject, body_text, snippet, received_at, is_read, flagged, flagged_by, manual_priority, priority_rank, priority_set_by, category",
  "ai_confidence, ai_summary, ai_pending, has_draft, order_id, sent_copy, sent_copy_error, job_link_source, job_link_actor, body_html",
  "customer:customers!customer_id(name)", "job:orders!order_id(id, number, title)", "mailbox:mailboxes!mailbox_id(email)",
  "flagger:profiles!flagged_by(full_name)", "setter:profiles!priority_set_by(full_name)", "sender:profiles!owner_id(full_name)",
].join(", ");

type MsgRow = {
  id: string; thread_id: string | null; mailbox_id: string | null; owner_id: string | null; direction: string; message_id: string | null;
  message_refs: string[] | null; from_name: string | null; from_email: string | null; to_email: string | null; cc_email: string | null;
  bcc_email: string | null; subject: string | null; body_text: string | null; snippet: string | null; received_at: string; is_read: boolean;
  flagged: boolean; flagged_by: string | null; manual_priority: number | null; priority_rank: number | null; priority_set_by: string | null;
  category: DbEmailCategory | null; ai_confidence: number | null; ai_summary: string | null; ai_pending: boolean; has_draft: boolean;
  order_id: string | null; sent_copy: "ok" | "failed" | "skipped" | null; sent_copy_error: string | null;
  job_link_source?: string | null; job_link_actor?: string | null; body_html?: string | null;
  customer?: { name: string | null } | null; job?: { id: string; number: string | null; title?: string | null } | null; mailbox?: { email: string | null } | null;
  flagger?: { full_name: string | null } | null; setter?: { full_name: string | null } | null; sender?: { full_name: string | null } | null;
};

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

/**
 * Celé vlákno (zprávy, které smím vidět, od nejstarší) + komu bylo předáno. Vlákno předané mně →
 * vidím jeho zprávy ze schránky předaného e-mailu (a své vlastní).
 */
export async function getThread(threadId: string): Promise<ThreadDetail> {
  const scope = await getMailScope();
  if (!scope) return { ok: false, error: "Nemáš přístup k poště." };
  const db = await rawDb();
  if (!db || typeof threadId !== "string" || !threadId || threadId.length > 400) return { ok: false, error: "Vlákno nenalezeno." };
  const [{ data, error }, { data: shareRows }] = await Promise.all([
    db.from("emails").select(MSG_SELECT).eq("thread_id", threadId).order("received_at", { ascending: true }).limit(300),
    db.from("email_shares").select("id, mailbox_id, shared_by, shared_with, note, created_at, read_at, by:profiles!shared_by(full_name, email), to:profiles!shared_with(full_name, email)")
      .eq("thread_id", threadId).order("created_at", { ascending: true }),
  ]);
  if (error) return { ok: false, error: error.message };
  const shares = (shareRows ?? []) as { id: string; mailbox_id: string | null; shared_by: string | null; shared_with: string; note: string | null; created_at: string; read_at: string | null; by: unknown; to: unknown }[];
  const sharedBoxes = new Set(shares.filter((s) => s.shared_with === scope.userId).map((s) => shareKey(s.mailbox_id)));
  const rows = ((data ?? []) as unknown as MsgRow[]).filter((r) => visibleViaShare(scope, r, sharedBoxes));
  if (!rows.length) return { ok: false, error: "Vlákno nenalezeno (nebo k němu nemáš přístup)." };
  const ids = rows.map((r) => r.id);
  const { data: att } = await db.from("email_attachments").select("id, email_id, filename, size_bytes, mime_type").in("email_id", ids);
  const attBy = new Map<string, ThreadMessage["attachments"]>();
  for (const a of (att ?? []) as { id: string; email_id: string; filename: string | null; size_bytes: number | null; mime_type: string | null }[]) {
    const list = attBy.get(a.email_id) ?? [];
    list.push({ id: a.id, filename: a.filename ?? "příloha", sizeBytes: a.size_bytes, mimeType: a.mime_type });
    attBy.set(a.email_id, list);
  }
  const messages: ThreadMessage[] = sortThread(rows.map((r): ThreadMessage => ({
    id: r.id,
    direction: r.direction === "out" ? "out" as const : "in" as const,
    mailboxId: r.mailbox_id,
    mailboxEmail: one(r.mailbox)?.email ?? undefined,
    fromName: clean(r.from_name),
    fromEmail: clean(r.from_email),
    toEmail: clean(r.to_email),
    ccEmail: clean(r.cc_email),
    bccEmail: r.direction === "out" ? clean(r.bcc_email) || undefined : undefined,
    subject: clean(r.subject),
    body: (r.body_text ?? r.snippet ?? "").slice(0, 30000),
    receivedAt: r.received_at,
    isRead: r.is_read,
    flagged: r.flagged,
    flaggedBy: one(r.flagger)?.full_name ?? null,
    manualPriority: r.manual_priority,
    priority: Math.min(5, Math.max(1, Number(r.priority_rank) || 3)),
    prioritySetBy: one(r.setter)?.full_name ?? null,
    category: label(r.category),
    aiConfidence: Number(r.ai_confidence ?? 0) || 0,
    aiSummary: usefulAiSummary(r.ai_summary),
    aiPending: Boolean(r.ai_pending),
    hasDraft: Boolean(r.has_draft),
    jobId: one(r.job)?.id ?? r.order_id ?? undefined,
    jobNumber: one(r.job)?.number ?? undefined,
    jobLinkSource: r.order_id ? r.job_link_source ?? null : null,
    jobLinkActor: r.order_id ? r.job_link_actor ?? null : null,
    customer: one(r.customer)?.name ?? undefined,
    messageId: r.message_id,
    references: r.message_refs ?? [],
    attachments: attBy.get(r.id) ?? [],
    sentCopy: r.sent_copy,
    sentCopyError: r.sent_copy_error,
    senderName: r.direction === "out" ? one(r.sender)?.full_name ?? null : null,
    // odeslaná zpráva s grafickým podpisem z aplikace (HTML jsme sestavili sami, vše escapované)
    ...(r.direction === "out" && r.body_html && r.body_html.includes('data-mn-signature="1"') && r.body_html.length <= 200_000
      ? { signedHtml: r.body_html } : {}),
  })));
  const person = (p: unknown) => {
    const x = one(p as { full_name: string | null; email: string | null } | null);
    return x ? clean(x.full_name) || x.email || null : null;
  };
  const visibleShares: ThreadShare[] = shares
    .filter((s) => scope.all || s.shared_with === scope.userId || s.shared_by === scope.userId)
    .map((s) => ({ id: s.id, by: person(s.by), to: person(s.to), toId: s.shared_with, note: s.note, at: s.created_at, readAt: s.read_at }));
  const { data: boxes } = await db.from("mailboxes").select("email").eq("owner_id", scope.userId);
  const myAddresses = ((boxes ?? []) as { email: string }[]).map((b) => b.email.toLowerCase());
  const last = messages[messages.length - 1];
  const jobMsg = [...rows].sort((a, b) => Date.parse(b.received_at) - Date.parse(a.received_at)).find((r) => r.order_id);
  // Pošta B: návrh „Patří k Z-…?" (vlákno bez zakázky) / otázka k jedné zprávě vlákna jiné zakázky
  // (odpověď jmenuje jinou zakázku — ta zpráva zůstala nepřiřazená)
  let suggestion: ThreadDetail["suggestion"] = null;
  {
    let sq = db.from("email_job_suggestions").select("id, job_id, score, email_id, job:orders!job_id(number, title)")
      .eq("thread_id", threadId).eq("status", "pending");
    if (jobMsg) sq = sq.not("thread_job_id", "is", null).neq("job_id", jobMsg.order_id as string);
    const { data: sg } = await sq.order("score", { ascending: false }).limit(1).maybeSingle();
    const s = sg as { id: string; job_id: string; score: number; email_id: string | null; job: unknown } | null;
    const sj = one(s?.job as { number: string | null; title: string | null } | null);
    const unlinked = !jobMsg || Boolean(s?.email_id && rows.some((r) => r.id === s.email_id && !r.order_id));
    if (s && sj && unlinked) {
      suggestion = { id: s.id, jobId: s.job_id, jobNumber: sj.number ?? "", jobTitle: clean(sj.title) || undefined, score: Number(s.score) || 0, ...(jobMsg ? { forMessage: true, ...(s.email_id ? { emailId: s.email_id } : {}) } : {}) };
    }
  }
  return {
    ok: true,
    threadId,
    subject: messages.find((m) => m.subject)?.subject ?? "",
    messages,
    shares: visibleShares,
    myAddresses,
    jobId: jobMsg?.order_id ?? [...messages].reverse().find((m) => m.jobId)?.jobId ?? last?.jobId ?? null,
    jobNumber: jobMsg ? one(jobMsg.job)?.number ?? null : null,
    jobTitle: jobMsg ? clean(one(jobMsg.job)?.title) || null : null,
    suggestion,
  };
}
