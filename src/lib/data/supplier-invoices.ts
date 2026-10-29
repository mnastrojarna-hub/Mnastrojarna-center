import "server-only";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAccess, type Access } from "@/lib/auth/session";
import type { JobsDb } from "@/lib/jobs/events";
import { isUuid, one, searchNormalize } from "@/lib/jobs/mapping";
import { redactDetail, redactListItem, supplierInvoicePerms } from "@/lib/supplier-invoices/access";
import { invoiceUnallocated, round2, toCents, fromCents } from "@/lib/supplier-invoices/money";
import { normalizeSupplierInvoice } from "@/lib/supplier-invoices/extract";
import { emptyTotals, totalsOf } from "@/lib/supplier-invoices/totals";
import { amountCzkOf, purchaseOrderCost, type CostAllocation } from "@/lib/supplier-invoices/costs";
import { matchSupplier } from "@/lib/supplier-invoices/service";
import type {
  JobInvoiceCosts, JobRefView, SupplierInvoiceAllocationView, SupplierInvoiceDetail, SupplierInvoiceListItem, SupplierInvoicePerms,
  SupplierInvoiceTotals,
} from "@/lib/supplier-invoices/types";
import type {
  SupplierInvoiceAllocationRow, SupplierInvoiceFileRow, SupplierInvoiceItemRow, SupplierInvoiceRow,
} from "@/lib/supplier-invoices/db-types";

/**
 * Datová vrstva Faktur dodavatelů. Čte servisním klíčem → KAŽDÁ veřejná funkce ověří práva
 * (supplierInvoicePerms: vidět / částky / zaplaceno) a výsledek redakuje — do RSC nesmí odejít nic navíc.
 * fetch* funkce berou hotového klienta a práva nehlídají (jen pro kód, který už je ověřil).
 */

type Row = Record<string, unknown>;

function warn(scope: string, error: { message: string } | null | undefined) {
  if (error) console.error(`[data:supplier-invoices:${scope}] Supabase chyba: ${error.message}`);
}

export interface InvoiceSession {
  db: JobsDb;
  access: Access;
  perms: SupplierInvoicePerms;
}

/** Přístup k fakturám (null = nesmí je vidět). */
export async function invoiceSession(): Promise<InvoiceSession | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const access = await getAccess();
    if (!access.user || !access.user.active) return null;
    const perms = supplierInvoicePerms(access.can);
    if (!perms.view) return null;
    const db = await createOperatorClient();
    return { db, access, perms };
  } catch (err) {
    console.error(`[data:supplier-invoices] ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

const n = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

function today(): string {
  return new Date(Date.now() + 2 * 3600_000).toISOString().slice(0, 10);
}

function isOverdue(r: Pick<SupplierInvoiceRow, "due_date" | "payment_status">): boolean {
  return Boolean(r.due_date) && r.payment_status !== "zaplaceno" && (r.due_date as string) < today();
}

async function profileNames(db: JobsDb, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!uniq.length) return new Map();
  const { data } = await db.from("profiles").select("id, full_name, email").in("id", uniq);
  return new Map(((data ?? []) as { id: string; full_name: string | null; email: string | null }[])
    .map((p) => [p.id, (p.full_name ?? "").trim() || (p.email ?? "").trim() || "Neznámý uživatel"]));
}

// ── Seznam ──────────────────────────────────────────────────
export type InvoiceListView = "vse" | "ke_kontrole" | "neprirazene" | "nezaplacene" | "po_splatnosti" | "duplicity";

export interface InvoiceListFilter {
  view?: InvoiceListView;
  supplierId?: string | null;
  jobId?: string | null;
  /** RRRR-MM-DD (datum vystavení, jinak nahrání). */
  from?: string | null;
  to?: string | null;
  q?: string | null;
}

export interface InvoiceListResult {
  items: SupplierInvoiceListItem[];
  totals: SupplierInvoiceTotals;
  suppliers: { id: string; name: string }[];
  perms: SupplierInvoicePerms;
}

const LIST_SELECT = "id, number, supplier_id, supplier_name, issue_date, due_date, currency, exchange_rate, total_net, total_gross, status, "
  + "payment_status, paid_at, paid_amount, is_proforma, duplicate_of_id, source, uploaded_by, created_at, supplier:suppliers!supplier_id(name)";

const missingRateOf = (r: Pick<SupplierInvoiceRow, "currency" | "exchange_rate">) => r.currency !== "CZK" && !(n(r.exchange_rate) ?? 0);

export async function listSupplierInvoices(filter: InvoiceListFilter = {}): Promise<InvoiceListResult | null> {
  const s = await invoiceSession();
  if (!s) return null;
  const { db, perms } = s;
  try {
    let q = db.from("supplier_invoices").select(LIST_SELECT).order("created_at", { ascending: false }).limit(500);
    if (filter.supplierId && isUuid(filter.supplierId)) q = q.eq("supplier_id", filter.supplierId);
    if (filter.from && /^\d{4}-\d{2}-\d{2}$/.test(filter.from)) q = q.gte("issue_date", filter.from);
    if (filter.to && /^\d{4}-\d{2}-\d{2}$/.test(filter.to)) q = q.lte("issue_date", filter.to);
    if (filter.jobId && isUuid(filter.jobId)) {
      const { data: al } = await db.from("supplier_invoice_allocations").select("invoice_id").eq("job_id", filter.jobId).limit(500);
      const ids = [...new Set(((al ?? []) as { invoice_id: string }[]).map((a) => a.invoice_id))];
      if (!ids.length) return { items: [], totals: emptyTotals(perms), suppliers: await supplierOptions(db), perms };
      q = q.in("id", ids);
    }
    const { data, error } = await q;
    warn("list", error);
    const rows = (data ?? []) as unknown as (SupplierInvoiceRow & { supplier?: { name: string } | { name: string }[] | null })[];
    const ids = rows.map((r) => r.id);
    const [items, allocs, files] = ids.length ? await Promise.all([
      db.from("supplier_invoice_items").select("id, invoice_id, amount").in("invoice_id", ids).limit(10_000),
      db.from("supplier_invoice_allocations").select("id, invoice_id, item_id, amount, job_id, target, confirmed_at, job:orders!job_id(number)").in("invoice_id", ids).limit(20_000),
      db.from("supplier_invoice_files").select("invoice_id").in("invoice_id", ids).limit(10_000),
    ]) : [{ data: [] }, { data: [] }, { data: [] }];
    const itemsBy = groupBy((items.data ?? []) as { id: string; invoice_id: string; amount: number }[], (x) => x.invoice_id);
    const allocBy = groupBy((allocs.data ?? []) as (Pick<SupplierInvoiceAllocationRow, "id" | "invoice_id" | "item_id" | "amount" | "job_id" | "target" | "confirmed_at"> & { job?: { number: string } | { number: string }[] | null })[], (x) => x.invoice_id);
    const filesBy = groupBy((files.data ?? []) as { invoice_id: string }[], (x) => x.invoice_id);
    const names = await profileNames(db, rows.map((r) => r.uploaded_by));
    let list: SupplierInvoiceListItem[] = rows.map((r) => {
      const its = (itemsBy.get(r.id) ?? []).map((i) => ({ id: i.id, amount: Number(i.amount) }));
      const al = allocBy.get(r.id) ?? [];
      // zálohová faktura se nerozděluje (do nákladů se nepočítá)
      const unallocated = r.is_proforma ? 0 : invoiceUnallocated(n(r.total_net), its, al.map((a) => ({ itemId: a.item_id, amount: Number(a.amount) })));
      const jobs = new Map<string, string>();
      for (const a of al) if (a.job_id) jobs.set(a.job_id, one(a.job)?.number ?? "");
      return {
        id: r.id, number: r.number, supplierId: r.supplier_id, supplierName: one(r.supplier)?.name ?? r.supplier_name,
        issueDate: r.issue_date, dueDate: r.due_date, currency: r.currency, totalNet: n(r.total_net), totalGross: n(r.total_gross),
        status: r.status, paymentStatus: r.payment_status, paidAt: r.paid_at, paidAmount: n(r.paid_amount), overdue: isOverdue(r),
        unallocated, isProforma: Boolean(r.is_proforma), missingRate: missingRateOf(r), pendingAi: al.filter((a) => !a.confirmed_at).length,
        jobs: [...jobs.entries()].map(([id, number]) => ({ id, number })), hasOverhead: al.some((a) => a.target === "rezie"),
        duplicateOfId: r.duplicate_of_id, source: r.source, uploadedByName: r.uploaded_by ? names.get(r.uploaded_by) ?? null : null,
        createdAt: r.created_at, fileCount: (filesBy.get(r.id) ?? []).length,
      };
    });
    const qn = searchNormalize(filter.q ?? "");
    if (qn) list = list.filter((x) => searchNormalize([x.number, x.supplierName, ...x.jobs.map((j) => j.number)].filter(Boolean).join(" ")).includes(qn));
    const view = filter.view ?? "vse";
    list = list.filter((x) => {
      if (view === "duplicity") return Boolean(x.duplicateOfId);
      if (x.duplicateOfId && view !== "vse") return false;
      if (view === "ke_kontrole") return x.status === "ke_kontrole" || x.status === "nahrano" || x.pendingAi > 0;
      if (view === "neprirazene") return (x.unallocated ?? 0) > 0.004 && x.status !== "zamitnuto" && !x.isProforma;
      if (view === "nezaplacene") return perms.paid && x.paymentStatus !== "zaplaceno" && x.status !== "zamitnuto";
      if (view === "po_splatnosti") return perms.paid && x.overdue === true && x.status !== "zamitnuto";
      return true;
    });
    const totals = totalsOf(list, rows, perms);
    return { items: list.map((x) => redactListItem(x, perms)), totals, suppliers: await supplierOptions(db), perms };
  } catch (err) {
    console.error(`[data:supplier-invoices:list] ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const arr = m.get(k);
    if (arr) arr.push(r);
    else m.set(k, [r]);
  }
  return m;
}


async function supplierOptions(db: JobsDb): Promise<{ id: string; name: string }[]> {
  const { data } = await db.from("suppliers").select("id, name").order("name").limit(2000);
  return ((data ?? []) as { id: string; name: string }[]);
}

// ── Detail ──────────────────────────────────────────────────
type AllocDbRow = SupplierInvoiceAllocationRow & {
  job?: Row | Row[] | null;
  po?: { number: string | null } | { number: string | null }[] | null;
  oi?: { drawing_number: string | null; name: string | null; position: number } | { drawing_number: string | null; name: string | null; position: number }[] | null;
};

const ALLOC_SELECT = "*, job:orders!job_id(id, number, title, customer:customers!customer_id(name)), po:purchase_orders!purchase_order_id(number), "
  + "oi:order_items!order_item_id(drawing_number, name, position)";

function jobRef(v: Row | Row[] | null | undefined): JobRefView | null {
  const j = one(v);
  if (!j || !j.id) return null;
  const c = one(j.customer as Row | Row[] | null);
  return { id: String(j.id), number: String(j.number ?? ""), title: String(j.title ?? ""), customerName: (c?.name as string | undefined) ?? null };
}

function orderItemLabel(v: AllocDbRow["oi"]): string | null {
  const oi = one(v);
  if (!oi) return null;
  return [oi.drawing_number, oi.name].filter(Boolean).join(" · ") || `Položka ${oi.position + 1}`;
}

export async function getSupplierInvoice(id: string): Promise<SupplierInvoiceDetail | null> {
  if (!isUuid(id)) return null;
  const s = await invoiceSession();
  if (!s) return null;
  try {
    return await fetchSupplierInvoiceDetail(s.db, id, s.perms);
  } catch (err) {
    console.error(`[data:supplier-invoices:detail] ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Detail s redakcí podle práv (bez kontroly přístupu — volající ji udělal). */
export async function fetchSupplierInvoiceDetail(db: JobsDb, id: string, perms: SupplierInvoicePerms): Promise<SupplierInvoiceDetail | null> {
  const { data, error } = await db.from("supplier_invoices").select("*, supplier:suppliers!supplier_id(id, name, ico, dic)").eq("id", id).maybeSingle();
  warn("detail", error);
  if (!data) return null;
  const r = data as unknown as SupplierInvoiceRow & { supplier?: Row | Row[] | null };
  const [files, items, allocs, dup] = await Promise.all([
    db.from("supplier_invoice_files").select("*").eq("invoice_id", id).order("position"),
    db.from("supplier_invoice_items").select("*").eq("invoice_id", id).order("position"),
    db.from("supplier_invoice_allocations").select(ALLOC_SELECT).eq("invoice_id", id).order("position"),
    r.duplicate_of_id ? db.from("supplier_invoices").select("id, number, created_at").eq("id", r.duplicate_of_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const allocRows = (allocs.data ?? []) as unknown as AllocDbRow[];
  const names = await profileNames(db, [r.uploaded_by, r.paid_by, r.processed_by, ...allocRows.map((a) => a.confirmed_by)]);
  const sup = one(r.supplier);
  const ex = r.ai_extracted ? normalizeSupplierInvoice(r.ai_extracted) : null;
  const header = {
    name: r.supplier_name ?? "", ico: r.supplier_ico ?? "", dic: r.supplier_dic ?? "", address: r.supplier_address ?? "",
    bankAccount: r.supplier_bank_account ?? "", email: r.supplier_email ?? "", phone: r.supplier_phone ?? "",
  };
  const match = sup ? null : await matchSupplier(db, { name: header.name, ico: header.ico, dic: header.dic, email: header.email });
  let matchRef: SupplierInvoiceDetail["supplierMatch"] = null;
  if (match) {
    const { data: m } = await db.from("suppliers").select("id, name, ico, dic").eq("id", match.id).maybeSingle();
    const mm = m as { id: string; name: string; ico: string | null; dic: string | null } | null;
    if (mm) matchRef = { id: mm.id, name: mm.name, ico: mm.ico, dic: mm.dic, reason: match.reason };
  }
  // objednávky dodavatele (otevřené + ty, na které už odkazuje rozdělení)
  const poIds = allocRows.map((a) => a.purchase_order_id).filter((x): x is string => Boolean(x));
  const supplierId = (sup?.id as string | undefined) ?? null;
  const PO_SEL = "id, number, total, status, job:orders!job_id(id, number, title, customer:customers!customer_id(name))";
  const [bySupplier, byId] = await Promise.all([
    supplierId ? db.from("purchase_orders").select(PO_SEL).eq("supplier_id", supplierId).neq("status", "zrusena").order("created_at", { ascending: false }).limit(50) : Promise.resolve({ data: [] }),
    poIds.length ? db.from("purchase_orders").select(PO_SEL).in("id", poIds) : Promise.resolve({ data: [] }),
  ]);
  const pos = new Map<string, Row>();
  for (const p of [...((bySupplier.data ?? []) as Row[]), ...((byId.data ?? []) as Row[])]) pos.set(String(p.id), p);
  const allocations: SupplierInvoiceAllocationView[] = allocRows.map((a) => ({
    id: a.id, itemId: a.item_id, target: a.target, job: jobRef(a.job), category: a.overhead_category, amount: n(a.amount),
    purchaseOrderId: a.purchase_order_id, purchaseOrderNumber: one(a.po)?.number ?? null, purchaseOrderItemId: a.purchase_order_item_id,
    orderItemId: a.order_item_id, orderItemLabel: orderItemLabel(a.oi), note: a.note, aiSuggested: a.ai_suggested, aiReason: a.ai_reason,
    confirmed: Boolean(a.confirmed_at), confirmedAt: a.confirmed_at, confirmedByName: a.confirmed_by ? names.get(a.confirmed_by) ?? null : (a.confirmed_at ? "✨ AI" : null),
  }));
  const d = dup.data as { id: string; number: string | null; created_at: string } | null;
  const purchaseOrderInvoicing = await poInvoicing(db, r, [...new Set(poIds)]);
  const detail: SupplierInvoiceDetail = {
    id: r.id, number: r.number, variableSymbol: r.variable_symbol, issueDate: r.issue_date, taxableDate: r.taxable_date, dueDate: r.due_date,
    currency: r.currency, exchangeRate: n(r.exchange_rate), totalNet: n(r.total_net), totalVat: n(r.total_vat), totalGross: n(r.total_gross),
    status: r.status, paymentStatus: r.payment_status, paidAt: r.paid_at, paidAmount: n(r.paid_amount),
    paidByName: r.paid_by ? names.get(r.paid_by) ?? null : null, overdue: isOverdue(r), source: r.source, isCreditNote: r.is_credit_note,
    isProforma: Boolean(r.is_proforma), missingRate: missingRateOf(r),
    supplier: sup ? { id: String(sup.id), name: String(sup.name), ico: (sup.ico as string | null) ?? null, dic: (sup.dic as string | null) ?? null } : null,
    supplierHeader: header, supplierMatch: matchRef,
    duplicateOf: d ? { id: d.id, number: d.number, createdAt: d.created_at } : null,
    aiUsed: r.ai_used, aiConfidence: n(r.ai_confidence), aiError: r.ai_error, aiProcessedAt: r.ai_processed_at,
    aiSummary: ex?.summary || null, needsClarification: ex?.needsClarification ?? [], note: r.note,
    uploadedByName: r.uploaded_by ? names.get(r.uploaded_by) ?? null : null, createdAt: r.created_at,
    processedByName: r.processed_by ? names.get(r.processed_by) ?? null : null, processedAt: r.processed_at,
    files: ((files.data ?? []) as SupplierInvoiceFileRow[]).map((f) => ({
      id: f.id, filename: f.filename, mimeType: f.mime_type, size: f.size, href: `/api/supplier-invoices/files/${f.id}`,
    })),
    items: ((items.data ?? []) as SupplierInvoiceItemRow[]).map((i) => ({
      id: i.id, position: i.position, text: i.text, code: i.code, quantity: n(i.quantity), unit: i.unit, unitPrice: n(i.unit_price),
      amount: round2(Number(i.amount)), vatRate: n(i.vat_rate),
    })),
    allocations,
    supplierPurchaseOrders: [...pos.values()].map((p) => ({
      id: String(p.id), number: (p.number as string | null) ?? null, job: jobRef(p.job as Row | Row[] | null), total: n(p.total), status: String(p.status),
    })),
    purchaseOrderInvoicing,
    perms,
  };
  return redactDetail(detail, perms);
}

/** Objednávky, na které je faktura rozdělená: vyfakturováno všemi fakturami, celá / dílčí, konečná (jako SQL). */
async function poInvoicing(db: JobsDb, inv: SupplierInvoiceRow, poIds: string[]): Promise<SupplierInvoiceDetail["purchaseOrderInvoicing"]> {
  if (!poIds.length) return [];
  const [pos, allocs] = await Promise.all([
    db.from("purchase_orders").select("id, number, total, status, job:orders!job_id(number), items:purchase_order_items(id)").in("id", poIds),
    db.from("supplier_invoice_allocations")
      .select("purchase_order_id, purchase_order_item_id, amount, confirmed_at, invoice:supplier_invoices!invoice_id(id, number, currency, exchange_rate, status, duplicate_of_id, is_proforma, final_po_ids)")
      .in("purchase_order_id", poIds).not("confirmed_at", "is", null).limit(5000),
  ]);
  const rows: CostAllocation[] = [];
  for (const a of (allocs.data ?? []) as unknown as { purchase_order_id: string; purchase_order_item_id: string | null; amount: number; invoice: Row | Row[] | null }[]) {
    const i = one(a.invoice);
    if (!i || i.status === "zamitnuto" || i.duplicate_of_id || i.is_proforma) continue;
    const finals = Array.isArray(i.final_po_ids) ? (i.final_po_ids as string[]) : [];
    rows.push({
      purchaseOrderId: a.purchase_order_id, purchaseOrderItemId: a.purchase_order_item_id, confirmed: true,
      amountCzk: amountCzkOf(Number(a.amount), i.currency, i.exchange_rate), poFinal: finals.includes(a.purchase_order_id),
      invoiceNumber: (i.number as string | null) ?? null, currency: String(i.currency ?? "CZK"),
    });
  }
  return ((pos.data ?? []) as Row[]).filter((p) => p.status !== "zrusena").map((p) => {
    const id = String(p.id);
    const c = purchaseOrderCost({
      id, number: (p.number as string | null) ?? null, status: String(p.status), total: Number(p.total ?? 0), hasUnpriced: false,
      itemIds: ((p.items ?? []) as Row[]).map((x) => String(x.id)),
    }, rows);
    return {
      id, number: (p.number as string | null) ?? null, jobNumber: (one(p.job as Row | Row[] | null)?.number as string | undefined) ?? null,
      total: n(p.total), invoiced: c.noRate ? null : c.inv, complete: c.complete, final: (inv.final_po_ids ?? []).includes(id),
    };
  });
}

// ── Zakázka: blok „Faktury dodavatelů" a náklad ─────────────
export async function getJobInvoiceCosts(jobId: string): Promise<JobInvoiceCosts | null> {
  if (!isUuid(jobId)) return null;
  const s = await invoiceSession();
  if (!s || !s.perms.amounts) return null;
  try {
    const { data, error } = await s.db.from("supplier_invoice_allocations")
      .select("id, invoice_id, item_id, amount, purchase_order_id, purchase_order_item_id, confirmed_at, ai_suggested, "
        + "invoice:supplier_invoices!invoice_id(number, supplier_name, currency, exchange_rate, issue_date, status, duplicate_of_id, is_proforma, final_po_ids, supplier:suppliers!supplier_id(name)), "
        + "item:supplier_invoice_items!item_id(text), po:purchase_orders!purchase_order_id(id, number, total, status, items:purchase_order_items(id)), oi:order_items!order_item_id(drawing_number, name, position)")
      .eq("job_id", jobId).eq("target", "job").order("created_at").limit(500);
    warn("job-costs", error);
    const rows = (data ?? []) as unknown as Row[];
    const live = rows.filter((a) => {
      const inv = one(a.invoice as Row | Row[] | null);
      // zamítnuté, duplicitní a zálohové faktury se do nákladu nepočítají (jako SQL job_invoice_allocations)
      return inv && inv.status !== "zamitnuto" && !inv.duplicate_of_id && !inv.is_proforma;
    });
    const allocations = live.map((a) => {
      const inv = one(a.invoice as Row | Row[] | null) as Row;
      const amount = Number(a.amount);
      return {
        id: String(a.id), invoiceId: String(a.invoice_id), invoiceNumber: (inv.number as string | null) ?? null,
        supplierName: (one(inv.supplier as Row | Row[] | null)?.name as string | undefined) ?? (inv.supplier_name as string | null) ?? null,
        itemText: (one(a.item as Row | Row[] | null)?.text as string | undefined) ?? null, amount,
        amountCzk: amountCzkOf(amount, inv.currency, inv.exchange_rate),
        currency: String(inv.currency ?? "CZK"), purchaseOrderNumber: (one(a.po as Row | Row[] | null)?.number as string | undefined) ?? null,
        orderItemLabel: orderItemLabel(a.oi as AllocDbRow["oi"]), confirmed: Boolean(a.confirmed_at), aiSuggested: Boolean(a.ai_suggested),
        issueDate: (inv.issue_date as string | null) ?? null,
      };
    });
    const confirmed = allocations.filter((a) => a.confirmed);
    // objednávky s fakturou: celá / dílčí a co jde do nákladu (stejná pravidla jako SQL job_purchase_order_costs)
    const costRows: CostAllocation[] = live.filter((a) => a.confirmed_at).map((a) => {
      const inv = one(a.invoice as Row | Row[] | null) as Row;
      const finals = Array.isArray(inv.final_po_ids) ? (inv.final_po_ids as string[]) : [];
      return {
        purchaseOrderId: (a.purchase_order_id as string | null) ?? null, purchaseOrderItemId: (a.purchase_order_item_id as string | null) ?? null,
        amountCzk: amountCzkOf(Number(a.amount), inv.currency, inv.exchange_rate), confirmed: true,
        poFinal: Boolean(a.purchase_order_id && finals.includes(a.purchase_order_id as string)),
      };
    });
    const pos = new Map<string, Row>();
    for (const a of live) {
      const po = one(a.po as Row | Row[] | null);
      if (po && a.confirmed_at && po.status !== "zrusena") pos.set(String(po.id), po);
    }
    const invoicedPurchaseOrders = [...pos.values()].map((po) => {
      const c = purchaseOrderCost({
        id: String(po.id), number: (po.number as string | null) ?? null, status: String(po.status), total: Number(po.total ?? 0), hasUnpriced: false,
        itemIds: ((po.items ?? []) as Row[]).map((x) => String(x.id)),
      }, costRows);
      return { id: c.id, number: c.number, poTotal: c.total, invoiced: c.inv, complete: c.complete, counted: c.contributes };
    });
    return {
      allocations,
      confirmedTotal: fromCents(confirmed.reduce((s2, a) => s2 + toCents(a.amountCzk ?? 0), 0)),
      pendingTotal: fromCents(allocations.filter((a) => !a.confirmed).reduce((s2, a) => s2 + toCents(a.amountCzk ?? 0), 0)),
      invoicedPurchaseOrders,
      missingRate: confirmed.some((a) => a.amountCzk === null),
    };
  } catch (err) {
    console.error(`[data:supplier-invoices:job] ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Počet faktur u dodavatelů (Dodavatelé, jen s právem). */
export async function supplierInvoiceCounts(): Promise<Record<string, number> | null> {
  const s = await invoiceSession();
  if (!s) return null;
  const { data, error } = await s.db.from("supplier_invoices").select("supplier_id").not("supplier_id", "is", null).is("duplicate_of_id", null).limit(10_000);
  warn("counts", error);
  const out: Record<string, number> = {};
  for (const r of (data ?? []) as { supplier_id: string }[]) out[r.supplier_id] = (out[r.supplier_id] ?? 0) + 1;
  return out;
}

/** ⌘K: faktury (jen s právem; bez částek). */
export async function supplierInvoiceSearchEntries(): Promise<{ id: string; label: string; hint: string; href: string; keywords: string }[]> {
  const s = await invoiceSession();
  if (!s) return [];
  const { data } = await s.db.from("supplier_invoices").select("id, number, supplier_name, issue_date, supplier:suppliers!supplier_id(name)")
    .order("created_at", { ascending: false }).limit(1000);
  return ((data ?? []) as unknown as { id: string; number: string | null; supplier_name: string | null; issue_date: string | null; supplier: Row | Row[] | null }[]).map((r) => {
    const name = (one(r.supplier)?.name as string | undefined) ?? r.supplier_name ?? "";
    return {
      id: r.id, label: `Faktura ${r.number ?? "bez čísla"}`, hint: [name, r.issue_date].filter(Boolean).join(" · "),
      href: `/supplier-invoices/${r.id}`, keywords: searchNormalize([r.number, name, "faktura dodavatel"].filter(Boolean).join(" ")),
    };
  });
}

/** Výběr zakázky pro rozdělení: číslo, název, zákazník, č. objednávky zákazníka, výkres. */
export async function searchJobsForInvoice(db: JobsDb, qRaw: string): Promise<(JobRefView & { hint: string | null })[]> {
  const q = (qRaw ?? "").replace(/[%_,()*\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  const SEL = "id, number, title, status, customer_order_number, customer:customers!customer_id(name)";
  const out = new Map<string, JobRefView & { hint: string | null }>();
  const push = (rows: Row[], hint?: (r: Row) => string | null) => {
    for (const r of rows) {
      if (out.size >= 20 || out.has(String(r.id))) continue;
      const c = one(r.customer as Row | Row[] | null);
      out.set(String(r.id), {
        id: String(r.id), number: String(r.number ?? ""), title: String(r.title ?? ""), customerName: (c?.name as string | undefined) ?? null,
        hint: hint ? hint(r) : r.customer_order_number ? `obj. ${r.customer_order_number}` : null,
      });
    }
  };
  if (q.length < 2) {
    const { data } = await db.from("orders").select(SEL).is("merged_into_id", null).not("status", "in", "(nerealizovano,zruseno)")
      .order("updated_at", { ascending: false }).limit(15);
    push((data ?? []) as Row[]);
    return [...out.values()];
  }
  const like = `%${q}%`;
  const [a, cust, items] = await Promise.all([
    db.from("orders").select(SEL).is("merged_into_id", null).or(`number.ilike.${like},title.ilike.${like},customer_order_number.ilike.${like}`)
      .order("created_at", { ascending: false }).limit(20),
    db.from("customers").select("id").ilike("name", like).limit(20),
    db.from("order_items").select("order_id, drawing_number").ilike("drawing_number", like).limit(40),
  ]);
  push((a.data ?? []) as Row[]);
  const custIds = ((cust.data ?? []) as { id: string }[]).map((c) => c.id);
  if (custIds.length) {
    const { data } = await db.from("orders").select(SEL).is("merged_into_id", null).in("customer_id", custIds).order("created_at", { ascending: false }).limit(20);
    push((data ?? []) as Row[]);
  }
  const itemRows = (items.data ?? []) as { order_id: string; drawing_number: string | null }[];
  if (itemRows.length) {
    const dn = new Map(itemRows.map((i) => [i.order_id, i.drawing_number]));
    const { data } = await db.from("orders").select(SEL).is("merged_into_id", null).in("id", [...dn.keys()].slice(0, 40)).limit(40);
    push((data ?? []) as Row[], (r) => (dn.get(String(r.id)) ? `výkres ${dn.get(String(r.id))}` : null));
  }
  return [...out.values()];
}

/** Položky zakázky (rozpad nákladu na položky). */
export async function jobItemsForInvoice(db: JobsDb, jobId: string): Promise<{ id: string; label: string }[]> {
  if (!isUuid(jobId)) return [];
  const { data } = await db.from("order_items").select("id, drawing_number, name, position").eq("order_id", jobId).order("position").limit(200);
  return ((data ?? []) as { id: string; drawing_number: string | null; name: string | null; position: number }[])
    .map((i) => ({ id: i.id, label: [i.drawing_number, i.name].filter(Boolean).join(" · ") || `Položka ${i.position + 1}` }));
}
