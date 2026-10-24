import "server-only";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAccess } from "@/lib/auth/session";
import type { PersonRef } from "@/lib/jobs/types";
import type { ChangeVia, DocIssuerKey, JobFileOrigin, OrderRevisionDecision } from "@/lib/supabase/database.types";
import {
  FLOW_ORDER_COLUMNS, FLOW_QUOTE_COLUMNS, deriveFlow, flowFactsFromRow, isLostReason, menuActions, nextAction,
  pragueToday, quoteDisplayState, quoteFactsFromRow, stampFromRow, transitionFeature, type ActionCtx, type ChangeStamp,
  type QuoteFacts,
} from "@/lib/jobs/flow-status";
import {
  CLOSED_JOB_KEYS, withinClosedWindow, quoteRowActions, type FileFlowInfo, type FlowJobState, type FlowQuoteInfo,
  type OrderRevisionView,
} from "@/components/flow/flow-state";
import type { FlowProposal } from "@/lib/supabase/database.types";
import { inScope, type FlowScope } from "@/lib/auth/flow-scope";

/**
 * Data stránek obchodního toku: podrobné stavy, další krok a „kdo · kdy“ pro řádky
 * Poptávek, Nacenění, Potvrzení a pro přehled Nabídek. Čte servisním klíčem — přihlášení
 * a práva ověří každá funkce sama; při chybě vrací prázdný výsledek (stránka se vykreslí).
 */

type Row = Record<string, unknown>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHUNK = 150;

function warn(scope: string, error: { message: string } | null | undefined) {
  if (error) console.error(`[data:flow-pages:${scope}] Supabase chyba: ${error.message}`);
}

async function session() {
  if (!isSupabaseConfigured()) return null;
  try {
    const access = await getAccess();
    if (!access.user || !access.user.active) return null;
    if (!access.can("workflow") && !access.can("orders")) return null;
    const db = await createOperatorClient();
    const ctx: ActionCtx = {
      can: access.can, userId: access.user.id, isSuperAdmin: access.user.role === "super_admin", assigneeId: null,
      // stránky toku umí dialog „Vrátit k přepracování…“ (FlowActionBar, #25)
      withReturn: true,
    };
    return { db, access, ctx };
  } catch (err) {
    console.error(`[data:flow-pages] ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function person(v: unknown): PersonRef | null {
  const p = (Array.isArray(v) ? v[0] : v) as { id?: string; full_name?: string | null; email?: string | null } | null | undefined;
  if (!p?.id) return null;
  return { id: p.id, name: (p.full_name ?? "").trim() || (p.email ?? "").trim() || "Bez jména" };
}

function chunks<T>(list: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const P = "(id, full_name, email)";
const JOB_STAMP_COLUMNS = [
  "stage_changed_at, stage_changed_by, stage_changed_via, stage_change_cause, stage_change_note",
  "inquiry_status_changed_at, inquiry_status_changed_by, inquiry_status_changed_via",
  "order_status_changed_by, order_status_changed_via, order_changed_at, order_changed_by",
  "confirmed_at, confirmed_by, confirmation_sent_at, confirmation_sent_by, confirmation_sent_via",
  "lost_at, lost_by, flow_proposal_at, flow_proposal_by",
  `assignee:profiles!assignee_id${P}`, `stager:profiles!stage_changed_by${P}`,
  `inq_by:profiles!inquiry_status_changed_by${P}`, `ord_by:profiles!order_status_changed_by${P}`,
  `chg_by:profiles!order_changed_by${P}`, `conf_by:profiles!confirmed_by${P}`, `csent_by:profiles!confirmation_sent_by${P}`,
  `lost_person:profiles!lost_by${P}`, `prop_by:profiles!flow_proposal_by${P}`,
].join(", ");

/** Podrobné stavy zakázek (id → stav). Neznámá / nedostupná id chybí. */
export async function getFlowJobStates(jobIds: string[]): Promise<Record<string, FlowJobState>> {
  const ids = [...new Set(jobIds.filter((id) => UUID_RE.test(id)))];
  if (!ids.length) return {};
  const s = await session();
  if (!s) return {};
  const out: Record<string, FlowJobState> = {};
  const today = pragueToday();
  try {
    for (const part of chunks(ids)) {
      const [jobs, quotes, sq, ops, pos] = await Promise.all([
        s.db.from("orders").select(`${FLOW_ORDER_COLUMNS}, owner_id, ${JOB_STAMP_COLUMNS}`).in("id", part),
        s.db.from("quotes").select(`${FLOW_QUOTE_COLUMNS}, creator:profiles!created_by${P}`).in("job_id", part),
        s.db.from("supplier_quotes").select("job_id").in("job_id", part).is("total", null),
        s.db.from("job_operations").select("job_id").in("job_id", part),
        s.db.from("purchase_orders").select("job_id").in("job_id", part).neq("status", "zrusena"),
      ]);
      warn("jobs", jobs.error);
      warn("quotes", quotes.error);
      warn("supplier-quotes", sq.error);
      const pending = new Map<string, number>();
      for (const r of (sq.data ?? []) as { job_id: string }[]) pending.set(r.job_id, (pending.get(r.job_id) ?? 0) + 1);
      const withOps = new Set(((ops.data ?? []) as { job_id: string }[]).map((r) => r.job_id));
      const withPos = new Set(((pos.data ?? []) as { job_id: string }[]).map((r) => r.job_id));
      const byJob = new Map<string, QuoteFacts[]>();
      // autor nabídky (toast „… schválena — {autor} ji teď může odeslat.“)
      const authors = new Map<string, string | null>();
      for (const r of (quotes.data ?? []) as Row[]) {
        const jid = String(r.job_id);
        byJob.set(jid, [...(byJob.get(jid) ?? []), quoteFactsFromRow(r)]);
        authors.set(String(r.id), person(r.creator)?.name ?? null);
      }
      for (const r of (jobs.data ?? []) as Row[]) {
        const id = String(r.id);
        const assignee = person(r.assignee);
        const facts = flowFactsFromRow(r, {
          pendingSupplierQuotes: pending.get(id) ?? 0, hasOperations: withOps.has(id), hasPurchaseOrders: withPos.has(id),
          assigneeName: assignee?.name ?? null,
        });
        const qs = byJob.get(id) ?? [];
        const snapshot = deriveFlow(facts, qs, today);
        // obchodník i řešitel zakázky smí odeslat schválenou nabídku (stejně jako server a karta zakázky)
        const ctx: ActionCtx = {
          ...s.ctx, assigneeId: facts.assigneeId ?? null, assigneeName: assignee?.name ?? null,
          ownerId: typeof r.owner_id === "string" ? r.owner_id : null,
        };
        const proposal = r.flow_proposal ? stampFromRow(r, "flow_proposal", person(r.prop_by)) : null;
        if (proposal && (r.flow_proposal as FlowProposal).kind === "ai") proposal.kind = "ai";
        out[id] = {
          jobId: id,
          facts,
          snapshot,
          quotes: qs,
          quoteAuthor: snapshot.activeQuote ? authors.get(snapshot.activeQuote.id) ?? null : null,
          stamps: {
            stage: stampFromRow(r, "stage_changed", person(r.stager)),
            inquiry: stampFromRow(r, "inquiry_status_changed", person(r.inq_by)),
            order: stampFromRow(r, "order_status_changed", person(r.ord_by)),
            orderChange: stampFromRow(r, "order_changed", person(r.chg_by)),
            confirmed: r.confirmed_at ? stampFromRow(r, "confirmed", person(r.conf_by)) : null,
            confirmationSent: stampFromRow(r, "confirmation_sent", person(r.csent_by)),
            lost: stampFromRow(r, "lost", person(r.lost_person)),
            proposal,
          },
          next: nextAction(facts, snapshot, ctx),
          menu: menuActions(facts, snapshot, ctx),
          canDecideProposal: facts.proposal ? s.access.can(transitionFeature(facts.proposal.phase, facts.proposal.to)) : false,
        };
      }
    }
  } catch (err) {
    console.error(`[data:flow-pages:states] ${err instanceof Error ? err.message : String(err)}`);
  }
  return out;
}

const VIEW_COLUMN = { inquiry: "inquiry_key", pricing: "pricing_key", order: "order_key", fulfilment: "fulfilment_key" } as const;
export type FlowListPhase = keyof typeof VIEW_COLUMN;

/**
 * Id zakázek s vybranými dílčími stavy (job_flow_v). Uzavřené stavy jen za posledních
 * 30 dní podle změny hlavního stavu — stejně jako počty chipů (flow_counts).
 * null = podrobné stavy nejsou k dispozici (chyba DB) → stránka použije hlavní stav.
 */
export async function listFlowStateJobIds(
  filter: { phase: FlowListPhase; keys: string[] }[],
  opts: { scope?: FlowScope | null } = {},
): Promise<Set<string> | null> {
  const out = new Set<string>();
  // #25: s rozsahem jen „moje" (bez přístupu / chyba rozsahu = nic)
  if ("scope" in opts && (!opts.scope || (!opts.scope.all && opts.scope.error))) return new Set();
  const mine = opts.scope && !opts.scope.all ? opts.scope : null;
  const s = await session();
  if (!s) return null;
  const now = Date.now();
  try {
    for (const f of filter) {
      const keys = f.keys.filter((k) => /^[a-z_]{1,40}$/.test(k));
      if (!keys.length) continue;
      const col = VIEW_COLUMN[f.phase];
      // „moje": id vtlačená do dotazu po dávkách (žádné oříznutí cizími řádky)
      const parts: (string[] | null)[] = mine ? chunks([...mine.jobIds], 200) : [null];
      for (const part of parts) {
        let q = s.db.from("job_flow_v").select(`id, stage_changed_at, ${col}`).in(col, keys);
        if (part) q = q.in("id", part);
        const { data, error } = await q.limit(5000);
        warn("ids", error);
        if (error) return null;
        for (const r of (data ?? []) as Row[]) {
          const key = String(r[col]);
          if (CLOSED_JOB_KEYS.includes(key) && !withinClosedWindow(r.stage_changed_at as string | null, now)) continue;
          if (mine && !inScope(mine, String(r.id))) continue;
          out.add(String(r.id));
        }
      }
    }
  } catch (err) {
    console.error(`[data:flow-pages:ids] ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  return out;
}

// ── Nabídky (přehled /quotes) ───────────────────────────────
export type { FlowQuoteInfo, OrderRevisionView };


const QUOTE_INFO_COLUMNS = [
  FLOW_QUOTE_COLUMNS,
  "state_changed_at, state_changed_by, state_changed_via, approval_requested_by, approved_at, sent_by, sent_via",
  "accepted_at, accepted_by, rejected_at, rejected_by, lost_reason, rejected_reason, competitor_price, feedback, feedback_at",
  `creator:profiles!created_by${P}`, `requester:profiles!approval_requested_by${P}`, `approver:profiles!approved_by${P}`,
  `sender:profiles!sent_by${P}`, `acceptor:profiles!accepted_by${P}`, `rejector:profiles!rejected_by${P}`,
].join(", ");

function at(r: Row, key: string): string | null {
  return typeof r[key] === "string" && r[key] ? (r[key] as string) : null;
}

/** Stav, „kdo · kdy“ a akce nabídek (id → info). */
export async function getFlowQuoteInfo(quoteIds: string[]): Promise<Record<string, FlowQuoteInfo>> {
  const ids = [...new Set(quoteIds.filter((id) => UUID_RE.test(id)))];
  if (!ids.length) return {};
  const s = await session();
  if (!s) return {};
  const margins = s.access.can("margins");
  const today = pragueToday();
  const out: Record<string, FlowQuoteInfo> = {};
  try {
    for (const part of chunks(ids)) {
      const { data, error } = await s.db.from("quotes").select(QUOTE_INFO_COLUMNS).in("id", part);
      warn("quote-info", error);
      const rows = (data ?? []) as Row[];
      const jobIds = [...new Set(rows.map((r) => r.job_id).filter((v): v is string => typeof v === "string"))];
      const proposals = new Map<string, { value: FlowProposal; stamp: ChangeStamp | null }>();
      // obchodník a řešitel zakázky — smí odeslat schválenou nabídku (quoteSendBlock jako server / karta)
      const jobPeople = new Map<string, { ownerId: string | null; assigneeId: string | null }>();
      if (jobIds.length) {
        const { data: people, error: pErr } = await s.db.from("orders").select("id, owner_id, assignee_id").in("id", jobIds);
        warn("quote-job-people", pErr);
        for (const j of (people ?? []) as { id: string; owner_id: string | null; assignee_id: string | null }[]) {
          jobPeople.set(j.id, { ownerId: j.owner_id ?? null, assigneeId: j.assignee_id ?? null });
        }
      }
      if (jobIds.length) {
        const { data: jobs, error: jErr } = await s.db.from("orders")
          .select(`id, flow_proposal, flow_proposal_at, flow_proposal_by, prop_by:profiles!flow_proposal_by${P}`)
          .in("id", jobIds).not("flow_proposal", "is", null);
        warn("quote-proposals", jErr);
        for (const j of (jobs ?? []) as Row[]) {
          const value = j.flow_proposal as FlowProposal;
          if (value?.phase !== "quote" || !value.quoteId) continue;
          const stamp = stampFromRow(j, "flow_proposal", person(j.prop_by));
          if (stamp && value.kind === "ai") stamp.kind = "ai";
          proposals.set(value.quoteId, { value, stamp });
        }
      }
      // aktuální verze = nearchivovaná s nejvyšší revizí v zakázce
      const latest = new Map<string, number>();
      for (const r of rows) {
        if (typeof r.job_id !== "string" || r.archived === true) continue;
        latest.set(r.job_id, Math.max(latest.get(r.job_id) ?? 0, Number(r.revision) || 1));
      }
      for (const r of rows) {
        const facts = quoteFactsFromRow(r);
        const display = quoteDisplayState(facts, today);
        const hasJob = typeof r.job_id === "string";
        const current = hasJob && !facts.archived && (latest.get(r.job_id as string) ?? 0) <= facts.revision;
        const jp = hasJob ? jobPeople.get(r.job_id as string) : undefined;
        const { next, menu } = quoteRowActions({
          quote: facts, display, hasJob, current, jobOwnerId: jp?.ownerId ?? null, jobAssigneeId: jp?.assigneeId ?? null,
        }, s.ctx);
        const via = at(r, "sent_via") as ChangeVia | null;
        const p = proposals.get(facts.id);
        out[facts.id] = {
          id: facts.id,
          facts,
          display,
          stateChangedAt: at(r, "state_changed_at"),
          lostReason: isLostReason(r.lost_reason) ? r.lost_reason : null,
          rejectedReason: at(r, "rejected_reason"),
          feedback: at(r, "feedback"),
          competitorPrice: margins && r.competitor_price !== null && r.competitor_price !== undefined ? Number(r.competitor_price) : null,
          stamps: {
            created: stampFromRow({ created_at: r.created_at, created_by: r.created_by }, "created", person(r.creator)),
            approvalRequested: stampFromRow({ x_at: r.approval_requested_at, x_by: r.approval_requested_by }, "x", person(r.requester)),
            approved: stampFromRow({ x_at: r.approved_at, x_by: r.approved_by }, "x", person(r.approver)),
            sent: r.sent_at ? stampFromRow({ x_at: r.sent_at, x_by: r.sent_by, x_via: via }, "x", person(r.sender)) : null,
            accepted: stampFromRow({ x_at: r.accepted_at, x_by: r.accepted_by }, "x", person(r.acceptor)),
            rejected: stampFromRow({ x_at: r.rejected_at, x_by: r.rejected_by }, "x", person(r.rejector)),
          },
          next,
          menu,
          proposal: p ? { ...p, canDecide: s.access.can(transitionFeature("quote", p.value.to)) } : null,
        };
      }
    }
  } catch (err) {
    console.error(`[data:flow-pages:quotes] ${err instanceof Error ? err.message : String(err)}`);
  }
  return out;
}

// ── Revize objednávky (rozdíl proti předchozí, minor 14) ─────

const PRICE_FIELD = /(price|cena|cen[ay]|value|hodnota|total|castka|částka|amount|cost)/i;

function shown(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "object") return JSON.stringify(v).slice(0, 200);
  return String(v).slice(0, 200);
}

/** Poslední revize objednávky (rev > 1) u vybraných zakázek; ceny jen s právem na marže. */
export async function getLatestOrderRevisions(jobIds: string[]): Promise<Record<string, OrderRevisionView>> {
  const ids = [...new Set(jobIds.filter((id) => UUID_RE.test(id)))];
  if (!ids.length) return {};
  const s = await session();
  if (!s) return {};
  const margins = s.access.can("margins");
  const out: Record<string, OrderRevisionView> = {};
  try {
    for (const part of chunks(ids)) {
      const { data, error } = await s.db.from("job_order_revisions")
        .select(`job_id, revision, customer_order_number, changes, note, decision, created_at, created_by, created_via, creator:profiles!created_by${P}`)
        .in("job_id", part).gt("revision", 1).order("revision", { ascending: false });
      warn("revisions", error);
      for (const r of (data ?? []) as Row[]) {
        const jid = String(r.job_id);
        if (out[jid]) continue;
        const raw = (Array.isArray(r.changes) ? r.changes : []) as { field?: unknown; label?: unknown; from?: unknown; to?: unknown }[];
        const changes = raw
          .map((c) => ({ field: String(c.field ?? "jine"), label: String(c.label ?? "Změna"), from: shown(c.from), to: shown(c.to) }))
          .filter((c) => margins || !PRICE_FIELD.test(`${c.field} ${c.label}`));
        out[jid] = {
          revision: Number(r.revision),
          decision: (r.decision as OrderRevisionDecision) ?? "ceka",
          note: at(r, "note"),
          customerOrderNumber: at(r, "customer_order_number"),
          changes,
          created: {
            by: person(r.creator), byName: null, at: String(r.created_at),
            via: (at(r, "created_via") as ChangeVia | null), kind: r.created_by ? "user" : "system",
          },
        };
      }
    }
  } catch (err) {
    console.error(`[data:flow-pages:revisions] ${err instanceof Error ? err.message : String(err)}`);
  }
  return out;
}

// ── Dokumenty: původ, kdo nahrál a archivoval ───────────────
const ORIGINS: JobFileOrigin[] = ["generated", "upload", "capture", "email", "import"];
const ISSUERS: DocIssuerKey[] = ["my", "zakaznik", "dodavatel"];

export async function getFileFlowInfo(fileIds: string[]): Promise<Record<string, FileFlowInfo>> {
  const ids = [...new Set(fileIds.filter((id) => UUID_RE.test(id)))];
  if (!ids.length) return {};
  const s = await session();
  if (!s) return {};
  const out: Record<string, FileFlowInfo> = {};
  try {
    for (const part of chunks(ids, 300)) {
      const { data, error } = await s.db.from("job_files")
        .select(`id, origin, issuer, order_revision, created_at, uploaded_by, archived_at, archived_by, uploader:profiles!uploaded_by${P}, archiver:profiles!archived_by${P}`)
        .in("id", part);
      warn("files", error);
      for (const r of (data ?? []) as Row[]) {
        const origin = ORIGINS.includes(r.origin as JobFileOrigin) ? (r.origin as JobFileOrigin) : null;
        out[String(r.id)] = {
          origin,
          issuer: ISSUERS.includes(r.issuer as DocIssuerKey) ? (r.issuer as DocIssuerKey) : null,
          orderRevision: typeof r.order_revision === "number" ? r.order_revision : null,
          uploaded: stampFromRow({ x_at: r.created_at, x_by: r.uploaded_by, x_via: origin === "capture" ? "foto" : origin === "email" ? "email" : null }, "x", person(r.uploader)),
          archived: r.archived_at ? stampFromRow({ x_at: r.archived_at, x_by: r.archived_by }, "x", person(r.archiver)) : null,
        };
      }
    }
  } catch (err) {
    console.error(`[data:flow-pages:files] ${err instanceof Error ? err.message : String(err)}`);
  }
  return out;
}
