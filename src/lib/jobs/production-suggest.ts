// Předání do výroby — kdo to dělá, do kdy a jaký postup (čisté funkce, bez DB; spec §D, §E.2).
// Data dodá server (production-handoff-store, WP2); tady jen deterministická pravidla:
//  * na co je nabídka dodavatele (druhy kroků) a jak sedí na krok,
//  * porovnatelná cena (ks / kg × hmotnost / komplet), platnost, měna, pokrytí dílů,
//  * pořadí návrhů a primární volba „Nejlevnější nabídka" (i proti vítězi z Nákupu),
//  * termín kroku z nabídky / lhůty / konečného termínu, postup z výkresu a nabídek,
//  * položky a poznámka objednávky dodavateli pro krok.
import { OPERATION_KINDS, type OperationKind } from "@/lib/jobs/operations";
import {
  SUPPLIER_BUFFER_WORKING_DAYS, addCalendarDays, addWorkingDays, isWorkingDay, purchaseOrderNote, r2, supplierNoteSegment,
} from "@/lib/jobs/purchasing";
import type { PurchaseItemInput } from "@/lib/jobs/purchasing-types";
import type { PurchaseOrderStatus } from "@/lib/supabase/database.types";
import type {
  DeadlineSource, StepWho, SuggestionBadge, WhoSource, WhoSuggestion,
} from "@/lib/jobs/production-handoff-types";

// ── Formát ──────────────────────────────────────────────────
/** „12 400 Kč" (mezery po tisících, bez haléřů u celých částek). */
export function money(n: number, currency = "CZK"): string {
  const rounded = Math.round(n * 100) / 100;
  const [int, dec] = Math.abs(rounded).toFixed(Number.isInteger(rounded) ? 0 : 2).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const unit = currency === "CZK" ? "Kč" : currency;
  return `${rounded < 0 ? "−" : ""}${grouped}${dec ? `,${dec}` : ""} ${unit}`;
}

/** „13. 11." z RRRR-MM-DD. */
export function shortDay(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  return m ? `${Number(m[3])}. ${Number(m[2])}.` : (iso ?? "");
}

/** „5 dní" / „1 den" / „3 dny" / „3 týdny" (násobky týdne jako týdny). */
export function leadTimeLabel(days: number): string {
  const d = Math.round(days);
  if (d >= 7 && d % 7 === 0) {
    const w = d / 7;
    return `${w} ${w === 1 ? "týden" : w < 5 ? "týdny" : "týdnů"}`;
  }
  return `${d} ${d === 1 ? "den" : d >= 2 && d <= 4 ? "dny" : "dní"}`;
}

function kindLabel(kind: OperationKind): string {
  return OPERATION_KINDS[kind].label;
}

function lower(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** „Naposledy dělal {výrobu / povrchovou úpravu / kontrolu…}" — 4. pád názvu druhu kroku. */
const KIND_ACCUSATIVE: Partial<Record<OperationKind, string>> = {
  vyroba: "výrobu", povrchova_uprava: "povrchovou úpravu", kontrola: "kontrolu / měření", doprava: "dopravu",
  kompletni_dodavka: "kompletní dodávku", jine: "jinou operaci",
};

export function kindAccusative(kind: OperationKind): string {
  return KIND_ACCUSATIVE[kind] ?? lower(kindLabel(kind));
}

// ── Druhy kroků z textu / technologií (D.2) ─────────────────
const TEXT_RULES: [RegExp, OperationKind][] = [
  [/dlouhoto[čc]|swiss|soustru[žz]|\bturn/, "soustruzeni"],
  [/fr[ée]z|\bmill/, "frezovani"],
  [/brou[sš]/, "brouseni"],
  [/dr[áa]t(ov|\b)|wedm|\bwire/, "dratove_rezani"],
  [/hloubení|hloubeni|hloubi[čc]|\bedm\b|elektroeroz/, "elektroeroze"],
  [/vrt[áa]n|z[áa]vitov/, "vrtani"],
  [/laser|vodn[íi] paprs|waterjet|p[áa]len[íi]|plazm|plamen|ohraň|ohran/, "plech"],
  [/sva[řr]|\bweld/, "svarovani"],
  [/mont[áa][žz]|\bassembl/, "montaz"],
  // „kalit / kalení / kalený / zakalit / zakalení / prokalit / prokalení / vykalit" (ne „kalibrace", ne „nekalit",
  // ne „kalendář / kalendářních dnů"); „zušlechtit / zušlechtění"; \b v JS regexu zná jen ASCII písmena —
  // hranice slova proto přes Unicode (\p{L})
  [/(?<!\p{L})(?:za|pro|vy|do|po)?kal(?:en(?!d)|it|ít|í(?!\p{L}))|zušlecht|zuslecht|žíh|zih|cement|nitrid|popou|tepeln/u, "tepelne_zpracovani"],
  // jen slova úpravy, ne požadavky dílu („povrch Ra 0,8") ani materiál („chromniklová ocel")
  [/povrchov[áa]\s+úp|povrchov[ěe]\s+upr|zinek|zinko|pozink|elox|černěn|cernen|\bchrom(ov|át|at)|\bchrom\b|\bpochrom|tvrdochrom|\bnikl(ov|en)|\bponikl|\blak|fosf|\bpvd|\bcvd|povlak|tryskán|tryskan/, "povrchova_uprava"],
  [/kompletn[íi] dod[áa]vk|na kl[íi][čc]/, "kompletni_dodavka"],
];

/**
 * Druhy kroků z volného textu (poznámka nabídky, názvy položek). Na rozdíl od
 * normalizeTechnology sbírá VŠECHNY shody („Frézování + kalení" → obojí).
 * „kalibrace" už není kalení.
 */
export function operationKindsOfText(text: string | null | undefined): OperationKind[] {
  const out: OperationKind[] = [];
  const parts = String(text ?? "").toLowerCase().split(/[,;/+\n]|\s+a\s+|\s+\+\s+/);
  for (const part of parts) {
    const t = part.trim();
    if (!t) continue;
    for (const [re, kind] of TEXT_RULES) if (re.test(t) && !out.includes(kind)) out.push(kind);
  }
  return out;
}

/** Technologie z adresáře dodavatelů (klíče kalkulace i volný text) → druhy kroků. */
const TECHNOLOGY_KIND: Record<string, OperationKind> = {
  soustruzeni: "soustruzeni", dlouhotocne_soustruzeni: "soustruzeni",
  frezovani_3osy: "frezovani", frezovani_4osy: "frezovani", frezovani_5os: "frezovani", frezovani: "frezovani",
  brouseni: "brouseni", dratove_rezani: "dratove_rezani", hloubeni_edm: "elektroeroze",
  svarovani: "svarovani", montaz: "montaz", laser: "plech", vodni_paprsek: "plech", paleni: "plech",
  tepelne_zpracovani: "tepelne_zpracovani", povrchova_uprava: "povrchova_uprava",
};

/** Všechny druhy kroků z technologií dodavatele (i víc rodin — doporučení dodavatelů k poptávce). */
export function kindsOfTechnologies(technologies: (string | null | undefined)[]): OperationKind[] {
  const out: OperationKind[] = [];
  for (const raw of technologies) {
    const t = String(raw ?? "").trim();
    if (!t) continue;
    const mapped = TECHNOLOGY_KIND[t.toLowerCase()];
    const kinds = mapped ? [mapped] : operationKindsOfText(t);
    for (const k of kinds) if (!out.includes(k)) out.push(k);
  }
  return out;
}

/**
 * Druhy z technologií dodavatele — jen když všechny patří do JEDNÉ rodiny
 * (firma, která obrábí i kalí, nic neprozradí o konkrétní nabídce).
 */
export function operationKindsOfSupplier(technologies: (string | null | undefined)[] | null | undefined): OperationKind[] {
  const kinds = kindsOfTechnologies(technologies ?? []);
  if (!kinds.length) return [];
  const families = new Set(kinds.map(operationFamily));
  return families.size === 1 ? kinds : [];
}

// ── Rodiny a shoda nabídky s krokem (D.3) ───────────────────
export type OperationFamily = "obrabeni" | "tepelne" | "povrch" | "komplet" | "montaz" | "kontrola" | "doprava";

export function operationFamily(kind: OperationKind): OperationFamily {
  switch (kind) {
    case "tepelne_zpracovani": return "tepelne";
    case "povrchova_uprava": return "povrch";
    case "kompletni_dodavka": return "komplet";
    case "montaz": return "montaz";
    case "kontrola": return "kontrola";
    case "doprava": return "doprava";
    default: return "obrabeni";
  }
}

/** Vstup: nabídka dodavatele k zakázce (view z Nákupu + údaje dodavatele). */
export interface SuggestQuote {
  id: string;
  supplierId: string | null;
  supplierName: string;
  number: string | null;
  quoteDate: string | null;
  validUntil: string | null;
  leadTimeDays: number | null;
  deliveryDate: string | null;
  currency: string;
  total: number | null;
  /** Vítězná v Nákupu (často nastaví capture / vystavení objednávky automaticky). */
  selected: boolean;
  selectedBy?: string | null;
  selectedAt?: string | null;
  note: string | null;
  /** supplier_quotes.operation_kinds — vyplněné ručně nebo z capture. */
  operationKinds?: string[] | null;
  items: { drawingNumber: string | null; name: string | null; quantity: number; unit: string; unitPrice: number | null; note: string | null }[];
  supplierTechnologies?: string[] | null;
  supplierRating?: number | null;
  supplierLeadDays?: number | null;
  supplierEmail?: string | null;
}

export interface QuoteKinds {
  kinds: OperationKind[];
  source: "explicit" | "text" | "supplier" | "unknown";
}

function isKind(v: unknown): v is OperationKind {
  return typeof v === "string" && v in OPERATION_KINDS;
}

/** Na co je nabídka: zadané druhy → text nabídky → technologie dodavatele (jedna rodina) → neznámé. */
export function quoteKinds(q: Pick<SuggestQuote, "operationKinds" | "note" | "items" | "supplierTechnologies">): QuoteKinds {
  const explicit = (q.operationKinds ?? []).filter(isKind);
  if (explicit.length) return { kinds: explicit, source: "explicit" };
  // poznámky položek opakují požadavky výkresu („1.2379, kalit 58–60 HRC") — o tom, co firma nabízí, neříkají nic
  const text = [q.note, ...q.items.map((i) => i.name)].filter(Boolean).join("\n");
  const fromText = operationKindsOfText(text);
  if (fromText.length) return { kinds: fromText, source: "text" };
  const fromSupplier = operationKindsOfSupplier(q.supplierTechnologies ?? []);
  if (fromSupplier.length) return { kinds: fromSupplier, source: "supplier" };
  return { kinds: [], source: "unknown" };
}

/**
 * Jak nabídka sedí na krok: 3 = přesně ten druh, 2 = stejná rodina (nebo komplet ↔ obrábění),
 * 1 = neznámé druhy u obráběcího / kompletního kroku, 0 = nehodí se (vyřazeno).
 */
export function quoteStepMatch(kinds: OperationKind[], stepKind: OperationKind): 0 | 1 | 2 | 3 {
  const fam = operationFamily(stepKind);
  if (!kinds.length) return fam === "obrabeni" || fam === "komplet" ? 1 : 0;
  if (kinds.includes(stepKind)) return 3;
  for (const k of kinds) {
    const f = operationFamily(k);
    if (f === fam) return 2;
    if ((f === "komplet" && fam === "obrabeni") || (f === "obrabeni" && fam === "komplet")) return 2;
  }
  return 0;
}

/** Nabídka na kompletní dodávku (obrábění i úpravy jednou firmou). */
export function isCompleteQuote(q: Pick<SuggestQuote, "operationKinds" | "note" | "items" | "supplierTechnologies">): boolean {
  return quoteKinds(q).kinds.includes("kompletni_dodavka");
}

/** Krok obrábění nebo kompletní dodávky (díly z něj vycházejí hotové / obrobené). */
export function isMachiningKind(kind: OperationKind): boolean {
  const f = operationFamily(kind);
  return f === "obrabeni" || f === "komplet";
}

function scopesOverlap(a: string[] | null | undefined, b: string[] | null | undefined): boolean {
  if (!a || !b) return true;
  return a.some((id) => b.includes(id));
}

/**
 * Díly kroku už dělá jiný (dřívější) krok obrábění / kompletní dodávky → popisek toho kroku („krok 1 (Výroba 1)"),
 * jinak null. Takový krok je DALŠÍ výroba (Výroba 2, 3 …): kompletní dodávka by díly objednala podruhé.
 * Platí jen pro krok obrábění / kompletní dodávky (kalírna, povrch … se neřeší).
 */
export function coveringStep(
  step: { kind: OperationKind; orderItemIds?: string[] | null },
  earlier: { kind: OperationKind; orderItemIds?: string[] | null; label: string }[],
): string | null {
  if (!isMachiningKind(step.kind)) return null;
  const hit = earlier.find((o) => isMachiningKind(o.kind) && scopesOverlap(o.orderItemIds ?? null, step.orderItemIds ?? null));
  return hit ? hit.label : null;
}

/** Nápověda ke kroku bez návrhu, když díly už dělá jiný krok (žádná kompletní dodávka ani cizí nabídka se nepředvyplní). */
export function coveredHint(coveredBy: string): string {
  return `Díly už dělá ${coveredBy} — kompletní dodávka se tu znovu nenabízí (obrábění by se objednalo dvakrát). Vyber firmu na tento krok, nebo „U nás“.`;
}

// ── Porovnatelná cena (D.4) ─────────────────────────────────
/** = SQL drawing_norm(): velká písmena, bez mezer, teček, pomlček a lomítek. */
export function normalizeDrawingNumber(v: string | null | undefined): string | null {
  const s = String(v ?? "").toUpperCase().replace(/[\s.\-/]/g, "");
  return s || null;
}

export type UnitClass = "piece" | "weight" | "lot" | "other";

export function unitClass(unit: string | null | undefined): UnitClass {
  const u = String(unit ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!u || u === "ks" || u === "kus" || u === "kusy" || u === "pcs" || u === "pc") return "piece";
  if (u === "kg") return "weight";
  if (["kpl", "komplet", "sada", "celkem", "paušál", "pausal"].includes(u)) return "lot";
  return "other";
}

/** Díl zakázky (order_items) — vše kromě id a množství může chybět. */
export interface SuggestItem {
  id: string;
  drawingNumber: string | null;
  name: string | null;
  description?: string | null;
  material?: string | null;
  materialGroup?: string | null;
  materialDesignation?: string | null;
  quantity: number;
  unit?: string | null;
  weightKg?: number | null;
  heatTreatment?: string | null;
  surfaceTreatment?: string | null;
  hardness?: string | null;
  purchaseUnitPrice?: number | null;
  /** Poznámka pro dodavatele (Technologie) — do objednávky u položky jako „Pozor: …". */
  supplierNote?: string | null;
}

export interface QuoteLine {
  orderItemId: string;
  /** Index položky nabídky; null = díl nabídka nepokrývá. */
  quoteItem: number | null;
  value: number | null;
  unitClass: UnitClass | null;
}

export interface QuoteValue {
  /** Porovnatelná částka za díly kroku; null = nelze porovnat („čeká na cenu"). */
  value: number | null;
  basis: "celkem" | "prepocet_mnozstvi" | "cast_polozek" | null;
  coverage: { matched: number; total: number; uncovered: string[] };
  quantityMismatch: { quoted: number; ordered: number; unit: string } | null;
  /** Cena za kg bez známé hmotnosti dílu → „za kg — porovnej ručně". */
  perKgNoWeight: boolean;
  lines: QuoteLine[];
}

function matchQuoteItems(q: Pick<SuggestQuote, "items">, scope: SuggestItem[], all: SuggestItem[]): Map<string, number> {
  const out = new Map<string, number>();
  const used = new Set<number>();
  const anyDrawing = q.items.some((i) => normalizeDrawingNumber(i.drawingNumber));
  if (anyDrawing) {
    for (const it of scope) {
      const key = normalizeDrawingNumber(it.drawingNumber);
      if (!key) continue;
      const idx = q.items.findIndex((qi, i) => !used.has(i) && normalizeDrawingNumber(qi.drawingNumber) === key);
      if (idx >= 0) { out.set(it.id, idx); used.add(idx); }
    }
    return out;
  }
  // bez čísel výkresů: po pořadí, když sedí počet (na díly kroku, jinak na všechny díly zakázky)
  if (q.items.length === scope.length) scope.forEach((it, i) => out.set(it.id, i));
  else if (q.items.length === all.length) all.forEach((it, i) => { if (scope.some((s) => s.id === it.id)) out.set(it.id, i); });
  return out;
}

/** Porovnatelná hodnota nabídky pro díly kroku (ks × množství, kg × hmotnost × množství, komplet). */
export function quoteValue(q: Pick<SuggestQuote, "items" | "total">, scopeItems: SuggestItem[], allItems: SuggestItem[] = scopeItems): QuoteValue {
  const total = scopeItems.length;
  if (!q.items.length) {
    return {
      value: q.total !== null && q.total !== undefined ? r2(q.total) : null,
      basis: q.total !== null && q.total !== undefined ? "celkem" : null,
      coverage: { matched: total, total, uncovered: [] },
      quantityMismatch: null, perKgNoWeight: false,
      lines: scopeItems.map((it) => ({ orderItemId: it.id, quoteItem: null, value: null, unitClass: null })),
    };
  }
  const match = matchQuoteItems(q, scopeItems, allItems);
  let mismatch: QuoteValue["quantityMismatch"] = null;
  let perKgNoWeight = false;
  const lines: QuoteLine[] = scopeItems.map((it) => {
    const idx = match.get(it.id);
    if (idx === undefined) return { orderItemId: it.id, quoteItem: null, value: null, unitClass: null };
    const qi = q.items[idx];
    const cls = unitClass(qi.unit);
    if (qi.unitPrice === null || qi.unitPrice === undefined) return { orderItemId: it.id, quoteItem: idx, value: null, unitClass: cls };
    let value: number | null = null;
    if (cls === "piece") {
      value = qi.unitPrice * it.quantity;
      if (Math.abs(qi.quantity - it.quantity) > 1e-9 && !mismatch) mismatch = { quoted: qi.quantity, ordered: it.quantity, unit: qi.unit || "ks" };
    } else if (cls === "weight") {
      if (it.weightKg && it.weightKg > 0) value = qi.unitPrice * it.weightKg * it.quantity;
      else perKgNoWeight = true;
    } else if (cls === "lot") {
      value = qi.unitPrice * qi.quantity;
    } else if (Math.abs(qi.quantity - it.quantity) < 1e-9) {
      value = qi.unitPrice * qi.quantity;
    }
    return { orderItemId: it.id, quoteItem: idx, value: value === null ? null : r2(value), unitClass: cls };
  });
  const matched = lines.filter((l) => l.quoteItem !== null);
  const uncovered = lines.filter((l) => l.quoteItem === null).map((l) => l.orderItemId);
  const coverage = { matched: matched.length, total, uncovered };
  // nabídka jen s celkovou cenou (položky bez cen) a plným pokrytím = celková částka
  if (matched.length === total && total > 0 && matched.every((l) => q.items[l.quoteItem as number].unitPrice === null)
      && q.total !== null && q.total !== undefined) {
    return { value: r2(q.total), basis: "celkem", coverage, quantityMismatch: null, perKgNoWeight: false, lines };
  }
  if (!matched.length || matched.some((l) => l.value === null)) {
    return { value: null, basis: null, coverage, quantityMismatch: mismatch, perKgNoWeight, lines };
  }
  const sum = r2(matched.reduce((s, l) => s + (l.value ?? 0), 0));
  return {
    value: sum,
    basis: uncovered.length ? "cast_polozek" : "prepocet_mnozstvi",
    coverage, quantityMismatch: mismatch, perKgNoWeight, lines,
  };
}

// ── Pořadí návrhů (D.5) ─────────────────────────────────────
export interface RankedQuote {
  quote: SuggestQuote;
  match: 1 | 2 | 3;
  kinds: QuoteKinds;
  value: QuoteValue;
  /** Stejná měna jako zakázka a známá hodnota. */
  comparable: boolean;
  foreignCurrency: boolean;
  expired: boolean;
  fullCoverage: boolean;
  /** Termín dodání: explicitní z nabídky, jinak (datum nabídky / dnes) + lhůta. */
  delivery: string | null;
  deliveryExplicit: boolean;
}

export interface StepContext {
  /** Druh kroku. */
  kind: OperationKind;
  /** Díly kroku (null = všechny). */
  orderItemIds?: string[] | null;
}

export interface RankContext {
  items: SuggestItem[];
  /** orders.currency (výchozí CZK). */
  currency: string;
  today: string;
  /** Dodavatel předchozího / dalšího kroku (shoda = výhoda při remíze). */
  neighbourSupplierIds?: (string | null | undefined)[];
  /** Nabídky už použité jiným krokem postupu (jedna nabídka na víc operací se nepočítá dvakrát). */
  excludeQuoteIds?: string[];
}

export function scopeItemsOf(items: SuggestItem[], orderItemIds: string[] | null | undefined): SuggestItem[] {
  if (!orderItemIds) return items;
  const set = new Set(orderItemIds);
  return items.filter((i) => set.has(i.id));
}

function quoteDelivery(q: SuggestQuote, today: string): { date: string | null; explicit: boolean } {
  if (q.deliveryDate) return { date: q.deliveryDate, explicit: true };
  if (q.leadTimeDays && q.leadTimeDays > 0) return { date: addCalendarDays(q.quoteDate ?? today, Math.round(q.leadTimeDays)), explicit: false };
  return { date: null, explicit: false };
}

function compareRanked(a: RankedQuote, b: RankedQuote, neighbours: Set<string>): number {
  if (a.expired !== b.expired) return a.expired ? 1 : -1;
  if (a.fullCoverage !== b.fullCoverage) return a.fullCoverage ? -1 : 1;
  // remíza = stejná cena po zaokrouhlení na celé koruny (tranzitivní → pořadí nezávisí na vstupu)
  const va = a.value.value === null ? Number.POSITIVE_INFINITY : Math.round(a.value.value);
  const vb = b.value.value === null ? Number.POSITIVE_INFINITY : Math.round(b.value.value);
  if (va !== vb) return va < vb ? -1 : 1;
  // remíza → dřívější dodání (termín z nabídky, jinak datum nabídky + lhůta — jako D.7)
  if (a.delivery !== b.delivery) {
    if (!a.delivery) return 1;
    if (!b.delivery) return -1;
    return a.delivery < b.delivery ? -1 : 1;
  }
  const na = a.quote.supplierId ? neighbours.has(a.quote.supplierId) : false;
  const nb = b.quote.supplierId ? neighbours.has(b.quote.supplierId) : false;
  if (na !== nb) return na ? -1 : 1;
  const ra = a.quote.supplierRating ?? -1;
  const rb = b.quote.supplierRating ?? -1;
  if (ra !== rb) return rb - ra;
  const da = a.quote.quoteDate ?? "";
  const db = b.quote.quoteDate ?? "";
  if (da !== db) return da < db ? 1 : -1;
  const n = a.quote.supplierName.localeCompare(b.quote.supplierName, "cs");
  return n !== 0 ? n : a.quote.id.localeCompare(b.quote.id);
}

/**
 * Nabídky vhodné pro krok, seřazené deterministicky: platné před prošlými, plné pokrytí před
 * částečným, cena vzestupně, při remíze dřívější dodání, soused v postupu, hodnocení, novější, A–Z.
 * Nepoužitelné pro krok (jiná rodina) vypadnou. Porovnatelné (měna zakázky, známá cena) jsou první.
 */
export function rankQuotesForStep(step: StepContext, quotes: SuggestQuote[], ctx: RankContext): { comparable: RankedQuote[]; other: RankedQuote[] } {
  const scope = scopeItemsOf(ctx.items, step.orderItemIds);
  const currency = (ctx.currency || "CZK").toUpperCase();
  const neighbours = new Set((ctx.neighbourSupplierIds ?? []).filter((x): x is string => Boolean(x)));
  const excluded = new Set(ctx.excludeQuoteIds ?? []);
  const ranked: RankedQuote[] = [];
  for (const q of quotes) {
    if (excluded.has(q.id)) continue;
    const kinds = quoteKinds(q);
    const match = quoteStepMatch(kinds.kinds, step.kind);
    if (match === 0) continue;
    const value = quoteValue(q, scope, ctx.items);
    const foreignCurrency = (q.currency || "CZK").toUpperCase() !== currency;
    const d = quoteDelivery(q, ctx.today);
    ranked.push({
      quote: q, match, kinds, value,
      // nulová / záporná částka není cena (chybějící údaj), nesmí vyhrát „Nejlevnější nabídka"
      comparable: !foreignCurrency && value.value !== null && value.value > 0,
      foreignCurrency,
      expired: Boolean(q.validUntil && q.validUntil < ctx.today),
      fullCoverage: value.coverage.uncovered.length === 0,
      delivery: d.date, deliveryExplicit: d.explicit,
    });
  }
  const cmp = (a: RankedQuote, b: RankedQuote) => compareRanked(a, b, neighbours);
  return {
    comparable: ranked.filter((r) => r.comparable).sort(cmp),
    other: ranked.filter((r) => !r.comparable).sort((a, b) => {
      // nesrovnatelné: nejdřív to s nejdřívějším dodáním
      if (a.delivery !== b.delivery) {
        if (!a.delivery) return 1;
        if (!b.delivery) return -1;
        return a.delivery < b.delivery ? -1 : 1;
      }
      return cmp(a, b);
    }),
  };
}

// ── Návrh „kdo to dělá" (D.5, D.6) ──────────────────────────
export interface SuggestOpenPurchaseOrder {
  id: string;
  number: string;
  status: PurchaseOrderStatus;
  supplierId: string | null;
  supplierName: string;
  supplierQuoteId: string | null;
  requiredDate: string | null;
  confirmedDate: string | null;
  /** Druhy z nabídky objednávky (nebo technologií dodavatele). */
  kinds?: OperationKind[];
}

export interface SuggestHistory {
  /** Poslední objednávky stejného výkresu (nejnovější první). */
  drawings?: { drawingNumber: string; supplierId: string | null; supplierName: string; poNumber: string; orderDate: string; unitPrice: number | null; kind?: OperationKind | null }[];
  /** Poslední kroky stejného druhu / rodiny u stejného materiálu (nejnovější první). */
  operations?: { kind: OperationKind; inHouse: boolean; supplierId: string | null; supplierName: string | null; jobNumber: string; material: string | null }[];
  /** Dodavatelé z adresáře s technologiemi. */
  suppliers?: { id: string; name: string; technologies: string[]; leadDays: number | null; rating: number | null }[];
}

export interface SuggestWhoInput {
  step: StepContext & {
    /** Už naplánovaný kdo (připravený krok). */
    plannedWho?: StepWho | null;
    /** Jediný krok postupu (objednávka obrábění se počítá i bez druhů). */
    onlyStep?: boolean;
    /**
     * Díly kroku už dělá dřívější krok obrábění / kompletní dodávky (popisek „krok 1 (Výroba 1)" — coveringStep).
     * Pak se nenabízí žádná nabídka na kompletní dodávku (ani její objednávka) a předvyplní se jen nabídka
     * na tuto operaci; „stejná firma" a historie zůstanou jen jako volby (kdo zůstane prázdný s nápovědou).
     */
    coveredBy?: string | null;
  };
  quotes: SuggestQuote[];
  openPurchaseOrders?: SuggestOpenPurchaseOrder[];
  history?: SuggestHistory;
  ctx: RankContext;
  /** Bez práva „margins": žádné částky. */
  canSeePrices: boolean;
  /**
   * Nabídky už spotřebované jinou objednávkou / jiným krokem zakázky (id nabídky → „Výroba 1" /
   * „objednávka OV-…"). Druhá objednávka podle stejné nabídky by cenu započítala dvakrát — nabídka
   * se proto nenabízí jako „Nejlevnější nabídka"; firma zůstane návrhem „stejná firma jako … —
   * cena dle nové nabídky" (bez ceny).
   */
  usedQuotes?: Record<string, string>;
}

export interface WhoSuggestionResult {
  primary: WhoSuggestion | null;
  alternatives: WhoSuggestion[];
  /** Varování k primárnímu návrhu (prošlá nabídka). */
  warning: string | null;
  /** Žádný návrh: co má uživatel udělat. */
  message: string | null;
}

const PO_STATUS_TEXT: Record<PurchaseOrderStatus, string> = {
  navrh: "návrh", vystavena: "vystavená", odeslana: "odeslaná", potvrzena: "potvrzená", dodana: "dodaná", zrusena: "zrušená",
};

function whoOfQuote(q: SuggestQuote): StepWho {
  return q.supplierId ? { type: "supplier", id: q.supplierId, name: q.supplierName } : { type: "free", name: q.supplierName };
}

function blank(source: WhoSource, who: StepWho, reason: string): WhoSuggestion {
  return {
    source, who, supplierQuoteId: null, quoteNumber: null, purchaseOrder: null, price: null, currency: null, priceBasis: null,
    diffToBest: null, leadTimeDays: null, deliveryDate: null, coverage: null, expired: false, quantityMismatch: false, badges: [], reason,
  };
}

function fromRanked(r: RankedQuote, source: WhoSource, reason: string, best: number | null, canSeePrices: boolean): WhoSuggestion {
  const badges: SuggestionBadge[] = [];
  if (r.expired) badges.push("vyprsela");
  if (r.foreignCurrency) badges.push("jina_mena");
  if (!r.fullCoverage) badges.push("cast");
  if (r.value.perKgNoWeight) badges.push("za_kg");
  if (r.quote.selected) badges.push("vybrana");
  return {
    source,
    who: whoOfQuote(r.quote),
    supplierQuoteId: r.quote.id,
    quoteNumber: r.quote.number,
    purchaseOrder: null,
    price: canSeePrices ? r.value.value : null,
    currency: r.quote.currency || null,
    priceBasis: r.value.basis,
    diffToBest: canSeePrices && best !== null && r.value.value !== null && r.comparable ? r2(r.value.value - best) : null,
    leadTimeDays: r.quote.leadTimeDays,
    deliveryDate: r.delivery,
    coverage: { matched: r.value.coverage.matched, total: r.value.coverage.total, uncovered: r.value.coverage.uncovered },
    expired: r.expired,
    quantityMismatch: r.value.quantityMismatch !== null,
    badges,
    reason,
  };
}

function sameSupplier(a: StepWho | null | undefined, po: SuggestOpenPurchaseOrder): boolean {
  if (!a) return false;
  if (a.type === "supplier") return Boolean(po.supplierId) && a.id === po.supplierId;
  if (a.type === "free") return a.name.trim().toLowerCase() === po.supplierName.trim().toLowerCase();
  return false;
}

function stampText(by: string | null | undefined, at: string | null | undefined): string {
  const day = at ? shortDay(at.slice(0, 10)) : "";
  return [by, day].filter(Boolean).join(", ");
}

/**
 * Kdo krok udělá — primární návrh a alternativy:
 *  0) otevřená objednávka zakázky, která ke kroku sedí (použije se, nevystaví se druhá),
 *  1) nejlevnější porovnatelná platná nabídka („Nejlevnější nabídka" / „Jediná nabídka"),
 *  2) jen nesrovnatelné nabídky → nejdřívější dodání,
 *  3) historie: poslední dodavatel výkresu → poslední u stejné operace a materiálu → technologie.
 * Vítěz z Nákupu (selected) je PRVNÍ ALTERNATIVA, primární jen když je zároveň nejlevnější.
 */
export function suggestWhoForStep(input: SuggestWhoInput): WhoSuggestionResult {
  const { step, canSeePrices } = input;
  // další výroba (díly už dělá dřívější krok obrábění): kompletní dodávka by je objednala podruhé — vůbec se nenabízí
  const covered = step.coveredBy && isMachiningKind(step.kind) ? step.coveredBy : null;
  const quotes = covered ? input.quotes.filter((q) => !isCompleteQuote(q)) : input.quotes;
  const used = input.usedQuotes ?? {};
  const usedIds = Object.keys(used);
  const ctx: RankContext = usedIds.length ? { ...input.ctx, excludeQuoteIds: [...(input.ctx.excludeQuoteIds ?? []), ...usedIds] } : input.ctx;
  const fam = operationFamily(step.kind);
  const ranked = rankQuotesForStep(step, quotes, ctx);
  const best = ranked.comparable[0]?.value.value ?? null;
  const alternatives: WhoSuggestion[] = [];
  let primary: WhoSuggestion | null = null;
  let warning: string | null = null;

  // 0) existující otevřená objednávka
  const pos = (input.openPurchaseOrders ?? []).filter((p) => ["navrh", "vystavena", "odeslana", "potvrzena"].includes(p.status)
    && !(covered && (p.kinds ?? []).includes("kompletni_dodavka")));
  const poMatch = pos.find((p) => sameSupplier(step.plannedWho, p))
    ?? pos.find((p) => (p.kinds ?? []).length > 0 && quoteStepMatch(p.kinds ?? [], step.kind) >= 2)
    ?? ((fam === "obrabeni" || fam === "komplet") && pos.length === 1 && !(pos[0].kinds ?? []).length ? pos[0] : undefined);
  if (poMatch) {
    const who: StepWho = poMatch.supplierId ? { type: "supplier", id: poMatch.supplierId, name: poMatch.supplierName } : { type: "free", name: poMatch.supplierName };
    primary = {
      ...blank("objednavka", who, `Použije se vystavená objednávka ${poMatch.number} (${poMatch.supplierName}, ${PO_STATUS_TEXT[poMatch.status]})`),
      purchaseOrder: { id: poMatch.id, number: poMatch.number, status: poMatch.status },
      supplierQuoteId: poMatch.supplierQuoteId,
      deliveryDate: poMatch.confirmedDate ?? poMatch.requiredDate,
    };
  }

  // 1) nejlevnější porovnatelná nabídka
  const cheapest = ranked.comparable[0];
  const single = ranked.comparable.length === 1;
  if (cheapest) {
    const label = canSeePrices ? (single ? "Jediná nabídka" : "Nejlevnější nabídka") : "Doporučeno podle nabídek";
    const s = fromRanked(cheapest, "nejlevnejsi_nabidka", label, best, canSeePrices);
    s.badges = ["nejlevnejsi", ...s.badges];
    if (cheapest.expired) warning = `Nabídka vypršela ${shortDay(cheapest.quote.validUntil)} — ověř cenu u dodavatele.`;
    if (!primary) primary = s;
    else alternatives.push(s);
  }

  // vítěz z Nákupu jako první alternativa (když není primární)
  const winner = [...ranked.comparable, ...ranked.other].find((r) => r.quote.selected);
  if (winner && winner !== cheapest) {
    const stamp = stampText(winner.quote.selectedBy, winner.quote.selectedAt);
    const diff = canSeePrices && best !== null && winner.comparable && winner.value.value !== null && winner.value.value - best > 0.5
      ? ` · o ${money(winner.value.value - best, ctx.currency)} dražší` : "";
    alternatives.unshift(fromRanked(winner, "nabidka", `Vybraná v Nákupu${stamp ? ` (${stamp})` : ""}${diff}`, best, canSeePrices));
  }

  // ostatní porovnatelné, pak nesrovnatelné
  for (const r of ranked.comparable.slice(1)) {
    if (r === winner) continue;
    alternatives.push(fromRanked(r, "nabidka", r.expired ? `Nabídka vypršela ${shortDay(r.quote.validUntil)}` : "Další nabídka", best, canSeePrices));
  }
  for (const r of ranked.other) {
    if (r === winner) continue;
    const why = r.foreignCurrency ? `v ${r.quote.currency} — porovnej ručně`
      : r.value.perKgNoWeight ? "za kg — porovnej ručně" : "Nabídka bez porovnatelné ceny — porovnej ručně";
    alternatives.push(fromRanked(r, "nabidka", why, best, canSeePrices));
  }

  // 2) jen nesrovnatelné nabídky (cizí měna nikdy primární — bez kurzů; zůstane alternativou „v EUR — porovnej ručně")
  const firstOther = ranked.other.find((r) => !r.foreignCurrency);
  if (!primary && firstOther) {
    primary = fromRanked(firstOther, "nabidka", "Nabídka bez porovnatelné ceny — porovnej ručně", best, canSeePrices);
    const idx = alternatives.findIndex((a) => a.supplierQuoteId === firstOther.quote.id);
    if (idx >= 0) alternatives.splice(idx, 1);
  }

  // 2b) firma, jejíž nabídku už spotřeboval jiný krok / objednávka zakázky: návrh bez ceny („cena dle nové nabídky")
  const sameFirm: WhoSuggestion[] = [];
  for (const [qid, label] of Object.entries(used)) {
    const q = quotes.find((x) => x.id === qid);
    if (!q || quoteStepMatch(quoteKinds(q).kinds, step.kind) === 0) continue;
    const who = whoOfQuote(q);
    const key = who.type === "supplier" ? `s:${who.id}` : `f:${q.supplierName.trim().toLowerCase()}`;
    const has = (s: WhoSuggestion | null) => Boolean(s && (s.who.type === "supplier" ? `s:${s.who.id}` : s.who.type === "free" ? `f:${s.who.name.trim().toLowerCase()}` : s.who.type) === key);
    if (has(primary) || alternatives.some(has) || sameFirm.some(has)) continue;
    sameFirm.push(blank("posledni_operace", who, `Stejná firma jako ${label} — cena dle nové nabídky`));
  }
  // další výroba: předvyplní se jen nabídka na tuto operaci — stejná firma / historie jsou jen volby
  if (!primary && sameFirm.length && !covered) primary = sameFirm.shift() ?? null;
  alternatives.push(...sameFirm);

  // 3) historie
  if (!primary) {
    const h = historySuggestion(input);
    if (!covered) primary = h;
    else if (h && !alternatives.some((a) => a.who.type === h.who.type && whoKeyOf(a.who) === whoKeyOf(h.who))) alternatives.push(h);
  }

  // nejrychlejší dodání mezi návrhy z nabídek
  const all = [primary, ...alternatives].filter((x): x is WhoSuggestion => Boolean(x && x.supplierQuoteId && x.deliveryDate));
  if (all.length > 1) {
    const fastest = all.reduce((a, b) => ((b.deliveryDate as string) < (a.deliveryDate as string) ? b : a));
    if (!fastest.badges.includes("nejrychlejsi")) fastest.badges.push("nejrychlejsi");
  }

  // u použité objednávky nenabízet znovu nabídku téže firmy (výběr by chtěl druhou objednávku = po_duplicate)
  const poWho = primary?.source === "objednavka" ? primary.who : null;
  const samePoFirm = (a: WhoSuggestion) => Boolean(poWho && (
    (poWho.type === "supplier" && a.who.type === "supplier" && a.who.id === poWho.id)
    || (poWho.type === "free" && a.who.type === "free" && a.who.name.trim().toLowerCase() === poWho.name.trim().toLowerCase())));
  // objednávka, kterou by návrh vystavil (stejné pravidlo jako server) — náhled nesmí slíbit cenu, kterou objednávka mít nebude
  const withOrder = (s: WhoSuggestion | null): WhoSuggestion | null => {
    if (!s || !s.supplierQuoteId || s.source === "objednavka") return s;
    const q = input.quotes.find((x) => x.id === s.supplierQuoteId);
    if (!q) return s;
    const built = purchaseItemsForStep({ step, items: input.ctx.items, quote: q, includeUncovered: true });
    const priced = built.items.filter((it) => it.unitPrice !== null && it.unitPrice !== undefined);
    const total = r2(priced.reduce((sum, it) => sum + (it.unitPrice ?? 0) * it.quantity, 0));
    return { ...s, order: { itemCount: built.items.length, unpriced: built.items.length - priced.length, total: canSeePrices && priced.length ? total : null } };
  };
  return {
    primary: withOrder(primary),
    alternatives: alternatives
      .filter((a) => !primary || a.supplierQuoteId !== primary.supplierQuoteId || a.source !== primary.source)
      .filter((a) => !samePoFirm(a))
      .slice(0, 5)
      .map((a) => withOrder(a) as WhoSuggestion),
    warning,
    message: primary ? null : covered ? coveredHint(covered) : "K tomuto kroku nemáme nabídku — vyber firmu, nebo „U nás“.",
  };
}

function whoKeyOf(w: StepWho): string {
  if (w.type === "supplier") return `s:${w.id}`;
  if (w.type === "free") return `f:${w.name.trim().toLowerCase()}`;
  return w.type;
}

function historySuggestion(input: SuggestWhoInput): WhoSuggestion | null {
  const { step, ctx, history, canSeePrices } = input;
  const scope = scopeItemsOf(ctx.items, step.orderItemIds);
  const fam = operationFamily(step.kind);
  // a) poslední dodavatel stejného výkresu (stejná rodina operace má přednost)
  const norms = new Set(scope.map((i) => normalizeDrawingNumber(i.drawingNumber)).filter((x): x is string => Boolean(x)));
  const hits = (history?.drawings ?? []).filter((d) => norms.has(normalizeDrawingNumber(d.drawingNumber) ?? ""));
  const hit = hits.find((d) => d.kind && operationFamily(d.kind) === fam) ?? hits.find((d) => !d.kind) ?? null;
  if (hit) {
    const who: StepWho = hit.supplierId ? { type: "supplier", id: hit.supplierId, name: hit.supplierName } : { type: "free", name: hit.supplierName };
    const price = canSeePrices && hit.unitPrice !== null ? ` · naposledy ${money(hit.unitPrice, ctx.currency)}/ks` : "";
    return { ...blank("posledni_vykres", who, `Naposledy dělal výkres ${hit.drawingNumber}: ${hit.supplierName} (${hit.poNumber}, ${czFull(hit.orderDate)})${price}`) };
  }
  // b) poslední stejná operace (pak rodina) u stejného materiálu
  const ops = history?.operations ?? [];
  const op = ops.find((o) => o.kind === step.kind) ?? ops.find((o) => operationFamily(o.kind) === fam) ?? null;
  if (op) {
    const mat = op.material ? ` ${op.material}` : "";
    if (op.inHouse) return blank("posledni_operace", { type: "u_nas" }, `Naposledy jsme to dělali u nás (${op.jobNumber})`);
    const name = op.supplierName ?? "";
    if (name || op.supplierId) {
      const who: StepWho = op.supplierId ? { type: "supplier", id: op.supplierId, name } : { type: "free", name };
      return blank("posledni_operace", who, `Naposledy dělal ${kindAccusative(op.kind)}${mat}: ${name} (${op.jobNumber})`);
    }
  }
  // c) technologie dodavatelů (jedna rodina), hodnocení ↓, lhůta ↑
  const sups = (history?.suppliers ?? [])
    .filter((s) => {
      const kinds = operationKindsOfSupplier(s.technologies);
      return kinds.length > 0 && kinds.some((k) => operationFamily(k) === fam);
    })
    .sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || (a.leadDays ?? 9999) - (b.leadDays ?? 9999) || a.name.localeCompare(b.name, "cs"))
    .slice(0, 3);
  if (sups.length) {
    const s = sups[0];
    const lead = s.leadDays ? ` · obvykle ${leadTimeLabel(s.leadDays)}` : "";
    return { ...blank("technologie", { type: "supplier", id: s.id, name: s.name }, `Umí: ${s.technologies.join(", ")}${lead}`), leadTimeDays: s.leadDays };
  }
  return null;
}

function czFull(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${Number(m[3])}. ${Number(m[2])}. ${m[1]}` : iso;
}

// ── Termín kroku (D.7) ──────────────────────────────────────
export interface DeadlineSuggestion {
  date: string;
  source: DeadlineSource;
  caption: string;
  state: "odhad" | "plan";
}

/**
 * Předvyplněný termín kroku: základ = max(dnes, konec předchozího kroku) (+1 pracovní den
 * na dopravu, když krok dělá jiná firma) → termín z nabídky / lhůta z nabídky → obvyklá lhůta
 * dodavatele → konečný termín − 3 pracovní dny (poslední krok) → odhad +5 pracovních dní.
 */
/** Lhůta v kalendářních dnech nesmí skončit o víkendu / svátku → nejbližší další pracovní den. */
export function workingDayOnOrAfter(iso: string): string {
  return isWorkingDay(iso) ? iso : addWorkingDays(iso, 1);
}

export function suggestStepDeadline(input: {
  today: string;
  previousEnd?: string | null;
  /** Krok dělá jiná firma než předchozí (díl se veze). */
  performerChanged?: boolean;
  quote?: { deliveryDate: string | null; leadTimeDays: number | null } | null;
  supplierLeadDays?: number | null;
  isLast?: boolean;
  finalDate?: string | null;
  inHouse?: boolean;
}): DeadlineSuggestion {
  let base = input.previousEnd && input.previousEnd > input.today ? input.previousEnd : input.today;
  let suffix = "";
  if (input.previousEnd && input.performerChanged) {
    base = addWorkingDays(base, 1);
    suffix = " + 1 den doprava";
  }
  const state: DeadlineSuggestion["state"] = input.inHouse ? "plan" : "odhad";
  const q = input.quote;
  if (q?.deliveryDate && q.deliveryDate >= base) {
    return { date: q.deliveryDate, source: "nabidka_dodavatele", caption: `z nabídky (termín ${shortDay(q.deliveryDate)})`, state };
  }
  if (q?.leadTimeDays && q.leadTimeDays > 0) {
    return { date: workingDayOnOrAfter(addCalendarDays(base, Math.round(q.leadTimeDays))), source: "nabidka_dodavatele", caption: `z nabídky (${leadTimeLabel(q.leadTimeDays)})${suffix}`, state };
  }
  if (input.supplierLeadDays && input.supplierLeadDays > 0) {
    return {
      date: workingDayOnOrAfter(addCalendarDays(base, Math.round(input.supplierLeadDays))), source: "lhuta_dodavatele",
      caption: `obvyklá lhůta dodavatele (${leadTimeLabel(input.supplierLeadDays)})${suffix}`, state,
    };
  }
  if (input.isLast && input.finalDate) {
    const d = addWorkingDays(input.finalDate, -SUPPLIER_BUFFER_WORKING_DAYS);
    if (d >= base) return { date: d, source: "termin_zakaznika", caption: `konečný termín − ${SUPPLIER_BUFFER_WORKING_DAYS} pracovní dny`, state };
  }
  return { date: addWorkingDays(base, 5), source: "odhad", caption: `odhad (+5 pracovních dní)${suffix} — uprav podle dohody`, state };
}

// ── Postup z výkresu a nabídek (D.8) ────────────────────────
export interface RouteStepSuggestion {
  kind: OperationKind;
  orderItemIds: string[] | null;
  note: string | null;
  /** Nabídka, podle které je krok předvyplněný (null = bez nabídky). */
  supplierQuoteId: string | null;
  who: StepWho;
  /** Existující krok (připravený postup). */
  operationId?: string | null;
}

export interface RouteSuggestion {
  source: "planovane" | "nabidky" | "vykres" | "vychozi";
  steps: RouteStepSuggestion[];
  routes: { key: string; label: string; total: number | null; complete: boolean; selected: boolean; steps: RouteStepSuggestion[] }[];
  banner: string;
  /** „+ Tepelné zpracování (výkres: kalit 58–60 HRC)" — co AI přidala podle výkresu. */
  chips: string[];
}

function heatText(i: SuggestItem): string | null {
  return [i.heatTreatment, i.hardness].map((x) => (x ?? "").trim()).filter(Boolean).join(" ") || null;
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

/**
 * Díly kroku tepelného zpracování / povrchové úpravy bez vybraných dílů (krok ze šablony): jen díly,
 * které mají úpravu na výkresu. null = všechny díly (úpravu mají všechny, žádný, nebo jiný druh kroku).
 */
export function familyScopeOf(kind: OperationKind, items: SuggestItem[]): string[] | null {
  const fam = operationFamily(kind);
  const xs = fam === "tepelne" ? items.filter((i) => heatText(i))
    : fam === "povrch" ? items.filter((i) => (i.surfaceTreatment ?? "").trim()) : [];
  if (!xs.length || xs.length === items.length) return null;
  return xs.map((i) => i.id);
}

function shortName(name: string): string {
  // „E2E-14 Frézy Novák s.r.o." → „Frézy Novák" (bez právní formy) — jen do souhrnu postupu
  return name.replace(/,?\s*(s\.\s?r\.\s?o\.|a\.\s?s\.|spol\.\s?s\s?r\.\s?o\.|k\.\s?s\.|v\.\s?o\.\s?s\.|gmbh|sp\.\s?z\s?o\.\s?o\.)\s*$/i, "").trim() || name;
}

/**
 * Předvyplněný postup: připravené kroky → nejlevnější kompletní postup z nabídek
 * (kompletní dodávka vs. obrábění + tepelné + povrch po rodinách) → výchozí podle výkresu.
 */
export function suggestRoute(input: {
  items: SuggestItem[];
  plannedSteps?: RouteStepSuggestion[];
  quotes: SuggestQuote[];
  currency: string;
  today: string;
  canSeePrices: boolean;
}): RouteSuggestion {
  const { items, quotes, canSeePrices } = input;
  const heatItems = items.filter((i) => heatText(i));
  const surfItems = items.filter((i) => (i.surfaceTreatment ?? "").trim());
  const scope = (xs: SuggestItem[]) => (xs.length === items.length ? null : xs.map((i) => i.id));
  const chips: string[] = [];
  const heatNote = uniq(heatItems.map(heatText).filter((x): x is string => Boolean(x))).join("; ") || null;
  const surfNote = uniq(surfItems.map((i) => (i.surfaceTreatment ?? "").trim()).filter(Boolean)).join("; ") || null;
  if (heatItems.length) chips.push(`+ Tepelné zpracování (výkres: ${heatNote})`);
  if (surfItems.length) chips.push(`+ Povrchová úprava (${surfNote})`);

  if (input.plannedSteps && input.plannedSteps.length) {
    return { source: "planovane", steps: input.plannedSteps, routes: [], banner: "Podle připraveného postupu — zkontroluj a potvrď.", chips };
  }

  const ctx: RankContext = { items, currency: input.currency, today: input.today };
  const routes: RouteSuggestion["routes"] = [];

  // a) kompletní dodávka jednou firmou
  const komplet = rankQuotesForStep({ kind: "kompletni_dodavka" }, quotes.filter((q) => quoteKinds(q).kinds.includes("kompletni_dodavka")), ctx);
  const k0 = komplet.comparable.find((r) => r.fullCoverage && !r.expired) ?? komplet.comparable.find((r) => r.fullCoverage);
  if (k0) {
    routes.push({
      key: `komplet:${k0.quote.id}`, label: `kompletně u ${shortName(k0.quote.supplierName)}`, total: k0.value.value, complete: true, selected: false,
      steps: [{ kind: "kompletni_dodavka", orderItemIds: null, note: null, supplierQuoteId: k0.quote.id, who: whoOfQuote(k0.quote) }],
    });
  }

  // b) po rodinách: obrábění (bez kompletních nabídek) → tepelné → povrch
  const notKomplet = quotes.filter((q) => !quoteKinds(q).kinds.includes("kompletni_dodavka"));
  const fams: { kind: OperationKind; ids: string[] | null; note: string | null; need: boolean }[] = [
    { kind: "vyroba", ids: null, note: null, need: true },
    { kind: "tepelne_zpracovani", ids: scope(heatItems), note: heatNote, need: heatItems.length > 0 },
    { kind: "povrchova_uprava", ids: scope(surfItems), note: surfNote, need: surfItems.length > 0 },
  ];
  const famSteps: RouteStepSuggestion[] = [];
  let famTotal = 0;
  let famComplete = true;
  let famAnyQuote = false;
  // jedna nabídka na víc operací („Frézování + kalení") = jeden krok a jedna cena, ne dvě
  const usedQuote = new Map<string, RouteStepSuggestion>();
  for (const f of fams.filter((x) => x.need)) {
    const r = rankQuotesForStep({ kind: f.kind, orderItemIds: f.ids }, notKomplet, ctx);
    const best = r.comparable.find((x) => x.match >= (f.kind === "vyroba" ? 1 : 2) && !x.expired)
      ?? r.comparable.find((x) => x.match >= (f.kind === "vyroba" ? 1 : 2));
    const covering = best ? usedQuote.get(best.quote.id) : undefined;
    if (best && covering) {
      const incl = `vč. ${f.kind === "tepelne_zpracovani" ? "tepelného zpracování" : "povrchové úpravy"}${f.note ? ` (${f.note})` : ""}`;
      covering.note = covering.note ? `${covering.note} · ${incl}` : incl;
      continue;
    }
    if (best && best.value.value !== null && best.fullCoverage) {
      famTotal += best.value.value;
      famAnyQuote = true;
      const st: RouteStepSuggestion = { kind: f.kind, orderItemIds: f.ids, note: f.note, supplierQuoteId: best.quote.id, who: whoOfQuote(best.quote) };
      famSteps.push(st);
      usedQuote.set(best.quote.id, st);
    } else {
      famComplete = false;
      famSteps.push({ kind: f.kind, orderItemIds: f.ids, note: f.note, supplierQuoteId: null, who: { type: "none" } });
    }
  }
  const famLabel = famSteps.map((s) => (s.who.type === "supplier" || s.who.type === "free" ? shortName(s.who.type === "supplier" ? s.who.name ?? "" : s.who.name) : kindLabel(s.kind))).join(" + ");
  if (famAnyQuote) {
    routes.push({ key: "rodiny", label: famLabel, total: famComplete ? r2(famTotal) : null, complete: famComplete, selected: false, steps: famSteps });
  }

  // nejlevnější kompletní postup (remíza → méně kroků)
  const complete = routes.filter((r) => r.complete && r.total !== null)
    .sort((a, b) => (a.total as number) - (b.total as number) || a.steps.length - b.steps.length);
  const chosen = complete[0] ?? null;
  if (chosen) {
    chosen.selected = true;
    const others = complete.slice(1);
    const names = chosen.steps.map((s) => (s.who.type === "supplier" ? shortName(s.who.name ?? "") : s.who.type === "free" ? shortName(s.who.name) : kindLabel(s.kind)));
    const banner = canSeePrices
      ? `Nejlevnější postup: ${chosen.label} ${money(chosen.total as number, input.currency)}${others.length ? ` (${others.map((o) => `${o.label} ${money(o.total as number, input.currency)}`).join(", ")})` : ""}`
      : `Doporučený postup podle nabídek: ${names.join(" → ")}`;
    return {
      source: "nabidky", steps: chosen.steps, chips,
      routes: canSeePrices ? routes : routes.map((r) => ({ ...r, total: null })),
      banner,
    };
  }

  // výchozí podle výkresu (s tím, co z nabídek jde předvyplnit)
  const steps = famAnyQuote ? famSteps : fams.filter((x) => x.need).map((f) => ({
    kind: f.kind, orderItemIds: f.ids, note: f.note, supplierQuoteId: null, who: { type: "none" } as StepWho,
  }));
  if (!heatItems.length && !surfItems.length) chips.push("+ Výroba");
  return {
    source: famAnyQuote ? "nabidky" : heatItems.length || surfItems.length ? "vykres" : "vychozi",
    steps,
    routes: canSeePrices ? routes : routes.map((r) => ({ ...r, total: null })),
    banner: "Předvyplnila AI podle nabídek dodavatelů a výkresu — zkontroluj a potvrď.",
    chips,
  };
}

// ── Objednávka dodavateli pro krok (E.2) ────────────────────
export interface StepPurchaseItem extends PurchaseItemInput {
  orderItemId: string | null;
}

function weightText(kg: number): string {
  return `${String(Math.round(kg * 1000) / 1000).replace(".", ",")} kg/ks`;
}

function qtyText(q: number, unit: string | null | undefined): string {
  return `${String(Math.round(q * 1000) / 1000).replace(".", ",")} ${unit || "ks"}`;
}

/** Poznámka položky z výkresu: „1.2379 · kalit 58–60 HRC · 1,2 kg/ks". */
export function drawingItemNote(item: SuggestItem, stepKind: OperationKind): string | null {
  const fam = operationFamily(stepKind);
  const parts: string[] = [];
  const mat = (item.materialDesignation ?? "").trim() || (item.material ?? "").trim();
  if (mat) parts.push(mat);
  const heat = heatText(item);
  const surf = (item.surfaceTreatment ?? "").trim();
  if ((fam === "tepelne" || fam === "komplet") && heat) parts.push(heat);
  if ((fam === "povrch" || fam === "komplet") && surf) parts.push(surf);
  if (item.weightKg && item.weightKg > 0) parts.push(weightText(item.weightKg));
  return parts.length ? parts.join(" · ") : null;
}

/**
 * Položky objednávky kroku — jen díly kroku. Ceny z nabídky (ks / kg × hmotnost / komplet),
 * díly mimo nabídku bez ceny (jen když se mají objednat i zbylé), bez nabídky položky
 * zakázky (nákupní cena jen u jediného výrobního kroku). Nikdy prodejní ceny.
 */
export function purchaseItemsForStep(input: {
  step: StepContext;
  items: SuggestItem[];
  quote?: (Pick<SuggestQuote, "items" | "total" | "number"> & { currency?: string }) | null;
  /** „Objednat i zbylé díly u {firma} — bez ceny". */
  includeUncovered?: boolean;
  /** Množství upravená v dialogu (orderItemId → množství). */
  quantities?: Record<string, number>;
  /** Postup má jediný krok (nákupní cena dílu zakázky platí pro něj). */
  singleStepRoute?: boolean;
}): { items: StepPurchaseItem[]; uncovered: string[]; warnings: string[] } {
  const { step, quote } = input;
  const scope = scopeItemsOf(input.items, step.orderItemIds);
  const warnings: string[] = [];
  const suffix = step.kind === "vyroba" || step.kind === "kompletni_dodavka" ? "" : ` — ${lower(kindLabel(step.kind))}`;
  const qty = (it: SuggestItem) => {
    const q = input.quantities?.[it.id];
    return typeof q === "number" && Number.isFinite(q) && q > 0 ? q : it.quantity;
  };
  const baseName = (it: SuggestItem) =>
    `${(it.name ?? "").trim() || (it.description ?? "").trim() || (it.drawingNumber ? `Díl dle výkresu ${it.drawingNumber}` : "Položka")}${suffix}`;
  const baseItem = (it: SuggestItem, unitPrice: number | null, extraNote?: string | null): StepPurchaseItem => ({
    drawingNumber: it.drawingNumber ?? undefined,
    name: baseName(it),
    material: ((it.materialDesignation ?? "").trim() || (it.material ?? "").trim()) || undefined,
    quantity: qty(it),
    unit: (it.unit ?? "").trim() || "ks",
    unitPrice,
    // poznámka pro dodavatele z Technologie první (v PDF zvýrazněná), pak doplněk a údaje z výkresu
    note: [supplierNoteSegment(it.supplierNote), extraNote, drawingItemNote(it, step.kind)].filter(Boolean).join(" · ") || undefined,
    orderItemId: it.id,
  });

  if (!quote) {
    const usePurchase = Boolean(input.singleStepRoute) && (step.kind === "vyroba" || step.kind === "kompletni_dodavka");
    return { items: scope.map((it) => baseItem(it, usePurchase ? (it.purchaseUnitPrice ?? null) : null)), uncovered: [], warnings };
  }

  if (!quote.items.length) {
    const total = quote.total ?? null;
    if (total !== null && scope.length === 1) {
      const it = scope[0];
      // celková cena platí pro množství zakázky (ne pro množství upravené v dialogu)
      return { items: [baseItem(it, r2(total / it.quantity))], uncovered: [], warnings };
    }
    if (total !== null && scope.length > 1) warnings.push("Nabídka dodavatele má jen celkovou cenu — doplň ceny jednotlivých položek.");
    return { items: scope.map((it) => baseItem(it, null)), uncovered: [], warnings };
  }

  const value = quoteValue(quote, scope, input.items);
  const out: StepPurchaseItem[] = [];
  const uncovered: string[] = [];
  const allUnpriced = value.lines.every((l) => l.quoteItem === null || quote.items[l.quoteItem].unitPrice === null);
  if (allUnpriced && quote.total !== null && quote.total !== undefined && value.coverage.uncovered.length === 0) {
    if (scope.length === 1) {
      // celková cena platí pro nabízené množství (jinak množství zakázky), ne pro upravené v dialogu
      const qi = value.lines[0]?.quoteItem;
      const basisQty = (qi !== null && qi !== undefined ? quote.items[qi]?.quantity : 0) || scope[0].quantity;
      return { items: [baseItem(scope[0], r2(quote.total / basisQty))], uncovered: [], warnings };
    }
    warnings.push("Nabídka dodavatele má jen celkovou cenu — doplň ceny jednotlivých položek.");
  }
  for (const line of value.lines) {
    const it = scope.find((s) => s.id === line.orderItemId) as SuggestItem;
    if (line.quoteItem === null) {
      if (input.includeUncovered) out.push(baseItem(it, null, "mimo nabídku — prosíme o nacenění"));
      else uncovered.push(it.id);
      continue;
    }
    const qi = quote.items[line.quoteItem];
    const cls = unitClass(qi.unit);
    if (qi.unitPrice === null) { out.push(baseItem(it, null)); continue; }
    if (cls === "weight") {
      if (it.weightKg && it.weightKg > 0) {
        const kg = Math.round(it.weightKg * qty(it) * 1000) / 1000;
        out.push({
          ...baseItem(it, qi.unitPrice, qtyText(qty(it), it.unit)),
          quantity: kg, unit: "kg",
        });
      } else {
        out.push(baseItem(it, null, `cena ${money(qi.unitPrice, quote.currency ?? "CZK")}/kg dle nabídky${quote.number ? ` ${quote.number}` : ""}`));
      }
    } else if (cls === "lot") {
      out.push({ ...baseItem(it, qi.unitPrice), quantity: qi.quantity, unit: qi.unit || "kpl" });
    } else if (cls === "piece" || Math.abs(qi.quantity - qty(it)) < 1e-9) {
      out.push(baseItem(it, qi.unitPrice));
    } else {
      out.push(baseItem(it, null, `cena ${money(qi.unitPrice, quote.currency ?? "CZK")}/${qi.unit} dle nabídky${quote.number ? ` ${quote.number}` : ""}`));
    }
  }
  return { items: out, uncovered, warnings };
}

/**
 * Poznámka objednávky kroku: naše zakázka + výkresy + „Operace: Tepelné zpracování (krok 2 ze 3)."
 * + „Navazuje: Broušení — termín prosíme dodržet." (když další krok dělá jiná firma).
 * Slovo „mezitermín" se dodavateli nikdy nepíše.
 */
export function stepPurchaseOrderNote(input: {
  jobNumber: string | null | undefined;
  drawings: (string | null | undefined)[];
  stepLabel: string;
  stepNo: number;
  stepCount: number;
  next?: { label: string; elsewhere: boolean } | null;
  /** Druh kroku: u tepelného zpracování / povrchu ne „Výroba dle výkresů", ale „Dle výkresů". */
  kind?: OperationKind | null;
}): string {
  const fam = input.kind ? operationFamily(input.kind) : "obrabeni";
  const parts = [purchaseOrderNote(input.jobNumber, input.drawings, fam === "obrabeni" || fam === "komplet" ? "Výroba dle výkresů" : "Dle výkresů")];
  parts.push(input.stepCount > 1 ? `Operace: ${input.stepLabel} (krok ${input.stepNo} ze ${input.stepCount}).` : `Operace: ${input.stepLabel}.`);
  if (input.next && input.next.elsewhere) parts.push(`Navazuje: ${input.next.label} — termín prosíme dodržet.`);
  return parts.filter(Boolean).join(" ");
}
