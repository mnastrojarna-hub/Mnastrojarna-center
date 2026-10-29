// Součty seznamu faktur dodavatelů (čistá funkce — testy bez DB).
import { fromCents, toCents } from "@/lib/supplier-invoices/money";
import type { SupplierInvoiceListItem, SupplierInvoicePerms, SupplierInvoiceTotals } from "@/lib/supplier-invoices/types";

export interface TotalsRateRow {
  id: string;
  currency: string;
  exchange_rate: number | string | null;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? x : null;
};

/** Zbývá zaplatit: nezaplaceno = celá částka s DPH, částečně = s DPH − uhrazeno, zaplaceno = 0. */
export function unpaidOf(x: Pick<SupplierInvoiceListItem, "paymentStatus" | "totalGross" | "paidAmount">): number {
  if (x.paymentStatus === "zaplaceno") return 0;
  const gross = x.totalGross ?? 0;
  if (x.paymentStatus === "castecne") return fromCents(Math.max(0, toCents(gross) - toCents(x.paidAmount ?? 0)));
  return gross;
}

export function emptyTotals(p: SupplierInvoicePerms): SupplierInvoiceTotals {
  return {
    count: 0, net: p.amounts ? 0 : null, gross: p.amounts ? 0 : null, unpaid: p.paid ? 0 : null, overdue: p.paid ? 0 : null,
    unallocated: p.amounts ? 0 : null, foreign: p.amounts ? [] : null,
  };
}

/**
 * Součty v Kč: CZK + cizí měny S kurzem (× kurz). Faktury v cizí měně BEZ kurzu se do Kč nesčítají
 * (nikdy 1:1) — mají vlastní mezisoučty po měnách (foreign). Zamítnuté a duplicity se nepočítají.
 */
export function totalsOf(list: SupplierInvoiceListItem[], rows: TotalsRateRow[], p: SupplierInvoicePerms): SupplierInvoiceTotals {
  const rate = new Map<string, number | null>(rows.map((r) => [r.id, r.currency === "CZK" ? 1 : num(r.exchange_rate)]));
  const live = list.filter((x) => x.status !== "zamitnuto" && !x.duplicateOfId);
  const czk = live.filter((x) => typeof rate.get(x.id) === "number");
  const sum = (f: (x: SupplierInvoiceListItem) => number | null) =>
    fromCents(czk.reduce((s, x) => s + toCents((f(x) ?? 0) * (rate.get(x.id) as number)), 0));
  const foreign = new Map<string, { currency: string; count: number; net: number; gross: number }>();
  for (const x of live) {
    if (typeof rate.get(x.id) === "number") continue;
    const cur = foreign.get(x.currency) ?? { currency: x.currency, count: 0, net: 0, gross: 0 };
    cur.count += 1;
    cur.net = fromCents(toCents(cur.net) + toCents(x.totalNet ?? 0));
    cur.gross = fromCents(toCents(cur.gross) + toCents(x.totalGross ?? 0));
    foreign.set(x.currency, cur);
  }
  return {
    count: list.length,
    net: p.amounts ? sum((x) => x.totalNet) : null,
    gross: p.amounts ? sum((x) => x.totalGross) : null,
    unpaid: p.paid && p.amounts ? sum((x) => unpaidOf(x)) : null,
    overdue: p.paid && p.amounts ? sum((x) => (x.overdue ? unpaidOf(x) : 0)) : null,
    unallocated: p.amounts ? sum((x) => x.unallocated) : null,
    foreign: p.amounts ? [...foreign.values()] : null,
  };
}
