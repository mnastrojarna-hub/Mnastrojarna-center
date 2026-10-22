import type { JobDetail, JobItem } from "@/lib/jobs/types";
import type {
  JobCommissionView, JobPurchasingTotals, PurchaseItem, PurchaseItemInput, PurchaseOrderDraftInput, PurchaseOrderView,
  SupplierQuoteInput, SupplierQuoteView,
} from "@/lib/jobs/purchasing-types";
import type { PurchaseOrderStatus } from "@/lib/supabase/database.types";
import { parseDecimal, isInvalidDecimal, decimalInput, formatMoney, formatPercent } from "@/components/jobs/detail/detail-helpers";
import { formatRate, periodSlash } from "@/components/commissions/model";

/**
 * Záložka „Nákup & marže" — čistá logika UI (bez Reactu a DB): koncepty
 * položek nákupu, formulář nabídky dodavatele, srovnání nabídek, souhrn marže
 * a provize pro hlavní kartu. Testy v purchasing-model.test.ts.
 */

// ── Koncepty položek ────────────────────────────────────────
export interface PurchaseItemDraft {
  key: string;
  drawingNumber: string;
  name: string;
  material: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  note: string;
}

let seq = 0;
function key(): string {
  seq += 1;
  return `p${seq}`;
}

export function emptyPurchaseDraft(): PurchaseItemDraft {
  return { key: key(), drawingNumber: "", name: "", material: "", quantity: "1", unit: "ks", unitPrice: "", note: "" };
}

export function purchaseDraftFrom(it: Partial<PurchaseItem> | PurchaseItemInput): PurchaseItemDraft {
  return {
    key: key(),
    drawingNumber: it.drawingNumber ?? "",
    name: it.name ?? "",
    material: it.material ?? "",
    quantity: decimalInput(it.quantity ?? 1) || "1",
    unit: it.unit || "ks",
    unitPrice: decimalInput(it.unitPrice ?? null),
    note: it.note ?? "",
  };
}

/** Položky zakázky → koncepty nabídky dodavatele (bez cen — doplní se z nabídky). */
export function draftsFromJobItems(
  items: Pick<JobItem, "drawingNumber" | "name" | "description" | "material" | "quantity" | "unit">[],
): PurchaseItemDraft[] {
  return items.map((it) => purchaseDraftFrom({
    drawingNumber: it.drawingNumber ?? undefined,
    name: (it.name || it.description || (it.drawingNumber ? `Díl dle výkresu ${it.drawingNumber}` : "")) || undefined,
    material: it.material ?? undefined,
    quantity: it.quantity,
    unit: it.unit,
    unitPrice: null,
  }));
}

export function isBlankPurchaseDraft(d: PurchaseItemDraft): boolean {
  return !d.drawingNumber.trim() && !d.name.trim() && !d.material.trim() && !d.unitPrice.trim() && !d.note.trim();
}

/** Kontrola konceptů — česká chyba nebo null (stejná pravidla jako server). */
export function validatePurchaseDrafts(drafts: PurchaseItemDraft[], opts: { allowEmpty?: boolean } = {}): string | null {
  let n = 0;
  for (const d of drafts) {
    if (isBlankPurchaseDraft(d)) continue;
    n += 1;
    if (!d.drawingNumber.trim() && !d.name.trim()) return `Položka ${n}: vyplň číslo výkresu nebo název.`;
    const q = parseDecimal(d.quantity);
    if (q === null || q <= 0) return `Položka ${n}: zadej množství větší než 0.`;
    if (isInvalidDecimal(d.unitPrice) || (parseDecimal(d.unitPrice) ?? 0) < 0) return `Položka ${n}: cena za MJ musí být číslo.`;
  }
  if (!n && !opts.allowEmpty) return "Přidej alespoň jednu položku.";
  return null;
}

export function purchaseDraftsToInput(drafts: PurchaseItemDraft[]): PurchaseItemInput[] {
  return drafts.filter((d) => !isBlankPurchaseDraft(d)).map((d) => ({
    drawingNumber: d.drawingNumber.trim() || undefined,
    name: d.name.trim() || undefined,
    material: d.material.trim() || undefined,
    quantity: parseDecimal(d.quantity) ?? 1,
    unit: d.unit.trim() || "ks",
    unitPrice: parseDecimal(d.unitPrice),
    note: d.note.trim() || undefined,
  }));
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Řádek × množství (null bez ceny). */
export function purchaseDraftLine(d: Pick<PurchaseItemDraft, "quantity" | "unitPrice">): number | null {
  const q = parseDecimal(d.quantity);
  const p = parseDecimal(d.unitPrice);
  return q === null || p === null ? null : r2(q * p);
}

/** Σ položek (bez ceny = 0) + kolik položek nemá cenu. */
export function purchaseDraftsTotal(drafts: PurchaseItemDraft[]): { total: number; unpriced: number; count: number; priced: boolean } {
  let total = 0;
  let unpriced = 0;
  let count = 0;
  let priced = false;
  for (const d of drafts) {
    if (isBlankPurchaseDraft(d)) continue;
    count += 1;
    const line = purchaseDraftLine(d);
    if (line === null) unpriced += 1;
    else {
      total += line;
      priced = true;
    }
  }
  return { total: r2(total), unpriced, count, priced };
}

// ── Formulář nabídky dodavatele ─────────────────────────────
export interface SupplierQuoteFormState {
  supplierId: string | null;
  /** Dodavatel mimo adresář (volný název). */
  supplierName: string;
  number: string;
  quoteDate: string;
  validUntil: string;
  leadTimeDays: string;
  deliveryDate: string;
  /** Celkem bez DPH — prázdné = Σ položek. */
  total: string;
  note: string;
  items: PurchaseItemDraft[];
}

export function supplierQuoteFormNew(job: Pick<JobDetail, "items">, today: string): SupplierQuoteFormState {
  return {
    supplierId: null, supplierName: "", number: "", quoteDate: today, validUntil: "", leadTimeDays: "", deliveryDate: "",
    total: "", note: "", items: draftsFromJobItems(job.items),
  };
}

export function supplierQuoteFormFrom(q: SupplierQuoteView): SupplierQuoteFormState {
  const items = q.items.map(purchaseDraftFrom);
  const sum = purchaseDraftsTotal(items);
  // celková částka jen když se liší od Σ položek (jinak se dopočítá)
  const explicit = q.total !== null && (!sum.priced || Math.abs(sum.total - q.total) > 0.005);
  return {
    supplierId: q.supplier?.id ?? null,
    supplierName: q.supplier ? "" : q.supplierName,
    number: q.number ?? "",
    quoteDate: q.quoteDate ?? "",
    validUntil: q.validUntil ?? "",
    leadTimeDays: q.leadTimeDays !== null ? String(q.leadTimeDays) : "",
    deliveryDate: q.deliveryDate ?? "",
    total: explicit ? decimalInput(q.total) : "",
    note: q.note ?? "",
    items,
  };
}

export function validateSupplierQuoteForm(f: SupplierQuoteFormState): string | null {
  if (!f.supplierId && !f.supplierName.trim()) return "Vyber dodavatele nebo napiš jeho název.";
  const bad = validatePurchaseDrafts(f.items, { allowEmpty: true });
  if (bad) return bad;
  if (f.leadTimeDays.trim()) {
    const d = parseDecimal(f.leadTimeDays);
    if (d === null || d < 0 || d > 3650) return "Dodací lhůta musí být počet dní.";
  }
  if (isInvalidDecimal(f.total) || (parseDecimal(f.total) ?? 0) < 0) return "Celková cena musí být číslo.";
  const sum = purchaseDraftsTotal(f.items);
  if (!sum.count && parseDecimal(f.total) === null) return "Zadej položky nebo celkovou cenu nabídky.";
  if (f.validUntil && f.quoteDate && f.validUntil < f.quoteDate) return "Platnost nabídky končí před datem nabídky.";
  return null;
}

export function supplierQuoteFormToInput(f: SupplierQuoteFormState): SupplierQuoteInput {
  const lead = parseDecimal(f.leadTimeDays);
  return {
    supplierId: f.supplierId,
    supplierName: f.supplierId ? undefined : f.supplierName.trim(),
    number: f.number.trim(),
    quoteDate: f.quoteDate,
    validUntil: f.validUntil,
    leadTimeDays: lead === null ? null : Math.round(lead),
    deliveryDate: f.deliveryDate,
    note: f.note.trim(),
    items: purchaseDraftsToInput(f.items),
    total: parseDecimal(f.total),
  };
}

// ── Formulář objednávky vydané ──────────────────────────────
export interface PurchaseOrderFormState {
  supplierId: string | null;
  supplierName: string;
  supplierQuoteId: string | null;
  orderDate: string;
  requiredDate: string;
  currency: string;
  deliveryTerms: string;
  paymentTerms: string;
  deliveryAddress: string;
  note: string;
  items: PurchaseItemDraft[];
}

export function purchaseOrderFormFromDraft(d: PurchaseOrderDraftInput & { supplierName?: string }): PurchaseOrderFormState {
  return {
    supplierId: d.supplierId ?? null,
    supplierName: d.supplierId ? "" : d.supplierName ?? "",
    supplierQuoteId: d.supplierQuoteId ?? null,
    orderDate: d.orderDate ?? "",
    requiredDate: d.requiredDate ?? "",
    currency: d.currency || "CZK",
    deliveryTerms: d.deliveryTerms ?? "",
    paymentTerms: d.paymentTerms ?? "",
    deliveryAddress: d.deliveryAddress ?? "",
    note: d.note ?? "",
    items: d.items.map(purchaseDraftFrom),
  };
}

export function purchaseOrderFormFromView(po: PurchaseOrderView): PurchaseOrderFormState {
  return {
    supplierId: po.supplier?.id ?? null,
    supplierName: po.supplier?.id ? "" : po.supplier?.name ?? "",
    supplierQuoteId: po.supplierQuote?.id ?? null,
    orderDate: po.orderDate,
    requiredDate: po.requiredDate ?? "",
    currency: po.currency,
    deliveryTerms: po.deliveryTerms ?? "",
    paymentTerms: po.paymentTerms ?? "",
    deliveryAddress: po.deliveryAddress ?? "",
    note: po.note ?? "",
    items: po.items.map(purchaseDraftFrom),
  };
}

export function validatePurchaseOrderForm(f: PurchaseOrderFormState): string | null {
  if (!f.supplierId && !f.supplierName.trim()) return "Vyber dodavatele.";
  const bad = validatePurchaseDrafts(f.items);
  if (bad) return bad;
  if (f.requiredDate && f.orderDate && f.requiredDate < f.orderDate) return "Požadovaný termín dodání je před datem objednávky.";
  return null;
}

export function purchaseOrderFormToInput(f: PurchaseOrderFormState): PurchaseOrderDraftInput {
  return {
    supplierId: f.supplierId,
    supplierName: f.supplierId ? undefined : f.supplierName.trim(),
    supplierQuoteId: f.supplierQuoteId,
    orderDate: f.orderDate || undefined,
    requiredDate: f.requiredDate,
    currency: f.currency,
    deliveryTerms: f.deliveryTerms,
    paymentTerms: f.paymentTerms,
    deliveryAddress: f.deliveryAddress,
    note: f.note,
    items: purchaseDraftsToInput(f.items),
  };
}

// ── Srovnání nabídek ────────────────────────────────────────
export interface QuoteCompareRow {
  id: string;
  supplierName: string;
  number: string | null;
  total: number | null;
  currency: string;
  deliveryDate: string | null;
  leadTimeDays: number | null;
  selected: boolean;
  /** Nejlevnější (ze všech s cenou). */
  cheapest: boolean;
  /** Nejdřívější termín dodání. */
  fastest: boolean;
  /** O kolik dražší než nejlevnější (null bez ceny). */
  diff: number | null;
  diffShare: number | null;
  /** Délka pruhu ceny (0–100 % nejdražší). */
  bar: number;
  expired: boolean;
}

/** Srovnání nabídek dodavatelů: od nejlevnější, nejlevnější a nejrychlejší zvýrazněné. */
export function compareSupplierQuotes(
  quotes: Pick<SupplierQuoteView, "id" | "supplierName" | "number" | "total" | "currency" | "deliveryDate" | "leadTimeDays" | "selected" | "validUntil">[],
  today: string,
): QuoteCompareRow[] {
  const priced = quotes.filter((q) => q.total !== null) as (typeof quotes[number] & { total: number })[];
  const min = priced.length ? Math.min(...priced.map((q) => q.total)) : null;
  const max = priced.length ? Math.max(...priced.map((q) => q.total)) : null;
  const dates = quotes.map((q) => q.deliveryDate).filter((d): d is string => Boolean(d)).sort();
  const earliest = dates[0] ?? null;
  const multiDates = new Set(dates).size > 1;
  return [...quotes]
    .sort((a, b) => {
      if (a.total === null && b.total === null) return (a.deliveryDate ?? "9999").localeCompare(b.deliveryDate ?? "9999");
      if (a.total === null) return 1;
      if (b.total === null) return -1;
      return a.total - b.total || (a.deliveryDate ?? "9999").localeCompare(b.deliveryDate ?? "9999");
    })
    .map((q) => ({
      id: q.id,
      supplierName: q.supplierName || "Dodavatel",
      number: q.number,
      total: q.total,
      currency: q.currency,
      deliveryDate: q.deliveryDate,
      leadTimeDays: q.leadTimeDays,
      selected: q.selected,
      cheapest: q.total !== null && min !== null && priced.length > 1 && q.total === min,
      fastest: Boolean(earliest && multiDates && q.deliveryDate === earliest),
      diff: q.total !== null && min !== null ? r2(q.total - min) : null,
      diffShare: q.total !== null && min !== null && min > 0 ? Math.round(((q.total - min) / min) * 10_000) / 10_000 : null,
      bar: q.total !== null && max ? Math.max(4, Math.round((q.total / max) * 100)) : 0,
      expired: Boolean(q.validUntil && q.validUntil < today),
    }));
}

// ── Marže a provize (hlavní karta) ──────────────────────────
export type HeroTone = "green" | "red" | "amber" | "slate";

export interface MarginHero {
  revenue: number | null;
  cost: number | null;
  /** „objednavky" = Σ objednávek dodavatelům, „odhad" = plánovaný nákup. */
  costLabel: string;
  profit: number | null;
  margin: number | null;
  tone: HeroTone;
  /** Podíl nákupu / zisku na obratu pro lištu (0–100). */
  costPct: number;
  profitPct: number;
  /** Chybí nákupní cena → nápověda. */
  missingCost: boolean;
  missingRevenue: boolean;
}

export function marginHero(t: JobPurchasingTotals): MarginHero {
  const missingRevenue = t.revenue === null || t.revenue <= 0;
  const missingCost = t.cost === null;
  const tone: HeroTone = t.profit === null ? (missingCost ? "amber" : "slate") : t.profit < 0 ? "red" : "green";
  const rev = t.revenue ?? 0;
  const costPct = rev > 0 && t.cost !== null ? Math.min(100, Math.max(0, Math.round((t.cost / rev) * 1000) / 10)) : 0;
  const profitPct = rev > 0 && t.profit !== null && t.profit > 0 ? Math.max(0, Math.round((100 - costPct) * 10) / 10) : 0;
  return {
    revenue: t.revenue,
    cost: t.cost,
    costLabel: t.costSource === "objednavky" ? "objednávky dodavatelům" : t.costSource === "odhad" ? "odhad (plánovaný nákup)" : "zatím neznámý",
    profit: t.profit,
    margin: t.margin,
    tone,
    costPct,
    profitPct,
    missingCost,
    missingRevenue,
  };
}

export type CommissionTone = "emerald" | "sky" | "amber" | "slate" | "green";

export interface CommissionDisplay {
  /** Hlavní částka (provize / odhad); null = zatím bez částky. */
  amount: number | null;
  /** Odhad (pásmová provize před inkasem). */
  estimate: boolean;
  title: string;
  detail: string;
  status: "predbezna" | "k_vyplate" | "vyplaceno" | null;
  tone: CommissionTone;
}

const STATUS_TITLES = { predbezna: "Předběžná provize", k_vyplate: "Provize k výplatě", vyplaceno: "Provize vyplacena" } as const;

/** Text a částka provize zakázky pro kartu marže. */
export function commissionDisplay(
  c: JobCommissionView | null,
  ctx: { hasOwner: boolean; currency?: string },
): CommissionDisplay {
  const cur = ctx.currency ?? "CZK";
  if (!c) {
    return ctx.hasOwner
      ? { amount: null, estimate: false, title: "Provize zatím nevznikla", detail: "Vznikne s objednávkou zákazníka (zakázka s hodnotou).", status: null, tone: "slate" }
      : { amount: null, estimate: false, title: "Bez obchodníka", detail: "Přiděl obchodníka — provize se mu spočítá dle smlouvy.", status: null, tone: "slate" };
  }
  if (c.base === "margin_tiered") {
    if (c.collected) {
      return {
        amount: c.commission,
        estimate: false,
        title: c.status === "vyplaceno" ? "Pásmová provize vyplacena" : `Započteno do vyúčtování ${periodSlash(c.period)}`,
        detail: c.status === "vyplaceno"
          ? `Podíl na vyúčtování ${periodSlash(c.period)} — vyplaceno.`
          : `Podíl zakázky na měsíční pásmové provizi z inkasa (${periodSlash(c.period)}).`,
        status: c.status,
        tone: c.status === "vyplaceno" ? "green" : "emerald",
      };
    }
    if (!c.costKnown) {
      return {
        amount: null, estimate: true, title: "Pásmová provize z inkasa",
        detail: "Předběžná — doplň nákupní cenu, ať jde odhadnout zisk. Finální částka až po inkasu.",
        status: "predbezna", tone: "amber",
      };
    }
    return {
      amount: c.estimatedCommission ?? 0,
      estimate: true,
      title: "Pásmová provize z inkasa · předběžná",
      detail: `Odhad ${formatMoney(c.estimatedCommission ?? 0, cur)} dle aktuálního pásma — finální částka po inkasu v měsíčním vyúčtování.`,
      status: "predbezna",
      tone: "amber",
    };
  }
  const how = `${formatRate(c.rate)} ${c.base === "revenue" ? "z obratu" : "ze zisku"}`;
  if (!c.costKnown && c.base !== "revenue") {
    return {
      amount: null, estimate: false, title: STATUS_TITLES[c.status],
      detail: `${how} — dopočítá se po doplnění nákupní ceny.`, status: c.status, tone: "amber",
    };
  }
  return {
    amount: c.commission,
    estimate: false,
    title: STATUS_TITLES[c.status],
    detail: `${how} · ${periodSlash(c.period)}${c.status === "predbezna" ? " · finální po fakturaci" : ""}`,
    status: c.status,
    tone: c.status === "vyplaceno" ? "green" : c.status === "k_vyplate" ? "sky" : "emerald",
  };
}

/** „marže 35,7 %" */
export function marginLabel(margin: number | null): string {
  return margin === null ? "marže —" : `marže ${formatPercent(margin)}`;
}

// ── Objednávky dodavatelům ──────────────────────────────────
/** Objednávka po termínu (nedodaná, termín v minulosti). */
export function isPurchaseOrderLate(
  po: Pick<PurchaseOrderView, "status" | "requiredDate" | "confirmedDate">,
  today: string,
): boolean {
  if (po.status === "dodana" || po.status === "zrusena" || po.status === "navrh") return false;
  const due = po.confirmedDate ?? po.requiredDate;
  return Boolean(due && due < today);
}

/** Popisky tlačítek přechodů stavu. */
export const TRANSITION_LABELS: Record<PurchaseOrderStatus, string> = {
  navrh: "Vrátit do návrhu",
  vystavena: "Obnovit (vystavena)",
  odeslana: "Označit jako odeslanou",
  potvrzena: "Dodavatel potvrdil",
  dodana: "Dodáno k nám",
  zrusena: "Zrušit objednávku",
};

export type PurchaseFilter = "vse" | "k_odeslani" | "ceka" | "potvrzena" | "dodana" | "zrusena" | "po_terminu";

/** Filtr přehledu objednávek. */
export function matchesPurchaseFilter(
  po: Pick<PurchaseOrderView, "status" | "requiredDate" | "confirmedDate">,
  filter: PurchaseFilter,
  today: string,
): boolean {
  switch (filter) {
    case "vse": return po.status !== "zrusena";
    case "k_odeslani": return po.status === "navrh" || po.status === "vystavena";
    case "ceka": return po.status === "odeslana";
    case "potvrzena": return po.status === "potvrzena";
    case "dodana": return po.status === "dodana";
    case "zrusena": return po.status === "zrusena";
    case "po_terminu": return isPurchaseOrderLate(po, today);
  }
}

// ── Kdo co udělal (historie zakázky) ────────────────────────
/** Událost historie zakázky (job_events) — stačí typ, data, autor a čas. */
export interface ActivityEvent {
  type: string;
  data: Record<string, unknown> | null;
  actor: { name: string } | null;
  createdAt: string;
}

export type PurchaseActKind =
  | "vystavena" | "odeslana_email" | "odeslana" | "potvrzena" | "dodana" | "zrusena" | "obnovena" | "navrh" | "upravena";

export interface PurchaseAct {
  kind: PurchaseActKind;
  /** Sloveso pro „Vystavil Vít Volný · 22. 10. 14:05". */
  verb: string;
  by: string | null;
  at: string;
}

export const PURCHASE_ACT_VERBS: Record<PurchaseActKind, string> = {
  vystavena: "Vystavil",
  odeslana_email: "Odeslal dodavateli",
  odeslana: "Označil jako odeslanou",
  potvrzena: "Potvrzení zapsal",
  dodana: "Dodání zapsal",
  zrusena: "Zrušil",
  obnovena: "Obnovil",
  navrh: "Vrátil do návrhu",
  upravena: "Upravil",
};

const STATUS_ACT: Record<string, PurchaseActKind> = {
  odeslana: "odeslana", potvrzena: "potvrzena", dodana: "dodana", zrusena: "zrusena", vystavena: "obnovena", navrh: "navrh",
};

export interface PurchaseActivity {
  /** Úkony nad objednávkou dodavateli, od nejstaršího. */
  orders: Map<string, PurchaseAct[]>;
  /** Kdo vybral vítěznou nabídku (poslední výběr). */
  quoteSelected: Map<string, { by: string | null; at: string }>;
  /** Kdo naposledy přidělil obchodníka zakázky. */
  ownerAssigned: { by: string | null; at: string } | null;
}

/** Z historie zakázky vytáhne, který účet co u nákupu udělal. */
export function purchaseActivity(events: ActivityEvent[]): PurchaseActivity {
  const orders = new Map<string, PurchaseAct[]>();
  const quoteSelected = new Map<string, { by: string | null; at: string }>();
  let ownerAssigned: { by: string | null; at: string } | null = null;
  const sorted = [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const e of sorted) {
    const d = e.data ?? {};
    const by = e.actor?.name ?? null;
    const changes = Array.isArray(d.changes) ? (d.changes as { field?: string }[]) : null;
    if (changes) {
      if (changes.some((c) => c?.field === "owner_id")) ownerAssigned = { by, at: e.createdAt };
      continue; // změny polí zakázky (dodavatel, nákup…) nejsou úkonem objednávky
    }
    const poId = typeof d.purchaseOrderId === "string" ? d.purchaseOrderId : null;
    if (e.type === "quote" && typeof d.supplierQuoteId === "string" && d.action === "selected") {
      quoteSelected.set(d.supplierQuoteId, { by, at: e.createdAt });
    }
    if (!poId || e.type === "quote") continue;
    let kind: PurchaseActKind | null = null;
    if (e.type === "email") kind = "odeslana_email";
    else if (e.type === "field") {
      if (Array.isArray(d.fields)) kind = typeof d.statusTo === "string" ? STATUS_ACT[d.statusTo] ?? "upravena" : "upravena";
      else if (typeof d.number === "string") kind = "vystavena";
    }
    if (!kind) continue;
    const list = orders.get(poId) ?? [];
    list.push({ kind, verb: PURCHASE_ACT_VERBS[kind], by, at: e.createdAt });
    orders.set(poId, list);
  }
  return { orders, quoteSelected, ownerAssigned };
}

/** Úkony objednávky; bez historie aspoň „Vystavil" z autora objednávky. */
export function orderActs(
  po: Pick<PurchaseOrderView, "id" | "createdBy" | "createdAt">,
  activity: PurchaseActivity | null,
): PurchaseAct[] {
  const acts = activity?.orders.get(po.id) ?? [];
  if (acts.some((a) => a.kind === "vystavena")) return acts;
  return [{ kind: "vystavena", verb: PURCHASE_ACT_VERBS.vystavena, by: po.createdBy?.name ?? null, at: po.createdAt }, ...acts];
}
