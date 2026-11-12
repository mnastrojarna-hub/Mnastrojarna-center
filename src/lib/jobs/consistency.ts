/**
 * Křížová konzistence údajů zakázky (majitel 4. 11.: „ceny musí vždy křížově sedět").
 * Čistý modul — bez DB, používá ho server (akce v src/app/actions/job-consistency.ts,
 * jobs.ts, purchasing.ts) i karta zakázky (náhled rozpočítání, odznaky nesouladu).
 *
 * Pravidla (stejná vynucuje DB, migrace 20261104120000_krizova_konzistence_cen.sql):
 *  1. Hodnota zakázky = Σ(počet × prodejní cena) položek, jakmile má cenu aspoň jedna položka.
 *     Položky bez ceny se nepočítají (upozornění „N položek bez ceny"). Bez cen na položkách
 *     je hodnota ruční (bez upozornění).
 *  2. Změna hodnoty zakázky při naceněných položkách se rozpočítá na položky:
 *     „poměrně" (podle součtu řádků), „rovnoměrně na kus" (stejná změna ceny za kus),
 *     nebo „na položky bez ceny" (zbytek rovnoměrně na kus). Ceny jsou v haléřích —
 *     zbytek po zaokrouhlení jde na největší řádek; když se cílová částka přesně
 *     složit nedá (např. 1 položka × 3 ks a 100,00 Kč), použije se nejbližší možná a řekne se to.
 *  3. Nákupní náklady = Σ objednávek dodavatelům (bez zrušených), jakmile nějaká je; jinak
 *     nákupní ceny položek; jinak vítězná nabídka dodavatele; jinak ručně.
 *  4. Vyfakturovanou zakázku nejde přecenit (jen dobropisem); odeslaná / přijatá nabídka cenu
 *     nezamyká, ale upozorní, že cena už nebude odpovídat nabídce (nabídne novou verzi).
 *  5. Termíny: objednávka dodavateli požadující / potvrzující dodání po termínu zákazníka,
 *     max. tolerovaný dřív než potvrzený termín → upozornění.
 */
import { CLOSED_STAGES, DELIVERED_STAGES } from "@/lib/jobs/stages";

export type DistributeMode = "proportional" | "per_piece" | "unpriced";

export const DISTRIBUTE_MODE_LABELS: Record<DistributeMode, string> = {
  proportional: "Poměrně podle položek",
  per_piece: "Rovnoměrně na kus",
  unpriced: "Na položky bez ceny",
};

export interface MoneyItem {
  id?: string | null;
  quantity: number;
  unitPrice: number | null;
  purchaseUnitPrice?: number | null;
  /** Pro texty („H-200 Hřídel"). */
  label?: string | null;
}

const EPS = 0.005;

export function r2(n: number): number {
  return Math.round((n + Number.EPSILON * Math.sign(n)) * 100) / 100;
}

function qty(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function price(n: unknown): number | null {
  if (n === null || n === undefined || n === "") return null;
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? v : null;
}

export function sameMoney(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return a === b || (a ?? null) === (b ?? null);
  return Math.abs(a - b) < EPS;
}

/** Σ(počet × prodejní cena) položek s cenou; null = žádná položka nemá cenu (= hodnota je ruční). */
export function itemsSaleValue(items: MoneyItem[]): number | null {
  let sum: number | null = null;
  for (const it of items) {
    const p = price(it.unitPrice);
    if (p !== null) sum = (sum ?? 0) + qty(it.quantity) * p;
  }
  return sum === null ? null : r2(sum);
}

/** Σ(počet × nákupní cena) položek s nákupní cenou; null = žádná ji nemá. */
export function itemsPurchaseValue(items: MoneyItem[]): number | null {
  let sum: number | null = null;
  for (const it of items) {
    const p = price(it.purchaseUnitPrice);
    if (p !== null) sum = (sum ?? 0) + qty(it.quantity) * p;
  }
  return sum === null ? null : r2(sum);
}

export function itemsQuantity(items: MoneyItem[]): number {
  return Math.round(items.reduce((s, it) => s + qty(it.quantity), 0) * 1000) / 1000;
}

export function unpricedCount(items: MoneyItem[]): number {
  return items.filter((it) => price(it.unitPrice) === null).length;
}

// ── Rozpočítání hodnoty zakázky na položky ────────────────────
export interface PriceChange {
  index: number;
  from: number | null;
  to: number;
}

export type DistributeResult =
  | {
    ok: true;
    mode: DistributeMode;
    requested: number;
    /** Hodnota zakázky po rozpočítání (= Σ položek). */
    achieved: number;
    /** Cílová částka se dala složit přesně (na haléře). */
    exact: boolean;
    /** Nové prodejní ceny / ks ve stejném pořadí jako vstup (null = beze změny bez ceny). */
    prices: (number | null)[];
    changes: PriceChange[];
  }
  | { ok: false; error: string };

/** Které způsoby rozpočítání dávají smysl (pro výběr v dialogu). */
export function availableModes(items: MoneyItem[], target: number): DistributeMode[] {
  const priced = items.filter((it) => price(it.unitPrice) !== null && qty(it.quantity) > 0);
  const unpriced = items.filter((it) => price(it.unitPrice) === null && qty(it.quantity) > 0);
  const current = itemsSaleValue(items) ?? 0;
  const out: DistributeMode[] = [];
  if (priced.length) out.push("proportional", "per_piece");
  if (unpriced.length && target - current > -EPS) out.push("unpriced");
  return out;
}

/** Výchozí způsob: zbývá-li dopočítat položky bez ceny, nejdřív na ně; jinak poměrně. */
export function defaultMode(items: MoneyItem[], target: number): DistributeMode | null {
  const modes = availableModes(items, target);
  const current = itemsSaleValue(items) ?? 0;
  if (modes.includes("unpriced") && target - current > EPS) return "unpriced";
  return modes[0] ?? null;
}

function lineTotalOf(q: number, p: number | null): number {
  return p === null ? 0 : q * p;
}

/**
 * Rozpočítá změnu hodnoty zakázky na prodejní ceny položek tak, aby Σ položek = cílová hodnota.
 * Ceny jsou na haléře; zbytek po zaokrouhlení jde na řádky od největšího.
 */
export function distributeJobValue(items: MoneyItem[], targetIn: number, mode: DistributeMode): DistributeResult {
  if (!Number.isFinite(targetIn) || targetIn < 0) return { ok: false, error: "Hodnota zakázky musí být kladné číslo." };
  const target = r2(targetIn);
  const qs = items.map((it) => qty(it.quantity));
  const ps = items.map((it) => price(it.unitPrice));
  const current = itemsSaleValue(items) ?? 0;
  const delta = target - current;

  const pricedIdx = items.map((_, i) => i).filter((i) => ps[i] !== null && qs[i] > 0);
  const unpricedIdx = items.map((_, i) => i).filter((i) => ps[i] === null && qs[i] > 0);
  let lines: number[];
  let weights: number[];
  if (mode === "unpriced") {
    if (!unpricedIdx.length) return { ok: false, error: "Všechny položky už cenu mají — vyber jiné rozpočítání." };
    if (delta < -EPS) return { ok: false, error: "Nová hodnota je nižší než součet nacenených položek — na položky bez ceny se rozdělit nedá." };
    lines = unpricedIdx;
    weights = lines.map((i) => qs[i]);
  } else {
    if (!pricedIdx.length) return { ok: false, error: "Žádná položka nemá prodejní cenu — hodnotu zakázky zadej ručně, nebo doplň ceny položek." };
    lines = pricedIdx;
    const totals = lines.map((i) => lineTotalOf(qs[i], ps[i]));
    const sumTotals = totals.reduce((s, x) => s + x, 0);
    weights = mode === "proportional" && sumTotals > EPS ? totals : lines.map((i) => qs[i]);
  }
  const wSum = weights.reduce((s, x) => s + x, 0);
  if (wSum <= 0) return { ok: false, error: "Položky nemají počet kusů — není na co rozpočítat." };

  const next = [...ps];
  lines.forEach((i, k) => {
    const share = (delta * weights[k]) / wSum; // změna součtu řádku
    const base = ps[i] ?? 0;
    next[i] = r2(base + share / qs[i]);
  });
  if (lines.some((i) => (next[i] ?? 0) < 0)) {
    return { ok: false, error: "Snížení je větší než cena položek — ceny by vyšly záporné." };
  }

  // dorovnání haléřů: od největšího řádku, změna ceny o 1 hal. mění řádek o „počet" haléřů
  const sumOf = () => r2(next.reduce<number>((s, p, i) => s + lineTotalOf(qs[i], p), 0));
  let residual = Math.round((target - sumOf()) * 100);
  const order = [...lines].sort((a, b) => lineTotalOf(qs[b], next[b]) - lineTotalOf(qs[a], next[a]) || qs[a] - qs[b]);
  for (let pass = 0; pass < 2 && residual !== 0; pass++) {
    for (const i of order) {
      if (residual === 0) break;
      const q = qs[i];
      if (q <= 0) continue;
      const k = Math.trunc(residual / q + (residual > 0 ? 1e-9 : -1e-9));
      if (k === 0) continue;
      const np = r2((next[i] ?? 0) + k / 100);
      if (np < 0) continue;
      next[i] = np;
      residual = Math.round((target - sumOf()) * 100);
    }
    // řádek s počtem 1 (nebo menším) pobere i zbytek, který větší řádky nepobraly
    if (residual !== 0) {
      const one = order.find((i) => qs[i] > 0 && qs[i] <= 1);
      if (one !== undefined) {
        const np = r2((next[one] ?? 0) + residual / 100 / qs[one]);
        if (np >= 0) next[one] = np;
        residual = Math.round((target - sumOf()) * 100);
      }
    }
  }
  const achieved = sumOf();
  const changes: PriceChange[] = [];
  next.forEach((p, i) => {
    if (p === null) return;
    if (ps[i] === null || Math.abs((ps[i] as number) - p) >= EPS) changes.push({ index: i, from: ps[i], to: p });
  });
  return { ok: true, mode, requested: target, achieved, exact: Math.abs(achieved - target) < EPS, prices: next, changes };
}

// ── Zámky a hlášky ─────────────────────────────────────────────
export function formatKc(n: number | null | undefined, currency = "CZK"): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("cs-CZ", {
      style: "currency", currency: /^[A-Z]{3}$/.test(currency) ? currency : "CZK",
      maximumFractionDigits: Math.abs(n - Math.round(n)) < EPS ? 0 : 2,
      minimumFractionDigits: Math.abs(n - Math.round(n)) < EPS ? 0 : 2,
    }).format(n);
  } catch {
    return `${n} ${currency}`;
  }
}

function czDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${Number(m[3])}. ${Number(m[2])}. ${m[1]}` : (iso ?? "");
}

export interface InvoiceLockInput {
  invoiceNumber?: string | null;
  invoicedAt?: string | null;
}

export function isInvoiced(j: InvoiceLockInput): boolean {
  return Boolean((j.invoiceNumber ?? "").trim() || j.invoicedAt);
}

/** Vyfakturovaná zakázka: hodnotu ani prodejní ceny / počty položek už nejde měnit. */
export function invoicedValueBlock(j: InvoiceLockInput): string | null {
  if (!isInvoiced(j)) return null;
  const no = (j.invoiceNumber ?? "").trim();
  return `Zakázka je vyfakturovaná${no ? ` (${no})` : ""} — hodnotu ani ceny a počty položek už nejde měnit. Rozdíl řeš dobropisem nebo opravnou fakturou.`;
}

export interface PoMoneyRef {
  number: string | null;
  status: string;
  total: number | null;
}

export function activePurchaseOrders<T extends { status: string }>(pos: T[]): T[] {
  return pos.filter((p) => p.status !== "zrusena");
}

/** Σ aktivních objednávek dodavatelům; null = žádná aktivní. */
export function orderedCost(pos: PoMoneyRef[]): number | null {
  const act = activePurchaseOrders(pos);
  if (!act.length) return null;
  return r2(act.reduce((s, p) => s + (Number.isFinite(p.total ?? NaN) ? (p.total as number) : 0), 0));
}

/** Ruční změna nákupních nákladů, když existují objednávky dodavatelům. */
export function purchaseCostEditBlock(pos: PoMoneyRef[], next: number | null, currency = "CZK"): string | null {
  const ordered = orderedCost(pos);
  if (ordered === null || sameMoney(ordered, next)) return null;
  const nums = activePurchaseOrders(pos).map((p) => p.number).filter(Boolean).join(", ");
  return `Nákupní náklady se počítají z objednávek dodavatelům${nums ? ` (${nums})` : ""}: ${formatKc(ordered, currency)}. Změň cenu v objednávce (záložka Nákup) — dokud neodešla, jde upravit celá, po odeslání jen doplnit cenu.`;
}

export interface QuoteRef {
  id: string;
  number: string | null;
  /** Odvozený stav (quotes.state). */
  state?: string | null;
  status?: string | null;
  total: number | null;
  archived?: boolean;
  accepted?: boolean;
  sentAt?: string | null;
}

/** Nabídka, kterou už zákazník má: přijatá, jinak poslední odeslaná (bez archivních a zamítnutých). */
export function bindingQuote(quotes: QuoteRef[]): (QuoteRef & { kind: "prijata" | "odeslana" }) | null {
  const accepted = quotes.find((q) => q.accepted || q.state === "prijata");
  if (accepted) return { ...accepted, kind: "prijata" };
  const sent = quotes
    .filter((q) => !q.archived && q.state !== "zamitnuta" && q.state !== "archivovana"
      && (q.state === "odeslana" || q.state === "pripominky" || (!q.state && (Boolean(q.sentAt) || q.status === "odeslano"))))
    .sort((a, b) => String(b.sentAt ?? "").localeCompare(String(a.sentAt ?? "")));
  return sent[0] ? { ...sent[0], kind: "odeslana" } : null;
}

/** „Cena už nebude odpovídat odeslané nabídce NAB-… (x Kč)" — null, když cena sedí / nabídka není. */
export function quotePriceWarning(quotes: QuoteRef[], newValue: number | null, currency = "CZK"): string | null {
  const q = bindingQuote(quotes);
  if (!q || q.total === null || newValue === null || sameMoney(q.total, newValue)) return null;
  const what = q.kind === "prijata" ? "přijaté" : "odeslané";
  return `Cena už nebude odpovídat ${what} nabídce ${q.number ?? ""} (${formatKc(q.total, currency)}) — vytvoř novou verzi nabídky a pošli ji zákazníkovi.`.replace(/ {2,}/g, " ");
}

// ── Nesoulad údajů (odznaky na kartě zakázky) ─────────────────
export type ConsistencyFix = "value_from_items" | "cost_from_orders" | "cost_from_items" | "quote_revision";

export interface ConsistencyIssue {
  key: string;
  /** Pole, u kterého se odznak ukáže. */
  field: "value" | "purchaseCost" | "items" | "dates" | "purchaseOrders";
  tone: "info" | "warn" | "danger";
  text: string;
  fix?: ConsistencyFix;
  fixLabel?: string;
  quoteId?: string;
}

export interface ConsistencyPoItem {
  orderItemId: string | null;
  quantity: number;
  label?: string | null;
}

export interface ConsistencyPo extends PoMoneyRef {
  id: string;
  requiredDate?: string | null;
  confirmedDate?: string | null;
  items?: ConsistencyPoItem[];
}

export interface ConsistencySnapshot {
  value: number | null;
  purchaseCost: number | null;
  currency?: string;
  invoiceNumber?: string | null;
  invoicedAt?: string | null;
  stage?: string | null;
  items: (MoneyItem & { id?: string | null })[];
  quotes?: QuoteRef[];
  /** null = bez práva na nákup (nákupní kontroly se vynechají). */
  purchaseOrders?: ConsistencyPo[] | null;
  margins?: boolean;
  dueDate?: string | null;
  customerRequiredDate?: string | null;
  maxToleratedDate?: string | null;
}

const CLOSED = new Set<string>([...CLOSED_STAGES, ...DELIVERED_STAGES]);

function plural(n: number, one: string, few: string, many: string): string {
  return n === 1 ? one : n >= 2 && n <= 4 ? few : many;
}

function itemLabel(it: MoneyItem | undefined, i: number): string {
  const l = (it?.label ?? "").trim();
  return l || `položka ${i + 1}`;
}

/** Všechny nesoulady údajů zakázky (prázdné = vše sedí). */
export function consistencyIssues(s: ConsistencySnapshot): ConsistencyIssue[] {
  const cur = s.currency || "CZK";
  const out: ConsistencyIssue[] = [];
  const invoiced = isInvoiced(s);
  const itemsValue = itemsSaleValue(s.items);
  const unpriced = unpricedCount(s.items);

  if (itemsValue !== null && !sameMoney(itemsValue, s.value)) {
    out.push({
      key: "value_items", field: "value", tone: "warn",
      text: `Součet položek ${formatKc(itemsValue, cur)} neodpovídá hodnotě zakázky ${formatKc(s.value, cur)}.${invoiced ? " Zakázka je vyfakturovaná — rozdíl už jen dobropisem." : ""}`,
      ...(invoiced ? {} : { fix: "value_from_items" as const, fixLabel: "Srovnat podle položek" }),
    });
  }
  if (itemsValue !== null && unpriced > 0) {
    out.push({
      key: "items_unpriced", field: "items", tone: "info",
      text: `${unpriced} ${plural(unpriced, "položka nemá", "položky nemají", "položek nemá")} prodejní cenu — hodnota zakázky je jen součet nacenených.`,
    });
  }
  if (s.quotes?.length) {
    const q = bindingQuote(s.quotes);
    if (q && q.total !== null && s.value !== null && !sameMoney(q.total, s.value)) {
      out.push({
        key: "value_quote", field: "value", tone: "warn",
        text: `Hodnota zakázky ${formatKc(s.value, cur)} už neodpovídá ${q.kind === "prijata" ? "přijaté" : "odeslané"} nabídce ${q.number ?? ""} (${formatKc(q.total, cur)}).`.replace(/ {2,}/g, " "),
        // přijatou nabídku nová verze nenahradí (zákazník ji už objednal) — jen upozornění
        ...(invoiced || q.kind === "prijata" ? {} : { fix: "quote_revision" as const, fixLabel: "Nová verze nabídky z položek", quoteId: q.id }),
      });
    }
  }

  const pos = s.purchaseOrders;
  if (pos && s.margins !== false) {
    const active = activePurchaseOrders(pos);
    const ordered = orderedCost(pos);
    if (ordered !== null && !sameMoney(ordered, s.purchaseCost)) {
      out.push({
        key: "cost_orders", field: "purchaseCost", tone: "warn",
        text: `Nákupní náklady ${formatKc(s.purchaseCost, cur)} neodpovídají objednávkám dodavatelům ${formatKc(ordered, cur)}.`,
        ...(invoiced ? {} : { fix: "cost_from_orders" as const, fixLabel: "Srovnat podle objednávek" }),
      });
    }
    const itemsPurchase = itemsPurchaseValue(s.items);
    if (ordered === null && itemsPurchase !== null && !sameMoney(itemsPurchase, s.purchaseCost)) {
      out.push({
        key: "cost_items", field: "purchaseCost", tone: "info",
        text: `Nákup podle položek ${formatKc(itemsPurchase, cur)} ≠ nákupní náklady ${formatKc(s.purchaseCost, cur)}.`,
        ...(invoiced ? {} : { fix: "cost_from_items" as const, fixLabel: "Srovnat podle položek" }),
      });
    }
    // počty kusů: řádek objednávky navázaný na položku zakázky
    const byId = new Map(s.items.map((it, i) => [it.id ?? "", { it, i }]));
    for (const po of active) {
      for (const line of po.items ?? []) {
        if (!line.orderItemId) continue;
        const ref = byId.get(line.orderItemId);
        if (!ref) continue;
        const want = qty(ref.it.quantity);
        const got = qty(line.quantity);
        if (Math.abs(want - got) < 0.0005) continue;
        out.push({
          key: `po_qty_${po.id}_${line.orderItemId}`, field: "purchaseOrders", tone: "warn",
          text: `Objednávka ${po.number ?? ""}: ${itemLabel(ref.it, ref.i)} — objednáno ${fmtQty(got)} ks, zakázka má ${fmtQty(want)} ks (${got < want ? "méně" : "více"}).`.replace(/ {2,}/g, " "),
        });
      }
    }
    // termíny objednávek vůči termínu zákazníka
    const deadline = s.dueDate || s.customerRequiredDate || null;
    if (deadline && !CLOSED.has(String(s.stage ?? ""))) {
      for (const po of active) {
        if (po.status === "dodana") continue;
        const d = po.confirmedDate || po.requiredDate || null;
        if (d && d > deadline) {
          out.push({
            key: `po_date_${po.id}`, field: "dates", tone: po.confirmedDate ? "danger" : "warn",
            text: `Objednávka ${po.number ?? ""} ${po.confirmedDate ? "má potvrzené dodání" : "požaduje dodání"} ${czDate(d)} — až po termínu zákazníka ${czDate(deadline)}.`.replace(/ {2,}/g, " "),
          });
        }
      }
    }
  }
  if (s.maxToleratedDate && s.dueDate && s.maxToleratedDate < s.dueDate && !CLOSED.has(String(s.stage ?? ""))) {
    out.push({
      key: "dates_max", field: "dates", tone: "warn",
      text: `Max. tolerovaný termín ${czDate(s.maxToleratedDate)} je dřív než potvrzený termín ${czDate(s.dueDate)}.`,
    });
  }
  return out;
}

function fmtQty(n: number): string {
  return new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 3 }).format(n);
}

// ── Párování položek nabídky na položky zakázky ───────────────
export interface PairableItem {
  drawingNumber?: string | null;
  name?: string | null;
  quantity?: number | null;
}

function norm(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "");
}

/**
 * Položka nabídky → položka zakázky (index): stejné číslo výkresu (jednoznačně), jinak stejný
 * název, jinak stejná pozice, když mají obě strany stejný počet položek. Každá jen jednou.
 */
export function pairQuoteItems(jobItems: PairableItem[], quoteItems: PairableItem[]): Map<number, number> {
  const out = new Map<number, number>(); // jobIndex → quoteIndex
  const usedQ = new Set<number>();
  const tryKey = (key: (x: PairableItem) => string) => {
    jobItems.forEach((ji, j) => {
      if (out.has(j)) return;
      const k = key(ji);
      if (!k) return;
      const cands = quoteItems.map((qi, q) => ({ qi, q })).filter(({ qi, q }) => !usedQ.has(q) && key(qi) === k);
      const sameKeyJobs = jobItems.filter((x, jj) => !out.has(jj) && key(x) === k).length;
      if (cands.length === 1 && sameKeyJobs === 1) {
        out.set(j, cands[0].q);
        usedQ.add(cands[0].q);
      }
    });
  };
  tryKey((x) => norm(x.drawingNumber));
  tryKey((x) => `${norm(x.drawingNumber)}|${norm(x.name)}`);
  tryKey((x) => norm(x.name));
  if (jobItems.length === quoteItems.length) {
    jobItems.forEach((_, j) => {
      if (!out.has(j) && !usedQ.has(j)) {
        out.set(j, j);
        usedQ.add(j);
      }
    });
  }
  return out;
}
