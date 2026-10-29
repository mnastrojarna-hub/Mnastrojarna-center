import "server-only";
import type { JobsDb } from "@/lib/jobs/events";
import { isUuid } from "@/lib/jobs/mapping";
import { isJobStage } from "@/lib/jobs/stages";
import type { JobStage } from "@/lib/supabase/database.types";
import {
  MERGE_REASON_ORDER, cleanMergeQuery, drawingKey, drawingLikePattern, mergeCandidateScore, rankMergeCandidates,
  type MergeCandidate, type MergeCandidateReason, type MergeConflict, type MergeErrorCode, type MergePreview, type MergeResult,
} from "@/lib/jobs/job-merge-types";

/**
 * Sloučení zakázek (#24) — serverová vrstva nad RPC merge_jobs_preview / merge_jobs.
 * Co se přesouvá a co vyhrává, rozhoduje DB (jedna pravda pro náhled i sloučení); tady jen
 * mapování, hledání kandidátů a překlad chyb. Klient DB nese autora (hlavičky) → oprávnění
 * (super admin vždy, obchodník jen své zakázky) ověří DB podle app_actor().
 */

type RpcError = { message: string; hint?: string | null; code?: string | null };

const CLOSED: JobStage[] = ["nerealizovano", "zruseno", "dokonceno"];

function stageOf(v: unknown): JobStage {
  return isJobStage(v) ? v : "poptavka";
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

type Raw = Record<string, unknown>;

function ref(r: Raw | null | undefined) {
  const x = r ?? {};
  return {
    id: String(x.id ?? ""), number: String(x.number ?? ""), title: String(x.title ?? ""), stage: stageOf(x.stage),
    customerId: str(x.customerId), customer: str(x.customer), customerOrderNumber: str(x.customerOrderNumber),
    value: num(x.value), createdAt: String(x.createdAt ?? ""),
  };
}

function conflicts(v: unknown): MergeConflict[] {
  if (!Array.isArray(v)) return [];
  return v.filter((c): c is Raw => !!c && typeof c === "object").map((c) => ({
    code: String(c.code ?? ""), level: (["block", "force", "warn", "info"].includes(String(c.level)) ? c.level : "warn") as MergeConflict["level"],
    message: String(c.message ?? ""),
    ...(Array.isArray(c.purchaseOrders) ? { purchaseOrders: (c.purchaseOrders as unknown[]).map(String) } : {}),
  }));
}

function quoteRef(v: unknown): { id: string; number: string | null } | null {
  if (!v || typeof v !== "object") return null;
  const q = v as Raw;
  return typeof q.id === "string" ? { id: q.id, number: str(q.number) } : null;
}

function counts(v: unknown): MergePreview["counts"] {
  const c = (v && typeof v === "object" ? v : {}) as Raw;
  const n = (k: string) => num(c[k]) ?? 0;
  return {
    items: n("items"), itemsMerged: n("itemsMerged"), files: n("files"), filesArchived: n("filesArchived"),
    filesDuplicate: n("filesDuplicate"), drawings: n("drawings"), quotes: n("quotes"), emails: n("emails"),
    purchaseOrders: n("purchaseOrders"), supplierQuotes: n("supplierQuotes"), operations: n("operations"), payments: n("payments"),
    revisions: n("revisions"), handoffs: n("handoffs"), events: n("events"), approvals: n("approvals"), anonQueue: n("anonQueue"),
    training: n("training"), invoices: n("invoices"), deliveryNotes: n("deliveryNotes"), documents: n("documents"),
    captureSessions: n("captureSessions"),
  };
}

function fields(v: unknown): MergePreview["fields"] {
  if (!Array.isArray(v)) return [];
  return v.filter((f): f is Raw => !!f && typeof f === "object").map((f) => ({
    field: String(f.field ?? ""), label: String(f.label ?? ""), kind: String(f.kind ?? "text"),
    rule: (["fill", "keep", "append", "union", "admin_only"].includes(String(f.rule)) ? f.rule : "keep") as MergePreview["fields"][number]["rule"],
    target: str(f.target), source: str(f.source), result: str(f.result),
  }));
}

export function mapMergePreview(raw: unknown): MergePreview | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Raw;
  const stage = (p.stage ?? {}) as Raw;
  return {
    ok: p.ok === true, needsForce: p.needsForce === true, canForce: p.canForce === true,
    target: ref(p.target as Raw), source: ref(p.source as Raw),
    stage: { from: stageOf(stage.from), to: stageOf(stage.to), source: stageOf(stage.source) },
    acceptQuote: quoteRef(p.acceptQuote), counts: counts(p.counts), fields: fields(p.fields), conflicts: conflicts(p.conflicts),
    quotePdf: p.quotePdf && typeof p.quotePdf === "object" && str((p.quotePdf as Raw).label) ? { label: String((p.quotePdf as Raw).label) } : null,
  };
}

export function mapMergeResult(raw: unknown): MergeResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Raw;
  if (typeof r.targetId !== "string" || typeof r.sourceId !== "string") return null;
  const stage = (r.stage ?? {}) as Raw;
  return {
    mergeId: String(r.mergeId ?? ""), targetId: r.targetId, targetNumber: String(r.targetNumber ?? ""),
    sourceId: r.sourceId, sourceNumber: String(r.sourceNumber ?? ""), replayed: r.replayed === true,
    stage: { from: stageOf(stage.from), to: stageOf(stage.to), source: stageOf(stage.source) },
    acceptedQuote: quoteRef(r.acceptedQuote), moved: counts(r.moved), warnings: conflicts(r.warnings),
    forced: r.forced === true, reason: str(r.reason), byName: str(r.byName),
  };
}

const ERROR_CODES: MergeErrorCode[] = ["FORBIDDEN", "VALIDATION", "NOT_FOUND", "SAME_JOB", "MERGED", "ALREADY_MERGED", "CLOSED",
  "COMMISSION_PAID", "NEEDS_FORCE"];

export function mergeErrorCode(err: RpcError | null | undefined): MergeErrorCode {
  if (!err) return "VALIDATION";
  if (err.code === "42501") return "FORBIDDEN";
  const hint = String(err.hint ?? "");
  return (ERROR_CODES as string[]).includes(hint) ? (hint as MergeErrorCode) : "VALIDATION";
}

export async function previewJobMergeCore(db: JobsDb, targetId: string, sourceId: string): Promise<{ ok: true; preview: MergePreview } | { ok: false; error: string }> {
  if (!isUuid(targetId) || !isUuid(sourceId)) return { ok: false, error: "Zakázka nenalezena." };
  const { data, error } = await db.rpc("merge_jobs_preview", { p_target: targetId, p_source: sourceId });
  if (error) return { ok: false, error: (error as RpcError).code === "42501" ? "K této akci nemáš oprávnění." : error.message };
  const preview = mapMergePreview(data);
  return preview ? { ok: true, preview } : { ok: false, error: "Náhled sloučení se nepodařilo načíst." };
}

export interface MergeInput {
  targetId: string;
  sourceId: string;
  token: string;
  force?: boolean;
  reason?: string | null;
}

export async function mergeJobsCore(db: JobsDb, input: MergeInput): Promise<{ ok: true; result: MergeResult } | { ok: false; error: string; code: MergeErrorCode }> {
  if (!isUuid(input.targetId) || !isUuid(input.sourceId)) return { ok: false, error: "Zakázka nenalezena.", code: "NOT_FOUND" };
  if (!isUuid(input.token)) return { ok: false, error: "Chybí identifikátor požadavku.", code: "VALIDATION" };
  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 1000) : "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await db.rpc("merge_jobs", {
      p_target: input.targetId, p_source: input.sourceId, p_token: input.token, p_force: input.force === true, p_reason: reason || null,
    });
    if (error && (error as RpcError).code === "40P01" && attempt === 0) continue;     // deadlock → jednou znovu
    if (error) {
      const code = mergeErrorCode(error as RpcError);
      return { ok: false, code, error: code === "FORBIDDEN" && !/slučuj|Sloučit|nemáš|super admin/i.test(error.message) ? "K této akci nemáš oprávnění." : error.message };
    }
    const result = mapMergeResult(data);
    return result ? { ok: true, result } : { ok: false, error: "Sloučení se nepodařilo uložit.", code: "VALIDATION" };
  }
  return { ok: false, error: "Souběh — zkus to znovu.", code: "VALIDATION" };
}

// ── Hledání kandidátů ───────────────────────────────────────
const CANDIDATE_SELECT = "id, number, title, status, customer_id, customer_order_number, created_at, merged_into_id, customer:customers!customer_id(name), items:order_items(drawing_number)";

type CandidateRow = {
  id: string; number: string | null; title: string | null; status: string; customer_id: string | null;
  customer_order_number: string | null; created_at: string; merged_into_id: string | null;
  customer: { name: string } | { name: string }[] | null; items: { drawing_number: string | null }[] | null;
};

function toCandidate(r: CandidateRow, reasons: MergeCandidateReason[]): MergeCandidate {
  const c = Array.isArray(r.customer) ? r.customer[0] : r.customer;
  const drawings: string[] = [];
  for (const i of r.items ?? []) {
    const d = (i.drawing_number ?? "").trim();
    if (d && !drawings.includes(d)) drawings.push(d);
  }
  const ordered = MERGE_REASON_ORDER.filter((x) => reasons.includes(x));
  return {
    id: r.id, number: r.number ?? "", title: r.title ?? "", stage: stageOf(r.status), customer: c?.name ?? null,
    customerOrderNumber: r.customer_order_number, drawingNumbers: drawings.slice(0, 6), createdAt: r.created_at,
    reason: ordered[0] ?? "search", reasons: ordered,
  };
}

function usable(r: CandidateRow, jobId: string): boolean {
  return r.id !== jobId && !r.merged_into_id && !CLOSED.includes(stageOf(r.status));
}

type ItemHit = { order_id: string; drawing_number: string | null };

/** Položky, jejichž číslo výkresu je (normalizovaně — mezery, tečky, pomlčky) jedno z `keys`. */
async function itemsByDrawingKeys(db: JobsDb, drawings: string[], match: (key: string) => boolean): Promise<ItemHit[]> {
  const patterns = [...new Set(drawings.map(drawingLikePattern).filter((p): p is string => !!p))].slice(0, 8);
  if (!patterns.length) return [];
  const { data } = await db.from("order_items").select("order_id, drawing_number")
    .or(patterns.map((p) => `drawing_number.ilike.${p}`).join(",")).limit(120);
  return ((data ?? []) as ItemHit[]).filter((i) => match(drawingKey(i.drawing_number)));
}

/** Prefix dávky focení z klíče zakázky („<captureId>:<skupina>", viz capture-batch-service). */
function capturePrefix(key: string | null | undefined): string | null {
  const p = (key ?? "").split(":")[0] ?? "";
  return (key ?? "").includes(":") && /^[A-Za-z0-9-]{6,80}$/.test(p) ? p : null;
}

/**
 * Kandidáti ke sloučení: s dotazem hledá číslo zakázky, název, objednávku zákazníka, číslo nabídky,
 * zákazníka a čísla výkresů (i jinak zapsaná — mezery, tečky); bez dotazu návrhy — stejné focení,
 * stejný výkres, stejný zákazník (i druhý záznam se stejným IČO), nedávné; nejpravděpodobnější první.
 * Bez uzavřených a sloučených.
 */
export async function searchMergeCandidatesCore(db: JobsDb, jobId: string, query: unknown): Promise<MergeCandidate[]> {
  if (!isUuid(jobId)) return [];
  const q = cleanMergeQuery(query);
  const { data: selfRow } = await db.from("orders")
    .select("id, customer_id, capture_key, customer:customers!customer_id(ico), items:order_items(drawing_number)").eq("id", jobId).maybeSingle();
  const self = selfRow as {
    id: string; customer_id: string | null; capture_key: string | null;
    customer: { ico: string | null } | { ico: string | null }[] | null; items: { drawing_number: string | null }[] | null;
  } | null;
  if (!self) return [];
  const out = new Map<string, MergeCandidate>();
  const add = (rows: CandidateRow[] | null | undefined, reason: MergeCandidateReason, limit = 12) => {
    for (const r of rows ?? []) {
      if (out.size >= 30) break;
      if (!usable(r, jobId) || out.has(r.id)) continue;
      if ([...out.values()].filter((x) => x.reason === reason).length >= limit) break;
      out.set(r.id, toCandidate(r, [reason]));
    }
  };

  if (q) {
    const like = `%${q}%`;
    const qKey = drawingKey(q);
    const [byJob, byCustomer, byItem, byQuote, byDrawingKey] = await Promise.all([
      db.from("orders").select(CANDIDATE_SELECT)
        .or(`number.ilike.${like},title.ilike.${like},customer_order_number.ilike.${like},customer_inquiry_number.ilike.${like}`)
        .is("merged_into_id", null).order("created_at", { ascending: false }).limit(20),
      db.from("customers").select("id").or(`name.ilike.${like},ico.ilike.${like}`).limit(20),
      db.from("order_items").select("order_id").ilike("drawing_number", like).limit(40),
      db.from("quotes").select("job_id").ilike("number", like).not("job_id", "is", null).limit(20),
      // číslo výkresu napsané jinak než v položce („F00N603W84" × „F00N 603 W84")
      itemsByDrawingKeys(db, [q], (k) => k.includes(qKey)),
    ]);
    add(byJob.data as CandidateRow[] | null, "search", 20);
    const customerIds = ((byCustomer.data ?? []) as { id: string }[]).map((c) => c.id);
    const extraIds = [...new Set([
      ...((byItem.data ?? []) as { order_id: string }[]).map((i) => i.order_id),
      ...byDrawingKey.map((i) => i.order_id),
      ...((byQuote.data ?? []) as { job_id: string }[]).map((x) => x.job_id),
    ])].filter((id) => !out.has(id) && id !== jobId).slice(0, 30);
    const [byCust, byIds] = await Promise.all([
      customerIds.length
        ? db.from("orders").select(CANDIDATE_SELECT).in("customer_id", customerIds).is("merged_into_id", null)
          .order("created_at", { ascending: false }).limit(20)
        : Promise.resolve({ data: [] }),
      extraIds.length
        ? db.from("orders").select(CANDIDATE_SELECT).in("id", extraIds).is("merged_into_id", null).order("created_at", { ascending: false })
        : Promise.resolve({ data: [] }),
    ]);
    add(byIds.data as CandidateRow[] | null, "search", 30);
    add(byCust.data as CandidateRow[] | null, "search", 30);
    return [...out.values()];
  }

  // ── návrhy: každý kandidát nese všechny důvody, pořadí = nejpravděpodobnější duplicita první ──
  const drawings = [...new Set((self.items ?? []).map((i) => (i.drawing_number ?? "").trim()).filter(Boolean))].slice(0, 10);
  const keys = new Set(drawings.map(drawingKey).filter(Boolean));
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const selfIco = (Array.isArray(self.customer) ? self.customer[0] : self.customer)?.ico ?? null;
  const icoDigits = (selfIco ?? "").replace(/\D/g, "");
  const prefix = capturePrefix(self.capture_key);
  const [twinCustomers, drawingHits, captureRows, recent] = await Promise.all([
    // zákazník zapsaný dvakrát (jiný záznam, stejné IČO)
    icoDigits.length >= 6
      ? db.from("customers").select("id, ico").ilike("ico", `%${icoDigits.split("").join("%")}%`).limit(60)
      : Promise.resolve({ data: [] }),
    // stejný výkres i s jiným zápisem čísla (mezery, tečky) — vzor ILIKE, ověří se normalizovaně
    itemsByDrawingKeys(db, drawings, (k) => keys.has(k)),
    prefix
      ? db.from("orders").select(CANDIDATE_SELECT).like("capture_key", `${prefix}:%`).is("merged_into_id", null).limit(15)
      : Promise.resolve({ data: [] }),
    db.from("orders").select(CANDIDATE_SELECT).is("merged_into_id", null).gte("created_at", since)
      .order("created_at", { ascending: false }).limit(15),
  ]);
  const customerIds = [...new Set([
    ...(self.customer_id ? [self.customer_id] : []),
    ...((twinCustomers.data ?? []) as { id: string; ico: string | null }[])
      .filter((c) => (c.ico ?? "").replace(/\D/g, "") === icoDigits).map((c) => c.id),
  ])].slice(0, 60);
  const drawingJobIds = [...new Set(drawingHits.map((i) => i.order_id))].filter((id) => id !== jobId).slice(0, 15);
  const [sameCustomer, byDrawing] = await Promise.all([
    customerIds.length
      ? db.from("orders").select(CANDIDATE_SELECT).in("customer_id", customerIds).is("merged_into_id", null)
        .order("created_at", { ascending: false }).limit(15)
      : Promise.resolve({ data: [] }),
    drawingJobIds.length
      ? db.from("orders").select(CANDIDATE_SELECT).in("id", drawingJobIds).is("merged_into_id", null).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);
  const rows = new Map<string, CandidateRow>();
  const why = new Map<string, Set<MergeCandidateReason>>();
  const mark = (list: unknown, reason: MergeCandidateReason) => {
    for (const r of (list ?? []) as CandidateRow[]) {
      if (!usable(r, jobId)) continue;
      rows.set(r.id, r);
      if (!why.has(r.id)) why.set(r.id, new Set());
      why.get(r.id)!.add(reason);
    }
  };
  mark(captureRows.data, "capture");
  mark(byDrawing.data, "drawing");
  mark(sameCustomer.data, "customer");
  mark(recent.data, "recent");
  // důvod „stejný výkres" i u kandidátů nalezených jinak (zákazník, nedávné), když výkres sdílí
  for (const [id, r] of rows) {
    if ((r.items ?? []).some((i) => keys.has(drawingKey(i.drawing_number)))) why.get(id)!.add("drawing");
  }
  const ranked = rankMergeCandidates([...rows.values()].map((r) => toCandidate(r, [...(why.get(r.id) ?? [])])));
  // nedávné bez silného důvodu jen pár (ať nepřebijí skutečné duplicity)
  let weak = 0;
  return ranked.filter((c) => mergeCandidateScore(c) > 0 || weak++ < 8).slice(0, 30);
}

/** Konečný cíl sloučení (řetěz A→B→C; max. 5 kroků) — pro přesměrování ze zdroje. */
export async function resolveMergeTarget(db: JobsDb, jobId: string): Promise<{ id: string; number: string } | null> {
  let id = jobId;
  let found: { id: string; number: string } | null = null;
  const seen = new Set<string>([jobId]);
  for (let i = 0; i < 5; i++) {
    const { data } = await db.from("orders").select("merged_into_id").eq("id", id).maybeSingle();
    const next = (data as { merged_into_id: string | null } | null)?.merged_into_id ?? null;
    if (!next || seen.has(next)) break;
    const { data: t } = await db.from("orders").select("id, number").eq("id", next).maybeSingle();
    if (!t) break;
    const row = t as { id: string; number: string | null };
    found = { id: row.id, number: row.number ?? "" };
    seen.add(row.id);
    id = row.id;
  }
  return found;
}
