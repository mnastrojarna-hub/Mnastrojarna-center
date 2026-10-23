import "server-only";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAccess } from "@/lib/auth/session";
import type { Feature } from "@/lib/auth/permissions";
import type { PersonRef } from "@/lib/jobs/types";
import type { ActorKind, ChangeVia, JobStage, OrderRevisionDecision } from "@/lib/supabase/database.types";
import { isJobStage } from "@/lib/jobs/stages";
import {
  FLOW_ORDER_COLUMNS, FLOW_QUOTE_COLUMNS, deriveFlow, flowFactsFromRow, quoteFactsFromRow, stampFromRow,
  type ChangeStamp, type FlowFacts, type FlowPhase, type FlowSnapshot, type JobStamps, type QuoteFacts,
} from "@/lib/jobs/flow-status";

/**
 * Čtení podrobných stavů toku a „kdo · kdy“ — servisním klíčem (obchází RLS), proto každá
 * funkce sama ověří přihlášení a právo. Při chybě vrací prázdný / null výsledek.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Row = Record<string, unknown>;

function warn(scope: string, error: { message: string } | null | undefined) {
  if (error) console.error(`[data:flow:${scope}] Supabase chyba: ${error.message}`);
}

async function session(...features: Feature[]) {
  if (!isSupabaseConfigured()) return null;
  try {
    const access = await getAccess();
    if (!access.user || !access.user.active) return null;
    if (features.length && !features.some((f) => access.can(f))) return null;
    const db = await createOperatorClient();
    return { db, access, user: access.user, margins: access.can("margins") };
  } catch (err) {
    console.error(`[data:flow] ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function person(v: unknown): PersonRef | null {
  const p = (Array.isArray(v) ? v[0] : v) as { id?: string; full_name?: string | null; email?: string | null } | null | undefined;
  if (!p?.id) return null;
  return { id: p.id, name: (p.full_name ?? "").trim() || (p.email ?? "").trim() || "Bez jména" };
}

// ── Počty chipů ─────────────────────────────────────────────
/**
 * „fáze.klíč“ → počet (rpc flow_counts; uzavřené stavy jen za posledních closedDays dní).
 * mine (#25) = jen „moje" zakázky a nabídky toho uživatele (mineParam(scope)); null / bez = všichni.
 */
export async function getFlowCounts(
  opts: { ownerId?: string | null; closedDays?: number; mine?: string | null } = {},
): Promise<Record<string, number>> {
  const s = await session("orders", "workflow");
  if (!s) return {};
  if (opts.ownerId && !UUID_RE.test(opts.ownerId)) return {};
  if (opts.mine && !UUID_RE.test(opts.mine)) return {};
  try {
    const { data, error } = await s.db.rpc("flow_counts", {
      p_owner: opts.ownerId ?? null,
      p_closed_days: opts.closedDays ?? 30,
      p_mine: opts.mine ?? null,
    });
    warn("counts", error);
    const out: Record<string, number> = {};
    for (const r of (data ?? []) as { flow_phase: string; flow_key: string; n: number }[]) {
      out[`${r.flow_phase}.${r.flow_key}`] = Number(r.n) || 0;
    }
    return out;
  } catch (err) {
    console.error(`[data:flow:counts] ${err instanceof Error ? err.message : String(err)}`);
    return {};
  }
}

// ── Stav jedné zakázky ──────────────────────────────────────
async function loadFlow(db: Awaited<ReturnType<typeof createOperatorClient>>, jobId: string) {
  const [job, quotes, sq, ops, pos] = await Promise.all([
    db.from("orders").select(`${FLOW_ORDER_COLUMNS}, assignee:profiles!assignee_id(id, full_name, email)`).eq("id", jobId).maybeSingle(),
    db.from("quotes").select(FLOW_QUOTE_COLUMNS).eq("job_id", jobId),
    db.from("supplier_quotes").select("id", { count: "exact", head: true }).eq("job_id", jobId).is("total", null),
    db.from("job_operations").select("id", { count: "exact", head: true }).eq("job_id", jobId),
    db.from("purchase_orders").select("id", { count: "exact", head: true }).eq("job_id", jobId).neq("status", "zrusena"),
  ]);
  warn("job", job.error);
  warn("quotes", quotes.error);
  if (!job.data) return null;
  const row = job.data as Row;
  const facts = flowFactsFromRow(row, {
    pendingSupplierQuotes: sq.count ?? 0,
    hasOperations: (ops.count ?? 0) > 0,
    hasPurchaseOrders: (pos.count ?? 0) > 0,
    assigneeName: person(row.assignee)?.name ?? null,
  });
  const qs = ((quotes.data ?? []) as Row[]).map(quoteFactsFromRow);
  return { facts, quotes: qs };
}

export async function getJobFlow(jobId: string): Promise<{ facts: FlowFacts; snapshot: FlowSnapshot; quotes: QuoteFacts[] } | null> {
  if (!UUID_RE.test(jobId)) return null;
  const s = await session("orders", "workflow");
  if (!s) return null;
  try {
    const f = await loadFlow(s.db, jobId);
    if (!f) return null;
    return { facts: f.facts, quotes: f.quotes, snapshot: deriveFlow(f.facts, f.quotes) };
  } catch (err) {
    console.error(`[data:flow:job] ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

const VIEW_COLUMN: Partial<Record<FlowPhase, string>> = {
  inquiry: "inquiry_key", pricing: "pricing_key", quote: "quote_key", order: "order_key", fulfilment: "fulfilment_key",
  confirmation: "confirmation_key", delivery: "delivery_key", payment: "payment_key",
};

/** Id zakázek s daným dílčím stavem (filtry Knihy a stránek toku). phase „proposal“ = čekající návrh. */
export async function listFlowJobIds(filter: { phase: FlowPhase; keys: string[]; ownerId?: string | null }): Promise<string[]> {
  const s = await session("orders", "workflow");
  if (!s) return [];
  if (filter.ownerId && !UUID_RE.test(filter.ownerId)) return [];
  try {
    let q = s.db.from("job_flow_v").select("id");
    if (filter.phase === "proposal") q = q.eq("has_proposal", true);
    else {
      const col = VIEW_COLUMN[filter.phase];
      const keys = filter.keys.filter((k) => /^[a-z_]{1,40}$/.test(k));
      if (!col || !keys.length) return [];
      q = q.in(col, keys);
    }
    if (filter.ownerId) q = q.eq("owner_id", filter.ownerId);
    const { data, error } = await q.limit(5000);
    warn("ids", error);
    return ((data ?? []) as { id: string }[]).map((r) => r.id);
  } catch (err) {
    console.error(`[data:flow:ids] ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

// ── Kdo · kdy ───────────────────────────────────────────────
const STAMP_SELECT = [
  "id, status, stage_changed_at, stage_changed_by, stage_changed_via, stage_change_cause, stage_change_note",
  "inquiry_status_changed_at, inquiry_status_changed_by, inquiry_status_changed_via",
  "order_status_changed_at, order_status_changed_by, order_status_changed_via",
  "confirmed_at, confirmed_by, confirmation_sent_at, confirmation_sent_by, confirmation_sent_via",
  "delivery_note_confirmed_at, delivery_note_confirmed_by, invoiced_at, invoiced_by, paid_at, paid_by",
  "lost_at, lost_by, flow_proposal, flow_proposal_at, flow_proposal_by",
  "stager:profiles!stage_changed_by(id, full_name, email)",
  "inq_by:profiles!inquiry_status_changed_by(id, full_name, email)",
  "ord_by:profiles!order_status_changed_by(id, full_name, email)",
  "conf_by:profiles!confirmed_by(id, full_name, email)",
  "csent_by:profiles!confirmation_sent_by(id, full_name, email)",
  "dn_by:profiles!delivery_note_confirmed_by(id, full_name, email)",
  "inv_by:profiles!invoiced_by(id, full_name, email)",
  "paid_person:profiles!paid_by(id, full_name, email)",
  "lost_person:profiles!lost_by(id, full_name, email)",
  "prop_by:profiles!flow_proposal_by(id, full_name, email)",
].join(", ");

interface EventRow {
  id: string;
  type: string;
  message: string;
  data: Record<string, unknown> | null;
  actor_id: string | null;
  actor_kind: ActorKind | null;
  actor_name: string | null;
  via: ChangeVia | null;
  agent: string | null;
  entity: string | null;
  created_at: string;
  actor?: unknown;
}

const EVENT_SELECT = "id, type, message, data, actor_id, actor_kind, actor_name, via, agent, entity, created_at, actor:profiles!actor_id(id, full_name, email)";

/** Razítko z události historie (druh autora, agent a jméno uložené v době zápisu). */
export function stampFromEvent(e: EventRow): ChangeStamp {
  const data = e.data ?? {};
  return {
    by: person(e.actor),
    byName: e.actor_name ?? null,
    at: e.created_at,
    via: e.via ?? null,
    kind: e.actor_kind ?? (e.actor_id ? "user" : "system"),
    agent: e.agent ?? null,
    cause: typeof data.cause === "string" ? data.cause : null,
    note: typeof data.note === "string" ? data.note : null,
  };
}

/** Atribuční sloupce zakázky + poslední události stavů (časová osa). */
export async function getJobStamps(jobId: string): Promise<JobStamps | null> {
  if (!UUID_RE.test(jobId)) return null;
  const s = await session("orders", "workflow");
  if (!s) return null;
  try {
    const [job, ev] = await Promise.all([
      s.db.from("orders").select(STAMP_SELECT).eq("id", jobId).maybeSingle(),
      s.db.from("job_events").select(EVENT_SELECT).eq("job_id", jobId).in("type", ["stage", "status"])
        .order("created_at", { ascending: false }).limit(300),
    ]);
    warn("stamps", job.error);
    warn("stamp-events", ev.error);
    if (!job.data) return null;
    const r = job.data as Row;
    const events = (ev.data ?? []) as EventRow[];

    const stageHistory: Partial<Record<JobStage, ChangeStamp>> = {};
    for (const e of events) {
      const to = e.type === "stage" ? e.data?.to : null;
      if (isJobStage(to) && !stageHistory[to]) stageHistory[to] = stampFromEvent(e);
    }
    const latestStatus = (field: string) => events.find((e) => e.type === "status" && e.data?.field === field) ?? null;
    /** Sloupce dávají kdo/kdy; událost doplní druh (AI), agenta a jméno smazaného účtu. */
    const merge = (col: ChangeStamp | null, e: EventRow | null): ChangeStamp | null => {
      if (!col && !e) return null;
      if (!e) return col;
      const fromEvent = stampFromEvent(e);
      if (!col) return fromEvent;
      const sameMoment = col.at && Math.abs(Date.parse(col.at) - Date.parse(e.created_at)) < 5_000;
      return sameMoment ? { ...fromEvent, ...col, by: col.by ?? fromEvent.by, byName: col.byName ?? fromEvent.byName,
        kind: fromEvent.kind, agent: fromEvent.agent, note: col.note ?? fromEvent.note } : col;
    };
    const stageCol = stampFromRow(r, "stage_changed", person(r.stager));
    const stageEvent = isJobStage(r.status) ? events.find((e) => e.type === "stage" && e.data?.to === r.status) ?? null : null;
    const proposal = r.flow_proposal ? stampFromRow(r, "flow_proposal", person(r.prop_by)) : null;
    if (proposal && (r.flow_proposal as { kind?: string }).kind === "ai") proposal.kind = "ai";

    return {
      stage: merge(stageCol, stageEvent),
      inquiry: merge(stampFromRow(r, "inquiry_status_changed", person(r.inq_by)), latestStatus("inquiry_status")),
      order: merge(stampFromRow(r, "order_status_changed", person(r.ord_by)), latestStatus("order_status")),
      confirmed: r.confirmed_at ? stampFromRow(r, "confirmed", person(r.conf_by)) : null,
      confirmationSent: stampFromRow(r, "confirmation_sent", person(r.csent_by)),
      deliveryNote: stampFromRow({ delivery_note_at: r.delivery_note_confirmed_at, delivery_note_by: r.delivery_note_confirmed_by }, "delivery_note", person(r.dn_by)),
      invoiced: stampFromRow(r, "invoiced", person(r.inv_by)),
      paid: stampFromRow(r, "paid", person(r.paid_person)),
      lost: stampFromRow(r, "lost", person(r.lost_person)),
      proposal,
      stageHistory,
    };
  } catch (err) {
    console.error(`[data:flow:stamps] ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** „změnil X · kdy“ u klíčových polí (M12): poslední událost `field`, jejíž data.changes obsahuje sloupec. */
export async function getFieldStamps(jobId: string, columns: string[]): Promise<Record<string, ChangeStamp>> {
  if (!UUID_RE.test(jobId) || !columns.length) return {};
  const s = await session("orders", "workflow");
  if (!s) return {};
  try {
    const { data, error } = await s.db.from("job_events").select(EVENT_SELECT).eq("job_id", jobId).eq("type", "field")
      .not("data->changes", "is", null).order("created_at", { ascending: false }).limit(1000);
    warn("field-stamps", error);
    const out: Record<string, ChangeStamp> = {};
    const wanted = new Set(columns);
    for (const e of (data ?? []) as EventRow[]) {
      const changes = Array.isArray(e.data?.changes) ? (e.data!.changes as { field?: unknown }[]) : [];
      for (const c of changes) {
        const field = typeof c?.field === "string" ? c.field : null;
        if (field && wanted.has(field) && !out[field]) out[field] = stampFromEvent(e);
      }
      if (Object.keys(out).length === wanted.size) break;
    }
    return out;
  } catch (err) {
    console.error(`[data:flow:field-stamps] ${err instanceof Error ? err.message : String(err)}`);
    return {};
  }
}

// ── Úhrady a revize objednávky ──────────────────────────────
export interface JobPayment {
  id: string;
  paidOn: string;
  /** Bez práva na marže vždy null (jen „úhrada“). */
  amount: number | null;
  /** Celá / zbývající částka (amount v DB je null). */
  whole: boolean;
  settles: boolean;
  note: string | null;
  stamp: ChangeStamp;
}

export async function listJobPayments(jobId: string): Promise<JobPayment[]> {
  if (!UUID_RE.test(jobId)) return [];
  const s = await session("orders");
  if (!s) return [];
  try {
    const { data, error } = await s.db.from("job_payments")
      .select("id, paid_on, amount, settles, note, recorded_name, via, created_at, recorded_by, recorder:profiles!recorded_by(id, full_name, email)")
      .eq("job_id", jobId).order("paid_on").order("created_at");
    warn("payments", error);
    return ((data ?? []) as Row[]).map((r) => ({
      id: String(r.id),
      paidOn: String(r.paid_on),
      amount: s.margins && r.amount !== null && r.amount !== undefined ? Number(r.amount) : null,
      whole: r.amount === null || r.amount === undefined,
      settles: r.settles === true,
      note: typeof r.note === "string" ? r.note : null,
      stamp: {
        by: person(r.recorder),
        byName: typeof r.recorded_name === "string" ? r.recorded_name : null,
        at: String(r.created_at),
        via: (r.via as ChangeVia) ?? null,
        kind: r.recorded_by ? "user" : r.via === "ai" ? "ai" : "system",
      },
    }));
  } catch (err) {
    console.error(`[data:flow:payments] ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

export interface OrderRevision {
  id: string;
  revision: number;
  customerOrderNumber: string | null;
  fileId: string | null;
  /** Rozdíly proti předchozí revizi; ceny jen s právem na marže. */
  changes: { field: string; label: string; from: unknown; to: unknown }[];
  note: string | null;
  decision: OrderRevisionDecision;
  decided: ChangeStamp | null;
  decisionNote: string | null;
  created: ChangeStamp;
}

const PRICE_FIELD = /(price|cena|cen[ay]|value|hodnota|total|castka|částka|amount|cost)/i;

export async function listOrderRevisions(jobId: string): Promise<OrderRevision[]> {
  if (!UUID_RE.test(jobId)) return [];
  const s = await session("orders", "workflow");
  if (!s) return [];
  try {
    const { data, error } = await s.db.from("job_order_revisions")
      .select("id, revision, customer_order_number, file_id, changes, note, decision, decided_at, decided_by, decision_note, created_by, created_via, created_at, creator:profiles!created_by(id, full_name, email), decider:profiles!decided_by(id, full_name, email)")
      .eq("job_id", jobId).order("revision");
    warn("revisions", error);
    return ((data ?? []) as Row[]).map((r) => {
      const changes = (Array.isArray(r.changes) ? r.changes : []) as { field: string; label: string; from: unknown; to: unknown }[];
      return {
        id: String(r.id),
        revision: Number(r.revision),
        customerOrderNumber: typeof r.customer_order_number === "string" ? r.customer_order_number : null,
        fileId: typeof r.file_id === "string" ? r.file_id : null,
        changes: s.margins ? changes : changes.filter((c) => !PRICE_FIELD.test(`${c.field} ${c.label}`)),
        note: typeof r.note === "string" ? r.note : null,
        decision: (r.decision as OrderRevisionDecision) ?? "ceka",
        decided: r.decided_at ? {
          by: person(r.decider), byName: null, at: String(r.decided_at), via: null, kind: r.decided_by ? "user" : "system",
        } : null,
        decisionNote: typeof r.decision_note === "string" ? r.decision_note : null,
        created: {
          by: person(r.creator), byName: null, at: String(r.created_at),
          via: (r.created_via as ChangeVia) ?? null, kind: r.created_by ? "user" : "system",
        },
      };
    });
  } catch (err) {
    console.error(`[data:flow:revisions] ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

// ── Kdo co posunul (dashboard, filtr „Změnil“) ──────────────
export interface FlowActivityItem {
  id: string;
  jobId: string;
  jobNumber: string | null;
  jobTitle: string | null;
  type: "stage" | "status";
  entity: string | null;
  message: string;
  stamp: ChangeStamp;
}

/** Změny stavů (stage/status). Super admin vše; ostatní jen zakázky, kde jsou vlastník / řešitel / zadavatel. */
export async function listFlowActivity(opts: { actorId?: string; since?: string; limit?: number } = {}): Promise<FlowActivityItem[]> {
  const s = await session("orders");
  if (!s) return [];
  if (opts.actorId && !UUID_RE.test(opts.actorId)) return [];
  try {
    const limit = Math.min(Math.max(Math.floor(opts.limit ?? 100), 1), 500);
    let jobIds: string[] | null = null;
    if (s.user.role !== "super_admin") {
      const me = s.user.id;
      const { data, error } = await s.db.from("orders").select("id")
        .or(`owner_id.eq.${me},assignee_id.eq.${me},created_by.eq.${me}`).limit(5000);
      warn("activity-jobs", error);
      jobIds = ((data ?? []) as { id: string }[]).map((r) => r.id);
      if (!jobIds.length) return [];
    }
    let q = s.db.from("job_events").select(`${EVENT_SELECT}, job_id, job:orders!job_id(number, title)`).in("type", ["stage", "status"]);
    if (opts.actorId) q = q.eq("actor_id", opts.actorId);
    if (opts.since && !Number.isNaN(Date.parse(opts.since))) q = q.gte("created_at", new Date(opts.since).toISOString());
    if (jobIds) q = q.in("job_id", jobIds.slice(0, 1000));
    const { data, error } = await q.order("created_at", { ascending: false }).limit(limit);
    warn("activity", error);
    return ((data ?? []) as (EventRow & { job_id: string; job?: unknown })[]).map((e) => {
      const job = (Array.isArray(e.job) ? e.job[0] : e.job) as { number?: string | null; title?: string | null } | null;
      return {
        id: e.id,
        jobId: e.job_id,
        jobNumber: job?.number ?? null,
        jobTitle: job?.title ?? null,
        type: e.type === "status" ? "status" : "stage",
        entity: e.entity ?? null,
        message: e.message,
        stamp: stampFromEvent(e),
      };
    });
  } catch (err) {
    console.error(`[data:flow:activity] ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}
