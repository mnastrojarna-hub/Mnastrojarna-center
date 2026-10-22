import type { JobStage } from "@/lib/supabase/database.types";
import type {
  CaptureDocKind, DocIssuer, ExtractedBusinessDoc, ExtractedItem,
} from "@/lib/jobs/capture-types";
import type { JobDetail, JobInput, JobItem, JobItemInput } from "@/lib/jobs/types";
import { isForward } from "@/lib/jobs/stages";
import { docNumbersEqual, isSupplierSideDoc, normalizeCompanyName } from "@/lib/jobs/matching";

/**
 * „Vyfoť doklad → zakázka se vyplní sama" — čistá logika, CO se do zakázky zapíše.
 * Zápis do DB dělá capture route; tady jen plán:
 *  * vyplňují se POUZE prázdná pole (ruční údaje člověka se nikdy nepřepisují),
 *  * stav se posouvá jen dopředu a nikdy ze speciálního stavu (pozastaveno, reklamace…),
 *  * `filledColumns` = sloupce tabulky orders — route je uloží do události „ai",
 *    aby se pozdější ruční oprava těchto polí dala zapsat jako AI korekce.
 */

// ── Stav podle dokladu ──────────────────────────────────────

const STAGE_BY_DOC: Record<CaptureDocKind, Partial<Record<DocIssuer, JobStage>>> = {
  // poptávka od zákazníka; naše poptávka dodavateli = právě naceňujeme
  poptavka: { zakaznik: "poptavka", neznamy: "poptavka", my: "naceneni" },
  // naše nabídka odešla; nabídka dodavatele = naceňujeme
  nabidka: { my: "nabidka", dodavatel: "naceneni" },
  // objednávka zákazníka (naše objednávka u dodavatele stav nemění)
  objednavka: { zakaznik: "objednavka", neznamy: "objednavka" },
  // naše potvrzení zákazníkovi / dodavatel potvrdil naši objednávku → vyrábí se
  potvrzeni: { my: "potvrzeno", dodavatel: "ve_vyrobe" },
  dodaci_list: { dodavatel: "dodano_k_nam", my: "dodano_zakaznikovi" },
  // faktura dodavatele stav zakázky nemění
  faktura: { my: "fakturovano" },
  vykres: {},
  ostatni: {},
};

/** Do jakého stavu doklad zakázku posouvá (null = stav neměnit). Neznámý vystavitel = opatrně. */
export function docKindToStage(kind: CaptureDocKind, issuer: DocIssuer): JobStage | null {
  return STAGE_BY_DOC[kind]?.[issuer] ?? null;
}

// ── Popisky polí (stejné znění jako komentáře v migraci) ────

type PlanField = keyof JobInput & (
  | "title" | "customerName" | "customerOrderNumber" | "customerInquiryNumber"
  | "customerContact" | "customerContactEmail" | "customerContactPhone"
  | "inquiryDate" | "orderDate" | "customerRequiredDate" | "dueDate"
  | "expectedDeliveryDate" | "supplierPromisedDate" | "supplierOrderNumber"
  | "invoiceNumber" | "deliveryNoteNumber" | "value" | "purchaseCost"
  | "currency" | "deliveryMethod"
);

const FIELD_META: Record<PlanField, { column: string; label: string }> = {
  title: { column: "title", label: "Název zakázky" },
  customerName: { column: "customer_id", label: "Zákazník" },
  customerOrderNumber: { column: "customer_order_number", label: "Číslo objednávky zákazníka" },
  customerInquiryNumber: { column: "customer_inquiry_number", label: "Číslo poptávky zákazníka" },
  customerContact: { column: "customer_contact", label: "Kontaktní osoba u zákazníka" },
  customerContactEmail: { column: "customer_contact_email", label: "E-mail kontaktní osoby" },
  customerContactPhone: { column: "customer_contact_phone", label: "Telefon kontaktní osoby" },
  inquiryDate: { column: "inquiry_date", label: "Datum poptávky" },
  orderDate: { column: "order_date", label: "Datum objednávky zákazníka" },
  customerRequiredDate: { column: "customer_required_date", label: "Požadovaný termín zákazníkem" },
  dueDate: { column: "due_date", label: "Potvrzený termín dodání zákazníkovi" },
  expectedDeliveryDate: { column: "expected_delivery_date", label: "Předpokládaný termín dodání" },
  supplierPromisedDate: { column: "supplier_promised_date", label: "Slíbený termín od dodavatele" },
  supplierOrderNumber: { column: "supplier_order_number", label: "Naše objednávka u dodavatele" },
  invoiceNumber: { column: "invoice_number", label: "Číslo faktury" },
  deliveryNoteNumber: { column: "delivery_note_number", label: "Číslo dodacího listu" },
  value: { column: "value", label: "Hodnota zakázky" },
  purchaseCost: { column: "purchase_cost", label: "Nákupní náklady" },
  currency: { column: "currency", label: "Měna" },
  deliveryMethod: { column: "delivery_method", label: "Způsob dodání" },
};

/** Popisek a sloupec pole plánu (pro UI a události). */
export function planFieldMeta(field: string): { column: string; label: string } | null {
  return (FIELD_META as Record<string, { column: string; label: string }>)[field] ?? null;
}

// ── Plán úpravy existující zakázky ──────────────────────────

export type JobSnapshot = Pick<
  JobDetail,
  | "stage" | "title" | "customer" | "customerOrderNumber" | "customerInquiryNumber"
  | "customerContact" | "customerContactEmail" | "customerContactPhone"
  | "inquiryDate" | "orderDate" | "customerRequiredDate" | "dueDate"
  | "expectedDeliveryDate" | "supplierPromisedDate" | "value" | "items"
  | "supplier" | "supplierOrderNumber" | "invoiceNumber" | "deliveryNoteNumber"
>;

export interface JobItemUpdate {
  id: string;
  patch: Partial<JobItemInput>;
}

export interface JobUpdatePlan {
  /** Jen pole k vyplnění (stav NENÍ v patchi — viz stageTo). */
  patch: JobInput;
  newItems: JobItemInput[];
  itemUpdates: JobItemUpdate[];
  /** Nový stav (jen posun dopředu), null = neměnit. */
  stageTo: JobStage | null;
  /** České popisky doplněných údajů (pro toast / historii). */
  filled: string[];
  /** Doplněné sloupce tabulky orders (pro událost „ai" a pozdější AI korekce). */
  filledColumns: string[];
}

function isEmpty(v: unknown): boolean {
  return v == null || (typeof v === "string" && v.trim() === "") || (typeof v === "number" && v === 0);
}

/** Klíč položky pro párování podle názvu (bez výkresu). */
function nameKey(v: string | null | undefined): string {
  return normalizeCompanyName(v ?? "");
}

function sameItem(a: { drawingNumber?: string | null; name?: string | null }, b: { drawingNumber?: string | null; name?: string | null }): boolean {
  if (a.drawingNumber && b.drawingNumber) return docNumbersEqual(a.drawingNumber, b.drawingNumber);
  if (!a.drawingNumber && !b.drawingNumber) {
    const ka = nameKey(a.name);
    return Boolean(ka) && ka === nameKey(b.name);
  }
  return false;
}


/** Název zakázky z první položky („Upínka frézovaná VK-2291 + 1 další"). */
function titleFromItems(items: ExtractedItem[]): string {
  const first = items[0];
  if (!first) return "";
  const base = [first.name, first.drawingNumber].filter(Boolean).join(" ") || first.description;
  if (!base) return "";
  const rest = items.length - 1;
  return clip(rest > 0 ? `${base} + ${rest} další` : base, 120);
}

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Položka dokladu → vstup položky zakázky (u dodavatelských dokladů je cena nákupní). */
function toItemInput(item: ExtractedItem, purchase: boolean): JobItemInput {
  const out: JobItemInput = { quantity: item.quantity, unit: item.unit || "ks" };
  if (item.drawingNumber) out.drawingNumber = item.drawingNumber;
  if (item.revision) out.revision = item.revision;
  if (item.name) out.name = item.name;
  if (item.description) out.description = item.description;
  if (item.material) out.material = item.material;
  if (item.unitPrice > 0) {
    if (purchase) out.purchaseUnitPrice = item.unitPrice;
    else out.unitPrice = item.unitPrice;
  }
  if (item.deliveryDate) out.note = `Termín položky ${item.deliveryDate}`;
  return out;
}

/** Doplní prázdné údaje existující položky z položky dokladu. */
function itemPatch(current: JobItem, item: ExtractedItem, purchase: boolean): Partial<JobItemInput> {
  const p: Partial<JobItemInput> = {};
  if (isEmpty(current.quantity) && item.quantity > 0) p.quantity = item.quantity;
  if (item.unitPrice > 0) {
    if (purchase && isEmpty(current.purchaseUnitPrice)) p.purchaseUnitPrice = item.unitPrice;
    if (!purchase && isEmpty(current.unitPrice)) p.unitPrice = item.unitPrice;
  }
  if (isEmpty(current.material) && item.material) p.material = item.material;
  if (isEmpty(current.name) && item.name) p.name = item.name;
  if (isEmpty(current.revision) && item.revision) p.revision = item.revision;
  return p;
}

/** Součet položek, pokud mají všechny cenu (jinak 0). */
function itemsTotal(items: ExtractedItem[]): number {
  if (!items.length || items.some((i) => !(i.unitPrice > 0) || !(i.quantity > 0))) return 0;
  return Math.round(items.reduce((s, i) => s + i.unitPrice * i.quantity, 0) * 100) / 100;
}

/**
 * Co z dokladu doplnit do existující zakázky. Vyplňuje jen prázdná pole,
 * položky slučuje podle čísla výkresu (bez výkresu podle názvu).
 *
 * Doklad zákazníka / náš: čísla objednávky a poptávky zákazníka, kontakt, data
 * (objednávka → datum objednávky, poptávka → datum poptávky, požadovaný termín),
 * naše potvrzení → potvrzený termín, naše nabídka → předpokládaný termín,
 * náš DL / faktura → jejich čísla, hodnota z nabídky / objednávky / potvrzení.
 * Dodavatelský doklad: naše objednávka u dodavatele, potvrzení → slíbený termín
 * dodavatele, ceny položek jako nákupní; neznámé položky se nepřidávají
 * (dodávka může obsahovat díly jiných zakázek).
 */
export function planJobUpdate(job: JobSnapshot, doc: ExtractedBusinessDoc): JobUpdatePlan {
  const patch: JobInput = {};
  const filled: string[] = [];
  const filledColumns: string[] = [];
  const current = job as unknown as Record<string, unknown>;

  const fill = (field: PlanField, value: string | number | null | undefined) => {
    if (value == null || isEmpty(value)) return;
    if (field in current && !isEmpty(current[field])) return;
    if (field in patch) return;
    (patch as Record<string, unknown>)[field] = value;
    filled.push(FIELD_META[field].label);
    filledColumns.push(FIELD_META[field].column);
  };

  const supplierSide = isSupplierSideDoc(doc);
  const fromCustomer = doc.issuer === "zakaznik" || doc.issuer === "neznamy";
  const ours = doc.issuer === "my";

  if (!supplierSide) {
    fill("customerOrderNumber", doc.customerOrderNumber);
    fill("customerInquiryNumber", doc.customerInquiryNumber);
    fill("customerContact", doc.customer.contactPerson);
    fill("customerContactEmail", doc.customer.email);
    fill("customerContactPhone", doc.customer.phone);

    if (fromCustomer) {
      if (doc.docKind === "objednavka") fill("orderDate", doc.documentDate);
      if (doc.docKind === "poptavka") fill("inquiryDate", doc.documentDate);
      fill("customerRequiredDate", doc.requiredDeliveryDate);
    }
    if (ours) {
      if (doc.docKind === "potvrzeni") fill("dueDate", doc.promisedDeliveryDate);
      if (doc.docKind === "nabidka") fill("expectedDeliveryDate", doc.promisedDeliveryDate);
      if (doc.docKind === "dodaci_list") fill("deliveryNoteNumber", doc.documentNumber);
      if (doc.docKind === "faktura") fill("invoiceNumber", doc.documentNumber);
    }
    if (doc.docKind === "nabidka" || doc.docKind === "objednavka" || doc.docKind === "potvrzeni") {
      fill("value", doc.totalWithoutVat || itemsTotal(doc.items));
    }
  } else {
    const ourPo = doc.customerOrderNumber
      || (ours && doc.docKind === "objednavka" ? doc.documentNumber : "");
    fill("supplierOrderNumber", ourPo);
    if (doc.issuer === "dodavatel" && doc.docKind === "potvrzeni") {
      fill("supplierPromisedDate", doc.promisedDeliveryDate);
    }
  }

  fill("title", titleFromItems(doc.items));

  // Položky
  const newItems: JobItemInput[] = [];
  const updates = new Map<string, Partial<JobItemInput>>();
  const existing = job.items ?? [];
  for (const item of doc.items) {
    // duplicitní řádek na dokladu
    if (newItems.some((n) => sameItem(n, item))) continue;
    const match = existing.find((e) => sameItem(e, item));
    if (match) {
      const p = itemPatch(match, item, supplierSide);
      if (Object.keys(p).length) updates.set(match.id, { ...p, ...(updates.get(match.id) ?? {}) });
    } else if (!existing.length || !supplierSide) {
      newItems.push(toItemInput(item, supplierSide));
    }
  }
  const itemUpdates = [...updates].map(([id, p]) => ({ id, patch: p }));
  if (newItems.length) filled.push(`${newItems.length === 1 ? "Nová položka" : "Nové položky"} (${newItems.length})`);
  if (itemUpdates.length) filled.push(`${itemUpdates.length === 1 ? "Doplněná položka" : "Doplněné položky"} (${itemUpdates.length})`);

  // Stav jen dopředu (isForward vrací false pro speciální stavy)
  const target = docKindToStage(doc.docKind, doc.issuer);
  const stageTo = target && isForward(job.stage, target) ? target : null;

  return { patch, newItems, itemUpdates, stageTo, filled, filledColumns };
}

// ── Nová zakázka z dokladu ──────────────────────────────────

export interface NewJobPlan {
  /** Vstup pro založení zakázky (customerId doplní route podle matchCustomer). */
  input: JobInput;
  items: JobItemInput[];
  filled: string[];
  filledColumns: string[];
}

const EMPTY_SNAPSHOT: JobSnapshot = {
  stage: "poptavka", title: "", customer: null,
  customerOrderNumber: null, customerInquiryNumber: null,
  customerContact: null, customerContactEmail: null, customerContactPhone: null,
  inquiryDate: null, orderDate: null, customerRequiredDate: null, dueDate: null,
  expectedDeliveryDate: null, supplierPromisedDate: null, value: null, items: [],
  supplier: null, supplierOrderNumber: null, invoiceNumber: null, deliveryNoteNumber: null,
};

/**
 * Všechny údaje zakázky, které z dokladu plynou (bez ohledu na to, co zakázka už má) —
 * pro kontrolní formulář: „na dokladu je jiný termín, než má zakázka".
 */
export function docFieldValues(doc: ExtractedBusinessDoc): JobInput {
  return planJobUpdate(EMPTY_SNAPSHOT, doc).patch;
}

const KIND_TITLE: Record<CaptureDocKind, string> = {
  poptavka: "Poptávka", nabidka: "Nabídka", objednavka: "Objednávka", potvrzeni: "Potvrzení objednávky",
  dodaci_list: "Dodací list", faktura: "Faktura", vykres: "Výkres", ostatni: "Doklad",
};

/**
 * Zakázka z dokladu, ke kterému žádná existující nesedí. Stav podle dokladu
 * (jinak poptávka), název z první položky / shrnutí, hodnota z celkové částky
 * (u dodavatelského dokladu jako nákupní náklady).
 */
export function planNewJob(doc: ExtractedBusinessDoc): NewJobPlan {
  const base = planJobUpdate(EMPTY_SNAPSHOT, doc);
  const input: JobInput = { ...base.patch };
  const filled = [...base.filled];
  const filledColumns = [...base.filledColumns];
  const add = (field: PlanField, value: string | number | undefined) => {
    if (value == null || isEmpty(value) || (input as Record<string, unknown>)[field] != null) return;
    (input as Record<string, unknown>)[field] = value;
    filled.push(FIELD_META[field].label);
    filledColumns.push(FIELD_META[field].column);
  };

  const supplierSide = isSupplierSideDoc(doc);
  input.stage = docKindToStage(doc.docKind, doc.issuer) ?? "poptavka";

  if (!input.title) {
    const firstLine = doc.summary.split("\n")[0] ?? "";
    const sentence = firstLine.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? firstLine;
    const byKind = doc.documentNumber
      ? `${KIND_TITLE[doc.docKind]} ${doc.documentNumber}`
      : doc.docKind !== "ostatni" ? KIND_TITLE[doc.docKind] : "";
    const fallback = sentence.replace(/[.!?]$/, "") || byKind;
    add("title", clip(fallback || "Nová zakázka z dokladu", 120));
  }
  add("customerName", doc.customer.name);
  const total = doc.totalWithoutVat || itemsTotal(doc.items);
  if (supplierSide) add("purchaseCost", total);
  else add("value", total);
  add("currency", doc.currency);
  add("deliveryMethod", doc.deliveryTerms);

  return { input, items: base.newItems, filled, filledColumns };
}
