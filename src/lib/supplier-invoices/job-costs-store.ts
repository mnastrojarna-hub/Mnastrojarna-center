import "server-only";
import type { JobsDb } from "@/lib/jobs/events";
import { one } from "@/lib/jobs/mapping";
import { amountCzkOf, type CostAllocation } from "@/lib/supplier-invoices/costs";

/** Vstup výpočtu nákladu zakázky z faktur dodavatelů (bez kontroly práv — volá ho jen nákup s právem „margins"). */

type Row = Record<string, unknown>;

function warn(scope: string, error: { message: string } | null | undefined) {
  if (error) console.error(`[supplier-invoices:${scope}] Supabase chyba: ${error.message}`);
}

/**
 * Potvrzené i navržené alokace zakázky (v Kč) — vstup výpočtu nákladu (bez kontroly práv). Zamítnuté,
 * duplicitní a zálohové faktury se nepočítají (stejně jako SQL job_invoice_allocations).
 */
export async function fetchJobInvoiceAllocations(db: JobsDb, jobId: string): Promise<(CostAllocation & { invoiceId: string })[]> {
  const { data, error } = await db.from("supplier_invoice_allocations")
    .select("invoice_id, purchase_order_id, purchase_order_item_id, amount, confirmed_at, "
      + "invoice:supplier_invoices!invoice_id(number, exchange_rate, currency, status, duplicate_of_id, is_proforma, final_po_ids)")
    .eq("job_id", jobId).eq("target", "job").limit(2000);
  warn("job-allocs", error);
  const out: (CostAllocation & { invoiceId: string })[] = [];
  for (const a of (data ?? []) as unknown as { invoice_id: string; purchase_order_id: string | null; purchase_order_item_id: string | null; amount: number; confirmed_at: string | null; invoice: Row | Row[] | null }[]) {
    const inv = one(a.invoice);
    if (!inv || inv.status === "zamitnuto" || inv.duplicate_of_id || inv.is_proforma) continue;
    const finals = Array.isArray(inv.final_po_ids) ? (inv.final_po_ids as string[]) : [];
    out.push({
      invoiceId: a.invoice_id, purchaseOrderId: a.purchase_order_id, purchaseOrderItemId: a.purchase_order_item_id,
      amountCzk: amountCzkOf(Number(a.amount), inv.currency, inv.exchange_rate), confirmed: Boolean(a.confirmed_at),
      poFinal: Boolean(a.purchase_order_id && finals.includes(a.purchase_order_id)),
      invoiceNumber: (inv.number as string | null) ?? null, currency: String(inv.currency ?? "CZK"),
    });
  }
  return out;
}
