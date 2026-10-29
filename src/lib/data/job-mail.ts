import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAccess } from "@/lib/auth/session";
import { getMailScope } from "@/lib/data/mail";
import { shareKey, visibleViaShare } from "@/lib/data/mail-threads";
import { emailCategoryLabel } from "@/lib/data/labels";
import { isDbEmailCategory, isUuidLike, usefulAiSummary } from "@/lib/email/visibility";
import { isSupplierInvoiceMail } from "@/lib/email/job-match";
import { FIELD_LABEL, changeHolds, isMailChangeField, overrideBadgeText, mailDateLabel } from "@/lib/email/job-instructions";
import type { ThreadSummary } from "@/lib/email/mail-types";
import type { EmailCategory } from "@/lib/data/types";

/**
 * Pošta B — Komunikace zakázky / poptávky: vlákna přiřazená k zakázce (jen ta, která uživatel smí
 * vidět podle pravidel pošty — vlastní schránka, předání, super admin vše), návrhy „Patří sem?",
 * změny a upřesnění z e-mailů (citlivé ceny dodavatele jen s právem na marže) a kontakt pro novou zprávu.
 */

export interface JobMailChangeView {
  id: string;
  kind: "change" | "info" | "tag" | "note";
  field: string;
  label: string;
  summary: string;
  valueNew: string | null;
  valuePrev: string | null;
  drawingValue: string | null;
  quote: string | null;
  /** replaced = hodnotu na položce mezitím ručně přepsal člověk (bez odznaku, bez „Vrátit"). */
  status: "applied" | "suggested" | "info" | "undone" | "dismissed" | "superseded" | "replaced";
  /** Proč jen návrh: other_job = e-mail ve vlákně jmenuje i jinou zakázku; mismatch = „X místo Y", ale Y na položce není. */
  hold: "other_job" | "mismatch" | null;
  /** Číslo zakázky, kterou e-mail jmenuje (hold = other_job). */
  holdJobNumber: string | null;
  /** „Y" z pokynu „X místo Y" (původní hodnota podle e-mailu). */
  mailOld: string | null;
  party: "customer" | "supplier" | "other" | null;
  fromName: string | null;
  mailAt: string | null;
  /** „Pokyn zákazníka z e-mailu 29. 10. 2026 — nadřazeno výkresu" (změna položky). */
  badge: string | null;
  itemId: string | null;
  itemLabel: string | null;
  emailId: string | null;
  /** Vlákno e-mailu (jen když ho uživatel smí otevřít). */
  threadId: string | null;
  appliedKind: string | null;
  createdAt: string;
}

export interface JobMailSuggestionView {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  at: string;
  score: number;
  reasons: string[];
}

export interface JobCommunication {
  jobId: string;
  jobNumber: string;
  /** Uživatel má poštu (vlákna, psaní). */
  canMail: boolean;
  threads: ThreadSummary[];
  suggestions: JobMailSuggestionView[];
  changes: JobMailChangeView[];
  /** Adresát nové zprávy (kontakt zakázky, jinak e-mail zákazníka). */
  contact: { email: string | null; name: string | null };
  /** Přílohy přiřazené pošty, které ještě nejsou v dokumentech (bez faktur dodavatelů — ty jdou do Faktur dodavatelů). */
  pendingFiles: number;
}

/** Sloupce položky, které změny z e-mailu zapisují (zda změna ještě platí). */
const ITEM_VALUE_COLS = "quantity, material, material_designation, revision, note, heat_status, heat_treatment, heat_steps, hardness, surface_status, surface_treatment, surface_steps";

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

type MailRow = {
  id: string; thread_id: string | null; mailbox_id: string | null; owner_id: string | null; direction: string; from_name: string | null;
  from_email: string | null; to_email: string | null; subject: string | null; snippet: string | null; category: string | null;
  ai_confidence: number | null; ai_summary: string | null; received_at: string; is_read: boolean; is_spam: boolean; flagged: boolean;
  priority_rank: number | null; manual_priority: number | null; has_attachments: boolean; ai_pending: boolean; has_draft: boolean;
  order_id: string | null; job_link_source: string | null; job_link_actor: string | null; supplier_id?: string | null;
  mailbox?: { email: string | null } | { email: string | null }[] | null; customer?: { name: string | null } | { name: string | null }[] | null;
};

function label(c: unknown): EmailCategory {
  return emailCategoryLabel[isDbEmailCategory(c) ? c : "ostatni"] as EmailCategory;
}

/** Vlákna ze zpráv (nejnovější vlákno první) — stejný tvar jako seznam Přijaté pošty. */
export function threadsFromRows(rows: readonly MailRow[], ownIds: ReadonlySet<string>, job: { id: string; number: string }): ThreadSummary[] {
  const by = new Map<string, MailRow[]>();
  for (const r of rows) {
    const t = r.thread_id ?? `m:${r.id}`;
    by.set(t, [...(by.get(t) ?? []), r]);
  }
  const out: ThreadSummary[] = [];
  for (const [threadId, list] of by) {
    const sorted = [...list].sort((a, b) => Date.parse(b.received_at) - Date.parse(a.received_at));
    const pick = sorted.find((m) => m.direction === "in") ?? sorted[0];
    const lastAt = sorted[0].received_at;
    const out1 = pick.direction === "out";
    const prio = sorted.filter((m) => m.direction === "in" || m.manual_priority !== null).map((m) => Number(m.priority_rank) || 3);
    const linked = sorted.find((m) => m.order_id);
    out.push({
      threadId, emailId: pick.id, mailboxId: pick.mailbox_id, mailboxEmail: one(pick.mailbox)?.email ?? undefined,
      direction: out1 ? "out" : "in",
      from: out1 ? `Komu: ${clean(pick.to_email) || "—"}` : clean(pick.from_name) || clean(pick.from_email) || "—",
      fromEmail: clean(pick.from_email), toEmail: clean(pick.to_email) || undefined, subject: clean(pick.subject),
      preview: clean(pick.snippet).slice(0, 200), category: label(pick.category), aiConfidence: Number(pick.ai_confidence ?? 0) || 0,
      aiSummary: usefulAiSummary(pick.ai_summary), lastAt, jobId: job.id, jobNumber: job.number, customer: one(pick.customer)?.name ?? undefined,
      hasDraft: sorted.some((m) => m.has_draft), messageCount: sorted.length,
      unreadCount: sorted.filter((m) => ownIds.has(m.id) && m.direction === "in" && !m.is_read && !m.is_spam).length,
      flagged: sorted.some((m) => m.flagged), priority: Math.min(5, Math.max(1, prio.length ? Math.min(...prio) : 3)),
      priorityManual: sorted.some((m) => m.manual_priority !== null), hasAttachments: sorted.some((m) => m.has_attachments),
      aiPending: sorted.some((m) => m.ai_pending), jobLinkSource: linked?.job_link_source ?? undefined, jobLinkActor: linked?.job_link_actor ?? undefined,
    });
  }
  return out.sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt));
}

const MAIL_COLS = [
  "id, thread_id, mailbox_id, owner_id, direction, from_name, from_email, to_email, subject, snippet, category, ai_confidence, ai_summary",
  "received_at, is_read, is_spam, flagged, priority_rank, manual_priority, has_attachments, ai_pending, has_draft, order_id, job_link_source, job_link_actor, supplier_id",
  "mailbox:mailboxes!mailbox_id(email)", "customer:customers!customer_id(name)",
].join(", ");

export async function getJobCommunication(jobId: string): Promise<JobCommunication | null> {
  if (!isSupabaseConfigured() || !isUuidLike(jobId)) return null;
  const { user, can } = await getAccess();
  if (!user || !can("orders")) return null;
  const db = (await createOperatorClient()) as unknown as SupabaseClient;
  const { data: jobRow } = await db.from("orders")
    .select("id, number, customer_contact, customer_contact_email, customer:customers!customer_id(name, email)").eq("id", jobId).maybeSingle();
  const job = jobRow as { id: string; number: string; customer_contact: string | null; customer_contact_email: string | null; customer: unknown } | null;
  if (!job) return null;
  const cust = one(job.customer as { name: string | null; email: string | null } | null);
  const margins = can("margins");
  const scope = can("mail") ? await getMailScope() : null;

  // pošta zakázky: vlákna, ve kterých je aspoň jedna přiřazená zpráva — jen co smím vidět
  let threads: ThreadSummary[] = [];
  let visibleEmailIds = new Set<string>();
  const visibleThreads = new Set<string>();
  let pendingFiles = 0;
  if (scope) {
    const { data: linkedRows } = await db.from("emails").select("thread_id").eq("order_id", jobId).not("thread_id", "is", null).limit(1000);
    const threadIds = [...new Set(((linkedRows ?? []) as { thread_id: string }[]).map((r) => r.thread_id))].slice(0, 200);
    if (threadIds.length) {
      const [{ data: rows }, { data: shares }] = await Promise.all([
        db.from("emails").select(MAIL_COLS).in("thread_id", threadIds).order("received_at", { ascending: false }).limit(1500),
        db.from("email_shares").select("thread_id, mailbox_id").eq("shared_with", scope.userId).in("thread_id", threadIds),
      ]);
      const sharedBoxes = new Map<string, Set<string>>();
      for (const s of (shares ?? []) as { thread_id: string; mailbox_id: string | null }[]) {
        const set = sharedBoxes.get(s.thread_id) ?? new Set<string>();
        set.add(shareKey(s.mailbox_id));
        sharedBoxes.set(s.thread_id, set);
      }
      const all = (rows ?? []) as unknown as MailRow[];
      const visible = all.filter((r) => visibleViaShare(scope, r, sharedBoxes.get(r.thread_id ?? "") ?? new Set()));
      const own = new Set(visible.filter((r) => scope.all || r.owner_id === scope.userId || (r.mailbox_id && scope.ownedMailboxIds.includes(r.mailbox_id))).map((r) => r.id));
      threads = threadsFromRows(visible, own, { id: job.id, number: job.number });
      visibleEmailIds = new Set(visible.map((r) => r.id));
      for (const r of visible) if (r.thread_id) visibleThreads.add(r.thread_id);
      const linkedIds = visible.filter((r) => r.order_id === jobId && r.has_attachments && !isSupplierInvoiceMail(r)).map((r) => r.id);
      if (linkedIds.length) {
        const { count } = await db.from("email_attachments").select("id", { count: "exact", head: true }).in("email_id", linkedIds.slice(0, 300)).is("job_file_id", null)
          .not("filename", "is", null);
        pendingFiles = count ?? 0;
      }
    }
  }

  // návrhy „Patří k této zakázce?" (vlákna, která smím vidět)
  const suggestions: JobMailSuggestionView[] = [];
  if (scope) {
    const { data: sg } = await db.from("email_job_suggestions").select("id, thread_id, score, reasons, email_id, created_at").eq("job_id", jobId).eq("status", "pending").limit(30);
    const list = (sg ?? []) as { id: string; thread_id: string; score: number; reasons: unknown; email_id: string | null; created_at: string }[];
    if (list.length) {
      const { data: em } = await db.from("emails").select("id, thread_id, owner_id, mailbox_id, subject, from_name, from_email, received_at, order_id")
        .in("thread_id", list.map((s) => s.thread_id)).order("received_at", { ascending: false }).limit(300);
      const rows = (em ?? []) as { id: string; thread_id: string; owner_id: string | null; mailbox_id: string | null; subject: string | null; from_name: string | null; from_email: string | null; received_at: string; order_id: string | null }[];
      for (const s of list) {
        const mine = rows.filter((r) => r.thread_id === s.thread_id && visibleViaShare(scope, r, new Set()));
        if (!mine.length) continue;
        // otázka k jedné zprávě vlákna jiné zakázky (odpověď jmenuje tuto zakázku): rozhoduje ta zpráva
        const own = s.email_id ? mine.find((r) => r.id === s.email_id) ?? null : null;
        if (own ? own.order_id : mine.some((r) => r.order_id)) continue;
        const m = own ?? mine[0];
        suggestions.push({
          id: s.id, threadId: s.thread_id, subject: clean(m.subject), from: clean(m.from_name) || clean(m.from_email) || "—", at: m.received_at,
          score: Number(s.score) || 0, reasons: Array.isArray(s.reasons) ? (s.reasons as unknown[]).filter((x): x is string => typeof x === "string") : [],
        });
      }
    }
  }

  // změny a upřesnění z e-mailů
  let cq = db.from("job_mail_changes")
    .select(`id, kind, field, summary, value_new, value_prev, drawing_value, quote, status, party, from_name, mail_at, order_item_id, email_id, applied_kind, created_at, sensitive, patch, prev, hold_reason, hold_job_number, value_mail_old, item:order_items!order_item_id(drawing_number, name, position, ${ITEM_VALUE_COLS}), email:emails!email_id(thread_id)`)
    .eq("job_id", jobId).order("created_at", { ascending: false }).limit(300);
  if (!margins) cq = cq.eq("sensitive", false);
  const { data: ch } = await cq;
  type ChRow = {
    id: string; kind: JobMailChangeView["kind"]; field: string; summary: string; value_new: string | null; value_prev: string | null; drawing_value: string | null;
    quote: string | null; status: JobMailChangeView["status"]; party: JobMailChangeView["party"]; from_name: string | null; mail_at: string | null;
    order_item_id: string | null; email_id: string | null; applied_kind: string | null; created_at: string; sensitive: boolean;
    patch: Record<string, unknown> | null; prev: Record<string, unknown> | null; hold_reason: string | null; hold_job_number: string | null; value_mail_old: string | null;
    item?: unknown; email?: unknown;
  };
  const changes: JobMailChangeView[] = ((ch ?? []) as ChRow[]).map((r) => {
    const item = one(r.item as ({ drawing_number: string | null; name: string | null; position: number | null } & Record<string, unknown>) | null);
    const thread = one(r.email as { thread_id: string | null } | null)?.thread_id ?? null;
    // citace z e-mailu jen tomu, kdo e-mail smí vidět (ostatní vidí shrnutí — technickou informaci zakázky)
    const mailVisible = Boolean(r.email_id && visibleEmailIds.has(r.email_id));
    // propsaná změna, jejíž hodnota už na položce není (ruční úprava kdekoli, smazaná položka) = nahrazeno
    const status: JobMailChangeView["status"] = r.kind === "change" && r.status === "applied" && r.patch && !changeHolds(r.field, r.patch, r.prev, item)
      ? "replaced" : r.status;
    return {
      id: r.id, kind: r.kind, field: r.field, label: isMailChangeField(r.field) ? FIELD_LABEL[r.field] : r.field, summary: r.summary,
      valueNew: r.value_new, valuePrev: r.value_prev, drawingValue: r.drawing_value, quote: mailVisible ? r.quote : null, status, party: r.party,
      hold: r.hold_reason === "other_job" || r.hold_reason === "mismatch" ? r.hold_reason : null, holdJobNumber: r.hold_job_number, mailOld: r.value_mail_old,
      // „Pokyn zákazníka … nadřazeno výkresu" jen u zákazníka zakázky (neznámý odesílatel = návrh bez odznaku)
      fromName: r.from_name, mailAt: r.mail_at, badge: r.kind === "change" && r.party === "customer" ? overrideBadgeText(mailDateLabel(r.mail_at)) : null,
      itemId: r.order_item_id, itemLabel: item ? clean([item.drawing_number, item.name].filter(Boolean).join(" · ")) || `Položka ${(item.position ?? 0) + 1}` : null,
      emailId: r.email_id, threadId: thread && visibleThreads.has(thread) && r.email_id && visibleEmailIds.has(r.email_id) ? thread : null,
      appliedKind: r.applied_kind, createdAt: r.created_at,
    };
  });

  return {
    jobId: job.id, jobNumber: job.number, canMail: Boolean(scope), threads, suggestions, changes,
    contact: { email: clean(job.customer_contact_email) || clean(cust?.email) || null, name: clean(job.customer_contact) || clean(cust?.name) || null },
    pendingFiles,
  };
}
