import "server-only";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAccess } from "@/lib/auth/session";
import type { JobsDb } from "@/lib/jobs/events";
import type { PurchaseOrderStatus } from "@/lib/supabase/database.types";
import type {
  JobPurchasing, PurchaseOrderListItem, PurchaseOrderView, PurchaseSupplierRef, SupplierQuoteView,
} from "@/lib/jobs/purchasing-types";
import { cleanNumber, fetchPaged, isUuid, one, personRef, type PersonEmbed } from "@/lib/jobs/mapping";
import {
  PURCHASE_ORDER_LIST_SELECT, PURCHASE_ORDER_SELECT, SUPPLIER_QUOTE_SELECT, filterPurchaseOrders,
  isPurchaseOrderStatus, purchasingTotals, rowToCommissionView, rowToPurchaseOrderListItem,
  rowToPurchaseOrderView, rowToSupplierQuoteView, rowToSupplierRef,
  type CommissionDbRow, type PurchaseOrderDbRow, type SupplierEmbedRow, type SupplierQuoteDbRow,
} from "@/lib/jobs/purchasing";

/**
 * Datová vrstva nákupu zakázky (nabídky dodavatelů, objednávky vydané, provize).
 * Čte servisním klíčem → veřejné funkce samy ověří právo „margins" (nákupní ceny
 * a marže vidí jen super admin a obchodník). Funkce fetch* berou hotového klienta
 * a oprávnění NEhlídají — volá je jen kód, který už checkFeature("margins") prošel.
 */

const MAX_ROWS = 2000;

function warn(scope: string, error: { message: string } | null | undefined) {
  if (error) console.error(`[data:purchasing:${scope}] Supabase chyba: ${error.message}`);
}

async function session() {
  if (!isSupabaseConfigured()) return null;
  try {
    const access = await getAccess();
    if (!access.user || !access.user.active || !access.can("margins")) return null;
    const db = await createOperatorClient();
    return { db, access };
  } catch (err) {
    console.error(`[data:purchasing] ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ── Načítání s hotovým klientem (bez kontroly práv) ─────────
export async function fetchSupplierQuotes(db: JobsDb, jobId: string): Promise<SupplierQuoteView[]> {
  const { data, error } = await db
    .from("supplier_quotes")
    .select(SUPPLIER_QUOTE_SELECT)
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });
  warn("quotes", error);
  return ((data ?? []) as unknown as SupplierQuoteDbRow[]).map(rowToSupplierQuoteView);
}

export async function fetchSupplierQuote(db: JobsDb, id: string): Promise<SupplierQuoteView | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await db.from("supplier_quotes").select(SUPPLIER_QUOTE_SELECT).eq("id", id).maybeSingle();
  warn("quote", error);
  return data ? rowToSupplierQuoteView(data as unknown as SupplierQuoteDbRow) : null;
}

export async function fetchPurchaseOrders(db: JobsDb, jobId: string): Promise<PurchaseOrderView[]> {
  const { data, error } = await db
    .from("purchase_orders")
    .select(PURCHASE_ORDER_SELECT)
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });
  warn("orders", error);
  return ((data ?? []) as unknown as PurchaseOrderDbRow[]).map(rowToPurchaseOrderView);
}

export async function fetchPurchaseOrder(db: JobsDb, id: string): Promise<PurchaseOrderView | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await db.from("purchase_orders").select(PURCHASE_ORDER_SELECT).eq("id", id).maybeSingle();
  warn("order", error);
  return data ? rowToPurchaseOrderView(data as unknown as PurchaseOrderDbRow) : null;
}

export async function fetchSupplierRef(db: JobsDb, id: string | null | undefined): Promise<PurchaseSupplierRef | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await db
    .from("suppliers")
    .select("id, name, email, phone, ico, dic, address, contact_person, country")
    .eq("id", id)
    .maybeSingle();
  warn("supplier", error);
  return rowToSupplierRef(data as SupplierEmbedRow | null);
}

// ── Veřejné funkce (s kontrolou práva „margins") ────────────
interface JobMoneyRow {
  id: string;
  value: number | string | null;
  purchase_cost: number | string | null;
  owner_id: string | null;
  owner?: PersonEmbed | PersonEmbed[] | null;
}

/** Nákupní strana zakázky; null = zakázka neexistuje nebo uživatel nemá právo na marže. */
export async function getJobPurchasing(jobId: string): Promise<JobPurchasing | null> {
  if (!isUuid(jobId)) return null;
  const s = await session();
  if (!s) return null;
  try {
    const [jobRes, quotes, orders, commRes] = await Promise.all([
      s.db
        .from("orders")
        .select("id, value, purchase_cost, owner_id, owner:profiles!owner_id(id, full_name, email)")
        .eq("id", jobId)
        .maybeSingle(),
      fetchSupplierQuotes(s.db, jobId),
      fetchPurchaseOrders(s.db, jobId),
      s.db.from("commission_entries").select("*").eq("order_id", jobId).maybeSingle(),
    ]);
    warn("job", jobRes.error);
    warn("commission", commRes.error);
    const job = jobRes.data as JobMoneyRow | null;
    if (!job) return null;

    const owner = personRef(job.owner);
    const comm = commRes.data as CommissionDbRow | null;
    let commission = null;
    if (comm) {
      let ownerName = owner && owner.id === comm.owner_id ? owner.name : "";
      if (!ownerName) {
        const { data: p } = await s.db.from("profiles").select("id, full_name, email").eq("id", comm.owner_id).maybeSingle();
        ownerName = personRef(p as PersonEmbed | null)?.name ?? "Neznámý obchodník";
      }
      commission = rowToCommissionView(comm, ownerName);
    }

    return {
      supplierQuotes: quotes,
      purchaseOrders: orders,
      commission,
      owner,
      totals: purchasingTotals({
        revenue: cleanNumber(job.value),
        plannedCost: cleanNumber(job.purchase_cost),
        purchaseOrders: orders,
      }),
    };
  } catch (err) {
    console.error(`[data:purchasing:job] ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Jedna objednávka vydaná (detail / náhled PDF). */
export async function getPurchaseOrder(id: string): Promise<PurchaseOrderView | null> {
  if (!isUuid(id)) return null;
  const s = await session();
  if (!s) return null;
  try {
    return await fetchPurchaseOrder(s.db, id);
  } catch (err) {
    console.error(`[data:purchasing:order] ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Přehled „Objednávky dodavatelům" napříč zakázkami (nejnovější první). */
export async function listPurchaseOrders(
  opts: { status?: PurchaseOrderStatus[]; supplierId?: string; jobId?: string; q?: string; limit?: number } = {},
): Promise<PurchaseOrderListItem[]> {
  const s = await session();
  if (!s) return [];
  try {
    if (opts.supplierId && !isUuid(opts.supplierId)) return [];
    if (opts.jobId && !isUuid(opts.jobId)) return [];
    const statuses = (opts.status ?? []).filter(isPurchaseOrderStatus);
    const build = () => {
      let query = s.db.from("purchase_orders").select(PURCHASE_ORDER_LIST_SELECT);
      if (statuses.length) query = query.in("status", statuses);
      if (opts.supplierId) query = query.eq("supplier_id", opts.supplierId);
      if (opts.jobId) query = query.eq("job_id", opts.jobId);
      return query.order("created_at", { ascending: false }).order("id");
    };
    const { data, error } = await fetchPaged<PurchaseOrderDbRow>(
      (from, to) => build().range(from, to) as unknown as PromiseLike<{ data: PurchaseOrderDbRow[] | null; error: { message: string } | null }>,
      MAX_ROWS,
    );
    warn("list", error);
    if (error) return [];
    const items = filterPurchaseOrders(data.map(rowToPurchaseOrderListItem), opts.q);
    const limit = opts.limit && opts.limit > 0 ? Math.floor(opts.limit) : undefined;
    return limit ? items.slice(0, limit) : items;
  } catch (err) {
    console.error(`[data:purchasing:list] ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/** Jméno a kontakt uživatele pro podpis objednávky / e-mailu. */
export async function fetchProfileContact(
  db: JobsDb,
  userId: string,
): Promise<{ name: string | null; email: string | null; phone: string | null }> {
  const { data } = await db.from("profiles").select("id, full_name, email, phone").eq("id", userId).maybeSingle();
  const p = one(data as { id: string; full_name: string | null; email: string | null; phone: string | null } | null);
  return {
    name: (p?.full_name ?? "").trim() || null,
    email: (p?.email ?? "").trim() || null,
    phone: (p?.phone ?? "").trim() || null,
  };
}
