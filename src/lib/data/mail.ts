import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAccess } from "@/lib/auth/session";
import {
  emailVisibilityFilter, canSeeEmail, isUuidLike, one, toEmailItem, toSentItemFromMail,
  toSentItemFromApproval, mergeSentItems, NO_MAILBOX,
  type EmailListRow, type SentMailRow, type ApprovalSentRow, type MailViewer, type MailboxOption,
} from "@/lib/email/visibility";
import type { EmailCategory, MailboxConfig, MailboxProvider } from "@/lib/supabase/database.types";
import { getMailboxStatuses, isAuthBlocked } from "@/lib/email/mailbox-status";
import { mailboxMissing } from "@/lib/email/mail-config";
import type { EmailItem, SentItem } from "@/lib/data/types";

/**
 * Pošta per uživatel. Data se čtou servisním klíčem (RLS obchází) → viditelnost
 * hlídá tento modul: super admin (mail_all) vidí vše, ostatní jen e-maily své
 * schránky (mailboxes.owner_id) nebo přiřazené sobě (emails.owner_id).
 */

type Db = Awaited<ReturnType<typeof createOperatorClient>>;

async function supa(): Promise<Db | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    return await createOperatorClient();
  } catch {
    return null;
  }
}

function warn(scope: string, error: { message: string } | null | undefined) {
  if (error) console.error(`[mail:${scope}] Supabase chyba: ${error.message}`);
}

export interface MailScope extends MailViewer {
  /** Schránky, které uživateli patří (u super admina prázdné — vidí vše). */
  ownedMailboxIds: string[];
}

/** Kdo se dívá a co smí vidět (jednou za request). Bez přístupu k poště → null. */
export const getMailScope = cache(async (): Promise<MailScope | null> => {
  const { user, can } = await getAccess();
  if (!user || !user.active || !can("mail")) return null;
  const all = can("mail_all");
  if (all) return { userId: user.id, all, ownedMailboxIds: [] }; // super admin vidí vše — vlastní schránky netřeba
  const db = await supa();
  let ownedMailboxIds: string[] = [];
  if (db) {
    const { data, error } = await db.from("mailboxes").select("id").eq("owner_id", user.id);
    warn("scope", error);
    ownedMailboxIds = ((data ?? []) as { id: string }[]).map((m) => m.id);
  }
  return { userId: user.id, all, ownedMailboxIds };
});

/** Omezí dotaz na e-maily, které uživatel smí vidět. False = nesmí nic. */
function applyVisibility<Q extends { or: (filter: string) => Q }>(q: Q, scope: MailScope): Q | false {
  if (scope.all) return q;
  const filter = emailVisibilityFilter(scope.userId, scope.ownedMailboxIds);
  if (!filter) return false;
  return q.or(filter);
}

/** Filtr schránky (id, nebo NO_MAILBOX = e-maily bez schránky). False = neplatné id. */
function applyMailbox<Q extends { eq: (c: string, v: string) => Q; is: (c: string, v: null) => Q }>(
  q: Q, mailboxId: string | undefined,
): Q | false {
  if (!mailboxId) return q;
  if (mailboxId === NO_MAILBOX) return q.is("mailbox_id", null);
  if (!isUuidLike(mailboxId)) return false;
  return q.eq("mailbox_id", mailboxId);
}

export type { MailboxOption };

/** Schránky, které uživatel vidí: super admin všechny, ostatní své. Bez přístupových údajů. */
export async function getMailboxesForUser(): Promise<MailboxOption[]> {
  const scope = await getMailScope();
  if (!scope) return [];
  const db = await supa();
  if (!db) return [];
  let q = db
    .from("mailboxes")
    .select("id, email, display_name, owner_id, provider, config, owner:profiles!owner_id(full_name, email)")
    .order("email");
  if (!scope.all) q = q.eq("owner_id", scope.userId);
  const { data, error } = await q;
  warn("mailboxes", error);
  if (error || !data) return [];
  type Row = {
    id: string; email: string; display_name: string | null; owner_id: string | null;
    provider: MailboxProvider; config: MailboxConfig | null;
    owner?: { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] | null;
  };
  const rows = data as Row[];
  const statuses = await getMailboxStatuses(rows.map((m) => m.id));
  return rows.map((m) => {
    const owner = one(m.owner);
    const st = statuses.get(m.id);
    // hesla ani konfigurace do prohlížeče nejdou — jen příznak „neúplná"
    return {
      id: m.id,
      email: m.email,
      displayName: m.display_name,
      ownerId: m.owner_id,
      ownerName: (owner?.full_name ?? "").trim() || owner?.email || null,
      lastSyncAt: st?.last_sync_ok_at ?? null,
      lastSyncError: st?.last_sync_error ?? null,
      authBlocked: isAuthBlocked(st, { provider: m.provider, email: m.email, config: m.config }),
      incomplete: mailboxMissing(m.provider, m.config ?? {}).length > 0,
    };
  });
}

const EMAIL_LIST_SELECT = [
  "id, mailbox_id, owner_id, direction, from_name, from_email, to_email, subject, snippet",
  "category, priority, ai_confidence, ai_summary, is_read, has_draft, received_at, order_id",
  "customer:customers!customer_id(name)",
  "job:orders!order_id(id, number)",
  "mailbox:mailboxes!mailbox_id(email)",
].join(", ");

export interface GetEmailsOptions {
  /** Id schránky, nebo NO_MAILBOX pro e-maily bez schránky. */
  mailboxId?: string;
  direction?: "in" | "out";
  /** Kód kategorie z DB (poptavka, objednavka…). */
  category?: EmailCategory;
  limit?: number;
}

/** E-maily viditelné přihlášenému uživateli (nejnovější první). */
export async function getEmails(opts: GetEmailsOptions = {}): Promise<EmailItem[]> {
  const scope = await getMailScope();
  if (!scope) return [];
  const db = await supa();
  if (!db) return [];
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 100) || 100, 1), 500);
  let q = db
    .from("emails")
    .select(EMAIL_LIST_SELECT)
    .order("received_at", { ascending: false })
    .limit(limit);
  if (opts.direction) q = q.eq("direction", opts.direction);
  if (opts.category) q = q.eq("category", opts.category);
  const withBox = applyMailbox(q, opts.mailboxId);
  if (withBox === false) return [];
  const visible = applyVisibility(withBox, scope);
  if (visible === false) return [];
  const { data, error } = await visible;
  warn("emails", error);
  if (error || !data) return [];
  return (data as EmailListRow[]).map(toEmailItem);
}

/**
 * Odznak pošty v navigaci = počet nepřečtených VLÁKEN ve složce Přijaté (nepřečtený příchozí e-mail
 * nebo neotevřené předání od kolegy) — stejné číslo jako u složky Přijaté (RPC mail_folder_counts).
 */
export async function getUnreadCount(): Promise<number> {
  const scope = await getMailScope();
  if (!scope) return 0;
  const db = await supa();
  if (!db) return 0;
  try {
    const { data, error } = await (db as unknown as SupabaseClient).rpc("mail_folder_counts", {
      p_user: scope.userId, p_all: scope.all, p_owned: scope.ownedMailboxIds, p_mailbox: null, p_no_mailbox: false,
    });
    warn("unread", error);
    const r = ((data ?? []) as { inbox_unread?: number }[])[0];
    return Number(r?.inbox_unread) || 0;
  } catch {
    return 0;
  }
}

const SENT_SELECT = [
  "id, mailbox_id, owner_id, to_email, subject, snippet, body_text, received_at, order_id",
  "job:orders!order_id(id, number)",
  "mailbox:mailboxes!mailbox_id(email)",
  "sender:profiles!owner_id(full_name)",
].join(", ");

/**
 * Odeslaná pošta: odchozí e-maily viditelné uživateli; super admin navíc
 * starší log fronty schvalování (bez filtru schránky — fronta schránku nezná).
 */
export async function getSentMail(opts: { mailboxId?: string; limit?: number } = {}): Promise<SentItem[]> {
  const scope = await getMailScope();
  if (!scope) return [];
  const db = await supa();
  if (!db) return [];
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 200) || 200, 1), 500);

  let q = db
    .from("emails")
    .select(SENT_SELECT)
    .eq("direction", "out")
    .order("received_at", { ascending: false })
    .limit(limit);
  const withBox = applyMailbox(q, opts.mailboxId);
  if (withBox === false) return [];
  q = withBox;
  const visible = applyVisibility(q, scope);
  if (visible === false) return [];

  const [mailRes, approvalRes] = await Promise.all([
    visible,
    scope.all && !opts.mailboxId
      ? db
          .from("approval_queue")
          .select("id, type, title, target, payload, status, created_at, resolved_at")
          .in("status", ["approved", "auto_executed"])
          .order("resolved_at", { ascending: false })
          .limit(limit)
      : Promise.resolve({ data: [], error: null }),
  ]);
  warn("sent", mailRes.error);
  warn("sent_log", approvalRes.error);

  const mail = ((mailRes.data ?? []) as SentMailRow[]).map(toSentItemFromMail);
  const approvals = ((approvalRes.data ?? []) as ApprovalSentRow[])
    .map(toSentItemFromApproval)
    .filter((a): a is SentItem => a !== null);
  return mergeSentItems(mail, approvals).slice(0, limit);
}

/**
 * Jeden e-mail, pokud ho uživatel smí vidět (pro akce: otevření, přečteno,
 * založení zakázky). Vrací vybrané sloupce, nebo null.
 */
export async function getVisibleEmailRow<T extends object>(
  emailId: string,
  columns: string,
): Promise<{ row: T; scope: MailScope } | null> {
  if (!isUuidLike(emailId)) return null;
  const scope = await getMailScope();
  if (!scope) return null;
  const db = await supa();
  if (!db) return null;
  const { data, error } = await db
    .from("emails")
    .select(`owner_id, mailbox_id, ${columns}`)
    .eq("id", emailId)
    .maybeSingle();
  warn("email", error);
  if (error || !data) return null;
  const row = data as T & { owner_id: string | null; mailbox_id: string | null };
  if (!canSeeEmail(scope, row, scope.ownedMailboxIds) && !(await isSharedWithMe(db, emailId, scope.userId))) return null;
  return { row, scope };
}

/**
 * Vlákno e-mailu mi kolega předal („Předat kolegovi") → smím ho vidět — jen zprávy ze schránky
 * předaného e-mailu (kopie stejné zprávy v cizí osobní schránce ne).
 */
async function isSharedWithMe(db: Db, emailId: string, userId: string): Promise<boolean> {
  const raw = db as unknown as SupabaseClient;
  const { data: em } = await raw.from("emails").select("thread_id, mailbox_id").eq("id", emailId).maybeSingle();
  const row = em as { thread_id: string | null; mailbox_id: string | null } | null;
  if (!row?.thread_id) return false;
  let q = raw.from("email_shares").select("id", { count: "exact", head: true }).eq("thread_id", row.thread_id).eq("shared_with", userId);
  q = row.mailbox_id ? q.eq("mailbox_id", row.mailbox_id) : q.is("mailbox_id", null);
  const { count } = await q;
  return (count ?? 0) > 0;
}
