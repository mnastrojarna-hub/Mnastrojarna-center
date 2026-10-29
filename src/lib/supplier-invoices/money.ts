// Rozdělení faktury dodavatele — čistá matematika (haléře, zbytek, dělení částkou i procenty).
// Stejná pravidla hlídá DB (supplier_invoice_check) — tady kvůli okamžité odezvě a testům.
import type { AllocationInput, OverheadCategory, SupplierInvoiceTarget } from "@/lib/supplier-invoices/types";

/** Částka → haléře (celé číslo). */
export function toCents(n: number | string | null | undefined): number {
  const v = typeof n === "string" ? Number(n.replace(/\s+/g, "").replace(",", ".")) : Number(n ?? 0);
  return Number.isFinite(v) ? Math.round(v * 100) : 0;
}

export function fromCents(c: number): number {
  return Math.round(c) / 100;
}

/** Zaokrouhlení na haléře (bez chyb plovoucí čárky). */
export function round2(n: number): number {
  return fromCents(toCents(n));
}

/** Česky zapsaná částka („10 000", „1 234,50", „-500") → číslo; null = neplatné. */
export function parseAmount(raw: string): number | null {
  const t = String(raw ?? "").replace(/[\s ]+/g, "").replace(/Kč|CZK|EUR|€/gi, "").replace(",", ".");
  if (!t || !/^-?\d+(\.\d{0,4})?$/.test(t)) return null;
  return round2(Number(t));
}

export interface CapacityItem { id: string; amount: number }
export interface AllocRow { itemId: string | null; amount: number }

/**
 * Kolik jde rozdělit z položky (její částka) nebo z hlavičky (net − Σ položek; bez položek celý net).
 * Bez součtu faktury (null) hlavička nic nenabízí — jinak by „zbytek" vyšel záporný (stejně jako DB).
 */
export function capacityOf(itemId: string | null, totalNet: number | null, items: CapacityItem[]): number {
  if (itemId) return round2(items.find((i) => i.id === itemId)?.amount ?? 0);
  if (totalNet === null || totalNet === undefined) return 0;
  const itemsSum = items.reduce((s, i) => s + toCents(i.amount), 0);
  return fromCents(toCents(totalNet) - itemsSum);
}

export function allocatedOf(itemId: string | null, rows: AllocRow[]): number {
  return fromCents(rows.filter((r) => (r.itemId ?? null) === itemId).reduce((s, r) => s + toCents(r.amount), 0));
}

/** Nerozdělený zbytek (stejné znaménko jako kapacita; 0 = rozděleno celé). */
export function remainderOf(itemId: string | null, totalNet: number | null, items: CapacityItem[], rows: AllocRow[]): number {
  return fromCents(toCents(capacityOf(itemId, totalNet, items)) - toCents(allocatedOf(itemId, rows)));
}

/** Celkový nerozdělený zbytek faktury (Σ |zbytků| položek a hlavičky). */
export function invoiceUnallocated(totalNet: number | null, items: CapacityItem[], rows: AllocRow[]): number {
  let cents = 0;
  for (const it of items) cents += Math.abs(toCents(remainderOf(it.id, totalNet, items, rows)));
  cents += Math.abs(toCents(remainderOf(null, totalNet, items, rows)));
  return fromCents(cents);
}

/** Rozdělí CELOU částku podle vah na haléře (metoda největšího zbytku) — součet vždy sedí na haléř. */
export function splitByWeights(total: number, weights: number[]): number[] {
  const target = toCents(total);
  const w = weights.map((p) => (Number.isFinite(p) && p > 0 ? p : 0));
  const sum = w.reduce((s, p) => s + p, 0);
  if (!w.length || sum <= 0) return w.map(() => 0);
  const exact = w.map((p) => (target * p) / sum);
  const base = exact.map((x) => (x >= 0 ? Math.floor(x) : Math.ceil(x)));
  let rest = target - base.reduce((s, x) => s + x, 0);
  const order = exact.map((x, i) => ({ i, frac: Math.abs(x - base[i]) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  const step = rest >= 0 ? 1 : -1;
  for (let k = 0; rest !== 0; k = (k + 1) % order.length) {
    base[order[k].i] += step;
    rest -= step;
  }
  return base.map(fromCents);
}

/**
 * Rozdělí částku podle procent na haléře — součet sedí na haléř. Procenta nemusí dát 100
 * (pak se rozdělí jen jejich podíl z částky).
 */
export function splitByPercent(total: number, percents: number[]): number[] {
  const pct = percents.map((p) => (Number.isFinite(p) && p > 0 ? p : 0));
  const sumPct = pct.reduce((s, p) => s + p, 0);
  if (!pct.length || sumPct <= 0) return pct.map(() => 0);
  const part = sumPct >= 99.9999 && sumPct <= 100.0001 ? total : fromCents(Math.round((toCents(total) * sumPct) / 100));
  return splitByWeights(part, pct);
}

/** Rozdělí částku na n stejných dílů (haléře navíc dostanou první díly). */
export function splitEvenly(total: number, n: number): number[] {
  if (n <= 0) return [];
  return splitByWeights(total, Array.from({ length: n }, () => 1));
}

export interface EditableRow {
  key: string;
  itemId: string | null;
  amount: number;
  /** Řádek dopočítává zbytek (poslední při rozdělení). */
  auto?: boolean;
}

/**
 * Po úpravě řádku dopočítá „zbytkový" řádek (auto) téže položky tak, aby součet = kapacita
 * (nejvýš do nuly — přetečení zůstane vidět jako chyba).
 */
export function rebalance<T extends EditableRow>(rows: T[], itemId: string | null, capacity: number, editedKey?: string): T[] {
  const same = rows.filter((r) => (r.itemId ?? null) === itemId);
  const auto = [...same].reverse().find((r) => r.auto && r.key !== editedKey);
  if (!auto) return rows;
  const others = same.filter((r) => r.key !== auto.key).reduce((s, r) => s + toCents(r.amount), 0);
  const capC = toCents(capacity);
  let left = capC - others;
  if (Math.sign(left) !== Math.sign(capC) && left !== 0) left = 0;
  return rows.map((r) => (r.key === auto.key ? { ...r, amount: fromCents(left) } : r));
}

/**
 * „Rozdělit": přidá řádek. Zbývá-li něco, nový řádek dostane zbytek; jinak se poslední řádek položky
 * rozpůlí a nový (zbytkový) řádek si bere druhou půlku — psaním do prvního se dopočítá.
 */
export function splitRow<T extends EditableRow>(rows: T[], itemId: string | null, capacity: number, make: (amount: number) => T): T[] {
  const same = rows.filter((r) => (r.itemId ?? null) === itemId);
  const used = same.reduce((s, r) => s + toCents(r.amount), 0);
  const left = toCents(capacity) - used;
  const cleared = rows.map((r) => ((r.itemId ?? null) === itemId && r.auto ? { ...r, auto: false } : r));
  if (left !== 0 && Math.sign(left) === Math.sign(toCents(capacity))) return [...cleared, { ...make(fromCents(left)), auto: true }];
  const last = same[same.length - 1];
  if (!last) return [...cleared, { ...make(round2(capacity)), auto: true }];
  const [a, b] = splitEvenly(last.amount, 2);
  return [...cleared.map((r) => (r.key === last.key ? { ...r, amount: a, auto: false } : r)), { ...make(b), auto: true }];
}

export interface ValidateInvoice {
  totalNet: number | null;
  items: CapacityItem[];
}

export interface ValidateRow {
  itemId: string | null;
  target: SupplierInvoiceTarget;
  jobId: string | null;
  category: OverheadCategory | null;
  amount: number;
}

/** Kontrola rozdělení před uložením (česká hláška, null = v pořádku). */
export function validateAllocations(inv: ValidateInvoice, rows: ValidateRow[]): string | null {
  const ids = new Set(inv.items.map((i) => i.id));
  for (const r of rows) {
    if (r.itemId && !ids.has(r.itemId)) return "Řádek rozdělení odkazuje na neznámou položku faktury.";
    if (!Number.isFinite(r.amount) || toCents(r.amount) === 0) return "Každý řádek rozdělení musí mít částku (nenulovou).";
    if (r.target === "job" && !r.jobId) return "Vyber zakázku (nebo zvol Režie).";
    if (r.target === "rezie" && r.jobId) return "Režie nemá zakázku.";
  }
  const keys = new Set<string | null>(rows.map((r) => r.itemId ?? null));
  for (const key of keys) {
    const cap = toCents(capacityOf(key, inv.totalNet, inv.items));
    const part = rows.filter((r) => (r.itemId ?? null) === key);
    const sum = part.reduce((s, r) => s + toCents(r.amount), 0);
    const label = key ? `Položka ${inv.items.findIndex((i) => i.id === key) + 1}` : "Zbytek faktury";
    if (cap === 0) return `${label}: není co rozdělit (částka 0).`;
    if (part.some((r) => Math.sign(toCents(r.amount)) !== Math.sign(cap))) {
      return `${label}: částka rozdělení musí mít stejné znaménko jako položka.`;
    }
    if (Math.abs(sum) > Math.abs(cap)) {
      return `${label}: rozděleno ${formatPlain(fromCents(sum))} z ${formatPlain(fromCents(cap))} — o ${formatPlain(fromCents(Math.abs(sum) - Math.abs(cap)))} víc.`;
    }
  }
  return null;
}

function formatPlain(n: number): string {
  return n.toLocaleString("cs-CZ", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** Řádky rozdělení k uložení (zaokrouhlení, nulové pryč). */
export function cleanAllocationInputs(rows: AllocationInput[]): AllocationInput[] {
  return rows
    .map((r) => ({ ...r, amount: round2(r.amount) }))
    .filter((r) => toCents(r.amount) !== 0);
}
