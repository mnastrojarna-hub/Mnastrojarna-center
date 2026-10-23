"use client";

import * as React from "react";
import {
  AlertTriangle, ArrowLeft, ArrowLeftRight, ArrowRight, Box, Check, ChevronDown, CircleDashed, Combine, Ellipsis, Eye,
  FileText, Loader2, Merge, Paperclip, PenLine, Plus, RotateCcw, Sparkles, Split, Trash2, Undo2, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GROUP_BAR, GROUP_TONE, Sheet, SideBadge, TONES, TypeChip } from "@/components/jobs/capture/capture-parts";
import { CapturePages, type ViewerPage } from "@/components/jobs/capture/capture-pages";
import {
  allowedTypes, excludeDoc, excludePage, isFileDoc, isLockedPage, mergeDocs, movePage, movePageWithin, previousDoc,
  restoreDoc, restorePage, setDocType, splitPage, swapIssuer, eachFileSeparately, mergeAll,
} from "@/components/jobs/capture/batch-sort";
import { usePdfThumb } from "@/components/jobs/capture/pdf-thumbs";
import { BATCH_TYPES } from "@/lib/jobs/capture-batch";
import { CHIP_GROUPS, type ChipGroup } from "@/lib/jobs/capture-review";
import { FILE_KINDS } from "@/lib/jobs/file-kinds";
import type {
  BatchDocDraft, BatchDocType, BatchPage, BatchSort, BatchSortModel, BatchWarning, BatchWarningAction, DocExtractStatus,
} from "@/lib/jobs/capture-batch-types";
import { cn } from "@/lib/utils";

/**
 * Krok Roztřídění: 1 karta = 1 doklad. Chip = druh (barva druhu souboru), pruh = strana
 * (zákazník / my / dodavatel). Opravy max. 2 ťuknutí: chip → druh, ⇄ → vystavitel,
 * miniatura → přesun / oddělení stránky, ⋯ → sloučit / vyřadit.
 */

export type SortDocStatus = "queued" | DocExtractStatus | "none";

export const LOW_CONFIDENCE = 0.85;

/** Lokální náhledy (object URL) podle cesty nahraného souboru. */
export type LocalUrls = Map<string, string | null>;

interface PageView {
  page: BatchPage;
  index: number;
  filename: string;
  mimeType: string;
  format: string | null;
  pageCount: number;
  /** Obrázek: místní náhled / náhled 1280 px / originál. PDF: soubor. */
  url: string | null;
  fullUrl: string | null;
}

function pageView(batch: BatchSortModel, pageId: string, local: LocalUrls): PageView | null {
  const index = batch.pages.findIndex((p) => p.id === pageId);
  const page = batch.pages[index];
  if (!page) return null;
  const file = batch.files.find((f) => f.id === page.fileId);
  const prev = batch.previews.find((p) => p.fileId === page.fileId);
  const localUrl = file ? local.get(file.path) ?? null : null;
  const url = page.source === "image"
    ? localUrl ?? prev?.sortUrl ?? prev?.url ?? null
    : page.source === "pdf_page" ? localUrl ?? prev?.url ?? null : null;
  return {
    page, index,
    filename: file?.filename ?? prev?.filename ?? page.label,
    mimeType: file?.mimeType ?? prev?.mimeType ?? "",
    format: file?.format ?? prev?.format ?? null,
    pageCount: file?.pageCount ?? prev?.pageCount ?? 1,
    url,
    fullUrl: page.source === "image" ? localUrl ?? prev?.url ?? prev?.sortUrl ?? null : localUrl ?? prev?.url ?? null,
  };
}

/** „Stránka 3 (nabidka.pdf, str. 2/4)" */
export function pageTitle(v: Pick<PageView, "index" | "filename" | "page" | "pageCount">): string {
  const where = v.page.source === "pdf_page" ? `${v.filename}, str. ${v.page.page}/${v.pageCount}` : v.filename;
  return `Stránka ${v.index + 1} (${where})`;
}

/**
 * Krátký popis dokladu do tlačítek („Objednávka zákazníka PO-4471"); bez čísla dokladu číslo výkresu,
 * formát, strana nebo první stránka („Výkres · S3"), aby šlo doklady v seznamech rozlišit.
 */
export function docLabel(doc: BatchDocDraft, pages?: Pick<BatchPage, "id">[]): string {
  const label = BATCH_TYPES[doc.type].label;
  if (doc.documentNumber) return `${label} ${doc.documentNumber}`;
  const first = pages ? pages.findIndex((p) => p.id === doc.pageIds[0]) : -1;
  const extra = doc.drawingNumbers[0] || doc.format || doc.partyName || (first >= 0 ? `S${first + 1}` : "");
  return extra ? `${label} · ${extra}` : label;
}

/** Viewer stránky (pro CapturePages). */
export function viewerPages(batch: BatchSortModel, pageIds: string[], local: LocalUrls): ViewerPage[] {
  const out: ViewerPage[] = [];
  for (const id of pageIds) {
    const v = pageView(batch, id, local);
    if (!v) continue;
    out.push({
      key: v.page.id,
      url: v.fullUrl,
      mimeType: v.page.source === "file" ? "application/octet-stream" : v.mimeType,
      name: v.page.source === "pdf_page" ? `${v.filename} · str. ${v.page.page}/${v.pageCount}` : v.filename,
      page: v.page.source === "pdf_page" ? v.page.page : undefined,
      file: v.page.source === "file" ? { format: v.format, cad: Boolean(v.format) } : null,
    });
  }
  return out;
}

// ── Miniatura ───────────────────────────────────────────────
function Thumb({ view, big, onClick, label }: { view: PageView; big: boolean; onClick?: () => void; label: string }) {
  const pdf = usePdfThumb(view.page.source === "pdf_page" ? view.url : null, view.page.page);
  const size = big ? "h-[128px] w-24" : "h-[76px] w-14";
  const text = view.page.aiLabel || view.page.label;
  let body: React.ReactNode;
  if (view.page.source === "file") {
    const cad = Boolean(view.format);
    const fk = FILE_KINDS[view.format === "DXF" || view.format === "DWG" ? "vykres" : cad ? "model_3d" : "ostatni"];
    const Icon = cad ? fk.icon : Paperclip;
    body = (
      <span className={cn("flex h-full w-full flex-col items-center justify-center gap-1 p-1 text-center", fk.badge)}>
        <Icon className={big ? "h-7 w-7" : "h-5 w-5"} />
        <span className="max-w-full truncate text-[9px] font-bold uppercase">{view.format ?? (/\.([a-z0-9]{1,6})$/i.exec(view.filename)?.[1] ?? "soubor")}</span>
      </span>
    );
  } else if (view.page.source === "image" && view.url) {
    // eslint-disable-next-line @next/next/no-img-element -- místní náhled / podepsaná URL
    body = <img src={view.url} alt="" className="h-full w-full object-cover" loading="lazy" />;
  } else if (view.page.source === "pdf_page" && pdf.src) {
    // eslint-disable-next-line @next/next/no-img-element -- vykreslená strana PDF
    body = <img src={pdf.src} alt="" className="h-full w-full bg-white object-contain" />;
  } else {
    body = (
      <span className="flex h-full w-full flex-col items-center justify-center gap-1 bg-white p-1 text-center dark:bg-slate-900">
        {view.page.source === "pdf_page" && !pdf.failed ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : <FileText className="h-5 w-5 text-red-500" />}
        <span className="line-clamp-3 text-[9px] leading-tight text-muted-foreground">{text}</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={text}
      className={cn("relative shrink-0 overflow-hidden rounded-lg border bg-muted shadow-sm transition hover:ring-2 hover:ring-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", size)}
    >
      {body}
      <span className="absolute bottom-0 right-0 rounded-tl bg-black/60 px-1 text-[9px] font-semibold tabular-nums text-white">S{view.index + 1}</span>
    </button>
  );
}

// ── Výběr druhu ─────────────────────────────────────────────
const GROUP_ORDER: ChipGroup[] = ["zakaznik", "my", "dodavatel", "ostatni"];

/** Chipy druhů po skupinách (Od zákazníka / Od nás / Od dodavatele / Ostatní). */
export function TypePicker({
  value, allowed, onPick,
}: { value: BatchDocType | null; allowed: BatchDocType[]; onPick: (t: BatchDocType) => void }) {
  return (
    <div className="space-y-3">
      {GROUP_ORDER.map((g) => {
        const types = allowed.filter((t) => BATCH_TYPES[t].group === g);
        if (!types.length) return null;
        return (
          <div key={g}>
            <p className={cn("mb-1.5 text-[11px] font-semibold uppercase tracking-wide", GROUP_TONE[g])}>
              {CHIP_GROUPS.find((x) => x.key === g)?.label}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {types.map((t) => {
                const fk = FILE_KINDS[BATCH_TYPES[t].fileKind];
                const Icon = fk.icon;
                const on = t === value;
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onPick(t)}
                    className={cn(
                      "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                      on ? cn(fk.badge, "border-transparent ring-2 ring-foreground/20") : "bg-background hover:bg-accent",
                    )}
                  >
                    {on ? <Check className="h-3.5 w-3.5" /> : <Icon className={cn("h-3.5 w-3.5", fk.text)} />}
                    {BATCH_TYPES[t].label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Stav vytěžení ───────────────────────────────────────────
function StatusLine({ status, error, onRetry }: { status: SortDocStatus; error: string | null; onRetry: () => void }) {
  if (status === "none") return null;
  if (status === "queued" || status === "reading") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-fuchsia-700 dark:text-fuchsia-300">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> {status === "queued" ? "čeká na čtení…" : "čtu údaje…"}
      </p>
    );
  }
  if (status === "ready") {
    return <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400"><Check className="h-3.5 w-3.5" /> přečteno</p>;
  }
  if (status === "manual") {
    return <p className="flex items-center gap-1.5 text-xs text-sky-700 dark:text-sky-300"><PenLine className="h-3.5 w-3.5" /> vyplníš ručně{error ? ` — ${error}` : ""}</p>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-red-700 dark:text-red-400">
      <AlertTriangle className="h-3.5 w-3.5" /> nepřečteno{error ? ` — ${error}` : ""}
      <Button type="button" size="sm" variant="outline" onClick={onRetry} className="h-9 text-red-700 dark:text-red-400">
        <RotateCcw className="h-3 w-3" /> Zkusit znovu
      </Button>
    </div>
  );
}

// ── Karta dokladu ───────────────────────────────────────────
function DocCard({
  batch, doc, sort, local, status, error, highlight, onChange, onPage, onType, onMergeWith, onView, onRetry,
}: {
  batch: BatchSortModel;
  doc: BatchDocDraft;
  sort: BatchSort;
  local: LocalUrls;
  status: SortDocStatus;
  error: string | null;
  /** Doklad má otevřené upozornění „Ke kontrole". */
  highlight?: boolean;
  onChange: (s: BatchSort) => void;
  onPage: (pageId: string) => void;
  onType: (docId: string) => void;
  onMergeWith: (docId: string) => void;
  onView: (pageIds: string[], title: string) => void;
  onRetry: (docId: string) => void;
}) {
  const meta = BATCH_TYPES[doc.type];
  const views = doc.pageIds.map((id) => pageView(batch, id, local)).filter((v): v is PageView => Boolean(v));
  const prev = previousDoc(sort, doc.id);
  const fileDoc = isFileDoc(doc, batch.pages);
  const canMergePrev = Boolean(prev && !fileDoc && !isFileDoc(prev, batch.pages));
  const others = sort.docs.filter((d) => d.id !== doc.id && !d.excluded && !isFileDoc(d, batch.pages));
  const subtitle = [doc.documentNumber, doc.partyName].filter(Boolean).join(" · ") || (doc.title && doc.title !== meta.label ? doc.title : "");
  const lowConfidence = doc.confidence !== null && doc.confidence < LOW_CONFIDENCE && doc.aiType !== null;
  const swap = meta.swap && meta.swapLabel ? meta.swapLabel : null;
  const mismatch = doc.issuerCheck === "mismatch";

  return (
    <li
      data-testid="capture-sort-doc"
      data-doc-id={doc.id}
      data-type={doc.type}
      data-status={doc.excluded ? "excluded" : status}
      data-group={meta.group}
      aria-label={`${meta.label}${doc.documentNumber ? ` ${doc.documentNumber}` : ""}`}
      className={cn(
        "relative overflow-hidden rounded-2xl border bg-card p-3 pl-4 shadow-sm transition",
        doc.excluded && "opacity-55 grayscale",
        (mismatch || highlight) && !doc.excluded && "ring-2 ring-amber-400/70",
      )}
    >
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1.5", GROUP_BAR[meta.group])} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <SideBadge group={meta.group} docType={doc.type} />
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <TypeChip
              as="button"
              docType={doc.type}
              aria-label={`${meta.label} — změnit druh dokladu`}
              title="Změnit druh dokladu"
              disabled={doc.excluded}
              onClick={() => onType(doc.id)}
              className="min-h-9 max-w-full"
            />
            {doc.format && <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", TONES.violet)}>{doc.format}</span>}
            {subtitle && <span className="min-w-0 truncate text-sm font-medium">{subtitle}</span>}
          </div>
        </div>
        {doc.excluded ? (
          <Button type="button" size="sm" variant="outline" onClick={() => onChange(restoreDoc(sort, doc.id))} aria-label="Vrátit doklad">
            <Undo2 /> Vrátit
          </Button>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" aria-label="Akce dokladu" className="h-10 w-10 shrink-0">
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem disabled={!canMergePrev} onSelect={() => prev && onChange(mergeDocs(sort, prev.id, doc.id))} aria-label="Sloučit s předchozím">
                <Merge /> Sloučit s předchozím
              </DropdownMenuItem>
              <DropdownMenuItem disabled={fileDoc || others.length === 0} onSelect={() => onMergeWith(doc.id)}>
                <Combine /> Sloučit s…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onView(doc.pageIds, docLabel(doc, batch.pages))}>
                <Eye /> Zobrazit vše
              </DropdownMenuItem>
              {status === "error" && (
                <DropdownMenuItem onSelect={() => onRetry(doc.id)}>
                  <RotateCcw /> Přečíst znovu
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onChange(excludeDoc(sort, doc.id))} aria-label="Vyřadit doklad" className="text-red-700 focus:text-red-700 dark:text-red-400">
                <Trash2 /> Vyřadit doklad
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="mt-2.5 flex items-end gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
        {views.map((v, i) => (
          <Thumb
            key={v.page.id}
            view={v}
            big={i === 0}
            label={`${pageTitle(v)} — akce stránky`}
            onClick={doc.excluded ? undefined : () => onPage(v.page.id)}
          />
        ))}
      </div>

      {doc.excluded ? (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground"><XCircle className="h-3.5 w-3.5" /> Vyřazeno — nic se neuloží, stránky se smažou.</p>
      ) : (
        <div className="mt-1.5 space-y-1">
          <StatusLine status={status} error={error} onRetry={() => onRetry(doc.id)} />
          {lowConfidence && (
            <p className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
              <span>{Math.round((doc.confidence ?? 0) * 100)} %{doc.reason ? ` · „${doc.reason}“` : ""}</span>
            </p>
          )}
          {mismatch && (
            <p className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
              IČO vystavitele nesedí na druh dokladu — zkontroluj, kdo doklad vystavil.
            </p>
          )}
          {swap && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`${swap} (prohodit vystavitele)`}
              onClick={() => onChange(swapIssuer(sort, doc.id))}
              className="mt-1 h-9 max-w-full justify-start whitespace-normal text-left"
            >
              <ArrowLeftRight className="text-muted-foreground" /> <span>{swap}</span>
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

// ── Upozornění ──────────────────────────────────────────────
function warningDone(w: BatchWarning, sort: BatchSort): boolean {
  if (!w.actions.length) return false;
  const a = w.actions[0];
  if (a.kind === "exclude_doc" && a.docId) return Boolean(sort.docs.find((d) => d.id === a.docId)?.excluded);
  if (a.kind === "restore_page" && a.pageId) return !sort.excludedPageIds.includes(a.pageId);
  if (a.kind === "set_type" && a.docId && a.type) return sort.docs.find((d) => d.id === a.docId)?.type === a.type;
  return false;
}

/** Akce upozornění, které jdou udělat už v Roztřídění. */
export function sortActionApplies(a: BatchWarningAction): boolean {
  return a.kind === "exclude_doc" || a.kind === "restore_page" || a.kind === "set_type";
}

export function applySortAction(sort: BatchSort, a: BatchWarningAction, pages: BatchPage[]): BatchSort {
  if (a.kind === "exclude_doc" && a.docId) return excludeDoc(sort, a.docId);
  if (a.kind === "restore_page" && a.pageId) return restorePage(sort, a.pageId, pages);
  if (a.kind === "set_type" && a.docId && a.type) return setDocType(sort, a.docId, a.type);
  return sort;
}

/** Upozornění roztřídění, která ještě platí. */
export function openSortWarnings(warnings: BatchWarning[], sort: BatchSort): BatchWarning[] {
  return warnings.filter((w) => !warningDone(w, sort));
}

/** Doskrolovat na kartu dokladu (z upozornění „Ukázat"). */
function showDoc(docId: string) {
  const el = document.querySelector<HTMLElement>(`[data-testid="capture-sort-doc"][data-doc-id="${CSS.escape(docId)}"]`);
  el?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function Warnings({
  warnings, sort, pages, onChange, disabled,
}: { warnings: BatchWarning[]; sort: BatchSort; pages: BatchPage[]; onChange: (s: BatchSort) => void; disabled: boolean }) {
  const [open, setOpen] = React.useState(true);
  const shown = openSortWarnings(warnings, sort);
  if (!shown.length) return null;
  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
      <button type="button" onClick={() => setOpen((x) => !x)} aria-expanded={open} className="flex w-full items-center gap-2 text-left font-semibold">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
        <span className="flex-1">Ke kontrole ({shown.length})</span>
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ul className="mt-2 space-y-2">
          {shown.map((w) => (
            <li key={w.id} className="text-xs">
              <p>{w.message}</p>
              {(w.actions.some(sortActionApplies) || w.docIds.length > 0) && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {w.actions.filter(sortActionApplies).map((a, i) => (
                    <Button key={i} type="button" size="sm" variant={i === 0 ? "default" : "outline"} className="h-9" disabled={disabled} onClick={() => onChange(applySortAction(sort, a, pages))}>
                      {a.label}
                    </Button>
                  ))}
                  {w.docIds.length > 0 && (
                    <Button type="button" size="sm" variant="ghost" className="h-9" onClick={() => showDoc(w.docIds[0])}>
                      <Eye /> Ukázat
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Hlavní komponenta ───────────────────────────────────────
export interface CaptureSortProps {
  batch: BatchSortModel;
  sort: BatchSort;
  local: LocalUrls;
  statusOf: (doc: BatchDocDraft) => SortDocStatus;
  errorOf: (docId: string) => string | null;
  onChange: (sort: BatchSort) => void;
  onRetry: (docId: string) => void;
  /** Čeká se na dočtení před Kontrolou (úpravy zamčené). */
  waiting: boolean;
  waitingCount: number;
  onCancelWait: () => void;
  /** Otevřít rovnou výběr druhu tohoto dokladu („Změnit druh…" z Kontroly). */
  typeSheetFor?: string | null;
  onTypeSheetClosed?: () => void;
  /** Android „Zpět": zavřít otevřený list (true = byl otevřený). */
  closeSheetRef?: React.MutableRefObject<(() => boolean) | null>;
}

export function CaptureSort({
  batch, sort, local, statusOf, errorOf, onChange, onRetry, waiting, waitingCount, onCancelWait,
  typeSheetFor = null, onTypeSheetClosed, closeSheetRef,
}: CaptureSortProps) {
  const [pageSheet, setPageSheet] = React.useState<string | null>(null);
  const [typeSheet, setTypeSheet] = React.useState<{ docId: string } | { splitPage: string } | null>(null);
  const [mergeSheet, setMergeSheet] = React.useState<string | null>(null);
  const [viewer, setViewer] = React.useState<{ pageIds: string[]; title: string } | null>(null);

  React.useEffect(() => {
    if (typeSheetFor) setTypeSheet({ docId: typeSheetFor });
  }, [typeSheetFor]);

  const active = sort.docs.filter((d) => !d.excluded);
  const readable = active.filter((d) => statusOf(d) !== "none");
  const sheetView = pageSheet ? pageView(batch, pageSheet, local) : null;
  const sheetDoc = pageSheet ? sort.docs.find((d) => d.pageIds.includes(pageSheet)) ?? null : null;
  const sheetLocked = pageSheet ? isLockedPage(batch.pages, batch.files, pageSheet) : true;
  const typeDoc = typeSheet && "docId" in typeSheet ? sort.docs.find((d) => d.id === typeSheet.docId) ?? null : null;
  const change = (next: BatchSort) => {
    if (!waiting) onChange(next);
  };

  const closeType = () => {
    setTypeSheet(null);
    onTypeSheetClosed?.();
  };

  // „Zpět" na Androidu zavře nejdřív list, ne celé focení
  React.useEffect(() => {
    if (!closeSheetRef) return;
    closeSheetRef.current = () => {
      if (viewer) { setViewer(null); return true; }
      if (typeSheet) { setTypeSheet(null); onTypeSheetClosed?.(); return true; }
      if (mergeSheet) { setMergeSheet(null); return true; }
      if (pageSheet) { setPageSheet(null); return true; }
      return false;
    };
  });
  React.useEffect(() => () => { if (closeSheetRef) closeSheetRef.current = null; }, [closeSheetRef]);
  const flagged = new Set(openSortWarnings(batch.warnings, sort).flatMap((w) => (w.severity === "info" ? [] : w.docIds)));

  return (
    <div className="mx-auto max-w-3xl space-y-3 pb-2" data-testid="capture-sort">
      {!batch.aiUsed ? (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100">
          <p className="flex items-start gap-2 font-medium">
            <PenLine className="mt-0.5 h-4 w-4 shrink-0 text-sky-600 dark:text-sky-300" />
            Zkontroluj, co je co — u každého dokladu vyber druh. Údaje pak vyplníš vedle náhledu.
          </p>
          {batch.reason && <p className="mt-1 pl-6 text-xs opacity-80">{batch.reason}</p>}
        </div>
      ) : batch.aiFailure ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          <p className="flex items-start gap-2 font-medium">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            AI stránky neroztřídila — zkontroluj (1 soubor = 1 doklad).
          </p>
          {batch.reason && <p className="mt-1 pl-6 text-xs opacity-80">{batch.reason}</p>}
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Sparkles className="h-4 w-4 shrink-0 text-fuchsia-500" />
          AI roztřídila {batch.pages.length === 1 ? "1 stránku" : `${batch.pages.length} ${batch.pages.length < 5 ? "stránky" : "stránek"}`} na {active.length === 1 ? "1 doklad" : `${active.length} ${active.length < 5 ? "doklady" : "dokladů"}`}. Oprav jen to, co nesedí.
        </p>
      )}

      {readable.length > 0 && (
        <p role="status" className="sr-only">Přečteno {readable.filter((d) => ["ready", "manual"].includes(statusOf(d))).length} z {readable.length}</p>
      )}
      <Warnings warnings={batch.warnings} sort={sort} pages={batch.pages} onChange={change} disabled={waiting} />

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={waiting} onClick={() => change(eachFileSeparately(sort, batch.pages, batch.files))}>
          <Split /> Každá fotka zvlášť
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={waiting || active.length < 2} onClick={() => change(mergeAll(sort, batch.pages))}>
          <Combine /> Sloučit vše do jednoho
        </Button>
      </div>

      <div className="relative">
        <ol className="space-y-2.5" aria-label="Doklady v dávce">
          {sort.docs.map((d) => (
            <DocCard
              key={d.id}
              batch={batch}
              doc={d}
              sort={sort}
              local={local}
              status={statusOf(d)}
              error={errorOf(d.id)}
              highlight={flagged.has(d.id)}
              onChange={change}
              onPage={setPageSheet}
              onType={(id) => setTypeSheet({ docId: id })}
              onMergeWith={setMergeSheet}
              onView={(pageIds, title) => setViewer({ pageIds, title })}
              onRetry={onRetry}
            />
          ))}
        </ol>
        {waiting && (
          <div className="absolute inset-0 z-10 flex items-start justify-center rounded-2xl bg-background/70 pt-10 backdrop-blur-[1px]">
            <div className="flex items-center gap-3 rounded-full border bg-card px-4 py-2 text-sm font-medium shadow-lg" role="status">
              <Loader2 className="h-4 w-4 animate-spin text-fuchsia-600" />
              Čekám na dočtení{waitingCount > 0 ? ` (${waitingCount})` : ""}
              <Button type="button" size="sm" variant="ghost" onClick={onCancelWait}>Upravit</Button>
            </div>
          </div>
        )}
      </div>

      {sort.excludedPageIds.length > 0 && (
        <section className="rounded-2xl border border-dashed p-3">
          <p className="mb-2 text-xs font-semibold text-muted-foreground">Vyřazené stránky ({sort.excludedPageIds.length}) — neuloží se</p>
          <ul className="flex flex-wrap gap-2">
            {sort.excludedPageIds.map((pid) => {
              const v = pageView(batch, pid, local);
              if (!v) return null;
              const dup = v.page.duplicateOf ? batch.pages.findIndex((p) => p.id === v.page.duplicateOf) : -1;
              return (
                <li key={pid} className="flex items-center gap-2 rounded-xl border bg-card p-1.5 pr-2 opacity-80">
                  <Thumb view={v} big={false} label={pageTitle(v)} onClick={() => setViewer({ pageIds: [pid], title: pageTitle(v) })} />
                  <span className="max-w-[9rem] text-[11px] text-muted-foreground">
                    {dup >= 0 ? `stejná jako S${dup + 1}` : v.page.aiLabel || v.page.label}
                  </span>
                  <Button type="button" size="sm" variant="outline" className="h-8" disabled={waiting} onClick={() => change(restorePage(sort, pid, batch.pages))}>
                    <Undo2 /> Vrátit
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Stránka: přesun do dokladu, nový doklad, pořadí, vyřadit, zobrazit */}
      <Sheet
        open={Boolean(pageSheet && sheetView)}
        onOpenChange={(o) => !o && setPageSheet(null)}
        title={sheetView ? pageTitle(sheetView) : "Stránka"}
        description={sheetLocked && sheetView?.page.source !== "file"
          ? "Stránky tohoto PDF nejde rozdělit (zaheslované / poškozené) — patří k jednomu dokladu."
          : sheetView?.page.aiLabel || undefined}
        testId="capture-page-sheet"
      >
        {pageSheet && sheetView && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Thumb view={sheetView} big label="Zobrazit stránku" onClick={() => setViewer({ pageIds: [pageSheet], title: pageTitle(sheetView) })} />
              {sheetDoc && (
                <p className="flex min-w-0 items-center gap-1.5 text-sm" data-testid="capture-page-sheet-current">
                  <Check className="h-4 w-4 shrink-0 text-emerald-600" />
                  <span className="text-muted-foreground">Teď v:</span>
                  <span className="min-w-0 font-medium">{docLabel(sheetDoc, batch.pages)}</span>
                </p>
              )}
            </div>
            {!sheetLocked && (
              <div>
                <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Přesunout k dokladu</p>
                <div className="flex flex-col gap-1.5">
                  {sort.docs.filter((d) => !d.excluded && d.id !== sheetDoc?.id && !isFileDoc(d, batch.pages)).map((d) => (
                    <Button
                      key={d.id}
                      type="button"
                      variant="outline"
                      className="h-auto min-h-10 justify-start whitespace-normal py-2 text-left"
                      onClick={() => {
                        change(movePage(sort, pageSheet, d.id));
                        setPageSheet(null);
                      }}
                    >
                      <span aria-hidden className={cn("h-4 w-1.5 shrink-0 rounded-full", GROUP_BAR[BATCH_TYPES[d.type].group])} />
                      <ArrowRight className="text-muted-foreground" /> {docLabel(d, batch.pages)}
                    </Button>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    aria-label="Oddělit jako nový doklad"
                    className="h-10 justify-start border-dashed"
                    onClick={() => {
                      setTypeSheet({ splitPage: pageSheet });
                      setPageSheet(null);
                    }}
                  >
                    <Plus /> Nový doklad
                  </Button>
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {!sheetLocked && sheetDoc && sheetDoc.pageIds.length > 1 && (
                <>
                  <Button type="button" variant="outline" size="sm" className="h-9" aria-label="Dřív — posunout stránku dopředu" disabled={sheetDoc.pageIds[0] === pageSheet} onClick={() => change(movePageWithin(sort, pageSheet, -1))}>
                    <ArrowLeft /> Dřív
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="h-9" aria-label="Později — posunout stránku dozadu" disabled={sheetDoc.pageIds[sheetDoc.pageIds.length - 1] === pageSheet} onClick={() => change(movePageWithin(sort, pageSheet, 1))}>
                    <ArrowRight /> Později
                  </Button>
                </>
              )}
              <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => setViewer({ pageIds: [pageSheet], title: pageTitle(sheetView) })}>
                <Eye /> Zobrazit
              </Button>
              {!sheetLocked && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label="Vyřadit stránku"
                  className="h-9 text-red-700 dark:text-red-400"
                  onClick={() => {
                    change(excludePage(sort, pageSheet));
                    setPageSheet(null);
                  }}
                >
                  <Trash2 /> Vyřadit stránku
                </Button>
              )}
            </div>
          </div>
        )}
      </Sheet>

      {/* Druh dokladu (nebo druh nového dokladu z oddělené stránky) */}
      <Sheet
        open={Boolean(typeSheet)}
        onOpenChange={(o) => !o && closeType()}
        title={typeSheet && "splitPage" in typeSheet ? "Nový doklad — co to je?" : "Změnit druh dokladu"}
        testId="capture-type-sheet"
      >
        {typeSheet && (
          <TypePicker
            value={typeDoc?.type ?? null}
            allowed={typeDoc
              ? allowedTypes(typeDoc, batch.pages)
              : "splitPage" in typeSheet
                ? allowedTypes({ pageIds: [typeSheet.splitPage] }, batch.pages)
                : []}
            onPick={(t) => {
              if ("docId" in typeSheet) change(setDocType(sort, typeSheet.docId, t));
              else change(splitPage(sort, typeSheet.splitPage, t));
              closeType();
            }}
          />
        )}
      </Sheet>

      {/* Sloučit s… */}
      <Sheet open={Boolean(mergeSheet)} onOpenChange={(o) => !o && setMergeSheet(null)} title="Sloučit s dokladem">
        {mergeSheet && (
          <div className="flex flex-col gap-1.5">
            {sort.docs.filter((d) => d.id !== mergeSheet && !d.excluded && !isFileDoc(d, batch.pages)).map((d) => (
              <Button
                key={d.id}
                type="button"
                variant="outline"
                className="h-auto min-h-10 justify-start whitespace-normal py-2 text-left"
                onClick={() => {
                  change(mergeDocs(sort, d.id, mergeSheet));
                  setMergeSheet(null);
                }}
              >
                <CircleDashed className="text-muted-foreground" /> {docLabel(d, batch.pages)}
              </Button>
            ))}
          </div>
        )}
      </Sheet>

      {/* Zobrazit */}
      <Sheet open={Boolean(viewer)} onOpenChange={(o) => !o && setViewer(null)} title={viewer?.title ?? "Náhled"}>
        {viewer && <CapturePages pages={viewerPages(batch, viewer.pageIds, local)} className="h-[60dvh]" />}
      </Sheet>
    </div>
  );
}

/** Ikona druhu pro malé seznamy (výsledek, souhrn). */
export function TypeIcon({ type, className }: { type: BatchDocType; className?: string }) {
  const meta = BATCH_TYPES[type];
  const fk = FILE_KINDS[meta.fileKind];
  const Icon = meta.key === "model_3d" ? Box : fk.icon;
  return <Icon className={cn("h-4 w-4", fk.text, className)} />;
}
