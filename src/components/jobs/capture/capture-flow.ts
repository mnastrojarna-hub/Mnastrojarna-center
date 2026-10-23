import type { CaptureResult } from "@/lib/jobs/capture-types";
import {
  defaultCustomerChoice, defaultSupplierChoice, switchTarget,
  type CaptureFileRef, type ReviewModel, type ReviewState, type ReviewTarget,
} from "@/lib/jobs/capture-review";
import { BATCH_TYPES, pagesKey } from "@/lib/jobs/capture-batch";
import { applyGroupFills } from "@/lib/jobs/capture-batch-reconcile";
import type {
  BatchApplyState, BatchDocType, BatchGroupReview, BatchGroupState, BatchResult, BatchReviewModel, BatchSort,
  BatchSortModel, BatchWarning, DocApplyState, DocExtractStatus, DocExtractSummary,
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
  return { ...next, groups, docs };
}

/** Výběr cílů skupin pro nový požadavek kontroly (aby server nepřepsal volbu uživatele). */
export function chosenTargets(state: BatchApplyState | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const g of state?.groups ?? []) if (g.job.targetKey) out[g.key] = g.job.targetKey;
  return out;
}

/** Skupiny, kde uživatel potvrdil „Je to stejný zákazník". */
export function confirmedGroups(state: BatchApplyState | null): string[] {
  return (state?.groups ?? []).filter((g) => g.customerConfirmed).map((g) => g.key);
}

/** Upozornění je vyřešené stavem formuláře (blokující přestane blokovat). */
export function warningResolved(w: BatchWarning, state: BatchApplyState): boolean {
  const group = w.groupKey ? state.groups.find((g) => g.key === w.groupKey) : null;
  switch (w.code) {
    case "customer_conflict":
      return Boolean(group?.customerConfirmed);
    case "target_required":
      return Boolean(group?.job.targetKey);
    case "already_saved":
    case "duplicate_doc":
      return w.docIds.length > 0 && w.docIds.every((id) => {
        const d = state.docs[id];
        const sortDoc = state.sort.docs.find((x) => x.id === id);
        if (!sortDoc || sortDoc.excluded) return true;
        if (!d || d.kind === "file") return false;
        return d.kind === "business" ? d.state.onDuplicate !== null || d.state.fileOnly : d.state.onDuplicate !== null;
      });
    default:
      return false;
  }
}

/** Blokující upozornění, která ještě nejsou vyřešená. */
export function openBlocks(review: BatchReviewModel, state: BatchApplyState): BatchWarning[] {
  return review.warnings.filter((w) => w.severity === "block" && !warningResolved(w, state));
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
