import type { JobFileKind, JobStage } from "@/lib/supabase/database.types";
import { initialSpecState, materialDifference, sanitizeSpecState } from "@/lib/jobs/drawing-spec";
import type { CaptureDocKind, ExtractedBusinessDoc, ExtractedItem, ExtractedParty } from "@/lib/jobs/capture-types";
import type {
  BatchApplyState, BatchDocExtract, BatchDocReview, BatchDocType, BatchGroupReview, BatchGroupState, BatchPage,
  BatchReviewModel, BatchSort, BatchWarning, BusinessDocState, DocApplyState, DocExtractSummary, DocFlag,
  DrawingExtract, DrawingReviewState, DuplicateRef, FieldSource, FileReviewState, ItemLinkChoice, ItemOption,
  ModelMeta, ModelReviewState, SupplierQuoteLineState,
} from "@/lib/jobs/capture-batch-types";
import {
  BATCH_TYPES, batchStage, batchTypeFor, cleanDrawingNumbers, distinctJobCount, drawingNumbersOf, isBatchDocType, isBusinessType, makeWarning,
  isSupplierInvoiceType, pagesKey, redactPrices, safeDocNumber, sideOf, uniqueWarnings, validateBatchSort,
} from "@/lib/jobs/capture-batch";
import {
  CHIP_FIELDS, MERGE_FIELD_LABELS, REVIEW_FIELDS, REVIEW_FIELD_KEYS, buildExistingTarget, buildNewTarget, chipFor,
  defaultSupplierChoice, initialReviewState, itemInputToReview, openPairQuestions,
  sanitizeReviewState, type CaptureChipKey, type FieldValues, type MergeField, type PartyChoice, type PartyMatchView,
  type ReviewFieldKey, type ReviewItem, type ReviewState, type ReviewTarget, type TargetJob,
} from "@/lib/jobs/capture-review";
import { docFieldValues, planJobUpdate, planNewJob, type JobUpdatePlan, type NewJobPlan } from "@/lib/jobs/apply-extraction";
import { docNumbersEqual, nameSimilarity, normalizeCompanyName } from "@/lib/jobs/matching";
import { PAIR_SURE, pairDocLines, scoreLinePair } from "@/lib/jobs/item-pairing";
import { emptyExtracted, emptyParty } from "@/lib/jobs/extracted-normalize";
import { guessFileKind, isJobFileKind } from "@/lib/jobs/file-kinds";
import { cleanDate, cleanNumber, isUuid } from "@/lib/jobs/mapping";
import { CLOSED_STAGES, DELIVERED_STAGES, stageRank } from "@/lib/jobs/stages";
import {
  deadlineMessage, inquiryTermsOfDoc, orderDeadline, quoteTermsOfDoc, staleQuoteMessage, unrealisticText,
  type InquiryTerms, type OrderDeadline, type QuoteTerms, type UnrealisticReason,
} from "@/lib/jobs/order-deadline";
import type { JobInput, JobItem } from "@/lib/jobs/types";

/**
 * Dávkové focení — seskupení dokladů do zakázek a vzájemné doplnění údajů (čisté funkce).
 * Pravidla: doklad jiného zákazníka nikdy nespadne do cizí zakázky; položky zakázky přidává jen
 * primární doklad skupiny (ostatní jen párují a doplňují prázdné údaje); údaje se doplňují jen
 * v rámci strany (zákaznické × dodavatelské); stav jen dopředu; bez práva na marže žádné nákupní ceny.
 * Balík (ZIP, později e-mail s přílohami) = jeden zákazník. Firma z razítka výkresu se ignoruje —
 * výkres se páruje jen čísly (výkresu, objednávky, nabídky). Počty kusů: vždy platí objednávka.
 */

// ── Vstupy ──────────────────────────────────────────────────
export interface StrongMatch { jobId: string; jobNumber: string; reason: string; score: number }

/** Doklad dávky pro seskupení (data relace v DB + výsledek vytěžení). */
export interface ReconcileDoc {
  id: string;
  type: BatchDocType;
  flags: DocFlag[];
  documentNumber: string;
  drawingNumbers: string[];
  title: string;
  /** Název (prvního) souboru dokladu. */
  filename: string;
  /** Druh z roztřídění AI (null = ruční). */
  aiType: BatchDocType | null;
  extract: BatchDocExtract | null;
  aiUsed: boolean;
  /** Proč bez AI / chyba vytěžení. */
  reason: string | null;
  confidence: number | null;
  customerMatch: PartyMatchView | null;
  supplierMatch: PartyMatchView | null;
  /** Shoda s existující zakázkou podle přesného čísla (skóre ≥ 88); u výkresu / modelu podle čísla výkresu. */
  strongMatch: StrongMatch | null;
  /** Balík, ze kterého doklad pochází (ZIP, e-mail…) — doklady balíku = jeden zákazník. */
  bundleKey?: string | null;
  /** Výkres / model: víc otevřených zakázek se stejným číslem (bez silné shody) — jen návrh. */
  jobHints?: StrongMatch[];
}

export const STRONG_MATCH_SCORE = 88;
const SAME_NAME = 0.8;
const MAYBE_NAME = 0.5;

/** Pořadí primárního dokladu skupiny (zakázka, zákazník, položky). */
export const PRIMARY_ORDER: BatchDocType[] = [
  "objednavka_zakaznik", "poptavka_zakaznik", "nabidka_my", "potvrzeni_my", "dodaci_list_my", "faktura_my",
];
const SUPPLIER_PRIMARY: BatchDocType[] = [
  "potvrzeni_dodavatel", "dodaci_list_dodavatel", "faktura_dodavatel", "objednavka_my", "nabidka_dodavatel", "poptavka_my",
];

/**
 * IČO pro porovnání: jen číslice, kratší než 8 doplněné úvodními nulami (4304080 = 04304080 — stejně jako
 * icoKey v customers.ts, který úvodní nuly ignoruje). Delší zůstane (neplatné IČO).
 */
function digits(v: string | null | undefined): string {
  const d = (v ?? "").replace(/\D+/g, "");
  return d && d.length < 8 ? d.padStart(8, "0") : d;
}

/** České IČO: přesně 8 číslic (po doplnění úvodních nul) a kontrolní číslice podle mod 11 (váhy 8…2). */
export function isIcoChecksumValid(v: string | null | undefined): boolean {
  const d = digits(v);
  if (d.length !== 8) return false;
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += Number(d[i]) * (8 - i);
  const r = sum % 11;
  const check = r === 0 ? 1 : r === 1 ? 0 : 11 - r;
  return Number(d[7]) === check;
}

/** Editační vzdálenost ≤ 1 (jedna jiná / chybějící / přebývající číslice). */
function withinOneEdit(x: string, y: string): boolean {
  if (Math.abs(x.length - y.length) > 1) return false;
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  if (x.length === y.length) return x.slice(i + 1) === y.slice(i + 1);
  return x.length > y.length ? x.slice(i + 1) === y.slice(i) : x.slice(i) === y.slice(i + 1);
}

/**
 * Odlišné IČO, které NENÍ silný důkaz jiného zákazníka (spíš chyba čtení): jedno neprojde kontrolním
 * součtem / nemá 8 číslic, nebo se liší o jednu číslici (i chybějící / přebývající) či přehozením dvou
 * sousedních číslic. Silný důkaz = dvě platná IČO, která se liší víc.
 */
export function isWeakIcoClash(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = digits(a);
  const y = digits(b);
  if (!x || !y || x === y) return false;
  if (!isIcoChecksumValid(x) || !isIcoChecksumValid(y)) return true;
  const rx = (a ?? "").replace(/\D+/g, "");
  const ry = (b ?? "").replace(/\D+/g, "");
  if (withinOneEdit(x, y) || withinOneEdit(rx, ry)) return true;
  const diff: number[] = [];
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) diff.push(i);
  return diff.length === 2 && diff[1] === diff[0] + 1 && x[diff[0]] === y[diff[1]] && x[diff[1]] === y[diff[0]];
}

function businessDoc(d: Pick<ReconcileDoc, "extract">): ExtractedBusinessDoc | null {
  return d.extract?.kind === "business" ? d.extract.doc : null;
}

function drawingOf(d: Pick<ReconcileDoc, "extract">): DrawingExtract | null {
  return d.extract?.kind === "drawing" ? d.extract.drawing : null;
}

function modelOf(d: Pick<ReconcileDoc, "extract">): ModelMeta | null {
  return d.extract?.kind === "model" ? d.extract.model : null;
}

/** Primární doklad skupiny (null = skupina bez obchodního dokladu). */
export function primaryDocId(docs: Pick<ReconcileDoc, "id" | "type">[]): string | null {
  for (const t of PRIMARY_ORDER) {
    const d = docs.find((x) => x.type === t);
    if (d) return d.id;
  }
  for (const t of SUPPLIER_PRIMARY) {
    const d = docs.find((x) => x.type === t);
    if (d) return d.id;
  }
  return null;
}

/** Identita zákazníka zákaznického dokladu (IČO, jinak normalizovaný název; "" = neznámý). */
export function partyKey(party: Pick<ExtractedParty, "ico" | "name"> | null | undefined, ourIco: string): string {
  if (!party) return "";
  const ico = digits(party.ico);
  if (ico && ico !== digits(ourIco)) return `ico:${ico}`;
  const name = normalizeCompanyName(party.name);
  return name ? `name:${name}` : "";
}

function customerParty(d: ReconcileDoc, ourIco: string): ExtractedParty | null {
  const doc = businessDoc(d);
  if (!doc) return null;
  const p = doc.customer;
  if (digits(p.ico) && digits(p.ico) === digits(ourIco)) return null;
  return p.name.trim() || digits(p.ico) ? p : null;
}

/** Všechna čísla výkresu / modelu (výkres často nese 2 — číslo výkresu a číslo dílu zákazníka). */
export function ownDrawingNumbers(d: Pick<ReconcileDoc, "type" | "documentNumber" | "drawingNumbers" | "extract">): string[] {
  const dr = drawingOf(d);
  const m = modelOf(d);
  return cleanDrawingNumbers([
    ...drawingNumbersOf(dr), m?.drawingNumber ?? "",
    (d.type === "vykres" || d.type === "model_3d") ? d.documentNumber : "", ...d.drawingNumbers,
  ]);
}

function docDrawingNumbers(d: ReconcileDoc): string[] {
  const out = [...d.drawingNumbers];
  const b = businessDoc(d);
  if (b) for (const it of b.items) if (it.drawingNumber) out.push(it.drawingNumber);
  if (!b) out.push(...ownDrawingNumbers(d));
  return out.filter(Boolean);
}

/** Číslo, kterým výkres sedí na položku (kterékoli z jeho čísel); "" = nesedí. */
function sharedNumber(nums: string[], itemNumber: string | null | undefined): string {
  if (!itemNumber) return "";
  return nums.find((n) => docNumbersEqual(n, itemNumber)) ?? "";
}

/** Zakázka pro párování výkresu (podmnožina JobMatchCandidate). */
export interface DrawingMatchJob {
  id: string; number: string; stage: JobStage; drawingNumbers: string[]; quoteNumbers: string[];
  customerOrderNumber: string | null;
}

/**
 * Výkres / model bez obchodního dokladu → existující zakázka podle čísel na listu (firma z razítka se
 * nepoužívá): naše nabídka / objednávka zákazníka na listu, jinak číslo výkresu v položkách. Jen otevřené
 * zakázky; jediná = silná shoda, víc = jen návrh (hints), žádná = cíl vybere člověk.
 */
export function drawingJobMatch(
  numbers: string[],
  refs: { customerOrderNumber?: string; ourQuoteNumber?: string },
  jobs: DrawingMatchJob[],
): { strong: StrongMatch | null; hints: StrongMatch[] } {
  const open = jobs.filter((j) => !CLOSED_STAGES.includes(j.stage) && !DELIVERED_STAGES.includes(j.stage));
  const one = (hits: DrawingMatchJob[], reason: string, score: number): StrongMatch | null =>
    hits.length === 1 ? { jobId: hits[0].id, jobNumber: hits[0].number, reason, score } : null;
  if (refs.ourQuoteNumber) {
    const q = refs.ourQuoteNumber;
    const hit = one(open.filter((j) => j.quoteNumbers.some((n) => docNumbersEqual(n, q))), `podle čísla nabídky ${q}`, 95);
    if (hit) return { strong: hit, hints: [] };
  }
  if (refs.customerOrderNumber) {
    const po = refs.customerOrderNumber;
    const hit = one(open.filter((j) => j.customerOrderNumber && docNumbersEqual(j.customerOrderNumber, po)), `podle čísla objednávky ${po}`, 92);
    if (hit) return { strong: hit, hints: [] };
  }
  const hits = open
    .map((j) => ({ j, n: numbers.find((n) => j.drawingNumbers.some((x) => docNumbersEqual(x, n))) ?? "" }))
    .filter((h) => h.n);
  if (hits.length === 1) {
    return { strong: { jobId: hits[0].j.id, jobNumber: hits[0].j.number, reason: `podle čísla výkresu ${hits[0].n}`, score: 90 }, hints: [] };
  }
  return {
    strong: null,
    hints: hits.length > 1 ? hits.slice(0, 5).map((h) => ({ jobId: h.j.id, jobNumber: h.j.number, reason: `stejné číslo výkresu ${h.n}`, score: 50 })) : [],
  };
}

function shareDrawing(a: string[], b: string[]): boolean {
  return a.some((x) => b.some((y) => docNumbersEqual(x, y)));
}

const KIND_GENITIVE: Record<CaptureDocKind, string> = {
  poptavka: "poptávky", nabidka: "nabídky", objednavka: "objednávky", potvrzeni: "potvrzení",
  dodaci_list: "dodacího listu", faktura: "faktury", vykres: "výkresu", ostatni: "dokladu",
};

/** „z faktury FV-118" */
export function sourceLabel(d: Pick<ReconcileDoc, "type" | "documentNumber">): string {
  const meta = BATCH_TYPES[d.type];
  const what = meta?.docKind ? KIND_GENITIVE[meta.docKind] : d.type === "model_3d" ? "3D modelu" : "dokladu";
  return `z ${what}${d.documentNumber ? ` ${d.documentNumber}` : ""}`;
}

function docLabel(d: Pick<ReconcileDoc, "type" | "documentNumber">): string {
  return `${BATCH_TYPES[d.type].label}${d.documentNumber ? ` ${d.documentNumber}` : ""}`;
}

// ── Seskupení ───────────────────────────────────────────────
export interface GroupDraft {
  key: string;
  docIds: string[];
  /** Cíl ze silné shody / pevné zakázky (null = podle párování nebo nová). */
  targetJobId: string | null;
  /** Skupina jen s dodavatelskými doklady / výkresy bez silné shody → cíl musí vybrat člověk. */
  targetRequired: boolean;
  autoReason: string | null;
  customerName: string;
  /** Identita zákazníka skupiny. */
  partyKey: string;
  /** Zákaznické doklady skupiny jsou z jednoho balíku (ZIP…) = jeden zákazník, potvrzovat netřeba. */
  customerConfirmed?: boolean;
}

export interface GroupBatchInput {
  docs: ReconcileDoc[];
  ourIco: string;
  fixedJobId?: string | null;
  /** Uživatelské přiřazení docId → klíč skupiny („g2") nebo "new". */
  assign?: Record<string, string>;
  /** Skupiny, u kterých uživatel potvrdil „Je to stejný zákazník". */
  customerConfirmed?: string[];
}

interface WorkGroup extends GroupDraft {
  icos: Set<string>;
  names: string[];
  drawings: string[];
  primaryTypes: Map<BatchDocType, string>;
  conflictDocIds: string[];
  /** Zákazník psán jinak (bez IČO, podobnost názvu) — jen upozornění, skupina se nedělí. */
  nameNotes: { docId: string; name: string; similar: boolean }[];
  /** Další objednávka / poptávka s jiným číslem ve stejné skupině (výchozí 1 zakázka, rozdělení 1 ťuknutím). */
  extraPrimary: string[];
  /** Balíky (ZIP…), ze kterých má skupina doklady. */
  bundles: Set<string>;
  /**
   * Balíky, jejichž další zákaznické doklady jdou ke skupině bez porovnání zákazníka: skupinu založil
   * doklad balíku, nebo se k ní doklad balíku přidal podle shody IČO / názvu (ne jen „neznámý zákazník").
   */
  bundleOk: Set<string>;
  /** Vlastní čísla zákaznických dokladů skupiny (objednávka, poptávka, naše nabídka). */
  ownNumbers: string[];
  /** Čísla, na která doklady skupiny odkazují (objednávka → naše nabídka…). */
  refNumbers: string[];
}

const PRIMARY_KIND_WORD: Partial<Record<BatchDocType, string>> = { objednavka_zakaznik: "objednávka", poptavka_zakaznik: "poptávka" };

/** Vlastní čísla zákaznického dokladu (nabídka NAB-6, objednávka PO-…, poptávka). */
function ownNumbersOf(d: ReconcileDoc): string[] {
  const b = businessDoc(d);
  const out = [d.documentNumber, b?.documentNumber ?? ""];
  if (b && d.type === "nabidka_my") out.push(b.ourQuoteNumber);
  if (b && d.type === "objednavka_zakaznik") out.push(b.customerOrderNumber);
  if (b && d.type === "poptavka_zakaznik") out.push(b.customerInquiryNumber);
  return out.map((x) => (x ?? "").trim()).filter(Boolean);
}

/** Čísla jiných dokladů, na která doklad odkazuje (objednávka → NAB-6, nabídka → poptávka…). */
function refNumbersOf(d: ReconcileDoc): string[] {
  const b = businessDoc(d);
  if (!b) return [];
  const own = ownNumbersOf(d);
  return [b.ourQuoteNumber, b.customerOrderNumber, b.customerInquiryNumber]
    .map((x) => (x ?? "").trim())
    .filter((n) => n && !own.some((o) => docNumbersEqual(o, n)));
}

/** Doklad a skupina na sebe odkazují čísly (objednávka PO-4480 „dle NAB-6" ↔ nabídka NAB-6). */
function refersTo(g: Pick<WorkGroup, "ownNumbers" | "refNumbers">, d: ReconcileDoc): boolean {
  const eq = (a: string[], b: string[]) => a.some((x) => b.some((y) => docNumbersEqual(x, y)));
  return eq(ownNumbersOf(d), g.refNumbers) || eq(refNumbersOf(d), g.ownNumbers);
}

/** Druhá objednávka / poptávka s jiným číslem (ve stejné skupině jen upozornění „Rozdělit"). */
function primaryClash(g: Pick<WorkGroup, "primaryTypes">, d: Pick<ReconcileDoc, "type" | "documentNumber">): boolean {
  return (d.type === "objednavka_zakaznik" || d.type === "poptavka_zakaznik") && g.primaryTypes.has(d.type)
    && !docNumbersEqual(g.primaryTypes.get(d.type) ?? "", d.documentNumber);
}

/** Přiřazení „new:<docId>" = nová skupina vedená tímto dokladem (rozdělení víc dokladů najednou). */
export const NEW_GROUP_ASSIGN = /^new:(d\d{1,4}|u-[a-z0-9]{8})$/;

/**
 * Rozdělí dávku na skupiny zakázek. JEDNO NAHRÁNÍ = S NEJVYŠŠÍ PRAVDĚPODOBNOSTÍ JEDNA ZAKÁZKA: výchozí je
 * jedna skupina; samo se rozdělí jen při silném důkazu — (a) odlišné IČO zákazníka na obou dokladech,
 * (b) silná shoda dokladů na dvě různé existující zakázky, (c) pevná zakázka + doklad se silnou shodou
 * jinam. Druhá objednávka / poptávka s jiným číslem téhož (nebo nerozlišitelného) zákazníka zůstane ve
 * skupině s upozorněním a akcí „Rozdělit na samostatné zakázky"; zákazník psán jinak bez IČO = jen
 * upozornění (bere se zákazník primárního dokladu). Dodavatelské doklady ke shodě / skupině se stejným
 * výkresem; výkresy, modely, fotky ke skupině s kterýmkoli z jejich čísel, jinak k existující zakázce podle
 * čísla výkresu (silná shoda). Balík (ZIP…) = jeden zákazník i při odlišném IČO.
 */
export function groupBatch(input: GroupBatchInput): { groups: GroupDraft[]; warnings: BatchWarning[] } {
  const { docs, ourIco } = input;
  const fixed = input.fixedJobId ?? null;
  const confirmed = new Set(input.customerConfirmed ?? []);
  const warnings: BatchWarning[] = [];
  const groups: WorkGroup[] = [];
  let seq = 0;
  const newGroup = (key?: string): WorkGroup => {
    let k = key;
    if (!k) {
      do { k = `g${++seq}`; } while (groups.some((g) => g.key === k));
    }
    const g: WorkGroup = {
      key: k, docIds: [], targetJobId: null, targetRequired: false, autoReason: null, customerName: "", partyKey: "",
      icos: new Set(), names: [], drawings: [], primaryTypes: new Map(), conflictDocIds: [], nameNotes: [], extraPrimary: [],
      bundles: new Set(), bundleOk: new Set(), ownNumbers: [], refNumbers: [],
    };
    groups.push(g);
    return g;
  };
  const add = (g: WorkGroup, d: ReconcileDoc) => {
    g.docIds.push(d.id);
    if (d.bundleKey) g.bundles.add(d.bundleKey);
    g.drawings.push(...docDrawingNumbers(d));
    const p = customerParty(d, ourIco);
    if (p && sideOf(d.type) === "customer") {
      const ico = digits(p.ico);
      if (ico) g.icos.add(ico);
      if (p.name.trim()) g.names.push(p.name.trim());
      if (!g.customerName && p.name.trim()) g.customerName = p.name.trim();
      if (!g.partyKey) g.partyKey = partyKey(p, ourIco);
    }
    if (d.type === "objednavka_zakaznik" || d.type === "poptavka_zakaznik") {
      if (!g.primaryTypes.has(d.type)) g.primaryTypes.set(d.type, d.documentNumber);
    }
    if (isBusinessType(d.type) && sideOf(d.type) === "customer") {
      g.ownNumbers.push(...ownNumbersOf(d));
      g.refNumbers.push(...refNumbersOf(d));
    }
  };
  const byId = new Map(docs.map((d) => [d.id, d]));

  // 1–3) zákaznické doklady podle zákazníka a druhé objednávky / poptávky
  const customerDocs = docs.filter((d) => isBusinessType(d.type) && sideOf(d.type) === "customer");
  const sorted = [...customerDocs].sort((a, b) => PRIMARY_ORDER.indexOf(a.type) - PRIMARY_ORDER.indexOf(b.type));
  // doklad balíku bez čitelného zákazníka (nebo s naším IČO) až nakonec — ke skupině svého balíku, ne k cizímu dokladu
  const unknownInBundle = (d: ReconcileDoc) => Boolean(d.bundleKey) && !customerParty(d, ourIco);
  const ordered = [...sorted.filter((d) => !unknownInBundle(d)), ...sorted.filter(unknownInBundle)];
  for (const d of ordered) {
    const p = customerParty(d, ourIco);
    const ico = digits(p?.ico);
    // balík = jeden zákazník (i s jiným IČO); jinak se dělí jen odlišné IČO na obou dokladech
    const sameBundle = (g: WorkGroup) => Boolean(d.bundleKey) && g.bundleOk.has(d.bundleKey!);
    const icoClash = (g: WorkGroup) => Boolean(ico) && g.icos.size > 0 && !g.icos.has(ico);
    const compatible = groups.filter((g) => sameBundle(g) || !icoClash(g));
    // odkaz čísly (objednávka „dle nabídky 136/026" ↔ nabídka 136/026) je silnější než jinak přečtené IČO:
    // doklad jde do odkazované skupiny, ale k potvrzení „Ano, jedna zakázka / Rozdělit" (conflictDocIds)
    const refClash = compatible.some((g) => refersTo(g, d)) ? null : groups.find((g) => icoClash(g) && !sameBundle(g) && refersTo(g, d)) ?? null;
    // IČO se liší jen slabě (neprojde součtem mod 11 / nemá 8 číslic / jedna jiná, chybějící či přebývající
    // číslice / přehozené sousední číslice) NEBO stejný (podobný) název zákazníka → slabý důkaz i bez společného
    // výkresu: ke skupině, jen s blokujícím dotazem „Ano, jedna zakázka / Rozdělit" (conflictDocIds). Silný důkaz
    // pro rozdělení = jen dvě platná, výrazně odlišná IČO s jiným názvem.
    const dNums = docDrawingNumbers(d);
    const sameName = (g: WorkGroup) => Boolean(p?.name.trim()) && g.names.some((n) => nameSimilarity(n, p!.name) >= SAME_NAME);
    const weakGroups = refClash ? [] : groups.filter((g) => icoClash(g) && !sameBundle(g)
      && ([...g.icos].every((x) => isWeakIcoClash(x, ico)) || sameName(g)));
    const weakIco = weakGroups.find((g) => dNums.length > 0 && shareDrawing(dNums, g.drawings)) ?? weakGroups[0] ?? null;
    // přednost: skupina, jejíž doklady na tento odkazují (objednávka „dle NAB-6" ↔ nabídka NAB-6), balík, IČO
    const target = compatible.find((g) => refersTo(g, d)) ?? refClash ?? compatible.find(sameBundle)
      ?? compatible.find((g) => Boolean(ico) && g.icos.has(ico)) ?? weakIco ?? compatible[0] ?? null;
    if (target && (target === refClash || target === weakIco)) target.conflictDocIds.push(d.id);
    if (!target) {
      const g = newGroup();
      if (d.bundleKey) g.bundleOk.add(d.bundleKey);
      if (groups.length > 1) {
        const other = groups.find((x) => x !== g && x.icos.size)?.icos;
        g.autoReason = `jiný zákazník — IČO ${ico}${p?.name ? ` (${p.name.trim()})` : ""}${other ? ` × IČO ${[...other][0]}` : ""}`;
      }
      add(g, d);
      continue;
    }
    if (primaryClash(target, d)) target.extraPrimary.push(d.id);
    else if (p && target !== refClash && target !== weakIco && !sameBundle(target) && !(ico && target.icos.has(ico)) && target.names.length) {
      // zákazník psán jinak (bez IČO na jednom z dokladů) — jedna zakázka, jen upozornění
      const sim = Math.max(0, ...target.names.map((n) => nameSimilarity(n, p.name)));
      if (sim < SAME_NAME) target.nameNotes.push({ docId: d.id, name: p.name.trim(), similar: sim >= MAYBE_NAME });
    }
    // shoda zákazníka ověřená balíkem / IČO / názvem → zbytek balíku už bez porovnání
    if (d.bundleKey && (sameBundle(target) || (ico && target.icos.has(ico)) || (p && target.names.some((n) => nameSimilarity(n, p.name) >= SAME_NAME)))) {
      target.bundleOk.add(d.bundleKey);
    }
    add(target, d);
  }

  // řetězec odkazů čísly (objednávka „dle 136/026" → nabídka 136/026 „Vaše poptávka RFQ-77" → poptávka RFQ-77)
  // = jedna zakázka i přes jiné IČO: skupiny spojené odkazem se sloučí (tranzitivně, i když se doklady zpracovaly
  // v pořadí, kdy na sebe ještě neodkazovaly); doklady s jiným IČO k potvrzení „Ano, jedna zakázka / Rozdělit"
  const linked = (a: WorkGroup, b: WorkGroup) => b.docIds.some((id) => refersTo(a, byId.get(id)!));
  for (let again = true; again;) {
    again = false;
    for (let i = 0; i < groups.length && !again; i++) {
      for (let j = i + 1; j < groups.length && !again; j++) {
        const a = groups[i];
        const b = groups[j];
        if (!linked(a, b) && !linked(b, a)) continue;
        const icosA = new Set(a.icos);
        for (const id of b.docIds) {
          const d = byId.get(id)!;
          const ico = digits(customerParty(d, ourIco)?.ico);
          const inBundle = Boolean(d.bundleKey) && a.bundleOk.has(d.bundleKey!);
          if (ico && icosA.size && !icosA.has(ico) && !inBundle) a.conflictDocIds.push(id);
          if (primaryClash(a, d)) a.extraPrimary.push(id);
          add(a, d);
        }
        a.conflictDocIds = [...new Set([...a.conflictDocIds, ...b.conflictDocIds])];
        a.extraPrimary = [...new Set([...a.extraPrimary, ...b.extraPrimary])];
        a.nameNotes.push(...b.nameNotes.filter((n) => !a.conflictDocIds.includes(n.docId)));
        for (const k of b.bundleOk) a.bundleOk.add(k);
        groups.splice(j, 1);
        again = true;
      }
    }
  }

  // cíle skupin: hlavní skupina = pevná zakázka; jinak silná shoda primárního dokladu, jinak jiného dokladu
  // (další objednávka / poptávka se silnou shodou jinam cíl skupiny neurčuje — odejde ke své zakázce, krok 4)
  groups.forEach((g, i) => {
    const gd = g.docIds.map((id) => byId.get(id)!);
    const prim = byId.get(primaryDocId(gd) ?? "") ?? null;
    const strong = (prim?.strongMatch && prim.strongMatch.score >= STRONG_MATCH_SCORE ? prim.strongMatch : null)
      ?? gd.filter((x) => !g.extraPrimary.includes(x.id)).map((x) => x.strongMatch).find((s) => s && s.score >= STRONG_MATCH_SCORE) ?? null;
    if (i === 0 && fixed) g.targetJobId = fixed;
    else if (strong) {
      g.targetJobId = strong.jobId;
      if (!g.autoReason && i > 0) g.autoReason = strong.reason;
    }
  });

  // 4) silná shoda dokladu s jinou zakázkou než zbytek skupiny → vlastní skupina
  // doklad odchází k jiné zakázce než zbytek nahrání → vždy ke kontrole (warn; plná automatika se nepoužije)
  const moveToStrong = (d: ReconcileDoc, from: WorkGroup | null, severity: "info" | "warn" = "warn") => {
    const s = d.strongMatch!;
    let g = groups.find((x) => x.targetJobId === s.jobId) ?? null;
    if (!g) {
      g = newGroup();
      g.targetJobId = s.jobId;
      g.autoReason = s.reason;
    }
    if (from) {
      from.docIds = from.docIds.filter((id) => id !== d.id);
      from.extraPrimary = from.extraPrimary.filter((id) => id !== d.id);
      from.nameNotes = from.nameNotes.filter((n) => n.docId !== d.id);
    }
    add(g, d);
    const main = from ?? groups[0];
    if (main && main !== g) {
      const mainNo = main.targetJobId ? docs.find((x) => x.strongMatch?.jobId === main.targetJobId)?.strongMatch?.jobNumber : null;
      warnings.push(makeWarning(
        "target_conflict", severity, [d.id],
        `${docLabel(d)} patří podle čísla k zakázce ${s.jobNumber} (${s.reason}).`,
        [{ kind: "move_to_group", label: `Ne, k ${mainNo ?? `zakázce ${groups.indexOf(main) + 1}`}`, docId: d.id, groupKey: main.key }],
        g.key,
      ));
    }
    return g;
  };
  for (const g of [...groups]) {
    for (const id of [...g.docIds]) {
      const d = byId.get(id)!;
      const s = d.strongMatch;
      if (!s || s.score < STRONG_MATCH_SCORE || s.jobId === g.targetJobId) continue;
      // bez cíle skupiny odejde jen další objednávka / poptávka (silná shoda = jiná existující zakázka)
      if (!g.targetJobId && !g.extraPrimary.includes(id)) continue;
      moveToStrong(d, g);
    }
  }

  // 5) dodavatelské doklady
  const supplierDocs = docs.filter((d) => isBusinessType(d.type) && sideOf(d.type) === "supplier");
  let supplierOnly: WorkGroup | null = null;
  for (const d of supplierDocs) {
    if (d.strongMatch && d.strongMatch.score >= STRONG_MATCH_SCORE && (!fixed || d.strongMatch.jobId !== fixed || groups.length)) {
      if (!(fixed && d.strongMatch.jobId === fixed && groups[0])) {
        moveToStrong(d, null);
        continue;
      }
    }
    const nums = docDrawingNumbers(d);
    const real = groups.filter((g) => g !== supplierOnly && g.docIds.length);
    const share = (x: WorkGroup) => nums.length > 0 && shareDrawing(nums, x.drawings);
    const bundleGroups = d.bundleKey ? real.filter((x) => x.bundles.has(d.bundleKey!)) : [];
    let g = bundleGroups.find(share) ?? real.find(share) ?? bundleGroups[0] ?? null;
    if (!g && real.length === 1) g = real[0];
    if (!g && real.length > 1) {
      g = real[0];
      warnings.push(makeWarning(
        "group_uncertain", "warn", [d.id],
        `${docLabel(d)} nejde jednoznačně přiřadit — zařazeno k první zakázce, zkontroluj.`,
        real.slice(1).map((x, i) => ({ kind: "move_to_group" as const, label: `Patří k zakázce ${i + 2}`, docId: d.id, groupKey: x.key })),
        g.key,
      ));
    }
    if (!g) {
      if (!supplierOnly) {
        supplierOnly = newGroup();
        if (fixed && groups.length === 1) supplierOnly.targetJobId = fixed;
        else supplierOnly.targetRequired = true;
      }
      g = supplierOnly;
    }
    add(g, d);
  }

  // 6) výkresy, modely, fotky, ostatní: podle kteréhokoli čísla (nejdřív skupiny balíku), jinak silná shoda
  //    s existující zakázkou podle čísla výkresu (i z balíku — k jiné zakázce s upozorněním „Ne, k …"),
  //    jinak první skupina balíku / dávky; víc zakázek se stejným číslem → vlastní skupina s výběrem cíle
  const strongOf = (d: ReconcileDoc) => (!fixed && d.strongMatch && d.strongMatch.score >= STRONG_MATCH_SCORE ? d.strongMatch : null);
  const loose = docs.filter((x) => !isBusinessType(x.type));
  // se silnou shodou napřed (zbytek balíku pak jde k jejich skupině)
  const looseOrdered = [...loose.filter((d) => strongOf(d)), ...loose.filter((d) => !strongOf(d))];
  for (const d of looseOrdered) {
    const nums = docDrawingNumbers(d);
    const real = groups.filter((x) => x.docIds.length);
    const share = (x: WorkGroup) => nums.length > 0 && shareDrawing(nums, x.drawings);
    const bundleGroups = d.bundleKey ? real.filter((x) => x.bundles.has(d.bundleKey!)) : [];
    let g = bundleGroups.find(share) ?? real.find(share) ?? null;
    const strong = strongOf(d);
    if (!g && strong) {
      g = bundleGroups.find((x) => x.targetJobId === strong.jobId) ?? null;
      if (!g) {
        // číslo výkresu sedí na jinou zakázku než balík → k ní; u balíku k potvrzení (warn)
        moveToStrong(d, bundleGroups[0] ?? null);
        continue;
      }
    }
    // stejné číslo u víc otevřených zakázek: mimo vlastní balík nepadat k cizí skupině
    const hinted = !fixed && (d.jobHints?.length ?? 0) > 1;
    if (!g) g = bundleGroups[0] ?? (hinted ? null : real[0]) ?? null;
    if (!g) {
      g = newGroup();
      if (fixed) g.targetJobId = fixed;
      else {
        g.targetRequired = true;
        const hints = d.jobHints ?? [];
        if (hints.length > 1) {
          warnings.push(makeWarning(
            "group_uncertain", "warn", [d.id],
            `${docLabel(d)} — stejné číslo výkresu má víc otevřených zakázek (${hints.map((h) => h.jobNumber).join(", ")}). Vyber, ke které patří.`,
            [], g.key,
          ));
        }
      }
    }
    add(g, d);
  }

  // 7) přiřazení uživatelem („new" = nová skupina, „new:<docId>" = nová skupina vedená dokladem, „g2" = ke skupině)
  const splitGroups = new Map<string, WorkGroup>();
  for (const [docId, key] of Object.entries(input.assign ?? {})) {
    const d = byId.get(docId);
    if (!d) continue;
    const from = groups.find((g) => g.docIds.includes(docId)) ?? null;
    const lead = NEW_GROUP_ASSIGN.exec(key)?.[1] ?? null;
    let to = key === "new" ? null : lead ? splitGroups.get(lead) ?? null : groups.find((g) => g.key === key) ?? null;
    if (to === from && to) continue;
    if (!to) {
      to = newGroup(key !== "new" && !lead && /^g\d{1,3}$/.test(key) && !groups.some((g) => g.key === key) ? key : undefined);
      to.autoReason = lead ? "rozděleno ručně — samostatná zakázka" : "přesunuto ručně";
      if (lead) splitGroups.set(lead, to);
      if (!isBusinessType(d.type) || sideOf(d.type) === "supplier") to.targetRequired = !fixed;
    }
    if (from) {
      from.docIds = from.docIds.filter((id) => id !== docId);
      from.conflictDocIds = from.conflictDocIds.filter((id) => id !== docId);
      from.extraPrimary = from.extraPrimary.filter((id) => id !== docId);
      from.nameNotes = from.nameNotes.filter((n) => n.docId !== docId);
    }
    // ruční sloučení dokladů s odlišným IČO zákazníka (mimo balík) → potvrdit „stejný zákazník"
    const p = customerParty(d, ourIco);
    const ico = digits(p?.ico);
    if (p && sideOf(d.type) === "customer" && ico && to.icos.size && !to.icos.has(ico) && !(d.bundleKey && to.bundles.has(d.bundleKey))) {
      to.conflictDocIds.push(docId);
    }
    add(to, d);
    if (to.docIds.some((id) => { const x = byId.get(id); return x && isBusinessType(x.type) && sideOf(x.type) === "customer"; })) to.targetRequired = false;
  }

  const out = groups.filter((g) => g.docIds.length);
  const isCustomerDoc = (id: string) => { const x = byId.get(id); return Boolean(x && isBusinessType(x.type) && sideOf(x.type) === "customer"); };
  /** Doklady, které patří k další objednávce / poptávce x (výkresy jen s jejími čísly, doklady, které na ni odkazují). */
  const relatedTo = (g: WorkGroup, x: ReconcileDoc): string[] => {
    const gd = g.docIds.map((id) => byId.get(id)!);
    const prim = gd.find((y) => y.id === primaryDocId(gd.filter((z) => !g.extraPrimary.includes(z.id)))) ?? null;
    const nums = (y: ReconcileDoc) => ({ ownNumbers: ownNumbersOf(y), refNumbers: refNumbersOf(y) });
    const out = [x.id];
    // 1) zákaznické doklady, které odkazují na x (a ne na primární doklad)
    for (const o of gd) {
      if (o.id === x.id || o.id === prim?.id || g.extraPrimary.includes(o.id) || !isBusinessType(o.type)) continue;
      if (sideOf(o.type) === "customer" && refersTo(nums(x), o) && !(prim && refersTo(nums(prim), o))) out.push(o.id);
    }
    // 2) výkresy / modely jen s čísly dokladů x (ne primárního)
    const xNums = out.flatMap((id) => docDrawingNumbers(byId.get(id)!));
    const pNums = prim ? docDrawingNumbers(prim) : [];
    for (const o of gd) {
      if (isBusinessType(o.type) || out.includes(o.id)) continue;
      const n = ownDrawingNumbers(o);
      if (n.length && shareDrawing(n, xNums) && !shareDrawing(n, pNums)) out.push(o.id);
    }
    return out;
  };
  for (const g of out) {
    if (g.conflictDocIds.length && !confirmed.has(g.key)) {
      const icos = [...g.icos].slice(0, 2).map((i) => `IČO ${i}`).join(" × ");
      warnings.push(makeWarning(
        "customer_conflict", "block", g.conflictDocIds,
        `Doklady mají různé IČO zákazníka (${icos}) — je to opravdu jedna zakázka?`,
        [
          { kind: "same_customer", label: "Ano, jedna zakázka", groupKey: g.key },
          { kind: "split_group", label: "Rozdělit na samostatné zakázky", docId: g.conflictDocIds[0], docIds: g.conflictDocIds, groupKey: g.key },
        ],
        g.key,
      ));
    }
    const primDoc = byId.get(primaryDocId(g.docIds.map((id) => byId.get(id)!).filter((y) => !g.extraPrimary.includes(y.id))) ?? "") ?? null;
    for (const id of g.extraPrimary) {
      const x = byId.get(id)!;
      const what = PRIMARY_KIND_WORD[x.type] ?? "doklad";
      const ids = relatedTo(g, x);
      warnings.push(makeWarning(
        "multiple_orders", "warn", ids,
        `Další ${what}${x.documentNumber ? ` ${x.documentNumber}` : ""} s jiným číslem${primDoc?.documentNumber ? ` než ${primDoc.documentNumber}` : ""} — uloží se do stejné zakázky (položky z ${primDoc?.documentNumber || "primárního dokladu"}). Jsou to dvě zakázky?`,
        [{ kind: "split_group", label: "Rozdělit na samostatné zakázky", docId: x.id, docIds: ids, groupKey: g.key }],
        g.key,
      ));
    }
    const base = g.names[0] ?? "";
    for (const n of g.nameNotes) {
      const ids = [n.docId];
      if (n.similar || confirmed.has(g.key)) {
        warnings.push(makeWarning(
          "customer_written_differently", "info", ids,
          `Zákazník je na dokladu napsán jinak („${n.name}" × „${base}") — bere se jako stejný zákazník.`,
          [{ kind: "split_group", label: "Rozdělit na samostatné zakázky", docId: n.docId, docIds: ids, groupKey: g.key }],
          g.key,
        ));
      } else {
        warnings.push(makeWarning(
          "customer_written_differently", "warn", ids,
          `Na dokladu je jiný název zákazníka („${n.name}" × „${base}") a chybí IČO — ukládá se do jedné zakázky se zákazníkem „${base}".`,
          [
            { kind: "same_customer", label: "Je to stejný zákazník", groupKey: g.key },
            { kind: "split_group", label: "Rozdělit na samostatné zakázky", docId: n.docId, docIds: ids, groupKey: g.key },
          ],
          g.key,
        ));
      }
    }
  }
  return {
    groups: out.map((g) => {
      const cust = g.docIds.filter(isCustomerDoc).map((id) => byId.get(id)!);
      // potvrzeno jen, když jsou VŠECHNY zákaznické doklady skupiny z jednoho balíku (doklad zvenku se porovnává)
      const bundle = cust[0]?.bundleKey ?? null;
      const oneBundle = cust.length > 1 && !g.conflictDocIds.length && Boolean(bundle) && cust.every((x) => x.bundleKey === bundle);
      return {
        key: g.key, docIds: g.docIds, targetJobId: g.targetJobId, targetRequired: g.targetRequired && !g.targetJobId,
        autoReason: g.autoReason, customerName: g.customerName, partyKey: g.partyKey,
        // potvrzení uživatele („Je to stejný zákazník", sloučení s odlišným IČO) přežije přepočet kontroly
        ...(oneBundle || confirmed.has(g.key) ? { customerConfirmed: true } : {}),
      };
    }),
    warnings: uniqueWarnings(warnings),
  };
}

/** Výkres / model dávky → existující zakázka podle čísel na listu (ostatní druhy: nic). */
export function drawingDocMatch(
  d: Pick<ReconcileDoc, "type" | "documentNumber" | "drawingNumbers" | "extract">,
  jobs: DrawingMatchJob[],
): { strong: StrongMatch | null; hints: StrongMatch[] } {
  if (d.type !== "vykres" && d.type !== "model_3d") return { strong: null, hints: [] };
  const dr = drawingOf(d);
  return drawingJobMatch(ownDrawingNumbers(d), { customerOrderNumber: dr?.customerOrderNumber, ourQuoteNumber: dr?.ourQuoteNumber }, jobs);
}

// ── Vzájemné doplnění ───────────────────────────────────────
const PARTY_FILL: (keyof ExtractedParty)[] = ["ico", "dic", "street", "city", "zip", "country", "email", "phone", "contactPerson"];

/** Čísla, která skupina nedostane do zakázky (zapíšou je účinky dokladů). */
const DOC_ONLY_FIELDS: ReviewFieldKey[] = ["invoiceNumber", "deliveryNoteNumber"];

/**
 * Údaje primárního dokladu doplněné z ostatních dokladů téže strany: zákazník (IČO, DIČ, adresa,
 * kontakt), naše nabídka u objednávky. Nikdy přes strany (dodací list dodavatele nedostane PO zákazníka).
 */
export function mergeGroupDoc(
  primary: { id: string; type: BatchDocType; documentNumber: string; doc: ExtractedBusinessDoc } | null,
  others: { id: string; type: BatchDocType; documentNumber: string; doc: ExtractedBusinessDoc }[],
): { doc: ExtractedBusinessDoc; customerSources: Partial<Record<keyof ExtractedParty, FieldSource>>; warnings: BatchWarning[] } {
  const base: ExtractedBusinessDoc = primary
    ? { ...primary.doc, customer: { ...primary.doc.customer }, supplier: { ...primary.doc.supplier }, items: [...primary.doc.items] }
    : emptyExtracted();
  const warnings: BatchWarning[] = [];
  const customerSources: Partial<Record<keyof ExtractedParty, FieldSource>> = {};
  const pSide = primary ? sideOf(primary.type) : "none";
  const sameSide = others.filter((o) => sideOf(o.type) === (pSide === "none" ? "customer" : pSide));
  if (pSide !== "supplier") {
    for (const o of sameSide) {
      const c = o.doc.customer;
      if (!base.customer.name.trim() && c.name.trim()) base.customer.name = c.name;
      const sameCustomer = !base.customer.name.trim() || !c.name.trim() || nameSimilarity(base.customer.name, c.name) >= SAME_NAME
        || (digits(base.customer.ico) && digits(base.customer.ico) === digits(c.ico));
      if (!sameCustomer) continue;
      for (const k of PARTY_FILL) {
        if (!String(base.customer[k] ?? "").trim() && String(c[k] ?? "").trim()) {
          base.customer[k] = c[k];
          customerSources[k] = { docId: o.id, label: sourceLabel(o) };
        }
      }
    }
  }
  // objednávka zákazníka ← číslo naší nabídky ze skupiny
  if (primary && primary.type === "objednavka_zakaznik") {
    const quote = others.find((o) => o.type === "nabidka_my");
    const quoteNo = quote ? quote.doc.documentNumber || quote.doc.ourQuoteNumber || quote.documentNumber : "";
    if (quoteNo) {
      if (!base.ourQuoteNumber) base.ourQuoteNumber = quoteNo;
      else if (!docNumbersEqual(base.ourQuoteNumber, quoteNo)) {
        warnings.push(makeWarning(
          "number_conflict", "warn", [primary.id, quote!.id],
          `Objednávka odkazuje na ${base.ourQuoteNumber}, v dávce je ${quoteNo}.`,
        ));
      }
    }
  }
  return { doc: base, customerSources, warnings };
}

/** Prohození vystavitele do dočtení: protistrana do slotu nového druhu, naše IČO nikdy jako strana. */
export function swapParties(doc: ExtractedBusinessDoc, ourIco: string, toType?: BatchDocType): ExtractedBusinessDoc {
  const from = batchTypeFor(doc.docKind, doc.issuer);
  const to = toType ?? BATCH_TYPES[from].swap ?? from;
  const meta = BATCH_TYPES[to];
  const ours = digits(ourIco);
  const isUs = (p: ExtractedParty) => Boolean(ours) && digits(p.ico) === ours;
  const filled = (p: ExtractedParty) => Boolean(p.name.trim() || digits(p.ico));
  const other = [doc.customer, doc.supplier].find((p) => filled(p) && !isUs(p)) ?? emptyParty();
  const out: ExtractedBusinessDoc = {
    ...doc,
    docKind: meta.docKind ?? doc.docKind,
    issuer: meta.issuer ?? doc.issuer,
    customer: emptyParty(),
    supplier: emptyParty(),
  };
  if (meta.side === "supplier") {
    out.supplier = { ...other };
    if (filled(doc.customer) && !isUs(doc.customer) && doc.customer !== other) out.customer = { ...doc.customer };
  } else {
    out.customer = { ...other };
  }
  return out;
}

/** Doplnění klienta: jen prázdná pole stavu skupiny z návrhu skupiny (značky zdroje). */
export function applyGroupFills(job: ReviewState, sources: BatchGroupReview): ReviewState {
  const init = sources.model.initial;
  const fields: FieldValues = { ...job.fields };
  for (const key of Object.keys(sources.fieldSources) as ReviewFieldKey[]) {
    const v = init.fields[key];
    if (v && !(fields[key] ?? "").trim()) fields[key] = v;
  }
  const items = job.items.map((it) => {
    if (!sources.itemSources[it.key]?.length) return it;
    const src = init.items.find((x) => x.key === it.key);
    if (!src) return it;
    const next = { ...it };
    for (const f of ["revision", "material", "name", "unitPrice", "description"] as const) {
      if (!next[f].trim() && src[f].trim()) next[f] = src[f];
    }
    return next;
  });
  return { ...job, fields, items };
}

// ── Kontrola skupiny ────────────────────────────────────────
export interface GroupJobCandidate {
  job: TargetJob & { items?: JobItem[] };
  reason: string | null;
  score: number | null;
  /** Naše nabídky zakázky v systému (quotes + dříve uložené doklady nabídky) — termín objednávky bez data. */
  quoteTerms?: QuoteTerms[];
}

export interface ReconcileGroupInput {
  captureId: string;
  group: GroupDraft;
  /** Doklady skupiny v pořadí roztřídění. */
  docs: ReconcileDoc[];
  margins: boolean;
  mode: "approval" | "full";
  ourIco: string;
  fixedJobId: string | null;
  /** Existující zakázky jako cíle (pevná / silná shoda / párování) — první = nejlepší. */
  jobs: GroupJobCandidate[];
  /** Cíl vybraný uživatelem (jobId | "new"). */
  targetOverride?: string | null;
  /** Zakázky, které už mají vítěznou nabídku dodavatele. */
  jobsWithWinner?: string[];
  /** Dříve uložené doklady (server). */
  duplicates?: Record<string, DuplicateRef>;
  /** Konflikt archivu výkresů (server). */
  archiveConflicts?: Record<string, string>;
  /** Dnešek (RRRR-MM-DD, Praha) — testy; jinak skutečný. */
  today?: string;
}

export interface GroupReconcile {
  review: BatchGroupReview;
  docs: BatchDocReview[];
  state: BatchGroupState;
  docStates: Record<string, DocApplyState>;
  warnings: BatchWarning[];
}

function itemsTotal(items: ExtractedItem[]): number {
  if (!items.length || items.some((i) => !(i.unitPrice > 0) || !(i.quantity > 0))) return 0;
  return Math.round(items.reduce((s, i) => s + i.unitPrice * i.quantity, 0) * 100) / 100;
}

function fieldText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) && v !== 0 ? String(Math.round(v * 1000) / 1000) : "";
  return typeof v === "string" ? v.trim() : "";
}

const PURCHASE_PRIORITY: BatchDocType[] = ["faktura_dodavatel", "potvrzeni_dodavatel", "objednavka_my"];

/** Pole dokladů ostatních dokladů skupiny (jen téže strany jako pole). */
function extraFields(
  docs: ReconcileDoc[],
  primaryId: string | null,
  snapshot: TargetJob | null,
  margins: boolean,
): { patch: JobInput; sources: Partial<Record<ReviewFieldKey, FieldSource>> } {
  const patch: Record<string, unknown> = {};
  const sources: Partial<Record<ReviewFieldKey, FieldSource>> = {};
  const existing = (snapshot ?? {}) as Record<string, unknown>;
  const free = (k: string) => !fieldText(existing[k]) && patch[k] === undefined;
  const ordered = docs.filter((d) => d.id !== primaryId && businessDoc(d));
  for (const d of ordered) {
    const doc = businessDoc(d)!;
    const side = sideOf(d.type);
    const plan = planJobUpdate((snapshot ?? EMPTY_JOB) as never, doc);
    for (const [k, v] of Object.entries(plan.patch)) {
      if (k === "title" || DOC_ONLY_FIELDS.includes(k as ReviewFieldKey)) continue;
      const key = k as ReviewFieldKey;
      const supplierField = key === "supplierOrderNumber" || key === "supplierPromisedDate" || key === "purchaseCost";
      if (supplierField !== (side === "supplier")) continue;
      if (!free(k) || !fieldText(v)) continue;
      patch[k] = v;
      sources[key] = { docId: d.id, label: sourceLabel(d) };
    }
  }
  // nákupní náklady: faktura dodavatele > potvrzení dodavatele > naše objednávka (nikdy z nabídky dodavatele)
  if (margins && free("purchaseCost")) {
    for (const t of PURCHASE_PRIORITY) {
      const d = docs.find((x) => x.type === t && businessDoc(x));
      if (!d) continue;
      const doc = businessDoc(d)!;
      const total = doc.totalWithoutVat || itemsTotal(doc.items);
      if (total > 0) {
        patch.purchaseCost = total;
        sources.purchaseCost = { docId: d.id, label: sourceLabel(d) };
        break;
      }
    }
  }
  return { patch: patch as JobInput, sources };
}

const EMPTY_JOB = {
  stage: "poptavka", title: "", customer: null, customerOrderNumber: null, customerInquiryNumber: null,
  customerContact: null, customerContactEmail: null, customerContactPhone: null, inquiryDate: null, orderDate: null,
  customerRequiredDate: null, dueDate: null, expectedDeliveryDate: null, supplierPromisedDate: null, value: null,
  items: [], supplier: null, supplierOrderNumber: null, invoiceNumber: null, deliveryNoteNumber: null,
};

function stripDocOnly<T extends { patch?: JobInput; input?: JobInput }>(plan: T): T {
  const strip = (x: JobInput | undefined) => {
    if (!x) return x;
    const o = { ...(x as Record<string, unknown>) };
    for (const k of DOC_ONLY_FIELDS) delete o[k];
    return o as JobInput;
  };
  return { ...plan, ...(plan.patch ? { patch: strip(plan.patch) } : {}), ...(plan.input ? { input: strip(plan.input) } : {}) };
}

type MatchRow = { drawingNumber?: string | null; revision?: string | null; name?: string | null; description?: string | null; quantity?: number | null; unitPrice?: number | null };

function matchItem<T extends MatchRow>(list: T[], row: MatchRow): T | null {
  if (row.drawingNumber) {
    const hit = list.find((x) => x.drawingNumber && docNumbersEqual(x.drawingNumber, row.drawingNumber));
    if (hit) return hit;
  }
  // sdílený párovač (item-pairing): číslo výkresu v textu, název bez odkazů „142/026", počet, cena
  let best: { x: T; score: number } | null = null;
  for (const x of list) {
    const s = scoreLinePair(row, { id: "", ...x });
    if (!s.incompatible && s.score >= PAIR_SURE && (!best || s.score > best.score)) best = { x, score: s.score };
  }
  if (best) return best.x;
  if (row.name) {
    // podle názvu jen bez rozporu čísel (různá čísla výkresu = různé díly, i když se jmenují podobně)
    return list.find((x) => x.name && nameSimilarity(x.name, row.name) >= SAME_NAME
      && !(x.drawingNumber && row.drawingNumber && !docNumbersEqual(x.drawingNumber, row.drawingNumber))) ?? null;
  }
  return null;
}

/** Vazba výkresu / modelu na položku pro daný cíl — podle kteréhokoli z jeho čísel. */
function defaultLink(numbers: string[], target: ReviewTarget, jobItems: JobItem[], groupHasItems: boolean): ItemLinkChoice {
  for (const number of numbers.filter(Boolean)) {
    const ex = jobItems.find((i) => i.drawingNumber && docNumbersEqual(i.drawingNumber, number));
    if (ex) return { mode: "item", itemId: ex.id };
  }
  for (const number of numbers.filter(Boolean)) {
    const nw = target.newItems.find((i) => i.drawingNumber && docNumbersEqual(i.drawingNumber, number));
    if (nw) return { mode: "docItem", itemKey: nw.key };
  }
  return groupHasItems ? { mode: "none" } : { mode: "add" };
}

function itemOptionsFor(target: ReviewTarget, jobItems: JobItem[]): ItemOption[] {
  const out: ItemOption[] = [];
  for (const it of jobItems) {
    out.push({
      link: { mode: "item", itemId: it.id },
      label: [it.drawingNumber, it.revision ? `rev. ${it.revision}` : "", it.name].filter(Boolean).join(" ") || `Položka ${it.position + 1}`,
      drawingNumber: it.drawingNumber ?? "", revision: it.revision ?? "",
    });
  }
  for (const it of target.newItems) {
    out.push({
      link: { mode: "docItem", itemKey: it.key },
      label: `${[it.drawingNumber, it.revision ? `rev. ${it.revision}` : "", it.name].filter(Boolean).join(" ") || "Nová položka"} (nová)`,
      drawingNumber: it.drawingNumber, revision: it.revision,
    });
  }
  out.push({ link: { mode: "add" }, label: "Založit novou položku", drawingNumber: "", revision: "" });
  out.push({ link: { mode: "none" }, label: "Nepřiřazovat k položce", drawingNumber: "", revision: "" });
  return out;
}

function ourGuard(choice: PartyChoice, ourIco: string): PartyChoice {
  if (choice.mode === "new" && digits(ourIco) && digits(choice.party.ico) === digits(ourIco)) return { mode: "none" };
  return choice;
}

function quoteLinesOf(doc: ExtractedBusinessDoc, margins: boolean): SupplierQuoteLineState[] {
  return doc.items.map((it, i) => ({
    key: `q-${i}`,
    drawingNumber: it.drawingNumber,
    name: it.name || it.description,
    material: it.material,
    quantity: it.quantity > 0 ? String(it.quantity) : "1",
    unit: it.unit || "ks",
    unitPrice: margins && it.unitPrice > 0 ? String(it.unitPrice) : "",
  }));
}

function clipText(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// ── Počty kusů a objednávka na celek ────────────────────────
const KIND_NOMINATIVE: Record<CaptureDocKind, string> = {
  poptavka: "poptávka", nabidka: "nabídka", objednavka: "objednávka", potvrzeni: "potvrzení",
  dodaci_list: "dodací list", faktura: "faktura", vykres: "výkres", ostatni: "doklad",
};
/** Výslovný odkaz na nabídku: „Výroba dle nabídky NAB-…", „viz cenová nabídka", „laut Angebot"… */
const QUOTE_REF = /(?:^|[^\p{L}])(dle|podle|viz|per|according to|gem(?:ä|ae)ß|laut)\s+(?:\S+\s+){0,2}(?:nab[ií]dk|cenov|offer|quot|angebot)/iu;
/** Celek bez počtu kusů: „kompletní dodávka", „celkem", „souhrn"… */
const WHOLE_WORD = /kompletn|komplet(?![\p{L}])|(?:^|[^\p{L}])cel(?:ek|ku|kem|kov)|souhrn|complete|gesamt|pauschal/iu;
const WHOLE_UNIT = /^(kpl|kompl|komplet|soubor|sada|celek|set|lot|pau|psch)/i;

function realRows(items: ExtractedItem[]): ExtractedItem[] {
  return items.filter((i) => i.drawingNumber.trim() || i.name.trim() || i.description.trim());
}

/** Doklad má jednotlivé položky (aspoň 1 s číslem výkresu, nebo víc řádků). */
function hasSingleItems(items: ExtractedItem[]): boolean {
  const rows = realRows(items);
  return rows.some((i) => i.drawingNumber.trim()) || rows.length >= 2;
}

/**
 * Objednávka na celek: bez řádků, nebo 1 řádek bez čísla výkresu, který nesedí názvem na žádnou položku
 * zdroje a je opravdu „celek": bez počtu kusů, jednotka kpl / soubor / sada, nebo 1 ks s výslovným odkazem
 * na nabídku („Výroba dle nabídky NAB-…") či slovem celek / komplet. Konkrétní počet kusů (> 1) = platí
 * objednávka, nikdy celek („Výroba hřídele dle výkresu, 50 ks").
 */
export function isWholeOrder(orderItems: ExtractedItem[], sourceItems: ExtractedItem[]): boolean {
  const rows = realRows(orderItems);
  if (!rows.length) return true;
  if (rows.length !== 1 || rows[0].drawingNumber.trim()) return false;
  const r = rows[0];
  if (r.name.trim() && sourceItems.some((x) => x.name.trim() && nameSimilarity(x.name, r.name) >= SAME_NAME)) return false;
  if (!(r.quantity > 0) || WHOLE_UNIT.test(r.unit.trim())) return true;
  if (r.quantity > 1) return false;
  const text = `${r.name} ${r.description}`;
  return QUOTE_REF.test(text) || WHOLE_WORD.test(text);
}

function qtyText(n: number, unit: string): string {
  return `${Math.round(n * 1000) / 1000} ${unit || "ks"}`;
}

function drawingItem(d: ReconcileDoc): ExtractedItem | null {
  const dr = drawingOf(d);
  const num = dr?.drawingNumber || ownDrawingNumbers(d)[0] || "";
  if (!num) return null;
  return {
    drawingNumber: num, revision: dr?.revision ?? "", name: dr?.title ?? "", description: "", material: dr?.material ?? "",
    quantity: dr?.quantity ?? 0, unit: "ks", unitPrice: 0, deliveryDate: "",
  };
}

/** Pořadí doplňování prázdných údajů položek: naše nabídka, poptávka, ostatní zákaznické doklady. */
function FILL_RANK(t: BatchDocType): number {
  return t === "nabidka_my" ? 0 : t === "poptavka_zakaznik" ? 1 : 2;
}

/**
 * Objednávka u položky odkazuje na počet kusů z výkresu: „dle výkresu", „ks dle výkr.", „počet viz výkres",
 * „lt. Zeichnung", „as per drawing", „dle počtu kusů na výkrese". S konkrétním počtem jen výslovný odkaz
 * na POČET („Výroba dle výkresu, 50 ks" = platí 50 ks).
 */
const PER_DRAWING = /(dle|podle|viz|per|as per|according to|lt\.?|laut|gem(?:ä|ae)ß|siehe|see)\s+(?:po[cč]tu\s+(?:kus[uů]\s+)?(?:na|z|ve?)\s+)?(?:v[yý]kres|v[yý]kr\.?|zeichnung|zchng|drawing|dwg)/iu;
const PER_DRAWING_QTY = /((ks|kus[uůy]?|po[cč]et|mno[zž]stv[ií]|qty|quantity|menge|st[uü]ck|stk|pcs)\.?\s*[:\-–]?\s*(dle|podle|viz|per|as per|according to|lt\.?|laut|gem(?:ä|ae)ß|siehe|see)\s+(v[yý]kres|v[yý]kr|zeichnung|zchng|drawing|dwg))|(dle|podle)\s+po[cč]tu\s+(kus[uů]\s+)?(na|z|ve?)\s+v[yý]kres/iu;

export function refersToDrawingQty(it: Pick<ExtractedItem, "quantity" | "unit" | "name" | "description">): boolean {
  const text = `${it.unit} ${it.name} ${it.description}`.replace(/\s+/g, " ");
  if (PER_DRAWING_QTY.test(text)) return true;
  // bez počtu stačí obecný odkaz na výkres („dle výkresu" v jednotce / popisu)
  return !(it.quantity > 0) && PER_DRAWING.test(text);
}

/** Výkres dávky: počet kusů a název podle spárované položky (pro kontrolu i uložení). */
export interface DrawingInfo {
  /** Index položky skupiny (groupDoc.items), null = bez položky skupiny. */
  itemIndex: number | null;
  /** 0 = neznámý → „doplň počet". */
  quantity: number;
  /** „z objednávky PO-4471", „z nabídky NAB-6", „z výkresu" */
  quantitySource: string;
  title: string;
  /** „název z objednávky PO-4471" ("" = z razítka výkresu). */
  titleSource: string;
}

/** Termín zakázky skupiny (objednávka bez reálného termínu → z nabídky / poptávky). */
export interface GroupDeadline {
  result: OrderDeadline;
  /** Zdroj navrženého termínu (customerRequiredDate, dueDate). */
  source: FieldSource | null;
  /** Termín potvrzený zákazníkovi (dueDate) se navrhne jen z NAŠÍ nabídky. */
  fillDue: boolean;
  warnings: BatchWarning[];
}

/** Nereálné termíny objednávky, které se bez návrhu z nabídky neuloží (datum vystavení, ne termín). */
export const DROP_REASONS: UnrealisticReason[] = ["same_as_order", "before_order"];

/** Termín skupiny: objednávka (reálná = beze změny) → naše nabídka → poptávka; texty upozornění. */
export function groupDeadlineOf(
  order: ExtractedBusinessDoc,
  quotes: QuoteTerms[],
  inquiry: InquiryTerms | null,
  primaryId: string | null,
  opts: { today?: string; groupKey?: string | null } = {},
): GroupDeadline {
  const result = orderDeadline({ order, quotes, inquiry, today: opts.today });
  const warnings: BatchWarning[] = [];
  const ids = (extra: string | null) => [...(primaryId ? [primaryId] : []), ...(extra && extra !== primaryId ? [extra] : [])];
  const gk = opts.groupKey ?? null;
  let source: FieldSource | null = null;
  if (result.proposal) {
    const p = result.proposal;
    source = { docId: p.docId ?? primaryId ?? "", label: p.label };
    // termín odvozený z textu (nebo AI nesedí s textem) = warn → ke kontrole, nikdy plná automatika (canAutoApplyBatch)
    warnings.push(makeWarning("deadline_from_quote", p.past || p.review ? "warn" : "info", ids(p.docId), deadlineMessage(result) ?? p.label, [], gk));
  } else if (result.differs) {
    warnings.push(makeWarning("deadline_from_quote", "info", ids(quotes[0]?.docId ?? null), result.differs, [], gk));
  } else if (!result.realistic && result.reason && result.reason !== "missing") {
    // termín = datum objednávky / před ním → neuloží se (zakázka by byla hned po termínu) — varování
    const drop = DROP_REASONS.includes(result.reason);
    const stale = result.staleQuote ? ` ${staleQuoteMessage(result.staleQuote)}` : "";
    warnings.push(makeWarning(
      "deadline_from_quote", drop ? "warn" : "info", ids(result.staleQuote?.docId ?? null),
      drop
        ? `Objednávka nemá reálný termín (${unrealisticText(result.reason)}) a nabídka s lhůtou chybí — termín se neuloží, doplň termín zakázky.${stale}`
        : `Objednávka nemá reálný termín (${unrealisticText(result.reason)}) a nabídka s lhůtou chybí — doplň termín zakázky.${stale}`,
      [], gk,
    ));
  } else if (!result.realistic && result.staleQuote) {
    // objednávka bez termínu, nabídka jen s datem, které uplynulo / je před objednávkou
    warnings.push(makeWarning("deadline_from_quote", "info", ids(result.staleQuote.docId), staleQuoteMessage(result.staleQuote), [], gk));
  } else if (result.realistic && result.fromItems) {
    source = { docId: primaryId ?? "", label: "termín z položek objednávky" };
  }
  return { result, source, fillDue: result.proposal?.from === "quote", warnings };
}

/**
 * Termín do dokladu (requiredDeliveryDate) — SDÍLÍ dávka i jedna fotka objednávky (capture-single-deadline):
 * návrh z nabídky / poptávky; reálný termín jen u položky (hlavička = datum objednávky) → termín položky;
 * nereálný termín (= datum objednávky / před ním) bez návrhu → pole prázdné, ne zakázka hned po termínu;
 * jinak beze změny (reálný termín objednávky se nikdy nepřepisuje).
 */
export function deadlineDocDate(current: string, d: GroupDeadline): string {
  if (d.result.proposal) return d.result.proposal.date;
  if (d.result.realistic && d.result.fromItems) return d.result.current;
  if (!d.result.realistic && d.result.reason && DROP_REASONS.includes(d.result.reason)) return "";
  return current;
}

/** Navržený termín do dokladu skupiny (požadovaný termín zakázky = termín, na který zákazník přistoupil). */
function applyGroupDeadline(doc: ExtractedBusinessDoc, d: GroupDeadline): void {
  doc.requiredDeliveryDate = deadlineDocDate(doc.requiredDeliveryDate, d);
}

export interface GroupDoc {
  primaryId: string | null;
  /** Sloučený doklad skupiny (zákaznický základ, položky jen z primárního). */
  doc: ExtractedBusinessDoc;
  customerSources: Partial<Record<keyof ExtractedParty, FieldSource>>;
  itemSources: Record<string, FieldSource[]>;
  warnings: BatchWarning[];
  /** Výkresy skupiny (docId) → počet kusů a název. */
  drawingInfo: Record<string, DrawingInfo>;
  /** Termín objednávky (jen primární objednávka zákazníka). */
  deadline: GroupDeadline | null;
}

/**
 * Doklad skupiny pro plán zakázky (stejný pro kontrolu i uložení). Položky z primárního dokladu, počty
 * kusů: VŽDY platí objednávka (rozdíl v nabídce / poptávce / výkresu = info upozornění). Výjimky:
 * položka bez počtu → z výkresu, jinak z naší nabídky, jinak z poptávky; objednávka na celek (1 řádek
 * bez čísla výkresu) → položky a počty z nabídky (jinak poptávky, jinak výkresů), hodnota = cena objednávky.
 */
export function groupDocOf(docs: ReconcileDoc[], ourIco: string, opts: { today?: string } = {}): GroupDoc {
  const warnings: BatchWarning[] = [];
  const primaryId = primaryDocId(docs.filter((d) => isBusinessType(d.type)));
  const primary = docs.find((d) => d.id === primaryId) ?? null;
  const primaryBusiness = primary ? businessDoc(primary) : null;
  const primarySide = primary ? sideOf(primary.type) : "none";
  const businessOthers = docs
    .filter((d) => d.id !== primaryId && businessDoc(d))
    .map((d) => ({ id: d.id, type: d.type, documentNumber: d.documentNumber, doc: businessDoc(d)! }));
  const merged = mergeGroupDoc(
    primary && primaryBusiness ? { id: primary.id, type: primary.type, documentNumber: primary.documentNumber, doc: primaryBusiness } : null,
    businessOthers,
  );
  warnings.push(...merged.warnings);
  const groupDoc: ExtractedBusinessDoc = { ...merged.doc };
  if (primary) {
    const meta = BATCH_TYPES[primary.type];
    if (meta.docKind) groupDoc.docKind = meta.docKind;
    if (meta.issuer) groupDoc.issuer = meta.issuer;
  }
  if (primarySide === "supplier") groupDoc.items = [];
  if (digits(groupDoc.customer.ico) && digits(groupDoc.customer.ico) === digits(ourIco)) groupDoc.customer = emptyParty();

  const itemSources: Record<string, FieldSource[]> = {};
  const customerOthers = businessOthers.filter((o) => sideOf(o.type) === "customer");
  const quote = customerOthers.find((o) => o.type === "nabidka_my") ?? null;
  const inquiry = customerOthers.find((o) => o.type === "poptavka_zakaznik") ?? null;
  const drawings = docs.filter((x) => x.type === "vykres");
  const isOrder = primary?.type === "objednavka_zakaznik" && Boolean(primaryBusiness);

  // objednávka na celek → položky a počty z nabídky / poptávky / výkresů, hodnota = cena objednávky
  let itemsFromId: string | null = null;
  let qtyBase = primary && primaryBusiness ? KIND_NOMINATIVE[BATCH_TYPES[primary.type].docKind ?? "ostatni"] : "";
  if (isOrder) {
    const drawingItems = drawings.map(drawingItem).filter((x): x is ExtractedItem => Boolean(x));
    const src = [
      quote && hasSingleItems(quote.doc.items) ? { id: quote.id, items: quote.doc.items, label: sourceLabel(quote), kind: "nabídka" } : null,
      inquiry && hasSingleItems(inquiry.doc.items) ? { id: inquiry.id, items: inquiry.doc.items, label: sourceLabel(inquiry), kind: "poptávka" } : null,
      drawingItems.length ? { id: drawings[0].id, items: drawingItems, label: drawingItems.length === 1 ? "z výkresu" : "z výkresů", kind: "výkres" } : null,
    ].find(Boolean) ?? null;
    if (src && isWholeOrder(groupDoc.items, src.items)) {
      const row = realRows(groupDoc.items)[0] ?? null;
      const total = groupDoc.totalWithoutVat || itemsTotal(groupDoc.items) || (row && row.unitPrice > 0 ? row.unitPrice * (row.quantity > 0 ? row.quantity : 1) : 0);
      groupDoc.items = realRows(src.items).map((it) => ({ ...it, deliveryDate: it.deliveryDate || row?.deliveryDate || "" }));
      groupDoc.totalWithoutVat = Math.round(total * 100) / 100;
      itemsFromId = src.id;
      qtyBase = src.kind;
      groupDoc.items.forEach((_, i) => { (itemSources[`ai-${i}`] ??= []).push({ docId: src.id, label: `položka ${src.label}` }); });
      warnings.push(makeWarning(
        "whole_order", "info", [primary!.id, src.id],
        `Objednávka je na celek — položky a počty převzaty ${src.label}${total > 0 ? ", hodnota zakázky = cena objednávky" : ""}.`,
      ));
    }
  }

  // jediný řádek objednávky bez čísla výkresu (ne na celek) ↔ jediný řádek / výkres zdroje = tentýž díl
  const singleRow = isOrder && !itemsFromId && realRows(groupDoc.items).length === 1;
  /** Řádek dokladu k položce: číslo výkresu, název; jediný řádek objednávky ↔ jediný řádek dokladu. */
  const rowOf = (list: ExtractedItem[], it: ExtractedItem): ExtractedItem | null => {
    const hit = matchItem(list, it);
    if (hit || !singleRow || it.drawingNumber || !realRows([it]).length) return hit;
    const rows = realRows(list);
    return rows.length === 1 ? rows[0] : null;
  };

  // položky skupiny ← doplnění z ostatních zákaznických dokladů (jen prázdné údaje; nabídka / poptávka
  // je most: řádek objednávky bez čísla dostane číslo výkresu podle názvu). Priorita: naše nabídka,
  // poptávka, ostatní zákaznické doklady, nakonec výkres (název, revize, materiál).
  const fillOrder = [...customerOthers].sort((a, b) => FILL_RANK(a.type) - FILL_RANK(b.type));
  const baseLabel = primary ? sourceLabel(primary) : "";
  /** Výkresy položky (docId) a odkud je počet / název položky. */
  const itemDrawings: string[][] = [];
  const qtyOrigin: ({ docId: string; label: string } | null)[] = [];
  const nameOrigin: ({ docId: string; label: string } | null)[] = [];
  groupDoc.items = groupDoc.items.map((it, i) => {
    const out = { ...it };
    const src = (docId: string, label: string) => (itemSources[`ai-${i}`] ??= []).push({ docId, label });
    const baseId = itemsFromId ?? primaryId;
    const fromDoc = itemsFromId ? customerOthers.find((o) => o.id === itemsFromId) ?? null : null;
    const baseSrc = itemsFromId ? (fromDoc ? sourceLabel(fromDoc) : "z výkresu") : baseLabel;
    nameOrigin[i] = out.name && baseId ? { docId: baseId, label: `název ${baseSrc}` } : null;
    for (const o of fillOrder) {
      if (o.id === itemsFromId) continue;
      const row = rowOf(o.doc.items, out);
      if (!row) continue;
      if (!out.drawingNumber && row.drawingNumber) {
        out.drawingNumber = row.drawingNumber;
        src(o.id, `číslo výkresu ${sourceLabel(o)}`);
      }
      for (const f of ["revision", "material", "name", "description"] as const) {
        if (!out[f] && row[f]) {
          out[f] = row[f];
          src(o.id, `${f === "description" ? "popis" : MERGE_FIELD_LABELS[f as MergeField]} ${sourceLabel(o)}`);
          if (f === "name") nameOrigin[i] = { docId: o.id, label: `název ${sourceLabel(o)}` };
        }
      }
      if (!(out.unitPrice > 0) && row.unitPrice > 0 && primarySide === "customer") {
        out.unitPrice = row.unitPrice;
        src(o.id, `${MERGE_FIELD_LABELS.unitPrice} ${sourceLabel(o)}`);
      }
    }
    // výkres (kterékoli jeho číslo) doplní prázdnou revizi / materiál / název
    let drawingHits = drawings
      .map((d) => ({ d, dr: drawingOf(d), num: sharedNumber(ownDrawingNumbers(d), out.drawingNumber) }))
      .filter((x) => x.num && x.d.id !== itemsFromId);
    if (!drawingHits.length && !out.drawingNumber && realRows([out]).length) {
      // položka bez čísla: výkres se stejným názvem, jinak jediný výkres k jedinému řádku objednávky
      const numbered = drawings.filter((d) => d.id !== itemsFromId && ownDrawingNumbers(d).length);
      const byName = numbered.filter((d) => {
        const t = drawingOf(d)?.title ?? "";
        return Boolean(t.trim() && out.name.trim()) && nameSimilarity(t, out.name) >= SAME_NAME;
      });
      const pick = byName.length === 1 ? byName[0] : !byName.length && singleRow && numbered.length === 1 ? numbered[0] : null;
      if (pick) {
        const num = ownDrawingNumbers(pick)[0];
        out.drawingNumber = num;
        src(pick.id, `číslo výkresu z výkresu ${num}`);
        drawingHits = [{ d: pick, dr: drawingOf(pick), num }];
      }
    }
    itemDrawings[i] = drawingHits.map((x) => x.d.id);
    // materiál: platí doklad (objednávka > nabídka > poptávka); jiný materiál na výkresu = upozornění
    // (jiná skupina → „warn", kontrola se otevře; jen jiný zápis téže skupiny → „info")
    const docMaterial = out.material.trim();
    for (const { d, dr, num } of drawingHits) {
      const drMat = (dr?.material ?? "").trim();
      const diff = docMaterial && drMat ? materialDifference(docMaterial, drMat) : null;
      if (!diff) continue;
      warnings.push(makeWarning(
        "material_conflict", diff === "group" ? "warn" : "info", [...(baseId ? [baseId] : []), d.id],
        `Materiál se liší: ${docMaterial}${baseSrc ? ` (${baseSrc})` : ""} × ${drMat} (z výkresu ${num}) — u položky platí ${docMaterial}, zkontroluj revizi výkresu.`,
      ));
    }
    for (const { d, dr, num } of drawingHits) {
      const fills: [keyof ExtractedItem, string][] = [["revision", dr?.revision ?? ""], ["material", dr?.material ?? ""], ["name", dr?.title ?? ""]];
      for (const [f, v] of fills) {
        if (!out[f] && v) {
          (out as unknown as Record<string, unknown>)[f] = v;
          src(d.id, `${MERGE_FIELD_LABELS[f as MergeField]} z výkresu ${num}`);
          if (f === "name") nameOrigin[i] = { docId: d.id, label: `název z výkresu ${num}` };
        }
      }
    }
    qtyOrigin[i] = out.quantity > 0 && baseId ? { docId: baseId, label: baseSrc } : null;
    if (primarySide !== "customer") return out;

    // počty kusů: platí objednávka; prázdný → naše nabídka, poptávka, výkres. Objednávka odkazuje na výkres
    // („ks dle výkresu", „lt. Zeichnung") → počet z výkresu. Rozdíl ostatních zdrojů = info upozornění.
    const perDrawing = isOrder && !itemsFromId && refersToDrawingQty(it);
    const qtySources: { docId: string; what: "výkres" | "nabídka" | "poptávka"; label: string; qty: number }[] = [];
    for (const [o, what] of [[quote, "nabídka"], [inquiry, "poptávka"]] as const) {
      if (!o || o.id === itemsFromId || o.id === primaryId) continue;
      const row = rowOf(o.doc.items, out);
      if (row && row.quantity > 0) qtySources.push({ docId: o.id, what, label: sourceLabel(o), qty: row.quantity });
    }
    for (const { d, dr, num } of drawingHits) {
      if (dr && dr.quantity > 0) qtySources.push({ docId: d.id, what: "výkres", label: `z výkresu ${num}`, qty: dr.quantity });
    }
    const fromDrawing = qtySources.find((x) => x.what === "výkres") ?? null;
    if (perDrawing && fromDrawing) {
      const before = out.quantity;
      out.quantity = fromDrawing.qty;
      qtyOrigin[i] = { docId: fromDrawing.docId, label: `${fromDrawing.label} (objednávka: „dle výkresu")` };
      src(fromDrawing.docId, `${MERGE_FIELD_LABELS.quantity} ${fromDrawing.label} (objednávka odkazuje na výkres)`);
      if (before > 0 && Math.abs(before - fromDrawing.qty) > 1e-9) {
        warnings.push(makeWarning(
          "quantity_conflict", "info", [...(primaryId ? [primaryId] : []), fromDrawing.docId],
          `Objednávka odkazuje na počet z výkresu: ${qtyText(fromDrawing.qty, out.unit)} (objednávka ${qtyText(before, out.unit)}) — ${out.drawingNumber || out.name}`,
        ));
      }
      return out;
    }
    if (!(out.quantity > 0)) {
      const fill = qtySources[0];
      if (fill) {
        out.quantity = fill.qty;
        qtyOrigin[i] = { docId: fill.docId, label: fill.label };
        src(fill.docId, `${MERGE_FIELD_LABELS.quantity} ${fill.label}`);
      }
      return out;
    }
    const diff = qtySources.filter((x) => Math.abs(x.qty - out.quantity) > 1e-9);
    if (diff.length && qtyBase) {
      const what = out.drawingNumber || out.name || `položka ${i + 1}`;
      warnings.push(makeWarning(
        "quantity_conflict", "info", [...(baseId ? [baseId] : []), ...diff.map((x) => x.docId)],
        `Platí ${qtyBase}: ${qtyText(out.quantity, out.unit)} (${diff.map((x) => `${x.what} ${qtyText(x.qty, out.unit)}`).join(", ")}) — ${what}`,
      ));
    }
    return out;
  });

  // výkresy: počet kusů a název podle spárované položky (objednávka > nabídka > poptávka > výkres)
  const drawingInfo: Record<string, DrawingInfo> = {};
  for (const d of drawings) {
    const dr = drawingOf(d);
    const idx = itemDrawings.findIndex((ids) => ids?.includes(d.id));
    if (idx >= 0) {
      const it = groupDoc.items[idx];
      const name = it.name.trim();
      const titleOther = Boolean(dr?.title.trim() && name && nameSimilarity(dr.title, name) < 0.95);
      drawingInfo[d.id] = {
        itemIndex: idx,
        quantity: it.quantity > 0 ? it.quantity : 0,
        quantitySource: it.quantity > 0 ? qtyOrigin[idx]?.label ?? "" : "",
        title: name || dr?.title || "",
        titleSource: name && nameOrigin[idx] ? `${nameOrigin[idx]!.label}${titleOther ? ` (na výkresu „${dr!.title.trim()}")` : ""}` : "",
      };
      continue;
    }
    // bez položky skupiny: nabídka / poptávka podle čísla, jinak počet z výkresu
    const nums = ownDrawingNumbers(d);
    let info: DrawingInfo = { itemIndex: null, quantity: dr?.quantity && dr.quantity > 0 ? dr.quantity : 0, quantitySource: dr?.quantity ? "z výkresu" : "", title: dr?.title ?? "", titleSource: "" };
    if (primarySide === "customer") {
      for (const o of [quote, inquiry]) {
        if (!o || o.id === primaryId) continue;
        const row = o.doc.items.find((x) => sharedNumber(nums, x.drawingNumber));
        if (row && row.quantity > 0) {
          info = { ...info, quantity: row.quantity, quantitySource: sourceLabel(o) };
          if (row.name.trim()) info = { ...info, title: row.name.trim(), titleSource: `název ${sourceLabel(o)}` };
          break;
        }
      }
    }
    drawingInfo[d.id] = info;
  }

  // termín objednávky: nereálný → z naší nabídky (lhůta od data objednávky), jinak z poptávky
  let deadline: GroupDeadline | null = null;
  if (isOrder) {
    const quotes = customerOthers.filter((o) => o.type === "nabidka_my").map((o) => quoteTermsOfDoc(o.doc, o.documentNumber || o.doc.documentNumber, { docId: o.id }));
    const inq = inquiry ? inquiryTermsOfDoc(inquiry.doc, inquiry.documentNumber, inquiry.id) : null;
    deadline = groupDeadlineOf(groupDoc, quotes, inq, primaryId, { today: opts.today });
    applyGroupDeadline(groupDoc, deadline);
    warnings.push(...deadline.warnings);
  }
  return { primaryId, doc: groupDoc, customerSources: merged.customerSources, itemSources, warnings, drawingInfo, deadline };
}

/**
 * Objednávka zákazníka k existující zakázce: počet kusů VŽDY podle objednávky. Zakázka ještě bez
 * objednávky → doplnění položky přepíše množství (override, výchozí „použít"); zakázka už s objednávkou
 * (revize) → položky se nemění, jen upozornění. Vrací texty upozornění.
 */
function orderQuantityMerges(t: ReviewTarget, job: TargetJob & { items?: JobItem[] }, items: ExtractedItem[], orderTotal = 0): string[] {
  const notes: string[] = [];
  const jobItems = job.items ?? [];
  const hasOrder = Boolean((job.customerOrderNumber ?? "").trim());
  // stejný párovač jako plán zakázky (planJobUpdate) — jen jisté páry
  const pairing = jobItems.length ? pairDocLines(items, jobItems, { lineWins: !hasOrder, orderTotal: orderTotal || itemsTotal(items) }) : { pairs: [] };
  for (const p of pairing.pairs) {
    if (p.confidence !== "sure") continue;
    const it = items[p.line];
    const ex = jobItems.find((x) => x.id === p.itemId);
    if (!(it.quantity > 0)) continue;
    if (!ex || !(Number(ex.quantity) > 0) || Math.abs(Number(ex.quantity) - it.quantity) < 1e-9) continue;
    const what = it.drawingNumber || it.name || ex.drawingNumber || ex.name || `položka ${ex.position + 1}`;
    const unit = ex.unit || it.unit || "ks";
    if (hasOrder) {
      notes.push(`Zakázka už objednávku má — počet se nemění: zakázka ${qtyText(ex.quantity, unit)}, objednávka ${qtyText(it.quantity, unit)} — ${what}`);
      continue;
    }
    const qty = String(Math.round(it.quantity * 1000) / 1000);
    const m = t.merges.find((x) => x.itemId === ex.id);
    if (m) {
      m.patch = { ...m.patch, quantity: qty };
      m.override = [...new Set([...(m.override ?? []), "quantity" as const])];
    } else {
      t.merges.push({
        itemId: ex.id, label: [ex.drawingNumber, ex.name].filter(Boolean).join(" ") || `Položka ${ex.position + 1}`,
        drawingNumber: ex.drawingNumber ?? "", patch: { quantity: qty }, apply: true, override: ["quantity"],
      });
    }
    notes.push(`Platí objednávka: ${qtyText(it.quantity, unit)} (zakázka ${qtyText(ex.quantity, unit)}) — ${what}`);
  }
  return notes;
}

/** Návrh kontroly jedné skupiny: cíle, údaje zakázky se zdroji, doklady a jejich výchozí stav. */
export function reconcileGroup(input: ReconcileGroupInput): GroupReconcile {
  const { group, docs, margins, ourIco } = input;
  const warnings: BatchWarning[] = [];
  const gd = groupDocOf(docs, ourIco, { today: input.today });
  // upozornění k termínu až podle výchozího cíle (nabídka zakázky v systému může termín určit jinak)
  warnings.push(...gd.warnings.filter((w) => w.code !== "deadline_from_quote"));
  const primaryId = gd.primaryId;
  const primary = docs.find((d) => d.id === primaryId) ?? null;
  const primaryBusiness = primary ? businessDoc(primary) : null;
  const primarySide = primary ? sideOf(primary.type) : "none";
  const groupDoc = gd.doc;
  const itemSources = gd.itemSources;
  const merged = { customerSources: gd.customerSources };
  /** Termín zakázky podle cíle: z dávky, nebo (objednávka bez reálného termínu, bez nabídky v dávce) z nabídky zakázky v systému. */
  interface TargetDeadline { date: string; fillDue: boolean; source: FieldSource | null; warnings: BatchWarning[] }
  const batchDeadline: TargetDeadline | null = gd.deadline
    ? { date: gd.deadline.result.proposal?.date ?? "", fillDue: gd.deadline.fillDue, source: gd.deadline.source, warnings: gd.deadline.warnings.map((w) => ({ ...w, groupKey: w.groupKey ?? group.key })) }
    : null;
  const deadlineFor = (cand: GroupJobCandidate | null): TargetDeadline | null => {
    if (!gd.deadline || !primaryBusiness || !cand?.quoteTerms?.length) return batchDeadline;
    const batchQuote = gd.deadline.result.proposal?.from === "quote" || docs.some((d) => d.type === "nabidka_my");
    if (batchQuote) return batchDeadline;
    const order = { ...primaryBusiness, documentDate: groupDoc.documentDate || primaryBusiness.documentDate };
    const sys = groupDeadlineOf(order, cand.quoteTerms, null, primaryId, { today: input.today, groupKey: group.key });
    if (sys.result.proposal) return { date: sys.result.proposal.date, fillDue: true, source: sys.source, warnings: sys.warnings };
    if (sys.result.realistic && sys.result.differs) return { ...(batchDeadline ?? { date: "", fillDue: false, source: null }), warnings: sys.warnings };
    return batchDeadline;
  };
  const deadlineByTarget: Record<string, TargetDeadline | null> = {};

  // cíle
  const newExtra = extraFields(docs, primaryId, null, margins);
  const stageDocs = (flagsOf: (d: ReconcileDoc) => { paidComplete?: boolean; partialConfirmed?: boolean }) =>
    docs.filter((d) => isBusinessType(d.type)).map((d) => ({ type: d.type, flags: d.flags, ...flagsOf(d) }));
  const defaultStageDocs = stageDocs(() => ({}));
  const hasBusiness = Boolean(primary);
  const targets: ReviewTarget[] = [];
  const jobItemsByTarget: Record<string, JobItem[]> = {};
  const isOrderPrimary = primary?.type === "objednavka_zakaznik" && Boolean(primaryBusiness);
  /** Upozornění „Platí objednávka: … (zakázka …)" podle cíle. */
  const qtyNotes: Record<string, string[]> = {};
  for (const cand of input.jobs) {
    const job = cand.job;
    if (targets.some((t) => t.key === job.id)) continue;
    let plan: JobUpdatePlan | null = null;
    let docValues: JobInput | undefined;
    const extra = extraFields(docs, primaryId, job, margins);
    if (hasBusiness) {
      const base = planJobUpdate(job, groupDoc);
      plan = stripDocOnly({ ...base, patch: { ...extra.patch, ...base.patch } });
      docValues = docFieldValues(groupDoc);
    } else if (Object.keys(extra.patch).length) {
      plan = { patch: extra.patch, newItems: [], itemUpdates: [], stageTo: null, filled: [], filledColumns: [] };
    }
    const dl = isOrderPrimary ? deadlineFor(cand) : null;
    deadlineByTarget[job.id] = dl;
    if (plan && dl?.date) {
      // požadovaný termín = termín, na který zákazník nabídkou přistoupil; potvrzený = náš z nabídky (jen prázdné)
      const patch = { ...plan.patch } as Record<string, unknown>;
      if (!job.customerRequiredDate) patch.customerRequiredDate = dl.date;
      if (dl.fillDue && !job.dueDate) patch.dueDate = dl.date;
      plan = { ...plan, patch: patch as JobInput };
      if (docValues) docValues = { ...docValues, customerRequiredDate: dl.date };
    }
    const t = buildExistingTarget({ job, plan, docValues, reason: cand.reason, score: cand.score, margins });
    if (isOrderPrimary) qtyNotes[t.key] = orderQuantityMerges(t, job, groupDoc.items, groupDoc.totalWithoutVat);
    const st = batchStage(defaultStageDocs, { mode: "existing", stage: job.stage });
    t.stageTo = st === "keep" ? null : st;
    for (const k of DOC_ONLY_FIELDS) { delete t.proposed[k]; delete t.conflicts[k]; }
    targets.push(t);
    jobItemsByTarget[t.key] = job.items ?? [];
  }
  const newPlan: NewJobPlan | null = hasBusiness ? stripDocOnly(planNewJob(groupDoc)) : null;
  const newInput: JobInput = { ...(newPlan?.input ?? {}), ...newExtra.patch, ...(newPlan?.input ?? {}) };
  deadlineByTarget.new = isOrderPrimary ? batchDeadline : null;
  if (batchDeadline?.date) {
    newInput.customerRequiredDate = batchDeadline.date;
    if (batchDeadline.fillDue && !newInput.dueDate) newInput.dueDate = batchDeadline.date;
  }
  if (!hasBusiness || primarySide === "supplier") {
    // zakázka bez zákaznického dokladu: název z výkresu / dokladu
    const dr = docs.map(drawingOf).find(Boolean);
    const firstNum = docs.map((d) => d.documentNumber).find(Boolean);
    if (!newInput.title) newInput.title = clipText(dr ? [dr.title, dr.drawingNumber].filter(Boolean).join(" ") : docs[0] ? docLabel(docs[0]) : "Doklady z focení", 120) || `Doklady ${firstNum ?? ""}`.trim();
  }
  const newTarget = buildNewTarget({
    plan: { input: newInput, items: newPlan?.items ?? [], filled: [], filledColumns: [] },
    margins,
    docKind: groupDoc.docKind,
    issuer: groupDoc.issuer,
  });
  const newStage = batchStage(defaultStageDocs, { mode: "new", stage: null });
  newTarget.stageTo = newStage === "keep" ? "poptavka" : newStage;
  if (input.fixedJobId && targets.some((t) => t.key === input.fixedJobId) && group.targetJobId === input.fixedJobId) {
    // pevná zakázka: bez „nové"
  } else {
    targets.push(newTarget);
  }
  jobItemsByTarget.new = [];

  // výchozí cíl
  let initialKey: string;
  const override = input.targetOverride?.toLowerCase() ?? null;
  if (override && (override === "new" || targets.some((t) => t.key === override))) initialKey = override;
  else if (group.targetJobId && targets.some((t) => t.key === group.targetJobId)) initialKey = group.targetJobId;
  else if (group.targetRequired) initialKey = "";
  else {
    const best = targets.find((t) => t.mode === "existing" && (t.score ?? 0) >= 60);
    initialKey = best?.key ?? "new";
  }
  const initTarget = targets.find((t) => t.key === initialKey) ?? newTarget;
  for (const msg of qtyNotes[initTarget.key] ?? []) warnings.push(makeWarning("quantity_conflict", "info", primaryId ? [primaryId] : [], msg, [], group.key));
  const initDeadline = deadlineByTarget[initTarget.key] ?? (isOrderPrimary ? batchDeadline : null);
  if (initDeadline) warnings.push(...initDeadline.warnings);

  // stav skupiny (zakázka)
  const chip = primary && primaryBusiness ? chipFor(groupDoc.docKind, groupDoc.issuer).chip : chipFor("ostatni", "neznamy").chip;
  const customerMatch = primary?.customerMatch ?? docs.find((d) => d.customerMatch && sideOf(d.type) === "customer")?.customerMatch ?? null;
  const supplierMatch = primarySide === "supplier" ? primary?.supplierMatch ?? null : null;
  const jobState = initialReviewState({
    docKind: chip.docKind,
    issuer: chip.issuer ?? groupDoc.issuer,
    target: initTarget,
    customerMatch,
    supplierMatch,
    docCustomer: groupDoc.customer,
    docSupplier: primarySide === "supplier" ? groupDoc.supplier : emptyParty(),
    docNote: "",
  });
  jobState.chip = chip.key as CaptureChipKey;
  jobState.targetKey = initialKey;
  jobState.customer = ourGuard(jobState.customer, ourIco);
  // nabídka dodavatele nezapisuje dodavatele zakázky (vítěz jen přepínačem)
  if (primarySide !== "supplier" || primary?.type === "nabidka_dodavatel") jobState.supplier = { mode: "none" };
  else jobState.supplier = ourGuard(jobState.supplier, ourIco);
  if (initialKey === "") jobState.stage = "keep";
  else jobState.stage = initTarget.mode === "new" ? (newTarget.stageTo ?? "poptavka") : (initTarget.stageTo ?? "keep");

  const fieldSources: Partial<Record<ReviewFieldKey, FieldSource>> = { ...newExtra.sources };
  const custMap: Partial<Record<keyof ExtractedParty, ReviewFieldKey>> = {
    contactPerson: "customerContact", email: "customerContactEmail", phone: "customerContactPhone",
  };
  for (const [k, src] of Object.entries(merged.customerSources) as [keyof ExtractedParty, FieldSource][]) {
    const fk = custMap[k];
    if (fk && jobState.fields[fk]) fieldSources[fk] = src;
  }
  if (initDeadline?.source) {
    const date = initDeadline.date || groupDoc.requiredDeliveryDate;
    if (date && initTarget.proposed.customerRequiredDate === date) fieldSources.customerRequiredDate = initDeadline.source;
    if (date && initDeadline.fillDue && initTarget.proposed.dueDate === date) fieldSources.dueDate = initDeadline.source;
  }
  for (const k of Object.keys(fieldSources) as ReviewFieldKey[]) {
    if (!initTarget.proposed[k] && !jobState.fields[k]) delete fieldSources[k];
  }

  // viditelná pole
  const visible = new Set<ReviewFieldKey>(["title"]);
  for (const d of docs) {
    if (!isBusinessType(d.type)) continue;
    for (const k of CHIP_FIELDS[d.type as CaptureChipKey] ?? []) visible.add(k);
  }
  for (const k of REVIEW_FIELD_KEYS) if (initTarget.proposed[k] || initTarget.conflicts[k] || jobState.fields[k]) visible.add(k);
  const visibleFields = REVIEW_FIELD_KEYS.filter((k) => visible.has(k) && !DOC_ONLY_FIELDS.includes(k) && (margins || !REVIEW_FIELDS[k].sensitive));

  // položky, které má skupina (pro vazby výkresů)
  const groupHasItems = initTarget.newItems.length > 0 || (jobItemsByTarget[initTarget.key]?.length ?? 0) > 0
    || docs.some((d) => isBusinessType(d.type) && sideOf(d.type) === "customer" && (businessDoc(d)?.items.length ?? 0) > 0);
  const itemOptions: Record<string, ItemOption[]> = {};
  for (const t of targets) itemOptions[t.key] = itemOptionsFor(t, jobItemsByTarget[t.key] ?? []);
  if (initialKey === "") itemOptions[""] = itemOptionsFor(newTarget, []);

  // doklady
  const docReviews: BatchDocReview[] = [];
  const docStates: Record<string, DocApplyState> = {};
  const winnerKnown = new Set(input.jobsWithWinner ?? []);
  const supplierQuotes = docs.filter((d) => d.type === "nabidka_dodavatel");
  const allItems = [...initTarget.newItems.map((i) => ({ drawingNumber: i.drawingNumber, name: i.name, revision: i.revision, quantity: cleanNumber(i.quantity) ?? 0 })),
    ...(jobItemsByTarget[initTarget.key] ?? []).map((i) => ({ drawingNumber: i.drawingNumber ?? "", name: i.name ?? "", revision: i.revision ?? "", quantity: i.quantity }))];
  for (const d of docs) {
    const meta = BATCH_TYPES[d.type];
    const dup = input.duplicates?.[d.id] ?? null;
    if (meta.form === "business") {
      const doc = businessDoc(d) ?? emptyExtracted();
      const side = meta.side;
      const hide = !margins && side === "supplier";
      const supplier = side === "supplier"
        ? ourGuard(defaultSupplierChoice({ mode: "new", supplierId: null, supplierName: null }, d.supplierMatch, doc.supplier), ourIco)
        : { mode: "none" as const };
      const unmatchedRows: ReviewItem[] = [];
      if (d.id !== primaryId && side === "customer") {
        doc.items.forEach((it, n) => {
          if (matchItem(allItems, it)) return;
          unmatchedRows.push(itemInputToReview({
            quantity: it.quantity, unit: it.unit, drawingNumber: it.drawingNumber, revision: it.revision, name: it.name,
            description: it.description, material: it.material, unitPrice: it.unitPrice > 0 ? it.unitPrice : undefined,
          }, `x-${d.id}-${n}`, true, margins));
        });
      }
      const flags = d.flags;
      const state: BusinessDocState = {
        type: d.type,
        documentNumber: safeDocNumber(doc.documentNumber) || d.documentNumber,
        documentDate: cleanDate(doc.documentDate) ?? "",
        docNote: hide ? redactPrices(doc.note) : doc.note,
        fileOnly: false,
        supplier,
        confirmDelivered: d.type === "dodaci_list_my" && flags.includes("signed"),
        invoiceDueDate: "",
        paidComplete: false,
        quoteLines: d.type === "nabidka_dodavatel" && margins ? quoteLinesOf(doc, true) : [],
        selectWinner: d.type === "nabidka_dodavatel" && margins && supplierQuotes.length === 1
          && !(initTarget.mode === "existing" && initTarget.jobId && winnerKnown.has(initTarget.jobId)),
        advancePurchaseOrder: d.type === "potvrzeni_dodavatel" || (d.type === "dodaci_list_dodavatel" && !flags.includes("partial")),
        onDuplicate: dup && !dup.weak ? "skip" : null,
      };
      docStates[d.id] = { kind: "business", state };
      docReviews.push({
        kind: "business", docId: d.id, groupKey: group.key, type: d.type, primary: d.id === primaryId,
        aiUsed: d.aiUsed, reason: d.reason, confidence: d.confidence,
        summary: hide ? redactPrices(doc.summary) : doc.summary,
        needsClarification: hide ? doc.needsClarification.map(redactPrices) : doc.needsClarification,
        flags, docCustomer: doc.customer, docSupplier: doc.supplier, supplierMatch: d.supplierMatch,
        unmatchedRows, duplicateOf: dup, initial: state,
      });
      if (d.type === "nabidka_dodavatel") {
        if (!margins) {
          warnings.push(makeWarning("price_hidden", "info", [d.id], "Ceny nabídky dodavatele vidí jen obchodník a admin."));
          warnings.push(makeWarning("purchasing_pending", "info", [d.id], "Nabídka dodavatele se přiloží jako soubor a počká na zapsání do Nákupu."));
        }
        const unmatched = doc.items.filter((it) => !matchItem(allItems, it));
        if (unmatched.length && allItems.length) {
          warnings.push(makeWarning(
            "supplier_item_unmatched", "info", [d.id],
            `${unmatched.length} ${unmatched.length === 1 ? "řádek nabídky dodavatele nesedí" : "řádky nabídky dodavatele nesedí"} na položky zakázky.`,
          ));
        }
      }
      if (meta.docKind === "faktura" && flags.includes("proforma")) {
        warnings.push(makeWarning("proforma", "info", [d.id], "Zálohová faktura — přiloží se, fakturace ani stav se nemění."));
      }
      if (meta.docKind === "faktura" && flags.includes("credit_note")) {
        warnings.push(makeWarning("credit_note", "info", [d.id], "Dobropis — přiloží se, fakturace ani stav se nemění."));
      }
      if (d.type === "dodaci_list_dodavatel" && flags.includes("partial")) {
        warnings.push(makeWarning("partial_delivery", "info", [d.id], "Dílčí dodávka — stav se posune, jen když to potvrdíš."));
      }
      if (d.type === "faktura_dodavatel") {
        warnings.push(makeWarning("not_in_purchasing", "info", [d.id], "Fakturu dodavatele zkontroluj v Nákupu."));
      }
      if (dup) {
        warnings.push(makeWarning(
          "already_saved", "warn", [d.id], dup.weak
            ? `${docLabel(d)} se stejným číslem už je u ${dup.jobNumber}${dup.date ? ` (${dup.date})` : ""} — zkontroluj, jestli jde o stejný doklad.`
            : `${docLabel(d)} už je u ${dup.jobNumber}${dup.date ? ` (${dup.date})` : ""}.`,
          [{ kind: "skip_duplicate", label: "Neukládat znovu", docId: d.id }, { kind: "save_version", label: "Uložit jako novou verzi", docId: d.id }],
          group.key,
        ));
      }
      continue;
    }
    if (meta.form === "drawing") {
      const dr = drawingOf(d);
      const numbers = ownDrawingNumbers(d);
      const number = dr?.drawingNumber || d.documentNumber || d.drawingNumbers[0] || "";
      const revision = dr?.revision || "";
      const link = defaultLink(numbers, initTarget, jobItemsByTarget[initTarget.key] ?? [], groupHasItems);
      // počet kusů a název: položka skupiny (objednávka > nabídka > poptávka > výkres), jinak položka
      // existující zakázky (už z objednávky), jinak z výkresu; bez počtu → „doplň počet"
      const info = gd.drawingInfo[d.id] ?? null;
      const linkedJobItem = link.mode === "item" ? (jobItemsByTarget[initTarget.key] ?? []).find((i) => i.id === link.itemId) ?? null : null;
      let quantity = info?.quantity ?? (dr?.quantity && dr.quantity > 0 ? dr.quantity : 0);
      let quantitySource = info?.quantitySource ?? (quantity > 0 ? "z výkresu" : "");
      let title = info?.title ?? dr?.title ?? "";
      let titleSource = info?.titleSource ?? "";
      if ((info?.itemIndex ?? null) === null && linkedJobItem && initTarget.mode === "existing") {
        const jobNo = initTarget.number ?? "zakázky";
        if (Number(linkedJobItem.quantity) > 0) {
          quantity = Number(linkedJobItem.quantity);
          quantitySource = `z položky zakázky ${jobNo}`;
        }
        if (linkedJobItem.name?.trim()) {
          const other = Boolean(dr?.title.trim() && nameSimilarity(dr.title, linkedJobItem.name) < 0.95);
          title = linkedJobItem.name.trim();
          titleSource = `název z položky zakázky ${jobNo}${other ? ` (na výkresu „${dr!.title.trim()}")` : ""}`;
        }
      }
      const drawing: DrawingExtract = dr ? { ...dr, drawingNumbers: drawingNumbersOf(dr) } : {
        drawingNumber: number, revision, title: "", material: "", dimensions: "", weightKg: 0, generalTolerance: "",
        tightestTolerance: "", surface: "", heatTreatment: "", surfaceTreatment: "", quantity: 0, customerName: "",
        drawingDate: "", sheet: "", scale: "", notes: "", summary: "", confidence: 0, needsClarification: [], drawingNumbers: numbers,
      };
      const quantityText = quantity > 0 ? String(Math.round(quantity * 1000) / 1000) : "";
      const state: DrawingReviewState = {
        drawingNumber: number, revision, title, material: dr?.material ?? "", dimensions: dr?.dimensions ?? "",
        generalTolerance: dr?.generalTolerance ?? "", tightestTolerance: dr?.tightestTolerance ?? "",
        quantity: quantityText, link, archive: true, note: "", onDuplicate: dup && !dup.weak ? "skip" : null,
        // materiál, hmotnost, TZ / PÚ (výslovný stav), poznámky — návrh AI + odhad polotovaru
        spec: initialSpecState(drawing, { aiUsed: d.aiUsed && Boolean(dr), title, quantity: quantityText }),
      };
      docStates[d.id] = { kind: "drawing", state };
      const sources: { quantity?: string; title?: string } = {};
      if (quantity > 0 && quantitySource) sources.quantity = quantitySource;
      if (title && titleSource) sources.title = titleSource;
      docReviews.push({
        kind: "drawing", docId: d.id, groupKey: group.key, aiUsed: d.aiUsed, reason: d.reason, drawing,
        duplicateOf: dup, archiveConflict: input.archiveConflicts?.[d.id] ?? null,
        ...(Object.keys(sources).length ? { sources } : {}), initial: state,
      });
      if (!(quantity > 0)) {
        warnings.push(makeWarning(
          "drawing_quantity_missing", "warn", [d.id],
          `Výkres ${number || d.title || ""}: počet kusů neuvádí objednávka, nabídka ani výkres — doplň počet.`.replace(/\s+:/, ":"), [], group.key,
        ));
      }
      const item = allItems.find((i) => sharedNumber(numbers, i.drawingNumber));
      const itemNo = item ? sharedNumber(numbers, item.drawingNumber) : number;
      if (item && revision && item.revision && item.revision.trim().toUpperCase() !== revision.trim().toUpperCase()) {
        warnings.push(makeWarning("revision_conflict", "warn", [d.id], `rev. ${item.revision} × výkres rev. ${revision} (${itemNo})`, [], group.key));
      }
      // počty u položek dokladu řeší groupDocOf („Platí objednávka…"); tady jen proti položce existující zakázky
      const inGroupDoc = groupDoc.items.some((i) => sharedNumber(numbers, i.drawingNumber));
      const jobItem = (jobItemsByTarget[initTarget.key] ?? []).find((i) => sharedNumber(numbers, i.drawingNumber));
      if (!inGroupDoc && jobItem && dr?.quantity && jobItem.quantity && Math.abs(jobItem.quantity - dr.quantity) > 1e-9) {
        warnings.push(makeWarning("quantity_conflict", "info", [d.id], `Platí zakázka: ${qtyText(jobItem.quantity, jobItem.unit ?? "ks")} (výkres ${qtyText(dr.quantity, jobItem.unit ?? "ks")}) — ${itemNo}`, [], group.key));
      }
      if (link.mode === "none") {
        warnings.push(makeWarning("unlinked_drawing", "warn", [d.id], `Výkres ${number || d.title || ""} nesedí na žádnou položku — vyber ji, nebo založ novou.`.replace(/\s+—/, " —"), [], group.key));
      }
      if (input.archiveConflicts?.[d.id]) {
        warnings.push(makeWarning("drawing_archive_conflict", "warn", [d.id], input.archiveConflicts[d.id], [], group.key));
      }
      if (dup) {
        warnings.push(makeWarning(
          "already_saved", "warn", [d.id], `Výkres ${number} už je u ${dup.jobNumber}.`,
          [{ kind: "skip_duplicate", label: "Neukládat znovu", docId: d.id }, { kind: "save_version", label: "Uložit jako novou verzi", docId: d.id }],
          group.key,
        ));
      }
      continue;
    }
    if (meta.form === "model") {
      const m = modelOf(d) ?? { format: null, drawingNumber: d.documentNumber || d.drawingNumbers[0] || "", revision: "", title: "" };
      const numbers = ownDrawingNumbers(d);
      const link = defaultLink(numbers, initTarget, jobItemsByTarget[initTarget.key] ?? [], groupHasItems || docs.some((x) => x.type === "vykres"));
      // model se stejným číslem jako výkres dávky půjde za výkresem (vazbu dostane při ukládání)
      const sameAsDrawing = docs.some((x) => x.type === "vykres" && ownDrawingNumbers(x).some((n) => numbers.some((k) => docNumbersEqual(n, k))));
      const state: ModelReviewState = {
        format: m.format, drawingNumber: m.drawingNumber, revision: m.revision, title: m.title, link: link.mode === "add" && sameAsDrawing ? { mode: "none" } : link,
        note: "", onDuplicate: dup && !dup.weak ? "skip" : null,
      };
      docStates[d.id] = { kind: "model", state };
      docReviews.push({ kind: "model", docId: d.id, groupKey: group.key, meta: m, duplicateOf: dup, initial: state });
      if (state.link.mode === "none" && !sameAsDrawing) {
        warnings.push(makeWarning("unlinked_model", "info", [d.id], `3D model ${m.drawingNumber || d.filename} není přiřazený k položce.`, [], group.key));
      }
      if (dup) {
        warnings.push(makeWarning(
          "already_saved", "warn", [d.id], `3D model ${m.drawingNumber || d.filename} už je u ${dup.jobNumber}.`,
          [{ kind: "skip_duplicate", label: "Neukládat znovu", docId: d.id }, { kind: "save_version", label: "Uložit jako novou verzi", docId: d.id }],
          group.key,
        ));
      }
      continue;
    }
    const guessed = guessFileKind(d.filename);
    const fileKind: JobFileKind = d.type === "foto" ? "foto" : guessed === "korespondence" || guessed === "foto" ? guessed : "ostatni";
    const state: FileReviewState = { fileKind, title: d.title || d.filename, note: "" };
    docStates[d.id] = { kind: "file", state };
    docReviews.push({ kind: "file", docId: d.id, groupKey: group.key, initial: state });
  }

  if (initialKey === "") {
    const what = docs[0] ? docLabel(docs[0]) : "doklady";
    warnings.push(makeWarning("target_required", "block", docs.map((d) => d.id), `Vyber zakázku pro ${what}`, [], group.key));
  }

  const label = [group.customerName || (primary ? businessDoc(primary)?.supplier.name : "") || "", primary?.documentNumber ?? ""]
    .filter(Boolean).join(" · ") || (docs[0] ? docLabel(docs[0]) : "Doklady");
  const model: BatchGroupReview["model"] = {
    captureId: input.captureId,
    aiUsed: primary?.aiUsed ?? docs.some((d) => d.aiUsed),
    reason: primary?.reason ?? null,
    docKind: chip.docKind,
    issuer: chip.issuer ?? groupDoc.issuer,
    chipExact: true,
    documentNumber: primary?.documentNumber ?? "",
    confidence: primary?.confidence ?? null,
    summary: primaryBusiness ? (!margins && primarySide === "supplier" ? redactPrices(primaryBusiness.summary) : primaryBusiness.summary) : "",
    needsClarification: [],
    docCustomer: groupDoc.customer,
    docSupplier: primarySide === "supplier" ? groupDoc.supplier : emptyParty(),
    customerMatch,
    supplierMatch,
    fixedJobId: group.targetJobId && group.targetJobId === input.fixedJobId ? input.fixedJobId : null,
    targets,
    margins,
    mode: input.mode,
    initial: jobState,
  };
  const jobDraftTitle = !hasBusiness ? (newTarget.proposed.title ?? "") : "";
  return {
    review: {
      key: group.key, docIds: docs.map((d) => d.id), primaryDocId: primaryId, label: clipText(label, 120),
      autoReason: group.autoReason, model, visibleFields, fieldSources, itemSources, itemOptions,
    },
    docs: docReviews,
    state: { key: group.key, docIds: docs.map((d) => d.id), job: jobState, customerConfirmed: group.customerConfirmed === true, jobDraftTitle },
    docStates,
    warnings,
  };
}

// ── Plná automatika ─────────────────────────────────────────
const AUTO_CONFIDENCE = 0.85;
const AUTO_SCORE = 90;
const DOC_NO = /^[A-Za-z0-9/._-]{1,40}$/;

/**
 * Smí se dávka uložit bez kontroly (režim plná automatika)? Jen když je vše jisté a nic citlivého:
 * žádná faktura, potvrzení DL, změna objednávky dodavateli, nabídka dodavatele, nový zákazník ani
 * posun stavu o víc než 1 krok. Server stejnou funkci volá znovu nad daty relace.
 */
export function canAutoApplyBatch(review: BatchReviewModel, summaries: DocExtractSummary[]): boolean {
  if (review.mode !== "full" || !review.aiUsed) return false;
  if (review.warnings.some((w) => w.severity !== "info")) return false;
  const active = review.initial.sort.docs.filter((d) => !d.excluded);
  if (!active.length) return false;
  // jedno nahrání = jedna zakázka: rozdělená dávka (víc cílových zakázek) vždy ke kontrole člověkem
  const activeIds = new Set(active.map((d) => d.id));
  if (distinctJobCount(review.initial.groups.filter((g) => g.docIds.some((id) => activeIds.has(id)))) > 1) return false;
  for (const d of active) {
    if (d.aiType !== d.type) return false;
    const s = summaries.find((x) => x.docId === d.id);
    if (!s || s.status !== "ready") return false;
    // faktura dodavatele jde do Faktur dodavatelů (rozdělení má vlastní režim automatiky)
    if (isSupplierInvoiceType(d.type)) continue;
    if (BATCH_TYPES[d.type].form === "business" || BATCH_TYPES[d.type].form === "drawing") {
      if ((s.confidence ?? 0) < AUTO_CONFIDENCE || s.clarifications > 0) return false;
    }
    if (BATCH_TYPES[d.type].group === "my" && d.issuerCheck !== "ok") return false;
    const st = review.initial.docs[d.id];
    if (!st) return false;
    if (st.kind === "business") {
      const b = st.state;
      if (b.documentNumber && !DOC_NO.test(b.documentNumber)) return false;
      if (b.type === "faktura_my" || b.type === "nabidka_dodavatel") return false;
      if (b.type === "dodaci_list_my" && b.confirmDelivered) return false;
      if ((b.type === "potvrzeni_dodavatel" || b.type === "dodaci_list_dodavatel") && b.advancePurchaseOrder) return false;
      if (b.onDuplicate) return false;
      if (sideOf(b.type) === "supplier") {
        const r = review.docs.find((x) => x.docId === d.id);
        const match = r && r.kind === "business" ? r.supplierMatch : null;
        if (!match || !/^podle IČO/.test(match.reason)) return false;
      }
    } else if ((st.kind === "drawing" || st.kind === "model") && st.state.onDuplicate) return false;
  }
  for (const g of review.initial.groups) {
    const rg = review.groups.find((x) => x.key === g.key);
    if (!rg || !g.job.targetKey) return false;
    const t = rg.model.targets.find((x) => x.key === g.job.targetKey);
    if (!t) return false;
    // nejistý řádek (≈ 2 %) = otázka pro člověka, nikdy tiché přidání
    if (openPairQuestions(g.job.items).length) return false;
    if (t.mode === "existing") {
      const fixedOk = Boolean(review.fixedJobId && t.jobId === review.fixedJobId);
      if (!fixedOk && (t.score ?? 0) < AUTO_SCORE) return false;
      if (g.job.stage !== "keep" && t.stage && stageRank(g.job.stage) - stageRank(t.stage) > 1) return false;
    } else if (rg.model.targets.some((x) => x.mode === "existing" && (x.score ?? 0) >= 60)) {
      return false;
    }
    if (g.job.customer.mode === "new") return false;
    const hasCustomerDoc = g.docIds.some((id) => {
      const d = active.find((x) => x.id === id);
      return d && isBusinessType(d.type) && sideOf(d.type) === "customer";
    });
    if (hasCustomerDoc && t.mode === "new") {
      const m = rg.model.customerMatch;
      if (!m || !/^podle IČO/.test(m.reason)) return false;
    }
  }
  return true;
}

// ── Kontrola odeslaného stavu (server) ──────────────────────
export interface SanitizeBatchContext {
  pages: BatchPage[];
  margins: boolean;
  ourIco: string;
  /** Zákazník zákaznických dokladů (pro nevyřešený konflikt zákazníka). */
  customerParties?: Record<string, Pick<ExtractedParty, "name" | "ico"> | null>;
}

const LINK_MODES = ["item", "docItem", "add", "none"];

function s(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" && Number.isFinite(v) ? String(v) : "";
}

function cleanLink(raw: unknown): ItemLinkChoice | string {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : { mode: "none" };
  if (!LINK_MODES.includes(o.mode as string)) return "Neplatná vazba na položku.";
  if (o.mode === "item") return isUuid(o.itemId) ? { mode: "item", itemId: (o.itemId as string).toLowerCase() } : "Neplatná vazba na položku.";
  if (o.mode === "docItem") {
    const key = s(o.itemKey, 80);
    return key ? { mode: "docItem", itemKey: key } : "Neplatná vazba na položku.";
  }
  return { mode: o.mode as "add" | "none" };
}

function cleanDup(v: unknown): "skip" | "version" | null {
  return v === "skip" || v === "version" ? v : null;
}

function cleanPartyChoice(raw: unknown): PartyChoice | string {
  const res = sanitizeReviewState(
    { chip: "nabidka_dodavatel", targetKey: "new", customer: { mode: "none" }, supplier: raw, fields: {}, items: [], merges: [] },
  );
  return res.ok ? res.state.supplier : res.error;
}

function sanitizeDocState(
  type: BatchDocType,
  raw: unknown,
  margins: boolean,
): DocApplyState | string {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!o) return "Chybí údaje dokladu.";
  const st = o.state && typeof o.state === "object" ? (o.state as Record<string, unknown>) : {};
  const form = BATCH_TYPES[type].form;
  if (o.kind !== form) return `Formulář dokladu neodpovídá druhu „${BATCH_TYPES[type].label}".`;
  if (form === "business") {
    const date = s(st.documentDate, 20);
    if (date && !cleanDate(date)) return "Neplatné datum dokladu.";
    const due = s(st.invoiceDueDate, 20);
    if (due && !cleanDate(due)) return "Neplatná splatnost faktury.";
    const supplier = sideOf(type) === "supplier" ? cleanPartyChoice(st.supplier) : { mode: "none" as const };
    if (typeof supplier === "string") return supplier;
    const lines: SupplierQuoteLineState[] = [];
    if (type === "nabidka_dodavatel" && Array.isArray(st.quoteLines)) {
      for (const [i, l] of st.quoteLines.slice(0, 500).entries()) {
        const r = l && typeof l === "object" ? (l as Record<string, unknown>) : {};
        const line: SupplierQuoteLineState = {
          key: s(r.key, 60) || `q-${i}`, drawingNumber: s(r.drawingNumber, 120), name: s(r.name, 500), material: s(r.material, 200),
          quantity: s(r.quantity, 30), unit: s(r.unit, 20), unitPrice: margins ? s(r.unitPrice, 30) : "",
        };
        if (!line.drawingNumber && !line.name) continue;
        if (line.quantity) {
          const q = cleanNumber(line.quantity);
          if (q === null || q <= 0 || q > 1e8) return `Řádek nabídky ${i + 1}: neplatné množství.`;
        }
        if (line.unitPrice) {
          const p = cleanNumber(line.unitPrice);
          if (p === null || p < 0 || p > 1e11) return `Řádek nabídky ${i + 1}: neplatná cena.`;
        }
        lines.push(line);
      }
    }
    const docNumber = s(st.documentNumber, 120);
    return {
      kind: "business",
      state: {
        type,
        documentNumber: docNumber,
        documentDate: date ? cleanDate(date)! : "",
        docNote: s(st.docNote, 2000),
        fileOnly: st.fileOnly === true,
        supplier,
        confirmDelivered: type === "dodaci_list_my" && st.confirmDelivered === true,
        invoiceDueDate: type === "faktura_my" && due ? cleanDate(due)! : "",
        paidComplete: type === "faktura_my" && st.paidComplete === true,
        quoteLines: margins ? lines : [],
        selectWinner: type === "nabidka_dodavatel" && margins && st.selectWinner === true,
        advancePurchaseOrder: (type === "potvrzeni_dodavatel" || type === "dodaci_list_dodavatel") && margins && st.advancePurchaseOrder === true,
        onDuplicate: cleanDup(st.onDuplicate),
      },
    };
  }
  if (form === "drawing") {
    const link = cleanLink(st.link);
    if (typeof link === "string") return link;
    const qty = s(st.quantity, 30);
    if (qty && (cleanNumber(qty) === null || (cleanNumber(qty) ?? 0) < 0)) return "Výkres: neplatné množství.";
    const spec = sanitizeSpecState(st.spec);
    if (typeof spec === "string") return spec;
    return {
      kind: "drawing",
      state: {
        drawingNumber: s(st.drawingNumber, 80), revision: s(st.revision, 20), title: s(st.title, 300), material: s(st.material, 200),
        dimensions: s(st.dimensions, 200), generalTolerance: s(st.generalTolerance, 120), tightestTolerance: s(st.tightestTolerance, 120),
        quantity: qty, link, archive: st.archive !== false, note: s(st.note, 2000), onDuplicate: cleanDup(st.onDuplicate),
        ...(spec ? { spec } : {}),
      },
    };
  }
  if (form === "model") {
    const link = cleanLink(st.link);
    if (typeof link === "string") return link;
    return {
      kind: "model",
      state: {
        format: null, drawingNumber: s(st.drawingNumber, 80), revision: s(st.revision, 20), title: s(st.title, 300),
        link, note: s(st.note, 2000), onDuplicate: cleanDup(st.onDuplicate),
      },
    };
  }
  const fk = isJobFileKind(st.fileKind) ? st.fileKind : type === "foto" ? "foto" : "ostatni";
  return { kind: "file", state: { fileKind: fk as JobFileKind, title: s(st.title, 300), note: s(st.note, 2000) } };
}

/** Úklid roztřídění z prohlížeče (id, druhy, stránky); kontrolu proti stránkám dělá validateBatchSort. */
export function sanitizeBatchSort(raw: unknown): BatchSort | string {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!o || !Array.isArray(o.docs)) return "Chybí roztřídění dokladů.";
  if (o.docs.length > 200) return "Příliš mnoho dokladů v dávce.";
  const docs = [];
  for (const r of o.docs) {
    const d = r && typeof r === "object" ? (r as Record<string, unknown>) : {};
    const id = s(d.id, 40);
    if (!/^(d\d{1,4}|u-[a-z0-9]{8})$/.test(id)) return "Neplatný identifikátor dokladu.";
    if (!isBatchDocType(d.type)) return "Neznámý druh dokladu.";
    const pageIds = Array.isArray(d.pageIds) ? d.pageIds.filter((p): p is string => typeof p === "string").slice(0, 200) : [];
    docs.push({
      id, type: d.type, pageIds,
      aiType: isBatchDocType(d.aiType) ? d.aiType : null,
      confidence: typeof d.confidence === "number" && Number.isFinite(d.confidence) ? Math.min(1, Math.max(0, d.confidence)) : null,
      reason: s(d.reason, 300), title: s(d.title, 200), documentNumber: s(d.documentNumber, 80), partyName: s(d.partyName, 200),
      drawingNumbers: (Array.isArray(d.drawingNumbers) ? d.drawingNumbers : []).map((x) => s(x, 80)).filter(Boolean).slice(0, 50),
      format: null,
      flags: (Array.isArray(d.flags) ? d.flags : []).filter((f): f is DocFlag => typeof f === "string" && ["signed", "accepted", "proforma", "credit_note", "partial", "paid", "complaint"].includes(f)),
      issuerCheck: d.issuerCheck === "ok" || d.issuerCheck === "mismatch" ? d.issuerCheck : "unknown",
      excluded: d.excluded === true,
    } as BatchSort["docs"][number]);
  }
  const excludedPageIds = Array.isArray(o.excludedPageIds) ? o.excludedPageIds.filter((p): p is string => typeof p === "string").slice(0, 500) : [];
  return { docs, excludedPageIds };
}

/**
 * Skupina obsahuje doklady s odlišným IČO zákazníka (nevyřešený konflikt). Jinak psaný název bez IČO
 * konflikt není — jedno nahrání = jedna zakázka, zákazník se bere z primárního dokladu.
 */
function hasCustomerConflict(parties: (Pick<ExtractedParty, "name" | "ico"> | null)[], ourIco: string): boolean {
  const icos = new Set(parties.map((p) => digits(p?.ico)).filter((i) => i && i !== digits(ourIco)));
  return icos.size > 1;
}

/**
 * Kontrola a úklid stavu dávky z prohlížeče: stránky ↔ doklady, formuláře podle druhu, každý doklad
 * v právě jedné skupině, vybraný cíl, vyřešený konflikt zákazníka, položky jen z primárního dokladu
 * (+ ruční „new-*" a „x-<doklad>-*" ze zákaznických dokladů skupiny), bez práva na marže bez nákupních cen.
 */
export function sanitizeBatchApplyState(
  raw: unknown,
  ctx: SanitizeBatchContext,
): { ok: true; state: BatchApplyState } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Chybí údaje dávky." };
  const o = raw as Record<string, unknown>;
  const sort = sanitizeBatchSort(o.sort);
  if (typeof sort === "string") return { ok: false, error: sort };
  const invalid = validateBatchSort(sort, ctx.pages);
  if (invalid) return { ok: false, error: invalid };
  // faktury dodavatelů nejsou ve skupinách zakázek (uloží se do Faktur dodavatelů)
  const active = sort.docs.filter((d) => !d.excluded && !isSupplierInvoiceType(d.type));
  const activeIds = new Set(active.map((d) => d.id));

  const rawDocs = o.docs && typeof o.docs === "object" ? (o.docs as Record<string, unknown>) : {};
  const docs: Record<string, DocApplyState> = {};
  for (const d of active) {
    const st = sanitizeDocState(d.type, rawDocs[d.id], ctx.margins);
    if (typeof st === "string") return { ok: false, error: `${BATCH_TYPES[d.type].label}: ${st}` };
    docs[d.id] = st;
  }

  const rawGroups = Array.isArray(o.groups) ? o.groups.slice(0, 100) : [];
  const groups: BatchGroupState[] = [];
  const placed = new Set<string>();
  for (const rg of rawGroups) {
    const g = rg && typeof rg === "object" ? (rg as Record<string, unknown>) : {};
    const key = s(g.key, 20);
    if (!/^g\d{1,3}$/.test(key) || groups.some((x) => x.key === key)) return { ok: false, error: "Neplatná skupina dokladů." };
    const docIds = (Array.isArray(g.docIds) ? g.docIds : []).filter((x): x is string => typeof x === "string" && activeIds.has(x));
    for (const id of docIds) {
      if (placed.has(id)) return { ok: false, error: "Doklad je ve dvou zakázkách." };
      placed.add(id);
    }
    if (!docIds.length) continue;
    const groupDocs = active.filter((d) => docIds.includes(d.id));
    const jobRaw = g.job && typeof g.job === "object" ? (g.job as Record<string, unknown>) : {};
    const targetKey = typeof jobRaw.targetKey === "string" ? jobRaw.targetKey.toLowerCase() : "";
    if (!targetKey) {
      const first = groupDocs[0];
      return { ok: false, error: `Vyber zakázku pro ${first ? docLabel(first) : "doklady"}.` };
    }
    const job = sanitizeReviewState(jobRaw);
    if (!job.ok) return { ok: false, error: job.error };
    const customerConfirmed = g.customerConfirmed === true;
    if (!customerConfirmed && ctx.customerParties) {
      const parties = groupDocs.filter((d) => isBusinessType(d.type) && sideOf(d.type) === "customer").map((d) => ctx.customerParties?.[d.id] ?? null);
      if (hasCustomerConflict(parties, ctx.ourIco)) return { ok: false, error: "Rozhodni, zda jde o stejného zákazníka." };
    }
    // položky skupiny: z primárního dokladu (ai-*), ručně přidané (new-*), z neprimárních zákaznických dokladů (x-<docId>-*)
    const primaryId = primaryDocId(groupDocs.filter((d) => isBusinessType(d.type)));
    const primary = groupDocs.find((d) => d.id === primaryId) ?? null;
    const primaryCustomer = primary && sideOf(primary.type) === "customer";
    for (const it of job.state.items) {
      const k = it.key;
      if (/^new-/.test(k)) continue;
      if (/^ai-\d+$/.test(k) && primaryCustomer) continue;
      const m = /^x-(d\d{1,4}|u-[a-z0-9]{8})-\d+$/.exec(k);
      if (m && m[1] !== primaryId && groupDocs.some((d) => d.id === m[1] && isBusinessType(d.type) && sideOf(d.type) === "customer")) continue;
      return { ok: false, error: "Položky zakázky mohou přidat jen doklady zákazníka — dodavatelské doklady položky nepřidávají." };
    }
    if (!ctx.margins) {
      job.state.fields = { ...job.state.fields };
      delete job.state.fields.purchaseCost;
      job.state.items = job.state.items.map((i) => ({ ...i, purchaseUnitPrice: "" }));
      job.state.merges = job.state.merges.map((m) => {
        const patch = { ...m.patch };
        delete patch.purchaseUnitPrice;
        return { ...m, patch };
      });
    }
    // vazby výkresů / modelů na nové položky skupiny musí existovat
    for (const d of groupDocs) {
      const st = docs[d.id];
      if ((st.kind === "drawing" || st.kind === "model") && st.state.link.mode === "docItem") {
        const key = st.state.link.itemKey;
        if (!job.state.items.some((i) => i.key === key)) st.state.link = { mode: "none" };
      }
    }
    groups.push({
      key, docIds, job: job.state, customerConfirmed, jobDraftTitle: s(g.jobDraftTitle, 300),
    });
  }
  for (const id of activeIds) {
    if (!placed.has(id)) return { ok: false, error: "Některý doklad není přiřazený k žádné zakázce." };
  }
  return { ok: true, state: { sort, groups, docs, ...(o.auto === true ? { auto: true } : {}) } };
}

/** Stav zakázky skupiny podle odeslaných dokladů (přepínače faktury / dílčí dodávky, jen přiložené se nepočítají). */
export function groupStageFromState(
  state: BatchApplyState,
  group: BatchGroupState,
  target: { mode: "existing" | "new"; stage: JobStage | null },
): JobStage | "keep" {
  const docs: { type: BatchDocType; flags: DocFlag[]; paidComplete?: boolean; partialConfirmed?: boolean }[] = [];
  for (const d of state.sort.docs) {
    if (d.excluded || !group.docIds.includes(d.id) || !isBusinessType(d.type)) continue;
    const st = state.docs[d.id];
    const b = st && st.kind === "business" ? st.state : null;
    if (b && (b.fileOnly || b.onDuplicate === "skip")) continue;
    docs.push({ type: d.type, flags: d.flags, paidComplete: b?.paidComplete, partialConfirmed: b?.advancePurchaseOrder });
  }
  return batchStage(docs, target);
}

// ── Deník ukládání ──────────────────────────────────────────
export const JOURNAL_CONFLICT = "Část dávky je už uložená — roztřídění uložených dokladů ani složení jejich zakázek už nejde měnit. Vrať změny (nebo zavři okno a zbylé doklady vyfoť znovu).";

function sameIdSet(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");
}

/**
 * Deník ukládání je klíčovaný skupinou (g1…) a dokladem (d1…) — po částečném uložení musí
 * skupiny, které už mají zakázku, zůstat se stejnými doklady a uložené doklady se stejnými
 * stránkami a druhem. Jinak by se zakázka jedné skupiny použila pro jiné doklady (nebo se
 * přesunutá stránka neuložila). null = v pořádku.
 */
export function journalConflictOf(
  prev: { groups: { key: string; docIds: string[] }[]; docs: { id: string; type: BatchDocType; pageIds: string[] }[] } | null | undefined,
  steps: Map<string, { status: string }>,
  jobKeys: Set<string>,
  state: Pick<BatchApplyState, "groups" | "sort">,
): string | null {
  if (!prev) return null;
  const locked = new Set<string>();
  for (const g of prev.groups) {
    if (steps.get(`group:${g.key}`)?.status !== "done" && !jobKeys.has(g.key)) continue;
    const now = state.groups.find((x) => x.key === g.key);
    if (!now || !sameIdSet(now.docIds, g.docIds)) return JOURNAL_CONFLICT;
    for (const id of g.docIds) locked.add(id);
  }
  for (const [k, v] of steps) if (k.startsWith("doc:") && v.status === "done") locked.add(k.slice(4));
  for (const id of locked) {
    const a = prev.docs.find((d) => d.id === id);
    const b = state.sort.docs.find((d) => d.id === id);
    if (!a || !b || b.excluded || a.type !== b.type || pagesKey(a.pageIds) !== pagesKey(b.pageIds)) return JOURNAL_CONFLICT;
  }
  return null;
}

// ── Duplicity dokladů ───────────────────────────────────────
/**
 * Je uložený doklad (ai_extracted) stejný doklad? Druh a vystavitel se musí shodovat (naše × dodavatelova
 * faktura mají stejný druh souboru), strana podle IČO, jinak podle názvu; bez údajů = „unknown".
 */
export function sameDocParty(
  ax: Record<string, unknown> | null,
  meta: (typeof BATCH_TYPES)[BatchDocType],
  party: { ico: string; name: string } | null,
): "yes" | "no" | "unknown" {
  const x = ax ?? {};
  if (typeof x.docKind === "string" && meta.docKind && x.docKind !== meta.docKind) return "no";
  if (typeof x.issuer === "string" && meta.issuer && x.issuer !== meta.issuer) return "no";
  const raw = (meta.side === "supplier" ? x.supplier : x.customer) as { ico?: unknown; name?: unknown } | undefined;
  const digits = (v: unknown) => (typeof v === "string" ? v.replace(/\D/g, "") : "");
  const norm = (v: unknown) => (typeof v === "string" ? v.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "") : "");
  const a = digits(raw?.ico), b = digits(party?.ico);
  if (a && b) return a === b ? "yes" : "no";
  const na = norm(raw?.name), nb = norm(party?.name);
  if (na && nb) return na === nb ? "yes" : "no";
  return "unknown";
}
