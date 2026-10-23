import "server-only";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { quoteStatusLabel, approvalTypeLabel } from "@/lib/data/labels";
import type {
  ApprovalItemRow, Quote, Customer, Drawing, ApprovalType,
} from "@/lib/supabase/database.types";
import type {
  EmailItem, ApprovalItem, QuoteItem, DrawingItem, CommissionRow, BadgeCounts,
} from "@/lib/data/types";
import { periodStart } from "@/lib/data/periods";
import { getAccess } from "@/lib/auth/session";
import type { Feature } from "@/lib/auth/permissions";
import { CLOSED_STAGES } from "@/lib/jobs/stages";
import { fetchPaged, isUuid } from "@/lib/jobs/mapping";
import type { JobListItem } from "@/lib/jobs/types";
import { getEmails as getMailEmails, getSentMail, getUnreadCount, getMailScope } from "@/lib/data/mail";
import { getJobsForCustomer, listQuotes, type QuoteListItem } from "@/lib/data/jobs";
import { emailVisibilityFilter, toEmailItem, type EmailListRow } from "@/lib/email/visibility";
import {
  CUSTOMER_SELECT, rowToContactView, rowToCustomerView, sortContacts,
  type ContactRow, type ContactView, type CustomerRow, type CustomerView,
} from "@/components/customers/model";
import { SUPPLIER_SELECT, rowToSupplierView, type SupplierRow, type SupplierView } from "@/components/suppliers/model";
import { getFlowCounts } from "@/lib/data/flow-status";
import { pragueToday, type ChangeStamp } from "@/lib/jobs/flow-status";
import { groupMovers, startOfPragueDay, type MoverGroup } from "@/components/dashboard/flow-overview-model";

/**
 * Datová vrstva — VÝHRADNĚ reálná data ze Supabase.
 * Bez konfigurace nebo při chybě vrací prázdné kolekce (UI ukáže prázdný stav s návodem).
 */

async function supa() {
  if (!isSupabaseConfigured()) return null;
  try {
    return await createOperatorClient();
  } catch {
    return null;
  }
}

function warn(scope: string, error: { message: string } | null) {
  if (error) console.error(`[data:${scope}] Supabase chyba: ${error.message}`);
}

/**
 * Data se čtou servisním klíčem (RLS obchází) → každá funkce ověří přihlášení
 * a aspoň jednu z funkcí sama. Bez práva vrací prázdný výsledek.
 */
async function allowedAccess(...features: Feature[]) {
  try {
    const access = await getAccess();
    if (!access.user || !access.user.active) return null;
    if (features.length && !features.some((f) => access.can(f))) return null;
    return access;
  } catch {
    return null;
  }
}

// Pomocné typy pro vnořené (joinované) vztahy
type WithCustomer = { customers?: { name: string } | null };

/**
 * Příchozí e-maily viditelné přihlášenému uživateli (každý svou schránku,
 * super admin vše) — přehled, poptávky, potvrzení. Detail viz lib/data/mail.
 */
export async function getEmails(): Promise<EmailItem[]> {
  return getMailEmails({ direction: "in" });
}

/** Položka fronty + kdo návrh připravil (AI / plánovač) — fronta ukazuje oba autory (minor 16). */
export type ApprovalQueueItem = ApprovalItem & { proposedBy: string };

export async function getApprovalQueue(): Promise<ApprovalQueueItem[]> {
  if (!(await allowedAccess("dashboard"))) return [];
  const db = await supa();
  if (!db) return [];
  const { data, error } = await db
    .from("approval_queue")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  warn("approval_queue", error);
  if (error || !data) return [];
  return (data as ApprovalItemRow[]).map((a) => ({
    id: a.id,
    rawType: a.type as ApprovalType,
    type: approvalTypeLabel[a.type as ApprovalType] ?? a.type,
    title: a.title,
    summary: a.summary ?? "",
    target: a.target ?? "",
    body: typeof (a.payload as { body?: unknown })?.body === "string"
      ? ((a.payload as { body: string }).body)
      : "",
    createdAt: a.created_at,
    aiConfidence: a.ai_confidence ?? 0,
    // kdo návrh připravil: připomenutí = plánovač, ostatní (odpovědi, nabídky, poptávky dodavatelům) = AI
    proposedBy: a.type === "reminder" ? "Systém (plánovač)" : "✨ AI",
  }));
}

/** Naposledy vyřízené položky fronty — kdo schválil / zamítl (resolved_by) nebo „✨ AI odeslala automaticky". */
export interface ResolvedApproval {
  id: string;
  title: string;
  type: string;
  status: "approved" | "rejected" | "auto_executed";
  proposedBy: string;
  stamp: ChangeStamp;
}

export async function getResolvedApprovals(limit = 6): Promise<ResolvedApproval[]> {
  if (!(await allowedAccess("dashboard"))) return [];
  const db = await supa();
  if (!db) return [];
  const { data, error } = await db
    .from("approval_queue")
    .select("id, type, title, status, resolved_at, resolved_by, resolver:profiles!resolved_by(id, full_name, email)")
    .neq("status", "pending")
    .not("resolved_at", "is", null)
    .order("resolved_at", { ascending: false })
    .limit(Math.max(1, Math.min(50, limit)));
  warn("approval_queue:resolved", error);
  type R = { id: string; type: ApprovalType; title: string; status: string; resolved_at: string; resolved_by: string | null; resolver?: { id: string; full_name: string | null; email: string | null } | { id: string; full_name: string | null; email: string | null }[] | null };
  return ((data ?? []) as unknown as R[]).map((r) => {
    const p = Array.isArray(r.resolver) ? r.resolver[0] ?? null : r.resolver ?? null;
    const name = p ? (p.full_name ?? "").trim() || (p.email ?? "").trim() || null : null;
    const auto = r.status === "auto_executed";
    return {
      id: r.id,
      title: r.title,
      type: approvalTypeLabel[r.type] ?? r.type,
      status: auto ? "auto_executed" : r.status === "rejected" ? "rejected" : "approved",
      proposedBy: r.type === "reminder" ? "Systém (plánovač)" : "✨ AI",
      stamp: {
        by: p && name ? { id: p.id, name } : null, byName: name, at: r.resolved_at,
        via: auto ? "automaticky" : null, kind: auto ? "ai" : name ? "user" : "system",
      },
    };
  });
}

// ── Přehled toku pro AI přehled (dashboard) ─────────────────
/** Dlaždice podrobných stavů: „fáze.klíč" → kam vede (stránka toku s filtrem). */
export const FLOW_TILES: { key: string; label: string; href: string }[] = [
  { key: "inquiry.prijata", label: "Poptávky k převzetí", href: "/inquiries?stav=prijata" },
  { key: "inquiry.ceka_na_podklady", label: "Čeká na podklady", href: "/inquiries?stav=ceka_na_podklady" },
  { key: "quote.ke_schvaleni", label: "Ke schválení", href: "/quotes?stav=ke_schvaleni" },
  { key: "order.dorucena", label: "Objednávky k potvrzení", href: "/confirmations?stav=dorucena" },
  { key: "order.rozpor", label: "Rozpor s nabídkou", href: "/confirmations?stav=rozpor" },
  { key: "order.aktualizovana", label: "Změny objednávek", href: "/confirmations?stav=aktualizovana" },
  { key: "fulfilment.castecne_dodana", label: "Částečně dodané", href: "/confirmations?stav=castecne_dodana" },
  { key: "payment.po_splatnosti", label: "Po splatnosti", href: "/orders?segment=vse&payment=po_splatnosti" },
];

/** Počty podrobných stavů + „Co kdo dnes posunul" (události stavu za pražský dnešek). */
export async function getFlowDashboard(): Promise<{ counts: Record<string, number>; movers: MoverGroup[]; movedToday: number }> {
  const empty = { counts: {}, movers: [], movedToday: 0 };
  if (!(await allowedAccess("dashboard"))) return empty;
  const db = await supa();
  if (!db) return empty;
  const since = startOfPragueDay(pragueToday());
  const [counts, ev] = await Promise.all([
    getFlowCounts(),
    db.from("job_events")
      .select("job_id, message, created_at, actor_id, actor_kind, actor_name, actor:profiles!actor_id(full_name, email), job:orders!job_id(number)")
      .in("type", ["stage", "status"])
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);
  warn("job_events:today", ev.error);
  const rows = (ev.data ?? []) as unknown as Parameters<typeof groupMovers>[0];
  return { counts, movers: groupMovers(rows), movedToday: rows.length };
}

/** Starší přehled nabídek (asistent, hledání). Nové stránky používají listQuotes z lib/data/jobs. */
export async function getQuotes(): Promise<QuoteItem[]> {
  if (!(await allowedAccess("workflow", "orders"))) return [];
  const db = await supa();
  if (!db) return [];
  const { data, error } = await db
    .from("quotes")
    .select("*, customers(name), quote_items(quantity, drawing_number, drawings(drawing_number))")
    .eq("archived", false)
    .order("created_at", { ascending: false })
    .limit(500);
  warn("quotes", error);
  if (error || !data) return [];
  type QRow = Quote & WithCustomer & {
    quote_items?: { quantity: number; drawing_number?: string | null; drawings?: { drawing_number: string } | null }[];
  };
  return (data as QRow[]).map((q) => {
    const items = q.quote_items ?? [];
    return {
      id: q.id,
      number: q.number ?? "",
      customer: q.customers?.name ?? "—",
      drawing: items[0]?.drawing_number ?? items[0]?.drawings?.drawing_number ?? "—",
      qty: items.reduce((s, it) => s + Number(it.quantity ?? 0), 0),
      status: quoteStatusLabel[q.status] ?? q.status,
      value: q.total ? Number(q.total) : undefined,
      createdAt: q.created_at,
    };
  });
}

/** Zákazníci pro adresář (všichni aktivní uživatelé) — s počty zakázek a obratem. */
export async function getCustomers(): Promise<CustomerView[]> {
  if (!(await allowedAccess("customers"))) return [];
  const db = await supa();
  if (!db) return [];
  const { data, error } = await fetchPaged<CustomerRow>(
    (from, to) => db.from("customers").select(CUSTOMER_SELECT).order("name").order("id").range(from, to),
    20_000,
  );
  warn("customers", error);
  if (error) return [];
  return data.map(rowToCustomerView);
}

/** Dodavatelé pro adresář (všichni aktivní uživatelé). */
export async function getSuppliers(): Promise<SupplierView[]> {
  if (!(await allowedAccess("suppliers"))) return [];
  const db = await supa();
  if (!db) return [];
  const { data, error } = await fetchPaged<SupplierRow>(
    (from, to) => db.from("suppliers").select(SUPPLIER_SELECT).order("name").order("id").range(from, to),
    20_000,
  );
  warn("suppliers", error);
  if (error) return [];
  return data.map(rowToSupplierView);
}

/** Archiv výkresů — jen s právem „drawings" (super admin). */
export async function getDrawings(opts: { customerId?: string } = {}): Promise<DrawingItem[]> {
  if (!(await allowedAccess("drawings"))) return [];
  if (opts.customerId !== undefined && !isUuid(opts.customerId)) return [];
  const db = await supa();
  if (!db) return [];
  let q = db
    .from("drawings")
    .select("*, customers(name), job:orders!job_id(id, number)")
    .order("created_at", { ascending: false })
    .limit(2000);
  if (opts.customerId) q = q.eq("customer_id", opts.customerId);
  const { data, error } = await q;
  warn("drawings", error);
  if (error || !data) return [];
  type JobEmbed = { id: string; number: string | null } | { id: string; number: string | null }[] | null;
  return (data as (Drawing & WithCustomer & { job?: JobEmbed })[]).map((d) => {
    const job = Array.isArray(d.job) ? d.job[0] ?? null : d.job ?? null;
    return {
      id: d.id,
      number: d.drawing_number,
      revision: d.revision,
      customer: d.customers?.name ?? "—",
      material: d.material ?? "—",
      dimensions: d.dimensions ?? "—",
      qty: d.quantity ?? 0,
      fileType: (d.file_type as DrawingItem["fileType"]) ?? "PDF",
      uploadedAt: d.created_at,
      jobId: job?.id ?? d.job_id ?? null,
      jobNumber: job?.number ?? null,
      jobFileId: d.job_file_id ?? null,
    };
  });
}

export type { CommissionPeriod } from "@/lib/data/periods";

/**
 * Provize po obchodnících za období. Obchodník vidí jen sebe,
 * „commissions_all" (super admin) všechny.
 */
export async function getCommissions(
  period: import("@/lib/data/periods").CommissionPeriod = "month",
): Promise<CommissionRow[]> {
  const access = await allowedAccess("commissions");
  if (!access || !access.user) return [];
  const db = await supa();
  if (!db) return [];
  const first = periodStart(period);
  let q = db
    .from("commission_entries")
    .select("id, owner_id, revenue, margin, profit, rate, commission, owner:profiles!owner_id(full_name)")
    .gte("period", first);
  if (!access.can("commissions_all")) q = q.eq("owner_id", access.user.id);
  const { data, error } = await q;
  warn("commissions", error);
  if (error || !data) return [];
  type CE = {
    id: string; owner_id: string; revenue: number; margin: number; profit: number | null; rate: number;
    commission: number; owner?: { full_name: string | null } | { full_name: string | null }[] | null;
  };
  // Agregace po obchodníkovi za období; marže = zisk / obrat
  const byOwner = new Map<string, CommissionRow & { profit: number }>();
  for (const r of data as CE[]) {
    const owner = Array.isArray(r.owner) ? r.owner[0] : r.owner;
    const name = owner?.full_name?.trim() || "—";
    const cur = byOwner.get(r.owner_id) ?? { id: r.owner_id, owner: name, revenue: 0, margin: 0, rate: 0, commission: 0, profit: 0 };
    cur.revenue += Number(r.revenue ?? 0);
    cur.commission += Number(r.commission ?? 0);
    cur.profit += r.profit === null || r.profit === undefined ? Number(r.revenue ?? 0) * Number(r.margin ?? 0) : Number(r.profit);
    cur.rate = Math.max(cur.rate, Number(r.rate ?? 0));
    byOwner.set(r.owner_id, cur);
  }
  return [...byOwner.values()]
    .map(({ profit, ...row }) => ({ ...row, margin: row.revenue > 0 ? profit / row.revenue : 0 }))
    .sort((a, b) => b.commission - a.commission);
}

/**
 * Počty pro odznaky v navigaci — reálná čísla z DB. Pošta = MOJE nepřečtené
 * příchozí (bez spamu); tok = zakázky v daném stavu; fronta jen pro AI přehled.
 */
export async function getBadgeCounts(): Promise<BadgeCounts> {
  const empty: BadgeCounts = {
    inbox: 0, inquiries: 0, pricing: 0, quotes: 0, confirmations: 0, orders: 0, approvals: 0,
  };
  const db = await supa();
  if (!db) return empty;
  try {
    const { can, user } = await getAccess();
    if (!user || !user.active) return empty;
    // #25: obchodní tok = „moje" (super admin všichni — odznaky jsou vždy „Všichni", i při „Jen moje");
    // = výchozí pohled stránky: otevřené poptávky, vše k nacenění, objednávky k potvrzení (doručené,
    // rozpor, změna) bez pozastavených a reklamací; nabídky: super admin = čekají na jeho schválení,
    // ostatní = moje schválené k odeslání + vrácené k přepracování (flow_badge_counts)
    const mine = can("flow_all") ? null : user.id;
    const [flow, orders, approvals, inbox] = await Promise.all([
      db.rpc("flow_badge_counts", { p_mine: mine }),
      db.from("orders").select("id", { count: "exact", head: true }).not("status", "in", `(${CLOSED_STAGES.join(",")})`),
      can("dashboard")
        ? db.from("approval_queue").select("id", { count: "exact", head: true }).eq("status", "pending")
        : Promise.resolve({ count: 0 }),
      getUnreadCount(),
    ]);
    warn("badges", flow.error);
    const f = ((flow.data ?? []) as Record<string, number | null>[])[0] ?? {};
    const n = (k: string) => Number(f[k] ?? 0) || 0;
    return {
      inbox,
      inquiries: n("inquiries"),
      pricing: can("pricing") ? n("pricing") : 0,
      quotes: can("quote_approval") ? n("quotes_pending") : n("quotes_ready") + n("quotes_returned"),
      confirmations: n("confirmations"),
      orders: orders.count ?? 0,
      // fronta AI návrhů (= panel AI přehledu). Ruční nabídky kolegů (quotes_pending_manual) se přičtou,
      // až je AI přehled vypíše (25-C, QuoteApprovalList) — do té doby je hlásí odznak „Nabídky".
      approvals: can("dashboard") ? (approvals.count ?? 0) : 0,
    };
  } catch {
    return empty;
  }
}

/** Nabídka čekající na schválení super adminem (panel AI přehledu a sekce „Ke schválení" v Nabídkách). */
export interface PendingQuoteApproval {
  quoteId: string;
  number: string | null;
  jobId: string | null;
  jobNumber: string | null;
  customerName: string | null;
  authorName: string | null;
  total: number | null;
  currency: string;
  updatedAt: string | null;
  createdAt: string;
  /** Bez položek nebo s položkou bez ceny — schválit nejde (autor doplní ceny). */
  unpriced: boolean;
}

/**
 * Fronta „Ke schválení" super admina (#25 §8.9) — vždy všichni (i při „Jen moje"): neschválené,
 * nearchivované, nevrácené nabídky otevřených zakázek; bez nabídek, které čekají ve frontě AI
 * (ty schvaluje ApprovalQueue). Jen s právem quote_approval.
 */
export async function listPendingQuoteApprovals(): Promise<PendingQuoteApproval[]> {
  if (!(await allowedAccess("quote_approval"))) return [];
  const db = await supa();
  if (!db) return [];
  try {
    const { data, error } = await fetchPaged<Record<string, unknown>>((from, to) => db.from("quotes")
      .select([
        "id, number, job_id, total, currency, updated_at, created_at",
        "job:orders!job_id(id, number, status, customer:customers!customer_id(name))",
        "customer:customers!customer_id(name)",
        "creator:profiles!created_by(full_name, email)",
        "items:quote_items!quote_id(unit_price)",
      ].join(", "))
      .eq("state", "ke_schvaleni")
      .eq("archived", false)
      .is("approval_returned_at", null)
      .order("updated_at", { ascending: true })
      .order("id")
      .range(from, to) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>, 2000);
    warn("pending-quotes", error);
    if (error) return [];
    const ids = data.map((r) => String(r.id));
    const queued = new Set<string>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data: q, error: qErr } = await db.from("approval_queue").select("quote_id")
        .eq("status", "pending").in("quote_id", ids.slice(i, i + 200));
      warn("pending-quotes:queue", qErr);
      for (const r of (q ?? []) as { quote_id: string | null }[]) if (r.quote_id) queued.add(r.quote_id);
    }
    type Embed<T> = T | T[] | null | undefined;
    const first = <T,>(v: Embed<T>): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
    const closed = ["dokonceno", "nerealizovano", "zruseno"];
    const out: PendingQuoteApproval[] = [];
    for (const r of data) {
      const id = String(r.id);
      if (queued.has(id)) continue;
      const job = first(r.job as Embed<{ id: string; number: string | null; status: string; customer?: Embed<{ name: string }> }>);
      if (job && closed.includes(job.status)) continue;
      const creator = first(r.creator as Embed<{ full_name: string | null; email: string | null }>);
      const items = (Array.isArray(r.items) ? r.items : []) as { unit_price: number | string | null }[];
      const total = r.total === null || r.total === undefined ? null : Number(r.total);
      out.push({
        quoteId: id,
        number: (r.number as string | null) ?? null,
        jobId: job?.id ?? ((r.job_id as string | null) ?? null),
        jobNumber: job?.number ?? null,
        customerName: first(r.customer as Embed<{ name: string }>)?.name ?? first(job?.customer)?.name ?? null,
        authorName: (creator?.full_name ?? "").trim() || (creator?.email ?? "").trim() || null,
        total: total !== null && Number.isFinite(total) ? total : null,
        currency: (r.currency as string | null) || "CZK",
        updatedAt: (r.updated_at as string | null) ?? null,
        createdAt: String(r.created_at),
        unpriced: total === null || !items.length || items.some((it) => it.unit_price === null || it.unit_price === undefined),
      });
    }
    return out;
  } catch (err) {
    console.error(`[data:pending-quotes] ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/**
 * Odeslaná pošta viditelná uživateli (vlastní odchozí e-maily; super admin vše
 * včetně staršího logu fronty schvalování).
 */
export async function getSentLog(): Promise<import("@/lib/data/types").SentItem[]> {
  return getSentMail();
}

export interface CustomerDetailData {
  customer: CustomerView;
  contacts: ContactView[];
  /** Zakázky zákazníka (Kniha zakázek). */
  jobs: JobListItem[];
  /** Nabídky zákazníka (bez archivovaných verzí). */
  quotes: QuoteListItem[];
  /** E-maily, které uživatel smí vidět (vlastní schránka, super admin vše). */
  emails: EmailItem[];
  /** Výkresy — null = uživatel nemá právo na archiv výkresů. */
  drawings: DrawingItem[] | null;
  /** Celý řádek pro cenový profil — jen s AI naceněním nebo maržemi. */
  pricingRow: Customer | null;
}

const CUSTOMER_EMAIL_SELECT = [
  "id, mailbox_id, owner_id, direction, from_name, from_email, to_email, subject, snippet",
  "category, priority, ai_confidence, ai_summary, is_read, has_draft, received_at, order_id",
  "job:orders!order_id(id, number)",
  "mailbox:mailboxes!mailbox_id(email)",
].join(", ");

/** E-maily zákazníka viditelné přihlášenému (stejná pravidla jako Pošta). */
async function getCustomerEmails(customerId: string, limit = 50): Promise<EmailItem[]> {
  const scope = await getMailScope();
  if (!scope) return [];
  const db = await supa();
  if (!db) return [];
  let q = db
    .from("emails")
    .select(CUSTOMER_EMAIL_SELECT)
    .eq("customer_id", customerId)
    .order("received_at", { ascending: false })
    .limit(limit);
  if (!scope.all) {
    const filter = emailVisibilityFilter(scope.userId, scope.ownedMailboxIds);
    if (!filter) return [];
    q = q.or(filter);
  }
  const { data, error } = await q;
  warn("customer:emails", error);
  if (error || !data) return [];
  return (data as unknown as EmailListRow[]).map(toEmailItem);
}

/** Detail zákazníka s kompletní historií (zakázky, nabídky, komunikace, výkresy). */
export async function getCustomerDetail(id: string): Promise<CustomerDetailData | null> {
  if (!isUuid(id)) return null;
  const access = await allowedAccess("customers");
  if (!access) return null;
  const db = await supa();
  if (!db) return null;
  const pricing = access.can("ai_pricing") || access.can("margins");
  const [customerRes, contactsRes, jobs, quotes, emails, drawings] = await Promise.all([
    db.from("customers").select(pricing ? `*, ${CUSTOMER_SELECT}` : CUSTOMER_SELECT).eq("id", id).maybeSingle(),
    db.from("customer_contacts").select("id, name, position, email, phone, is_primary").eq("customer_id", id),
    getJobsForCustomer(id),
    listQuotes(),
    getCustomerEmails(id),
    access.can("drawings") ? getDrawings({ customerId: id }) : Promise.resolve(null),
  ]);
  warn("customer", customerRes.error);
  warn("customer:contacts", contactsRes.error);
  if (customerRes.error || !customerRes.data) return null;
  const row = customerRes.data as unknown as CustomerRow & Customer;
  const jobIds = new Set(jobs.map((j) => j.id));
  return {
    customer: rowToCustomerView(row),
    contacts: sortContacts(((contactsRes.data ?? []) as ContactRow[]).map(rowToContactView)),
    jobs,
    quotes: quotes.filter((q) => q.customer?.id === id || (q.job && jobIds.has(q.job.id))),
    emails,
    drawings,
    pricingRow: pricing ? (row as Customer) : null,
  };
}

/** Najde nejnovější historickou nabídku pro dané číslo výkresu (pro reuse ceny + inflace). */
export async function findHistoricalQuote(drawingNumber?: string): Promise<{ found: boolean; unitPrice?: number; note?: string }> {
  if (!drawingNumber || !drawingNumber.trim()) return { found: false };
  if (!(await allowedAccess("workflow", "ai_pricing"))) return { found: false };
  const db = await supa();
  if (!db) return { found: false };
  try {
    const { data, error } = await db
      .from("quote_items")
      .select("quantity, unit_price, quotes(number, total, status, created_at), drawings!inner(drawing_number)")
      .eq("drawings.drawing_number", drawingNumber.trim())
      .order("created_at", { ascending: false, foreignTable: "quotes" })
      .limit(1);
    if (error || !data || !data.length) return { found: false };
    const row = data[0] as {
      quantity: number; unit_price: number | null;
      quotes?: { number: string; total: number | null; status: string; created_at: string } | null;
    };
    const q = row.quotes;
    const unit = row.unit_price ?? (q?.total && row.quantity ? Number(q.total) / row.quantity : undefined);
    return {
      found: true,
      unitPrice: unit ? Math.round(unit * 100) / 100 : undefined,
      note: q ? `nabídka ${q.number} z ${new Date(q.created_at).toLocaleDateString("cs-CZ")} (${q.status})` : undefined,
    };
  } catch {
    return { found: false };
  }
}
