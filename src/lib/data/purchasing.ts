import "server-only";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAccess } from "@/lib/auth/session";
import type { JobsDb } from "@/lib/jobs/events";
import type { PurchaseOrderStatus } from "@/lib/supabase/database.types";
import type {
  JobCommissionView, JobPurchasing, PurchaseOrderListItem, PurchaseOrderView, PurchaseSupplierRef, SupplierQuoteView,
} from "@/lib/jobs/purchasing-types";
import { cleanNumber, fetchPaged, isUuid, one, personRef, type PersonEmbed } from "@/lib/jobs/mapping";
import {
  PURCHASE_ORDER_LIST_SELECT, PURCHASE_ORDER_SELECT, SUPPLIER_QUOTE_SELECT, filterPurchaseOrders,
  isPurchaseOrderStatus, purchasingTotals, rowToCommissionView, rowToPurchaseOrderListItem,
  rowToPurchaseOrderView, rowToSupplierQuoteView, rowToSupplierRef,
  type CommissionDbRow, type PurchaseOrderDbRow, type SupplierEmbedRow, type SupplierQuoteDbRow,
} from "@/lib/jobs/purchasing";
import type { FlowScope } from "@/lib/auth/flow-scope";
import { maskPurchaseOrderListItem } from "@/lib/auth/price-visibility";

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

/**
 * #25: přehled „Objednávky dodavatelům" vidí každý s obchodním tokem (workflow) — bez práva na
 * nákupní ceny (margins) jen maskovaně (bez cen, volného textu, PDF a akcí). Detail objednávky,
 * nákup zakázky a akce dál jen s margins (session výše).
 */
async function listSession() {
  if (!isSupabaseConfigured()) return null;
  try {
    const access = await getAccess();
    if (!access.user || !access.user.active || !(access.can("workflow") || access.can("margins"))) return null;
    const db = await createOperatorClient();
    return { db, access, margins: access.can("margins") };
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

/** Řádek commission_entries včetně sloupců pásmové provize (migrace 0021). */
type CommissionFullRow = CommissionDbRow & {
  collected?: boolean | null;
  estimated_commission?: number | string | null;
};

/** View provize zakázky vč. pásmové provize z inkasa (základ, inkaso, odhad). */
export function toJobCommissionView(row: CommissionFullRow, ownerName: string): JobCommissionView {
  const view = rowToCommissionView(row, ownerName);
  return {
    ...view,
    base: row.base === "margin_tiered" ? "margin_tiered" : view.base,
    collected: Boolean(row.collected),
    estimatedCommission: cleanNumber(row.estimated_commission),
  };
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
    const [jobRes, quotes, orders, commRes, pendingRes] = await Promise.all([
      s.db
        .from("orders")
        .select("id, value, purchase_cost, owner_id, owner:profiles!owner_id(id, full_name, email)")
        .eq("id", jobId)
        .maybeSingle(),
      fetchSupplierQuotes(s.db, jobId),
      fetchPurchaseOrders(s.db, jobId),
      s.db.from("commission_entries").select("*").eq("order_id", jobId).maybeSingle(),
      s.db
        .from("job_files")
        .select("id, title, filename, ai_extracted, created_at")
        .eq("job_id", jobId)
        .eq("archived", false)
        .eq("ai_extracted->>purchasingPending", "true")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    warn("pending", pendingRes.error);
    warn("job", jobRes.error);
    warn("commission", commRes.error);
    const job = jobRes.data as JobMoneyRow | null;
    if (!job) return null;

    const owner = personRef(job.owner);
    const comm = commRes.data as CommissionFullRow | null;
    let commission: JobCommissionView | null = null;
    // #25: provizi zakázky vidí jen její obchodník (komu patří) a kdo vidí provize všech (super admin)
    const commissionHidden = Boolean(comm) && !s.access.can("commissions_all") && comm!.owner_id !== s.access.user!.id;
    if (comm && !commissionHidden) {
      let ownerName = owner && owner.id === comm.owner_id ? owner.name : "";
      if (!ownerName) {
        const { data: p } = await s.db.from("profiles").select("id, full_name, email").eq("id", comm.owner_id).maybeSingle();
        ownerName = personRef(p as PersonEmbed | null)?.name ?? "Neznámý obchodník";
      }
      commission = toJobCommissionView(comm, ownerName);
    }

    const pendingCaptured = ((pendingRes.data ?? []) as { id: string; title: string | null; filename: string; ai_extracted: Record<string, unknown> | null; created_at: string }[])
      .map((f) => {
        const sup = f.ai_extracted?.supplier;
        const supplierName = sup && typeof sup === "object" && typeof (sup as Record<string, unknown>).name === "string"
          ? ((sup as Record<string, unknown>).name as string)
          : "";
        return { fileId: f.id, title: f.title ?? f.filename, supplierName, createdAt: f.created_at };
      });
    return {
      supplierQuotes: quotes,
      purchaseOrders: orders,
      commission,
      ...(commissionHidden ? { commissionHidden: true } : {}),
      owner,
      pendingCaptured,
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

type PageResult = PromiseLike<{ data: PurchaseOrderDbRow[] | null; error: { message: string } | null }>;
type PoQuery = { in: (c: string, v: string[]) => PoQuery; or: (f: string) => PoQuery; range: (a: number, b: number) => PageResult };

/**
 * Přehled „Objednávky dodavatelům" napříč zakázkami (nejnovější první).
 * scope (#25) = jen „moje" (moje zakázky ∪ objednávky, které jsem vytvořil / odeslal / odešly z mé schránky);
 * bez práva na nákupní ceny se řádky maskují (maskPurchaseOrderListItem).
 */
export async function listPurchaseOrders(
  opts: { status?: PurchaseOrderStatus[]; supplierId?: string; jobId?: string; q?: string; limit?: number } = {},
  scopeOpts: { scope?: FlowScope | null } = {},
): Promise<PurchaseOrderListItem[]> {
  const scoped = "scope" in scopeOpts;
  const scope = scopeOpts.scope ?? null;
  if (scoped && (!scope || (!scope.all && (scope.error || !isUuid(scope.userId))))) return [];
  const mine = scoped && scope && !scope.all ? scope : null;
  const s = await listSession();
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
      return query.order("created_at", { ascending: false }).order("id") as unknown as PoQuery;
    };
    let rows: PurchaseOrderDbRow[];
    if (mine) {
      // rozsah vtlačený do dotazu (zakázky po dávkách + osoby / moje schránky), sloučeno podle id
      const byId = new Map<string, PurchaseOrderDbRow>();
      const ids = [...mine.jobIds];
      for (let i = 0; i < ids.length; i += 200) {
        const part = ids.slice(i, i + 200);
        const r = await fetchPaged<PurchaseOrderDbRow>((from, to) => build().in("job_id", part).range(from, to), MAX_ROWS);
        warn("list", r.error);
        if (r.error) return [];
        for (const row of r.data) byId.set(row.id, row);
      }
      const boxes = mine.mailboxIds.filter((b) => isUuid(b));
      const people = [`created_by.eq.${mine.userId}`, `sent_by.eq.${mine.userId}`, ...(boxes.length ? [`sent_mailbox_id.in.(${boxes.join(",")})`] : [])];
      const r = await fetchPaged<PurchaseOrderDbRow>((from, to) => build().or(people.join(",")).range(from, to), MAX_ROWS);
      warn("list", r.error);
      if (r.error) return [];
      for (const row of r.data) byId.set(row.id, row);
      rows = [...byId.values()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || a.id.localeCompare(b.id));
    } else {
      const r = await fetchPaged<PurchaseOrderDbRow>((from, to) => build().range(from, to), MAX_ROWS);
      warn("list", r.error);
      if (r.error) return [];
      rows = r.data;
    }
    const mapped = rows.map(rowToPurchaseOrderListItem);
    // bez práva na nákupní ceny: hledá se jen v tom, co je vidět (maska dřív než filtr)
    const visible = s.margins ? mapped : mapped.map(maskPurchaseOrderListItem);
    const items = filterPurchaseOrders(visible, opts.q);
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
