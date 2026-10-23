import type { JobFileKind, JobStage } from "@/lib/supabase/database.types";
import type { CaptureDocKind, ExtractedBusinessDoc, ExtractedItem, ExtractedParty } from "@/lib/jobs/capture-types";
import type {
  BatchApplyState, BatchDocExtract, BatchDocReview, BatchDocType, BatchGroupReview, BatchGroupState, BatchPage,
  BatchReviewModel, BatchSort, BatchWarning, BusinessDocState, DocApplyState, DocExtractSummary, DocFlag,
  DrawingExtract, DrawingReviewState, DuplicateRef, FieldSource, FileReviewState, ItemLinkChoice, ItemOption,
  ModelMeta, ModelReviewState, SupplierQuoteLineState,
} from "@/lib/jobs/capture-batch-types";
import {
  BATCH_TYPES, batchStage, batchTypeFor, isBatchDocType, isBusinessType, makeWarning, pagesKey, redactPrices, safeDocNumber,
  sideOf, uniqueWarnings, validateBatchSort,
} from "@/lib/jobs/capture-batch";
import {
  CHIP_FIELDS, MERGE_FIELD_LABELS, REVIEW_FIELDS, REVIEW_FIELD_KEYS, buildExistingTarget, buildNewTarget, chipFor,
  defaultSupplierChoice, initialReviewState, itemInputToReview,
  sanitizeReviewState, type CaptureChipKey, type FieldValues, type MergeField, type PartyChoice, type PartyMatchView,
  type ReviewFieldKey, type ReviewItem, type ReviewState, type ReviewTarget, type TargetJob,
} from "@/lib/jobs/capture-review";
import { docFieldValues, planJobUpdate, planNewJob, type JobUpdatePlan, type NewJobPlan } from "@/lib/jobs/apply-extraction";
import { docNumbersEqual, nameSimilarity, normalizeCompanyName } from "@/lib/jobs/matching";
import { emptyExtracted, emptyParty } from "@/lib/jobs/extracted-normalize";
import { guessFileKind, isJobFileKind } from "@/lib/jobs/file-kinds";
import { cleanDate, cleanNumber, isUuid } from "@/lib/jobs/mapping";
import { stageRank } from "@/lib/jobs/stages";
import type { JobInput, JobItem } from "@/lib/jobs/types";

/**
 * Dávkové focení — seskupení dokladů do zakázek a vzájemné doplnění údajů (čisté funkce).
 * Pravidla: doklad jiného zákazníka nikdy nespadne do cizí zakázky; položky zakázky přidává jen
 * primární doklad skupiny (ostatní jen párují a doplňují prázdné údaje); údaje se doplňují jen
 * v rámci strany (zákaznické × dodavatelské); stav jen dopředu; bez práva na marže žádné nákupní ceny.
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
  /** Shoda s existující zakázkou podle přesného čísla (skóre ≥ 88). */
  strongMatch: StrongMatch | null;
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

function digits(v: string | null | undefined): string {
  return (v ?? "").replace(/\D+/g, "");
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

function docDrawingNumbers(d: ReconcileDoc): string[] {
  const out = [...d.drawingNumbers];
  const b = businessDoc(d);
  if (b) for (const it of b.items) if (it.drawingNumber) out.push(it.drawingNumber);
  const dr = drawingOf(d);
  if (dr?.drawingNumber) out.push(dr.drawingNumber);
  const m = modelOf(d);
  if (m?.drawingNumber) out.push(m.drawingNumber);
  if ((d.type === "vykres" || d.type === "model_3d") && d.documentNumber) out.push(d.documentNumber);
  return out.filter(Boolean);
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
}

/**
 * Rozdělí dávku na skupiny zakázek: zákaznické doklady podle zákazníka (IČO / podobný název) a druhé
 * objednávky / poptávky; silná shoda s jinou zakázkou → vlastní skupina; dodavatelské doklady ke
 * shodě / skupině se stejným výkresem; výkresy, modely, fotky ke skupině s jejich číslem.
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
      icos: new Set(), names: [], drawings: [], primaryTypes: new Map(), conflictDocIds: [],
    };
    groups.push(g);
    return g;
  };
  const add = (g: WorkGroup, d: ReconcileDoc) => {
    g.docIds.push(d.id);
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
  };
  const byId = new Map(docs.map((d) => [d.id, d]));

  // 1–3) zákaznické doklady podle zákazníka a druhé objednávky / poptávky
  const customerDocs = docs.filter((d) => isBusinessType(d.type) && sideOf(d.type) === "customer");
  const ordered = [...customerDocs].sort((a, b) => PRIMARY_ORDER.indexOf(a.type) - PRIMARY_ORDER.indexOf(b.type));
  for (const d of ordered) {
    const p = customerParty(d, ourIco);
    const ico = digits(p?.ico);
    let target: WorkGroup | null = null;
    let conflict = false;
    for (const g of groups) {
      let same = false;
      let maybe = false;
      if (!p) same = true;
      else if (ico && g.icos.size) same = g.icos.has(ico);
      else if (!g.names.length && !g.icos.size) same = true;
      else {
        const sim = Math.max(0, ...g.names.map((n) => nameSimilarity(n, p.name)));
        if (ico && g.icos.size && !g.icos.has(ico)) same = false;
        else if (sim >= SAME_NAME) same = true;
        else if (sim >= MAYBE_NAME) maybe = true;
      }
      if (!same && !maybe) continue;
      // druhý doklad stejného primárního druhu s jiným číslem = další zakázka
      if ((d.type === "objednavka_zakaznik" || d.type === "poptavka_zakaznik") && g.primaryTypes.has(d.type)
        && !docNumbersEqual(g.primaryTypes.get(d.type) ?? "", d.documentNumber)) continue;
      target = g;
      conflict = maybe && !same;
      break;
    }
    if (!target) {
      const second = groups.length > 0;
      target = newGroup();
      if (second) {
        const prev = groups.find((g) => g !== target && p && ((ico && g.icos.has(ico)) || g.names.some((n) => nameSimilarity(n, p.name) >= SAME_NAME)));
        target.autoReason = prev
          ? `další ${d.type === "objednavka_zakaznik" ? "objednávka" : "poptávka"}${d.documentNumber ? ` ${d.documentNumber}` : ""} — samostatná zakázka`
          : `jiný zákazník${p?.name ? ` (${p.name.trim()})` : ""}`;
      }
    }
    add(target, d);
    if (conflict) target.conflictDocIds.push(d.id);
  }

  // cíle skupin: silná shoda primárního (jinak prvního) dokladu, hlavní skupina = pevná zakázka
  groups.forEach((g, i) => {
    const gd = g.docIds.map((id) => byId.get(id)!);
    const prim = byId.get(primaryDocId(gd) ?? "") ?? null;
    const strong = (prim?.strongMatch && prim.strongMatch.score >= STRONG_MATCH_SCORE ? prim.strongMatch : null)
      ?? gd.map((x) => x.strongMatch).find((s) => s && s.score >= STRONG_MATCH_SCORE) ?? null;
    if (i === 0 && fixed) g.targetJobId = fixed;
    else if (strong) {
      g.targetJobId = strong.jobId;
      if (!g.autoReason && i > 0) g.autoReason = strong.reason;
    }
  });

  // 4) silná shoda dokladu s jinou zakázkou než zbytek skupiny → vlastní skupina
  const moveToStrong = (d: ReconcileDoc, from: WorkGroup | null) => {
    const s = d.strongMatch!;
    let g = groups.find((x) => x.targetJobId === s.jobId) ?? null;
    if (!g) {
      g = newGroup();
      g.targetJobId = s.jobId;
      g.autoReason = s.reason;
    }
    if (from) from.docIds = from.docIds.filter((id) => id !== d.id);
    add(g, d);
    const main = from ?? groups[0];
    if (main && main !== g) {
      const mainNo = main.targetJobId ? docs.find((x) => x.strongMatch?.jobId === main.targetJobId)?.strongMatch?.jobNumber : null;
      warnings.push(makeWarning(
        "target_conflict", "info", [d.id],
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
      if (!s || s.score < STRONG_MATCH_SCORE || !g.targetJobId || s.jobId === g.targetJobId) continue;
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
    let g = real.find((x) => nums.length && shareDrawing(nums, x.drawings)) ?? null;
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

  // 6) výkresy, modely, fotky, ostatní
  for (const d of docs.filter((x) => !isBusinessType(x.type))) {
    const nums = docDrawingNumbers(d);
    const real = groups.filter((x) => x.docIds.length);
    let g = real.find((x) => nums.length && shareDrawing(nums, x.drawings)) ?? real[0] ?? null;
    if (!g) {
      g = newGroup();
      if (fixed) g.targetJobId = fixed;
      else g.targetRequired = true;
    }
    add(g, d);
  }

  // 7) přiřazení uživatelem
  for (const [docId, key] of Object.entries(input.assign ?? {})) {
    const d = byId.get(docId);
    if (!d) continue;
    const from = groups.find((g) => g.docIds.includes(docId)) ?? null;
    let to = key === "new" ? null : groups.find((g) => g.key === key) ?? null;
    if (to === from && to) continue;
    if (!to) {
      to = newGroup(key !== "new" && /^g\d{1,3}$/.test(key) && !groups.some((g) => g.key === key) ? key : undefined);
      to.autoReason = "přesunuto ručně";
      if (!isBusinessType(d.type) || sideOf(d.type) === "supplier") to.targetRequired = !fixed;
    }
    if (from) {
      from.docIds = from.docIds.filter((id) => id !== docId);
      from.conflictDocIds = from.conflictDocIds.filter((id) => id !== docId);
    }
    add(to, d);
    if (to.docIds.some((id) => { const x = byId.get(id); return x && isBusinessType(x.type) && sideOf(x.type) === "customer"; })) to.targetRequired = false;
  }

  const out = groups.filter((g) => g.docIds.length);
  for (const g of out) {
    if (g.conflictDocIds.length && !confirmed.has(g.key)) {
      const names = [...new Set(g.names)].slice(0, 2).join(" × ");
      warnings.push(makeWarning(
        "customer_conflict", "block", g.conflictDocIds,
        `Je to stejný zákazník? ${names}`,
        [
          { kind: "same_customer", label: "Je to stejný zákazník", groupKey: g.key },
          { kind: "split_group", label: "Samostatná zakázka", docId: g.conflictDocIds[0], groupKey: g.key },
        ],
        g.key,
      ));
    }
  }
  return {
    groups: out.map((g) => ({
      key: g.key, docIds: g.docIds, targetJobId: g.targetJobId, targetRequired: g.targetRequired && !g.targetJobId,
      autoReason: g.autoReason, customerName: g.customerName, partyKey: g.partyKey,
    })),
    warnings: uniqueWarnings(warnings),
  };
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

function matchItem<T extends { drawingNumber?: string | null; name?: string | null }>(list: T[], row: { drawingNumber?: string | null; name?: string | null }): T | null {
  if (row.drawingNumber) {
    const hit = list.find((x) => x.drawingNumber && docNumbersEqual(x.drawingNumber, row.drawingNumber));
    if (hit) return hit;
  }
  if (row.name) {
    return list.find((x) => x.name && nameSimilarity(x.name, row.name) >= SAME_NAME) ?? null;
  }
  return null;
}

/** Vazba výkresu / modelu na položku pro daný cíl. */
function defaultLink(number: string, target: ReviewTarget, jobItems: JobItem[], groupHasItems: boolean): ItemLinkChoice {
  if (number) {
    const ex = jobItems.find((i) => i.drawingNumber && docNumbersEqual(i.drawingNumber, number));
    if (ex) return { mode: "item", itemId: ex.id };
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

export interface GroupDoc {
  primaryId: string | null;
  /** Sloučený doklad skupiny (zákaznický základ, položky jen z primárního). */
  doc: ExtractedBusinessDoc;
  customerSources: Partial<Record<keyof ExtractedParty, FieldSource>>;
  itemSources: Record<string, FieldSource[]>;
  warnings: BatchWarning[];
}

/** Doklad skupiny pro plán zakázky (stejný pro kontrolu i uložení). */
export function groupDocOf(docs: ReconcileDoc[], ourIco: string): GroupDoc {
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

  // položky skupiny ← doplnění z ostatních zákaznických dokladů (jen prázdné údaje)
  const itemSources: Record<string, FieldSource[]> = {};
  const customerOthers = businessOthers.filter((o) => sideOf(o.type) === "customer");
  groupDoc.items = groupDoc.items.map((it, i) => {
    const out = { ...it };
    for (const o of customerOthers) {
      const row = matchItem(o.doc.items, it);
      if (!row) continue;
      for (const f of ["revision", "material", "name", "description"] as const) {
        if (!out[f] && row[f]) {
          out[f] = row[f];
          (itemSources[`ai-${i}`] ??= []).push({ docId: o.id, label: `${f === "description" ? "popis" : MERGE_FIELD_LABELS[f as MergeField]} ${sourceLabel(o)}` });
        }
      }
      if (!(out.unitPrice > 0) && row.unitPrice > 0 && primarySide === "customer") {
        out.unitPrice = row.unitPrice;
        (itemSources[`ai-${i}`] ??= []).push({ docId: o.id, label: `${MERGE_FIELD_LABELS.unitPrice} ${sourceLabel(o)}` });
      }
    }
    // výkres doplní prázdnou revizi / materiál / název
    for (const d of docs.filter((x) => x.type === "vykres")) {
      const dr = drawingOf(d);
      const num = dr?.drawingNumber || d.documentNumber;
      if (!num || !it.drawingNumber || !docNumbersEqual(num, it.drawingNumber)) continue;
      const fills: [keyof ExtractedItem, string][] = [["revision", dr?.revision ?? ""], ["material", dr?.material ?? ""], ["name", dr?.title ?? ""]];
      for (const [f, v] of fills) {
        if (!out[f] && v) {
          (out as unknown as Record<string, unknown>)[f] = v;
          (itemSources[`ai-${i}`] ??= []).push({ docId: d.id, label: `${MERGE_FIELD_LABELS[f as MergeField]} z výkresu ${num}` });
        }
      }
    }
    return out;
  });
  return { primaryId, doc: groupDoc, customerSources: merged.customerSources, itemSources, warnings };
}

/** Návrh kontroly jedné skupiny: cíle, údaje zakázky se zdroji, doklady a jejich výchozí stav. */
export function reconcileGroup(input: ReconcileGroupInput): GroupReconcile {
  const { group, docs, margins, ourIco } = input;
  const warnings: BatchWarning[] = [];
  const gd = groupDocOf(docs, ourIco);
  warnings.push(...gd.warnings);
  const primaryId = gd.primaryId;
  const primary = docs.find((d) => d.id === primaryId) ?? null;
  const primaryBusiness = primary ? businessDoc(primary) : null;
  const primarySide = primary ? sideOf(primary.type) : "none";
  const groupDoc = gd.doc;
  const itemSources = gd.itemSources;
  const merged = { customerSources: gd.customerSources };

  // cíle
  const newExtra = extraFields(docs, primaryId, null, margins);
  const stageDocs = (flagsOf: (d: ReconcileDoc) => { paidComplete?: boolean; partialConfirmed?: boolean }) =>
    docs.filter((d) => isBusinessType(d.type)).map((d) => ({ type: d.type, flags: d.flags, ...flagsOf(d) }));
  const defaultStageDocs = stageDocs(() => ({}));
  const hasBusiness = Boolean(primary);
  const targets: ReviewTarget[] = [];
  const jobItemsByTarget: Record<string, JobItem[]> = {};
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
    const t = buildExistingTarget({ job, plan, docValues, reason: cand.reason, score: cand.score, margins });
    const st = batchStage(defaultStageDocs, { mode: "existing", stage: job.stage });
    t.stageTo = st === "keep" ? null : st;
    for (const k of DOC_ONLY_FIELDS) { delete t.proposed[k]; delete t.conflicts[k]; }
    targets.push(t);
    jobItemsByTarget[t.key] = job.items ?? [];
  }
  const newPlan: NewJobPlan | null = hasBusiness ? stripDocOnly(planNewJob(groupDoc)) : null;
  const newInput: JobInput = { ...(newPlan?.input ?? {}), ...newExtra.patch, ...(newPlan?.input ?? {}) };
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
      const number = dr?.drawingNumber || d.documentNumber || d.drawingNumbers[0] || "";
      const revision = dr?.revision || "";
      const link = defaultLink(number, initTarget, jobItemsByTarget[initTarget.key] ?? [], groupHasItems);
      const state: DrawingReviewState = {
        drawingNumber: number, revision, title: dr?.title ?? "", material: dr?.material ?? "", dimensions: dr?.dimensions ?? "",
        generalTolerance: dr?.generalTolerance ?? "", tightestTolerance: dr?.tightestTolerance ?? "",
        quantity: dr?.quantity ? String(dr.quantity) : "", link, archive: true, note: "", onDuplicate: dup && !dup.weak ? "skip" : null,
      };
      docStates[d.id] = { kind: "drawing", state };
      const drawing: DrawingExtract = dr ?? {
        drawingNumber: number, revision, title: "", material: "", dimensions: "", weightKg: 0, generalTolerance: "",
        tightestTolerance: "", surface: "", heatTreatment: "", surfaceTreatment: "", quantity: 0, customerName: "",
        drawingDate: "", sheet: "", scale: "", notes: "", summary: "", confidence: 0, needsClarification: [],
      };
      docReviews.push({
        kind: "drawing", docId: d.id, groupKey: group.key, aiUsed: d.aiUsed, reason: d.reason, drawing,
        duplicateOf: dup, archiveConflict: input.archiveConflicts?.[d.id] ?? null, initial: state,
      });
      const item = number ? allItems.find((i) => i.drawingNumber && docNumbersEqual(i.drawingNumber, number)) : undefined;
      if (item && revision && item.revision && item.revision.trim().toUpperCase() !== revision.trim().toUpperCase()) {
        warnings.push(makeWarning("revision_conflict", "warn", [d.id], `rev. ${item.revision} × výkres rev. ${revision} (${number})`, [], group.key));
      }
      if (item && dr?.quantity && item.quantity && Math.abs(item.quantity - dr.quantity) > 1e-9) {
        warnings.push(makeWarning("quantity_conflict", "info", [d.id], `Na výkresu ${number} je ${dr.quantity} ks, v položce ${item.quantity}.`, [], group.key));
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
      const link = defaultLink(m.drawingNumber, initTarget, jobItemsByTarget[initTarget.key] ?? [], groupHasItems || docs.some((x) => x.type === "vykres"));
      const state: ModelReviewState = {
        format: m.format, drawingNumber: m.drawingNumber, revision: m.revision, title: m.title, link: link.mode === "add" && docs.some((x) => x.type === "vykres" && (drawingOf(x)?.drawingNumber || x.documentNumber) && docNumbersEqual(drawingOf(x)?.drawingNumber || x.documentNumber, m.drawingNumber)) ? { mode: "none" } : link,
        note: "", onDuplicate: dup && !dup.weak ? "skip" : null,
      };
      docStates[d.id] = { kind: "model", state };
      docReviews.push({ kind: "model", docId: d.id, groupKey: group.key, meta: m, duplicateOf: dup, initial: state });
      if (state.link.mode === "none" && !docs.some((x) => x.type === "vykres" && docNumbersEqual(drawingOf(x)?.drawingNumber || x.documentNumber, m.drawingNumber))) {
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
    state: { key: group.key, docIds: docs.map((d) => d.id), job: jobState, customerConfirmed: false, jobDraftTitle },
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
  for (const d of active) {
    if (d.aiType !== d.type) return false;
    const s = summaries.find((x) => x.docId === d.id);
    if (!s || s.status !== "ready") return false;
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
    return {
      kind: "drawing",
      state: {
        drawingNumber: s(st.drawingNumber, 80), revision: s(st.revision, 20), title: s(st.title, 300), material: s(st.material, 200),
        dimensions: s(st.dimensions, 200), generalTolerance: s(st.generalTolerance, 120), tightestTolerance: s(st.tightestTolerance, 120),
        quantity: qty, link, archive: st.archive !== false, note: s(st.note, 2000), onDuplicate: cleanDup(st.onDuplicate),
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

/** Skupina obsahuje zákazníky, kteří si nejsou jistě podobní (nevyřešený konflikt). */
function hasCustomerConflict(parties: (Pick<ExtractedParty, "name" | "ico"> | null)[], ourIco: string): boolean {
  const list = parties.filter((p): p is Pick<ExtractedParty, "name" | "ico"> => Boolean(p && (p.name.trim() || digits(p.ico))))
    .filter((p) => !digits(p.ico) || digits(p.ico) !== digits(ourIco));
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (digits(a.ico) && digits(b.ico)) {
        if (digits(a.ico) !== digits(b.ico)) return true;
        continue;
      }
      if (nameSimilarity(a.name, b.name) < SAME_NAME) return true;
    }
  }
  return false;
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
  const active = sort.docs.filter((d) => !d.excluded);
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
