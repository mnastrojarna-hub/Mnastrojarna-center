import type { CaptureResult } from "@/lib/jobs/capture-types";
import type { CaptureFileRef, ReviewModel, ReviewState, ReviewTarget } from "@/lib/jobs/capture-review";

/**
 * Stav dialogu „Vyfotit doklad" (čistý reducer, testovatelný bez Reactu):
 * 1 Vyfotit (stránky se hned nahrávají) → 2 AI čte → 3 Kontrola → 4 Hotovo.
 */

export type CaptureStep = "pick" | "reading" | "review" | "saving" | "done";

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
  | { type: "reset" };

export const INITIAL_FLOW: CaptureFlowState = {
  step: "pick",
  pages: [],
  model: null,
  review: null,
  extraTargets: [],
  result: null,
  error: null,
};

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
      return { ...state, step: action.step, error: action.error };
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
