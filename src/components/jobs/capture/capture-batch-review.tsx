"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Combine, Eye, EyeOff, Info, PenLine, Sparkles, Star, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/jobs/book/native-select";
import { GROUP_BAR, TONES, TypeChip, WarningRow } from "@/components/jobs/capture/capture-parts";
import { CapturePages } from "@/components/jobs/capture/capture-pages";
import { CaptureGroupHeader } from "@/components/jobs/capture/capture-group-header";
import { CaptureDocForm } from "@/components/jobs/capture/capture-doc-form";
import { CaptureDrawingForm } from "@/components/jobs/capture/capture-drawing-form";
import { CaptureModelForm } from "@/components/jobs/capture/capture-model-form";
import { CaptureFileForm } from "@/components/jobs/capture/capture-file-form";
import { CaptureSupplierInvoices } from "@/components/jobs/capture/capture-supplier-invoices";
import { viewerPages, type LocalUrls } from "@/components/jobs/capture/capture-sort";
import {
  duplicateInTarget, jobsGenitive, mergeAllPlan, relinkGroupDocs, saveCountInfo, warningResolved, withAck, type BatchProblem,
} from "@/components/jobs/capture/capture-flow";
import { BATCH_TYPES } from "@/lib/jobs/capture-batch";
import { initialSpecState, missingHardness, recomputeSpecEstimate } from "@/lib/jobs/drawing-spec";
import { formatIsoDate } from "@/lib/jobs/field-labels";
import type { ReviewItem } from "@/lib/jobs/capture-review";
import type {
  BatchApplyState, BatchDocDraft, BatchDocReview, BatchDocType, BatchGroupState, BatchReviewModel, BatchSortModel, BatchWarning,
  BatchWarningAction, DocApplyState, DrawingReviewState, ModelReviewState,
} from "@/lib/jobs/capture-batch-types";
import { cn } from "@/lib/utils";

/** Řádek Položek založený z karty výkresu / modelu (klíč draw-<docId> / model-<docId>). */
const ROW_OF_DOC_RE = /^(draw|model)-(.+)$/;
type CardState = DrawingReviewState | ModelReviewState;
/** Pole karty ↔ pole řádku položky (název ↔ title). */
const SYNC: [keyof ReviewItem, "drawingNumber" | "revision" | "title" | "material" | "quantity"][] = [
  ["drawingNumber", "drawingNumber"], ["revision", "revision"], ["name", "title"], ["material", "material"], ["quantity", "quantity"],
];
function cardField(st: CardState, f: (typeof SYNC)[number][1]): string | null {
  return f in st ? String((st as unknown as Record<string, unknown>)[f] ?? "") : null;
}

/** Změna na kartě výkresu / modelu → stejná pole řádku Položek (jen to, co se na kartě změnilo). */
function rowFromCard(row: ReviewItem, st: CardState, before: CardState | null): ReviewItem {
  let next = row;
  for (const [rf, cf] of SYNC) {
    const v = cardField(st, cf);
    if (v === null) continue;
    const was = before ? cardField(before, cf) : null;
    if (was !== null && was === v) continue;
    if (next[rf] === v) continue;
    next = { ...next, [rf]: v };
  }
  return next;
}

/** Změna řádku Položek → karta výkresu / modelu (jen změněná pole; u výkresu přepočet odhadu polotovaru). */
function cardFromRow(d: DocApplyState, row: ReviewItem, was: ReviewItem | undefined, doc: BatchDocReview | undefined): DocApplyState {
  if (d.kind !== "drawing" && d.kind !== "model") return d;
  const patch: Record<string, string> = {};
  for (const [rf, cf] of SYNC) {
    const v = String(row[rf] ?? "");
    if (was && String(was[rf] ?? "") === v) continue;
    const cur = cardField(d.state, cf);
    if (cur === null || cur === v) continue;
    patch[cf] = v;
  }
  if (!Object.keys(patch).length) return d;
  if (d.kind === "model") return { kind: "model", state: { ...d.state, ...patch } as ModelReviewState };
  const state: DrawingReviewState = { ...d.state, ...patch };
  if (doc?.kind === "drawing" && ("material" in patch || "title" in patch || "quantity" in patch)) {
    const sp = state.spec ?? doc.initial.spec ?? initialSpecState(doc.drawing, { aiUsed: doc.aiUsed, title: doc.initial.title, quantity: doc.initial.quantity });
    state.spec = recomputeSpecEstimate(sp, {
      material: state.material, dimensions: state.dimensions, title: state.title, quantity: state.quantity,
      overallDims: doc.drawing.overallDims, shapeHint: doc.drawing.shapeHint, blankDimensions: doc.drawing.blankDimensions,
    });
  }
  return { kind: "drawing", state };
}

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
  /** Doklady, které se při minulém uložení neuložily: docId → důvod (u karty s nápravou). */
  failed?: Record<string, string>;
  /** Skupina, pro kterou se načítá jiná zakázka. */
  picking: string | null;
  onChange: (state: BatchApplyState) => void;
  onPickJob: (groupKey: string, jobId: string) => void;
  onAssign: (docId: string, groupKey: string) => void;
  onAction: (w: BatchWarning, a: BatchWarningAction) => void;
  onChangeType: (docId: string) => void;
  /** „Sloučit do jedné zakázky" (víc skupin). */
  onMergeAll?: () => void;
  /** Kontrola se přepočítává (tlačítka akcí čekají). */
  busy?: boolean;
  /** Skok na problém (z hlášky nad „Uložit vše"). */
  jumpRef?: React.MutableRefObject<((p: Pick<BatchProblem, "groupKey" | "docId">) => void) | null>;
}

/** Skupina potřebuje pohled (bez zakázky / nevyřešené blokující upozornění) — „Další ⚠". */
function groupNeedsAttention(groupKey: string, review: BatchReviewModel, state: BatchApplyState): boolean {
  const g = state.groups.find((x) => x.key === groupKey);
  if (!g) return false;
  if (!g.job.targetKey) return true;
  return review.warnings.some((w) => w.groupKey === groupKey && w.severity === "block" && !warningResolved(w, state, review));
}

function groupElement(key: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-testid="capture-group"][data-group-key="${CSS.escape(key)}"]`);
}

function docTypeOf(review: BatchDocReview, sortDoc: BatchDocDraft | undefined): BatchDocType {
  return review.kind === "business" ? review.type : sortDoc?.type ?? (review.kind === "drawing" ? "vykres" : review.kind === "model" ? "model_3d" : "ostatni");
}

/** Výkres: AI si není jistá (nízká jistota, poznámky „potvrdit") a člověk to ještě nepotvrdil. */
export function drawingUnconfirmed(r: Extract<BatchDocReview, { kind: "drawing" }>, state: BatchApplyState): boolean {
  const ack = new Set(state.ack ?? []);
  if (ack.has(`checked:${r.docId}`)) return false;
  const notesOpen = r.drawing.needsClarification.some((_, i) => !ack.has(`note:${r.docId}:${i}`));
  if (r.drawing.needsClarification.length) return notesOpen;
  return !r.aiUsed || r.drawing.confidence < 0.85;
}

/** Sekce potřebuje pohled člověka (rozbalit automaticky, „Další ⚠"). */
function needsAttention(r: BatchDocReview, review: BatchReviewModel, state: BatchApplyState, failed?: Record<string, string>): boolean {
  if (failed?.[r.docId]) return true;
  if (cardWarnings(review, r.docId).some((w) => w.severity !== "info" && !warningResolved(w, state, review))) return true;
  if (r.kind === "business") return !r.aiUsed || (r.confidence !== null && r.confidence < 0.85) || r.needsClarification.length > 0 || Boolean(r.duplicateOf);
  if (r.kind === "drawing") {
    // „Nezjištěno — doplň" u tepelného zpracování / povrchové úpravy → rozbalit
    // … a kalení / cementace bez tvrdosti („kolik je tam kalení")
    const unknown = r.initial.spec?.heatStatus === "nezjisteno" || r.initial.spec?.surfaceStatus === "nezjisteno"
      || missingHardness(r.initial.spec?.heatSteps ?? []);
    // výkres u JINÉ zakázky / v archivu u jiného zákazníka = jen informace (uloží se); u cílové zakázky = volba
    return drawingUnconfirmed(r, state) || Boolean(duplicateInTarget(review, state, r.docId)) || unknown;
  }
  if (r.kind === "model") return Boolean(duplicateInTarget(review, state, r.docId));
  return false;
}

/** Upozornění u karty dokladu: doklad je jmenovaný a upozornění se týká jen dokladů (ne údajů zakázky). */
function cardWarnings(review: BatchReviewModel, docId: string): BatchWarning[] {
  return review.warnings.filter((w) => w.docIds.includes(docId) && (!w.groupKey || CARD_CODES.has(w.code)));
}
/** Upozornění, která patří ke kartě výkresu / modelu (rozhodnutí přímo u výkresu). */
const CARD_CODES = new Set<BatchWarning["code"]>([
  "material_conflict", "quantity_conflict", "drawing_item_shared", "also_in_job", "already_saved", "drawing_archive_conflict",
  "unlinked_drawing", "unlinked_model", "revision_conflict", "drawing_quantity_missing", "duplicate_doc",
]);


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

function statusText(r: BatchDocReview, st: DocApplyState | undefined, groupItems: number, rows: ReviewItem[] = []): string {
  const rowNo = (l: { mode: string; itemKey?: string }) => (l.mode === "docItem" ? rows.find((i) => i.key === l.itemKey)?.drawingNumber ?? "" : "");
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
    const no = rowNo(st.state.link);
    const link = st.state.link.mode === "add" ? "nová položka" : st.state.link.mode === "none" ? "bez položky" : no ? `→ položka ${no}` : "→ položka";
    return `${link}${st.state.archive ? " · do archivu" : ""}`;
  }
  if (r.kind === "model" && st?.kind === "model") return st.state.link.mode === "none" ? "bez položky" : st.state.link.mode === "add" ? "nová položka" : "→ položka";
  return "přiloží se";
}

/** Na první pohled: kolik zakázek se uloží (a proč víc než jedna) + „Sloučit do jedné zakázky". */
function SaveCountBanner({ review, state, locked, busy, onMergeAll }: {
  review: BatchReviewModel; state: BatchApplyState; locked: Set<string>; busy?: boolean; onMergeAll?: () => void;
}) {
  const info = saveCountInfo(review, state);
  if (info.count === 0) return null;
  const canMerge = Boolean(onMergeAll) && mergeAllPlan(review, state, locked) !== null;
  if (info.count === 1) {
    return (
      <p data-testid="capture-save-count" data-count={1} className={cn("flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium", TONES.emerald)}>
        <CheckCircle2 className="h-4 w-4 shrink-0" /> Uloží se do 1 zakázky
      </p>
    );
  }
  return (
    <div data-testid="capture-save-count" data-count={info.count} className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
      <p className="flex items-start gap-1.5 font-semibold">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" /> Pozor: uloží se do {jobsGenitive(info.count)}
      </p>
      {info.reasons.length > 0 && (
        <ul className="mt-1 space-y-0.5 pl-6 text-xs">
          {info.reasons.map((r) => <li key={r}>proč: {r}</li>)}
        </ul>
      )}
      {canMerge && (
        <Button type="button" size="sm" variant="outline" className="mt-2 h-9 border-amber-400" disabled={busy} onClick={onMergeAll} data-testid="capture-merge-all">
          <Combine /> Sloučit do jedné zakázky
        </Button>
      )}
    </div>
  );
}

export function CaptureBatchReview({
  review, state, batch, local, locked, failed, picking, onChange, onPickJob, onAssign, onAction, onChangeType, onMergeAll, busy, jumpRef,
}: CaptureBatchReviewProps) {
  // pravidlo rozbalení se počítá z odpovědi serveru (ne při každém psaní) — klíč = seznam id
  const attentionKey = review.docs
    .filter((r) => !locked.has(r.docId) && needsAttention(r, review, state, failed))
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

  // položka ↔ karta výkresu / modelu, ze které vznikla (draw-<docId>): počet, název, číslo, revize, materiál
  // se upravují na jednom místě a platí na obou (uloží se to, co je v Položkách)
  const setGroup = (g: BatchGroupState) => {
    const prev = state.groups.find((x) => x.key === g.key);
    let docs = state.docs;
    for (const row of g.job.items) {
      const m = ROW_OF_DOC_RE.exec(row.key);
      if (m) {
        const d = docs[m[2]];
        if (!d) continue;
        const next = cardFromRow(d, row, prev?.job.items.find((i) => i.key === row.key), review.docs.find((x) => x.docId === m[2]));
        if (next !== d) docs = { ...docs, [m[2]]: next };
        continue;
      }
      // řádek z dokladu (objednávka / text e-mailu): počet kusů upravený v Položkách platí i na kartě výkresu,
      // který na řádek míří (uloží se to, co je v Položkách — karta nesmí ukazovat jiný počet)
      const was = prev?.job.items.find((i) => i.key === row.key);
      if (!was || was.quantity === row.quantity) continue;
      for (const id of g.docIds) {
        const d = docs[id];
        if (d?.kind !== "drawing" || d.state.link.mode !== "docItem" || d.state.link.itemKey !== row.key || d.state.quantity === row.quantity) continue;
        docs = { ...docs, [id]: cardFromRow(d, { ...was, quantity: row.quantity }, was, review.docs.find((x) => x.docId === id)) };
      }
    }
    let next: BatchApplyState = { ...state, groups: state.groups.map((x) => (x.key === g.key ? g : x)), docs };
    // jiný cíl skupiny → vazby výkresů znovu podle čísla (položka staré zakázky / „ai-0" jiného cíle neplatí)
    if (prev && prev.job.targetKey !== g.job.targetKey) next = relinkGroupDocs(review, next, g.key);
    onChange(next);
  };
  const setDoc = (docId: string, d: DocApplyState) => {
    let groups = state.groups;
    const prevDoc = state.docs[docId];
    if ((d.kind === "drawing" || d.kind === "model") && d.state.link.mode === "docItem" && ROW_OF_DOC_RE.test(d.state.link.itemKey)) {
      const key = d.state.link.itemKey;
      const before = prevDoc && prevDoc.kind === d.kind ? (prevDoc.state as CardState) : null;
      groups = groups.map((g) => (g.job.items.some((i) => i.key === key)
        ? { ...g, job: { ...g.job, items: g.job.items.map((i) => (i.key === key ? rowFromCard(i, d.state, before) : i)) } }
        : g));
    } else if (d.kind === "drawing" && d.state.link.mode === "docItem" && prevDoc?.kind === "drawing" && prevDoc.state.quantity !== d.state.quantity) {
      // počet na kartě výkresu → řádek Položek, na který výkres míří (jedno místo pravdy)
      const key = d.state.link.itemKey;
      groups = groups.map((g) => (g.docIds.includes(docId)
        ? { ...g, job: { ...g.job, items: g.job.items.map((i) => (i.key === key ? { ...i, quantity: d.state.quantity } : i)) } }
        : g));
    }
    onChange({ ...state, docs: { ...state.docs, [docId]: d }, groups });
  };
  const ack = (...ids: string[]) => onChange(withAck(state, ...ids));
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
  const docCount = review.docs.length + (review.supplierInvoices?.length ?? 0);

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

      <SaveCountBanner review={review} state={state} locked={locked} busy={busy} onMergeAll={onMergeAll} />

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
              warnings={review.warnings.filter((w) => w.groupKey === g.key && !(CARD_CODES.has(w.code) && w.docIds.some((id) => review.docs.some((d) => d.docId === id))))}
              review={review}
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
                // u více karet (dva výkresy) jen u první otevřené, ať se rozhodnutí neopakuje
                // „je i u zakázky" a archiv u jiného zákazníka ukazuje karta výkresu sama (s odkazem) — ne dvakrát
                const warn = cardWarnings(review, r.docId).filter((w) => !warningResolved(w, state, review)
                  && w.code !== "also_in_job" && !(r.kind === "drawing" && w.code === "drawing_archive_conflict")
                  && (w.code !== "drawing_item_shared" || w.actions.find((a) => a.docId)?.docId === r.docId || !w.actions.some((a) => a.docId)));
                const failedMsg = !isLocked ? failed?.[r.docId] : undefined;
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
                          <span className="hidden sm:inline">{isLocked ? "uloženo" : failedMsg ? "neuložilo se — oprav" : statusText(r, st2, st.job.items.length, st.job.items)}</span>
                        </span>
                        <span className="block w-full pl-6 text-[11px] text-muted-foreground sm:hidden">{isLocked ? "uloženo" : failedMsg ? "neuložilo se — oprav" : statusText(r, st2, st.job.items.length, st.job.items)}</span>
                      </button>
                      {open && st2 && (
                        <div className="border-t px-3 pb-3 pt-2.5 sm:px-4">
                          {failedMsg && (
                            <div data-testid="capture-doc-failed" className="mb-3 rounded-xl border border-red-200 bg-red-50 p-2.5 text-xs text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-100">
                              <p className="flex items-start gap-1.5 font-medium"><XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Neuložilo se: {failedMsg}</p>
                              <p className="mt-1">Oprav níže (např. „Patří k položce“) a dej <b>Uložit zbývající</b> — uložené doklady zůstanou.</p>
                              {(st2.kind === "drawing" || st2.kind === "model") && (
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                  <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => setDoc(r.docId, { ...st2, state: { ...st2.state, link: { mode: "none" } } } as DocApplyState)}>
                                    Uložit bez vazby na položku
                                  </Button>
                                </div>
                              )}
                            </div>
                          )}
                          {warn.length > 0 && (
                            <ul className="mb-3 space-y-1.5">
                              {warn.map((w) => (
                                <WarningRow key={w.id} w={w} disabled={isLocked} onAction={onAction} />
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
                                  duplicateInTarget={Boolean(duplicateInTarget(review, state, r.docId))}
                                  acked={state.ack ?? []}
                                  onAck={ack}
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
                                  duplicateInTarget={Boolean(duplicateInTarget(review, state, r.docId))}
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

      <CaptureSupplierInvoices review={review} batch={batch} local={local} />

      {review.docs.length === 0 && !review.supplierInvoices?.length && (
        <p className={cn("rounded-xl p-3 text-sm", TONES.slate)}>Všechny doklady jsou vyřazené — vrať se do roztřídění.</p>
      )}
    </div>
  );
}
