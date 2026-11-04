import type { JobsDb } from "@/lib/jobs/events";
import { cleanNumber } from "@/lib/jobs/mapping";
import {
  DISTRIBUTE_MODE_LABELS, defaultMode, distributeJobValue, formatKc, isInvoiced, itemsSaleValue, pairQuoteItems, quotePriceWarning,
  type ConsistencyPo, type ConsistencySnapshot, type DistributeMode, type QuoteRef,
} from "@/lib/jobs/consistency";

/**
 * Načtení údajů zakázky pro kontrolu křížové konzistence (server, servisní klíč).
 * Vrací snímek pro consistencyIssues / zámky a id položek (pořadí = pozice).
 */

export interface JobMoneyContext {
  jobId: string;
  snapshot: ConsistencySnapshot;
  /** Id položek ve stejném pořadí jako snapshot.items. */
  itemIds: string[];
  number: string | null;
  quoteId: string | null;
}

type Row = Record<string, unknown>;

function itemLabel(r: Row): string {
  return [r.drawing_number, r.name].map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean).join(" ")
    || `položka ${Number(r.position ?? 0) + 1}`;
}

export async function loadJobMoneyContext(db: JobsDb, jobId: string, opts: { margins?: boolean } = {}): Promise<JobMoneyContext | null> {
  const [jobRes, itemsRes, quotesRes, posRes] = await Promise.all([
    db.from("orders").select("id, number, status, value, purchase_cost, currency, invoice_number, invoiced_at, quote_id, due_date, customer_required_date, max_tolerated_date").eq("id", jobId).maybeSingle(),
    db.from("order_items").select("id, position, drawing_number, name, quantity, unit_price, purchase_unit_price").eq("order_id", jobId).order("position"),
    db.from("quotes").select("id, number, state, status, total, archived, sent_at").eq("job_id", jobId),
    opts.margins === false
      ? Promise.resolve({ data: null })
      : db.from("purchase_orders").select("id, number, status, total, required_date, confirmed_date, items:purchase_order_items!purchase_order_id(order_item_id, quantity)").eq("job_id", jobId),
  ]);
  const j = jobRes.data as Row | null;
  if (!j) return null;
  const items = ((itemsRes.data ?? []) as Row[]);
  const quotes: QuoteRef[] = ((quotesRes.data ?? []) as Row[]).map((q) => ({
    id: String(q.id), number: (q.number as string | null) ?? null, state: (q.state as string | null) ?? null,
    status: (q.status as string | null) ?? null, total: cleanNumber(q.total), archived: q.archived === true,
    sentAt: (q.sent_at as string | null) ?? null, accepted: q.id === j.quote_id && q.state !== "zamitnuta",
  }));
  const pos: ConsistencyPo[] | null = posRes.data === null ? null : ((posRes.data ?? []) as Row[]).map((p) => ({
    id: String(p.id), number: (p.number as string | null) ?? null, status: String(p.status), total: cleanNumber(p.total),
    requiredDate: (p.required_date as string | null) ?? null, confirmedDate: (p.confirmed_date as string | null) ?? null,
    items: ((p.items ?? []) as Row[]).map((it) => ({ orderItemId: (it.order_item_id as string | null) ?? null, quantity: cleanNumber(it.quantity) ?? 0 })),
  }));
  return {
    jobId,
    number: (j.number as string | null) ?? null,
    quoteId: (j.quote_id as string | null) ?? null,
    itemIds: items.map((r) => String(r.id)),
    snapshot: {
      value: cleanNumber(j.value),
      purchaseCost: opts.margins === false ? null : cleanNumber(j.purchase_cost),
      currency: String(j.currency || "CZK"),
      invoiceNumber: (j.invoice_number as string | null) ?? null,
      invoicedAt: (j.invoiced_at as string | null) ?? null,
      stage: (j.status as string | null) ?? null,
      items: items.map((r) => ({
        id: String(r.id), quantity: cleanNumber(r.quantity) ?? 0, unitPrice: cleanNumber(r.unit_price),
        purchaseUnitPrice: opts.margins === false ? null : cleanNumber(r.purchase_unit_price), label: itemLabel(r),
      })),
      quotes,
      purchaseOrders: pos,
      margins: opts.margins !== false,
      dueDate: (j.due_date as string | null) ?? null,
      customerRequiredDate: (j.customer_required_date as string | null) ?? null,
      maxToleratedDate: (j.max_tolerated_date as string | null) ?? null,
    },
  };
}

// ── Rozpočítání hodnoty zakázky na položky (sdílí updateJob i setJobValue) ──
export type ApplyValueResult =
  | { ok: true; value: number | null; requested: number; exact: boolean; changed: number; mode: DistributeMode | null; warning?: string }
  | { ok: false; error: string };

/**
 * Nová hodnota zakázky při naceněných položkách → rozpočítat na prodejní ceny položek (jedna transakce
 * v DB: apply_job_item_prices). Hodnota zakázky pak = Σ položek (trigger), historie dostane popis.
 */
export async function applyJobValueToItems(
  db: JobsDb, ctx: JobMoneyContext, target: number, modeIn?: DistributeMode | null,
): Promise<ApplyValueResult> {
  const { snapshot } = ctx;
  const cur = snapshot.currency || "CZK";
  const mode = modeIn ?? defaultMode(snapshot.items, target);
  if (!mode) return { ok: false, error: "Položky nemají počet kusů — hodnotu není na co rozpočítat." };
  const r = distributeJobValue(snapshot.items, target, mode);
  if (!r.ok) return { ok: false, error: r.error };
  const before = itemsSaleValue(snapshot.items) ?? snapshot.value;
  if (!r.changes.length) {
    return { ok: true, value: before, requested: r.requested, exact: r.exact, changed: 0, mode };
  }
  const list = r.changes.slice(0, 4).map((c) => {
    const it = snapshot.items[c.index];
    return `${(it.label ?? "").trim() || `položka ${c.index + 1}`} ${c.from === null ? "bez ceny" : formatKc(c.from, cur)} → ${formatKc(c.to, cur)}/ks`;
  });
  const more = r.changes.length > 4 ? ` a další (${r.changes.length - 4})` : "";
  const inexact = r.exact ? "" : ` (přesně ${formatKc(r.requested, cur)} se na haléře za kus složit nedá)`;
  const message = `Hodnota zakázky ${formatKc(before, cur)} → ${formatKc(r.achieved, cur)} rozpočítána na položky — ${DISTRIBUTE_MODE_LABELS[mode].toLowerCase()}: ${list.join(", ")}${more}${inexact}`;
  const prices = r.changes.map((c) => ({ id: ctx.itemIds[c.index], unit_price: c.to }));
  const rpc = db.rpc as unknown as (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc.call(db, "apply_job_item_prices", {
    p_job: ctx.jobId,
    p_prices: prices,
    p_message: message,
    p_data: { distribution: { mode, requested: r.requested, achieved: r.achieved, exact: r.exact, items: r.changes.length } },
  });
  if (error) return { ok: false, error: error.message };
  const value = cleanNumber(data) ?? r.achieved;
  const warning = quotePriceWarning(snapshot.quotes ?? [], value, cur) ?? undefined;
  return { ok: true, value, requested: r.requested, exact: r.exact, changed: r.changes.length, mode, ...(warning ? { warning } : {}) };
}

/**
 * Ceny přijaté nabídky na spárované položky zakázky (jen změněné). Vyfakturovanou zakázku nemění.
 * Vrací, kolik položek dostalo novou cenu.
 */
export async function applyQuotePricesToItems(db: JobsDb, jobId: string, quoteItems: Row[]): Promise<{ changed: number; invoiced: boolean }> {
  const { data: jobData } = await db.from("orders").select("invoice_number, invoiced_at").eq("id", jobId).maybeSingle();
  const job = jobData as Row | null;
  if (job && isInvoiced({ invoiceNumber: job.invoice_number as string | null, invoicedAt: job.invoiced_at as string | null })) {
    return { changed: 0, invoiced: true };
  }
  const { data } = await db.from("order_items").select("id, position, drawing_number, name, quantity, unit_price").eq("order_id", jobId).order("position");
  const jobItems = (data ?? []) as Row[];
  const qItems = [...quoteItems].sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0));
  if (!jobItems.length || !qItems.length) return { changed: 0, invoiced: false };
  const pairs = pairQuoteItems(
    jobItems.map((r) => ({ drawingNumber: r.drawing_number as string | null, name: r.name as string | null })),
    qItems.map((r) => ({ drawingNumber: r.drawing_number as string | null, name: r.name as string | null })),
  );
  let changed = 0;
  for (const [ji, qi] of pairs) {
    const price = cleanNumber(qItems[qi]?.unit_price);
    if (price === null || cleanNumber(jobItems[ji].unit_price) === price) continue;
    const { error } = await db.from("order_items").update({ unit_price: price } as never).eq("id", jobItems[ji].id as string).eq("order_id", jobId);
    if (error) console.error(`[consistency] Cena položky z přijaté nabídky se nepodařila zapsat: ${error.message}`);
    else changed += 1;
  }
  return { changed, invoiced: false };
}
