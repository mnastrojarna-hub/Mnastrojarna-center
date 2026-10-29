// Náklad zakázky z objednávek dodavatelům a faktur dodavatelů — zrcadlo SQL job_purchase_order_costs / job_cost
// (migrace 20261029110000). Bez dvojího počítání:
//  - objednávka bez faktury → částka objednávky,
//  - objednávka vyfakturovaná CELÁ (konečná faktura / Σ ≥ 99,5 % / každá položka má fakturu) → Σ faktur,
//  - jen dílčí faktura → max(Σ faktur, objednávka) — první dílčí faktura náklad nesníží,
//  - faktury bez objednávky se přičtou; zálohové, zamítnuté a duplicitní se nepočítají (vyřadí je volající),
//  - faktura v cizí měně bez kurzu → náklad neznámý (nikdy 1:1 jako Kč).
import type { JobPurchasingTotals } from "@/lib/jobs/purchasing-types";
import { fromCents, round2, toCents } from "@/lib/supplier-invoices/money";

/** Částka v Kč: CZK beze změny, cizí měna × kurz, bez kurzu null (nikdy 1:1). */
export function amountCzkOf(amount: number, currency: unknown, rate: unknown): number | null {
  if (String(currency ?? "CZK").toUpperCase() === "CZK") return round2(amount);
  const r = rate === null || rate === undefined || rate === "" ? NaN : Number(rate);
  return Number.isFinite(r) && r > 0 ? round2(amount * r) : null;
}

export interface CostPurchaseOrder {
  id: string;
  number?: string | null;
  status: string;
  total: number;
  /** Má položku bez ceny (náklad neznámý, dokud objednávku faktura celou nepokryje). */
  hasUnpriced: boolean;
  /** Položky objednávky (pokrytí fakturou po položkách). */
  itemIds?: string[];
}

export interface CostAllocation {
  /** Objednávka dodavateli, ke které je řádek faktury přiřazený (null = bez objednávky). */
  purchaseOrderId: string | null;
  purchaseOrderItemId?: string | null;
  /** Částka v Kč (částka × kurz faktury, na haléře); null = cizí měna bez kurzu. */
  amountCzk: number | null;
  /** Jen potvrzené řádky se počítají. */
  confirmed: boolean;
  /** Faktura je u objednávky označená jako konečná. */
  poFinal?: boolean;
  invoiceNumber?: string | null;
  currency?: string;
}

export interface PurchaseOrderCost {
  id: string;
  number: string | null;
  total: number;
  invoiced: boolean;
  /** Σ potvrzených faktur v Kč (bez kurzu = 0). */
  inv: number;
  complete: boolean;
  /** Co objednávka přispívá do nákladu. */
  contributes: number;
  unpriced: boolean;
  noRate: boolean;
}

export interface JobCostBreakdown {
  cost: number;
  known: boolean;
  /** Byl použit odhad orders.purchase_cost (bez objednávek i faktur). */
  estimate: boolean;
  /** Objednávky (aktivní) → fakturováno (jen fakturované). */
  invoicedByPo: Record<string, number>;
  purchaseOrders: PurchaseOrderCost[];
  /** Σ faktur bez objednávky. */
  invoicesWithoutPo: number;
  /** Σ částek aktivních objednávek bez faktury. */
  purchaseOrdersOpen: number;
  /** Čísla objednávek s položkou bez ceny, které nejsou celé vyfakturované. */
  unpricedPurchaseOrders: string[];
  /** „kurz EUR u faktury dodavatele" — faktury v cizí měně bez kurzu (bez čísla: text vidí i obchodník u zakázky a v provizích). */
  missingRates: string[];
}

/** Objednávka je vyfakturovaná celá od 99,5 % své částky. */
const COMPLETE_PERMILLE = 995;

/** Stav jedné objednávky vůči fakturám (stejná pravidla jako SQL job_purchase_order_costs). */
export function purchaseOrderCost(po: CostPurchaseOrder, confirmed: CostAllocation[]): PurchaseOrderCost {
  const rows = confirmed.filter((a) => a.purchaseOrderId === po.id);
  const invoiced = rows.length > 0;
  const invC = rows.reduce((s, a) => s + toCents(a.amountCzk ?? 0), 0);
  const totalC = toCents(po.total);
  const final = rows.some((a) => a.poFinal);
  const items = po.itemIds ?? [];
  const covered = items.length > 0 && items.every((id) => rows.some((a) => a.purchaseOrderItemId === id));
  // SQL: inv >= total × 0,995 − 0,005 Kč (v haléřích celočíselně)
  const complete = invoiced && (final || covered || 1000 * invC >= COMPLETE_PERMILLE * totalC - 500);
  const contributes = !invoiced ? totalC : complete ? invC : Math.max(invC, totalC);
  return {
    id: po.id, number: po.number ?? null, total: fromCents(totalC), invoiced, inv: fromCents(invC), complete,
    contributes: fromCents(contributes), unpriced: po.hasUnpriced, noRate: rows.some((a) => a.amountCzk === null),
  };
}

export function jobCostBreakdown(input: {
  plannedCost: number | null;
  purchaseOrders: CostPurchaseOrder[];
  allocations: CostAllocation[];
}): JobCostBreakdown {
  const active = input.purchaseOrders.filter((p) => p.status !== "zrusena");
  const activeIds = new Set(active.map((p) => p.id));
  const confirmed = input.allocations.filter((a) => a.confirmed);
  const invoicedByPo: Record<string, number> = {};
  const pos = active.map((po) => purchaseOrderCost(po, confirmed));
  let poCents = 0;
  let openCents = 0;
  const unpriced: string[] = [];
  let unknown = false;
  for (const p of pos) {
    poCents += toCents(p.contributes);
    if (p.invoiced) invoicedByPo[p.id] = p.inv;
    else openCents += toCents(p.total);
    if (p.unpriced && !p.complete) { unpriced.push(p.number ?? "—"); unknown = true; }
    if (p.noRate) unknown = true;
  }
  const free = confirmed.filter((a) => !a.purchaseOrderId || !activeIds.has(a.purchaseOrderId));
  const freeCents = free.reduce((s, a) => s + toCents(a.amountCzk ?? 0), 0);
  if (free.some((a) => a.amountCzk === null)) unknown = true;
  const missingRates = [...new Set(confirmed.filter((a) => a.amountCzk === null)
    .map((a) => `kurz ${a.currency ?? "?"} u faktury dodavatele`))];
  if (active.length + free.length > 0) {
    return {
      cost: fromCents(poCents + freeCents), known: !unknown, estimate: false, invoicedByPo, purchaseOrders: pos,
      invoicesWithoutPo: fromCents(freeCents), purchaseOrdersOpen: fromCents(openCents), unpricedPurchaseOrders: unpriced, missingRates,
    };
  }
  return {
    cost: input.plannedCost ?? 0, known: input.plannedCost !== null, estimate: true,
    invoicedByPo, purchaseOrders: [], invoicesWithoutPo: 0, purchaseOrdersOpen: 0, unpricedPurchaseOrders: [], missingRates: [],
  };
}

/**
 * Souhrn nákupu zakázky (karta marže) s fakturami dodavatelů. Bez potvrzených faktur se nic nemění
 * (výpočet purchasingTotals platí); s nimi náklad = jobCostBreakdown (stejně jako provize v DB).
 */
export function withInvoiceCosts(
  totals: JobPurchasingTotals,
  input: { purchaseOrders: CostPurchaseOrder[]; allocations: CostAllocation[] },
): JobPurchasingTotals {
  if (!input.allocations.some((a) => a.confirmed)) return totals;
  const b = jobCostBreakdown({ plannedCost: totals.plannedCost, purchaseOrders: input.purchaseOrders, allocations: input.allocations });
  if (!b.known) {
    const reasons = [...b.unpricedPurchaseOrders, ...b.missingRates];
    return {
      ...totals, cost: null, costSource: "neuplna", profit: null, margin: null, incompleteCost: b.cost,
      unpricedItems: Math.max(1, reasons.length), unpricedPurchaseOrders: b.unpricedPurchaseOrders,
      ...(b.missingRates.length ? { missingRates: b.missingRates } : {}),
    };
  }
  const profit = totals.revenue !== null ? fromCents(toCents(totals.revenue) - toCents(b.cost)) : null;
  const margin = profit !== null && totals.revenue !== null && totals.revenue > 0
    ? Math.round((profit / totals.revenue) * 10_000) / 10_000 : null;
  return {
    revenue: totals.revenue, purchaseOrdersTotal: totals.purchaseOrdersTotal, plannedCost: totals.plannedCost,
    cost: b.cost, costSource: "faktury", profit, margin,
  };
}
