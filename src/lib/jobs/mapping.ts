import type {
  JobStage, JobFileKind, JobSource, PriorityLevel, QuoteStatus,
} from "@/lib/supabase/database.types";
import type {
  JobInput, JobItemInput, JobQuoteItemInput, JobQuoteInput, JobListItem, JobDetail, JobItem,
  JobQuote, JobQuoteItem, JobFile, JobEvent, JobEventType, JobFilters, JobCustomerDetail,
  JobCustomerRef, PersonRef, JobSort, JobPaymentFilter,
} from "@/lib/jobs/types";
import { STAGE_ORDER, CLOSED_STAGES, isJobStage, stageGroup, STAGES } from "@/lib/jobs/stages";
import { isJobFileKind } from "@/lib/jobs/file-kinds";
import { isOperationKind } from "@/lib/jobs/operations";
import { effectiveDeadline, deadlineInfo, type DeadlineInput } from "@/lib/jobs/deadlines";
import { fieldLabel, formatFieldValue, SENSITIVE_JOB_COLUMNS } from "@/lib/jobs/field-labels";

/**
 * Mapování Knihy zakázek: vstup formuláře → sloupce orders, řádky DB → view-modely,
 * filtry, řazení, diff změn. Čistá logika bez DB (testy v mapping.test.ts).
 */

// ── Základní normalizace ────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/** Ořízne text; prázdný → null. */
export function cleanText(v: unknown, max = 5000): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

/** Platné datum RRRR-MM-DD (z ISO času vezme datum), jinak null. */
export function cleanDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(v.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  if (y < 1900 || y > 2200) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Konečné číslo nebo null (přijme i „12 500,50" z formuláře). */
export function cleanNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const s = v.replace(/[\s ]/g, "").replace(",", ".");
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Peníze: konečné, zaokrouhlené na haléře, jinak null. */
export function cleanMoney(v: unknown): number | null {
  const n = cleanNumber(v);
  return n === null ? null : round2(n);
}

/** Množství — DB ukládá numeric(12,3) (ks, kg, m…); na 3 desetinná místa, minimum 0,001. */
export function cleanQuantity(v: unknown): number {
  const n = cleanNumber(v);
  if (n === null || n <= 0) return 1;
  return Math.max(0.001, Math.round(n * 1000) / 1000);
}

const PRIORITIES: PriorityLevel[] = ["nizka", "stredni", "vysoka"];
const SOURCES: JobSource[] = ["manual", "foto", "email", "import", "ai"];
export const QUOTE_STATUSES: QuoteStatus[] = ["navrh_ai", "ke_schvaleni", "odeslano", "prijato", "zamitnuto"];

export function isPriority(v: unknown): v is PriorityLevel {
  return typeof v === "string" && (PRIORITIES as string[]).includes(v);
}
export function isJobSource(v: unknown): v is JobSource {
  return typeof v === "string" && (SOURCES as string[]).includes(v);
}
export function isQuoteStatus(v: unknown): v is QuoteStatus {
  return typeof v === "string" && (QUOTE_STATUSES as string[]).includes(v);
}

export function cleanCurrency(v: unknown): string {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  return /^[A-Z]{3}$/.test(s) ? s : "CZK";
}

export function cleanTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const t of v) {
    const s = cleanText(t, 60);
    if (s && !out.includes(s)) out.push(s);
  }
  return out.slice(0, 30);
}

/** Dnešní datum RRRR-MM-DD v pražském čase. */
export function todayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague" }).format(now);
}

// ── Vstup formuláře → sloupce orders ────────────────────────
const TEXT_FIELDS: [keyof JobInput, string, number][] = [
  ["title", "title", 300],
  ["customerOrderNumber", "customer_order_number", 120],
  ["customerInquiryNumber", "customer_inquiry_number", 120],
  ["customerContact", "customer_contact", 200],
  ["customerContactEmail", "customer_contact_email", 200],
  ["customerContactPhone", "customer_contact_phone", 60],
  ["supplierOrderNumber", "supplier_order_number", 120],
  ["technology", "technology", 300],
  ["manufacturingLocation", "manufacturing_location", 300],
  ["specificRequirements", "specific_requirements", 5000],
  ["deliveryMethod", "delivery_method", 300],
  ["note", "note", 10000],
  ["invoiceNumber", "invoice_number", 120],
  ["deliveryNoteNumber", "delivery_note_number", 120],
];

const DATE_FIELDS: [keyof JobInput, string][] = [
  ["inquiryDate", "inquiry_date"],
  ["orderDate", "order_date"],
  ["customerRequiredDate", "customer_required_date"],
  ["dueDate", "due_date"],
  ["expectedDeliveryDate", "expected_delivery_date"],
  ["supplierPromisedDate", "supplier_promised_date"],
  ["maxToleratedDate", "max_tolerated_date"],
];

const ID_FIELDS: [keyof JobInput, string][] = [
  ["customerId", "customer_id"],
  ["ownerId", "owner_id"],
  ["assigneeId", "assignee_id"],
  ["pricedById", "priced_by"],
  ["supplierId", "supplier_id"],
];

const MONEY_FIELDS: [keyof JobInput, string][] = [
  ["value", "value"],
  ["purchaseCost", "purchase_cost"],
];

/**
 * JobInput (camelCase) → sloupce orders. Mapuje jen klíče přítomné ve vstupu
 * (undefined = beze změny), "" → null, neplatné datum / číslo / id → null.
 * customerName není sloupec — řeší ho akce.
 */
export function jobInputToRow(input: JobInput): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  const has = (k: keyof JobInput) => Object.prototype.hasOwnProperty.call(input, k) && input[k] !== undefined;

  for (const [key, col, max] of TEXT_FIELDS) if (has(key)) row[col] = cleanText(input[key], max);
  for (const [key, col] of DATE_FIELDS) if (has(key)) row[col] = cleanDate(input[key]);
  for (const [key, col] of ID_FIELDS) if (has(key)) row[col] = isUuid(input[key]) ? input[key] : null;
  for (const [key, col] of MONEY_FIELDS) if (has(key)) row[col] = cleanMoney(input[key]);

  if (has("stage") && isJobStage(input.stage)) row.status = input.stage;
  if (has("priority") && isPriority(input.priority)) row.priority = input.priority;
  if (has("currency")) row.currency = cleanCurrency(input.currency);
  if (has("tags")) row.tags = cleanTags(input.tags);
  return row;
}

/** Kontrola vstupu před zápisem — vrací českou chybu nebo null. */
export function validateJobInput(input: JobInput): string | null {
  if (input.stage !== undefined && !isJobStage(input.stage)) return "Neznámý stav zakázky.";
  if (input.priority !== undefined && !isPriority(input.priority)) return "Neznámá priorita.";
  for (const [key, , max] of TEXT_FIELDS) {
    const v = input[key];
    if (v !== undefined && v !== null && typeof v !== "string") return `Pole „${fieldLabel(colOf(key))}" musí být text.`;
    if (typeof v === "string" && v.trim().length > max) return `Pole „${fieldLabel(colOf(key))}" je příliš dlouhé (max. ${max} znaků).`;
  }
  for (const [key, col] of DATE_FIELDS) {
    const v = input[key];
    if (v !== undefined && v !== null && v !== "" && cleanDate(v) === null) return `Neplatné datum v poli „${fieldLabel(col)}" (čekám RRRR-MM-DD).`;
  }
  for (const [key, col] of ID_FIELDS) {
    const v = input[key];
    if (v !== undefined && v !== null && v !== "" && !isUuid(v)) return `Neplatný výběr v poli „${fieldLabel(col)}".`;
  }
  for (const [key, col] of MONEY_FIELDS) {
    const v = input[key];
    if (v !== undefined && v !== null && (v as unknown) !== "" && cleanNumber(v) === null) return `Pole „${fieldLabel(col)}" musí být číslo.`;
    const n = cleanNumber(v);
    if (n !== null && (n < 0 || n > 1e12)) return `Pole „${fieldLabel(col)}" je mimo rozsah.`;
  }
  if (typeof input.customerContactEmail === "string" && input.customerContactEmail.trim() &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.customerContactEmail.trim())) {
    return "Neplatný e-mail kontaktní osoby.";
  }
  if (input.tags !== undefined && !Array.isArray(input.tags)) return "Štítky musí být seznam.";
  if (input.customerName !== undefined && typeof input.customerName !== "string") return "Název zákazníka musí být text.";
  return null;
}

function colOf(key: keyof JobInput): string {
  return TEXT_FIELDS.find(([k]) => k === key)?.[1] ?? String(key);
}

/** Kontrola položek (zakázky i nabídky). */
export function validateItems(items: unknown, max = 500): string | null {
  if (!Array.isArray(items)) return "Položky musí být seznam.";
  if (items.length > max) return `Příliš mnoho položek (max. ${max}).`;
  for (let i = 0; i < items.length; i++) {
    const it = items[i] as Record<string, unknown> | null;
    if (!it || typeof it !== "object") return `Položka ${i + 1} je neplatná.`;
    const q = cleanNumber(it.quantity);
    if (q === null || q <= 0 || q > 1e9) return `Položka ${i + 1}: množství musí být kladné číslo.`;
    for (const k of ["unitPrice", "purchaseUnitPrice"]) {
      const v = it[k];
      if (v !== undefined && v !== null && v !== "") {
        const n = cleanNumber(v);
        if (n === null || n < 0 || n > 1e11) return `Položka ${i + 1}: neplatná cena.`;
      }
    }
    if (it.vatRate !== undefined && it.vatRate !== null) {
      const n = cleanNumber(it.vatRate);
      if (n === null || n < 0 || n > 100) return `Položka ${i + 1}: neplatná sazba DPH.`;
    }
  }
  return null;
}

/** Položka zakázky → sloupce order_items (bez order_id). */
export function jobItemToRow(item: JobItemInput, position: number): Record<string, unknown> {
  return {
    position,
    drawing_number: cleanText(item.drawingNumber, 200),
    revision: cleanText(item.revision, 50),
    name: cleanText(item.name, 500),
    description: cleanText(item.description, 5000),
    material: cleanText(item.material, 200),
    quantity: cleanQuantity(item.quantity),
    unit: cleanText(item.unit, 20) ?? "ks",
    unit_price: cleanMoney(item.unitPrice),
    purchase_unit_price: cleanMoney(item.purchaseUnitPrice),
    note: cleanText(item.note, 2000),
  };
}

/** Položka nabídky → sloupce quote_items (bez quote_id). */
export function quoteItemToRow(item: JobQuoteItemInput, position: number): Record<string, unknown> {
  const vat = cleanNumber(item.vatRate);
  return {
    position,
    drawing_number: cleanText(item.drawingNumber, 200),
    name: cleanText(item.name, 500),
    description: cleanText(item.description, 5000),
    material: cleanText(item.material, 200),
    quantity: cleanQuantity(item.quantity),
    unit: cleanText(item.unit, 20) ?? "ks",
    unit_price: cleanMoney(item.unitPrice),
    vat_rate: vat !== null && vat >= 0 && vat <= 100 ? vat : 21,
    purchase_unit_price: cleanMoney(item.purchaseUnitPrice),
    note: cleanText(item.note, 2000),
  };
}

/** Hlavička nabídky → sloupce quotes (jen přítomné klíče, kromě položek). */
export function quoteInputToRow(input: Partial<JobQuoteInput>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  const has = (k: keyof JobQuoteInput) => Object.prototype.hasOwnProperty.call(input, k) && input[k] !== undefined;
  if (has("title")) row.title = cleanText(input.title, 300);
  if (has("status") && isQuoteStatus(input.status)) row.status = input.status;
  if (has("validUntil")) row.valid_until = cleanDate(input.validUntil);
  if (has("leadTimeDays")) {
    const n = cleanNumber(input.leadTimeDays);
    row.lead_time_days = n === null || n < 0 ? null : Math.min(3650, Math.round(n));
  }
  if (has("deliveryTerms")) row.delivery_terms = cleanText(input.deliveryTerms, 2000);
  if (has("paymentTerms")) row.payment_terms = cleanText(input.paymentTerms, 2000);
  if (has("note")) row.note = cleanText(input.note, 10000);
  if (has("currency")) row.currency = cleanCurrency(input.currency);
  return row;
}

/** Součty položek: prodejní hodnota a nákupní náklady (null = žádná cena nezadána). */
export function computeItemTotals(
  items: { quantity: number; unitPrice?: number | null; purchaseUnitPrice?: number | null }[],
): { value: number | null; purchaseCost: number | null } {
  let value: number | null = null;
  let purchaseCost: number | null = null;
  for (const it of items) {
    const q = cleanQuantity(it.quantity);
    const up = cleanNumber(it.unitPrice);
    const pp = cleanNumber(it.purchaseUnitPrice);
    if (up !== null) value = (value ?? 0) + q * up;
    if (pp !== null) purchaseCost = (purchaseCost ?? 0) + q * pp;
  }
  return {
    value: value === null ? null : round2(value),
    purchaseCost: purchaseCost === null ? null : round2(purchaseCost),
  };
}

// ── Diff změn ───────────────────────────────────────────────
export interface JobChange {
  field: string;
  label: string;
  from: unknown;
  to: unknown;
}

function normalizeForCompare(field: string, v: unknown): unknown {
  if (v === undefined || v === "") return null;
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (field.endsWith("_date") && typeof v === "string") return cleanDate(v) ?? v;
  if (typeof v === "string" && (field === "value" || field === "purchase_cost" || field === "ai_confidence")) {
    const n = cleanNumber(v);
    return n ?? v;
  }
  return v;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 0.005;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => x === b[i]);
  return false;
}

/** Rozdíl mezi současným řádkem a patchem (sloupce, české popisky). */
export function diffJob(before: Record<string, unknown>, patch: Record<string, unknown>): JobChange[] {
  const out: JobChange[] = [];
  for (const field of Object.keys(patch)) {
    const to = patch[field];
    if (to === undefined) continue;
    const a = normalizeForCompare(field, before[field]);
    const b = normalizeForCompare(field, to);
    if (sameValue(a, b)) continue;
    out.push({ field, label: fieldLabel(field), from: before[field] ?? null, to: to ?? null });
  }
  return out;
}

export function isSensitiveColumn(field: string): boolean {
  return SENSITIVE_JOB_COLUMNS.includes(field);
}

/** Změna připravená pro historii (s textovými hodnotami pro zobrazení). */
export interface JobChangeView extends JobChange {
  fromText: string;
  toText: string;
  sensitive?: boolean;
}

/** Doplní textové hodnoty; refs = jména pro id sloupců (osoby, zákazník, dodavatel). */
export function describeChanges(changes: JobChange[], refs: Record<string, string> = {}): JobChangeView[] {
  const text = (field: string, v: unknown) =>
    typeof v === "string" && refs[v] ? refs[v] : formatFieldValue(field, v);
  return changes.map((c) => ({
    ...c,
    fromText: text(c.field, c.from),
    toText: text(c.field, c.to),
    ...(isSensitiveColumn(c.field) ? { sensitive: true } : {}),
  }));
}

/** Text záznamu historie pro změnu polí (citlivé hodnoty se do textu nepíší). */
export function fieldEventMessage(changes: JobChangeView[]): string {
  if (changes.length === 0) return "Beze změn";
  if (changes.length === 1) {
    const c = changes[0];
    if (c.sensitive) return `${c.label}: upraveno`;
    return `${c.label}: ${c.fromText} → ${c.toText}`;
  }
  const labels = changes.map((c) => c.label);
  const shown = labels.slice(0, 4).join(", ");
  return `Upraveno ${changes.length} polí: ${shown}${labels.length > 4 ? "…" : ""}`;
}

export function stageEventMessage(from: JobStage | null, to: JobStage, note?: string | null): string {
  const f = from ? STAGES[from]?.label ?? from : "—";
  const t = STAGES[to]?.label ?? to;
  const n = cleanText(note, 500);
  return `Stav: ${f} → ${t}${n ? ` — ${n}` : ""}`;
}

/**
 * Sloupce vyplněné AI, které člověk ještě neopravil. Události chronologicky:
 * „ai" s data.filledColumns přidává, „field" s data.aiCorrected ubírá.
 */
export function aiFilledColumns(events: { type: string; data: unknown; created_at?: string }[]): Set<string> {
  const sorted = [...events].sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
  const set = new Set<string>();
  for (const e of sorted) {
    const data = (e.data && typeof e.data === "object" ? e.data : {}) as Record<string, unknown>;
    if (e.type === "ai" && Array.isArray(data.filledColumns)) {
      for (const c of data.filledColumns) if (typeof c === "string") set.add(c);
    }
    if (e.type === "field" && Array.isArray(data.aiCorrected)) {
      for (const c of data.aiCorrected) if (typeof c === "string") set.delete(c);
    }
  }
  return set;
}

// ── Nabídky a soubory ───────────────────────────────────────
/** Číslo nové verze nabídky: NAB-2026-031 → NAB-2026-031-R2 (stará přípona -Rn se odřízne). */
export function quoteRevisionNumber(number: string, revision: number): string {
  const base = number.trim().replace(/-R\d+$/i, "");
  return `${base}-R${revision}`;
}

/** Bezpečný název souboru do úložiště: bez diakritiky, jen [A-Za-z0-9._-], přípona zachována. */
export function safeStorageName(filename: string): string {
  const folded = String(filename ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-");
  const m = /\.([A-Za-z0-9_]{1,12})$/.exec(folded);
  const ext = m ? m[1] : "";
  let base = m ? folded.slice(0, m.index) : folded;
  base = base.replace(/\.+/g, ".").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 80).replace(/[-.]+$/, "");
  if (!base) base = "soubor";
  return ext ? `${base}.${ext}` : base;
}

/** Cesta souboru zakázky musí patřit dané zakázce (žádné ../ ani cizí složka). */
export function isValidJobFilePath(jobId: string, path: unknown): path is string {
  if (!isUuid(jobId) || typeof path !== "string" || path.includes("..")) return false;
  const re = new RegExp(
    `^zakazky/${jobId.toLowerCase()}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,120}$`,
  );
  return re.test(path);
}

/**
 * Obecný název z fotoaparátu (iOS Safari pojmenuje každou fotku „image.jpg") —
 * takové soubory se automaticky neverzují, jinak by nová fotka archivovala předchozí.
 */
export function isGenericCaptureName(filename: string): boolean {
  return /^(image|photo|foto|img|picture|camera|capture|snimek|obrazek|scan|sken|document|dokument)(?:[\s_-]*\(?\d{0,3}\)?)?\.(jpe?g|png|heic|heif|webp|gif)$/i
    .test(String(filename ?? "").trim());
}

/** Chyby Postgres/PostgREST → čeština pro uživatele. */
export function translateDbError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("foreign key")) return "Vybraný záznam (zákazník, dodavatel, uživatel nebo nabídka) neexistuje.";
  if (m.includes("duplicate key") || m.includes("unique constraint")) return "Záznam s tímto číslem už existuje.";
  if (m.includes("invalid input syntax for type uuid")) return "Neplatný identifikátor záznamu.";
  if (m.includes("invalid input syntax for type date") || m.includes("date/time field value out of range")) return "Neplatné datum.";
  if (m.includes("violates check constraint")) return "Neplatná hodnota (porušení pravidel databáze).";
  if (m.includes("numeric field overflow")) return "Číslo je příliš velké.";
  if (m.includes("permission denied") || m.includes("row-level security")) return "Databáze akci odmítla (oprávnění).";
  return message;
}

export function jobFilePath(jobId: string, uuid: string, filename: string): string {
  return `zakazky/${jobId.toLowerCase()}/${uuid}-${safeStorageName(filename)}`;
}

// ── Selecty (PostgREST, vždy s nápovědou FK sloupce) ────────
const PERSON = "id, full_name, email";

export const JOB_LIST_SELECT = [
  "id, number, title, status, priority, customer_id, customer_order_number, customer_inquiry_number",
  "value, purchase_cost, currency, inquiry_date, order_date, customer_required_date, due_date",
  "expected_delivery_date, supplier_promised_date, max_tolerated_date, received_at, delivered_at",
  "owner_id, assignee_id, created_by, supplier_id, ai_filled, source, created_at, updated_at, stage_changed_at",
  "production_step, production_location, production_done, production_total, production_problem",
  "customer_note, delivery_note_confirmed_at, invoice_number, invoice_due_date, paid_at",
  "customer:customers!customer_id(id, name, customer_number, ico)",
  `owner:profiles!owner_id(${PERSON})`,
  `assignee:profiles!assignee_id(${PERSON})`,
  `creator:profiles!created_by(${PERSON})`,
  "supplier:suppliers!supplier_id(id, name)",
  "items:order_items!order_id(position, drawing_number, quantity)",
  "quotes:quotes!job_id(id, archived)",
  "files:job_files!job_id(id, archived)",
].join(", ");

export const JOB_DETAIL_SELECT = [
  "*",
  "customer:customers!customer_id(id, name, customer_number, supplier_number_at_customer, ico, dic, street, city, zip, country, email, phone, contact_person, delivery_address, payment_terms_days, address)",
  `owner:profiles!owner_id(${PERSON})`,
  `assignee:profiles!assignee_id(${PERSON})`,
  `creator:profiles!created_by(${PERSON})`,
  `pricer:profiles!priced_by(${PERSON})`,
  `approver:profiles!approved_by(${PERSON})`,
  "supplier:suppliers!supplier_id(id, name)",
  "items:order_items!order_id(*)",
].join(", ");

export const JOB_QUOTE_SELECT = [
  "id, number, revision, title, status, total, currency, valid_until, lead_time_days, delivery_terms",
  "payment_terms, note, approved_at, sent_at, created_at, archived, ai_generated, job_id, customer_id",
  `creator:profiles!created_by(${PERSON})`,
  `approver:profiles!approved_by(${PERSON})`,
  `owner:profiles!owner_id(${PERSON})`,
  "items:quote_items!quote_id(*)",
].join(", ");

export const QUOTE_LIST_SELECT = [
  JOB_QUOTE_SELECT,
  "job:orders!job_id(id, number, title, status, quote_id)",
  "customer:customers!customer_id(id, name)",
].join(", ");

export const JOB_FILE_SELECT = [
  "id, job_id, kind, title, filename, mime_type, size_bytes, storage_path, version, archived, replaced_by",
  "quote_id, ai_extracted, ai_confidence, note, created_at, uploaded_by",
  `uploader:profiles!uploaded_by(${PERSON})`,
].join(", ");

export const JOB_FILE_LIST_SELECT = [
  JOB_FILE_SELECT,
  "job:orders!job_id(id, number, title, customer:customers!customer_id(name))",
].join(", ");

export const JOB_EVENT_SELECT = `id, job_id, type, message, data, actor_id, created_at, actor:profiles!actor_id(${PERSON})`;

export const JOB_COUNT_SELECT = "id, status, due_date, customer_required_date, max_tolerated_date, supplier_promised_date";

export const MATCH_JOB_SELECT = [
  "id, number, title, status, created_at, customer_id, customer_order_number, customer_inquiry_number, customer_contact_email",
  "customer:customers!customer_id(id, name, ico, dic, email, contacts:customer_contacts!customer_id(email))",
  "items:order_items!order_id(drawing_number)",
  "quotes:quotes!job_id(number, items:quote_items!quote_id(drawing_number))",
].join(", ");

export const MATCH_CUSTOMER_SELECT =
  "id, name, ico, dic, email, customer_number, supplier_number_at_customer, contacts:customer_contacts!customer_id(email)";

// ── Řádky DB (tvar odpovědí PostgREST) ──────────────────────
type Embed<T> = T | T[] | null | undefined;

export interface PersonEmbed {
  id: string;
  full_name?: string | null;
  email?: string | null;
}

export interface CustomerEmbed {
  id: string;
  name: string;
  customer_number?: string | null;
  supplier_number_at_customer?: string | null;
  ico?: string | null;
  dic?: string | null;
  street?: string | null;
  city?: string | null;
  zip?: string | null;
  country?: string | null;
  email?: string | null;
  phone?: string | null;
  contact_person?: string | null;
  delivery_address?: string | null;
  payment_terms_days?: number | null;
  address?: string | null;
}

export interface JobRow {
  id: string;
  number: string | null;
  title: string | null;
  status: string;
  priority?: string | null;
  customer_order_number?: string | null;
  customer_inquiry_number?: string | null;
  value?: number | string | null;
  purchase_cost?: number | string | null;
  currency?: string | null;
  inquiry_date?: string | null;
  order_date?: string | null;
  customer_required_date?: string | null;
  due_date?: string | null;
  expected_delivery_date?: string | null;
  supplier_promised_date?: string | null;
  max_tolerated_date?: string | null;
  received_at?: string | null;
  delivered_at?: string | null;
  ai_filled?: boolean | null;
  source?: string | null;
  created_at: string;
  updated_at?: string | null;
  stage_changed_at?: string | null;
  // výroba a konec toku
  production_step?: string | null;
  production_location?: string | null;
  production_done?: number | string | null;
  production_total?: number | string | null;
  production_problem?: boolean | null;
  customer_note?: string | null;
  delivery_note_confirmed_at?: string | null;
  invoice_due_date?: string | null;
  paid_at?: string | null;
  // detail
  note?: string | null;
  tags?: string[] | null;
  technology?: string | null;
  manufacturing_location?: string | null;
  specific_requirements?: string | null;
  delivery_method?: string | null;
  supplier_order_number?: string | null;
  invoice_number?: string | null;
  delivery_note_number?: string | null;
  customer_contact?: string | null;
  customer_contact_email?: string | null;
  customer_contact_phone?: string | null;
  approved_at?: string | null;
  confirmed_at?: string | null;
  production_started_at?: string | null;
  shipped_at?: string | null;
  invoiced_at?: string | null;
  email_id?: string | null;
  ai_confidence?: number | string | null;
  quote_id?: string | null;
  // vnořené
  customer?: Embed<CustomerEmbed>;
  owner?: Embed<PersonEmbed>;
  assignee?: Embed<PersonEmbed>;
  creator?: Embed<PersonEmbed>;
  pricer?: Embed<PersonEmbed>;
  approver?: Embed<PersonEmbed>;
  supplier?: Embed<{ id: string; name: string }>;
  items?: ItemRow[] | null;
  quotes?: { id: string; archived?: boolean | null }[] | null;
  files?: { id: string; archived?: boolean | null }[] | null;
}

export interface ItemRow {
  id?: string;
  position?: number | null;
  drawing_number?: string | null;
  revision?: string | null;
  name?: string | null;
  description?: string | null;
  material?: string | null;
  quantity?: number | string | null;
  unit?: string | null;
  unit_price?: number | string | null;
  purchase_unit_price?: number | string | null;
  vat_rate?: number | string | null;
  note?: string | null;
}

export interface QuoteRow {
  id: string;
  number: string | null;
  revision?: number | null;
  title?: string | null;
  status: string;
  total?: number | string | null;
  currency?: string | null;
  valid_until?: string | null;
  lead_time_days?: number | null;
  delivery_terms?: string | null;
  payment_terms?: string | null;
  note?: string | null;
  approved_at?: string | null;
  sent_at?: string | null;
  created_at: string;
  archived?: boolean | null;
  ai_generated?: boolean | null;
  job_id?: string | null;
  customer_id?: string | null;
  creator?: Embed<PersonEmbed>;
  approver?: Embed<PersonEmbed>;
  owner?: Embed<PersonEmbed>;
  items?: ItemRow[] | null;
  job?: Embed<{ id: string; number: string | null; title: string | null; status: string; quote_id?: string | null }>;
  customer?: Embed<{ id: string; name: string }>;
}

export interface FileRow {
  id: string;
  job_id: string;
  kind: string;
  title?: string | null;
  filename: string;
  mime_type?: string | null;
  size_bytes?: number | string | null;
  storage_path?: string;
  version?: number | null;
  archived?: boolean | null;
  replaced_by?: string | null;
  quote_id?: string | null;
  ai_extracted?: Record<string, unknown> | null;
  ai_confidence?: number | string | null;
  note?: string | null;
  created_at: string;
  uploaded_by?: string | null;
  uploader?: Embed<PersonEmbed>;
  job?: Embed<{ id: string; number: string | null; title: string | null; customer?: Embed<{ name: string }> }>;
}

export interface EventRow {
  id: string;
  job_id?: string;
  type: string;
  message: string;
  data?: Record<string, unknown> | null;
  actor_id?: string | null;
  created_at: string;
  actor?: Embed<PersonEmbed>;
}

export function one<T>(v: Embed<T>): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

function num(v: unknown): number | null {
  return cleanNumber(v);
}

export function personRef(p: Embed<PersonEmbed>): PersonRef | null {
  const x = one(p);
  if (!x || !x.id) return null;
  return { id: x.id, name: (x.full_name ?? "").trim() || (x.email ?? "").trim() || "Neznámý uživatel" };
}

function customerRef(c: Embed<CustomerEmbed>): JobCustomerRef | null {
  const x = one(c);
  if (!x || !x.id) return null;
  return { id: x.id, name: x.name, customerNumber: x.customer_number ?? null, ico: x.ico ?? null };
}

function stageOf(v: unknown): JobStage {
  return isJobStage(v) ? v : "poptavka";
}

function byPosition<T extends { position?: number | null }>(rows: T[] | null | undefined): T[] {
  return [...(rows ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

// ── Řádek → view-model ──────────────────────────────────────
export interface ViewOptions {
  /** Uživatel smí vidět nákupní ceny a marže. */
  margins: boolean;
}

export function rowToJobListItem(row: JobRow, opts: ViewOptions): JobListItem {
  const items = byPosition(row.items);
  const drawingNumbers: string[] = [];
  let totalQuantity = 0;
  for (const it of items) {
    const d = (it.drawing_number ?? "").trim();
    if (d && !drawingNumbers.includes(d)) drawingNumbers.push(d);
    totalQuantity += num(it.quantity) ?? 0;
  }
  const supplier = one(row.supplier);
  return {
    id: row.id,
    number: row.number ?? "—",
    title: row.title ?? "",
    stage: stageOf(row.status),
    priority: isPriority(row.priority) ? row.priority : "stredni",
    customer: customerRef(row.customer),
    customerOrderNumber: row.customer_order_number ?? null,
    customerInquiryNumber: row.customer_inquiry_number ?? null,
    drawingNumbers,
    itemCount: items.length,
    totalQuantity,
    value: num(row.value),
    purchaseCost: opts.margins ? num(row.purchase_cost) : null,
    currency: row.currency || "CZK",
    inquiryDate: row.inquiry_date ?? null,
    orderDate: row.order_date ?? null,
    customerRequiredDate: row.customer_required_date ?? null,
    dueDate: row.due_date ?? null,
    expectedDeliveryDate: row.expected_delivery_date ?? null,
    supplierPromisedDate: row.supplier_promised_date ?? null,
    maxToleratedDate: row.max_tolerated_date ?? null,
    receivedAt: row.received_at ?? null,
    deliveredAt: row.delivered_at ?? null,
    owner: personRef(row.owner),
    assignee: personRef(row.assignee),
    createdBy: personRef(row.creator),
    supplier: supplier && supplier.id ? { id: supplier.id, name: supplier.name } : null,
    quoteCount: (row.quotes ?? []).filter((q) => !q.archived).length,
    fileCount: (row.files ?? []).filter((f) => !f.archived).length,
    aiFilled: Boolean(row.ai_filled),
    source: isJobSource(row.source) ? row.source : "manual",
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
    stageChangedAt: row.stage_changed_at ?? null,
    productionStep: row.production_step === "hotovo" || isOperationKind(row.production_step) ? row.production_step : null,
    productionLocation: cleanText(row.production_location, 300),
    productionDone: Math.max(0, Math.round(num(row.production_done) ?? 0)),
    productionTotal: Math.max(0, Math.round(num(row.production_total) ?? 0)),
    productionProblem: Boolean(row.production_problem),
    customerNote: cleanText(row.customer_note, 10_000),
    deliveryNoteConfirmedAt: cleanDate(row.delivery_note_confirmed_at),
    invoiceNumber: cleanText(row.invoice_number, 120),
    invoiceDueDate: cleanDate(row.invoice_due_date),
    paidAt: cleanDate(row.paid_at),
  };
}

export function rowToJobItem(row: ItemRow, opts: ViewOptions): JobItem {
  return {
    id: row.id ?? "",
    position: row.position ?? 0,
    drawingNumber: row.drawing_number ?? null,
    revision: row.revision ?? null,
    name: row.name ?? null,
    description: row.description ?? null,
    material: row.material ?? null,
    quantity: num(row.quantity) ?? 0,
    unit: row.unit || "ks",
    unitPrice: num(row.unit_price),
    purchaseUnitPrice: opts.margins ? num(row.purchase_unit_price) : null,
    note: row.note ?? null,
  };
}

export function rowToJobQuoteItem(row: ItemRow, opts: ViewOptions): JobQuoteItem {
  return {
    id: row.id ?? "",
    position: row.position ?? 0,
    drawingNumber: row.drawing_number ?? null,
    name: row.name ?? null,
    description: row.description ?? null,
    material: row.material ?? null,
    quantity: num(row.quantity) ?? 0,
    unit: row.unit || "ks",
    unitPrice: num(row.unit_price),
    vatRate: num(row.vat_rate) ?? 21,
    purchaseUnitPrice: opts.margins ? num(row.purchase_unit_price) : null,
    note: row.note ?? null,
  };
}

export function rowToJobQuote(row: QuoteRow, opts: ViewOptions & { acceptedQuoteId?: string | null }): JobQuote {
  return {
    id: row.id,
    number: row.number ?? "—",
    revision: row.revision ?? 1,
    title: row.title ?? null,
    status: isQuoteStatus(row.status) ? row.status : "ke_schvaleni",
    total: num(row.total),
    currency: row.currency || "CZK",
    validUntil: row.valid_until ?? null,
    leadTimeDays: row.lead_time_days ?? null,
    deliveryTerms: row.delivery_terms ?? null,
    paymentTerms: row.payment_terms ?? null,
    note: row.note ?? null,
    createdBy: personRef(row.creator) ?? personRef(row.owner),
    approvedBy: personRef(row.approver),
    approvedAt: row.approved_at ?? null,
    sentAt: row.sent_at ?? null,
    createdAt: row.created_at,
    archived: Boolean(row.archived),
    aiGenerated: Boolean(row.ai_generated),
    accepted: Boolean(opts.acceptedQuoteId && opts.acceptedQuoteId === row.id),
    items: byPosition(row.items).map((i) => rowToJobQuoteItem(i, opts)),
  };
}

export function rowToJobFile(row: FileRow): JobFile {
  const ai = row.ai_extracted;
  return {
    id: row.id,
    kind: isJobFileKind(row.kind) ? row.kind : "ostatni",
    title: row.title ?? null,
    filename: row.filename,
    mimeType: row.mime_type ?? null,
    sizeBytes: num(row.size_bytes),
    version: row.version ?? 1,
    archived: Boolean(row.archived),
    replacedBy: row.replaced_by ?? null,
    quoteId: row.quote_id ?? null,
    uploadedBy: personRef(row.uploader),
    createdAt: row.created_at,
    aiConfidence: num(row.ai_confidence),
    note: row.note ?? null,
    hasAiData: Boolean(ai && typeof ai === "object" && Object.keys(ai).length > 0),
  };
}

const EVENT_TYPES: JobEventType[] = ["created", "stage", "field", "file", "quote", "comment", "ai", "email"];

/** Odstraní z dat události citlivé hodnoty (nákupní ceny) pro uživatele bez práva na marže. */
export function sanitizeEventData(data: Record<string, unknown>, opts: ViewOptions): Record<string, unknown> {
  if (opts.margins) return data;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (SENSITIVE_JOB_COLUMNS.includes(k) || k === "purchaseCost" || k === "purchase_unit_price" || k === "purchaseUnitPrice") continue;
    out[k] = v;
  }
  if (Array.isArray(data.changes)) {
    out.changes = data.changes
      .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === "object")
      .map((c) =>
        c.sensitive || (typeof c.field === "string" && isSensitiveColumn(c.field))
          ? { field: c.field, label: c.label, sensitive: true }
          : c,
      );
  }
  return out;
}

export function rowToJobEvent(row: EventRow, opts: ViewOptions): JobEvent {
  const data = row.data && typeof row.data === "object" ? row.data : {};
  return {
    id: row.id,
    type: (EVENT_TYPES as string[]).includes(row.type) ? (row.type as JobEventType) : "field",
    message: row.message,
    data: sanitizeEventData(data, opts),
    actor: personRef(row.actor),
    createdAt: row.created_at,
  };
}

export function rowToCustomerDetail(c: Embed<CustomerEmbed>): JobCustomerDetail | null {
  const x = one(c);
  if (!x || !x.id) return null;
  return {
    id: x.id,
    name: x.name,
    customerNumber: x.customer_number ?? null,
    supplierNumberAtCustomer: x.supplier_number_at_customer ?? null,
    ico: x.ico ?? null,
    dic: x.dic ?? null,
    street: x.street ?? x.address ?? null,
    city: x.city ?? null,
    zip: x.zip ?? null,
    country: x.country || "CZ",
    email: x.email ?? null,
    phone: x.phone ?? null,
    contactPerson: x.contact_person ?? null,
    deliveryAddress: x.delivery_address ?? null,
    paymentTermsDays: x.payment_terms_days ?? null,
  };
}

/** Marže jako podíl (0.25 = 25 %), jen s oprávněním a s oběma hodnotami. */
export function computeMargin(value: number | null, purchaseCost: number | null, opts: ViewOptions): number | null {
  if (!opts.margins || value === null || purchaseCost === null || value <= 0) return null;
  return Math.round(((value - purchaseCost) / value) * 10000) / 10000;
}

export function rowToJobDetail(
  row: JobRow,
  rel: { quotes: QuoteRow[]; files: FileRow[]; events: EventRow[] },
  opts: ViewOptions,
): JobDetail {
  const base = rowToJobListItem({ ...row, quotes: rel.quotes, files: rel.files }, opts);
  const acceptedQuoteId = row.quote_id ?? null;
  const quotes = [...rel.quotes]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((q) => rowToJobQuote(q, { ...opts, acceptedQuoteId }));
  const files = [...rel.files].sort((a, b) => b.created_at.localeCompare(a.created_at)).map(rowToJobFile);
  const events = [...rel.events]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((e) => rowToJobEvent(e, opts));
  return {
    ...base,
    note: row.note ?? null,
    tags: Array.isArray(row.tags) ? row.tags : [],
    technology: row.technology ?? null,
    manufacturingLocation: row.manufacturing_location ?? null,
    specificRequirements: row.specific_requirements ?? null,
    deliveryMethod: row.delivery_method ?? null,
    supplierOrderNumber: row.supplier_order_number ?? null,
    invoiceNumber: row.invoice_number ?? null,
    deliveryNoteNumber: row.delivery_note_number ?? null,
    customerContact: row.customer_contact ?? null,
    customerContactEmail: row.customer_contact_email ?? null,
    customerContactPhone: row.customer_contact_phone ?? null,
    pricedBy: personRef(row.pricer),
    approvedBy: personRef(row.approver),
    approvedAt: row.approved_at ?? null,
    confirmedAt: row.confirmed_at ?? null,
    productionStartedAt: row.production_started_at ?? null,
    shippedAt: row.shipped_at ?? null,
    invoicedAt: row.invoiced_at ?? null,
    emailId: row.email_id ?? null,
    aiConfidence: num(row.ai_confidence),
    acceptedQuoteId,
    margin: computeMargin(base.value, opts.margins ? num(row.purchase_cost) : null, opts),
    customerDetail: rowToCustomerDetail(row.customer),
    items: byPosition(row.items).map((i) => rowToJobItem(i, opts)),
    quotes,
    files,
    events,
  };
}

// ── Filtry, řazení, počty ───────────────────────────────────
/** Stavy pro dotaz do DB; null = bez omezení. */
export function resolveStageFilter(filters: Pick<JobFilters, "stages" | "group">): JobStage[] | null {
  const explicit = (filters.stages ?? []).filter(isJobStage);
  if (explicit.length) return Array.from(new Set(explicit));
  if (!filters.group || filters.group === "vse") return null;
  return stageGroup(filters.group).stages;
}

export function searchNormalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function haystack(j: JobListItem): string {
  return searchNormalize([
    j.number, j.title, j.customerOrderNumber, j.customerInquiryNumber,
    j.customer?.name, j.customer?.customerNumber, j.customer?.ico,
    ...j.drawingNumbers,
  ].filter(Boolean).join(" \u0001 "));
}

function deadlineInputOf(j: JobListItem): DeadlineInput {
  return {
    stage: j.stage,
    dueDate: j.dueDate,
    customerRequiredDate: j.customerRequiredDate,
    maxToleratedDate: j.maxToleratedDate,
    supplierPromisedDate: j.supplierPromisedDate,
  };
}

/** Splňuje zakázka filtr termínu? */
export function matchesDeadline(j: JobListItem, filter: JobFilters["deadline"], today: Date = new Date()): boolean {
  if (!filter) return true;
  const input = deadlineInputOf(j);
  if (filter === "no_date") return effectiveDeadline(input) === null;
  const info = deadlineInfo(input, today);
  if (filter === "overdue") return info.state === "overdue" || info.state === "critical" || info.state === "today";
  if (filter === "week") return info.state === "today" || info.state === "soon";
  if (filter === "month") {
    return info.state === "today" || info.state === "soon" ||
      (info.state === "ok" && info.daysLeft !== null && info.daysLeft <= 31);
  }
  return true;
}

/** Stav úhrady naší faktury; null = zatím bez faktury (nebo zakázka neproběhla). */
export type JobPaymentState = "zaplaceno" | "po_splatnosti" | "nezaplaceno";

export function paymentStateOf(
  j: Pick<JobListItem, "stage" | "paidAt" | "invoiceDueDate" | "invoiceNumber">,
  today: string = todayIso(),
): JobPaymentState | null {
  if (j.stage === "nerealizovano" || j.stage === "zruseno") return null;
  // dokončená zakázka = zaplacená (trigger doplní paid_at)
  if (cleanDate(j.paidAt) || j.stage === "dokonceno") return "zaplaceno";
  const due = cleanDate(j.invoiceDueDate);
  if (!due && !cleanText(j.invoiceNumber) && j.stage !== "fakturovano") return null;
  return due && due < today ? "po_splatnosti" : "nezaplaceno";
}

/** Splňuje zakázka filtr platby? „nezaplaceno" zahrnuje i faktury po splatnosti. */
export function matchesPayment(j: JobListItem, filter: JobPaymentFilter | undefined, today: string = todayIso()): boolean {
  if (!filter) return true;
  const state = paymentStateOf(j, today);
  if (filter === "nezaplaceno") return state === "nezaplaceno" || state === "po_splatnosti";
  return state === filter;
}

/** Fulltext (všechna slova musí sedět, bez diakritiky) + termín + výroba (operace, místo) + platba. */
export function filterJobs(
  items: JobListItem[],
  filters: Pick<JobFilters, "q" | "deadline" | "step" | "location" | "payment">,
  today: Date = new Date(),
): JobListItem[] {
  const tokens = searchNormalize(filters.q ?? "").split(/\s+/).filter(Boolean);
  const step = (filters.step ?? "").trim();
  const location = searchNormalize((filters.location ?? "").trim());
  const todayDay = todayIso(today);
  return items.filter((j) => {
    if (tokens.length) {
      const h = haystack(j);
      if (!tokens.every((t) => h.includes(t))) return false;
    }
    if (step && j.productionStep !== step) return false;
    if (location && searchNormalize((j.productionLocation ?? "").trim()) !== location) return false;
    if (!matchesPayment(j, filters.payment, todayDay)) return false;
    return matchesDeadline(j, filters.deadline, today);
  });
}

const collator = new Intl.Collator("cs", { numeric: true, sensitivity: "base" });

/** Řazení knihy; prázdné hodnoty (termín, zákazník, hodnota) vždy na konec. */
export function sortJobs(items: JobListItem[], sort: JobSort = "created", dir: "asc" | "desc" = "desc"): JobListItem[] {
  const sign = dir === "asc" ? 1 : -1;
  const nullsLast = <T>(a: T | null, b: T | null, cmp: (x: T, y: T) => number): number => {
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return sign * cmp(a, b);
  };
  const stageIndex = (s: JobStage) => {
    const i = STAGE_ORDER.indexOf(s);
    return i < 0 ? STAGE_ORDER.length : i;
  };
  const tie = (a: JobListItem, b: JobListItem) =>
    b.createdAt.localeCompare(a.createdAt) || collator.compare(b.number, a.number);

  return [...items].sort((a, b) => {
    let r = 0;
    switch (sort) {
      case "number": r = sign * collator.compare(a.number, b.number); break;
      case "updated": r = sign * a.updatedAt.localeCompare(b.updatedAt); break;
      case "stage": r = sign * (stageIndex(a.stage) - stageIndex(b.stage)); break;
      case "deadline":
        r = nullsLast(effectiveDeadline(deadlineInputOf(a)), effectiveDeadline(deadlineInputOf(b)), (x, y) => x.localeCompare(y));
        break;
      case "customer":
        r = nullsLast(a.customer?.name ?? null, b.customer?.name ?? null, (x, y) => collator.compare(x, y));
        break;
      case "value": r = nullsLast(a.value, b.value, (x, y) => x - y); break;
      case "created":
      default: r = sign * a.createdAt.localeCompare(b.createdAt); break;
    }
    return r || tie(a, b);
  });
}

export interface JobStageCounts {
  byStage: Record<JobStage, number>;
  active: number;
  overdue: number;
  dueThisWeek: number;
  total: number;
}

export function emptyStageCounts(): JobStageCounts {
  const byStage = Object.fromEntries(STAGE_ORDER.map((s) => [s, 0])) as Record<JobStage, number>;
  return { byStage, active: 0, overdue: 0, dueThisWeek: 0, total: 0 };
}

/** Počty pro chipy filtrů a přehled. */
export function countJobStages(
  rows: { status: string; due_date?: string | null; customer_required_date?: string | null; max_tolerated_date?: string | null; supplier_promised_date?: string | null }[],
  today: Date = new Date(),
): JobStageCounts {
  const out = emptyStageCounts();
  for (const r of rows) {
    const stage = stageOf(r.status);
    out.total++;
    out.byStage[stage]++;
    if (!CLOSED_STAGES.includes(stage)) out.active++;
    const info = deadlineInfo({
      stage,
      dueDate: r.due_date ?? null,
      customerRequiredDate: r.customer_required_date ?? null,
      maxToleratedDate: r.max_tolerated_date ?? null,
      supplierPromisedDate: r.supplier_promised_date ?? null,
    }, today);
    if (info.state === "overdue" || info.state === "critical" || info.state === "today") out.overdue++;
    if (info.state === "today" || info.state === "soon") out.dueThisWeek++;
  }
  return out;
}

/**
 * Načtení po stránkách — Supabase vrací max. 1000 řádků na dotaz (max-rows),
 * větší výběr je nutné stránkovat přes range(). fetchPage musí stavět dotaz
 * pokaždé znovu a se stabilním řazením.
 */
export async function fetchPaged<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  max = 2000,
  pageSize = 1000,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const out: T[] = [];
  for (let from = 0; from < max; from += pageSize) {
    const to = Math.min(from + pageSize, max) - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) return { data: out, error };
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < to - from + 1) break;
  }
  return { data: out, error: null };
}

/** Druh souboru ze vstupu, jinak null. */
export function fileKindOrNull(v: unknown): JobFileKind | null {
  return isJobFileKind(v) ? v : null;
}
