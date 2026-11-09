import type { CaptureResult } from "@/lib/jobs/capture-types";
import {
  defaultCustomerChoice, defaultSupplierChoice, switchTarget,
  type CaptureFileRef, type ReviewModel, type ReviewState, type ReviewTarget,
} from "@/lib/jobs/capture-review";
import { BATCH_TYPES, distinctJobCount, pagesKey } from "@/lib/jobs/capture-batch";
import { cleanNumber } from "@/lib/jobs/mapping";
import { docNumbersEqual } from "@/lib/jobs/matching";
import { applyGroupFills } from "@/lib/jobs/capture-batch-reconcile";
import type {
  BatchApplyState, BatchDocType, BatchGroupReview, BatchGroupState, BatchResult, BatchReviewModel, BatchSort,
  BatchSortModel, BatchWarning, DocApplyState, DocExtractStatus, DocExtractSummary, DuplicateRef, ItemLinkChoice,
} from "@/lib/jobs/capture-batch-types";
import { needsExtract } from "@/components/jobs/capture/batch-sort";

/**
 * Stav dialogu „Vyfotit doklad" (čistý reducer, testovatelný bez Reactu):
 * jeden doklad: 1 Vyfotit (stránky se hned nahrávají) → 2 AI čte → 3 Kontrola → 4 Hotovo;
 * dávka: Vyfotit → AI čte → Roztřídění → Kontrola (skupiny zakázek) → Hotovo.
 */

export type CaptureStep = "pick" | "reading" | "sort" | "review" | "saving" | "done";

export interface PageDraft {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  /** Místní náhled (object URL) — uvolní se při odebrání. */
  previewUrl: string | null;
  status: "uploading" | "ready" | "error";
  error: string | null;
  ref: CaptureFileRef | null;
  /** SHA-256 obsahu (stejný soubor se do dávky nepřidá dvakrát). */
  sha256?: string | null;
}

export interface ExtractEntry {
  pagesKey: string;
  status: "queued" | DocExtractStatus;
  summary: DocExtractSummary | null;
  /** Druh, pro který se čte (změna strany = nové čtení se stejnými stránkami). */
  type?: BatchDocType;
}

export interface CaptureFlowState {
  step: CaptureStep;
  pages: PageDraft[];
  model: ReviewModel | null;
  review: ReviewState | null;
  /** Zakázky vybrané ručně přes „Jiná zakázka…" (návrh ze serveru). */
  extraTargets: ReviewTarget[];
  result: CaptureResult | null;
  error: string | null;
  // ── dávka ──
  batch: BatchSortModel | null;
  /** Pracovní roztřídění. */
  sort: BatchSort;
  extracts: Record<string, ExtractEntry>;
  /** „Dočítám 2…" — po dočtení se pokračuje samo. */
  waitingForExtracts: boolean;
  batchReview: BatchReviewModel | null;
  batchState: BatchApplyState | null;
  batchResult: BatchResult | null;
}

export type CaptureAction =
  | { type: "add"; pages: PageDraft[] }
  | { type: "uploaded"; id: string; ref: CaptureFileRef }
  | { type: "uploadFailed"; id: string; error: string }
  | { type: "remove"; id: string }
  | { type: "move"; id: string; delta: -1 | 1 }
  | { type: "read" }
  | { type: "analyzed"; model: ReviewModel; applied?: CaptureResult }
  | { type: "failed"; error: string; step: CaptureStep }
  | { type: "edit"; review: ReviewState }
  | { type: "addTarget"; target: ReviewTarget; review: ReviewState }
  | { type: "save" }
  | { type: "saved"; result: CaptureResult }
  | { type: "dismissError" }
  | { type: "reset" }
  // ── dávka ──
  | { type: "batchAnalyzed"; batch: BatchSortModel }
  | { type: "batchResumed"; batch: BatchSortModel; extracts: DocExtractSummary[] }
  | { type: "sortEdit"; sort: BatchSort }
  | { type: "extractQueued" | "extractStart"; docId: string; pagesKey: string; docType?: BatchDocType }
  | { type: "extractDone"; docId: string; pagesKey: string; summary: DocExtractSummary }
  | { type: "waitExtracts"; on: boolean }
  | { type: "batchReviewReady"; review: BatchReviewModel }
  | { type: "batchEdit"; state: BatchApplyState }
  | { type: "batchSaved"; result: BatchResult }
  | { type: "backToSort" }
  /** Po částečném uložení zpět do kontroly (uložené doklady zamčené). */
  | { type: "editAfterPartial" };

export const EMPTY_SORT: BatchSort = { docs: [], excludedPageIds: [] };

export const INITIAL_FLOW: CaptureFlowState = {
  step: "pick",
  pages: [],
  model: null,
  review: null,
  extraTargets: [],
  result: null,
  error: null,
  batch: null,
  sort: EMPTY_SORT,
  extracts: {},
  waitingForExtracts: false,
  batchReview: null,
  batchState: null,
  batchResult: null,
};

/** Hotová vytěžení z odpovědi serveru (jen ta, jejichž stránky sedí na roztřídění). */
export function extractsFromSummaries(sort: BatchSort, summaries: DocExtractSummary[]): Record<string, ExtractEntry> {
  const out: Record<string, ExtractEntry> = {};
  for (const s of summaries) {
    const doc = sort.docs.find((d) => d.id === s.docId);
    if (!doc || pagesKey(doc.pageIds) !== s.pagesKey) continue;
    out[s.docId] = { pagesKey: s.pagesKey, status: s.status, summary: s, type: s.type };
  }
  return out;
}

function batchStart(state: CaptureFlowState, batch: BatchSortModel, summaries: DocExtractSummary[], step: CaptureStep): CaptureFlowState {
  return {
    ...state,
    step,
    batch,
    sort: batch.sort,
    extracts: extractsFromSummaries(batch.sort, summaries),
    waitingForExtracts: step === "reading",
    batchReview: null,
    batchState: null,
    batchResult: null,
    model: null,
    review: null,
    error: null,
  };
}

export function captureReducer(state: CaptureFlowState, action: CaptureAction): CaptureFlowState {
  switch (action.type) {
    case "add":
      return { ...state, pages: [...state.pages, ...action.pages], error: null };
    case "uploaded":
      return {
        ...state,
        pages: state.pages.map((p) => (p.id === action.id ? { ...p, status: "ready", error: null, ref: action.ref } : p)),
      };
    case "uploadFailed":
      return {
        ...state,
        pages: state.pages.map((p) => (p.id === action.id ? { ...p, status: "error", error: action.error } : p)),
      };
    case "remove":
      return { ...state, pages: state.pages.filter((p) => p.id !== action.id) };
    case "move": {
      const i = state.pages.findIndex((p) => p.id === action.id);
      const j = i + action.delta;
      if (i < 0 || j < 0 || j >= state.pages.length) return state;
      const pages = [...state.pages];
      [pages[i], pages[j]] = [pages[j], pages[i]];
      return { ...state, pages };
    }
    case "read":
      return { ...state, step: "reading", error: null };
    case "analyzed":
      return {
        ...state,
        step: action.applied ? "done" : "review",
        model: action.model,
        review: action.model.initial,
        extraTargets: [],
        result: action.applied ?? null,
        error: null,
      };
    case "failed":
      return { ...state, step: action.step, error: action.error, waitingForExtracts: false };
    case "edit":
      // úprava formuláře = uživatel na hlášku reaguje → schovat ji
      return { ...state, review: action.review, error: null };
    case "addTarget":
      return {
        ...state,
        extraTargets: [...state.extraTargets.filter((t) => t.key !== action.target.key), action.target],
        review: action.review,
      };
    case "save":
      return { ...state, step: "saving", error: null };
    case "saved":
      return { ...state, step: "done", result: action.result, error: null };
    case "dismissError":
      return { ...state, error: null };
    case "reset":
      return INITIAL_FLOW;

    // ── dávka ──
    case "batchAnalyzed":
      return batchStart(state, action.batch, action.batch.extracts, action.batch.skipSort ? "reading" : "sort");
    case "batchResumed":
      return batchStart(state, action.batch, action.extracts, "sort");
    case "sortEdit":
      return { ...state, sort: action.sort, waitingForExtracts: false, error: null };
    case "extractQueued":
      return {
        ...state,
        extracts: { ...state.extracts, [action.docId]: { pagesKey: action.pagesKey, status: "queued", summary: null, type: action.docType } },
      };
    case "extractStart": {
      const cur = state.extracts[action.docId];
      if (!cur || cur.pagesKey !== action.pagesKey) return state;
      return { ...state, extracts: { ...state.extracts, [action.docId]: { ...cur, status: "reading" } } };
    }
    case "extractDone": {
      const cur = state.extracts[action.docId];
      // výsledek pro stránky / druh, které už neplatí → zahodit
      if (!cur || cur.pagesKey !== action.pagesKey || (cur.type && cur.type !== action.summary.type)) return state;
      return {
        ...state,
        extracts: { ...state.extracts, [action.docId]: { ...cur, status: action.summary.status, summary: action.summary } },
      };
    }
    case "waitExtracts":
      return { ...state, waitingForExtracts: action.on };
    case "batchReviewReady":
      return {
        ...state,
        step: "review",
        batchReview: action.review,
        batchState: mergeBatchState(state.batchReview, state.batchState, action.review),
        sort: action.review.initial.sort,
        waitingForExtracts: false,
        error: null,
      };
    case "batchEdit":
      return { ...state, batchState: action.state, error: null };
    case "batchSaved":
      return { ...state, step: "done", batchResult: action.result, error: null };
    case "backToSort":
      return { ...state, step: "sort", waitingForExtracts: false, error: null };
    case "editAfterPartial":
      return state.batchReview && state.batchState ? { ...state, step: "review", error: null } : state;
    default:
      return state;
  }
}

/** Nahrané stránky v pořadí (k přečtení). */
export function readyRefs(pages: PageDraft[]): CaptureFileRef[] {
  return pages.filter((p) => p.status === "ready" && p.ref).map((p) => p.ref!);
}

/** Lze číst: aspoň jedna nahraná stránka a nic se už nenahrává. */
export function canRead(pages: PageDraft[]): boolean {
  return pages.some((p) => p.status === "ready") && !pages.some((p) => p.status === "uploading");
}

/** Všechny cíle formuláře: shody z AI, ručně vybrané, „nová zakázka" vždy poslední. */
export function allTargets(state: Pick<CaptureFlowState, "model" | "extraTargets">): ReviewTarget[] {
  const base = state.model?.targets ?? [];
  const existing = base.filter((t) => t.mode === "existing");
  const extra = state.extraTargets.filter((t) => !existing.some((e) => e.key === t.key));
  return [...existing, ...extra, ...base.filter((t) => t.mode === "new")];
}

export function currentTarget(state: Pick<CaptureFlowState, "model" | "extraTargets" | "review">): ReviewTarget | null {
  const targets = allTargets(state);
  return targets.find((t) => t.key === state.review?.targetKey) ?? targets[0] ?? null;
}

/** Co ještě chybí, než jde formulář uložit (null = lze uložit). */
export function reviewProblem(review: ReviewState, target: ReviewTarget, supplierSide: boolean): string | null {
  const customerLocked = target.mode === "existing" && Boolean(target.customerId);
  if (!customerLocked && review.customer.mode === "existing" && !review.customer.id) {
    return "Vyber zákazníka ze seznamu (nebo zvol „Nový zákazník“ či „Bez zákazníka“).";
  }
  if (supplierSide && review.supplier.mode === "existing" && !review.supplier.id) {
    return "Vyber dodavatele ze seznamu (nebo zvol „Nový dodavatel“ či „Bez dodavatele“).";
  }
  if (!customerLocked && review.customer.mode === "new" && !review.customer.party.name.trim()) return "Doplň název nového zákazníka.";
  if (supplierSide && review.supplier.mode === "new" && !review.supplier.party.name.trim()) return "Doplň název nového dodavatele.";
  if (target.mode === "new" && !(review.fields.title ?? "").trim() && review.customer.mode === "none"
    && !review.items.some((i) => i.drawingNumber.trim() || i.name.trim() || i.description.trim())) {
    return "Doplň aspoň název zakázky, zákazníka nebo položku.";
  }
  const ask = review.items.find((i) => i.pair && i.pair.answer === null);
  if (ask && target.mode === "existing") {
    return `Rozhodni u řádku „${ask.name || ask.description || ask.drawingNumber}“: je to položka ${ask.pair!.itemLabel}, nebo nová položka?`;
  }
  return null;
}

// ── Dávka: vytěžení ─────────────────────────────────────────
/** Doklady, které je třeba (znovu) přečíst a ještě nejsou dočtené ani ve frontě. */
export function missingExtracts(state: Pick<CaptureFlowState, "batch" | "sort" | "extracts">): { docId: string; pagesKey: string; type: BatchDocType; pageIds: string[] }[] {
  if (!state.batch) return [];
  const out: { docId: string; pagesKey: string; type: BatchDocType; pageIds: string[] }[] = [];
  for (const d of state.sort.docs) {
    if (d.excluded || !needsExtract(d.type, state.batch.aiUsed)) continue;
    const key = pagesKey(d.pageIds);
    const e = state.extracts[d.id];
    const sameSide = !e?.type || (BATCH_TYPES[e.type].form === BATCH_TYPES[d.type].form && BATCH_TYPES[e.type].side === BATCH_TYPES[d.type].side);
    if (e && e.pagesKey === key && sameSide) continue;
    out.push({ docId: d.id, pagesKey: key, type: d.type, pageIds: d.pageIds });
  }
  return out;
}

/** Kolik dokladů se ještě čte (ve frontě / na serveru). */
export function extractingCount(state: Pick<CaptureFlowState, "batch" | "sort" | "extracts">): number {
  if (!state.batch) return 0;
  let n = missingExtracts(state).length;
  for (const d of state.sort.docs) {
    if (d.excluded || !needsExtract(d.type, state.batch.aiUsed)) continue;
    const e = state.extracts[d.id];
    if (e && e.pagesKey === pagesKey(d.pageIds) && (e.status === "queued" || e.status === "reading")) n += 1;
  }
  return n;
}

/** Stav vytěžení karty dokladu (do `data-status`). */
export function docExtractStatus(state: Pick<CaptureFlowState, "batch" | "extracts">, doc: { id: string; type: BatchDocType; pageIds: string[] }): "queued" | DocExtractStatus | "none" {
  if (!state.batch || !needsExtract(doc.type, state.batch.aiUsed)) return "none";
  const e = state.extracts[doc.id];
  if (!e || e.pagesKey !== pagesKey(doc.pageIds)) return "queued";
  return e.status;
}

/** Hotová shrnutí vytěžení aktuálních dokladů (pro plnou automatiku). */
export function currentSummaries(state: Pick<CaptureFlowState, "sort" | "extracts">): DocExtractSummary[] {
  const out: DocExtractSummary[] = [];
  for (const d of state.sort.docs) {
    const e = state.extracts[d.id];
    if (!d.excluded && e?.summary && e.pagesKey === pagesKey(d.pageIds)) out.push(e.summary);
  }
  return out;
}

// ── Dávka: kontrola ─────────────────────────────────────────
function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

function fallbackParties(m: BatchGroupReview["model"]) {
  const none = { mode: "new" as const, customerId: null, customerName: null, supplierId: null, supplierName: null };
  return {
    customer: defaultCustomerChoice(none, m.customerMatch, m.docCustomer),
    supplier: defaultSupplierChoice(none, m.supplierMatch, m.docSupplier),
  };
}

/**
 * Nová odpověď kontroly se zachováním ručních úprav (§6.3): skupina se stejnými
 * doklady a stejným cílem zůstane, s jiným cílem se přepne jako dnes (switchTarget);
 * doklad se stejnými stránkami a druhem si nechá formulář. Prázdná pole doplní
 * nová vzájemná doplnění (applyGroupFills).
 */
export function mergeBatchState(
  prevReview: BatchReviewModel | null,
  prev: BatchApplyState | null,
  review: BatchReviewModel,
): BatchApplyState {
  const next = review.initial;
  if (!prevReview || !prev) return next;
  const groups: BatchGroupState[] = next.groups.map((g) => {
    const gr = review.groups.find((x) => x.key === g.key);
    const old = prev.groups.find((o) => sameIds(o.docIds, g.docIds));
    if (!gr || !old) return g;
    const keepMeta = {
      customerConfirmed: old.customerConfirmed || g.customerConfirmed,
      jobDraftTitle: old.jobDraftTitle || g.jobDraftTitle,
    };
    if (!g.job.targetKey || old.job.targetKey === g.job.targetKey) {
      return { ...g, ...keepMeta, job: applyGroupFills({ ...old.job, targetKey: old.job.targetKey || g.job.targetKey }, gr) };
    }
    const oldGr = prevReview.groups.find((x) => sameIds(x.docIds, old.docIds));
    const from = oldGr?.model.targets.find((t) => t.key === old.job.targetKey);
    const to = gr.model.targets.find((t) => t.key === g.job.targetKey);
    if (!from || !to) return g;
    const fb = fallbackParties(gr.model);
    return { ...g, ...keepMeta, job: applyGroupFills(switchTarget(old.job, from, to, fb.customer, fb.supplier), gr) };
  });
  const docs: Record<string, DocApplyState> = {};
  for (const [docId, st] of Object.entries(next.docs)) {
    const was = prev.docs[docId];
    const a = prev.sort.docs.find((d) => d.id === docId);
    const b = next.sort.docs.find((d) => d.id === docId);
    const same = was && a && b && was.kind === st.kind && a.type === b.type && pagesKey(a.pageIds) === pagesKey(b.pageIds);
    docs[docId] = same ? was : st;
  }
  let merged: BatchApplyState = { ...next, groups, docs, ...(prev.ack?.length ? { ack: prev.ack } : {}) };
  // skupina s jiným cílem než dřív: vazby výkresů / modelů ze starého cíle neplatí (položka jiné zakázky,
  // „ai-0" je u jiného cíle jiný řádek) → znovu podle čísla výkresu
  for (const g of groups) {
    const old = prev.groups.find((o) => sameIds(o.docIds, g.docIds));
    if (old && old.job.targetKey !== g.job.targetKey) merged = relinkGroupDocs(review, merged, g.key);
  }
  return merged;
}

// ── Vazby výkresů / modelů na položky ──────────────────────
function sameLink(a: ItemLinkChoice, b: ItemLinkChoice): boolean {
  if (a.mode !== b.mode) return false;
  if (a.mode === "item" && b.mode === "item") return a.itemId === b.itemId;
  if (a.mode === "docItem" && b.mode === "docItem") return a.itemKey === b.itemKey;
  return true;
}

/** Vazba platí pro aktuální cíl skupiny (řádek v Položkách / položka cílové zakázky). */
export function linkValid(review: BatchReviewModel, state: BatchApplyState, groupKey: string, link: ItemLinkChoice): boolean {
  const g = state.groups.find((x) => x.key === groupKey);
  if (!g) return false;
  if (link.mode === "add" || link.mode === "none") return true;
  if (link.mode === "docItem") return g.job.items.some((i) => i.key === link.itemKey);
  const rg = review.groups.find((x) => x.key === groupKey);
  return Boolean(rg?.itemOptions[g.job.targetKey]?.some((o) => sameLink(o.link, link)));
}

function dupOf(review: BatchReviewModel, docId: string): DuplicateRef | null {
  const r = review.docs.find((d) => d.docId === docId);
  return r && (r.kind === "drawing" || r.kind === "model") ? r.duplicateOf : null;
}

/** Výkres / model je už u CÍLOVÉ zakázky skupiny (jen tehdy se nabízí „neukládat znovu / nová verze"). */
export function duplicateInTarget(review: BatchReviewModel, state: BatchApplyState, docId: string): DuplicateRef | null {
  const dup = dupOf(review, docId);
  if (!dup) return null;
  const g = state.groups.find((x) => x.docIds.includes(docId));
  return g && g.job.targetKey === dup.jobId ? dup : null;
}

/**
 * Po změně cíle skupiny: vazby výkresů / modelů znovu podle čísla výkresu (řádek Položek, položka cílové
 * zakázky), jinak výchozí vazba serveru pro tento cíl, jinak nová položka / bez vazby. „Neukládat znovu"
 * platí jen, když je výkres u cílové zakázky.
 */
export function relinkGroupDocs(review: BatchReviewModel, state: BatchApplyState, groupKey: string): BatchApplyState {
  const g = state.groups.find((x) => x.key === groupKey);
  if (!g) return state;
  const rg = review.groups.find((x) => x.key === groupKey);
  const options = rg?.itemOptions[g.job.targetKey] ?? [];
  const initGroup = review.initial.groups.find((x) => x.key === groupKey);
  let docs = state.docs;
  for (const docId of g.docIds) {
    const d = docs[docId];
    if (!d || (d.kind !== "drawing" && d.kind !== "model")) continue;
    const num = d.state.drawingNumber.trim();
    const row = num ? g.job.items.find((i) => i.drawingNumber && docNumbersEqual(i.drawingNumber, num)) : undefined;
    const opt = num ? options.find((o) => o.link.mode === "item" && o.drawingNumber && docNumbersEqual(o.drawingNumber, num)) : undefined;
    const init = review.initial.docs[docId];
    const initLink = init && (init.kind === "drawing" || init.kind === "model") && initGroup?.job.targetKey === g.job.targetKey ? init.state.link : null;
    let link: ItemLinkChoice;
    if (row) link = { mode: "docItem", itemKey: row.key };
    else if (opt) link = opt.link;
    else if (initLink && linkValid(review, state, groupKey, initLink)) link = initLink;
    else if (linkValid(review, state, groupKey, d.state.link) && d.state.link.mode !== "none") link = d.state.link;
    else link = num ? { mode: "add" } : { mode: "none" };
    const dup = dupOf(review, docId);
    const inTarget = Boolean(dup && dup.jobId === g.job.targetKey && !dup.weak);
    const onDuplicate = inTarget ? d.state.onDuplicate ?? "skip" : null;
    if (sameLink(link, d.state.link) && onDuplicate === d.state.onDuplicate) continue;
    docs = { ...docs, [docId]: { ...d, state: { ...d.state, link, onDuplicate } } as DocApplyState };
  }
  return docs === state.docs ? state : { ...state, docs };
}

/** Výkres / model s vazbou, která pro cíl skupiny neplatí (položka jiné zakázky). */
export function invalidLinkDoc(review: BatchReviewModel, state: BatchApplyState, locked: Set<string> = new Set()): { docId: string; groupKey: string; label: string } | null {
  for (const g of state.groups) {
    for (const docId of g.docIds) {
      if (locked.has(docId)) continue;
      const d = state.docs[docId];
      if (!d || (d.kind !== "drawing" && d.kind !== "model")) continue;
      if (!linkValid(review, state, g.key, d.state.link)) {
        return { docId, groupKey: g.key, label: `${d.kind === "model" ? "3D model" : "Výkres"}${d.state.drawingNumber ? ` ${d.state.drawingNumber}` : ""}` };
      }
    }
  }
  return null;
}

/** Přidat rozhodnutí do `ack` (bez duplicit). */
export function withAck(state: BatchApplyState, ...ids: string[]): BatchApplyState {
  const ack = [...new Set([...(state.ack ?? []), ...ids])];
  return { ...state, ack };
}

/** Výběr cílů skupin pro nový požadavek kontroly (aby server nepřepsal volbu uživatele). */
export function chosenTargets(state: BatchApplyState | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const g of state?.groups ?? []) if (g.job.targetKey) out[g.key] = g.job.targetKey;
  return out;
}

// ── Kolik zakázek se uloží, sloučení do jedné ──────────────
/** Skupiny, které se uloží jako zakázky (aspoň 1 aktivní doklad v kontrole). */
export function jobGroupsToSave(review: BatchReviewModel, state: BatchApplyState): BatchGroupState[] {
  const active = new Set(state.sort.docs.filter((d) => !d.excluded).map((d) => d.id));
  return state.groups.filter((g) => g.docIds.some((id) => active.has(id) && review.docs.some((r) => r.docId === id)));
}

/** „1 zakázky", „2 zakázek" (do …). */
export function jobsGenitive(n: number): string {
  return `${n} ${n === 1 ? "zakázky" : "zakázek"}`;
}

export interface SaveCountInfo {
  count: number;
  /** Proč víc zakázek (důvody samostatných skupin). */
  reasons: string[];
}

/**
 * Kolik SKUTEČNÝCH zakázek se uloží a proč (důvody dalších zakázek, bez duplicit). Skupiny se stejnou
 * cílovou zakázkou = 1 zakázka; „nová" / nevybraný cíl = každá skupina zvlášť.
 */
export function saveCountInfo(review: BatchReviewModel, state: BatchApplyState): SaveCountInfo {
  const groups = jobGroupsToSave(review, state);
  const reasons: string[] = [];
  const seen = new Set<string>();
  let n = 0;
  for (const g of groups) {
    const k = g.job.targetKey;
    if (k && k !== "new") {
      if (seen.has(k)) continue;
      seen.add(k);
    }
    n++;
    if (n === 1) continue;
    const rg = review.groups.find((x) => x.key === g.key);
    const why = rg?.autoReason || (rg?.label ? `samostatná zakázka ${rg.label}` : "");
    if (why && !reasons.includes(why)) reasons.push(`Zakázka ${n}: ${why}`);
  }
  return { count: distinctJobCount(groups), reasons };
}

export interface MergeAllPlan {
  /** Klíč skupiny, do které se vše přesune (první). */
  target: string;
  /** docId → klíč první skupiny. */
  assign: Record<string, string>;
  /** Doklady mají různé IČO zákazníka (potvrzení před sloučením). */
  icos: string[];
}

/** Sloučit vše do první zakázky (jen neuložené doklady); null = není co / nejde (uloženo). */
export function mergeAllPlan(review: BatchReviewModel, state: BatchApplyState, locked: Set<string> = new Set()): MergeAllPlan | null {
  const groups = jobGroupsToSave(review, state);
  if (groups.length < 2) return null;
  if (groups.some((g) => g.docIds.some((id) => locked.has(id)))) return null;
  const target = groups[0].key;
  const assign: Record<string, string> = {};
  for (const g of groups.slice(1)) for (const id of g.docIds) assign[id] = target;
  const icos = [...new Set(groups.map((g) => (review.groups.find((x) => x.key === g.key)?.model.docCustomer.ico ?? "").replace(/\D+/g, "")).filter(Boolean))];
  return { target, assign, icos };
}

/** Skupiny, kde uživatel potvrdil „Je to stejný zákazník". */
export function confirmedGroups(state: BatchApplyState | null): string[] {
  return (state?.groups ?? []).filter((g) => g.customerConfirmed).map((g) => g.key);
}

/** Upozornění je vyřešené stavem formuláře (blokující přestane blokovat). */
export function warningResolved(w: BatchWarning, state: BatchApplyState, review?: BatchReviewModel | null): boolean {
  const group = w.groupKey ? state.groups.find((g) => g.key === w.groupKey) : null;
  // rozhodnutí člověka tlačítkem v upozornění („Platí POM", „Ponechat oba", „Jsou to listy téhož výkresu")
  if (state.ack?.includes(w.id)) return true;
  const drawingCard = (id: string) => {
    const d = state.docs[id];
    return d && (d.kind === "drawing" || d.kind === "model") ? d : null;
  };
  const rowOf = (id: string) => {
    const d = drawingCard(id);
    const g = state.groups.find((x) => x.docIds.includes(id));
    return d && g && d.state.link.mode === "docItem" ? g.job.items.find((i) => i.key === (d.state.link as { itemKey: string }).itemKey) ?? null : null;
  };
  switch (w.code) {
    case "material_conflict": {
      // „Platí materiál z výkresu" = položka má materiál výkresu
      const ids = w.docIds.filter((id) => drawingCard(id));
      return ids.length > 0 && ids.every((id) => {
        const d = drawingCard(id);
        const row = rowOf(id);
        return Boolean(d && d.kind === "drawing" && row && row.material.trim() && row.material.trim() === d.state.material.trim());
      });
    }
    case "quantity_conflict": {
      // počet v Položkách je rozhodnutí člověka — upravený řádek = informace „Platí poptávka: 8 ks" už neplatí
      if (!review) return false;
      return w.docIds.some((id) => {
        const row = rowOf(id);
        const g = state.groups.find((x) => x.docIds.includes(id));
        const init = review.initial.groups.find((x) => x.key === g?.key)?.job.items.find((i) => i.key === row?.key);
        return Boolean(row && init && (cleanNumber(row.quantity) ?? 0) !== (cleanNumber(init.quantity) ?? 0));
      });
    }
    case "drawing_item_shared": {
      // výkresy už nemíří na tutéž položku
      const links = w.docIds.map((id) => drawingCard(id)?.state.link).filter(Boolean) as ItemLinkChoice[];
      return links.length < 2 || links.some((l) => !sameLink(l, links[0]));
    }
    case "also_in_job":
      // výkres teď jde do zakázky, kde už je → rozhoduje „Neukládat znovu / Nová verze" na kartě
      return Boolean(review && w.docIds.every((id) => duplicateInTarget(review, state, id)));
    default:
      break;
  }
  switch (w.code) {
    case "customer_conflict":
    case "customer_written_differently":
      return Boolean(group?.customerConfirmed);
    case "target_required":
      return Boolean(group?.job.targetKey);
    case "already_saved":
    case "duplicate_doc":
      // výkresy / modely: duplicitní jen u CÍLOVÉ zakázky (jinde se uloží i sem); v dávce dvakrát → vyřešeno,
      // když se čísla na kartách liší (OCR přečetla podobné číslo, člověk ho opravil)
      if (w.code === "already_saved" && review && w.docIds.every((id) => drawingCard(id)) && w.docIds.every((id) => !duplicateInTarget(review, state, id))) return true;
      if (w.code === "duplicate_doc" && w.docIds.length > 1 && w.docIds.every((id) => drawingCard(id))) {
        const nums = w.docIds.map((id) => drawingCard(id)!.state.drawingNumber.trim());
        if (nums.some((n) => !docNumbersEqual(n, nums[0]))) return true;
      }
      return w.docIds.length > 0 && w.docIds.every((id) => {
        const d = state.docs[id];
        const sortDoc = state.sort.docs.find((x) => x.id === id);
        if (!sortDoc || sortDoc.excluded) return true;
        if (!d || d.kind === "file") return false;
        return d.kind === "business" ? d.state.onDuplicate !== null || d.state.fileOnly : d.state.onDuplicate !== null;
      });
    case "drawing_quantity_missing":
      // počet doplněný na kartě výkresu NEBO v řádku Položek, na který výkres míří
      return w.docIds.length > 0 && w.docIds.every((id) => {
        const d = state.docs[id];
        if (!d || d.kind !== "drawing") return false;
        if ((cleanNumber(d.state.quantity) ?? 0) > 0) return true;
        const link = d.state.link;
        const row = link.mode === "docItem" && group ? group.job.items.find((i) => i.key === link.itemKey) : null;
        return Boolean(row && (cleanNumber(row.quantity) ?? 0) > 0);
      });
    case "unlinked_drawing":
    case "unlinked_model":
      return w.docIds.length > 0 && w.docIds.every((id) => {
        const d = state.docs[id];
        return Boolean(d && (d.kind === "drawing" || d.kind === "model") && d.state.link.mode !== "none");
      });
    default:
      return false;
  }
}

/** Blokující upozornění, která ještě nejsou vyřešená. */
export function openBlocks(review: BatchReviewModel, state: BatchApplyState): BatchWarning[] {
  return review.warnings.filter((w) => w.severity === "block" && !warningResolved(w, state, review));
}

/** Co ještě chybí, než jde dávka uložit, a kde (skupina / doklad) — pro skok „Ukázat". */
export interface BatchProblem { message: string; groupKey?: string; docId?: string }

export function batchProblemAt(review: BatchReviewModel, state: BatchApplyState, locked: Set<string> = new Set()): BatchProblem | null {
  for (const g of state.groups) {
    if (g.docIds.every((id) => locked.has(id))) continue;
    const gr = review.groups.find((x) => x.key === g.key);
    const label = gr?.label || "skupinu";
    if (!g.job.targetKey) return { message: `Vyber zakázku pro ${label}.`, groupKey: g.key };
    const target = gr?.model.targets.find((t) => t.key === g.job.targetKey);
    if (target) {
      const p = reviewProblem(g.job, target, false);
      if (p) return { message: `${label}: ${p}`, groupKey: g.key };
    }
  }
  const block = openBlocks(review, state)[0];
  if (block) return { message: block.message, ...(block.groupKey ? { groupKey: block.groupKey } : {}), ...(block.docIds[0] ? { docId: block.docIds[0] } : {}) };
  const bad = invalidLinkDoc(review, state, locked);
  if (bad) return { message: `${bad.label}: vybraná položka patří k jiné zakázce — vyber u výkresu „Patří k položce“.`, groupKey: bad.groupKey, docId: bad.docId };
  for (const [docId, d] of Object.entries(state.docs)) {
    if (locked.has(docId) || d.kind !== "business" || d.state.fileOnly) continue;
    if (BATCH_TYPES[d.state.type].side !== "supplier") continue;
    if (d.state.supplier.mode === "existing" && !d.state.supplier.id) return { message: "Vyber dodavatele ze seznamu (nebo zvol „Nový dodavatel“ či „Bez dodavatele“).", docId };
    if (d.state.supplier.mode === "new" && !d.state.supplier.party.name.trim()) return { message: "Doplň název nového dodavatele.", docId };
  }
  return null;
}

/** Co ještě chybí, než jde dávka uložit (null = lze uložit). */
export function batchSaveProblem(review: BatchReviewModel, state: BatchApplyState, locked: Set<string> = new Set()): string | null {
  return batchProblemAt(review, state, locked)?.message ?? null;
}

/** Uložené doklady po částečném uložení (v kontrole zamčené). */
export function savedDocIds(result: BatchResult | null): Set<string> {
  return new Set((result?.docs ?? []).filter((d) => d.ok).map((d) => d.docId));
}
