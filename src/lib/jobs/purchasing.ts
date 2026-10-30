import type { JobStage, PurchaseOrderStatus } from "@/lib/supabase/database.types";
import type { JobItem } from "@/lib/jobs/types";
import type {
  PurchaseItem, PurchaseItemInput, PurchaseSupplierRef, SupplierQuoteView, PurchaseOrderView,
  PurchaseOrderListItem, JobCommissionView, JobPurchasingTotals, SupplierQuoteInput, SupplierQuoteSource,
  PurchaseOrderDraft, PurchaseOrderDraftInput, PurchaseItemsSource, RequiredDateSource, PurchaseOrderStamps,
} from "@/lib/jobs/purchasing-types";
import {
  cleanText, cleanDate, cleanNumber, cleanMoney, cleanCurrency, isUuid, one, personRef, searchNormalize, todayIso,
  type PersonEmbed,
} from "@/lib/jobs/mapping";
import { STAGES, isJobStage, stageRank } from "@/lib/jobs/stages";
import { isOperationKind } from "@/lib/jobs/operations";
import { czDate, czWeekday } from "@/lib/pdf/types";
import { stampFromRow, type ChangeStamp, type PurchaseExtraState } from "@/lib/jobs/flow-status";

/**
 * Nákupní strana zakázky — čistá logika (bez DB): stavy objednávek vydaných,
 * validace vstupů, návrh objednávky z vítězné nabídky / zakázky, termíny
 * v pracovních dnech, součty a marže, text e-mailu. Testy v purchasing.test.ts.
 *
 * Zásada: do objednávky dodavateli NIKDY nejde prodejní cena ani identita
 * koncového zákazníka (dodavatel by ho mohl oslovit napřímo).
 */

// ── Stavy objednávky vydané ─────────────────────────────────
export const PURCHASE_ORDER_STATUSES: PurchaseOrderStatus[] = [
  "navrh", "vystavena", "odeslana", "potvrzena", "dodana", "zrusena",
];

export interface PurchaseOrderStatusMeta {
  key: PurchaseOrderStatus;
  label: string;
  description: string;
  /** Měkký odznak (světlý i tmavý režim) — třídy vypsané celé kvůli JIT. */
  badge: string;
  dot: string;
}

export const PURCHASE_ORDER_STATUS_META: Record<PurchaseOrderStatus, PurchaseOrderStatusMeta> = {
  navrh: {
    key: "navrh", label: "Návrh", description: "Rozpracovaná objednávka — zatím nevystavena.",
    badge: "bg-zinc-100 text-zinc-700 dark:bg-zinc-500/15 dark:text-zinc-300", dot: "bg-zinc-400",
  },
  vystavena: {
    key: "vystavena", label: "Vystavena", description: "PDF vystaveno — čeká na odeslání dodavateli.",
    badge: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300", dot: "bg-sky-500",
  },
  odeslana: {
    key: "odeslana", label: "Odeslána", description: "Odesláno dodavateli — čekáme na potvrzení.",
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300", dot: "bg-amber-500",
  },
  potvrzena: {
    key: "potvrzena", label: "Potvrzena", description: "Dodavatel potvrdil objednávku a termín.",
    badge: "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300", dot: "bg-indigo-500",
  },
  dodana: {
    key: "dodana", label: "Dodána", description: "Díly od dodavatele dorazily k nám.",
    badge: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300", dot: "bg-green-500",
  },
  zrusena: {
    key: "zrusena", label: "Zrušena", description: "Objednávka zrušena — nezapočítává se do nákladů.",
    badge: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300", dot: "bg-red-500",
  },
};

export function isPurchaseOrderStatus(v: unknown): v is PurchaseOrderStatus {
  return typeof v === "string" && (PURCHASE_ORDER_STATUSES as string[]).includes(v);
}

const TRANSITIONS: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
  navrh: ["vystavena", "zrusena"],
  vystavena: ["odeslana", "potvrzena", "dodana", "zrusena"],
  odeslana: ["potvrzena", "dodana", "zrusena"],
  potvrzena: ["dodana", "zrusena"],
  // omyl při naskladnění → zpět na potvrzenou
  dodana: ["potvrzena"],
  // obnovení zrušené objednávky
  zrusena: ["vystavena"],
};

/** Povolené další stavy (tlačítka v UI). */
export function purchaseOrderTransitions(from: PurchaseOrderStatus): PurchaseOrderStatus[] {
  return TRANSITIONS[from] ?? [];
}

export function canChangePurchaseOrderStatus(from: PurchaseOrderStatus, to: PurchaseOrderStatus): boolean {
  return from === to || purchaseOrderTransitions(from).includes(to);
}

/** Položky a ceny lze měnit jen dokud objednávka neodešla dodavateli. */
export function isPurchaseOrderEditable(status: PurchaseOrderStatus): boolean {
  return status === "navrh" || status === "vystavena";
}

/**
 * Doplnit nákupní cenu položky jde i u odeslané / potvrzené / dodané objednávky (dodavatel nacení
 * „bez ceny" položky až po odeslání); jen ne u zrušené. Mění se jen cena, ne položky.
 * Bez toho by provize zakázky ze zisku čekala na nákupní cenu navždy (job_cost.known = false).
 */
export function canFillPurchasePrices(status: PurchaseOrderStatus): boolean {
  return status !== "zrusena";
}

/**
 * Jen ceny položek (id → cena za jednotku; null = zatím bez ceny). Vrací nové ceny a součet
 * objednávky, nebo českou chybu. Položky, množství ani pořadí se nemění.
 */
export function applyPurchasePrices(
  items: { id: string; quantity: number; unitPrice: number | null }[],
  prices: { itemId: string; unitPrice: unknown }[],
): { changes: { id: string; unitPrice: number | null }[]; total: number } | { error: string } {
  const byId = new Map(items.map((i) => [i.id, i]));
  const next = new Map(items.map((i) => [i.id, i.unitPrice]));
  for (const p of prices) {
    if (!byId.has(p.itemId)) return { error: "Položka nepatří k objednávce." };
    const raw = p.unitPrice;
    const price = raw === null || raw === undefined || raw === "" ? null : cleanMoney(raw);
    if (price === null && raw !== null && raw !== undefined && raw !== "") return { error: "Neplatná cena položky." };
    if (price !== null && price < 0) return { error: "Cena položky nesmí být záporná." };
    next.set(p.itemId, price === null ? null : r2(price));
  }
  const changes = items.filter((i) => next.get(i.id) !== i.unitPrice).map((i) => ({ id: i.id, unitPrice: next.get(i.id) ?? null }));
  return { changes, total: purchaseItemsTotal(items.map((i) => ({ quantity: i.quantity, unitPrice: next.get(i.id) ?? null }))) };
}

export const SUPPLIER_QUOTE_SOURCES: SupplierQuoteSource[] = ["manual", "foto", "email", "ai", "telefon"];

export function isSupplierQuoteSource(v: unknown): v is SupplierQuoteSource {
  return typeof v === "string" && (SUPPLIER_QUOTE_SOURCES as string[]).includes(v);
}

// ── Peníze ──────────────────────────────────────────────────
/** Zaokrouhlení na haléře — stejně jako PDF (computeTotals), aby součty seděly. */
export function r2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function purchaseLineTotal(it: { quantity: number; unitPrice?: number | null }): number {
  return it.unitPrice === null || it.unitPrice === undefined ? 0 : r2(it.quantity * it.unitPrice);
}

/** Σ množství × cena bez DPH (položky bez ceny = 0). */
export function purchaseItemsTotal(items: { quantity: number; unitPrice?: number | null }[]): number {
  return r2(items.reduce((s, it) => s + purchaseLineTotal(it), 0));
}

export function unpricedItemCount(items: { unitPrice?: number | null }[]): number {
  return items.filter((it) => it.unitPrice === null || it.unitPrice === undefined).length;
}

// ── Validace položek ────────────────────────────────────────
/** Položka připravená pro insert (sloupce supplier_quote_items / purchase_order_items). */
export interface PurchaseItemRowInput {
  position: number;
  drawing_number: string | null;
  name: string | null;
  material: string | null;
  quantity: number;
  unit: string;
  unit_price: number | null;
  note: string | null;
  /** Vazba na díl zakázky — jen u objednávky dodavateli (purchase_order_items), klíč chybí, když vazba není. */
  order_item_id?: string;
}

export const MAX_PURCHASE_ITEMS = 300;

/** Ověří a vyčistí položky; vrací řádky pro DB nebo českou chybu. */
export function cleanPurchaseItems(
  items: unknown,
  opts: { allowEmpty?: boolean } = {},
): { rows: PurchaseItemRowInput[] } | { error: string } {
  if (items === undefined || items === null) {
    return opts.allowEmpty ? { rows: [] } : { error: "Přidej alespoň jednu položku." };
  }
  if (!Array.isArray(items)) return { error: "Neplatné položky." };
  if (items.length > MAX_PURCHASE_ITEMS) return { error: `Maximálně ${MAX_PURCHASE_ITEMS} položek.` };
  const rows: PurchaseItemRowInput[] = [];
  for (let i = 0; i < items.length; i++) {
    const raw = items[i] as PurchaseItemInput | null;
    const n = i + 1;
    if (!raw || typeof raw !== "object") return { error: `Položka ${n}: neplatná data.` };
    const drawing = cleanText(raw.drawingNumber, 120);
    const name = cleanText(raw.name, 500);
    if (!drawing && !name) {
      // úplně prázdný řádek z formuláře se tiše vynechá
      const empty = cleanNumber(raw.unitPrice) === null && !cleanText(raw.material) && !cleanText(raw.note);
      if (empty) continue;
      return { error: `Položka ${n}: vyplň číslo výkresu nebo název.` };
    }
    const qty = cleanNumber(raw.quantity);
    if (qty === null || qty <= 0) return { error: `Položka ${n}: neplatné množství.` };
    if (qty > 1e8) return { error: `Položka ${n}: množství je příliš velké.` };
    const price = cleanMoney(raw.unitPrice);
    if (price !== null && price < 0) return { error: `Položka ${n}: cena nesmí být záporná.` };
    if (price !== null && price > 1e11) return { error: `Položka ${n}: cena je příliš velká.` };
    rows.push({
      position: rows.length,
      drawing_number: drawing,
      name,
      material: cleanText(raw.material, 200),
      quantity: Math.max(0.001, Math.round(qty * 1000) / 1000),
      unit: cleanText(raw.unit, 20) ?? "ks",
      unit_price: price,
      note: cleanText(raw.note, 1000),
      ...(isUuid(raw.orderItemId) ? { order_item_id: raw.orderItemId.toLowerCase() } : {}),
    });
  }
  if (!rows.length && !opts.allowEmpty) return { error: "Přidej alespoň jednu položku." };
  return { rows };
}

export function rowsTotal(rows: PurchaseItemRowInput[]): number {
  return purchaseItemsTotal(rows.map((r) => ({ quantity: r.quantity, unitPrice: r.unit_price })));
}

/** Celkem nabídky dodavatele: zadaná částka, jinak Σ položek (bez cen → null). */
export function resolveSupplierQuoteTotal(total: unknown, rows: PurchaseItemRowInput[]): number | null {
  const explicit = cleanMoney(total);
  if (explicit !== null && explicit >= 0) return explicit;
  return rows.some((r) => r.unit_price !== null) ? rowsTotal(rows) : null;
}

// ── Kalendář: pracovní dny (ČR) ─────────────────────────────
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function toUtc(iso: string): Date | null {
  const m = ISO.exec(iso ?? "");
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function fromUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Velikonoční neděle (gregoriánský kalendář, anonymní algoritmus). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const FIXED_HOLIDAYS = ["01-01", "05-01", "05-08", "07-05", "07-06", "09-28", "10-28", "11-17", "12-24", "12-25", "12-26"];
const holidayCache = new Map<number, Set<string>>();

/** Státní svátky ČR v daném roce (vč. Velkého pátku a Velikonočního pondělí). */
export function czechHolidays(year: number): Set<string> {
  const hit = holidayCache.get(year);
  if (hit) return hit;
  const set = new Set(FIXED_HOLIDAYS.map((md) => `${year}-${md}`));
  const easter = toUtc(easterSunday(year));
  if (easter) {
    set.add(fromUtc(new Date(easter.getTime() - 2 * 86_400_000)));
    set.add(fromUtc(new Date(easter.getTime() + 86_400_000)));
  }
  holidayCache.set(year, set);
  return set;
}

export function isWorkingDay(iso: string): boolean {
  const d = toUtc(iso);
  if (!d) return false;
  const wd = d.getUTCDay();
  if (wd === 0 || wd === 6) return false;
  return !czechHolidays(d.getUTCFullYear()).has(iso);
}

/** Posun o n pracovních dní (záporné n = zpět); n = 0 vrátí datum beze změny. */
export function addWorkingDays(iso: string, n: number): string {
  const start = toUtc(iso);
  if (!start || !Number.isFinite(n)) return iso;
  const step = n < 0 ? -1 : 1;
  let left = Math.abs(Math.trunc(n));
  let t = start.getTime();
  while (left > 0) {
    t += step * 86_400_000;
    if (isWorkingDay(fromUtc(new Date(t)))) left--;
  }
  return fromUtc(new Date(t));
}

export function addCalendarDays(iso: string, n: number): string {
  const d = toUtc(iso);
  if (!d) return iso;
  return fromUtc(new Date(d.getTime() + Math.trunc(n) * 86_400_000));
}

/** Termín dodání nabídky: zadaný, jinak datum nabídky (dnes) + dodací lhůta. */
export function resolveQuoteDeliveryDate(
  input: { deliveryDate?: unknown; leadTimeDays?: unknown; quoteDate?: unknown },
  today: string = todayIso(),
): string | null {
  const explicit = cleanDate(input.deliveryDate);
  if (explicit) return explicit;
  const lead = cleanNumber(input.leadTimeDays);
  if (lead === null || lead <= 0) return null;
  return addCalendarDays(cleanDate(input.quoteDate) ?? today, Math.round(lead));
}

/** Rezerva mezi dodáním od dodavatele a termínem zákazníkovi (pracovní dny). */
export const SUPPLIER_BUFFER_WORKING_DAYS = 3;

/**
 * Požadovaný termín od dodavatele: nabídka dodavatele → slib dodavatele →
 * předpokládaný termín → termín zákazníkovi − 3 pracovní dny → prázdné.
 */
export function pickRequiredDate(input: {
  quoteDeliveryDate?: string | null;
  supplierPromisedDate?: string | null;
  expectedDeliveryDate?: string | null;
  dueDate?: string | null;
}): { date: string | null; source: RequiredDateSource } {
  const q = cleanDate(input.quoteDeliveryDate);
  if (q) return { date: q, source: "nabidka_dodavatele" };
  const p = cleanDate(input.supplierPromisedDate);
  if (p) return { date: p, source: "slib_dodavatele" };
  const e = cleanDate(input.expectedDeliveryDate);
  if (e) return { date: e, source: "predpokladany_termin" };
  const due = cleanDate(input.dueDate);
  if (due) return { date: addWorkingDays(due, -SUPPLIER_BUFFER_WORKING_DAYS), source: "termin_zakaznika" };
  return { date: null, source: null };
}

export const REQUIRED_DATE_SOURCE_LABELS: Record<Exclude<RequiredDateSource, null>, string> = {
  nabidka_dodavatele: "dle nabídky dodavatele",
  slib_dodavatele: "dle termínu slíbeného dodavatelem",
  predpokladany_termin: "dle předpokládaného termínu zakázky",
  termin_zakaznika: `termín zákazníkovi − ${SUPPLIER_BUFFER_WORKING_DAYS} pracovní dny`,
};

// ── Výchozí texty objednávky ────────────────────────────────
export const DEFAULT_PAYMENT_TERMS = "Splatnost 30 dní";
export const DEFAULT_DELIVERY_TERMS = "DAP Mnástrojárna";
/** Do kolika pracovních dnů má dodavatel objednávku potvrdit. */
export const CONFIRM_WITHIN_WORKING_DAYS = 2;

/** Naše dodací adresa (víceřádková) — firma + sídlo z Nastavení. */
export function defaultDeliveryAddress(company: {
  name: string;
  address: { street?: string; zip?: string; city?: string };
}): string {
  const a = company.address ?? {};
  return [company.name, a.street, [a.zip, a.city].filter(Boolean).join(" ")]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * Kam nám dodavatelé vozí díly: Nastavení „Dodací adresa (provozovna)" (jeden řádek s čárkami → řádky),
 * jinak korespondenční / doručovací adresa provozovny, jinak sídlo.
 */
export function ourDeliveryAddressOf(
  company: { name: string; address: { street?: string; zip?: string; city?: string }; correspondence?: { street?: string; zip?: string; city?: string } },
  custom?: string | null,
): string {
  const c = (custom ?? "").trim();
  if (c) return c.includes("\n") ? c : c.split(/\s*,\s*/).filter(Boolean).join("\n");
  const k = company.correspondence;
  if (k && (k.street ?? "").trim()) return defaultDeliveryAddress({ name: company.name, address: k });
  return defaultDeliveryAddress(company);
}

/** Dodací podmínka podle místa dodání („DAP Mezná"); bez místa výchozí „DAP Mnástrojárna". */
export function deliveryTermsFor(address: string | null | undefined): string {
  const lines = String(address ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
  const lastLine = lines[lines.length - 1] ?? "";
  const place = (lastLine.split(",").pop() ?? "").trim().replace(/^\d{3}\s?\d{2}\s+/, "").trim();
  return lines.length >= 2 && place ? `DAP ${place}` : DEFAULT_DELIVERY_TERMS;
}

/** Poznámka objednávky: naše zakázka + výkresy. Bez zákazníka a jeho cen. */
export function purchaseOrderNote(jobNumber: string | null | undefined, drawings: (string | null | undefined)[], drawingsLabel = "Výroba dle výkresů"): string {
  const list: string[] = [];
  for (const d of drawings) {
    const s = (d ?? "").trim();
    if (s && !list.includes(s)) list.push(s);
  }
  const parts: string[] = [];
  const job = (jobNumber ?? "").trim();
  if (job) parts.push(`Objednávka k naší zakázce ${job}.`);
  if (list.length) {
    const shown = list.slice(0, 12).join(", ");
    parts.push(`${drawingsLabel}: ${shown}${list.length > 12 ? " a další" : ""}.`);
  }
  return parts.join(" ");
}

/** ASCII název PDF: OV-2026-004 → „Objednavka_OV-2026-004.pdf". */
export function purchaseOrderFileName(number: string): string {
  const safe = String(number ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return `Objednavka_${safe || "bez-cisla"}.pdf`;
}

// ── Návrh objednávky ────────────────────────────────────────
/** Co návrh potřebuje ze zakázky (JobDetail to splňuje). */
export interface DraftJob {
  number: string;
  title: string;
  currency: string;
  items: (Pick<JobItem, "drawingNumber" | "revision" | "name" | "description" | "material" | "quantity" | "unit" | "purchaseUnitPrice"> & Partial<Pick<JobItem, "tech">>)[];
  drawingNumbers: string[];
  totalQuantity: number;
  purchaseCost: number | null;
  supplierPromisedDate: string | null;
  expectedDeliveryDate: string | null;
  dueDate: string | null;
}

function textOrUndef(v: string | null | undefined): string | undefined {
  const s = (v ?? "").trim();
  return s ? s : undefined;
}

/** Položky z nabídky dodavatele (materiál doplní ze zakázky podle čísla výkresu). */
export function itemsFromSupplierQuote(quote: Pick<SupplierQuoteView, "items">, job: Pick<DraftJob, "items">): PurchaseItemInput[] {
  return quote.items.map((it) => {
    const match = it.drawingNumber ? job.items.find((j) => j.drawingNumber === it.drawingNumber) : undefined;
    return {
      drawingNumber: textOrUndef(it.drawingNumber),
      name: textOrUndef(it.name) ?? textOrUndef(match?.name) ?? textOrUndef(match?.description),
      material: textOrUndef(it.material) ?? textOrUndef(match?.material),
      quantity: it.quantity,
      unit: textOrUndef(it.unit) ?? "ks",
      unitPrice: it.unitPrice,
      // poznámka pro dodavatele z Technologie (podle čísla výkresu) — v PDF zvýrazněná „Pozor: …"
      note: joinNote(supplierNoteSegment(match?.tech?.supplierNote), splitItemNote(it.note).rest),
    };
  });
}

function joinNote(...parts: (string | null | undefined)[]): string | undefined {
  const t = parts.map((p) => (p ?? "").trim()).filter(Boolean).join(" · ");
  return t || undefined;
}

/** Položky ze zakázky — nákupní cena / MJ, žádná prodejní cena ani interní poznámka. */
export function itemsFromJob(job: Pick<DraftJob, "items">): PurchaseItemInput[] {
  return job.items.map((it) => {
    const name = textOrUndef(it.name);
    const desc = textOrUndef(it.description);
    return {
      drawingNumber: textOrUndef(it.drawingNumber),
      name: name ?? desc ?? (it.drawingNumber ? `Díl dle výkresu ${it.drawingNumber}` : "Položka"),
      material: textOrUndef(it.material),
      quantity: it.quantity,
      unit: textOrUndef(it.unit) ?? "ks",
      unitPrice: it.purchaseUnitPrice ?? null,
      note: joinNote(supplierNoteSegment(it.tech?.supplierNote), name && desc && desc !== name ? desc : undefined),
    };
  });
}

export function buildPurchaseOrderDraft(input: {
  job: DraftJob;
  /** Nabídka dodavatele (vítězná nebo zvolená). */
  quote?: SupplierQuoteView | null;
  /** Dodavatel z adresáře (již vybraný volajícím). */
  supplier?: PurchaseSupplierRef | null;
  deliveryAddress: string;
  today?: string;
}): PurchaseOrderDraft {
  const { job, quote } = input;
  const today = input.today ?? todayIso();
  const supplier = input.supplier ?? quote?.supplier ?? null;
  const warnings: string[] = [];

  let items: PurchaseItemInput[];
  let itemsSource: PurchaseItemsSource;
  if (quote && quote.items.length) {
    items = itemsFromSupplierQuote(quote, job);
    itemsSource = "nabidka_dodavatele";
  } else if (job.items.length) {
    items = itemsFromJob(job);
    itemsSource = "zakazka";
    const quoteTotal = quote?.total ?? null;
    if (quoteTotal !== null && unpricedItemCount(items) === items.length) {
      if (items.length === 1 && items[0].quantity > 0) {
        items[0] = { ...items[0], unitPrice: r2(quoteTotal / items[0].quantity) };
      } else {
        warnings.push("Nabídka dodavatele má jen celkovou cenu — doplň ceny jednotlivých položek.");
      }
    }
  } else {
    const qty = job.totalQuantity > 0 ? job.totalQuantity : 1;
    const total = quote?.total ?? job.purchaseCost;
    items = [{
      drawingNumber: textOrUndef(job.drawingNumbers[0]),
      name: textOrUndef(job.title) ?? `Výroba dle zakázky ${job.number}`,
      quantity: qty,
      unit: "ks",
      unitPrice: total !== null && total !== undefined ? r2(total / qty) : null,
    }];
    itemsSource = "souhrn";
  }

  const req = pickRequiredDate({
    quoteDeliveryDate: quote?.deliveryDate,
    supplierPromisedDate: job.supplierPromisedDate,
    expectedDeliveryDate: job.expectedDeliveryDate,
    dueDate: job.dueDate,
  });

  const supplierName = supplier?.name ?? textOrUndef(quote?.supplierName);
  if (!supplier && !supplierName) warnings.push("Vyber dodavatele.");
  else if (!supplier) warnings.push(`Dodavatel „${supplierName}" není v adresáři — při vystavení se založí.`);
  else if (!supplier.email) warnings.push("Dodavatel nemá v adresáři e-mail — doplň ho pro odeslání objednávky.");
  const unpriced = unpricedItemCount(items);
  if (unpriced) {
    warnings.push(`${unpriced} ${unpriced === 1 ? "položka nemá" : unpriced < 5 ? "položky nemají" : "položek nemá"} nákupní cenu — marže a provize nebudou přesné.`);
  }
  if (!req.date) warnings.push("Doplň požadovaný termín dodání.");
  else if (req.date < today) warnings.push(`Požadovaný termín ${czDate(req.date)} je v minulosti.`);
  const validUntil = cleanDate(quote?.validUntil);
  if (validUntil && validUntil < today) warnings.push(`Nabídka dodavatele platila jen do ${czDate(validUntil)}.`);

  const drawings = [...items.map((i) => i.drawingNumber), ...job.drawingNumbers];
  return {
    supplierId: supplier?.id ?? null,
    supplierName,
    supplierQuoteId: quote?.id ?? null,
    supplierQuoteNumber: quote?.number ?? null,
    supplier,
    orderDate: today,
    requiredDate: req.date ?? "",
    requiredDateSource: req.source,
    currency: cleanCurrency(quote?.currency ?? job.currency),
    deliveryTerms: DEFAULT_DELIVERY_TERMS,
    paymentTerms: DEFAULT_PAYMENT_TERMS,
    deliveryAddress: input.deliveryAddress,
    note: purchaseOrderNote(job.number, drawings),
    items,
    itemsSource,
    total: purchaseItemsTotal(items),
    warnings,
  };
}

// ── Validace vstupů akcí ────────────────────────────────────
export interface CleanPurchaseOrder {
  supplierId: string | null;
  supplierName: string | null;
  supplierQuoteId: string | null;
  orderDate: string;
  requiredDate: string | null;
  currency: string;
  deliveryTerms: string | null;
  paymentTerms: string | null;
  deliveryAddress: string | null;
  note: string | null;
  items: PurchaseItemRowInput[];
  total: number;
}

function badDate(v: unknown): boolean {
  return v !== undefined && v !== null && v !== "" && cleanDate(v) === null;
}

export function validatePurchaseOrderDraft(
  draft: PurchaseOrderDraftInput,
  today: string = todayIso(),
): { value: CleanPurchaseOrder } | { error: string } {
  if (!draft || typeof draft !== "object") return { error: "Chybí údaje objednávky." };
  const supplierId = draft.supplierId ? String(draft.supplierId) : null;
  if (supplierId && !isUuid(supplierId)) return { error: "Neplatný dodavatel." };
  const supplierName = cleanText(draft.supplierName, 300);
  if (!supplierId && !supplierName) return { error: "Vyber dodavatele." };
  const quoteId = draft.supplierQuoteId ? String(draft.supplierQuoteId) : null;
  if (quoteId && !isUuid(quoteId)) return { error: "Neplatná nabídka dodavatele." };
  if (badDate(draft.orderDate)) return { error: "Neplatné datum objednávky." };
  if (badDate(draft.requiredDate)) return { error: "Neplatný požadovaný termín dodání." };
  const orderDate = cleanDate(draft.orderDate) ?? today;
  const requiredDate = cleanDate(draft.requiredDate);
  if (requiredDate && requiredDate < orderDate) return { error: "Požadovaný termín dodání je před datem objednávky." };
  const items = cleanPurchaseItems(draft.items);
  if ("error" in items) return items;
  return {
    value: {
      supplierId,
      supplierName,
      supplierQuoteId: quoteId,
      orderDate,
      requiredDate,
      currency: cleanCurrency(draft.currency),
      deliveryTerms: cleanText(draft.deliveryTerms, 500),
      paymentTerms: cleanText(draft.paymentTerms, 500),
      deliveryAddress: cleanText(draft.deliveryAddress, 1000),
      note: cleanText(draft.note, 4000),
      items: items.rows,
      total: rowsTotal(items.rows),
    },
  };
}

/** Vyčištěný návrh → view objednávky (náhled PDF před vystavením). */
export function draftToPurchaseOrderView(
  v: CleanPurchaseOrder,
  extras: {
    jobId: string;
    number?: string;
    supplier: PurchaseSupplierRef | null;
    supplierQuote?: { id: string; number: string | null; quoteDate: string | null } | null;
    createdBy?: { id: string; name: string } | null;
    now?: string;
  },
): PurchaseOrderView {
  const now = extras.now ?? new Date().toISOString();
  const supplier = extras.supplier ?? (v.supplierName
    ? { id: "", name: v.supplierName, email: null, phone: null, ico: null, dic: null, address: null, contactPerson: null, country: null }
    : null);
  return {
    id: "",
    jobId: extras.jobId,
    number: extras.number ?? "NÁVRH",
    status: "navrh",
    supplier,
    supplierQuote: extras.supplierQuote ?? null,
    orderDate: v.orderDate,
    requiredDate: v.requiredDate,
    confirmedDate: null,
    currency: v.currency,
    total: v.total,
    deliveryTerms: v.deliveryTerms,
    paymentTerms: v.paymentTerms,
    deliveryAddress: v.deliveryAddress,
    note: v.note,
    supplierReference: null,
    fileId: null,
    sentAt: null,
    createdBy: extras.createdBy ?? null,
    createdAt: now,
    updatedAt: now,
    items: v.items.map((r) => ({
      id: null,
      position: r.position,
      drawingNumber: r.drawing_number,
      name: r.name,
      material: r.material,
      quantity: r.quantity,
      unit: r.unit,
      unitPrice: r.unit_price,
      note: r.note,
    })),
  };
}

/**
 * Vstup nabídky dodavatele → sloupce supplier_quotes. `partial` = úprava
 * (jen zadané klíče). Položky řeší cleanPurchaseItems, celkovou cenu
 * resolveSupplierQuoteTotal (tady se jen ověří).
 */
export function supplierQuoteInputToRow(
  input: Partial<SupplierQuoteInput>,
  opts: { partial?: boolean; today?: string } = {},
): { row: Record<string, unknown> } | { error: string } {
  if (!input || typeof input !== "object") return { error: "Chybí údaje nabídky." };
  const has = (k: keyof SupplierQuoteInput) => !opts.partial || input[k] !== undefined;
  const row: Record<string, unknown> = {};

  if (has("supplierId")) {
    const id = input.supplierId ? String(input.supplierId) : null;
    if (id && !isUuid(id)) return { error: "Neplatný dodavatel." };
    row.supplier_id = id;
  }
  if (has("supplierName")) row.supplier_name = cleanText(input.supplierName, 300);
  if (!opts.partial && !row.supplier_id && !row.supplier_name) return { error: "Vyber dodavatele nebo vyplň jeho název." };
  if (has("number")) row.number = cleanText(input.number, 120);
  for (const [key, col] of [["quoteDate", "quote_date"], ["validUntil", "valid_until"], ["deliveryDate", "delivery_date"]] as const) {
    if (!has(key)) continue;
    if (badDate(input[key])) return { error: "Neplatné datum v nabídce dodavatele." };
    row[col] = cleanDate(input[key]);
  }
  if (has("leadTimeDays")) {
    const lead = cleanNumber(input.leadTimeDays);
    if (lead !== null && (lead < 0 || lead > 3650)) return { error: "Neplatná dodací lhůta." };
    row.lead_time_days = lead === null ? null : Math.round(lead);
  }
  if (!opts.partial && !row.delivery_date) {
    row.delivery_date = resolveQuoteDeliveryDate(
      { leadTimeDays: row.lead_time_days, quoteDate: row.quote_date },
      opts.today,
    );
  }
  if (has("currency")) row.currency = cleanCurrency(input.currency);
  if (has("note")) row.note = cleanText(input.note, 4000);
  if (has("fileId")) {
    const f = input.fileId ? String(input.fileId) : null;
    if (f && !isUuid(f)) return { error: "Neplatný dokument." };
    row.file_id = f;
  }
  if (input.total !== undefined && input.total !== null) {
    const t = cleanMoney(input.total);
    if (t === null || t < 0) return { error: "Neplatná celková cena nabídky." };
  }
  if (input.source !== undefined) {
    if (!isSupplierQuoteSource(input.source)) return { error: "Neznámý zdroj nabídky." };
    row.source = input.source;
  } else if (!opts.partial) {
    row.source = "manual";
  }
  // na co je nabídka (druhy kroků) — jen když je výslovně zadané (jinak u focení předvyplní AI)
  if (input.operationKinds !== undefined) {
    if (input.operationKinds !== null && !Array.isArray(input.operationKinds)) return { error: "Neplatné druhy kroků nabídky." };
    const kinds = [...new Set((input.operationKinds ?? []).filter((k): k is string => typeof k === "string"))];
    if (kinds.some((k) => !isOperationKind(k))) return { error: "Neznámý druh kroku nabídky." };
    row.operation_kinds = kinds.length ? kinds : null;
  }
  return { row };
}

// ── Součty, marže, provize ──────────────────────────────────
/**
 * Náklad, zisk a marže zakázky — stejné pravidlo jako DB job_cost (20261023150000):
 * aktivní objednávky dodavatelům, bez nich odhad; objednávka s položkou BEZ CENY = náklad neznámý
 * (`costSource: "neuplna"`, zisk null) — provize ze zisku pak „čeká na nákupní cenu".
 */
export function purchasingTotals(input: {
  revenue: number | null;
  plannedCost: number | null;
  purchaseOrders: { status: PurchaseOrderStatus; total: number; number?: string | null; hasUnpriced?: boolean; items?: { unitPrice?: number | null }[] }[];
}): JobPurchasingTotals {
  const active = input.purchaseOrders.filter((p) => p.status !== "zrusena");
  const purchaseOrdersTotal = r2(active.reduce((s, p) => s + (Number.isFinite(p.total) ? p.total : 0), 0));
  const unpricedOf = (p: (typeof active)[number]) => (p.items ? unpricedItemCount(p.items) : p.hasUnpriced ? 1 : 0);
  const incomplete = active.filter((p) => p.hasUnpriced || unpricedOf(p) > 0);
  if (incomplete.length) {
    return {
      revenue: input.revenue,
      purchaseOrdersTotal,
      plannedCost: input.plannedCost,
      cost: null,
      costSource: "neuplna",
      profit: null,
      margin: null,
      incompleteCost: purchaseOrdersTotal,
      unpricedItems: incomplete.reduce((s, p) => s + Math.max(1, unpricedOf(p)), 0),
      unpricedPurchaseOrders: incomplete.map((p) => p.number ?? "").filter(Boolean),
    };
  }
  const cost = active.length ? purchaseOrdersTotal : input.plannedCost;
  const costSource = active.length ? "objednavky" : input.plannedCost !== null ? "odhad" : null;
  const profit = input.revenue !== null && cost !== null ? r2(input.revenue - cost) : null;
  const margin = profit !== null && input.revenue !== null && input.revenue > 0
    ? Math.round((profit / input.revenue) * 10_000) / 10_000
    : null;
  return {
    revenue: input.revenue,
    purchaseOrdersTotal,
    plannedCost: input.plannedCost,
    cost,
    costSource,
    profit,
    margin,
  };
}

/** Doporučení ke stavu zakázky po vystavení objednávky (stav se NEmění automaticky). */
export function issueStageHint(stage: JobStage): { message: string; suggestStage: JobStage | null } | null {
  if (!isJobStage(stage)) return null;
  if (stage === "potvrzeno") {
    return {
      message: "Objednávka u dodavatele je vystavena — předej zakázku do výroby (kdo + termín).",
      suggestStage: "ve_vyrobe",
    };
  }
  const rank = stageRank(stage);
  if (rank >= 0 && rank < stageRank("objednavka")) {
    return {
      message: `Zakázka je teprve ve stavu „${STAGES[stage].label}" — zákazník ještě neobjednal.`,
      suggestStage: null,
    };
  }
  if (stage === "objednavka") {
    return { message: "Nezapomeň zákazníkovi potvrdit objednávku a termín dodání.", suggestStage: "potvrzeno" };
  }
  return null;
}

// ── E-mail dodavateli ───────────────────────────────────────
const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;

/** „a@x.cz; b@y.cz" → seznam adres; null = některá adresa je neplatná. */
export function parseEmailList(value: unknown): string[] | null {
  if (typeof value !== "string") return value === undefined || value === null ? [] : null;
  const out: string[] = [];
  for (const raw of value.split(/[,;\s]+/)) {
    const s = raw.trim().replace(/^<|>$/g, "");
    if (!s) continue;
    if (!EMAIL_RE.test(s)) return null;
    if (!out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s);
  }
  return out;
}

// ── Poznámka pro dodavatele u položky (Technologie → objednávka) ──
/** Úvod části poznámky položky objednávky, která je pro dodavatele („Pozor: popsat na čele"). */
export const SUPPLIER_NOTE_PREFIX = "Pozor: ";

/** Poznámka pro dodavatele jako část poznámky položky objednávky (null = žádná). */
export function supplierNoteSegment(note: string | null | undefined): string | null {
  const t = (note ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return /^pozor\b/i.test(t) ? `${SUPPLIER_NOTE_PREFIX}${t.replace(/^pozor[:\s,–-]*/i, "").trim() || t}` : `${SUPPLIER_NOTE_PREFIX}${t}`;
}

/** Poznámka položky objednávky → upozornění pro dodavatele („Pozor: …") a zbytek (materiál, úpravy…). */
export function splitItemNote(note: string | null | undefined): { warning: string | null; rest: string | null } {
  const parts = (note ?? "").split(" · ").map((p) => p.trim()).filter(Boolean);
  const warn = parts.filter((p) => p.startsWith(SUPPLIER_NOTE_PREFIX));
  const rest = parts.filter((p) => !p.startsWith(SUPPLIER_NOTE_PREFIX));
  return {
    warning: warn.length ? warn.map((w) => w.slice(SUPPLIER_NOTE_PREFIX.length).trim()).filter(Boolean).join("; ") || null : null,
    rest: rest.length ? rest.join(" · ") : null,
  };
}

export interface SupplierItemNote {
  /** Číslo výkresu, jinak název položky. */
  ref: string;
  note: string;
}

/** Souhrn poznámek pro dodavatele z položek objednávky (do e-mailu). */
export function supplierNotesOfItems(items: { drawingNumber?: string | null; name?: string | null; note?: string | null }[]): SupplierItemNote[] {
  const out: SupplierItemNote[] = [];
  items.forEach((it, i) => {
    const w = splitItemNote(it.note).warning;
    if (!w) return;
    const ref = (it.drawingNumber ?? "").trim() || (it.name ?? "").trim() || `položka ${i + 1}`;
    out.push({ ref, note: w });
  });
  return out;
}

export function purchaseOrderEmail(input: {
  number: string;
  companyName: string;
  supplierQuoteNumber?: string | null;
  requiredDate?: string | null;
  confirmWithinDays?: number;
  senderName?: string | null;
  senderEmail?: string | null;
  senderPhone?: string | null;
  companyWeb?: string | null;
  /** Objednávka bez nabídky dodavatele: výkresy firma od nás nemá — řádek, že je pošleme. */
  drawingsSeparately?: boolean;
  /** Poznámky pro dodavatele u položek („pozor popsat na čele") — souhrn v e-mailu (v PDF jsou u položky). */
  itemNotes?: SupplierItemNote[];
  /** Podpis odesílatele z Nastavení pošty (text s pozdravem → při odeslání grafický s logem). */
  signatureText?: string | null;
}): { subject: string; body: string } {
  const days = input.confirmWithinDays ?? CONFIRM_WITHIN_WORKING_DAYS;
  const quote = (input.supplierQuoteNumber ?? "").trim();
  const req = cleanDate(input.requiredDate);
  const lines = [
    "Dobrý den,",
    "",
    `v příloze Vám zasíláme naši objednávku č. ${input.number}${quote ? ` na základě Vaší nabídky č. ${quote}` : ""}.`,
  ];
  if (req) lines.push(`Požadovaný termín dodání: ${czDate(req)} (${czWeekday(req)}).`);
  const notes = (input.itemNotes ?? []).filter((n) => n.note.trim());
  if (notes.length) {
    lines.push("", "Prosíme, věnujte pozornost poznámkám u položek:");
    for (const n of notes.slice(0, 20)) lines.push(`– ${n.ref}: ${n.note.trim()}`);
  }
  if (input.drawingsSeparately && !quote) lines.push("Výkresovou dokumentaci k položkám Vám pošleme samostatně, pokud ji od nás ještě nemáte.");
  lines.push(
    "",
    `Prosíme o potvrzení objednávky a termínu dodání do ${days} ${days === 1 ? "pracovního dne" : "pracovních dnů"} — stačí odpovědět na tento e-mail.`,
    `Číslo objednávky ${input.number} prosíme uvádějte na dodacím listu i faktuře.`,
    "",
    "Děkujeme za spolupráci.",
    "",
  );
  return {
    subject: `Objednávka ${input.number} — ${input.companyName}`,
    body: [...lines, ...supplierClosing(input)].join("\n"),
  };
}

/** Odesílatel a firma do podpisu e-mailu dodavateli. */
export interface SupplierMailSender {
  number: string;
  companyName: string;
  senderName?: string | null;
  senderEmail?: string | null;
  senderPhone?: string | null;
  companyWeb?: string | null;
  /** Podpis odesílatele z Nastavení pošty (text s pozdravem → při odeslání grafický s logem). */
  signatureText?: string | null;
}

function supplierSignature(input: SupplierMailSender): string[] {
  return [
    input.senderName,
    input.companyName,
    [input.senderPhone ? `tel. ${input.senderPhone}` : "", input.senderEmail ?? ""].filter(Boolean).join(" · "),
    input.companyWeb,
  ]
    .map((s) => (s ?? "").trim())
    .filter(Boolean);
}

/** Závěr e-mailu dodavateli: podpis z Nastavení pošty (i s pozdravem), jinak „S pozdravem" + jméno, firma, kontakt. */
function supplierClosing(input: SupplierMailSender): string[] {
  const own = (input.signatureText ?? "").trim();
  return own ? [own] : ["S pozdravem", "", ...supplierSignature(input)];
}

/** Změna odeslané objednávky (nový termín / položky) — PDF změny v příloze. */
export function purchaseOrderChangeEmail(input: SupplierMailSender & {
  revision: number;
  requiredDate?: string | null;
  previousRequiredDate?: string | null;
  reason?: string | null;
}): { subject: string; body: string } {
  const req = cleanDate(input.requiredDate);
  const prev = cleanDate(input.previousRequiredDate);
  const reason = (input.reason ?? "").trim();
  const lines = [
    "Dobrý den,",
    "",
    `posíláme změnu naší objednávky č. ${input.number} (změna ${input.revision}) — aktuální znění je v příloze.`,
  ];
  if (req && prev && req !== prev) lines.push(`Požadovaný termín dodání se mění z ${czDate(prev)} na ${czDate(req)} (${czWeekday(req)}).`);
  else if (req) lines.push(`Požadovaný termín dodání: ${czDate(req)} (${czWeekday(req)}).`);
  if (reason) lines.push(`Důvod: ${reason}`);
  lines.push(
    "",
    "Prosíme o potvrzení změny — stačí odpovědět na tento e-mail.",
    "",
    "Děkujeme za pochopení.",
    "",
  );
  return {
    subject: `Změna objednávky ${input.number} (změna ${input.revision}) — ${input.companyName}`,
    body: [...lines, ...supplierClosing(input)].join("\n"),
  };
}

/** Storno objednávky u dodavatele. */
export function purchaseOrderCancelEmail(input: SupplierMailSender & { reason?: string | null }): { subject: string; body: string } {
  const reason = (input.reason ?? "").trim();
  const lines = [
    "Dobrý den,",
    "",
    `rušíme naši objednávku č. ${input.number}${reason ? ` — ${reason}` : ""}.`,
    "Prosíme, nepokračujte ve výrobě a potvrďte nám storno odpovědí na tento e-mail. Pokud už vznikly náklady, dejte nám prosím vědět.",
    "",
    "Děkujeme a omlouváme se za komplikace.",
    "",
  ];
  return {
    subject: `Storno objednávky ${input.number} — ${input.companyName}`,
    body: [...lines, ...supplierClosing(input)].join("\n"),
  };
}

/** Pozastavení objednávky u dodavatele (zakázka čeká). */
export function purchaseOrderHoldEmail(input: SupplierMailSender & { reason?: string | null }): { subject: string; body: string } {
  const reason = (input.reason ?? "").trim();
  const lines = [
    "Dobrý den,",
    "",
    `prosíme o pozastavení naší objednávky č. ${input.number}${reason ? ` — ${reason}` : ""}.`,
    "Ve výrobě zatím nepokračujte; jakmile bude možné pokračovat, ozveme se s novým termínem.",
    "",
    "Děkujeme za pochopení.",
    "",
  ];
  return {
    subject: `Pozastavení objednávky ${input.number} — ${input.companyName}`,
    body: [...lines, ...supplierClosing(input)].join("\n"),
  };
}

// ── Adresa dodavatele (jedno pole → řádky pro PDF) ──────────
/** „Průmyslová 12, 530 02 Pardubice" → { street, zip, city }. */
export function splitAddress(address: string | null | undefined): { street?: string; zip?: string; city?: string; extra: string[] } {
  const raw = (address ?? "").trim();
  if (!raw) return { extra: [] };
  const parts = (raw.includes("\n") ? raw.split("\n") : raw.split(/,\s*/)).map((s) => s.trim()).filter(Boolean);
  let zip: string | undefined;
  let city: string | undefined;
  const rest: string[] = [];
  for (const p of parts) {
    const m = /^(\d{3}\s?\d{2})\s+(.+)$/.exec(p);
    if (!zip && m) {
      zip = m[1].replace(/^(\d{3})(\d{2})$/, "$1 $2");
      city = m[2].trim();
    } else {
      rest.push(p);
    }
  }
  const street = rest.shift();
  if (!zip && rest.length) city = rest.shift();
  return { street, zip, city, extra: rest };
}

// ── Řádky DB → view-modely ──────────────────────────────────
type Embed<T> = T | T[] | null | undefined;
const PERSON = "id, full_name, email";
const SUPPLIER_EMBED = "supplier:suppliers!supplier_id(id, name, email, phone, ico, dic, address, contact_person, country)";

export const SUPPLIER_QUOTE_SELECT = [
  "*",
  SUPPLIER_EMBED,
  `creator:profiles!created_by(${PERSON})`,
  `selector:profiles!selected_by(${PERSON})`,
  "items:supplier_quote_items!supplier_quote_id(*)",
].join(", ");

export const PURCHASE_ORDER_SELECT = [
  "*",
  SUPPLIER_EMBED,
  `creator:profiles!created_by(${PERSON})`,
  `status_changer:profiles!status_changed_by(${PERSON})`,
  `sender:profiles!sent_by(${PERSON})`,
  `confirmer:profiles!confirmed_by(${PERSON})`,
  `deliverer:profiles!delivered_by(${PERSON})`,
  `canceller:profiles!cancelled_by(${PERSON})`,
  "quote:supplier_quotes!supplier_quote_id(id, number, quote_date)",
  `items:purchase_order_items!purchase_order_id(*, receiver:profiles!received_changed_by(${PERSON}))`,
].join(", ");

export const PURCHASE_ORDER_LIST_SELECT = [
  PURCHASE_ORDER_SELECT,
  "job:orders!job_id(id, number, title, status, customer:customers!customer_id(id, name))",
].join(", ");

export interface SupplierEmbedRow {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  ico?: string | null;
  dic?: string | null;
  address?: string | null;
  contact_person?: string | null;
  country?: string | null;
}

export interface PurchaseItemDbRow {
  id?: string;
  position?: number | null;
  drawing_number?: string | null;
  name?: string | null;
  material?: string | null;
  quantity?: number | string | null;
  unit?: string | null;
  unit_price?: number | string | null;
  note?: string | null;
  received_quantity?: number | string | null;
  received_changed_at?: string | null;
  received_changed_by?: string | null;
  receipt_closed?: boolean | null;
  receipt_closed_reason?: string | null;
  order_item_id?: string | null;
  receiver?: Embed<PersonEmbed>;
}

export interface SupplierQuoteDbRow {
  id: string;
  job_id: string;
  supplier_id?: string | null;
  supplier_name?: string | null;
  number?: string | null;
  quote_date?: string | null;
  valid_until?: string | null;
  lead_time_days?: number | null;
  delivery_date?: string | null;
  currency?: string | null;
  total?: number | string | null;
  selected?: boolean | null;
  note?: string | null;
  file_id?: string | null;
  source?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at?: string | null;
  selected_at?: string | null;
  selected_by?: string | null;
  operation_kinds?: string[] | null;
  supplier?: Embed<SupplierEmbedRow>;
  creator?: Embed<PersonEmbed>;
  selector?: Embed<PersonEmbed>;
  items?: PurchaseItemDbRow[] | null;
}

export interface PurchaseOrderDbRow {
  id: string;
  job_id: string;
  supplier_id?: string | null;
  supplier_quote_id?: string | null;
  number?: string | null;
  status: string;
  order_date: string;
  required_date?: string | null;
  confirmed_date?: string | null;
  currency?: string | null;
  total?: number | string | null;
  delivery_terms?: string | null;
  payment_terms?: string | null;
  delivery_address?: string | null;
  note?: string | null;
  supplier_reference?: string | null;
  file_id?: string | null;
  created_by?: string | null;
  sent_at?: string | null;
  sent_by?: string | null;
  status_changed_at?: string | null;
  status_changed_by?: string | null;
  status_changed_via?: string | null;
  confirmed_at?: string | null;
  confirmed_by?: string | null;
  delivered_at?: string | null;
  delivered_by?: string | null;
  cancelled_at?: string | null;
  cancelled_by?: string | null;
  cancel_reason?: string | null;
  created_at: string;
  updated_at?: string | null;
  supplier?: Embed<SupplierEmbedRow>;
  creator?: Embed<PersonEmbed>;
  status_changer?: Embed<PersonEmbed>;
  sender?: Embed<PersonEmbed>;
  confirmer?: Embed<PersonEmbed>;
  deliverer?: Embed<PersonEmbed>;
  canceller?: Embed<PersonEmbed>;
  quote?: Embed<{ id: string; number: string | null; quote_date: string | null }>;
  items?: PurchaseItemDbRow[] | null;
  job?: Embed<{
    id: string; number: string | null; title: string | null; status: string;
    customer?: Embed<{ id: string; name: string }>;
  }>;
}

export interface CommissionDbRow {
  owner_id: string;
  period: string;
  revenue: number | string | null;
  cost?: number | string | null;
  profit?: number | string | null;
  margin?: number | string | null;
  rate?: number | string | null;
  base?: string | null;
  commission: number | string | null;
  status?: string | null;
  cost_known?: boolean | null;
  updated_at?: string | null;
  cost_pending_po?: string[] | null;
}

function num(v: unknown): number | null {
  return cleanNumber(v);
}

export function rowToSupplierRef(s: Embed<SupplierEmbedRow>): PurchaseSupplierRef | null {
  const x = one(s);
  if (!x || !x.id) return null;
  return {
    id: x.id,
    name: x.name,
    email: x.email ?? null,
    phone: x.phone ?? null,
    ico: x.ico ?? null,
    dic: x.dic ?? null,
    address: x.address ?? null,
    contactPerson: x.contact_person ?? null,
    country: x.country ?? null,
  };
}

export function rowToPurchaseItem(row: PurchaseItemDbRow): PurchaseItem {
  return {
    id: row.id ?? null,
    position: row.position ?? 0,
    drawingNumber: row.drawing_number ?? null,
    name: row.name ?? null,
    material: row.material ?? null,
    quantity: num(row.quantity) ?? 1,
    unit: row.unit ?? "ks",
    unitPrice: num(row.unit_price),
    note: row.note ?? null,
    receivedQuantity: num(row.received_quantity) ?? 0,
    receiptClosed: Boolean(row.receipt_closed),
    receiptClosedReason: row.receipt_closed_reason ?? null,
    orderItemId: row.order_item_id ?? null,
  };
}

function itemsOf(rows: PurchaseItemDbRow[] | null | undefined): PurchaseItem[] {
  return [...(rows ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map(rowToPurchaseItem);
}

export function rowToSupplierQuoteView(row: SupplierQuoteDbRow): SupplierQuoteView {
  const supplier = rowToSupplierRef(row.supplier);
  return {
    id: row.id,
    jobId: row.job_id,
    supplier,
    supplierName: supplier?.name ?? (row.supplier_name ?? "").trim(),
    number: row.number ?? null,
    quoteDate: row.quote_date ?? null,
    validUntil: row.valid_until ?? null,
    leadTimeDays: row.lead_time_days ?? null,
    deliveryDate: row.delivery_date ?? null,
    currency: row.currency || "CZK",
    total: num(row.total),
    selected: Boolean(row.selected),
    note: row.note ?? null,
    fileId: row.file_id ?? null,
    source: isSupplierQuoteSource(row.source) ? row.source : "manual",
    createdBy: personRef(row.creator),
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
    items: itemsOf(row.items),
    selectedStamp: row.selected ? poStamp(row.selected_at, row.selected_by, row.selector) : null,
    operationKinds: Array.isArray(row.operation_kinds) ? row.operation_kinds.filter((k) => isOperationKind(k)) : null,
  };
}

/**
 * Razítko kroku objednávky ze sloupců (at + by + embed profilu). Krok, který se stal bez
 * přihlášeného účtu (přímý zápis, starší data), je „Systém"; via jen u změny stavu.
 */
function poStamp(at: string | null | undefined, byId: string | null | undefined, person: Embed<PersonEmbed>, via?: string | null): ChangeStamp | null {
  const fields: Record<string, unknown> = { s_at: at ?? null, s_by: byId ?? null, s_via: via ?? null };
  return stampFromRow(fields, "s", personRef(person));
}

/** Kdo co s objednávkou udělal — ze sloupců DB (ne z historie). */
export function purchaseOrderStamps(row: PurchaseOrderDbRow): PurchaseOrderStamps {
  const status = row.status;
  let received: ChangeStamp | null = null;
  for (const it of row.items ?? []) {
    const st = poStamp(it.received_changed_at, it.received_changed_by, it.receiver);
    if (st && (!received || (st.at ?? "") > (received.at ?? ""))) received = st;
  }
  return {
    created: poStamp(row.created_at, row.created_by, row.creator),
    status: poStamp(row.status_changed_at, row.status_changed_by, row.status_changer, row.status_changed_via),
    sent: row.sent_at ? poStamp(row.sent_at, row.sent_by, row.sender) : null,
    confirmed: status === "potvrzena" || row.confirmed_at ? poStamp(row.confirmed_at, row.confirmed_by, row.confirmer) : null,
    delivered: status === "dodana" ? poStamp(row.delivered_at, row.delivered_by, row.deliverer) : null,
    cancelled: status === "zrusena" ? poStamp(row.cancelled_at, row.cancelled_by, row.canceller) : null,
    received,
  };
}

/** Převzato vše (položka převzatá v plném množství nebo uzavřená s menším). */
export function isItemReceived(it: Pick<PurchaseItem, "quantity" | "receivedQuantity" | "receiptClosed">): boolean {
  return Boolean(it.receiptClosed) || (it.receivedQuantity ?? 0) + 1e-9 >= it.quantity;
}

/** Převzetí po položkách: „1/2 položek", částečně = něco převzato, ale ne vše. */
export function purchaseReceipt(items: Pick<PurchaseItem, "quantity" | "receivedQuantity" | "receiptClosed">[]): { done: number; total: number; partial: boolean } {
  const total = items.length;
  const done = items.filter(isItemReceived).length;
  const any = items.some((it) => (it.receivedQuantity ?? 0) > 0 || it.receiptClosed);
  return { done, total, partial: any && done < total };
}

/** Odvozený stav objednávky dodavateli navíc k enumu (1.8): částečně dodaná / po termínu. */
export function purchaseExtraStates(
  po: Pick<PurchaseOrderView, "status" | "requiredDate" | "confirmedDate"> & { receipt?: { partial: boolean } | null },
  today: string,
): PurchaseExtraState[] {
  const out: PurchaseExtraState[] = [];
  if ((po.status === "odeslana" || po.status === "potvrzena" || po.status === "vystavena") && po.receipt?.partial) out.push("castecne_dodana");
  const due = po.confirmedDate ?? po.requiredDate;
  if (po.status !== "dodana" && po.status !== "zrusena" && po.status !== "navrh" && due && due < today) out.push("po_terminu");
  return out;
}

/** Výrobní operace pro pravidlo „Dodáno k nám" (2.7). */
export interface StageRuleOperation {
  id: string;
  position: number;
  status: string;
  inHouse: boolean;
  purchaseOrderId: string | null;
}

/**
 * Pravidlo 2.7 (M6) — posune dodání objednávky dodavateli zakázku do „Dodáno k nám"?
 *  • bez operací: všechny nezrušené objednávky dodané;
 *  • s operacemi: všechny hotové / přeskočené a POSLEDNÍ nepřeskočená je kooperace
 *    (po kooperaci nezbývá vlastní operace) — navázané operace dodaných PO se počítají jako hotové;
 *  • objednávka bez navázané operace (materiál) u zakázky s operacemi stav neposouvá.
 */
export function purchaseDeliveryAdvances(input: {
  deliveredPoId: string;
  orders: { id: string; status: PurchaseOrderStatus }[];
  operations: StageRuleOperation[];
}): { advance: boolean; pendingOrders: number; reason: "vse_dodano" | "ceka_objednavky" | "material" | "zbyva_vyroba" | "kooperace_hotova" } {
  const pending = input.orders.filter((o) => o.id !== input.deliveredPoId && o.status !== "zrusena" && o.status !== "dodana").length;
  if (!input.operations.length) {
    return pending ? { advance: false, pendingOrders: pending, reason: "ceka_objednavky" } : { advance: true, pendingOrders: 0, reason: "vse_dodano" };
  }
  const delivered = new Set(input.orders.filter((o) => o.status === "dodana").map((o) => o.id));
  delivered.add(input.deliveredPoId);
  const ops = [...input.operations].sort((a, b) => a.position - b.position).map((o) => ({
    ...o,
    status: o.purchaseOrderId && delivered.has(o.purchaseOrderId) && o.status !== "preskoceno" ? "hotovo" : o.status,
  }));
  const linked = ops.some((o) => o.purchaseOrderId === input.deliveredPoId);
  if (!linked) return { advance: false, pendingOrders: pending, reason: "material" };
  const allDone = ops.every((o) => o.status === "hotovo" || o.status === "preskoceno");
  const last = [...ops].reverse().find((o) => o.status !== "preskoceno");
  if (allDone && last && !last.inHouse) return { advance: true, pendingOrders: pending, reason: "kooperace_hotova" };
  return { advance: false, pendingOrders: pending, reason: "zbyva_vyroba" };
}

export function rowToPurchaseOrderView(row: PurchaseOrderDbRow): PurchaseOrderView {
  const quote = one(row.quote);
  const items = itemsOf(row.items);
  return {
    id: row.id,
    jobId: row.job_id,
    number: row.number ?? "—",
    status: isPurchaseOrderStatus(row.status) ? row.status : "navrh",
    supplier: rowToSupplierRef(row.supplier),
    supplierQuote: quote ? { id: quote.id, number: quote.number ?? null, quoteDate: quote.quote_date ?? null } : null,
    orderDate: row.order_date,
    requiredDate: row.required_date ?? null,
    confirmedDate: row.confirmed_date ?? null,
    currency: row.currency || "CZK",
    total: num(row.total) ?? 0,
    deliveryTerms: row.delivery_terms ?? null,
    paymentTerms: row.payment_terms ?? null,
    deliveryAddress: row.delivery_address ?? null,
    note: row.note ?? null,
    supplierReference: row.supplier_reference ?? null,
    fileId: row.file_id ?? null,
    sentAt: row.sent_at ?? null,
    createdBy: personRef(row.creator),
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
    items,
    cancelReason: row.cancel_reason ?? null,
    stamps: purchaseOrderStamps(row),
    receipt: purchaseReceipt(items),
  };
}

export function rowToPurchaseOrderListItem(row: PurchaseOrderDbRow): PurchaseOrderListItem {
  const view = rowToPurchaseOrderView(row);
  const items = view.items;
  const job = one(row.job);
  const customer = job ? one(job.customer) : null;
  const drawingNumbers: string[] = [];
  for (const it of items) {
    const d = (it.drawingNumber ?? "").trim();
    if (d && !drawingNumbers.includes(d)) drawingNumbers.push(d);
  }
  return {
    ...view,
    job: job
      ? { id: job.id, number: job.number ?? "—", title: job.title ?? "", stage: isJobStage(job.status) ? job.status : "poptavka" }
      : null,
    customer: customer ? { id: customer.id, name: customer.name } : null,
    itemCount: items.length,
    drawingNumbers,
  };
}

export function rowToCommissionView(row: CommissionDbRow, ownerName: string): JobCommissionView {
  const status = row.status === "k_vyplate" || row.status === "vyplaceno" ? row.status : "predbezna";
  return {
    ownerId: row.owner_id,
    ownerName,
    revenue: num(row.revenue) ?? 0,
    cost: num(row.cost) ?? 0,
    profit: num(row.profit) ?? 0,
    margin: num(row.margin) ?? 0,
    rate: num(row.rate) ?? 0,
    base: row.base === "revenue" ? "revenue" : "margin",
    commission: num(row.commission) ?? 0,
    status,
    costKnown: row.cost_known !== false,
    period: row.period,
    updatedAt: row.updated_at ?? null,
    ...(Array.isArray(row.cost_pending_po) && row.cost_pending_po.length && row.cost_known === false
      ? { pendingPurchaseOrders: row.cost_pending_po.filter((x) => typeof x === "string" && x) }
      : {}),
  };
}

/** Fulltext v přehledu objednávek: číslo, dodavatel, zakázka, zákazník, výkresy, reference. */
export function filterPurchaseOrders(items: PurchaseOrderListItem[], q: string | undefined): PurchaseOrderListItem[] {
  const tokens = searchNormalize(q ?? "").split(/\s+/).filter(Boolean);
  if (!tokens.length) return items;
  return items.filter((po) => {
    const h = searchNormalize([
      po.number, po.supplier?.name, po.job?.number, po.job?.title, po.customer?.name,
      po.supplierReference, po.supplierQuote?.number, ...po.drawingNumbers,
    ].filter(Boolean).join(" "));
    return tokens.every((t) => h.includes(t));
  });
}
