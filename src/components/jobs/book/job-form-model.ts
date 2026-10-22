import type { JobStage, PriorityLevel } from "@/lib/supabase/database.types";
import type { JobFormOptions, JobInput, JobItemInput } from "@/lib/jobs/types";
import { isJobStage } from "@/lib/jobs/stages";

/**
 * Model formuláře zakázky: stav formuláře (vše jako text), převod z/do JobInput
 * a kontrola s českými hláškami. Čistá logika (testy v job-form-model.test.ts).
 */

export type JobFormValues = JobInput & { items: JobItemInput[] };
export type JobFormInitial = Partial<JobInput & { items: JobItemInput[] }>;

export interface ItemDraft {
  key: string;
  id?: string;
  drawingNumber: string;
  revision: string;
  name: string;
  material: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  purchaseUnitPrice: string;
  /** Průchozí (formulář je neukazuje, ale neztratí). */
  description: string;
  note: string;
}

export type DateField =
  | "inquiryDate" | "orderDate" | "customerRequiredDate" | "dueDate"
  | "expectedDeliveryDate" | "supplierPromisedDate" | "maxToleratedDate";

export interface JobFormState {
  title: string;
  stage: JobStage;
  priority: PriorityLevel;
  customerMode: "existing" | "new";
  customerId: string;
  customerName: string;
  customerOrderNumber: string;
  customerInquiryNumber: string;
  inquiryDate: string;
  orderDate: string;
  customerRequiredDate: string;
  dueDate: string;
  expectedDeliveryDate: string;
  supplierPromisedDate: string;
  maxToleratedDate: string;
  ownerId: string;
  assigneeId: string;
  supplierId: string;
  supplierOrderNumber: string;
  note: string;
  items: ItemDraft[];
}

export type JobFormErrors = Record<string, string>;

export const DATE_FIELDS: { key: DateField; label: string; hint: string }[] = [
  { key: "inquiryDate", label: "Datum poptávky", hint: "kdy zákazník poptal" },
  { key: "orderDate", label: "Datum objednávky", hint: "kdy zákazník objednal" },
  { key: "customerRequiredDate", label: "Požadovaný termín zákazníkem", hint: "co chce zákazník" },
  { key: "dueDate", label: "Potvrzený termín zákazníkovi", hint: "co jsme slíbili — hlídá se" },
  { key: "expectedDeliveryDate", label: "Předpokládaný termín dodání", hint: "náš odhad" },
  { key: "supplierPromisedDate", label: "Slíbený termín dodavatele", hint: "kdy to dodá dodavatel" },
  { key: "maxToleratedDate", label: "Max. tolerovaný termín", hint: "poslední záchrana" },
];

export const PRIORITIES: { key: PriorityLevel; label: string }[] = [
  { key: "nizka", label: "Nízká" },
  { key: "stredni", label: "Střední" },
  { key: "vysoka", label: "Vysoká" },
];

export const UNITS = ["ks", "sada", "kg", "m", "m²", "hod", "kpl"];

export const MAX_TITLE = 300;
const MAX_DOC_NUMBER = 120;

let keySeq = 0;
function nextKey(): string {
  keySeq += 1;
  return `it-${keySeq}`;
}

export function emptyItem(): ItemDraft {
  return {
    key: nextKey(), drawingNumber: "", revision: "", name: "", material: "", quantity: "1", unit: "ks",
    unitPrice: "", purchaseUnitPrice: "", description: "", note: "",
  };
}

/** Číslo z formuláře: „1 234,5" → 1234.5; prázdné → null; nesmysl → NaN. */
export function parseDecimal(raw: string | null | undefined): number | null {
  const s = (raw ?? "").replace(/[\s  ]/g, "").replace(",", ".");
  if (!s) return null;
  if (!/^-?\d+(\.\d+)?$/.test(s) && !/^-?\.\d+$/.test(s)) return Number.NaN;
  return Number(s);
}

/** Číslo → text do pole (desetinná čárka). */
export function formatDecimalInput(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return String(n).replace(".", ",");
}

function dateOnly(v: string | null | undefined): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v ?? "");
  return m ? m[1] : "";
}

function text(v: string | null | undefined): string {
  return typeof v === "string" ? v : "";
}

export function itemFromInput(it: JobItemInput): ItemDraft {
  return {
    key: nextKey(),
    id: it.id,
    drawingNumber: text(it.drawingNumber),
    revision: text(it.revision),
    name: text(it.name),
    material: text(it.material),
    quantity: formatDecimalInput(it.quantity) || "1",
    unit: text(it.unit) || "ks",
    unitPrice: formatDecimalInput(it.unitPrice ?? null),
    purchaseUnitPrice: formatDecimalInput(it.purchaseUnitPrice ?? null),
    description: text(it.description),
    note: text(it.note),
  };
}

/** Výchozí stav formuláře z předvyplněných hodnot. */
export function initialFormState(initial: JobFormInitial = {}, defaults: { stage?: JobStage; ownerId?: string } = {}): JobFormState {
  const stage = isJobStage(initial.stage) ? initial.stage : defaults.stage ?? "objednavka";
  const customerId = text(initial.customerId ?? "");
  const customerName = text(initial.customerName);
  return {
    title: text(initial.title),
    stage,
    priority: initial.priority === "nizka" || initial.priority === "vysoka" ? initial.priority : "stredni",
    customerMode: customerId || !customerName ? "existing" : "new",
    customerId,
    customerName,
    customerOrderNumber: text(initial.customerOrderNumber),
    customerInquiryNumber: text(initial.customerInquiryNumber),
    inquiryDate: dateOnly(initial.inquiryDate),
    orderDate: dateOnly(initial.orderDate),
    customerRequiredDate: dateOnly(initial.customerRequiredDate),
    dueDate: dateOnly(initial.dueDate),
    expectedDeliveryDate: dateOnly(initial.expectedDeliveryDate),
    supplierPromisedDate: dateOnly(initial.supplierPromisedDate),
    maxToleratedDate: dateOnly(initial.maxToleratedDate),
    ownerId: text(initial.ownerId ?? "") || defaults.ownerId || "",
    assigneeId: text(initial.assigneeId ?? ""),
    supplierId: text(initial.supplierId ?? ""),
    supplierOrderNumber: text(initial.supplierOrderNumber),
    note: text(initial.note),
    items: (initial.items ?? []).map(itemFromInput),
  };
}

/** Prázdný řádek položky se při uložení zahodí. */
export function isItemEmpty(it: ItemDraft): boolean {
  return ![it.drawingNumber, it.revision, it.name, it.material, it.unitPrice, it.purchaseUnitPrice, it.description, it.note]
    .some((v) => v.trim() !== "");
}

/** Řádek celkem (null = bez ceny nebo neplatné číslo). */
export function lineTotal(qty: string, price: string): number | null {
  const q = parseDecimal(qty);
  const p = parseDecimal(price);
  if (q === null || p === null || Number.isNaN(q) || Number.isNaN(p)) return null;
  return Math.round(q * p * 100) / 100;
}

export function formTotals(items: ItemDraft[], margins: boolean): { value: number | null; purchase: number | null } {
  let value: number | null = null;
  let purchase: number | null = null;
  for (const it of items) {
    if (isItemEmpty(it)) continue;
    const v = lineTotal(it.quantity, it.unitPrice);
    if (v !== null) value = (value ?? 0) + v;
    if (margins) {
      const p = lineTotal(it.quantity, it.purchaseUnitPrice);
      if (p !== null) purchase = (purchase ?? 0) + p;
    }
  }
  const r = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);
  return { value: r(value), purchase: r(purchase) };
}

function normalizeName(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Existující zákazník se stejným názvem (nápověda u „Nový zákazník"). */
export function findSameCustomer(options: JobFormOptions["customers"], name: string) {
  const n = normalizeName(name);
  if (!n) return null;
  return options.find((c) => normalizeName(c.name) === n) ?? null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Kontrola + převod na hodnoty pro createJob / updateJob. Prázdná pole jsou ""
 * (= vymazat, viz JobInput); prázdné řádky položek se vynechají.
 */
export function validateJobForm(
  state: JobFormState,
  opts: { margins: boolean; requireCustomer?: boolean },
): { values: JobFormValues | null; errors: JobFormErrors } {
  const errors: JobFormErrors = {};
  const requireCustomer = opts.requireCustomer ?? true;

  const items = state.items.filter((it) => !isItemEmpty(it));
  const title = state.title.trim();
  if (!title && !items.some((it) => it.name.trim() || it.drawingNumber.trim())) {
    errors.title = "Napiš název zakázky (nebo vyplň aspoň jednu položku).";
  } else if (title.length > MAX_TITLE) {
    errors.title = `Název je moc dlouhý (max. ${MAX_TITLE} znaků).`;
  }

  if (state.customerMode === "existing") {
    if (requireCustomer && !state.customerId) errors.customer = "Vyber zákazníka, nebo založ nového.";
  } else {
    const name = state.customerName.trim();
    if (!name) errors.customer = "Napiš název nového zákazníka.";
    else if (name.length < 2) errors.customer = "Název zákazníka je moc krátký.";
    else if (name.length > 300) errors.customer = "Název zákazníka je moc dlouhý.";
  }

  if (state.customerOrderNumber.trim().length > MAX_DOC_NUMBER) errors.customerOrderNumber = "Číslo je moc dlouhé.";
  if (state.customerInquiryNumber.trim().length > MAX_DOC_NUMBER) errors.customerInquiryNumber = "Číslo je moc dlouhé.";
  if (state.supplierOrderNumber.trim().length > MAX_DOC_NUMBER) errors.supplierOrderNumber = "Číslo je moc dlouhé.";

  for (const f of DATE_FIELDS) {
    const v = state[f.key].trim();
    if (v && !DATE_RE.test(v)) errors[f.key] = "Neplatné datum.";
  }
  const deadline = state.dueDate || state.customerRequiredDate;
  if (!errors.maxToleratedDate && state.maxToleratedDate && deadline && DATE_RE.test(deadline) && state.maxToleratedDate < deadline) {
    errors.maxToleratedDate = "Max. tolerovaný termín nemůže být dřív než termín pro zákazníka.";
  }

  const outItems: JobItemInput[] = [];
  state.items.forEach((it, i) => {
    if (isItemEmpty(it)) return;
    const q = parseDecimal(it.quantity);
    if (q === null || Number.isNaN(q) || q <= 0 || q > 1e9) errors[`items.${i}.quantity`] = "Množství musí být číslo větší než 0.";
    const up = parseDecimal(it.unitPrice);
    if (up !== null && (Number.isNaN(up) || up < 0 || up > 1e11)) errors[`items.${i}.unitPrice`] = "Cena musí být kladné číslo (nebo nech prázdné).";
    const pp = opts.margins ? parseDecimal(it.purchaseUnitPrice) : null;
    if (pp !== null && (Number.isNaN(pp) || pp < 0 || pp > 1e11)) errors[`items.${i}.purchaseUnitPrice`] = "Cena musí být kladné číslo (nebo nech prázdné).";
    const item: JobItemInput = {
      drawingNumber: it.drawingNumber.trim(),
      revision: it.revision.trim(),
      name: it.name.trim(),
      material: it.material.trim(),
      quantity: q !== null && !Number.isNaN(q) ? q : 0,
      unit: it.unit.trim() || "ks",
      unitPrice: up !== null && !Number.isNaN(up) ? up : null,
    };
    if (it.id) item.id = it.id;
    if (it.description.trim()) item.description = it.description.trim();
    if (it.note.trim()) item.note = it.note.trim();
    if (opts.margins) item.purchaseUnitPrice = pp !== null && !Number.isNaN(pp) ? pp : null;
    outItems.push(item);
  });

  if (Object.keys(errors).length) return { values: null, errors };

  const values: JobFormValues = {
    title,
    stage: state.stage,
    priority: state.priority,
    customerOrderNumber: state.customerOrderNumber.trim(),
    customerInquiryNumber: state.customerInquiryNumber.trim(),
    inquiryDate: state.inquiryDate,
    orderDate: state.orderDate,
    customerRequiredDate: state.customerRequiredDate,
    dueDate: state.dueDate,
    expectedDeliveryDate: state.expectedDeliveryDate,
    supplierPromisedDate: state.supplierPromisedDate,
    maxToleratedDate: state.maxToleratedDate,
    ownerId: state.ownerId || null,
    assigneeId: state.assigneeId || null,
    supplierId: state.supplierId || null,
    supplierOrderNumber: state.supplierOrderNumber.trim(),
    note: state.note.trim(),
    items: outItems,
  };
  if (state.customerMode === "existing") values.customerId = state.customerId || null;
  else values.customerName = state.customerName.trim();
  return { values, errors };
}

/** První chybné pole (kvůli posunu a zaměření). */
export function firstErrorKey(errors: JobFormErrors): string | null {
  const order = [
    "title", "customer", "customerOrderNumber", "customerInquiryNumber",
    ...DATE_FIELDS.map((d) => d.key), "supplierOrderNumber",
  ];
  for (const k of order) if (errors[k]) return k;
  const rest = Object.keys(errors).sort();
  return rest[0] ?? null;
}
