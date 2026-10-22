import "server-only";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAccess } from "@/lib/auth/session";
import type { Feature } from "@/lib/auth/permissions";
import type { JobStage, JobFileKind, QuoteStatus } from "@/lib/supabase/database.types";
import type {
  JobListItem, JobDetail, JobFilters, JobFormOptions, JobQuote, JobFile,
} from "@/lib/jobs/types";
import type { JobMatchCandidate, CustomerMatchCandidate } from "@/lib/jobs/capture-types";
import { isJobFileKind } from "@/lib/jobs/file-kinds";
import { isJobStage } from "@/lib/jobs/stages";
import {
  JOB_LIST_SELECT, JOB_DETAIL_SELECT, JOB_QUOTE_SELECT, QUOTE_LIST_SELECT, JOB_FILE_SELECT,
  JOB_FILE_LIST_SELECT, JOB_EVENT_SELECT, JOB_COUNT_SELECT, MATCH_JOB_SELECT, MATCH_CUSTOMER_SELECT,
  rowToJobListItem, rowToJobDetail, rowToJobQuote, rowToJobFile, resolveStageFilter, filterJobs,
  sortJobs, countJobStages, emptyStageCounts, isUuid, one, searchNormalize, isQuoteStatus, fetchPaged,
  type JobRow, type QuoteRow, type FileRow, type EventRow, type JobStageCounts, type ViewOptions,
} from "@/lib/jobs/mapping";

/**
 * Datová vrstva Knihy zakázek — čte servisním klíčem (obchází RLS),
 * proto každá funkce sama ověří přihlášení a oprávnění. Bez konfigurace
 * nebo při chybě vrací prázdný / null výsledek.
 */

export type { JobStageCounts } from "@/lib/jobs/mapping";

const MAX_ROWS = 2000;

function warn(scope: string, error: { message: string } | null | undefined) {
  if (error) console.error(`[data:jobs:${scope}] Supabase chyba: ${error.message}`);
}

/** Klient + práva přihlášeného aktivního uživatele (null = nic nevracet). */
async function session(...features: Feature[]) {
  if (!isSupabaseConfigured()) return null;
  try {
    const access = await getAccess();
    if (!access.user || !access.user.active) return null;
    if (features.length && !features.some((f) => access.can(f))) return null;
    const db = await createOperatorClient();
    const view: ViewOptions = { margins: access.can("margins") };
    return { db, view, access };
  } catch (err) {
    console.error(`[data:jobs] ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ── Kniha zakázek ───────────────────────────────────────────
export async function listJobs(filters: JobFilters = {}): Promise<JobListItem[]> {
  const s = await session("orders");
  if (!s) return [];
  try {
    for (const id of [filters.ownerId, filters.assigneeId, filters.customerId, filters.supplierId]) {
      if (id !== undefined && id !== "" && !isUuid(id)) return [];
    }
    const stages = resolveStageFilter(filters);
    const build = () => {
      let query = s.db.from("orders").select(JOB_LIST_SELECT);
      if (stages) query = query.in("status", stages);
      if (filters.ownerId) query = query.eq("owner_id", filters.ownerId);
      if (filters.assigneeId) query = query.eq("assignee_id", filters.assigneeId);
      if (filters.customerId) query = query.eq("customer_id", filters.customerId);
      if (filters.supplierId) query = query.eq("supplier_id", filters.supplierId);
      return query.order("created_at", { ascending: false }).order("id");
    };
    const { data, error } = await fetchPaged<JobRow>((from, to) => build().range(from, to), MAX_ROWS);
    warn("list", error);
    if (error) return [];

    const items = data.map((r) => rowToJobListItem(r, s.view));
    const filtered = filterJobs(items, { q: filters.q, deadline: filters.deadline });
    const sorted = sortJobs(filtered, filters.sort ?? "created", filters.dir ?? "desc");
    const limit = filters.limit && filters.limit > 0 ? Math.floor(filters.limit) : undefined;
    return limit ? sorted.slice(0, limit) : sorted;
  } catch (err) {
    console.error(`[data:jobs:list] ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

export async function getJobsForCustomer(customerId: string): Promise<JobListItem[]> {
  if (!isUuid(customerId)) return [];
  return listJobs({ customerId });
}

export async function getJob(id: string): Promise<JobDetail | null> {
  if (!isUuid(id)) return null;
  const s = await session("orders");
  if (!s) return null;
  try {
    const [jobRes, quotesRes, filesRes, eventsRes] = await Promise.all([
      s.db.from("orders").select(JOB_DETAIL_SELECT).eq("id", id).maybeSingle(),
      s.db.from("quotes").select(JOB_QUOTE_SELECT).eq("job_id", id).order("created_at", { ascending: false }),
      s.db.from("job_files").select(JOB_FILE_SELECT).eq("job_id", id).order("created_at", { ascending: false }),
      s.db.from("job_events").select(JOB_EVENT_SELECT).eq("job_id", id).order("created_at", { ascending: false }).limit(200),
    ]);
    warn("detail", jobRes.error);
    warn("detail:quotes", quotesRes.error);
    warn("detail:files", filesRes.error);
    warn("detail:events", eventsRes.error);
    if (jobRes.error || !jobRes.data) return null;
    return rowToJobDetail(
      jobRes.data as JobRow,
      {
        quotes: (quotesRes.data ?? []) as QuoteRow[],
        files: (filesRes.data ?? []) as FileRow[],
        events: (eventsRes.data ?? []) as EventRow[],
      },
      s.view,
    );
  } catch (err) {
    console.error(`[data:jobs:detail] ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export async function getJobStageCounts(): Promise<JobStageCounts> {
  const s = await session("orders");
  if (!s) return emptyStageCounts();
  try {
    const { data, error } = await fetchPaged<{ status: string }>(
      (from, to) => s.db.from("orders").select(JOB_COUNT_SELECT).order("id").range(from, to),
      50_000,
    );
    warn("counts", error);
    if (error) return emptyStageCounts();
    return countJobStages(data);
  } catch (err) {
    console.error(`[data:jobs:counts] ${err instanceof Error ? err.message : String(err)}`);
    return emptyStageCounts();
  }
}

export async function getJobFormOptions(): Promise<JobFormOptions> {
  const empty: JobFormOptions = { users: [], customers: [], suppliers: [] };
  const s = await session("orders");
  if (!s) return empty;
  try {
    const [users, customers, suppliers] = await Promise.all([
      s.db.from("profiles").select("id, full_name, email, role").eq("active", true).order("full_name"),
      fetchPaged((from, to) => s.db.from("customers").select("id, name, customer_number, ico").order("name").order("id").range(from, to), 20_000),
      fetchPaged((from, to) => s.db.from("suppliers").select("id, name").order("name").order("id").range(from, to), 20_000),
    ]);
    warn("options:users", users.error);
    warn("options:customers", customers.error);
    warn("options:suppliers", suppliers.error);
    return {
      users: ((users.data ?? []) as { id: string; full_name: string | null; email: string | null; role: string }[]).map((u) => ({
        id: u.id,
        name: (u.full_name ?? "").trim() || (u.email ?? "").trim() || "Neznámý uživatel",
        role: u.role,
      })),
      customers: ((customers.data ?? []) as { id: string; name: string; customer_number: string | null; ico: string | null }[]).map((c) => ({
        id: c.id,
        name: c.name,
        customerNumber: c.customer_number ?? null,
        ico: c.ico ?? null,
      })),
      suppliers: ((suppliers.data ?? []) as { id: string; name: string }[]).map((x) => ({ id: x.id, name: x.name })),
    };
  } catch (err) {
    console.error(`[data:jobs:options] ${err instanceof Error ? err.message : String(err)}`);
    return empty;
  }
}

// ── Nabídky napříč zakázkami ────────────────────────────────
export type QuoteListItem = JobQuote & {
  job: { id: string; number: string; title: string; stage: JobStage } | null;
  customer: { id: string; name: string } | null;
};

export async function listQuotes(
  opts: { status?: QuoteStatus[]; includeArchived?: boolean; q?: string } = {},
): Promise<QuoteListItem[]> {
  const s = await session("workflow", "orders");
  if (!s) return [];
  try {
    const statuses = (opts.status ?? []).filter(isQuoteStatus);
    const build = () => {
      let query = s.db.from("quotes").select(QUOTE_LIST_SELECT);
      if (statuses.length) query = query.in("status", statuses);
      if (!opts.includeArchived) query = query.eq("archived", false);
      return query.order("created_at", { ascending: false }).order("id");
    };
    const { data, error } = await fetchPaged<QuoteRow>((from, to) => build().range(from, to), MAX_ROWS);
    warn("quotes", error);
    if (error) return [];

    const items = data.map((row): QuoteListItem => {
      const job = one(row.job);
      const customer = one(row.customer);
      return {
        ...rowToJobQuote(row, { ...s.view, acceptedQuoteId: job?.quote_id ?? null }),
        job: job
          ? { id: job.id, number: job.number ?? "—", title: job.title ?? "", stage: isJobStage(job.status) ? job.status : "poptavka" }
          : null,
        customer: customer ? { id: customer.id, name: customer.name } : null,
      };
    });
    const tokens = searchNormalize(opts.q ?? "").split(/\s+/).filter(Boolean);
    if (!tokens.length) return items;
    return items.filter((qt) => {
      const h = searchNormalize([qt.number, qt.title, qt.job?.number, qt.job?.title, qt.customer?.name].filter(Boolean).join(" "));
      return tokens.every((t) => h.includes(t));
    });
  } catch (err) {
    console.error(`[data:jobs:quotes] ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

// ── Dokumenty napříč zakázkami ──────────────────────────────
export type JobFileListItem = JobFile & {
  job: { id: string; number: string; title: string; customerName: string | null };
};

export async function listJobFiles(
  opts: { kinds?: JobFileKind[]; includeArchived?: boolean; q?: string; limit?: number } = {},
): Promise<JobFileListItem[]> {
  const s = await session("documents", "orders");
  if (!s) return [];
  try {
    const limit = Math.min(MAX_ROWS, opts.limit && opts.limit > 0 ? Math.floor(opts.limit) : 500);
    const tokens = searchNormalize(opts.q ?? "").split(/\s+/).filter(Boolean);
    const kinds = (opts.kinds ?? []).filter(isJobFileKind);
    const build = () => {
      let query = s.db.from("job_files").select(JOB_FILE_LIST_SELECT);
      if (kinds.length) query = query.in("kind", kinds);
      if (!opts.includeArchived) query = query.eq("archived", false);
      return query.order("created_at", { ascending: false }).order("id");
    };
    // s hledáním se filtruje v JS → načíst víc řádků
    const { data, error } = await fetchPaged<FileRow>((from, to) => build().range(from, to), tokens.length ? MAX_ROWS : limit);
    warn("files", error);
    if (error) return [];

    const out: JobFileListItem[] = [];
    for (const row of data) {
      const job = one(row.job);
      if (!job) continue;
      const customerName = one(job.customer)?.name ?? null;
      const item: JobFileListItem = {
        ...rowToJobFile(row),
        job: { id: job.id, number: job.number ?? "—", title: job.title ?? "", customerName },
      };
      if (tokens.length) {
        const h = searchNormalize([item.filename, item.title, item.note, item.job.number, item.job.title, customerName].filter(Boolean).join(" "));
        if (!tokens.every((t) => h.includes(t))) continue;
      }
      out.push(item);
      if (out.length >= limit) break;
    }
    return out;
  } catch (err) {
    console.error(`[data:jobs:files] ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

// ── Kandidáti pro párování dokladů (foto → zakázka) ─────────
interface MatchJobRow {
  id: string;
  number: string | null;
  title: string | null;
  status: string;
  created_at: string;
  customer_id: string | null;
  customer_order_number: string | null;
  customer_inquiry_number: string | null;
  customer_contact_email: string | null;
  customer?: {
    id: string; name: string; ico: string | null; dic: string | null; email: string | null;
    contacts?: { email: string | null }[] | null;
  } | { id: string; name: string; ico: string | null; dic: string | null; email: string | null; contacts?: { email: string | null }[] | null }[] | null;
  items?: { drawing_number: string | null }[] | null;
  quotes?: { number: string | null; items?: { drawing_number: string | null }[] | null }[] | null;
}

interface MatchCustomerRow {
  id: string;
  name: string;
  ico: string | null;
  dic: string | null;
  email: string | null;
  customer_number: string | null;
  supplier_number_at_customer: string | null;
  contacts?: { email: string | null }[] | null;
}

function uniqueStrings(values: (string | null | undefined)[], lower = false): string[] {
  const out: string[] = [];
  for (const v of values) {
    const s = (v ?? "").trim();
    if (!s) continue;
    const x = lower ? s.toLowerCase() : s;
    if (!out.includes(x)) out.push(x);
  }
  return out;
}

export async function getMatchingCandidates(): Promise<{ jobs: JobMatchCandidate[]; customers: CustomerMatchCandidate[] }> {
  const empty = { jobs: [], customers: [] };
  const s = await session("orders");
  if (!s) return empty;
  try {
    const since = new Date();
    since.setFullYear(since.getFullYear() - 2);
    const [jobsRes, customersRes] = await Promise.all([
      fetchPaged<MatchJobRow>((from, to) => s.db.from("orders").select(MATCH_JOB_SELECT)
        .neq("status", "zruseno")
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to), 10_000),
      fetchPaged<MatchCustomerRow>((from, to) => s.db.from("customers").select(MATCH_CUSTOMER_SELECT)
        .order("name").order("id").range(from, to), 20_000),
    ]);
    warn("match:jobs", jobsRes.error);
    warn("match:customers", customersRes.error);

    const jobs: JobMatchCandidate[] = jobsRes.data.map((r) => {
      const c = one(r.customer);
      return {
        id: r.id,
        number: r.number ?? "",
        title: r.title ?? "",
        stage: isJobStage(r.status) ? r.status : "poptavka",
        createdAt: r.created_at,
        customerId: r.customer_id ?? null,
        customerName: c?.name ?? null,
        customerIco: c?.ico ?? null,
        customerDic: c?.dic ?? null,
        customerEmails: uniqueStrings([c?.email, ...(c?.contacts ?? []).map((x) => x.email), r.customer_contact_email], true),
        customerOrderNumber: r.customer_order_number ?? null,
        customerInquiryNumber: r.customer_inquiry_number ?? null,
        quoteNumbers: uniqueStrings((r.quotes ?? []).map((q) => q.number)),
        drawingNumbers: uniqueStrings([
          ...(r.items ?? []).map((i) => i.drawing_number),
          ...(r.quotes ?? []).flatMap((q) => (q.items ?? []).map((i) => i.drawing_number)),
        ]),
      };
    });

    const customers: CustomerMatchCandidate[] = customersRes.data.map((c) => ({
      id: c.id,
      name: c.name,
      ico: c.ico ?? null,
      dic: c.dic ?? null,
      email: c.email ?? null,
      contactEmails: uniqueStrings((c.contacts ?? []).map((x) => x.email), true),
      customerNumber: c.customer_number ?? null,
      supplierNumberAtCustomer: c.supplier_number_at_customer ?? null,
    }));

    return { jobs, customers };
  } catch (err) {
    console.error(`[data:jobs:match] ${err instanceof Error ? err.message : String(err)}`);
    return empty;
  }
}
