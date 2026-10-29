// Model editoru rozdělení faktury (čistá logika — testy bez DOM).
import {
  capacityOf, parseAmount, rebalance, remainderOf, round2, splitRow, toCents, validateAllocations, fromCents,
} from "@/lib/supplier-invoices/money";
import type {
  AllocationInput, JobRefView, OverheadCategory, SupplierInvoiceDetail, SupplierInvoiceTarget,
} from "@/lib/supplier-invoices/types";

export interface AllocationDraft {
  key: string;
  id: string | null;
  itemId: string | null;
  target: SupplierInvoiceTarget;
  job: JobRefView | null;
  category: OverheadCategory | null;
  amount: number;
  /** Co uživatel píše („10 000", „30 %"). */
  text: string;
  purchaseOrderId: string | null;
  purchaseOrderItemId: string | null;
  orderItemId: string | null;
  orderItemLabel: string | null;
  note: string | null;
  aiSuggested: boolean;
  aiReason: string | null;
  confirmed: boolean;
  /** Dopočítává zbytek (po „Rozdělit"). */
  auto?: boolean;
}

let seq = 0;
export function newKey(): string {
  seq += 1;
  return `n${Date.now().toString(36)}${seq}`;
}

export function amountText(n: number): string {
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("cs-CZ", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }).replace(/ /g, " ");
}

export function draftsFromDetail(d: Pick<SupplierInvoiceDetail, "allocations">): AllocationDraft[] {
  return d.allocations.map((a) => ({
    key: a.id, id: a.id, itemId: a.itemId, target: a.target, job: a.job, category: a.category, amount: a.amount ?? 0,
    text: amountText(a.amount ?? 0), purchaseOrderId: a.purchaseOrderId, purchaseOrderItemId: a.purchaseOrderItemId,
    orderItemId: a.orderItemId, orderItemLabel: a.orderItemLabel, note: a.note, aiSuggested: a.aiSuggested, aiReason: a.aiReason,
    confirmed: a.confirmed,
  }));
}

/** „30 %" → podíl z kapacity, jinak částka; null = neplatné. */
export function parseRowAmount(text: string, capacity: number): number | null {
  const t = String(text ?? "").trim();
  const pct = /^(-?\d+(?:[.,]\d+)?)\s*%$/.exec(t);
  if (pct) {
    const p = Number(pct[1].replace(",", "."));
    return Number.isFinite(p) ? fromCents(Math.round((toCents(capacity) * p) / 100)) : null;
  }
  return parseAmount(t);
}

export interface InvoiceShape { totalNet: number | null; items: { id: string; amount: number | null }[] }

export function capItems(inv: InvoiceShape): { id: string; amount: number }[] {
  return inv.items.map((i) => ({ id: i.id, amount: i.amount ?? 0 }));
}

/**
 * Člověk změnil zakázku / částku / objednávku / cíl řádku → už to není návrh AI (značka ✨ a důvod
 * „částka odpovídá objednávce…" by lhaly). Platí i pro řádek, který se dopočítal (zbytek).
 */
export function clearAiOnChange(prev: AllocationDraft[], next: AllocationDraft[]): AllocationDraft[] {
  const before = new Map(prev.map((r) => [r.key, r]));
  return next.map((r) => {
    const p = before.get(r.key);
    if (!p || !r.aiSuggested) return r;
    const changed = p.target !== r.target || (p.job?.id ?? null) !== (r.job?.id ?? null) || toCents(p.amount) !== toCents(r.amount)
      || (p.purchaseOrderId ?? null) !== (r.purchaseOrderId ?? null) || (p.category ?? null) !== (r.category ?? null);
    return changed ? { ...r, aiSuggested: false, aiReason: null } : r;
  });
}

/** Změna textu částky řádku → nová částka a dopočet zbytkového řádku. */
export function setRowText(rows: AllocationDraft[], key: string, text: string, inv: InvoiceShape): AllocationDraft[] {
  const row = rows.find((r) => r.key === key);
  if (!row) return rows;
  const cap = capacityOf(row.itemId, inv.totalNet, capItems(inv));
  const amt = parseRowAmount(text, cap);
  const next = rows.map((r) => (r.key === key ? { ...r, text, amount: amt ?? r.amount, auto: false } : r));
  if (amt === null) return clearAiOnChange(rows, next);
  return clearAiOnChange(rows, rebalance(next, row.itemId, cap, key).map((r) => (r.auto ? { ...r, text: amountText(r.amount) } : r)));
}

/** „Rozdělit" — nový řádek se zbytkem (nebo půlka posledního). */
export function splitDraft(rows: AllocationDraft[], itemId: string | null, inv: InvoiceShape, target: SupplierInvoiceTarget = "job"): AllocationDraft[] {
  const cap = capacityOf(itemId, inv.totalNet, capItems(inv));
  return clearAiOnChange(rows, splitRow<AllocationDraft>(rows, itemId, cap, (amount): AllocationDraft => ({
    key: newKey(), id: null, itemId, target, job: null, category: target === "rezie" ? "ostatni" : null, amount, text: amountText(amount),
    purchaseOrderId: null, purchaseOrderItemId: null, orderItemId: null, orderItemLabel: null, note: null,
    aiSuggested: false, aiReason: null, confirmed: false,
  })).map((r) => ({ ...r, text: amountText(r.amount) })));
}

/** Nový řádek na celý zbytek položky (nic nerozděleno → celá částka). */
export function addDraft(rows: AllocationDraft[], itemId: string | null, inv: InvoiceShape, target: SupplierInvoiceTarget): AllocationDraft[] {
  const left = remainderOf(itemId, inv.totalNet, capItems(inv), rows);
  const cap = capacityOf(itemId, inv.totalNet, capItems(inv));
  const amount = toCents(left) !== 0 && Math.sign(left) === Math.sign(cap) ? left : 0;
  if (amount === 0) return splitDraft(rows, itemId, inv, target);
  const cat: OverheadCategory | null = target === "rezie" ? "ostatni" : null;
  return [...rows, {
    key: newKey(), id: null, itemId, target, job: null, category: cat, amount: round2(amount), text: amountText(amount),
    purchaseOrderId: null, purchaseOrderItemId: null, orderItemId: null, orderItemLabel: null, note: null,
    aiSuggested: false, aiReason: null, confirmed: false,
  }];
}

export function removeDraft(rows: AllocationDraft[], key: string): AllocationDraft[] {
  return rows.filter((r) => r.key !== key);
}

export function patchDraft(rows: AllocationDraft[], key: string, patch: Partial<AllocationDraft>): AllocationDraft[] {
  return clearAiOnChange(rows, rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
}

/** Řádky k uložení; uložení člověkem = potvrzení (confirmAll). */
export function draftsToInputs(rows: AllocationDraft[], confirmAll: boolean): AllocationInput[] {
  return rows.map((r) => ({
    id: r.id, itemId: r.itemId, target: r.target, jobId: r.target === "job" ? r.job?.id ?? null : null,
    category: r.target === "rezie" ? r.category ?? "ostatni" : null, amount: r.amount,
    purchaseOrderId: r.target === "job" ? r.purchaseOrderId : null, purchaseOrderItemId: r.target === "job" ? r.purchaseOrderItemId : null,
    orderItemId: r.target === "job" ? r.orderItemId : null, note: r.note, aiSuggested: r.aiSuggested, aiReason: r.aiReason,
    confirmed: confirmAll || r.confirmed,
  }));
}

export function draftsProblem(rows: AllocationDraft[], inv: InvoiceShape): string | null {
  if (rows.some((r) => !r.text.trim() || parseRowAmount(r.text, capacityOf(r.itemId, inv.totalNet, capItems(inv))) === null)) {
    return "Oprav částku v rozdělení (číslo nebo procenta, např. 10 000 nebo 30 %).";
  }
  return validateAllocations({ totalNet: inv.totalNet, items: capItems(inv) },
    rows.map((r) => ({ itemId: r.itemId, target: r.target, jobId: r.target === "job" ? r.job?.id ?? null : null, category: r.category, amount: r.amount })));
}

/** Stejné řádky jako v DB (nic k uložení)? */
export function sameDrafts(a: AllocationDraft[], b: AllocationDraft[]): boolean {
  const sig = (r: AllocationDraft) => [r.id, r.itemId, r.target, r.job?.id ?? "", r.category ?? "", toCents(r.amount), r.purchaseOrderId ?? "", r.orderItemId ?? "", r.note ?? ""].join("|");
  return a.length === b.length && a.every((r, i) => sig(r) === sig(b[i]));
}
