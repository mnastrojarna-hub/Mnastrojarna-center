"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  AlertTriangle, ArrowRight, Camera, Check, CheckCircle2, ClipboardCheck, Eye, EyeOff, Loader2, Sparkles, X,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAccess } from "@/components/access-provider";
import { CapturePick } from "@/components/jobs/capture/capture-pick";
import { CaptureReading } from "@/components/jobs/capture/capture-reading";
import { CaptureReviewForm } from "@/components/jobs/capture/capture-review-form";
import { CapturePages, type ViewerPage } from "@/components/jobs/capture/capture-pages";
import { CaptureDone } from "@/components/jobs/capture/capture-done";
import {
  INITIAL_FLOW, allTargets, canRead, captureReducer, currentTarget, readyRefs, reviewProblem,
  type CaptureStep, type PageDraft,
} from "@/components/jobs/capture/capture-flow";
import {
  analyzeCaptureRequest, applyCaptureRequest, captureTargetRequest, discardCaptureQuietly, uploadCapturePage,
} from "@/components/jobs/capture/capture-client";
import {
  CAPTURE_MAX_PAGES, defaultCustomerChoice, defaultSupplierChoice, isCaptureMime, switchTarget,
} from "@/lib/jobs/capture-review";
import { isSupplierSideDoc } from "@/lib/jobs/matching";
import type { CaptureDocKind, CaptureResult } from "@/lib/jobs/capture-types";
import { cn } from "@/lib/utils";

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|heic|heif|pdf)$/i;

function guessMime(f: File): string {
  if (f.type) return f.type;
  if (/\.pdf$/i.test(f.name)) return "application/pdf";
  if (/\.hei[cf]$/i.test(f.name)) return "image/heic";
  return "image/jpeg";
}

const STEP_INDEX: Record<CaptureStep, number> = { pick: 0, reading: 1, review: 2, saving: 2, done: 3 };

function Steps({ step, aiSkipped, className }: { step: CaptureStep; aiSkipped: boolean; className?: string }) {
  const current = STEP_INDEX[step];
  const steps = [
    { label: "Vyfotit", icon: Camera, tone: "bg-rose-600" },
    { label: aiSkipped ? "Bez AI" : "AI čte", icon: Sparkles, tone: "bg-fuchsia-600" },
    { label: "Kontrola", icon: ClipboardCheck, tone: "bg-amber-500" },
    { label: "Hotovo", icon: CheckCircle2, tone: "bg-emerald-600" },
  ];
  return (
    <ol className={cn("flex items-center gap-1", className)} aria-label="Postup">
      {steps.map((s, i) => {
        const Icon = s.icon;
        const done = i < current;
        const now = i === current;
        return (
          <li key={s.label} className="flex items-center gap-1" aria-current={now ? "step" : undefined}>
            {i > 0 && <span className={cn("h-0.5 w-3 rounded sm:w-5", done || now ? "bg-foreground/30" : "bg-border")} />}
            <span
              className={cn(
                "flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium transition",
                now ? cn(s.tone, "text-white shadow-sm") : done ? "bg-muted text-foreground" : "text-muted-foreground",
                i === 1 && aiSkipped && done && "line-through decoration-foreground/40",
              )}
            >
              {done ? <Check className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
              <span className={cn(!now && "hidden sm:inline")}>{s.label}</span>
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

/**
 * Dialog „📷 Vyfotit doklad": 1 Vyfotit → 2 AI čte → 3 Kontrola → 4 Hotovo.
 * Na mobilu přes celou obrazovku, na počítači velké okno (náhled vlevo, formulář vpravo).
 */
export function CaptureDialog({ open, onOpenChange, jobId, expectedKind, onSaved }: CaptureDialogProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { can } = useAccess();
  const aiHint = can("ai_capture");
  const [state, dispatch] = React.useReducer(captureReducer, INITIAL_FLOW);
  const stateRef = React.useRef(state);
  stateRef.current = state;
  const files = React.useRef(new Map<string, File>());
  const removed = React.useRef(new Set<string>());
  const queue = React.useRef<Promise<void>>(Promise.resolve());
  const closed = React.useRef(false);
  const abort = React.useRef<AbortController | null>(null);
  const busy = React.useRef(false);
  const [pickingJob, setPickingJob] = React.useState(false);
  const [showPreview, setShowPreview] = React.useState(true);
  const reviewScroll = React.useRef<HTMLDivElement>(null);

  const revokeAll = React.useCallback(() => {
    for (const p of stateRef.current.pages) if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
    files.current.clear();
  }, []);

  React.useEffect(() => {
    closed.current = false;
    return () => {
      closed.current = true;
      abort.current?.abort();
      revokeAll();
    };
  }, [revokeAll]);

  const addFiles = React.useCallback((list: File[]) => {
    const s = stateRef.current;
    if (s.step !== "pick") return;
    const ok = list.filter((f) => isCaptureMime(f.type) || IMAGE_EXT.test(f.name));
    const room = CAPTURE_MAX_PAGES - s.pages.length;
    const take = ok.slice(0, Math.max(0, room));
    const problems: string[] = [];
    if (ok.length < list.length) problems.push("Sem patří jen fotky a PDF — ostatní soubory přidej v kartě zakázky do Dokumentů.");
    if (ok.length > take.length) problems.push(`Doklad může mít nejvýš ${CAPTURE_MAX_PAGES} stránek.`);
    if (problems.length) dispatch({ type: "failed", error: problems.join(" "), step: "pick" });
    if (!take.length) return;

    const drafts: PageDraft[] = take.map((f) => {
      const id = crypto.randomUUID();
      files.current.set(id, f);
      return {
        id, name: f.name || "foto.jpg", size: f.size, mimeType: guessMime(f),
        previewUrl: URL.createObjectURL(f), status: "uploading", error: null, ref: null,
      };
    });
    dispatch({ type: "add", pages: drafts });
    // postupně (mobilní data) — čtení může začít, až je vše nahrané
    for (const d of drafts) {
      queue.current = queue.current.then(async () => {
        const file = files.current.get(d.id);
        if (!file || closed.current || removed.current.has(d.id)) return;
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
    if (p.ref) discardCaptureQuietly({ paths: [p.ref.path] });
    if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
    files.current.delete(id);
    dispatch({ type: "remove", id });
  }, []);

  async function read() {
    const refs = readyRefs(stateRef.current.pages);
    if (!refs.length || busy.current) return;
    busy.current = true;
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
    const { model, review } = stateRef.current;
    const target = currentTarget(stateRef.current);
    if (!model || !review || !target) return;
    const supplierSide = isSupplierSideDoc(review);
    const problem = reviewProblem(review, target, supplierSide);
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
    setShowPreview(true);
    dispatch({ type: "reset" });
  }

  function requestClose() {
    const s = stateRef.current;
    if (s.step === "saving") return;
    const pending = s.step !== "done" && (s.pages.length > 0 || s.model !== null);
    if (pending && s.step === "review" && !window.confirm("Zahodit doklad? Nahrané fotky se smažou a nic se neuloží.")) return;
    if (pending) {
      abort.current?.abort();
      discardCaptureQuietly({ captureId: s.model?.captureId ?? null, paths: readyRefs(s.pages).map((r) => r.path) });
      for (const p of s.pages) removed.current.add(p.id);
    }
    onOpenChange(false);
  }

  const { step, model, review, pages, error } = state;
  const targets = allTargets(state);
  const target = currentTarget(state);
  const uploading = pages.some((p) => p.status === "uploading");
  const fixedNumber = model?.fixedJobId ? model.targets[0]?.number : null;
  const subtitle = jobId
    ? `Doklad k zakázce${fixedNumber ? ` ${fixedNumber}` : ""} — AI doplní, co na něm najde.`
    : aiHint ? "AI ho přečte, najde zákazníka i zakázku — ty jen zkontroluješ." : "Vyfoť, doplň pár údajů a ulož do knihy.";

  const localByPath = new Map(pages.filter((p) => p.ref).map((p) => [p.ref!.path, p.previewUrl]));
  const viewer: ViewerPage[] = (model?.previews ?? []).map((p) => ({
    key: p.path,
    url: localByPath.get(p.path) ?? p.url,
    mimeType: p.mimeType,
    name: p.filename,
  }));
  const first = pages.find((p) => p.status === "ready") ?? pages[0];

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
          <Steps step={step} aiSkipped={Boolean(model && !model.aiUsed)} className="hidden md:flex" />
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
        <Steps step={step} aiSkipped={Boolean(model && !model.aiUsed)} className="shrink-0 justify-center border-b bg-muted/30 px-3 py-1.5 md:hidden" />

        {/* tělo */}
        {(step === "pick" || step === "reading" || step === "done") && (
          <div className="min-h-0 flex-1 overflow-y-auto p-3 scrollbar-thin sm:p-5">
            {step === "pick" && (
              <CapturePick
                pages={pages}
                onAddFiles={addFiles}
                onRemove={removePage}
                onMove={(id, delta) => dispatch({ type: "move", id, delta })}
                aiHint={aiHint}
              />
            )}
            {step === "reading" && (
              <CaptureReading
                previewUrl={first?.previewUrl ?? null}
                isPdf={first?.mimeType === "application/pdf"}
                ai={aiHint}
                onCancel={cancelReading}
              />
            )}
            {step === "done" && state.result && (
              <CaptureDone
                result={state.result}
                onJobPage={Boolean(state.result.jobId && pathname === `/orders/${state.result.jobId}`)}
                onAnother={another}
                onClose={() => onOpenChange(false)}
              />
            )}
          </div>
        )}

        {(step === "review" || step === "saving") && model && review && target && (
          // mobil: fotka nahoře a odjede s formulářem (tlačítko „Fotka" vrátí nahoru); počítač: vedle sebe
          <div ref={reviewScroll} className="relative min-h-0 flex-1 overflow-y-auto scrollbar-thin lg:flex lg:overflow-hidden">
            <div className={cn("border-b bg-muted/20 p-2 sm:p-3 lg:w-[42%] lg:shrink-0 lg:border-b-0 lg:border-r", !showPreview && "hidden lg:block")}>
              <CapturePages pages={viewer} className="h-[46vh] sm:h-[52vh] lg:h-full" />
            </div>
            <div className="scrollbar-thin p-3 sm:p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
              <button
                type="button"
                onClick={() => setShowPreview((x) => !x)}
                className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground lg:hidden"
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
        {(step === "pick" || step === "review" || step === "saving") && (
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
            <div className="flex items-center justify-between gap-2">
              <Button type="button" variant="ghost" onClick={requestClose} disabled={step === "saving"}>
                Zrušit
              </Button>
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
                  {uploading ? "Nahrávám…" : aiHint ? "Přečíst doklad" : "Pokračovat k vyplnění"}
                </Button>
              ) : (
                <Button type="button" size="lg" variant="success" onClick={save} disabled={step === "saving"} className="min-w-0 flex-1 sm:flex-none" data-testid="capture-save">
                  {step === "saving" ? <Loader2 className="animate-spin" /> : <Check />}
                  {step === "saving" ? "Ukládám…" : "Uložit do knihy"}
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
