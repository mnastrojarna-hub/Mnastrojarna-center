// Foto dokladu → podrobné stavy toku (spec 2.8) — čistá pravidla bez DB (testy capture-flow-rules.test.ts).
import type { DocIssuer, ExtractedBusinessDoc, ExtractedItem } from "@/lib/jobs/capture-types";
import type { DocIssuerKey, OrderMismatch, OrderMismatchKind } from "@/lib/supabase/database.types";

/** Vystavitel dokladu pro job_files.issuer (neznámý = neuvádět). */
export function issuerKey(issuer: DocIssuer | null | undefined): DocIssuerKey | null {
  return issuer === "my" || issuer === "zakaznik" || issuer === "dodavatel" ? issuer : null;
}

/** Číslo výkresu / dokladu pro porovnání (bez mezer, pomlček, teček; velká písmena). */
export function normRef(v: string | null | undefined): string {
  return String(v ?? "").toUpperCase().replace(/[\s\-_./]+/g, "");
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const num = (v: unknown): number => {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};

function fmtQty(n: number): string {
  return new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 3 }).format(n);
}

/** Řádek dokladu → klíč položky (číslo výkresu, jinak název). */
function lineKey(it: { drawingNumber?: string | null; name?: string | null }): string {
  return normRef(it.drawingNumber) || `N:${String(it.name ?? "").trim().toLowerCase()}`;
}

function lineLabel(it: { drawingNumber?: string | null; name?: string | null }): string {
  return (it.drawingNumber || "").trim() || (it.name || "").trim() || "položka";
}

/**
 * Spáruje řádky dokladu s položkami (číslo výkresu, jinak název; jediný řádek ↔ jediná položka).
 * Vrací páry a řádky dokladu bez protějšku.
 */
export function pairLines<T extends { id: string; drawingNumber?: string | null; name?: string | null }>(
  docItems: Pick<ExtractedItem, "drawingNumber" | "name" | "quantity">[],
  items: T[],
): { pairs: { item: T; quantity: number }[]; unmatched: Pick<ExtractedItem, "drawingNumber" | "name" | "quantity">[] } {
  const lines = docItems.filter((l) => num(l.quantity) > 0);
  if (lines.length === 1 && items.length === 1) return { pairs: [{ item: items[0], quantity: num(lines[0].quantity) }], unmatched: [] };
  const byKey = new Map<string, T>();
  for (const it of items) {
    const k = lineKey(it);
    if (k && k !== "N:" && !byKey.has(k)) byKey.set(k, it);
  }
  const used = new Set<string>();
  const pairs: { item: T; quantity: number }[] = [];
  const unmatched: Pick<ExtractedItem, "drawingNumber" | "name" | "quantity">[] = [];
  for (const l of lines) {
    const it = byKey.get(lineKey(l));
    if (it && !used.has(it.id)) {
      used.add(it.id);
      pairs.push({ item: it, quantity: num(l.quantity) });
    } else unmatched.push(l);
  }
  return { pairs, unmatched };
}

// ── Dodání zákazníkovi z našeho DL ──────────────────────────
export interface DeliveryItem {
  id: string;
  drawingNumber: string | null;
  name: string | null;
  quantity: number;
  deliveredQuantity: number;
  deliveryClosed: boolean;
  unit: string | null;
}

/**
 * Náš dodací list → nové dodané množství po položkách (dosavadní + z dokladu, max. objednané).
 * Uzavřené a už plně dodané položky se nemění.
 */
export function deliveryUpdates(docItems: ExtractedItem[], items: DeliveryItem[]): {
  updates: { itemId: string; delivered: number; before: number; label: string; unit: string }[];
  unmatched: string[];
} {
  const { pairs, unmatched } = pairLines(docItems, items);
  const updates: { itemId: string; delivered: number; before: number; label: string; unit: string }[] = [];
  for (const { item, quantity } of pairs) {
    if (item.deliveryClosed) continue;
    const before = num(item.deliveredQuantity);
    const cap = num(item.quantity);
    if (before + 1e-9 >= cap) continue;
    const delivered = r3(Math.min(cap, before + quantity));
    if (delivered > before + 1e-9) updates.push({ itemId: item.id, delivered, before, label: lineLabel(item), unit: item.unit || "ks" });
  }
  return { updates, unmatched: unmatched.map(lineLabel) };
}

// ── Převzetí od dodavatele z DL dodavatele ──────────────────
export interface ReceiptItem {
  id: string;
  drawingNumber: string | null;
  name: string | null;
  quantity: number;
  receivedQuantity: number;
  receiptClosed: boolean;
}

/** DL dodavatele → převzato celkem po položkách objednávky (dosavadní + z dokladu, max. objednané). */
export function receiptUpdates(docItems: ExtractedItem[], items: ReceiptItem[]): { itemId: string; received: number }[] {
  const { pairs } = pairLines(docItems, items);
  const out: { itemId: string; received: number }[] = [];
  for (const { item, quantity } of pairs) {
    if (item.receiptClosed) continue;
    const before = num(item.receivedQuantity);
    const received = r3(Math.min(num(item.quantity), before + quantity));
    if (received > before + 1e-9) out.push({ itemId: item.id, received });
  }
  return out;
}

// ── Objednávka zákazníka: revize a rozpor ───────────────────
export interface StoredOrder {
  orderStatus: string | null;
  customerOrderNumber: string | null;
  customerRequiredDate: string | null;
  value: number | null;
  items: { id: string; drawingNumber: string | null; name: string | null; quantity: number; revision: string | null; unit: string | null }[];
}

/** Foto objednávky se stejným číslem u zakázky, která už objednávku má → nová revize (ne nové položky). */
export function isOrderRevision(job: Pick<StoredOrder, "orderStatus" | "customerOrderNumber">, docOrderNumber: string | null | undefined): boolean {
  if (!job.orderStatus || job.orderStatus === "stornovana") return false;
  const a = normRef(job.customerOrderNumber);
  return Boolean(a) && a === normRef(docOrderNumber);
}

export interface OrderChange {
  field: string;
  label: string;
  from: string | number | null;
  to: string | number | null;
}

/** Rozdíl vytěžené objednávky proti uloženým hodnotám (položky se nepřepisují — jen se ukáže rozdíl). */
export function orderChanges(doc: Pick<ExtractedBusinessDoc, "items" | "requiredDeliveryDate" | "totalWithoutVat">, job: StoredOrder): OrderChange[] {
  const out: OrderChange[] = [];
  const docLines = doc.items.filter((l) => num(l.quantity) > 0);
  const { pairs, unmatched } = pairLines(docLines, job.items);
  for (const { item, quantity } of pairs) {
    if (Math.abs(num(item.quantity) - quantity) > 1e-9) {
      out.push({ field: `item:${item.id}:quantity`, label: `Množství ${lineLabel(item)} (${item.unit || "ks"})`, from: num(item.quantity), to: quantity });
    }
    const line = docLines.find((l) => lineKey(l) === lineKey(item)) ?? null;
    const rev = (line?.revision ?? "").trim();
    if (rev && normRef(rev) !== normRef(item.revision)) {
      out.push({ field: `item:${item.id}:revision`, label: `Revize výkresu ${lineLabel(item)}`, from: item.revision || null, to: rev });
    }
  }
  for (const l of unmatched) out.push({ field: "item:new", label: `Nová položka ${lineLabel(l)}`, from: null, to: num(l.quantity) });
  if (docLines.length) {
    const paired = new Set(pairs.map((p) => p.item.id));
    for (const it of job.items) if (!paired.has(it.id)) out.push({ field: `item:${it.id}:removed`, label: `Chybí položka ${lineLabel(it)}`, from: num(it.quantity), to: null });
  }
  const req = (doc.requiredDeliveryDate || "").trim();
  if (req && req !== (job.customerRequiredDate ?? "")) out.push({ field: "customer_required_date", label: "Požadovaný termín", from: job.customerRequiredDate, to: req });
  const total = num(doc.totalWithoutVat);
  const value = job.value === null ? null : num(job.value);
  if (total > 0 && value !== null && value > 0 && Math.abs(total - value) > Math.max(1, value * 0.01)) {
    out.push({ field: "value", label: "Cena celkem bez DPH", from: value, to: total });
  }
  return out.slice(0, 100);
}

export interface QuoteForCheck {
  number: string;
  total: number | null;
  leadTimeDays: number | null;
  items: { drawingNumber: string | null; name: string | null; quantity: number }[];
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Rozpor objednávky s nabídkou (AI kontrola, spec 2.8): součet ±1 %, množství, chybějící /
 * přebývající položky, termín dřív, než stihneme podle dodací lhůty nabídky. Prázdné = sedí.
 */
export function quoteMismatch(
  doc: Pick<ExtractedBusinessDoc, "items" | "totalWithoutVat" | "requiredDeliveryDate" | "documentDate">,
  quote: QuoteForCheck,
  today: string,
): OrderMismatch["items"] {
  const out: { kind: OrderMismatchKind; label: string; quote?: string | null; order?: string | null }[] = [];
  const total = num(doc.totalWithoutVat);
  if (quote.total !== null && quote.total > 0 && total > 0 && Math.abs(total - quote.total) > quote.total * 0.01) {
    out.push({ kind: "cena", label: "Cena celkem se liší od nabídky", quote: String(quote.total), order: String(total) });
  }
  const docLines = doc.items.filter((l) => num(l.quantity) > 0);
  if (docLines.length && quote.items.length) {
    const quoteItems = quote.items.map((it, i) => ({ ...it, id: `q${i}` }));
    const { pairs, unmatched } = pairLines(docLines, quoteItems);
    for (const { item, quantity } of pairs) {
      if (Math.abs(num(item.quantity) - quantity) > 1e-9) {
        out.push({ kind: "mnozstvi", label: `Množství ${lineLabel(item)}`, quote: fmtQty(num(item.quantity)), order: fmtQty(quantity) });
      }
    }
    for (const l of unmatched) out.push({ kind: "polozka_navic", label: `Položka navíc ${lineLabel(l)}`, quote: null, order: fmtQty(num(l.quantity)) });
    const paired = new Set(pairs.map((p) => p.item.id));
    const missing = quoteItems.filter((it) => !paired.has(it.id));
    for (const it of missing) out.push({ kind: "chybi_polozka", label: `Chybí položka ${lineLabel(it)}`, quote: fmtQty(num(it.quantity)), order: null });
  }
  const req = (doc.requiredDeliveryDate || "").trim();
  if (req && quote.leadTimeDays && quote.leadTimeDays > 0) {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(doc.documentDate || "") ? doc.documentDate : today;
    const earliest = addDays(from, quote.leadTimeDays);
    if (req < earliest) out.push({ kind: "termin", label: `Termín dřív než dodací lhůta nabídky (${quote.leadTimeDays} dní)`, quote: earliest, order: req });
  }
  return out.slice(0, 50);
}

/** „Objednáno částečně (3/5)" — kolik položek nabídky zákazník objednal. */
export function orderedShare(items: OrderMismatch["items"], quoteItemCount: number): string | null {
  const missing = items.filter((i) => i.kind === "chybi_polozka").length;
  if (!missing || !quoteItemCount) return null;
  return `Objednáno částečně (${quoteItemCount - missing}/${quoteItemCount})`;
}

/** Doklad vypadá na storno objednávky (zákazník ruší) — jen návrh, nikdy automaticky. */
export function looksLikeCancellation(doc: Pick<ExtractedBusinessDoc, "summary" | "note" | "documentNumber">): boolean {
  const text = `${doc.summary ?? ""} ${doc.note ?? ""}`.toLowerCase();
  return /\bstorn|\bruší(me)? objednávk|\bzrušen[íaá] objednávk|\bcancel(l?ation|led)?\b/.test(text);
}
