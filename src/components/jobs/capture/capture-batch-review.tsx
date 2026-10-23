"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Eye, EyeOff, Info, PenLine, Sparkles, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/jobs/book/native-select";
import { GROUP_BAR, TONES, TypeChip } from "@/components/jobs/capture/capture-parts";
import { CapturePages } from "@/components/jobs/capture/capture-pages";
import { CaptureGroupHeader } from "@/components/jobs/capture/capture-group-header";
import { CaptureDocForm } from "@/components/jobs/capture/capture-doc-form";
import { CaptureDrawingForm } from "@/components/jobs/capture/capture-drawing-form";
import { CaptureModelForm } from "@/components/jobs/capture/capture-model-form";
import { CaptureFileForm } from "@/components/jobs/capture/capture-file-form";
import { viewerPages, type LocalUrls } from "@/components/jobs/capture/capture-sort";
import { warningResolved, type BatchProblem } from "@/components/jobs/capture/capture-flow";
import { BATCH_TYPES } from "@/lib/jobs/capture-batch";
import { formatIsoDate } from "@/lib/jobs/field-labels";
import type { ReviewItem } from "@/lib/jobs/capture-review";
import type {
  BatchApplyState, BatchDocDraft, BatchDocReview, BatchDocType, BatchGroupState, BatchReviewModel, BatchSortModel, BatchWarning,
  BatchWarningAction, DocApplyState,
} from "@/lib/jobs/capture-batch-types";
import { cn } from "@/lib/utils";

/**
 * Krok Kontrola dávky: skupiny = zakázky (hlavička s cílem, stavem a údaji zakázky),
 * pod nimi sekce dokladů (accordion). Rozbalené jsou jen sekce, které potřebují pohled
 * (upozornění, nízká jistota, ruční vyplnění). „Další ⚠" skočí na další takovou.
 */

export interface CaptureBatchReviewProps {
  review: BatchReviewModel;
  state: BatchApplyState;
  batch: BatchSortModel;
  local: LocalUrls;
  /** Už uložené doklady (po částečném uložení) — jen ke čtení. */
  locked: Set<string>;
  /** Skupina, pro kterou se načítá jiná zakázka. */
  picking: string | null;
  onChange: (state: BatchApplyState) => void;
  onPickJob: (groupKey: string, jobId: string) => void;
  onAssign: (docId: string, groupKey: string) => void;
  onAction: (w: BatchWarning, a: BatchWarningAction) => void;
  onChangeType: (docId: string) => void;
  /** Skok na problém (z hlášky nad „Uložit vše"). */
  jumpRef?: React.MutableRefObject<((p: Pick<BatchProblem, "groupKey" | "docId">) => void) | null>;
}

/** Skupina potřebuje pohled (bez zakázky / nevyřešené blokující upozornění) — „Další ⚠". */
function groupNeedsAttention(groupKey: string, review: BatchReviewModel, state: BatchApplyState): boolean {
  const g = state.groups.find((x) => x.key === groupKey);
  if (!g) return false;
  if (!g.job.targetKey) return true;
  return review.warnings.some((w) => w.groupKey === groupKey && w.severity === "block" && !warningResolved(w, state));
}

function groupElement(key: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-testid="capture-group"][data-group-key="${CSS.escape(key)}"]`);
}

function docTypeOf(review: BatchDocReview, sortDoc: BatchDocDraft | undefined): BatchDocType {
  return review.kind === "business" ? review.type : sortDoc?.type ?? (review.kind === "drawing" ? "vykres" : review.kind === "model" ? "model_3d" : "ostatni");
}

function docWarnings(review: BatchReviewModel, docId: string): BatchWarning[] {
  return review.warnings.filter((w) => w.docIds.includes(docId) && !w.groupKey);
}

/** Sekce potřebuje pohled člověka (rozbalit automaticky, „Další ⚠"). */
function needsAttention(r: BatchDocReview, review: BatchReviewModel, state: BatchApplyState): boolean {
  if (docWarnings(review, r.docId).some((w) => w.severity !== "info" && !warningResolved(w, state))) return true;
  if (r.kind === "business") return !r.aiUsed || (r.confidence !== null && r.confidence < 0.85) || r.needsClarification.length > 0 || Boolean(r.duplicateOf);
  if (r.kind === "drawing") return !r.aiUsed || r.drawing.confidence < 0.85 || Boolean(r.duplicateOf) || Boolean(r.archiveConflict);
  if (r.kind === "model") return Boolean(r.duplicateOf);
  return false;
}

function sectionTitle(r: BatchDocReview, st: DocApplyState | undefined, sortDoc: BatchDocDraft | undefined): string {
  const type = docTypeOf(r, sortDoc);
  const label = BATCH_TYPES[type].label;
  const pages = sortDoc?.pageIds.length ?? 1;
  let num = "";
  if (st?.kind === "business") num = st.state.documentNumber;
  else if (st?.kind === "drawing") num = [st.state.drawingNumber, st.state.revision && `rev. ${st.state.revision}`].filter(Boolean).join(" ");
  else if (st?.kind === "model") num = [st.state.drawingNumber, st.state.format].filter(Boolean).join(" · ");
  else if (st?.kind === "file") num = st.state.title;
  return `${label}${num ? ` ${num}` : ""}${pages > 1 ? ` (${pages} str.)` : ""}`;
}

function statusText(r: BatchDocReview, st: DocApplyState | undefined, groupItems: number): string {
  if (r.kind === "business" && st?.kind === "business") {
    if (st.state.fileOnly) return "jen soubor";
    if (st.state.onDuplicate === "skip") return "neuloží se znovu";
    if (r.primary) return `primární · ${groupItems} ${groupItems === 1 ? "položka" : groupItems >= 2 && groupItems < 5 ? "položky" : "položek"}`;
    if (st.state.type === "dodaci_list_my" && st.state.confirmDelivered) return "potvrzený zákazníkem";
    if (st.state.type === "faktura_my" && st.state.invoiceDueDate) return `splatnost ${formatIsoDate(st.state.invoiceDueDate) ?? st.state.invoiceDueDate}`;
    if (st.state.type === "nabidka_dodavatel") return st.state.selectWinner ? "→ Nákup · vítězná" : "→ Nákup";
    return "přiloží se";
  }
  if (r.kind === "drawing" && st?.kind === "drawing") {
    const link = st.state.link.mode === "add" ? "nová položka" : st.state.link.mode === "none" ? "bez položky" : "→ položka";
    return `${link}${st.state.archive ? " · do archivu" : ""}`;
  }
  if (r.kind === "model" && st?.kind === "model") return st.state.link.mode === "none" ? "bez položky" : st.state.link.mode === "add" ? "nová položka" : "→ položka";
  return "přiloží se";
}

export function CaptureBatchReview({
  review, state, batch, local, locked, picking, onChange, onPickJob, onAssign, onAction, onChangeType, jumpRef,
}: CaptureBatchReviewProps) {
  // pravidlo rozbalení se počítá z odpovědi serveru (ne při každém psaní) — klíč = seznam id
  const attentionKey = review.docs
    .filter((r) => !locked.has(r.docId) && needsAttention(r, review, state))
    .map((r) => r.docId)
    .join(",");
  const attention = React.useMemo(() => new Set(attentionKey ? attentionKey.split(",") : []), [attentionKey]);
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set(attention));
  const [hidePreview, setHidePreview] = React.useState<Set<string>>(new Set());
  const docsKey = review.docs.map((d) => d.docId).join(",");
  const seenAttention = React.useRef(attentionKey);
  React.useEffect(() => {
    // nově vzniklá upozornění rozbalit, zmizelé doklady sbalit; ručně sbalené zůstanou
    const fresh = [...attention].filter((id) => !seenAttention.current.split(",").includes(id));
    seenAttention.current = attentionKey;
    const live = new Set(docsKey.split(","));
    setExpanded((prev) => {
      const next = new Set([...prev].filter((id) => live.has(id)));
      for (const id of fresh) next.add(id);
      return next.size === prev.size && [...next].every((id) => prev.has(id)) ? prev : next;
    });
  }, [attention, attentionKey, docsKey]);

  const setGroup = (g: BatchGroupState) => onChange({ ...state, groups: state.groups.map((x) => (x.key === g.key ? g : x)) });
  const setDoc = (docId: string, d: DocApplyState) => onChange({ ...state, docs: { ...state.docs, [docId]: d } });
  const toggleRow = (groupKey: string, row: ReviewItem, on: boolean) => {
    const g = state.groups.find((x) => x.key === groupKey);
    if (!g) return;
    const items = on
      ? [...g.job.items.filter((i) => i.key !== row.key), { ...row }]
      : g.job.items.filter((i) => i.key !== row.key);
    setGroup({ ...g, job: { ...g.job, items } });
  };

  // pořadí na obrazovce: hlavička skupiny, pak její doklady
  const stops: { kind: "group" | "doc"; id: string }[] = [];
  for (const g of review.groups) {
    const st = state.groups.find((x) => x.key === g.key);
    if (!st || st.docIds.every((id) => locked.has(id))) continue;
    if (groupNeedsAttention(g.key, review, state)) stops.push({ kind: "group", id: g.key });
    for (const id of st.docIds) if (attention.has(id)) stops.push({ kind: "doc", id });
  }
  const stopEl = (s: { kind: "group" | "doc"; id: string }) => (s.kind === "group" ? groupElement(s.id) : document.getElementById(`cap-sec-${s.id}`));
  const goTo = (s: { kind: "group" | "doc"; id: string }) => {
    if (s.kind === "doc") setExpanded((prev) => new Set(prev).add(s.id));
    window.setTimeout(() => stopEl(s)?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
  };
  const nextAttention = () => {
    if (!stops.length) return;
    goTo(stops.find((s) => {
      const el = stopEl(s);
      return el && el.getBoundingClientRect().top > 120;
    }) ?? stops[0]);
  };
  React.useEffect(() => {
    if (!jumpRef) return;
    jumpRef.current = (p) => {
      if (p.docId && review.docs.some((d) => d.docId === p.docId)) goTo({ kind: "doc", id: p.docId });
      else if (p.groupKey) goTo({ kind: "group", id: p.groupKey });
      else nextAttention();
    };
    return () => { jumpRef.current = null; };
  });

  const groups = review.groups
    .map((g, i) => ({ g, i, st: state.groups.find((x) => x.key === g.key) }))
    .filter((x): x is { g: typeof x.g; i: number; st: BatchGroupState } => Boolean(x.st && x.st.docIds.some((id) => review.docs.some((d) => d.docId === id))));
  const docCount = review.docs.length;

  return (
    <div className="mx-auto max-w-4xl space-y-4 pb-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex min-w-0 flex-1 items-center gap-2 text-sm text-muted-foreground">
          {review.aiUsed ? <Sparkles className="h-4 w-4 shrink-0 text-fuchsia-500" /> : <PenLine className="h-4 w-4 shrink-0 text-sky-500" />}
          {review.aiUsed
            ? `AI přečetla ${docCount} ${docCount === 1 ? "doklad" : docCount < 5 ? "doklady" : "dokladů"} — zkontroluj hlavně ⚠ a ulož.`
            : `Vyplň údaje ${docCount === 1 ? "dokladu" : "dokladů"} podle náhledu — zabere to pár minut.`}
        </p>
        {stops.length > 0 && (
          <Button type="button" variant="outline" size="sm" onClick={nextAttention} className="h-9 border-amber-300 text-amber-800 dark:text-amber-300">
            <AlertTriangle className="text-amber-500" /> Další ⚠ ({stops.length})
          </Button>
        )}
      </div>

      {groups.map(({ g, i, st }) => {
        const docs = st.docIds
          .map((id) => ({ r: review.docs.find((d) => d.docId === id), sortDoc: state.sort.docs.find((d) => d.id === id) }))
          .filter((x): x is { r: BatchDocReview; sortDoc: BatchDocDraft | undefined } => Boolean(x.r));
        const groupLocked = docs.length > 0 && docs.every((d) => locked.has(d.r.docId));
        const itemOptions = g.itemOptions[st.job.targetKey] ?? [];
        return (
          <div key={g.key} className="space-y-2">
            <CaptureGroupHeader
              index={i + 1}
              group={g}
              state={st}
              apply={state}
              docs={docs.map((d) => d.sortDoc).filter((d): d is BatchDocDraft => Boolean(d))}
              options={review.options}
              margins={review.margins}
              aiUsed={review.aiUsed}
              fixedJobId={review.fixedJobId}
              warnings={review.warnings.filter((w) => w.groupKey === g.key)}
              locked={groupLocked}
              picking={picking === g.key}
              onChange={setGroup}
              onPickJob={(jobId) => onPickJob(g.key, jobId)}
              onAction={onAction}
            />
            <ul className="space-y-2 sm:pl-3">
              {docs.map(({ r, sortDoc }) => {
                const st2 = state.docs[r.docId];
                const type = docTypeOf(r, sortDoc);
                const meta = BATCH_TYPES[type];
                const open = expanded.has(r.docId);
                const isLocked = locked.has(r.docId);
                const warn = docWarnings(review, r.docId).filter((w) => !warningResolved(w, state));
                const flagged = attention.has(r.docId);
                const viewer = sortDoc ? viewerPages(batch, sortDoc.pageIds, local) : [];
                const idPrefix = `cap-${r.docId}`;
                return (
                  <li key={r.docId}>
                    <section
                      id={`cap-sec-${r.docId}`}
                      role="region"
                      aria-label={meta.label}
                      data-doc-id={r.docId}
                      data-type={type}
                      className="relative scroll-mt-3 overflow-hidden rounded-2xl border bg-card shadow-sm"
                    >
                      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", GROUP_BAR[meta.group])} />
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => setExpanded((prev) => {
                          const n = new Set(prev);
                          if (n.has(r.docId)) n.delete(r.docId);
                          else n.add(r.docId);
                          return n;
                        })}
                        className="flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 py-2.5 pl-3.5 pr-3 text-left sm:flex-nowrap"
                      >
                        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")} />
                        <TypeChip docType={type} label={sectionTitle(r, st2, sortDoc)} className="min-w-0 max-w-[calc(100%-4rem)] sm:max-w-full" />
                        {r.kind === "business" && r.primary && <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-500" aria-label="primární doklad" />}
                        {/* mobil: kam se doklad uloží jako druhý řádek pod chipem */}
                        <span className={cn("ml-auto flex shrink-0 items-center gap-1 text-xs sm:order-none", isLocked ? "text-emerald-700 dark:text-emerald-400" : flagged ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
                          {isLocked ? <CheckCircle2 className="h-3.5 w-3.5" /> : flagged ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
                          <span className="hidden sm:inline">{isLocked ? "uloženo" : statusText(r, st2, st.job.items.length)}</span>
                        </span>
                        <span className="block w-full pl-6 text-[11px] text-muted-foreground sm:hidden">{isLocked ? "uloženo" : statusText(r, st2, st.job.items.length)}</span>
                      </button>
                      {open && st2 && (
                        <div className="border-t px-3 pb-3 pt-2.5 sm:px-4">
                          {warn.length > 0 && (
                            <ul className="mb-3 space-y-1.5">
                              {warn.map((w) => (
                                <li key={w.id} className={cn("rounded-xl border p-2.5 text-xs", w.severity === "info" ? "border-sky-200 bg-sky-50 dark:border-sky-500/30 dark:bg-sky-500/10" : "border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10")}>
                                  <p className="flex items-start gap-1.5">
                                    {w.severity === "info" ? <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />}
                                    {w.message}
                                  </p>
                                  {w.actions.length > 0 && !isLocked && (
                                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                                      {w.actions.map((a, n) => (
                                        <Button key={n} type="button" size="sm" variant={n === 0 ? "default" : "outline"} className="h-8" onClick={() => onAction(w, a)}>{a.label}</Button>
                                      ))}
                                    </div>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                          <div className="lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-4">
                            <div className={cn("mb-3 lg:mb-0", hidePreview.has(r.docId) && "hidden lg:block")}>
                              <CapturePages pages={viewer} className="h-[40vh] lg:h-[52vh]" />
                            </div>
                            <fieldset disabled={isLocked} className="min-w-0">
                              <button
                                type="button"
                                onClick={() => setHidePreview((prev) => {
                                  const n = new Set(prev);
                                  if (n.has(r.docId)) n.delete(r.docId);
                                  else n.add(r.docId);
                                  return n;
                                })}
                                className="mb-2 inline-flex min-h-9 items-center gap-1.5 rounded-full px-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground lg:hidden"
                              >
                                {hidePreview.has(r.docId) ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                                {hidePreview.has(r.docId) ? "Ukázat fotku" : "Skrýt fotku"}
                              </button>
                              {r.kind === "business" && st2.kind === "business" && (
                                <CaptureDocForm
                                  doc={r}
                                  state={st2.state}
                                  onChange={(s) => setDoc(r.docId, { kind: "business", state: s })}
                                  margins={review.margins}
                                  options={review.options}
                                  idPrefix={idPrefix}
                                  groupItems={st.job.items}
                                  onToggleRow={(row, on) => toggleRow(g.key, row, on)}
                                  onChangeType={() => onChangeType(r.docId)}
                                  disabled={isLocked}
                                />
                              )}
                              {r.kind === "drawing" && st2.kind === "drawing" && (
                                <CaptureDrawingForm
                                  doc={r}
                                  state={st2.state}
                                  onChange={(s) => setDoc(r.docId, { kind: "drawing", state: s })}
                                  itemOptions={itemOptions}
                                  drawingsAccess={review.drawingsAccess}
                                  idPrefix={idPrefix}
                                  disabled={isLocked}
                                />
                              )}
                              {r.kind === "model" && st2.kind === "model" && (
                                <CaptureModelForm
                                  doc={r}
                                  state={st2.state}
                                  onChange={(s) => setDoc(r.docId, { kind: "model", state: s })}
                                  itemOptions={itemOptions}
                                  idPrefix={idPrefix}
                                  disabled={isLocked}
                                />
                              )}
                              {r.kind === "file" && st2.kind === "file" && (
                                <CaptureFileForm
                                  state={st2.state}
                                  onChange={(s) => setDoc(r.docId, { kind: "file", state: s })}
                                  idPrefix={idPrefix}
                                  disabled={isLocked}
                                />
                              )}
                              {!isLocked && (
                                <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-2.5">
                                  <label htmlFor={`${idPrefix}-group`} className="text-xs font-medium text-muted-foreground">Patří k…</label>
                                  <NativeSelect
                                    id={`${idPrefix}-group`}
                                    value={g.key}
                                    onChange={(e) => onAssign(r.docId, e.target.value)}
                                    className="h-8 w-auto min-w-[12rem] text-xs"
                                  >
                                    {review.groups.map((x, n) => (
                                      <option key={x.key} value={x.key}>Zakázka {n + 1}{x.label ? ` · ${x.label}` : ""}</option>
                                    ))}
                                    <option value="new">Nová zakázka</option>
                                  </NativeSelect>
                                </div>
                              )}
                            </fieldset>
                          </div>
                        </div>
                      )}
                    </section>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      {review.docs.length === 0 && (
        <p className={cn("rounded-xl p-3 text-sm", TONES.slate)}>Všechny doklady jsou vyřazené — vrať se do roztřídění.</p>
      )}
    </div>
  );
}
