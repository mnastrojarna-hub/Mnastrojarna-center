import type { JobFileKind, JobStage } from "@/lib/supabase/database.types";
import type {
  CaptureDocKind, CaptureResult, DocIssuer, ExtractedBusinessDoc, ExtractedItem, ExtractedParty,
} from "@/lib/jobs/capture-types";
import type { JobInput, JobItemInput } from "@/lib/jobs/types";
import { docKindToStage, type JobSnapshot, type JobUpdatePlan, type NewJobPlan } from "@/lib/jobs/apply-extraction";
import { isForward, isJobStage, stageMeta } from "@/lib/jobs/stages";
import { isJobFileKind } from "@/lib/jobs/file-kinds";
import { docNumbersEqual, isSupplierSideDoc, normalizeCompanyName } from "@/lib/jobs/matching";
import { fieldLabel } from "@/lib/jobs/field-labels";
import { cleanDate, cleanNumber, isUuid, safeStorageName } from "@/lib/jobs/mapping";
import { plural } from "@/lib/jobs/deadlines";

/**
 * „📷 Vyfotit doklad" — kontrolní formulář (čistá logika, sdílí server i klient).
 * Server z AI čtení a plánu (apply-extraction) postaví ReviewModel, člověk ho
 * v dialogu opraví (ReviewState) a server ho uloží. Rozdíl mezi návrhem AI
 * a odeslaným stavem = korekce, ze kterých se AI učí.
 */

// ── Dočasné soubory (capture/<uživatel>/…) ──────────────────
export const CAPTURE_BUCKET = "job-files";
export const CAPTURE_MAX_PAGES = 20;
/** Jak dlouho čeká nahraný doklad na uložení (pak ho úklid smaže). */
export const CAPTURE_TTL_MS = 24 * 3600 * 1000;

const UUID_SRC = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export function captureFolder(userId: string): string {
  return `capture/${userId.toLowerCase()}`;
}

/** Cesta stránky dokladu: capture/<uživatel>/<uuid>-<bezpečný název>. */
export function capturePagePath(userId: string, uuid: string, filename: string): string {
  return `${captureFolder(userId)}/${uuid.toLowerCase()}-${safeStorageName(filename)}`;
}

/** Rozpracovaný doklad (výsledek AI, soubory) — capture/<uživatel>/<captureId>.json. */
export function captureSessionPath(userId: string, captureId: string): string {
  return `${captureFolder(userId)}/${captureId.toLowerCase()}.json`;
}

/** Stránka patří přihlášenému uživateli (žádné ../ ani cizí složka, ani soubor relace). */
export function isCapturePagePath(userId: string, path: unknown): path is string {
  if (!isUuid(userId) || typeof path !== "string" || path.includes("..")) return false;
  return new RegExp(`^capture/${userId.toLowerCase()}/${UUID_SRC}-[A-Za-z0-9._-]{1,120}$`).test(path);
}

/** Nahraná stránka dokladu (dočasně v capture/<uživatel>/…). */
export interface CaptureFileRef {
  path: string;
  filename: string;
  mimeType: string;
  size: number;
}

/** Fotka nebo PDF (jiné soubory patří do dokumentů zakázky, ne do „Vyfotit doklad"). */
export function isCaptureMime(mime: string | null | undefined): boolean {
  const m = (mime ?? "").toLowerCase();
  return m.startsWith("image/") || m === "application/pdf";
}

const AI_MIMES = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp", "application/pdf"];

/** Formát, který AI umí přečíst (HEIC a spol. ne). */
export function isAiReadableMime(mime: string | null | undefined): boolean {
  return AI_MIMES.includes((mime ?? "").toLowerCase());
}

/**
 * Skutečný formát podle prvních bajtů (prohlížeč typ někdy hlásí špatně a AI by
 * soubor odmítla). null = AI ho nepřečte (HEIC, TIFF…).
 */
export function sniffDocumentMime(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  // %PDF může předcházet pár bajtů smetí
  const head = String.fromCharCode(...Array.from(b.subarray(0, 1024)));
  if (head.includes("%PDF-")) return "application/pdf";
  return null;
}

// ── Druh dokladu (chipy) ────────────────────────────────────
export type CaptureChipKey =
  | "poptavka_zakaznik" | "objednavka_zakaznik"
  | "nabidka_my" | "potvrzeni_my" | "dodaci_list_my" | "faktura_my" | "objednavka_my" | "poptavka_my"
  | "nabidka_dodavatel" | "potvrzeni_dodavatel" | "dodaci_list_dodavatel" | "faktura_dodavatel"
  | "vykres" | "ostatni";

export type ChipGroup = "zakaznik" | "my" | "dodavatel" | "ostatni";

export interface CaptureChip {
  key: CaptureChipKey;
  docKind: CaptureDocKind;
  /** null = na vystaviteli nezáleží (výkres, jiný doklad). */
  issuer: DocIssuer | null;
  label: string;
  /** Do věty „AI přečetla …". */
  accusative: string;
  /** Název souboru dokladu v kartě zakázky („Dodací list dodavatele DL-0877"). */
  docTitle: string;
  /** Krátká nápověda pro nové kolegy. */
  hint: string;
  group: ChipGroup;
  fileKind: JobFileKind;
}

export const CAPTURE_CHIPS: CaptureChip[] = [
  { key: "poptavka_zakaznik", docKind: "poptavka", issuer: "zakaznik", label: "Poptávka zákazníka", accusative: "poptávku zákazníka", docTitle: "Poptávka zákazníka", hint: "Zákazník se ptá na cenu", group: "zakaznik", fileKind: "poptavka" },
  { key: "objednavka_zakaznik", docKind: "objednavka", issuer: "zakaznik", label: "Objednávka zákazníka", accusative: "objednávku zákazníka", docTitle: "Objednávka zákazníka", hint: "Zákazník objednává", group: "zakaznik", fileKind: "objednavka" },
  { key: "nabidka_my", docKind: "nabidka", issuer: "my", label: "Naše nabídka", accusative: "naši nabídku", docTitle: "Nabídka", hint: "Cenová nabídka zákazníkovi", group: "my", fileKind: "nabidka" },
  { key: "potvrzeni_my", docKind: "potvrzeni", issuer: "my", label: "Naše potvrzení objednávky", accusative: "naše potvrzení objednávky", docTitle: "Potvrzení objednávky", hint: "Potvrdili jsme zákazníkovi termín", group: "my", fileKind: "potvrzeni" },
  { key: "dodaci_list_my", docKind: "dodaci_list", issuer: "my", label: "Dodací list — náš", accusative: "náš dodací list", docTitle: "Dodací list", hint: "Expedovali jsme zákazníkovi", group: "my", fileKind: "dodaci_list" },
  { key: "faktura_my", docKind: "faktura", issuer: "my", label: "Faktura — naše", accusative: "naši fakturu", docTitle: "Faktura", hint: "Fakturujeme zákazníkovi", group: "my", fileKind: "faktura" },
  { key: "objednavka_my", docKind: "objednavka", issuer: "my", label: "Naše objednávka dodavateli", accusative: "naši objednávku dodavateli", docTitle: "Objednávka dodavateli", hint: "Objednáváme u kooperanta", group: "my", fileKind: "objednavka_vydana" },
  { key: "poptavka_my", docKind: "poptavka", issuer: "my", label: "Naše poptávka dodavateli", accusative: "naši poptávku dodavateli", docTitle: "Poptávka dodavateli", hint: "Ptáme se dodavatele na cenu", group: "my", fileKind: "naceneni" },
  { key: "nabidka_dodavatel", docKind: "nabidka", issuer: "dodavatel", label: "Nabídka dodavatele", accusative: "nabídku dodavatele", docTitle: "Nabídka dodavatele", hint: "Cena od dodavatele / kooperanta", group: "dodavatel", fileKind: "naceneni" },
  { key: "potvrzeni_dodavatel", docKind: "potvrzeni", issuer: "dodavatel", label: "Potvrzení od dodavatele", accusative: "potvrzení od dodavatele", docTitle: "Potvrzení dodavatele", hint: "Dodavatel potvrdil naši objednávku", group: "dodavatel", fileKind: "potvrzeni" },
  { key: "dodaci_list_dodavatel", docKind: "dodaci_list", issuer: "dodavatel", label: "Dodací list — od dodavatele", accusative: "dodací list od dodavatele", docTitle: "Dodací list dodavatele", hint: "Dodavatel nám dodal díly", group: "dodavatel", fileKind: "dodaci_list" },
  { key: "faktura_dodavatel", docKind: "faktura", issuer: "dodavatel", label: "Faktura — od dodavatele", accusative: "fakturu od dodavatele", docTitle: "Faktura dodavatele", hint: "Dodavatel nám fakturuje", group: "dodavatel", fileKind: "faktura" },
  { key: "vykres", docKind: "vykres", issuer: null, label: "Výkres", accusative: "výkres", docTitle: "Výkres", hint: "Výkres dílu bez obchodních údajů", group: "ostatni", fileKind: "vykres" },
  { key: "ostatni", docKind: "ostatni", issuer: null, label: "Jiné", accusative: "doklad", docTitle: "Doklad", hint: "Cokoli jiného k zakázce", group: "ostatni", fileKind: "ostatni" },
];

export const CHIP_GROUPS: { key: ChipGroup; label: string }[] = [
  { key: "zakaznik", label: "Od zákazníka" },
  { key: "my", label: "Od nás" },
  { key: "dodavatel", label: "Od dodavatele" },
  { key: "ostatni", label: "Ostatní" },
];

const CHIP_BY_KEY = new Map(CAPTURE_CHIPS.map((c) => [c.key, c]));

export function isCaptureChipKey(v: unknown): v is CaptureChipKey {
  return typeof v === "string" && CHIP_BY_KEY.has(v as CaptureChipKey);
}

export function chipByKey(key: CaptureChipKey): CaptureChip {
  return CHIP_BY_KEY.get(key) ?? CHIP_BY_KEY.get("ostatni")!;
}

/**
 * Chip pro druh + vystavitele z AI. exact = false, když vystavitel neseděl
 * (formulář pak upozorní „zkontroluj, kdo doklad vystavil"). Neznámý vystavitel
 * u nabídky / potvrzení / DL / faktury = spíš dodavatel (naše doklady AI pozná
 * podle naší hlavičky), u poptávky a objednávky = zákazník.
 */
export function chipFor(docKind: CaptureDocKind, issuer: DocIssuer): { chip: CaptureChip; exact: boolean } {
  if (docKind === "vykres" || docKind === "ostatni") return { chip: chipByKey(docKind), exact: true };
  const exact = CAPTURE_CHIPS.find((c) => c.docKind === docKind && c.issuer === issuer);
  if (exact) return { chip: exact, exact: true };
  const fallbackIssuer: DocIssuer = docKind === "poptavka" || docKind === "objednavka"
    ? "zakaznik"
    : issuer === "zakaznik" ? "my" : "dodavatel";
  const chip = CAPTURE_CHIPS.find((c) => c.docKind === docKind && c.issuer === fallbackIssuer) ?? chipByKey("ostatni");
  return { chip, exact: issuer === "neznamy" && (docKind === "poptavka" || docKind === "objednavka") };
}

const DOC_KINDS: CaptureDocKind[] = ["poptavka", "nabidka", "objednavka", "potvrzeni", "dodaci_list", "faktura", "vykres", "ostatni"];
const ISSUERS: DocIssuer[] = ["zakaznik", "my", "dodavatel", "neznamy"];

export function isCaptureDocKind(v: unknown): v is CaptureDocKind {
  return typeof v === "string" && (DOC_KINDS as string[]).includes(v);
}

export function isDocIssuer(v: unknown): v is DocIssuer {
  return typeof v === "string" && (ISSUERS as string[]).includes(v);
}

// ── Pole formuláře ──────────────────────────────────────────
export const REVIEW_FIELD_KEYS = [
  "title",
  "customerOrderNumber", "customerInquiryNumber", "supplierOrderNumber", "deliveryNoteNumber", "invoiceNumber",
  "inquiryDate", "orderDate", "customerRequiredDate", "dueDate", "expectedDeliveryDate", "supplierPromisedDate", "maxToleratedDate",
  "customerContact", "customerContactEmail", "customerContactPhone",
  "value", "purchaseCost", "currency", "deliveryMethod",
] as const;

export type ReviewFieldKey = (typeof REVIEW_FIELD_KEYS)[number];
export type ReviewFieldType = "text" | "date" | "money" | "email" | "tel" | "currency";
export type ReviewFieldGroup = "zaklad" | "cisla" | "terminy" | "kontakt" | "hodnota";

export interface ReviewFieldMeta {
  key: ReviewFieldKey;
  /** Sloupec tabulky orders (historie, AI korekce). */
  column: string;
  label: string;
  type: ReviewFieldType;
  group: ReviewFieldGroup;
  max: number;
  /** Nápověda pod polem (co do pole patří). */
  hint?: string;
  /** Jen s právem na marže. */
  sensitive?: boolean;
}

function meta(
  key: ReviewFieldKey, column: string, type: ReviewFieldType, group: ReviewFieldGroup,
  extra: Partial<Pick<ReviewFieldMeta, "hint" | "sensitive" | "max">> = {},
): ReviewFieldMeta {
  return { key, column, label: fieldLabel(column), type, group, max: extra.max ?? 120, ...extra };
}

export const REVIEW_FIELDS: Record<ReviewFieldKey, ReviewFieldMeta> = {
  title: meta("title", "title", "text", "zaklad", { max: 300, hint: "Krátce, co se vyrábí — uvidíš ho v knize" }),
  customerOrderNumber: meta("customerOrderNumber", "customer_order_number", "text", "cisla", { hint: "Číslo z objednávky zákazníka (PO)" }),
  customerInquiryNumber: meta("customerInquiryNumber", "customer_inquiry_number", "text", "cisla", { hint: "Číslo poptávky / RFQ zákazníka" }),
  supplierOrderNumber: meta("supplierOrderNumber", "supplier_order_number", "text", "cisla", { hint: "Číslo NAŠÍ objednávky u dodavatele" }),
  deliveryNoteNumber: meta("deliveryNoteNumber", "delivery_note_number", "text", "cisla"),
  invoiceNumber: meta("invoiceNumber", "invoice_number", "text", "cisla"),
  inquiryDate: meta("inquiryDate", "inquiry_date", "date", "terminy"),
  orderDate: meta("orderDate", "order_date", "date", "terminy"),
  customerRequiredDate: meta("customerRequiredDate", "customer_required_date", "date", "terminy", { hint: "Kdy to zákazník chce mít" }),
  dueDate: meta("dueDate", "due_date", "date", "terminy", { hint: "Termín, který jsme zákazníkovi potvrdili" }),
  expectedDeliveryDate: meta("expectedDeliveryDate", "expected_delivery_date", "date", "terminy", { hint: "Kdy to reálně čekáme" }),
  supplierPromisedDate: meta("supplierPromisedDate", "supplier_promised_date", "date", "terminy", { hint: "Kdy slíbil dodat dodavatel" }),
  maxToleratedDate: meta("maxToleratedDate", "max_tolerated_date", "date", "terminy", { hint: "Nejzazší termín, který zákazník ještě snese" }),
  customerContact: meta("customerContact", "customer_contact", "text", "kontakt", { max: 200 }),
  customerContactEmail: meta("customerContactEmail", "customer_contact_email", "email", "kontakt", { max: 200 }),
  customerContactPhone: meta("customerContactPhone", "customer_contact_phone", "tel", "kontakt", { max: 60 }),
  value: meta("value", "value", "money", "hodnota", { max: 30, hint: "Prodejní cena celkem bez DPH" }),
  purchaseCost: meta("purchaseCost", "purchase_cost", "money", "hodnota", { max: 30, sensitive: true, hint: "Kolik zaplatíme dodavateli" }),
  currency: meta("currency", "currency", "currency", "hodnota", { max: 3 }),
  deliveryMethod: meta("deliveryMethod", "delivery_method", "text", "hodnota", { max: 300 }),
};

export const REVIEW_GROUPS: { key: ReviewFieldGroup; label: string }[] = [
  { key: "zaklad", label: "Základ" },
  { key: "cisla", label: "Čísla dokladů" },
  { key: "terminy", label: "Termíny" },
  { key: "kontakt", label: "Kontakt u zákazníka" },
  { key: "hodnota", label: "Hodnota a dodání" },
];

/** Pole, která k danému druhu dokladu patří (vždy vidět, i prázdná). */
export const CHIP_FIELDS: Record<CaptureChipKey, ReviewFieldKey[]> = {
  poptavka_zakaznik: ["customerInquiryNumber", "inquiryDate", "customerRequiredDate", "customerContact", "customerContactEmail", "customerContactPhone"],
  objednavka_zakaznik: ["customerOrderNumber", "orderDate", "customerRequiredDate", "customerInquiryNumber", "value", "customerContact", "customerContactEmail", "customerContactPhone"],
  nabidka_my: ["customerInquiryNumber", "expectedDeliveryDate", "value"],
  potvrzeni_my: ["customerOrderNumber", "dueDate", "value"],
  dodaci_list_my: ["deliveryNoteNumber", "customerOrderNumber"],
  faktura_my: ["invoiceNumber", "customerOrderNumber"],
  objednavka_my: ["supplierOrderNumber", "supplierPromisedDate", "purchaseCost"],
  poptavka_my: [],
  nabidka_dodavatel: ["purchaseCost"],
  potvrzeni_dodavatel: ["supplierOrderNumber", "supplierPromisedDate", "purchaseCost"],
  dodaci_list_dodavatel: ["supplierOrderNumber"],
  faktura_dodavatel: ["supplierOrderNumber", "purchaseCost"],
  vykres: [],
  ostatni: [],
};

export type FieldValues = Partial<Record<ReviewFieldKey, string>>;

export function isReviewFieldKey(v: unknown): v is ReviewFieldKey {
  return typeof v === "string" && (REVIEW_FIELD_KEYS as readonly string[]).includes(v);
}

// ── Model formuláře ─────────────────────────────────────────
export interface ReviewItem {
  /** Klientský klíč řádku (ai-0, new-3…). */
  key: string;
  drawingNumber: string;
  revision: string;
  name: string;
  material: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  purchaseUnitPrice: string;
  description: string;
  note: string;
  aiFilled: boolean;
}

export type MergeField = "quantity" | "unitPrice" | "purchaseUnitPrice" | "material" | "name" | "revision";

export const MERGE_FIELD_LABELS: Record<MergeField, string> = {
  quantity: "množství",
  unitPrice: "cena / ks",
  purchaseUnitPrice: "nákupní cena / ks",
  material: "materiál",
  name: "název",
  revision: "revize",
};

/** Doplnění existující položky zakázky (jen prázdné údaje). */
export interface ReviewMerge {
  itemId: string;
  label: string;
  drawingNumber: string;
  patch: Partial<Record<MergeField, string>>;
  apply: boolean;
}

export interface ReviewTarget {
  /** "new" nebo id zakázky. */
  key: string;
  mode: "existing" | "new";
  jobId: string | null;
  number: string | null;
  title: string | null;
  customerId: string | null;
  customerName: string | null;
  supplierId: string | null;
  supplierName: string | null;
  /** Současný stav zakázky (existující). */
  stage: JobStage | null;
  reason: string | null;
  score: number | null;
  /** Neprázdné údaje zakázky — nepřepisují se, ve formuláři šedě pro kontext. */
  existing: FieldValues;
  /** Návrh AI (jen prázdná pole). */
  proposed: FieldValues;
  /** Doklad říká něco jiného, než zakázka má (jen upozornění). */
  conflicts: FieldValues;
  newItems: ReviewItem[];
  merges: ReviewMerge[];
  existingItems: number;
  /** Návrh stavu; null = neměnit. */
  stageTo: JobStage | null;
}

export type PartyChoice =
  | { mode: "existing"; id: string; name: string; reason: string | null }
  | { mode: "new"; party: ExtractedParty }
  | { mode: "none" };

export interface PartyMatchView {
  id: string;
  name: string;
  reason: string;
  score: number;
}

/** Co uživatel ve formuláři upravuje (a co se posílá k uložení). */
export interface ReviewState {
  chip: CaptureChipKey;
  docKind: CaptureDocKind;
  issuer: DocIssuer;
  fileKind: JobFileKind;
  targetKey: string;
  customer: PartyChoice;
  supplier: PartyChoice;
  fields: FieldValues;
  items: ReviewItem[];
  merges: ReviewMerge[];
  /** Cílový stav; "keep" = neměnit (jen existující zakázka). */
  stage: JobStage | "keep";
  /** Poznámka k dokladu (ručně psané poznámky, razítka). */
  docNote: string;
}

export interface CapturePreview {
  path: string;
  filename: string;
  mimeType: string;
  size: number;
  /** Podepsaná URL náhledu (hodinu platná), null = nepodařilo se. */
  url: string | null;
}

export interface ReviewOptions {
  customers: { id: string; name: string; customerNumber: string | null; ico: string | null }[];
  suppliers: { id: string; name: string }[];
  jobs: { id: string; number: string; title: string; customerName: string | null; stage: JobStage }[];
}

export interface ReviewModel {
  captureId: string;
  aiUsed: boolean;
  /** Proč AI neběžela / selhala (formulář se vyplňuje ručně). */
  reason: string | null;
  docKind: CaptureDocKind;
  issuer: DocIssuer;
  /** AI vrátila druh i vystavitele, který sedí na chip. */
  chipExact: boolean;
  documentNumber: string;
  confidence: number | null;
  summary: string;
  needsClarification: string[];
  docCustomer: ExtractedParty;
  docSupplier: ExtractedParty;
  customerMatch: PartyMatchView | null;
  supplierMatch: PartyMatchView | null;
  /** Doklad se nahrává u konkrétní zakázky (cíl nejde změnit). */
  fixedJobId: string | null;
  /** Nejlepší shoda, další možnosti a „nová zakázka" (u pevné zakázky jen ona). */
  targets: ReviewTarget[];
  margins: boolean;
  /** Režim automatizace modulu capture. */
  mode: "approval" | "full";
  previews: CapturePreview[];
  options: ReviewOptions;
  initial: ReviewState;
}

export type AnalyzeCaptureResponse =
  | { ok: true; model: ReviewModel; applied?: CaptureResult }
  | { ok: false; error: string };

// ── Hodnoty ─────────────────────────────────────────────────
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Hodnota pole jako text do inputu ("" = prázdné; 0 u peněz = prázdné). */
export function fieldString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) && v !== 0 ? String(round3(v)) : "";
  if (typeof v === "string") return v.trim();
  return "";
}

function amountString(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? String(round3(v)) : "";
}

function textOf(v: string | null | undefined): string {
  return (v ?? "").trim();
}

/** Normalizovaná hodnota pro porovnání (návrh AI × odeslaný formulář). */
export function normalizeFieldValue(key: ReviewFieldKey, v: string | null | undefined): string {
  const s = (v ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  const type = REVIEW_FIELDS[key].type;
  if (type === "money") {
    const n = cleanNumber(s);
    return n === null ? s : String(round3(n));
  }
  if (type === "email") return s.toLowerCase();
  if (type === "currency") return s.toUpperCase();
  return s;
}

function sameFieldValue(key: ReviewFieldKey, a: string, b: string): boolean {
  const na = normalizeFieldValue(key, a);
  const nb = normalizeFieldValue(key, b);
  if (na === nb) return true;
  if (REVIEW_FIELDS[key].group === "cisla") return docNumbersEqual(na, nb);
  return na.toLowerCase() === nb.toLowerCase();
}

/** Údaje existující zakázky, ze kterých se staví cíl formuláře. */
export type TargetJob = JobSnapshot & {
  id: string;
  number: string;
  maxToleratedDate?: string | null;
  purchaseCost?: number | null;
  currency?: string | null;
  deliveryMethod?: string | null;
};

function jobFieldValues(job: TargetJob, margins: boolean): FieldValues {
  const src = job as unknown as Record<string, unknown>;
  const out: FieldValues = {};
  for (const key of REVIEW_FIELD_KEYS) {
    if (REVIEW_FIELDS[key].sensitive && !margins) continue;
    const v = fieldString(src[key]);
    if (v) out[key] = v;
  }
  return out;
}

function inputFieldValues(input: JobInput, margins: boolean): FieldValues {
  const src = input as Record<string, unknown>;
  const out: FieldValues = {};
  for (const key of REVIEW_FIELD_KEYS) {
    if (REVIEW_FIELDS[key].sensitive && !margins) continue;
    const v = fieldString(src[key]);
    if (v) out[key] = v;
  }
  return out;
}

export function itemInputToReview(it: JobItemInput, key: string, aiFilled: boolean, margins: boolean): ReviewItem {
  return {
    key,
    drawingNumber: textOf(it.drawingNumber),
    revision: textOf(it.revision),
    name: textOf(it.name),
    material: textOf(it.material),
    quantity: it.quantity > 0 ? String(round3(it.quantity)) : "1",
    unit: textOf(it.unit) || "ks",
    unitPrice: amountString(it.unitPrice),
    purchaseUnitPrice: margins ? amountString(it.purchaseUnitPrice) : "",
    description: textOf(it.description),
    note: textOf(it.note),
    aiFilled,
  };
}

export function emptyReviewItem(key: string): ReviewItem {
  return {
    key, drawingNumber: "", revision: "", name: "", material: "", quantity: "1", unit: "ks",
    unitPrice: "", purchaseUnitPrice: "", description: "", note: "", aiFilled: false,
  };
}

/** Řádek položky je prázdný (nic podstatného nevyplněno). */
export function isBlankReviewItem(it: ReviewItem): boolean {
  return !it.drawingNumber.trim() && !it.name.trim() && !it.description.trim();
}

// ── Cíle (zakázka / nová zakázka) ───────────────────────────
/** Návrh stavu podle druhu dokladu: nová zakázka = stav dokladu, existující jen posun dopředu. */
export function proposeStage(
  docKind: CaptureDocKind,
  issuer: DocIssuer,
  target: Pick<ReviewTarget, "mode" | "stage">,
): JobStage | "keep" {
  const to = docKindToStage(docKind, issuer);
  if (target.mode === "new") return to ?? "poptavka";
  return to && target.stage && isForward(target.stage, to) ? to : "keep";
}

const CONFLICT_GROUPS: ReviewFieldGroup[] = ["cisla", "terminy", "hodnota"];

export function buildExistingTarget(args: {
  job: TargetJob;
  /** Plán podle dokladu (null = ruční vyplnění bez AI). */
  plan: JobUpdatePlan | null;
  /** Všechny hodnoty, které z dokladu plynou (docFieldValues). */
  docValues?: JobInput;
  reason: string | null;
  score: number | null;
  margins: boolean;
}): ReviewTarget {
  const { job, plan, margins } = args;
  const existing = jobFieldValues(job, margins);
  const proposed: FieldValues = {};
  if (plan) {
    for (const [k, v] of Object.entries(inputFieldValues(plan.patch, margins)) as [ReviewFieldKey, string][]) {
      if (!existing[k]) proposed[k] = v;
    }
  }
  const conflicts: FieldValues = {};
  if (args.docValues) {
    for (const [k, v] of Object.entries(inputFieldValues(args.docValues, margins)) as [ReviewFieldKey, string][]) {
      if (k === "currency" || k === "deliveryMethod" || !CONFLICT_GROUPS.includes(REVIEW_FIELDS[k].group)) continue;
      const cur = existing[k];
      if (cur && !sameFieldValue(k, cur, v)) conflicts[k] = v;
    }
  }
  const items = job.items ?? [];
  const merges: ReviewMerge[] = [];
  for (const u of plan?.itemUpdates ?? []) {
    const it = items.find((i) => i.id === u.id);
    if (!it) continue;
    const patch: Partial<Record<MergeField, string>> = {};
    for (const f of Object.keys(MERGE_FIELD_LABELS) as MergeField[]) {
      if (f === "purchaseUnitPrice" && !margins) continue;
      const v = fieldString((u.patch as Record<string, unknown>)[f]);
      if (v) patch[f] = v;
    }
    if (!Object.keys(patch).length) continue;
    merges.push({
      itemId: it.id,
      label: [it.drawingNumber, it.name].filter(Boolean).join(" ") || `Položka ${it.position + 1}`,
      drawingNumber: it.drawingNumber ?? "",
      patch,
      apply: true,
    });
  }
  return {
    key: job.id,
    mode: "existing",
    jobId: job.id,
    number: job.number,
    title: job.title,
    customerId: job.customer?.id ?? null,
    customerName: job.customer?.name ?? null,
    supplierId: job.supplier?.id ?? null,
    supplierName: job.supplier?.name ?? null,
    stage: job.stage,
    reason: args.reason,
    score: args.score,
    existing,
    proposed,
    conflicts,
    newItems: (plan?.newItems ?? []).map((it, i) => itemInputToReview(it, `ai-${i}`, true, margins)),
    merges,
    existingItems: items.length,
    stageTo: plan?.stageTo ?? null,
  };
}

export function buildNewTarget(args: { plan: NewJobPlan | null; margins: boolean; docKind: CaptureDocKind; issuer: DocIssuer }): ReviewTarget {
  const { plan, margins } = args;
  return {
    key: "new",
    mode: "new",
    jobId: null,
    number: null,
    title: null,
    customerId: null,
    customerName: null,
    supplierId: null,
    supplierName: null,
    stage: null,
    reason: null,
    score: null,
    existing: {},
    proposed: plan ? inputFieldValues(plan.input, margins) : {},
    conflicts: {},
    newItems: (plan?.items ?? []).map((it, i) => itemInputToReview(it, `ai-${i}`, true, margins)),
    merges: [],
    existingItems: 0,
    stageTo: plan?.input.stage ?? docKindToStage(args.docKind, args.issuer) ?? "poptavka",
  };
}

export function isFieldLocked(target: Pick<ReviewTarget, "mode" | "existing">, key: ReviewFieldKey): boolean {
  return target.mode === "existing" && Boolean(target.existing[key]);
}

/** Pole je vyplněné AI a člověk ho nezměnil (✨ ve formuláři). */
export function isAiValue(target: Pick<ReviewTarget, "proposed">, state: Pick<ReviewState, "fields">, key: ReviewFieldKey, aiUsed: boolean): boolean {
  const ai = target.proposed[key];
  return aiUsed && Boolean(ai) && normalizeFieldValue(key, state.fields[key]) === normalizeFieldValue(key, ai);
}

/**
 * Pole k zobrazení ve skupinách: název + pole typická pro druh dokladu + vše,
 * co má hodnotu nebo návrh; showAll = všechna pole (tlačítko „Další údaje").
 */
export function visibleFieldGroups(args: {
  chip: CaptureChipKey;
  target: ReviewTarget;
  fields: FieldValues;
  margins: boolean;
  showAll?: boolean;
}): { group: ReviewFieldGroup; label: string; keys: ReviewFieldKey[] }[] {
  const { target, fields, margins } = args;
  const wanted = new Set<ReviewFieldKey>(["title", ...CHIP_FIELDS[args.chip]]);
  for (const k of REVIEW_FIELD_KEYS) {
    if (fields[k]?.trim() || target.proposed[k] || target.conflicts[k]) wanted.add(k);
  }
  const keys = REVIEW_FIELD_KEYS.filter((k) => (args.showAll || wanted.has(k)) && (margins || !REVIEW_FIELDS[k].sensitive));
  return REVIEW_GROUPS
    .map((g) => ({ group: g.key, label: g.label, keys: keys.filter((k) => REVIEW_FIELDS[k].group === g.key) }))
    .filter((g) => g.keys.length > 0);
}

/** Kolik polí je skrytých pod „Další údaje". */
export function hiddenFieldCount(args: Parameters<typeof visibleFieldGroups>[0]): number {
  const shown = visibleFieldGroups({ ...args, showAll: false }).reduce((s, g) => s + g.keys.length, 0);
  const all = visibleFieldGroups({ ...args, showAll: true }).reduce((s, g) => s + g.keys.length, 0);
  return all - shown;
}

// ── Výchozí stav formuláře ──────────────────────────────────
export function defaultCustomerChoice(
  target: Pick<ReviewTarget, "mode" | "customerId" | "customerName">,
  match: PartyMatchView | null,
  docCustomer: ExtractedParty,
): PartyChoice {
  if (target.mode === "existing" && target.customerId) {
    return { mode: "existing", id: target.customerId, name: target.customerName ?? "", reason: "zákazník zakázky" };
  }
  if (match) return { mode: "existing", id: match.id, name: match.name, reason: match.reason };
  if (docCustomer.name.trim()) return { mode: "new", party: { ...docCustomer } };
  return { mode: "none" };
}

export function defaultSupplierChoice(
  target: Pick<ReviewTarget, "mode" | "supplierId" | "supplierName">,
  match: PartyMatchView | null,
  docSupplier: ExtractedParty,
): PartyChoice {
  if (match) return { mode: "existing", id: match.id, name: match.name, reason: match.reason };
  if (docSupplier.name.trim()) return { mode: "new", party: { ...docSupplier } };
  if (target.mode === "existing" && target.supplierId) {
    return { mode: "existing", id: target.supplierId, name: target.supplierName ?? "", reason: "dodavatel zakázky" };
  }
  return { mode: "none" };
}

export function initialReviewState(args: {
  docKind: CaptureDocKind;
  issuer: DocIssuer;
  target: ReviewTarget;
  customerMatch: PartyMatchView | null;
  supplierMatch: PartyMatchView | null;
  docCustomer: ExtractedParty;
  docSupplier: ExtractedParty;
  docNote?: string;
}): ReviewState {
  const { chip } = chipFor(args.docKind, args.issuer);
  const { target } = args;
  return {
    chip: chip.key,
    docKind: chip.docKind,
    // vystavitel podle chipu — formulář i uložení pak čtou doklad stejně
    issuer: chip.issuer ?? args.issuer,
    fileKind: chip.fileKind,
    targetKey: target.key,
    customer: defaultCustomerChoice(target, args.customerMatch, args.docCustomer),
    supplier: defaultSupplierChoice(target, args.supplierMatch, args.docSupplier),
    fields: { ...target.proposed },
    items: target.newItems.map((i) => ({ ...i })),
    merges: target.merges.map((m) => ({ ...m, patch: { ...m.patch } })),
    stage: target.stageTo ?? (target.mode === "new" ? "poptavka" : "keep"),
    docNote: args.docNote ?? "",
  };
}

/** Jiný druh dokladu → nový návrh stavu a druhu souboru. */
export function changeChip(state: ReviewState, key: CaptureChipKey, target: Pick<ReviewTarget, "mode" | "stage">): ReviewState {
  const chip = chipByKey(key);
  const issuer = chip.issuer ?? state.issuer;
  return {
    ...state,
    chip: chip.key,
    docKind: chip.docKind,
    issuer,
    fileKind: chip.fileKind,
    stage: proposeStage(chip.docKind, issuer, target),
  };
}

function itemsKey(items: ReviewItem[]): string {
  return JSON.stringify(items.map((i) => [
    i.drawingNumber.trim(), i.revision.trim(), i.name.trim(), i.material.trim(),
    cleanNumber(i.quantity) ?? i.quantity.trim(), i.unit.trim(),
    cleanNumber(i.unitPrice) ?? i.unitPrice.trim(), cleanNumber(i.purchaseUnitPrice) ?? i.purchaseUnitPrice.trim(),
  ]));
}

export function sameReviewItems(a: ReviewItem[], b: ReviewItem[]): boolean {
  return itemsKey(a.filter((i) => !isBlankReviewItem(i))) === itemsKey(b.filter((i) => !isBlankReviewItem(i)));
}

/**
 * Přepnutí cílové zakázky: návrh nového cíle, ale co uživatel sám přepsal,
 * zůstává (pokud to nová zakázka už nemá vyplněné). Zákazník zamčený na
 * předchozí zakázku se vrátí na výchozí volbu z dokladu.
 */
export function switchTarget(
  state: ReviewState,
  from: ReviewTarget,
  to: ReviewTarget,
  fallbackCustomer: PartyChoice,
  fallbackSupplier: PartyChoice,
): ReviewState {
  const fields: FieldValues = { ...to.proposed };
  for (const key of REVIEW_FIELD_KEYS) {
    const cur = state.fields[key] ?? "";
    const was = from.proposed[key] ?? "";
    if (normalizeFieldValue(key, cur) !== normalizeFieldValue(key, was)) fields[key] = cur;
  }
  for (const key of Object.keys(fields) as ReviewFieldKey[]) {
    if (isFieldLocked(to, key)) delete fields[key];
  }
  const itemsEdited = !sameReviewItems(state.items, from.newItems);

  const lockedCustomer = from.mode === "existing" && from.customerId
    && state.customer.mode === "existing" && state.customer.id === from.customerId;
  let customer: PartyChoice = lockedCustomer ? fallbackCustomer : state.customer;
  if (to.mode === "existing" && to.customerId) {
    customer = { mode: "existing", id: to.customerId, name: to.customerName ?? "", reason: "zákazník zakázky" };
  }
  const lockedSupplier = from.mode === "existing" && from.supplierId
    && state.supplier.mode === "existing" && state.supplier.id === from.supplierId && state.supplier.reason === "dodavatel zakázky";
  let supplier: PartyChoice = lockedSupplier ? fallbackSupplier : state.supplier;
  if (supplier.mode === "none" && to.mode === "existing" && to.supplierId) {
    supplier = { mode: "existing", id: to.supplierId, name: to.supplierName ?? "", reason: "dodavatel zakázky" };
  }

  return {
    ...state,
    targetKey: to.key,
    customer,
    supplier,
    fields,
    items: itemsEdited ? state.items : to.newItems.map((i) => ({ ...i })),
    merges: to.merges.map((m) => ({ ...m, patch: { ...m.patch } })),
    stage: proposeStage(state.docKind, state.issuer, to),
  };
}

// ── Odeslání formuláře → zápis ──────────────────────────────
function parsedField(key: ReviewFieldKey, raw: string): string | number {
  const type = REVIEW_FIELDS[key].type;
  if (type === "money") return cleanNumber(raw) ?? raw;
  if (type === "currency") return raw.toUpperCase();
  return raw;
}

/** Vyplněná (neprázdná, nezamčená) pole formuláře → JobInput. */
export function reviewToJobInput(
  state: Pick<ReviewState, "fields">,
  target: Pick<ReviewTarget, "mode" | "existing">,
  margins: boolean,
): JobInput {
  const out: Record<string, unknown> = {};
  for (const key of REVIEW_FIELD_KEYS) {
    if (REVIEW_FIELDS[key].sensitive && !margins) continue;
    if (isFieldLocked(target, key)) continue;
    const v = (state.fields[key] ?? "").trim();
    if (!v) continue;
    out[key] = parsedField(key, v);
  }
  return out as JobInput;
}

/** Položky formuláře → vstup položek (prázdné řádky se vynechají). */
export function reviewItemsToInputs(items: ReviewItem[], margins: boolean): JobItemInput[] {
  return items.filter((i) => !isBlankReviewItem(i)).map((i) => {
    const out: JobItemInput = { quantity: cleanNumber(i.quantity) ?? 1, unit: i.unit.trim() || "ks" };
    if (i.drawingNumber.trim()) out.drawingNumber = i.drawingNumber.trim();
    if (i.revision.trim()) out.revision = i.revision.trim();
    if (i.name.trim()) out.name = i.name.trim();
    if (i.description.trim()) out.description = i.description.trim();
    if (i.material.trim()) out.material = i.material.trim();
    if (i.note.trim()) out.note = i.note.trim();
    const price = cleanNumber(i.unitPrice);
    if (price !== null && price > 0) out.unitPrice = price;
    if (margins) {
      const purchase = cleanNumber(i.purchaseUnitPrice);
      if (purchase !== null && purchase > 0) out.purchaseUnitPrice = purchase;
    }
    return out;
  });
}

/** Odsouhlasená doplnění existujících položek → { id, patch } (čísla už jako čísla). */
export function reviewMergePatches(merges: ReviewMerge[], margins: boolean): { id: string; patch: Partial<JobItemInput> }[] {
  const out: { id: string; patch: Partial<JobItemInput> }[] = [];
  for (const m of merges) {
    if (!m.apply || !isUuid(m.itemId)) continue;
    const patch: Partial<JobItemInput> = {};
    for (const [f, raw] of Object.entries(m.patch) as [MergeField, string][]) {
      const v = (raw ?? "").trim();
      if (!v) continue;
      if (f === "purchaseUnitPrice" && !margins) continue;
      if (f === "quantity" || f === "unitPrice" || f === "purchaseUnitPrice") {
        const n = cleanNumber(v);
        if (n !== null && n > 0) patch[f] = n;
      } else {
        patch[f] = v;
      }
    }
    if (Object.keys(patch).length) out.push({ id: m.itemId, patch });
  }
  return out;
}

/** Číslo dokladu pro titulek souboru a historii (z formuláře, jinak z AI). */
export function documentNumberFor(state: Pick<ReviewState, "chip" | "fields">, aiNumber = ""): string {
  const f = (k: ReviewFieldKey) => (state.fields[k] ?? "").trim();
  switch (state.chip) {
    case "objednavka_zakaznik": return f("customerOrderNumber") || aiNumber;
    case "poptavka_zakaznik": return f("customerInquiryNumber") || aiNumber;
    case "dodaci_list_my": return f("deliveryNoteNumber") || aiNumber;
    case "faktura_my": return f("invoiceNumber") || aiNumber;
    case "objednavka_my": return f("supplierOrderNumber") || aiNumber;
    default: return aiNumber;
  }
}

// ── Učení AI: co člověk opravil ─────────────────────────────
export interface ReviewProposal {
  chip: CaptureChipKey;
  customer: PartyChoice;
  supplier: PartyChoice;
  fields: FieldValues;
  items: ReviewItem[];
}

export interface ReviewChange {
  key: string;
  label: string;
  aiValue: string;
  value: string;
}

export function partyLabel(p: PartyChoice): string {
  if (p.mode === "existing") return p.name;
  if (p.mode === "new") return p.party.name.trim();
  return "";
}

function sameParty(a: PartyChoice, b: PartyChoice): boolean {
  if (a.mode === "existing" && b.mode === "existing") return a.id === b.id;
  if (a.mode === "new" && b.mode === "new") {
    return normalizeCompanyName(a.party.name) === normalizeCompanyName(b.party.name)
      && a.party.ico.replace(/\D/g, "") === b.party.ico.replace(/\D/g, "");
  }
  return a.mode === b.mode && a.mode === "none";
}

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Položky jako jeden řádek textu („VK-2291 rev. B Upínka 1.2379 50 ks á 1180; …"). */
export function summarizeItems(items: ReviewItem[], withPurchase = false): string {
  return clip(items.filter((i) => !isBlankReviewItem(i)).map((i) => [
    i.drawingNumber.trim(),
    i.revision.trim() && `rev. ${i.revision.trim()}`,
    i.name.trim(),
    i.material.trim(),
    `${i.quantity.trim() || "1"} ${i.unit.trim() || "ks"}`,
    i.unitPrice.trim() && `á ${i.unitPrice.trim()}`,
    withPurchase && i.purchaseUnitPrice.trim() && `nákup á ${i.purchaseUnitPrice.trim()}`,
  ].filter(Boolean).join(" ")).join("; "), 500);
}

/**
 * Rozdíly mezi návrhem AI a odeslaným formulářem (druh dokladu, zákazník,
 * dodavatel, pole, položky). Zamčená pole (zakázka je už má) a citlivá pole
 * bez práva na marže se neporovnávají.
 */
export function reviewChanges(
  proposal: ReviewProposal,
  submitted: ReviewState,
  opts: { locked?: ReviewFieldKey[]; customerLocked?: boolean; supplierRelevant?: boolean; margins: boolean },
): ReviewChange[] {
  const out: ReviewChange[] = [];
  if (proposal.chip !== submitted.chip) {
    out.push({ key: "docKind", label: "Druh dokladu", aiValue: chipByKey(proposal.chip).label, value: chipByKey(submitted.chip).label });
  }
  if (!opts.customerLocked && !sameParty(proposal.customer, submitted.customer)) {
    out.push({ key: "customer", label: "Zákazník", aiValue: partyLabel(proposal.customer), value: partyLabel(submitted.customer) });
  }
  if (opts.supplierRelevant && !sameParty(proposal.supplier, submitted.supplier)) {
    out.push({ key: "supplier", label: "Dodavatel", aiValue: partyLabel(proposal.supplier), value: partyLabel(submitted.supplier) });
  }
  const locked = new Set(opts.locked ?? []);
  for (const key of REVIEW_FIELD_KEYS) {
    if (locked.has(key)) continue;
    if (REVIEW_FIELDS[key].sensitive && !opts.margins) continue;
    const a = normalizeFieldValue(key, proposal.fields[key]);
    const b = normalizeFieldValue(key, submitted.fields[key]);
    if (a !== b) out.push({ key, label: REVIEW_FIELDS[key].label, aiValue: a, value: b });
  }
  if (!sameReviewItems(proposal.items, submitted.items)) {
    out.push({
      key: "items",
      label: "Položky",
      aiValue: summarizeItems(proposal.items, opts.margins),
      value: summarizeItems(submitted.items, opts.margins),
    });
  }
  return out;
}

/**
 * Finální údaje dokladu po kontrole člověkem — ve tvaru výstupu AI (stejné klíče
 * jako schéma čtení), aby se z nich AI v dalších dokladech učila, kam co patří.
 */
export function reviewToFinalDoc(
  doc: ExtractedBusinessDoc,
  state: ReviewState,
  names: { customerName?: string | null; supplierName?: string | null; margins: boolean },
): ExtractedBusinessDoc {
  const supplierSide = isSupplierSideDoc(state);
  const out: ExtractedBusinessDoc = {
    ...doc,
    docKind: state.docKind,
    issuer: state.issuer,
    customer: { ...doc.customer },
    supplier: { ...doc.supplier },
    summary: "",
    needsClarification: [],
  };
  const party = (choice: PartyChoice, current: ExtractedParty, name?: string | null): ExtractedParty => {
    if (choice.mode === "new") return { ...choice.party };
    if (choice.mode === "existing") return { ...current, name: name || choice.name || current.name };
    return { name: "", ico: "", dic: "", street: "", city: "", zip: "", country: "", email: "", phone: "", contactPerson: "" };
  };
  out.customer = party(state.customer, out.customer, names.customerName);
  if (supplierSide) out.supplier = party(state.supplier, out.supplier, names.supplierName);

  const has = (k: ReviewFieldKey) => Object.prototype.hasOwnProperty.call(state.fields, k);
  const f = (k: ReviewFieldKey) => (state.fields[k] ?? "").trim();
  if (supplierSide) {
    if (has("supplierOrderNumber")) out.customerOrderNumber = f("supplierOrderNumber");
  } else if (has("customerOrderNumber")) {
    out.customerOrderNumber = f("customerOrderNumber");
  }
  if (has("customerInquiryNumber")) out.customerInquiryNumber = f("customerInquiryNumber");
  if (has("customerContact")) out.customer.contactPerson = f("customerContact");
  if (has("customerContactEmail")) out.customer.email = f("customerContactEmail").toLowerCase();
  if (has("customerContactPhone")) out.customer.phone = f("customerContactPhone");
  if (has("customerRequiredDate")) out.requiredDeliveryDate = f("customerRequiredDate");
  if (state.docKind === "objednavka" && !supplierSide && has("orderDate")) out.documentDate = f("orderDate");
  if (state.docKind === "poptavka" && !supplierSide && has("inquiryDate")) out.documentDate = f("inquiryDate");
  const promised: Partial<Record<CaptureChipKey, ReviewFieldKey>> = {
    potvrzeni_my: "dueDate", nabidka_my: "expectedDeliveryDate",
    potvrzeni_dodavatel: "supplierPromisedDate", objednavka_my: "supplierPromisedDate",
  };
  const pk = promised[state.chip];
  if (pk && has(pk)) out.promisedDeliveryDate = f(pk);
  const number = documentNumberFor(state, "");
  if (number) out.documentNumber = number;
  const totalKey: ReviewFieldKey = supplierSide ? "purchaseCost" : "value";
  if (has(totalKey) && (!supplierSide || names.margins)) out.totalWithoutVat = cleanNumber(f(totalKey)) ?? 0;
  if (has("currency")) out.currency = f("currency").toUpperCase();
  if (has("deliveryMethod")) out.deliveryTerms = f("deliveryMethod");

  const reviewed: ExtractedItem[] = state.items.filter((i) => !isBlankReviewItem(i)).map((i) => {
    const docItem = doc.items.find((d) => d.drawingNumber && docNumbersEqual(d.drawingNumber, i.drawingNumber));
    const price = supplierSide ? (names.margins ? cleanNumber(i.purchaseUnitPrice) : docItem?.unitPrice ?? 0) : cleanNumber(i.unitPrice);
    return {
      drawingNumber: i.drawingNumber.trim(),
      revision: i.revision.trim(),
      name: i.name.trim(),
      description: i.description.trim(),
      material: i.material.trim(),
      quantity: cleanNumber(i.quantity) ?? 1,
      unit: i.unit.trim() || "ks",
      unitPrice: price ?? 0,
      deliveryDate: docItem?.deliveryDate ?? "",
    };
  });
  // položky, které jen doplnily existující řádky zakázky, patří k dokladu taky
  const merged = doc.items.filter((d) => state.merges.some((m) =>
    (m.drawingNumber && d.drawingNumber && docNumbersEqual(m.drawingNumber, d.drawingNumber))
    || (!m.drawingNumber && !d.drawingNumber && normalizeCompanyName(m.label) === normalizeCompanyName(d.name))));
  out.items = [...reviewed, ...merged.filter((d) => !reviewed.some((r) => r.drawingNumber && docNumbersEqual(r.drawingNumber, d.drawingNumber)))];
  return out;
}

// ── Historie a výsledek ─────────────────────────────────────
function lowerFirst(s: string): string {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

/** Text jedné události v historii („AI přečetla objednávku zákazníka 4795-2026 a doplnila: …"). */
export function captureEventMessage(args: {
  chip: CaptureChipKey;
  aiUsed: boolean;
  documentNumber: string;
  filled: string[];
  itemsAdded: number;
  itemsMerged: number;
  pages: number;
  auto?: boolean;
}): string {
  const chip = chipByKey(args.chip);
  const num = args.documentNumber.trim();
  const parts = args.filled.map(lowerFirst);
  if (args.itemsAdded) parts.push(`${args.itemsAdded} ${plural(args.itemsAdded, "položku", "položky", "položek")}`);
  if (args.itemsMerged) {
    parts.push(`údaje u ${args.itemsMerged} ${plural(args.itemsMerged, "existující položky", "existujících položek", "existujících položek")}`);
  }
  const pages = args.pages > 1 ? ` (${args.pages} ${plural(args.pages, "stránka", "stránky", "stránek")})` : "";
  if (args.aiUsed) {
    const filled = parts.length ? ` a doplnila: ${parts.join(", ")}` : "";
    return `AI přečetla ${chip.accusative}${num ? ` ${num}` : ""}${pages}${filled}${args.auto ? " — uloženo automaticky" : ""}`;
  }
  const filled = parts.length ? ` — vyplněno: ${parts.join(", ")}` : "";
  return `Doklad zapsán ručně: ${lowerFirst(chip.label)}${num ? ` ${num}` : ""}${pages}${filled}`;
}

/** Nadpis obrazovky „Hotovo" („Uloženo do zakázky Z-2026-014 · Objednávka zákazníka · stav Objednávka"). */
export function resultHeadline(r: Pick<CaptureResult, "jobNumber" | "created" | "docLabel" | "stageTo" | "stageFrom">): string {
  const parts = [`${r.created ? "Založena zakázka" : "Uloženo do zakázky"} ${r.jobNumber ?? ""}`.trim()];
  if (r.docLabel) parts.push(r.docLabel);
  const stage = r.stageTo ?? r.stageFrom;
  if (stage) parts.push(`stav ${stageMeta(stage).label}`);
  return parts.join(" · ");
}

// ── Plná automatika ─────────────────────────────────────────
export const AUTO_MIN_CONFIDENCE = 0.85;
export const AUTO_MIN_SCORE = 90;

/**
 * Smí se doklad uložit bez kontroly (režim „plná automatika")? Jen když AI četla
 * s jistotou ≥ 85 %, nic nehlásí k ověření, druh dokladu sedí a buď je zakázka
 * jasná (shoda ≥ 90 / pevná zakázka), nebo jde jistě o novou zakázku (žádná
 * podobná a zákazník známý nebo s IČO).
 */
export function canAutoApply(model: Pick<ReviewModel,
  "aiUsed" | "mode" | "confidence" | "needsClarification" | "chipExact" | "targets" | "fixedJobId" | "initial">,
): boolean {
  if (model.mode !== "full" || !model.aiUsed) return false;
  if ((model.confidence ?? 0) < AUTO_MIN_CONFIDENCE || model.needsClarification.length || !model.chipExact) return false;
  const target = model.targets.find((t) => t.key === model.initial.targetKey);
  if (!target) return false;
  if (target.mode === "existing") {
    return Boolean(model.fixedJobId && target.jobId === model.fixedJobId) || (target.score ?? 0) >= AUTO_MIN_SCORE;
  }
  if (model.targets.some((t) => t.mode === "existing")) return false;
  const c = model.initial.customer;
  if (c.mode === "existing") return c.reason !== null && !/podobný název/.test(c.reason);
  if (c.mode === "new") return Boolean(c.party.name.trim() && c.party.ico.trim());
  return false;
}

// ── Kontrola odeslaného formuláře (server) ──────────────────
const PARTY_KEYS: (keyof ExtractedParty)[] = ["name", "ico", "dic", "street", "city", "zip", "country", "email", "phone", "contactPerson"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" && Number.isFinite(v) ? String(v) : "";
}

function cleanParty(raw: unknown): ExtractedParty {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = {} as ExtractedParty;
  for (const k of PARTY_KEYS) out[k] = str(o[k], k === "name" ? 300 : 200);
  return out;
}

function cleanChoice(raw: unknown, what: string): PartyChoice | string {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!o || o.mode === "none") return { mode: "none" };
  if (o.mode === "existing") {
    if (!isUuid(o.id)) return `Neplatný výběr: ${what}.`;
    return { mode: "existing", id: o.id.toLowerCase(), name: str(o.name, 300), reason: typeof o.reason === "string" ? o.reason.slice(0, 300) : null };
  }
  if (o.mode === "new") {
    const party = cleanParty(o.party);
    if (!party.name) return `Doplň název — ${what}.`;
    if (party.email && !EMAIL_RE.test(party.email)) return `Neplatný e-mail — ${what}.`;
    return { mode: "new", party };
  }
  return `Neplatný výběr: ${what}.`;
}

function cleanItem(raw: unknown, i: number): ReviewItem | string {
  if (!raw || typeof raw !== "object") return `Položka ${i + 1} je neplatná.`;
  const o = raw as Record<string, unknown>;
  const it: ReviewItem = {
    key: str(o.key, 60) || `row-${i}`,
    drawingNumber: str(o.drawingNumber, 200),
    revision: str(o.revision, 50),
    name: str(o.name, 500),
    material: str(o.material, 200),
    quantity: str(o.quantity, 30),
    unit: str(o.unit, 20),
    unitPrice: str(o.unitPrice, 30),
    purchaseUnitPrice: str(o.purchaseUnitPrice, 30),
    description: str(o.description, 5000),
    note: str(o.note, 2000),
    aiFilled: o.aiFilled === true,
  };
  if (isBlankReviewItem(it)) return it;
  if (it.quantity) {
    const q = cleanNumber(it.quantity);
    if (q === null || q <= 0 || q > 1e9) return `Položka ${i + 1}: množství musí být kladné číslo.`;
  }
  for (const p of [it.unitPrice, it.purchaseUnitPrice]) {
    if (!p) continue;
    const n = cleanNumber(p);
    if (n === null || n < 0 || n > 1e11) return `Položka ${i + 1}: neplatná cena.`;
  }
  return it;
}

/**
 * Kontrola a úklid stavu formuláře z prohlížeče (nic se mu nevěří).
 * fixedJobId = doklad se nahrával u konkrétní zakázky → cíl musí sedět.
 */
export function sanitizeReviewState(
  raw: unknown,
  opts: { fixedJobId?: string | null } = {},
): { ok: true; state: ReviewState } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Chybí údaje formuláře." };
  const o = raw as Record<string, unknown>;
  if (!isCaptureChipKey(o.chip)) return { ok: false, error: "Vyber, co je to za doklad." };
  const chip = chipByKey(o.chip);
  const issuer: DocIssuer = chip.issuer ?? (isDocIssuer(o.issuer) ? o.issuer : "neznamy");
  const fileKind: JobFileKind = isJobFileKind(o.fileKind) ? o.fileKind : chip.fileKind;

  const targetKey = typeof o.targetKey === "string" ? o.targetKey.toLowerCase() : "";
  if (targetKey !== "new" && !isUuid(targetKey)) return { ok: false, error: "Vyber zakázku, ke které doklad patří." };
  if (opts.fixedJobId && targetKey !== opts.fixedJobId.toLowerCase()) {
    return { ok: false, error: "Doklad patří k zakázce, u které se nahrával." };
  }

  const customer = cleanChoice(o.customer, "zákazník");
  if (typeof customer === "string") return { ok: false, error: customer };
  const supplier = cleanChoice(o.supplier, "dodavatel");
  if (typeof supplier === "string") return { ok: false, error: supplier };

  const fields: FieldValues = {};
  const rawFields = o.fields && typeof o.fields === "object" ? (o.fields as Record<string, unknown>) : {};
  for (const key of REVIEW_FIELD_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(rawFields, key)) continue;
    const m = REVIEW_FIELDS[key];
    const v = str(rawFields[key], 10_000);
    if (v.length > m.max) return { ok: false, error: `Pole „${m.label}" je příliš dlouhé (max. ${m.max} znaků).` };
    if (v) {
      if (m.type === "date" && !cleanDate(v)) return { ok: false, error: `Neplatné datum v poli „${m.label}".` };
      if (m.type === "money") {
        const n = cleanNumber(v);
        if (n === null || n < 0 || n > 1e12) return { ok: false, error: `Pole „${m.label}" musí být číslo.` };
      }
      if (m.type === "email" && !EMAIL_RE.test(v)) return { ok: false, error: `Neplatný e-mail v poli „${m.label}".` };
      if (m.type === "currency" && !/^[A-Za-z]{3}$/.test(v)) return { ok: false, error: "Měna musí být třípísmenný kód (CZK, EUR…)." };
    }
    fields[key] = v;
  }

  const rawItems = Array.isArray(o.items) ? o.items : [];
  if (rawItems.length > 500) return { ok: false, error: "Příliš mnoho položek (max. 500)." };
  const items: ReviewItem[] = [];
  for (let i = 0; i < rawItems.length; i++) {
    const it = cleanItem(rawItems[i], i);
    if (typeof it === "string") return { ok: false, error: it };
    if (!isBlankReviewItem(it)) items.push(it);
  }

  const merges: ReviewMerge[] = [];
  for (const m of Array.isArray(o.merges) ? o.merges.slice(0, 500) : []) {
    if (!m || typeof m !== "object") continue;
    const r = m as Record<string, unknown>;
    if (!isUuid(r.itemId)) continue;
    const rawPatch = r.patch && typeof r.patch === "object" ? (r.patch as Record<string, unknown>) : {};
    const patch: Partial<Record<MergeField, string>> = {};
    for (const f of Object.keys(MERGE_FIELD_LABELS) as MergeField[]) {
      const v = str(rawPatch[f], f === "name" ? 500 : 200);
      if (v) patch[f] = v;
    }
    merges.push({
      itemId: r.itemId.toLowerCase(),
      label: str(r.label, 300),
      drawingNumber: str(r.drawingNumber, 200),
      patch,
      apply: r.apply !== false,
    });
  }

  let stage: JobStage | "keep" = o.stage === "keep" ? "keep" : isJobStage(o.stage) ? o.stage : "keep";
  if (targetKey === "new" && stage === "keep") stage = docKindToStage(chip.docKind, issuer) ?? "poptavka";

  return {
    ok: true,
    state: {
      chip: chip.key,
      docKind: chip.docKind,
      issuer,
      fileKind,
      targetKey,
      customer,
      supplier,
      fields,
      items,
      merges,
      stage,
      docNote: str(o.docNote, 2000),
    },
  };
}
