"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  AlertTriangle, ArrowLeft, ArrowRight, Camera, Check, CheckCircle2, ClipboardCheck, Eye, EyeOff, LayoutGrid, Loader2,
  Sparkles, X,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAccess } from "@/components/access-provider";
import { CapturePick, pickTileKind } from "@/components/jobs/capture/capture-pick";
import { CaptureReading, type ReadingBatchInfo } from "@/components/jobs/capture/capture-reading";
import { CaptureReviewForm } from "@/components/jobs/capture/capture-review-form";
import { CapturePages, type ViewerPage } from "@/components/jobs/capture/capture-pages";
import { CaptureDone } from "@/components/jobs/capture/capture-done";
import { CaptureSort, type LocalUrls } from "@/components/jobs/capture/capture-sort";
import { CaptureBatchReview } from "@/components/jobs/capture/capture-batch-review";
import { CaptureBatchDone } from "@/components/jobs/capture/capture-batch-done";
import {
  INITIAL_FLOW, allTargets, batchProblemAt, batchSaveProblem, canRead, captureReducer, chosenTargets, confirmedGroups, currentSummaries,
  currentTarget, docExtractStatus, extractingCount, jobGroupsToSave, jobsGenitive, mergeAllPlan, missingExtracts, readyRefs,
  reviewProblem, savedDocIds,
  type CaptureFlowState, type CaptureStep, type PageDraft,
} from "@/components/jobs/capture/capture-flow";
import {
  analyzeCaptureRequest, applyBatchRequest, applyCaptureRequest, batchReviewRequest, batchSessionRequest,
  captureTargetRequest, discardCaptureQuietly, extractBatchDocRequest, fileSha256, uploadCapturePage,
} from "@/components/jobs/capture/capture-client";
import { excludeDoc, restorePage, setDocType } from "@/components/jobs/capture/batch-sort";
import {
  clearResume, isCaptureHistoryTop, popCaptureHistory, pushCaptureHistory, readResume, writeResume,
  type CaptureResumeRecord,
} from "@/components/jobs/capture/capture-resume";
import { releasePdfThumbs } from "@/components/jobs/capture/pdf-thumbs";
import {
  CAPTURE_BATCH_MAX_FILES, defaultCustomerChoice, defaultSupplierChoice, isBatchUploadable, switchTarget,
} from "@/lib/jobs/capture-review";
import { batchSummaryLine, distinctJobCount, pagesKey, validateBatchSort } from "@/lib/jobs/capture-batch";
import { canAutoApplyBatch } from "@/lib/jobs/capture-batch-reconcile";
import type {
  BatchApplyState, BatchDocType, BatchResult, BatchSort, BatchSortModel, BatchWarning, BatchWarningAction,
  DocExtractSummary,
} from "@/lib/jobs/capture-batch-types";
import { isSupplierSideDoc } from "@/lib/jobs/matching";
import type { CaptureDocKind, CaptureResult } from "@/lib/jobs/capture-types";
import { cn } from "@/lib/utils";

/** Souběžná čtení dokladů dávky (každé = 1 požadavek na server). */
const EXTRACT_CONCURRENCY = 3;
/** Server ještě čte (jiný požadavek) — zeptat se znovu za… */
const EXTRACT_POLL_MS = 3000;

const DISCARD_BATCH_CONFIRM = "Zahodit focení? AI už dávku přečetla — nahrané soubory se smažou a nic se neuloží.";
const CLOSE_PARTIAL_CONFIRM = "Zavřít? Neuložené doklady se přiloží k zakázce jako „Ostatní“ ke kontrole (nic se neztratí).";
const CLOSE_PARTIAL_ORPHANS_CONFIRM = "Zavřít? Neuložené doklady uložených zakázek se přiloží jako „Ostatní“. Doklady, ke kterým se zakázku uložit nepodařilo, se NEuloží a smažou — radši je zkus uložit znovu.";
const LOCKED_SORT = "Část dávky je už uložená — roztřídění už nejde měnit. Uprav údaje a ulož zbytek.";

function guessMime(f: File): string {
  if (f.type) return f.type;
  if (/\.pdf$/i.test(f.name)) return "application/pdf";
  if (/\.hei[cf]$/i.test(f.name)) return "image/heic";
  if (/\.(jpe?g|png|webp|gif)$/i.test(f.name)) return `image/${/\.png$/i.test(f.name) ? "png" : /\.webp$/i.test(f.name) ? "webp" : /\.gif$/i.test(f.name) ? "gif" : "jpeg"}`;
  return "application/octet-stream";
}

type StepKey = "pick" | "reading" | "sort" | "review" | "done";

function Steps({ step, aiSkipped, withSort, partial, className }: { step: CaptureStep; aiSkipped: boolean; withSort: boolean; partial?: boolean; className?: string }) {
  const steps: { key: StepKey; label: string; icon: typeof Camera; tone: string }[] = [
    { key: "pick", label: "Vyfotit", icon: Camera, tone: "bg-rose-600 text-white" },
    { key: "reading", label: aiSkipped ? "Bez AI" : "AI čte", icon: Sparkles, tone: "bg-fuchsia-600 text-white" },
    ...(withSort ? [{ key: "sort" as const, label: "Roztřídění", icon: LayoutGrid, tone: "bg-indigo-600 text-white" }] : []),
    { key: "review", label: "Kontrola", icon: ClipboardCheck, tone: "bg-amber-400 text-amber-950" },
    partial
      ? { key: "done", label: "Částečně", icon: AlertTriangle, tone: "bg-amber-400 text-amber-950" }
      : { key: "done", label: "Hotovo", icon: CheckCircle2, tone: "bg-emerald-700 text-white" },
  ];
  const now: StepKey = step === "saving" ? "review" : step;
  const current = Math.max(0, steps.findIndex((s) => s.key === now));
  return (
    <ol className={cn("flex items-center gap-1", className)} aria-label="Postup">
      {steps.map((s, i) => {
        const Icon = s.icon;
        const done = i < current;
        const isNow = i === current;
        return (
          <li key={s.key} className="flex items-center gap-1" aria-current={isNow ? "step" : undefined}>
            {i > 0 && <span className={cn("h-0.5 w-3 rounded sm:w-5", done || isNow ? "bg-foreground/30" : "bg-border")} />}
            <span
              className={cn(
                "flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium transition",
                isNow ? cn(s.tone, "shadow-sm") : done ? "bg-muted text-foreground" : "text-muted-foreground",
                s.key === "reading" && aiSkipped && done && "line-through decoration-foreground/40",
              )}
            >
              {done ? <Check className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
              <span className={cn(!isNow && "sr-only sm:not-sr-only")}>{s.label}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export interface CaptureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId?: string;
  expectedKind?: CaptureDocKind;
  onSaved?: (result: CaptureResult) => void;
}

interface ExtractJob {
  docId: string;
  pagesKey: string;
  type: BatchDocType;
  pageIds: string[];
  force: boolean;
}

/** Výsledek dávky pro onSaved (stejný tvar jako jeden doklad — první uložená zakázka). */
function batchToCaptureResult(r: BatchResult): CaptureResult {
  const g = r.groups.find((x) => x.ok && x.jobId);
  return {
    ok: r.ok, created: Boolean(g?.created), jobId: g?.jobId, jobNumber: g?.jobNumber, aiUsed: r.aiUsed, filled: [],
    stageFrom: g?.stageFrom, stageTo: g?.stageTo, customerName: g?.customerName, customerCreated: g?.customerCreated,
    fileIds: r.docs.flatMap((d) => d.fileIds), autoApplied: r.autoApplied, warnings: r.warnings,
  };
}

/**
 * Dialog „📷 Vyfotit doklad": jeden doklad 1 Vyfotit → 2 AI čte → 3 Kontrola → 4 Hotovo;
 * víc dokladů najednou (dávka) navíc krok Roztřídění a kontrola po zakázkách.
 * Na mobilu přes celou obrazovku, na počítači velké okno.
 */
export function CaptureDialog({ open, onOpenChange, jobId, expectedKind, onSaved }: CaptureDialogProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { can } = useAccess();
  const aiHint = can("ai_capture");
  const [state, dispatch] = React.useReducer(captureReducer, INITIAL_FLOW);
  const stateRef = React.useRef<CaptureFlowState>(state);
  stateRef.current = state;
  const files = React.useRef(new Map<string, File>());
  const shas = React.useRef(new Map<string, string>());
  const removed = React.useRef(new Set<string>());
  const queue = React.useRef<Promise<void>>(Promise.resolve());
  const closed = React.useRef(false);
  const abort = React.useRef<AbortController | null>(null);
  const busy = React.useRef(false);
  const [pickingJob, setPickingJob] = React.useState(false);
  const [showPreview, setShowPreview] = React.useState(true);
  const reviewScroll = React.useRef<HTMLDivElement>(null);
  const bodyScroll = React.useRef<HTMLDivElement>(null);
  const closeSortSheet = React.useRef<(() => boolean) | null>(null);
  const jumpToProblem = React.useRef<((p: { groupKey?: string; docId?: string }) => void) | null>(null);
  // ── dávka ──
  const [notice, setNotice] = React.useState<string | null>(null);
  const [resume, setResume] = React.useState<{ rec: CaptureResumeRecord; batch: BatchSortModel; extracts: DocExtractSummary[] } | null>(null);
  const [resumeBusy, setResumeBusy] = React.useState(false);
  const [pickingGroup, setPickingGroup] = React.useState<string | null>(null);
  const [reviewBusy, setReviewBusy] = React.useState(false);
  const [typeSheetFor, setTypeSheetFor] = React.useState<string | null>(null);
  const extractQueue = React.useRef<ExtractJob[]>([]);
  const extractActive = React.useRef(0);
  const extractTimers = React.useRef(new Set<number>());
  const autoAllowed = React.useRef(false);
  const reviewInFlight = React.useRef(false);
  const assignRef = React.useRef<Record<string, string>>({});
  const closingByButton = React.useRef(false);

  const revokeAll = React.useCallback(() => {
    for (const p of stateRef.current.pages) if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
    files.current.clear();
  }, []);

  React.useEffect(() => {
    closed.current = false;
    const timers = extractTimers.current;
    return () => {
      closed.current = true;
      abort.current?.abort();
      for (const t of timers) window.clearTimeout(t);
      revokeAll();
      releasePdfThumbs();
    };
  }, [revokeAll]);

  // Rozpracované focení (jen v prvním kroku, ověřené na serveru)
  React.useEffect(() => {
    const rec = readResume();
    if (!rec) return;
    let alive = true;
    batchSessionRequest(rec.captureId).then((res) => {
      if (!alive || closed.current) return;
      if (res.ok) setResume({ rec, batch: res.batch, extracts: res.extracts });
      else clearResume();
    }).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  React.useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const addFiles = React.useCallback((list: File[]) => {
    const s = stateRef.current;
    if (s.step !== "pick") return;
    const ok = list.filter((f) => isBatchUploadable(f.name || "soubor", f.size));
    const room = CAPTURE_BATCH_MAX_FILES - s.pages.length;
    const take = ok.slice(0, Math.max(0, room));
    const problems: string[] = [];
    for (const f of list) if (!ok.includes(f)) problems.push(`Soubor ${f.name} je větší než 50 MB.`);
    if (ok.length > take.length) problems.push(`Najednou jde nahrát nejvýš ${CAPTURE_BATCH_MAX_FILES} souborů.`);
    if (problems.length) dispatch({ type: "failed", error: problems.join(" "), step: "pick" });
    if (!take.length) return;

    const drafts: PageDraft[] = take.map((f) => {
      const id = crypto.randomUUID();
      files.current.set(id, f);
      const mimeType = guessMime(f);
      const kind = pickTileKind(f.name, mimeType);
      return {
        id, name: f.name || "foto.jpg", size: f.size, mimeType,
        previewUrl: kind === "image" || kind === "pdf" ? URL.createObjectURL(f) : null,
        status: "uploading", error: null, ref: null,
      };
    });
    dispatch({ type: "add", pages: drafts });
    // postupně (mobilní data) — čtení může začít, až je vše nahrané
    for (const d of drafts) {
      queue.current = queue.current.then(async () => {
        const file = files.current.get(d.id);
        if (!file || closed.current || removed.current.has(d.id)) return;
        // stejný soubor dvakrát v dávce nechceme (SHA-256 obsahu)
        const sha = await fileSha256(file);
        if (sha) {
          const live = new Set(stateRef.current.pages.map((p) => p.id));
          const dup = [...shas.current.entries()].some(([id, h]) => h === sha && id !== d.id && live.has(id) && !removed.current.has(id));
          if (dup) {
            removed.current.add(d.id);
            if (d.previewUrl) URL.revokeObjectURL(d.previewUrl);
            files.current.delete(d.id);
            dispatch({ type: "remove", id: d.id });
            setNotice(`Už je v dávce: ${d.name}`);
            return;
          }
          shas.current.set(d.id, sha);
        }
        const res = await uploadCapturePage(file);
        if (res.ok && (closed.current || removed.current.has(d.id))) {
          discardCaptureQuietly({ paths: [res.ref.path] });
          return;
        }
        if (closed.current) return;
        dispatch(res.ok ? { type: "uploaded", id: d.id, ref: res.ref } : { type: "uploadFailed", id: d.id, error: res.error });
      });
    }
  }, []);

  const removePage = React.useCallback((id: string) => {
    const p = stateRef.current.pages.find((x) => x.id === id);
    if (!p) return;
    removed.current.add(id);
    shas.current.delete(id);
    if (p.ref) discardCaptureQuietly({ paths: [p.ref.path] });
    if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
    files.current.delete(id);
    dispatch({ type: "remove", id });
  }, []);

  // ── Dávka: vytěžení dokladů (fronta, max. 3 souběžně, bez abortu) ──
  const pumpExtracts = React.useCallback(() => {
    const s0 = stateRef.current;
    const captureId = s0.batch?.captureId;
    if (!captureId) return;
    while (extractActive.current < EXTRACT_CONCURRENCY && extractQueue.current.length) {
      const job = extractQueue.current.shift()!;
      const doc = stateRef.current.sort.docs.find((d) => d.id === job.docId);
      if (!doc || doc.excluded || pagesKey(doc.pageIds) !== job.pagesKey) continue;
      extractActive.current += 1;
      dispatch({ type: "extractStart", docId: job.docId, pagesKey: job.pagesKey });
      extractBatchDocRequest({ captureId, docId: job.docId, type: job.type, pageIds: job.pageIds, force: job.force || undefined })
        .then((res) => {
          if (closed.current || stateRef.current.batch?.captureId !== captureId) return;
          if (res.ok && res.summary.status === "reading") {
            // čte jiný požadavek (např. před zamčením telefonu) — zeptat se znovu
            const t = window.setTimeout(() => {
              extractTimers.current.delete(t);
              extractQueue.current.push({ ...job, force: false });
              pumpExtracts();
            }, EXTRACT_POLL_MS);
            extractTimers.current.add(t);
            return;
          }
          const summary: DocExtractSummary = res.ok ? res.summary : {
            docId: job.docId, pagesKey: job.pagesKey, type: job.type, status: "error", error: res.error, aiUsed: false,
            title: "", documentNumber: "", confidence: null, clarifications: 0,
          };
          dispatch({ type: "extractDone", docId: job.docId, pagesKey: job.pagesKey, summary: { ...summary, type: job.type } });
        })
        .catch(() => {
          dispatch({
            type: "extractDone", docId: job.docId, pagesKey: job.pagesKey,
            summary: {
              docId: job.docId, pagesKey: job.pagesKey, type: job.type, status: "error", error: "Čtení se nepodařilo — zkus to znovu.",
              aiUsed: false, title: "", documentNumber: "", confidence: null, clarifications: 0,
            },
          });
        })
        .finally(() => {
          extractActive.current -= 1;
          pumpExtracts();
        });
    }
  }, []);

  const enqueueExtract = React.useCallback((job: ExtractJob) => {
    extractQueue.current = extractQueue.current.filter((j) => j.docId !== job.docId);
    extractQueue.current.push(job);
    dispatch({ type: "extractQueued", docId: job.docId, pagesKey: job.pagesKey, docType: job.type });
  }, []);

  // co se změnilo (nové doklady, jiné stránky, jiná strana) → do fronty
  React.useEffect(() => {
    if (!state.batch || state.step === "pick" || state.step === "done") return;
    const missing = missingExtracts(state);
    if (!missing.length) return;
    for (const m of missing) enqueueExtract({ ...m, force: false });
    pumpExtracts();
  }, [state, enqueueExtract, pumpExtracts]);

  // návrat do aplikace (zamčený telefon) → dočíst, co se mezitím mohlo ztratit
  React.useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== "visible") return;
      const s = stateRef.current;
      if (!s.batch) return;
      for (const d of s.sort.docs) {
        const st = docExtractStatus(s, d);
        if (st === "reading" && !extractQueue.current.some((j) => j.docId === d.id) && extractActive.current === 0) {
          enqueueExtract({ docId: d.id, pagesKey: pagesKey(d.pageIds), type: d.type, pageIds: d.pageIds, force: false });
        }
      }
      pumpExtracts();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [enqueueExtract, pumpExtracts]);

  const retryExtract = React.useCallback((docId: string) => {
    const d = stateRef.current.sort.docs.find((x) => x.id === docId);
    if (!d) return;
    enqueueExtract({ docId, pagesKey: pagesKey(d.pageIds), type: d.type, pageIds: d.pageIds, force: true });
    pumpExtracts();
  }, [enqueueExtract, pumpExtracts]);

  // ── Dávka: kontrola ──
  const applyBatch = React.useCallback(async (applyState: BatchApplyState, auto = false) => {
    const s = stateRef.current;
    if (!s.batch || busy.current) return;
    busy.current = true;
    dispatch({ type: "save" });
    const res = await applyBatchRequest(s.batch.captureId, auto ? { ...applyState, auto: true } : applyState).finally(() => {
      busy.current = false;
    });
    if (closed.current) return;
    if (res.status === "failed" && !res.docs.some((d) => d.ok)) {
      dispatch({ type: "failed", error: res.error ?? "Uložení se nepodařilo.", step: "review" });
      return;
    }
    dispatch({ type: "batchSaved", result: res });
    if (res.status === "done") clearResume();
    else writeResume({ captureId: s.batch.captureId, step: "done-partial", pages: s.batch.pages.length });
    router.refresh();
    onSaved?.(batchToCaptureResult(res));
  }, [router, onSaved]);

  const requestReview = React.useCallback(async (opts: { sort?: BatchSort; assign?: Record<string, string>; targets?: Record<string, string>; confirm?: string[] } = {}) => {
    const s = stateRef.current;
    if (!s.batch || reviewInFlight.current) return;
    const sort = opts.sort ?? s.sort;
    const invalid = validateBatchSort(sort, s.batch.pages);
    if (invalid) {
      dispatch({ type: "failed", error: invalid, step: s.step === "review" ? "review" : "sort" });
      return;
    }
    reviewInFlight.current = true;
    setReviewBusy(true);
    if (opts.assign) assignRef.current = { ...assignRef.current, ...opts.assign };
    try {
      const res = await batchReviewRequest({
        captureId: s.batch.captureId,
        sort,
        assign: Object.keys(assignRef.current).length ? assignRef.current : undefined,
        targets: { ...chosenTargets(s.batchState), ...opts.targets },
        customerConfirmed: [...new Set([...confirmedGroups(s.batchState), ...(opts.confirm ?? [])])],
      });
      if (closed.current) return;
      const cur = stateRef.current;
      if (!res.ok) {
        dispatch({ type: "failed", error: res.error, step: cur.step === "review" ? "review" : cur.step === "reading" ? "sort" : cur.step });
        return;
      }
      // „new" / „new:<doklad>" → skutečný klíč skupiny, aby příští požadavek nezakládal další
      for (const [docId, key] of Object.entries(assignRef.current)) {
        if (key !== "new" && !key.startsWith("new:")) continue;
        const g = res.review.groups.find((x) => x.docIds.includes(docId));
        if (g) assignRef.current[docId] = g.key;
      }
      if (cur.batch?.mode === "full" && autoAllowed.current) {
        autoAllowed.current = false;
        if (canAutoApplyBatch(res.review, currentSummaries(cur))) {
          dispatch({ type: "batchReviewReady", review: res.review });
          await applyBatch(res.review.initial, true);
          return;
        }
      }
      dispatch({ type: "batchReviewReady", review: res.review });
      writeResume({ captureId: res.review.captureId, step: "review", pages: cur.batch?.pages.length ?? 0 });
    } finally {
      reviewInFlight.current = false;
      setReviewBusy(false);
    }
  }, [applyBatch]);

  // čeká se na dočtení → po dočtení pokračovat samo
  React.useEffect(() => {
    if (!state.waitingForExtracts || !state.batch) return;
    if (extractingCount(state) > 0) return;
    void requestReview();
  }, [state, requestReview]);

  // nový krok začíná nahoře (tělo dialogu je jeden společný posuvník)
  const scrollKey = state.step === "saving" ? "review" : state.step;
  React.useEffect(() => {
    bodyScroll.current?.scrollTo({ top: 0 });
  }, [scrollKey]);

  // ── Historie (Android „Zpět") ──
  React.useEffect(() => {
    if (state.step === "sort" || state.step === "review") pushCaptureHistory();
  }, [state.step]);

  const requestCloseRef = React.useRef<() => void>(() => {});
  React.useEffect(() => {
    function onPop() {
      if (closingByButton.current) return;
      const s = stateRef.current;
      if (s.step === "review" && s.batch) {
        pushCaptureHistory();
        // po částečném uložení zpět do roztřídění nejde (uložené doklady jsou zamčené)
        if (savedDocIds(s.batchResult).size) dispatch({ type: "failed", error: LOCKED_SORT, step: "review" });
        else dispatch({ type: "backToSort" });
      } else if (s.step === "sort") {
        pushCaptureHistory();
        // otevřený list (druh, stránka, náhled) zavřít dřív než celé focení
        if (closeSortSheet.current?.()) return;
        requestCloseRef.current();
      }
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  async function read() {
    const refs = readyRefs(stateRef.current.pages);
    if (!refs.length || busy.current) return;
    busy.current = true;
    setResume(null);
    dispatch({ type: "read" });
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const res = await analyzeCaptureRequest({ files: refs, jobId, expectedKind }, ctrl.signal);
      if (closed.current || ctrl.signal.aborted) return;
      if (!res.ok) {
        dispatch({ type: "failed", error: res.error, step: "pick" });
        return;
      }
      if ("batch" in res) {
        const b = res.batch;
        extractQueue.current = [];
        assignRef.current = {};
        autoAllowed.current = b.mode === "full";
        dispatch({ type: "batchAnalyzed", batch: b });
        if (b.mode === "full" && !b.skipSort) dispatch({ type: "waitExtracts", on: true });
        writeResume({ captureId: b.captureId, step: "sort", pages: b.pages.length });
        return;
      }
      dispatch({ type: "analyzed", model: res.model, applied: res.applied });
      if (res.applied?.ok) {
        router.refresh();
        onSaved?.(res.applied);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      dispatch({ type: "failed", error: "Čtení dokladu selhalo — zkus to znovu.", step: "pick" });
    } finally {
      busy.current = false;
      if (abort.current === ctrl) abort.current = null;
    }
  }

  function cancelReading() {
    const s = stateRef.current;
    if (s.batch) {
      // dávka je přečtená, jen se čeká na dočtení dokladu → do Roztřídění
      autoAllowed.current = false;
      dispatch({ type: "waitExtracts", on: false });
      dispatch({ type: "backToSort" });
      return;
    }
    busy.current = false;
    abort.current?.abort();
    abort.current = null;
    dispatch({ type: "failed", error: "Čtení zrušeno — můžeš přidat stránky nebo to zkusit znovu.", step: "pick" });
  }

  async function pickJob(id: string) {
    const { model, review } = stateRef.current;
    const from = currentTarget(stateRef.current);
    if (!model || !review || !from) return;
    setPickingJob(true);
    try {
      const res = await captureTargetRequest(model.captureId, id);
      if (!res.ok || !res.target) {
        dispatch({ type: "failed", error: res.error ?? "Zakázku se nepodařilo načíst.", step: "review" });
        return;
      }
      const s = stateRef.current;
      if (!s.review) return;
      const next = switchTarget(
        s.review, currentTarget(s) ?? from, res.target,
        defaultCustomerChoice({ mode: "new", customerId: null, customerName: null }, model.customerMatch, model.docCustomer),
        defaultSupplierChoice({ mode: "new", supplierId: null, supplierName: null }, model.supplierMatch, model.docSupplier),
      );
      dispatch({ type: "addTarget", target: res.target, review: next });
    } finally {
      setPickingJob(false);
    }
  }

  async function save() {
    const s = stateRef.current;
    if (s.batch && s.batchReview && s.batchState) {
      const problem = batchSaveProblem(s.batchReview, s.batchState, savedDocIds(s.batchResult));
      if (problem) {
        dispatch({ type: "failed", error: problem, step: "review" });
        return;
      }
      await applyBatch(s.batchState);
      return;
    }
    const { model, review } = s;
    const target = currentTarget(s);
    if (!model || !review || !target) return;
    const supplierSide = isSupplierSideDoc(review);
    // faktura dodavatele jde do Faktur dodavatelů — zakázku, zákazníka ani dodavatele formulář nevyplňuje
    const problem = review.chip === "faktura_dodavatel" ? null : reviewProblem(review, target, supplierSide);
    if (problem) {
      dispatch({ type: "failed", error: problem, step: "review" });
      return;
    }
    if (busy.current) return;
    busy.current = true;
    dispatch({ type: "save" });
    const payload = { ...review, supplier: supplierSide ? review.supplier : { mode: "none" as const } };
    const res = await applyCaptureRequest(model.captureId, payload).finally(() => {
      busy.current = false;
    });
    if (closed.current) return;
    if (!res.ok) {
      dispatch({ type: "failed", error: res.error ?? "Uložení se nepodařilo.", step: "review" });
      return;
    }
    dispatch({ type: "saved", result: res });
    router.refresh();
    onSaved?.(res);
  }

  function another() {
    revokeAll();
    removed.current.clear();
    shas.current.clear();
    extractQueue.current = [];
    assignRef.current = {};
    autoAllowed.current = false;
    clearResume();
    setShowPreview(true);
    dispatch({ type: "reset" });
  }

  // ── Roztřídění / kontrola: úpravy ──
  function editSort(sort: BatchSort) {
    autoAllowed.current = false;
    dispatch({ type: "sortEdit", sort });
  }

  function continueToReview() {
    const s = stateRef.current;
    if (!s.batch) return;
    const invalid = validateBatchSort(s.sort, s.batch.pages);
    if (invalid) {
      dispatch({ type: "failed", error: invalid, step: "sort" });
      return;
    }
    if (!s.sort.docs.some((d) => !d.excluded)) {
      dispatch({ type: "failed", error: "Všechny doklady jsou vyřazené — vrať aspoň jeden, nebo focení zahoď.", step: "sort" });
      return;
    }
    if (extractingCount(s) > 0) dispatch({ type: "waitExtracts", on: true });
    else void requestReview();
  }

  function onWarningAction(w: BatchWarning, a: BatchWarningAction) {
    const s = stateRef.current;
    if (!s.batch || !s.batchState) return;
    const st = s.batchState;
    switch (a.kind) {
      case "same_customer": {
        const key = a.groupKey ?? w.groupKey;
        dispatch({ type: "batchEdit", state: { ...st, groups: st.groups.map((g) => (g.key === key ? { ...g, customerConfirmed: true } : g)) } });
        return;
      }
      case "split_group": {
        // doklady akce odejdou SPOLEČNĚ do jedné nové zakázky („new:<první>")
        const ids = a.docIds?.length ? a.docIds : a.docId ? [a.docId] : w.docIds;
        if (!ids.length) return;
        if (ids.some((id) => savedDocIds(s.batchResult).has(id))) { dispatch({ type: "failed", error: LOCKED_SORT, step: "review" }); return; }
        const key = `new:${ids[0]}`;
        void requestReview({ assign: Object.fromEntries(ids.map((id) => [id, key])) });
        return;
      }
      case "move_to_group":
        if (a.docId && a.groupKey) void requestReview({ assign: { [a.docId]: a.groupKey } });
        return;
      case "exclude_doc": {
        if (!a.docId) return;
        if (savedDocIds(s.batchResult).has(a.docId)) { dispatch({ type: "failed", error: LOCKED_SORT, step: "review" }); return; }
        const sort = excludeDoc(s.sort, a.docId);
        dispatch({ type: "sortEdit", sort });
        void requestReview({ sort });
        return;
      }
      case "restore_page":
        if (!a.pageId) return;
        if (savedDocIds(s.batchResult).size) { dispatch({ type: "failed", error: LOCKED_SORT, step: "review" }); return; }
        editSort(restorePage(s.sort, a.pageId, s.batch.pages));
        dispatch({ type: "backToSort" });
        return;
      case "set_type":
        if (!a.docId || !a.type) return;
        if (savedDocIds(s.batchResult).size) { dispatch({ type: "failed", error: LOCKED_SORT, step: "review" }); return; }
        editSort(setDocType(s.sort, a.docId, a.type));
        dispatch({ type: "backToSort" });
        return;
      case "skip_duplicate":
      case "save_version": {
        const ids = a.docId ? [a.docId] : w.docIds;
        const value = a.kind === "skip_duplicate" ? "skip" : "version";
        const docs = { ...st.docs };
        for (const id of ids) {
          const d = docs[id];
          if (d && d.kind !== "file") docs[id] = { ...d, state: { ...d.state, onDuplicate: value } } as typeof d;
        }
        dispatch({ type: "batchEdit", state: { ...st, docs } });
        return;
      }
      default:
        return;
    }
  }

  /** „Sloučit do jedné zakázky": všechny doklady do první skupiny (odlišné IČO jen s potvrzením). */
  function mergeAll() {
    const s = stateRef.current;
    if (!s.batch || !s.batchReview || !s.batchState) return;
    const plan = mergeAllPlan(s.batchReview, s.batchState, savedDocIds(s.batchResult));
    if (!plan) {
      if (savedDocIds(s.batchResult).size) dispatch({ type: "failed", error: LOCKED_SORT, step: "review" });
      return;
    }
    if (plan.icos.length > 1 && !window.confirm(`Doklady mají různé IČO zákazníka (${plan.icos.join(" × ")}). Opravdu je uložit do jedné zakázky?`)) return;
    void requestReview({ assign: plan.assign, confirm: plan.icos.length > 1 ? [plan.target] : [] });
  }

  function fileOnlyAndRetry(docId: string) {
    const st = stateRef.current.batchState;
    if (!st) return;
    const d = st.docs[docId];
    if (!d || d.kind !== "business") return;
    const next: BatchApplyState = { ...st, docs: { ...st.docs, [docId]: { kind: "business", state: { ...d.state, fileOnly: true } } } };
    dispatch({ type: "batchEdit", state: next });
    void applyBatch(next);
  }

  function requestClose() {
    const s = stateRef.current;
    if (s.step === "saving") return;
    const batchOpen = Boolean(s.batch) && s.step !== "done" && s.step !== "pick";
    const partial = s.step === "done" && s.batchResult && s.batchResult.status !== "done";
    const pending = s.step !== "done" && (s.pages.length > 0 || s.model !== null || s.batch !== null);
    const orphans = Boolean(partial && s.batchResult?.groups.some((g) => !g.ok));
    if (batchOpen && !window.confirm(DISCARD_BATCH_CONFIRM)) return;
    if (!batchOpen && pending && s.step === "review" && !window.confirm("Zahodit doklad? Nahrané fotky se smažou a nic se neuloží.")) return;
    if (partial && !window.confirm(orphans ? CLOSE_PARTIAL_ORPHANS_CONFIRM : CLOSE_PARTIAL_CONFIRM)) return;
    if (partial && s.batch) {
      discardCaptureQuietly({ captureId: s.batch.captureId });
    } else if (pending) {
      abort.current?.abort();
      discardCaptureQuietly({
        captureId: s.batch?.captureId ?? s.model?.captureId ?? null,
        paths: readyRefs(s.pages).map((r) => r.path),
      });
      for (const p of s.pages) removed.current.add(p.id);
    }
    if (s.batch || partial) clearResume();
    extractQueue.current = [];
    if (isCaptureHistoryTop()) {
      closingByButton.current = true;
      popCaptureHistory();
    }
    onOpenChange(false);
  }
  requestCloseRef.current = requestClose;

  /** Odkaz z obrazovky Hotovo: zavřít bez kroku zpět v historii (navigace by se jinak vrátila). */
  function closeForLink() {
    const s = stateRef.current;
    if (s.batchResult?.status === "done") clearResume();
    extractQueue.current = [];
    onOpenChange(false);
  }

  async function resumeBatch() {
    if (!resume) return;
    setResumeBusy(true);
    try {
      const res = await batchSessionRequest(resume.rec.captureId);
      if (closed.current) return;
      if (!res.ok) {
        clearResume();
        setResume(null);
        dispatch({ type: "failed", error: res.error, step: "pick" });
        return;
      }
      extractQueue.current = [];
      assignRef.current = {};
      autoAllowed.current = false;
      setResume(null);
      dispatch({ type: "batchResumed", batch: res.batch, extracts: res.extracts });
    } finally {
      setResumeBusy(false);
    }
  }

  function discardResume() {
    if (!resume) return;
    discardCaptureQuietly({ captureId: resume.rec.captureId });
    clearResume();
    setResume(null);
  }

  const { step, model, review, pages, error, batch } = state;
  const targets = allTargets(state);
  const target = currentTarget(state);
  const uploading = pages.some((p) => p.status === "uploading");
  const fixedNumber = model?.fixedJobId ? model.targets[0]?.number : batch?.fixedJobNumber ?? null;
  const subtitle = jobId
    ? `Doklad k zakázce${fixedNumber ? ` ${fixedNumber}` : ""} — AI doplní, co na něm najde.`
    : aiHint ? "AI přečte a roztřídí doklady, najde zákazníka i zakázku — ty jen zkontroluješ." : "Vyfoť, doplň pár údajů a ulož do knihy.";

  const localByPath = new Map(pages.filter((p) => p.ref).map((p) => [p.ref!.path, p.previewUrl]));
  const local: LocalUrls = localByPath;
  const viewer: ViewerPage[] = (model?.previews ?? []).map((p) => ({
    key: p.path,
    url: localByPath.get(p.path) ?? p.url,
    mimeType: p.mimeType,
    name: p.filename,
  }));
  const first = pages.find((p) => p.status === "ready") ?? pages[0];
  const visual = pages.filter((p) => ["image", "pdf"].includes(pickTileKind(p.name, p.mimeType)));
  const readingBatch: ReadingBatchInfo | null = batch
    ? { mode: "extract", pages: batch.pages.length, files: 0, thumbs: [] }
    : pages.length > 1
      ? { mode: "batch", pages: visual.length, files: pages.length - visual.length, thumbs: visual.map((p) => (p.mimeType.startsWith("image/") ? p.previewUrl ?? "" : "")) }
      : null;
  const waitingCount = batch ? extractingCount(state) : 0;
  const lockedDocs = React.useMemo(() => savedDocIds(state.batchResult), [state.batchResult]);
  const activeDocs = state.sort.docs.filter((d) => !d.excluded).length;
  const batchProblem = state.batchReview && state.batchState ? batchSaveProblem(state.batchReview, state.batchState, lockedDocs) : null;
  const withSort = Boolean(batch && (!batch.skipSort || step === "sort"));
  const docStatus = (d: { id: string; type: BatchDocType; pageIds: string[] }) => docExtractStatus(state, d);
  const errorOf = (docId: string) => state.extracts[docId]?.summary?.error ?? null;
  const pickLabel = pages.length > 1
    ? `Přečíst a roztřídit (${pages.length})`
    : "Přečíst doklad";
  const partialDone = step === "done" && Boolean(state.batchResult && state.batchResult.status !== "done");
  const scrollStep = step === "saving" ? "review" : step;

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : requestClose())}>
      <DialogContent
        hideClose
        aria-describedby={undefined}
        // fokus ne na křížek (na mobilu by svítil rámeček) — na obsah dialogu
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.focus?.();
        }}
        onInteractOutside={(e) => {
          if (stateRef.current.pages.length || stateRef.current.step !== "pick") e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          const el = document.activeElement;
          if (el instanceof HTMLElement && el.closest("[data-combobox-open]")) e.preventDefault();
          else if (stateRef.current.step === "saving") e.preventDefault();
        }}
        // kliknutí uvnitř dialogu nesmí probublat do řádku knihy, ze kterého se otevřel
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "top-0 flex h-[100dvh] max-w-6xl flex-col overflow-hidden rounded-none p-0",
          "sm:top-[3vh] sm:h-[94vh] sm:w-[calc(100%-2rem)] sm:rounded-2xl",
        )}
      >
        <div className="flex shrink-0 items-center gap-3 border-b px-3 py-2.5 sm:px-5 sm:py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-600 text-white shadow-md shadow-rose-600/25">
            <Camera className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="leading-tight">Vyfotit doklad</DialogTitle>
            <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
          </div>
          <Steps step={step} aiSkipped={Boolean((model && !model.aiUsed) || (batch && !batch.aiUsed))} withSort={withSort} partial={partialDone} className="hidden md:flex" />
          <button
            type="button"
            onClick={requestClose}
            disabled={step === "saving"}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-40"
            aria-label="Zavřít"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <Steps step={step} aiSkipped={Boolean((model && !model.aiUsed) || (batch && !batch.aiUsed))} withSort={withSort} partial={partialDone} className="shrink-0 justify-center border-b bg-muted/30 px-3 py-1.5 md:hidden" />

        {/* tělo */}
        {(step === "pick" || step === "reading" || step === "done" || step === "sort" || (batch && (step === "review" || step === "saving"))) && (
          <div ref={bodyScroll} data-step={scrollStep} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3 scrollbar-thin sm:p-5">
            {step === "pick" && (
              <CapturePick
                pages={pages}
                onAddFiles={addFiles}
                onRemove={removePage}
                onMove={(id, delta) => dispatch({ type: "move", id, delta })}
                aiHint={aiHint}
                notice={notice}
                resume={resume ? { pages: resume.rec.pages || resume.batch.pages.length, busy: resumeBusy } : null}
                onResume={resumeBatch}
                onDiscardResume={discardResume}
              />
            )}
            {step === "reading" && (
              <CaptureReading
                previewUrl={first?.previewUrl ?? null}
                isPdf={first?.mimeType === "application/pdf"}
                ai={batch ? batch.aiUsed : aiHint}
                onCancel={cancelReading}
                batch={readingBatch}
              />
            )}
            {step === "sort" && batch && (
              <CaptureSort
                batch={batch}
                sort={state.sort}
                local={local}
                statusOf={docStatus}
                errorOf={errorOf}
                onChange={editSort}
                onRetry={retryExtract}
                waiting={state.waitingForExtracts || reviewBusy}
                waitingCount={waitingCount}
                onCancelWait={() => {
                  autoAllowed.current = false;
                  dispatch({ type: "waitExtracts", on: false });
                }}
                typeSheetFor={typeSheetFor}
                onTypeSheetClosed={() => setTypeSheetFor(null)}
                closeSheetRef={closeSortSheet}
              />
            )}
            {(step === "review" || step === "saving") && batch && state.batchReview && state.batchState && (
              <fieldset disabled={step === "saving"} className="min-w-0">
                <CaptureBatchReview
                  review={state.batchReview}
                  state={state.batchState}
                  batch={batch}
                  local={local}
                  locked={lockedDocs}
                  picking={pickingGroup}
                  onChange={(st) => dispatch({ type: "batchEdit", state: st })}
                  onPickJob={async (groupKey, id) => {
                    setPickingGroup(groupKey);
                    try {
                      await requestReview({ targets: { [groupKey]: id } });
                    } finally {
                      setPickingGroup(null);
                    }
                  }}
                  onAssign={(docId, key) => void requestReview({ assign: { [docId]: key } })}
                  onAction={onWarningAction}
                  onMergeAll={mergeAll}
                  busy={reviewBusy}
                  jumpRef={jumpToProblem}
                  onChangeType={(docId) => {
                    if (lockedDocs.size) {
                      dispatch({ type: "failed", error: LOCKED_SORT, step: "review" });
                      return;
                    }
                    setTypeSheetFor(docId);
                    dispatch({ type: "backToSort" });
                  }}
                />
              </fieldset>
            )}
            {step === "done" && state.result && !batch && (
              <CaptureDone
                result={state.result}
                onJobPage={Boolean(state.result.jobId && pathname === `/orders/${state.result.jobId}`)}
                onAnother={another}
                onClose={() => onOpenChange(false)}
              />
            )}
            {step === "done" && state.batchResult && batch && (
              <CaptureBatchDone
                result={state.batchResult}
                onJobPage={(id) => pathname === `/orders/${id}`}
                busy={busy.current}
                onEditRetry={() => dispatch({ type: "editAfterPartial" })}
                onRetry={() => state.batchState && void applyBatch(state.batchState)}
                onFileOnly={fileOnlyAndRetry}
                onAnother={another}
                onClose={requestClose}
                onLink={closeForLink}
              />
            )}
          </div>
        )}

        {(step === "review" || step === "saving") && !batch && model && review && target && (
          // mobil: fotka nahoře a odjede s formulářem (tlačítko „Fotka" vrátí nahoru); počítač: vedle sebe
          <div ref={reviewScroll} className="relative min-h-0 flex-1 overflow-y-auto scrollbar-thin lg:flex lg:overflow-hidden">
            <div className={cn("border-b bg-muted/20 p-2 sm:p-3 lg:w-[42%] lg:shrink-0 lg:border-b-0 lg:border-r", !showPreview && "hidden lg:block")}>
              <CapturePages pages={viewer} className="h-[46vh] sm:h-[52vh] lg:h-full" />
            </div>
            <div className="scrollbar-thin p-3 sm:p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
              <button
                type="button"
                onClick={() => setShowPreview((x) => !x)}
                className="mb-2 inline-flex min-h-9 items-center gap-1.5 rounded-full px-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground lg:hidden"
              >
                {showPreview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {showPreview ? "Skrýt fotku" : "Ukázat fotku"}
              </button>
              <fieldset disabled={step === "saving"} className="min-w-0">
                <CaptureReviewForm
                  model={model}
                  review={review}
                  targets={targets}
                  onChange={(r) => dispatch({ type: "edit", review: r })}
                  onPickJob={pickJob}
                  pickingJob={pickingJob}
                />
              </fieldset>
            </div>
            {showPreview && (
              <div className="pointer-events-none sticky bottom-3 flex justify-end pr-3 lg:hidden">
                <button
                  type="button"
                  onClick={() => reviewScroll.current?.scrollTo({ top: 0, behavior: "smooth" })}
                  className="pointer-events-auto flex h-11 items-center gap-1.5 rounded-full bg-slate-900/85 px-4 text-xs font-medium text-white shadow-lg backdrop-blur dark:bg-slate-700/90"
                  aria-label="Zpět na fotku dokladu"
                >
                  <Camera className="h-4 w-4" /> Fotka
                </button>
              </div>
            )}
          </div>
        )}

        {/* patička */}
        {(step === "pick" || step === "review" || step === "saving" || step === "sort") && (
          <div className="shrink-0 border-t bg-background/95 px-3 py-2.5 backdrop-blur sm:px-5" style={{ paddingBottom: "max(0.625rem, env(safe-area-inset-bottom))" }}>
            {error && (
              <div role="alert" className="mb-2 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1">{error}</span>
                <button type="button" onClick={() => dispatch({ type: "dismissError" })} aria-label="Zavřít hlášku" className="shrink-0 opacity-60 hover:opacity-100">
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
            {batch && state.batchReview && state.batchState && (step === "review" || step === "saving") && (
              <p data-testid="capture-batch-summary" className="mb-2 line-clamp-3 text-xs text-muted-foreground sm:line-clamp-2" title={batchSummaryText(state)}>
                {batchSummaryText(state)}
              </p>
            )}
            <div className="flex items-center justify-between gap-2">
              {batch && (step === "review" || step === "saving") ? (
                <Button type="button" variant="ghost" onClick={() => dispatch({ type: "backToSort" })} disabled={step === "saving" || lockedDocs.size > 0} className="shrink-0 px-2 sm:px-4">
                  <ArrowLeft /> <span className="hidden sm:inline">Zpět k roztřídění</span><span className="sm:hidden">Zpět</span>
                </Button>
              ) : (
                <Button type="button" variant="ghost" onClick={requestClose} disabled={step === "saving"}>
                  Zrušit
                </Button>
              )}
              {step === "pick" ? (
                <Button
                  type="button"
                  size="lg"
                  onClick={read}
                  disabled={!canRead(pages)}
                  className="min-w-0 flex-1 bg-fuchsia-600 text-white shadow-md shadow-fuchsia-600/20 hover:bg-fuchsia-700 sm:flex-none"
                  data-testid="capture-read"
                >
                  {uploading ? <Loader2 className="animate-spin" /> : aiHint ? <Sparkles /> : <ArrowRight />}
                  <span className="truncate">{uploading ? "Nahrávám…" : aiHint ? pickLabel : "Pokračovat k vyplnění"}</span>
                </Button>
              ) : step === "sort" ? (
                <Button
                  type="button"
                  size="lg"
                  onClick={continueToReview}
                  disabled={state.waitingForExtracts || reviewBusy || activeDocs === 0}
                  className="min-w-0 flex-1 bg-indigo-600 text-white shadow-md shadow-indigo-600/20 hover:bg-indigo-700 sm:flex-none"
                  data-testid="capture-sort-continue"
                >
                  {state.waitingForExtracts || reviewBusy ? <Loader2 className="animate-spin" /> : <ArrowRight />}
                  <span className="truncate">
                    {state.waitingForExtracts && waitingCount > 0 ? `Dočítám ${waitingCount}…` : reviewBusy ? "Připravuji kontrolu…" : `Pokračovat ke kontrole (${activeDocs})`}
                  </span>
                </Button>
              ) : batch ? (
                <Button
                  type="button"
                  size="lg"
                  onClick={save}
                  disabled={step === "saving" || reviewBusy || Boolean(batchProblem)}
                  title={batchProblem ?? undefined}
                  className={cn("min-w-0 flex-1 sm:flex-none", SAVE_TONE)}
                  data-testid="capture-save"
                >
                  {step === "saving" ? <Loader2 className="animate-spin" /> : <Check />}
                  <span className="truncate">{step === "saving" ? "Ukládám…" : saveAllLabel(state, lockedDocs)}</span>
                </Button>
              ) : (
                <Button type="button" size="lg" onClick={save} disabled={step === "saving"} className={cn("min-w-0 flex-1 sm:flex-none", SAVE_TONE)} data-testid="capture-save">
                  {step === "saving" ? <Loader2 className="animate-spin" /> : <Check />}
                  {step === "saving" ? "Ukládám…" : review?.chip === "faktura_dodavatel" ? "Uložit fakturu" : "Uložit do knihy"}
                </Button>
              )}
            </div>
            {batch && batchProblem && step === "review" && !error && (
              <button
                type="button"
                onClick={() => {
                  const at = state.batchReview && state.batchState ? batchProblemAt(state.batchReview, state.batchState, lockedDocs) : null;
                  if (at) jumpToProblem.current?.(at);
                }}
                className="mt-1.5 block w-full text-right text-xs font-medium text-red-700 underline-offset-2 hover:underline dark:text-red-400"
                data-testid="capture-batch-problem"
              >
                {batchProblem} <span className="whitespace-nowrap font-semibold">Ukázat ↓</span>
              </button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Zelené „Uložit" s kontrastem AA (bílá na emerald-700 ≥ 5:1 ve světlém i tmavém). */
const SAVE_TONE = "bg-emerald-700 text-white shadow-sm hover:bg-emerald-800 dark:bg-emerald-700 dark:hover:bg-emerald-600";

/** „Uložit vše (5)", při víc zakázkách „Uložit vše do 2 zakázek (5)" — počet zakázek nesmí překvapit. */
function saveAllLabel(state: CaptureFlowState, locked: Set<string>): string {
  const docs = state.batchState ? state.batchState.sort.docs.filter((d) => !d.excluded && !locked.has(d.id)).length : 0;
  // skutečné zakázky (skupiny do stejné zakázky = 1), ne počet skupin
  const jobs = state.batchReview && state.batchState
    ? distinctJobCount(jobGroupsToSave(state.batchReview, state.batchState).filter((g) => g.docIds.some((id) => !locked.has(id))))
    : 1;
  return jobs > 1 ? `Uložit vše do ${jobsGenitive(jobs)} (${docs})` : `Uložit vše (${docs})`;
}

/** Souhrn nad „Uložit vše" („2 zakázky · 6 dokladů · + nový zákazník…"). */
function batchSummaryText(state: CaptureFlowState): string {
  if (!state.batchReview || !state.batchState) return "";
  return batchSummaryLine(state.batchReview, state.batchState);
}
