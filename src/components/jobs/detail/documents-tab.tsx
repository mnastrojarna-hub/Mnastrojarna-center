"use client";

import * as React from "react";
import {
  ExternalLink, Download, MoreHorizontal, Upload, Pencil, Archive, ArchiveRestore, Trash2, Sparkles, FileText,
  ChevronLeft, ChevronRight, Loader2, Eye, EyeOff, FolderOpen, X, Send, Lock,
} from "lucide-react";
import { fileLockText } from "@/components/flow/file-lock";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { FileKindBadge } from "@/components/jobs/stage-badge";
import { DocumentSendDialog } from "@/components/flow/document-send-dialog";
import { useAccess } from "@/components/access-provider";
import type { JobDocumentKind } from "@/app/actions/job-documents";
import { setJobFileArchived, updateJobFile, deleteJobFile } from "@/app/actions/job-files";
import { FILE_KINDS, FILE_KIND_ORDER, JOB_FILE_ACCEPT } from "@/lib/jobs/file-kinds";
import type { JobFileKind } from "@/lib/supabase/database.types";
import type { JobFile, JobQuote } from "@/lib/jobs/types";
import { cn, relativeTime } from "@/lib/utils";
import { formatTimestamp } from "@/lib/jobs/field-labels";
import { useJobDetail } from "./detail-context";
import { ConfirmDialog, DialogHead, ErrorBox } from "./confirm-dialog";
import { UploadDropzone, UploadQueue } from "./upload-controls";
import { groupFiles, replacedByLabel, isImageFile, isPdfFile, formatBytes } from "./detail-helpers";
import { anonApi } from "@/components/anonymize/anon-api";
import {
  AnonFileBadge, AnonMenuItems, AnonSummaryLine, ForSupplierLink, ReviewDownloadDialog, SendQueueNotice, SupplierPackButton, supplierReady, supplierSummary,
} from "@/components/anonymize/anon-file-menu";
import { AnonymizeEditor } from "@/components/anonymize/anonymize-editor";

/** Doklady, které jde z karty poslat zákazníkovi e-mailem (PDF v příloze). */
const SENDABLE: Partial<Record<JobFileKind, { kind: JobDocumentKind; what: string }>> = {
  nabidka: { kind: "nabidka", what: "nabídku" },
  potvrzeni: { kind: "potvrzeni", what: "potvrzení objednávky" },
  dodaci_list: { kind: "dodaci_list", what: "dodací list" },
  faktura: { kind: "faktura", what: "fakturu" },
};

const fileUrl = (id: string, download = false) => `/api/jobs/files/${id}${download ? "?download=1" : ""}`;

function Thumb({ file, onOpen }: { file: JobFile; onOpen?: () => void }) {
  const [broken, setBroken] = React.useState(false);
  const k = FILE_KINDS[file.kind] ?? FILE_KINDS.ostatni;
  const Icon = isPdfFile(file) ? FileText : k.icon;
  if (isImageFile(file) && !broken) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="group/thumb relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Zobrazit ${file.filename}`}
      >
        <img
          src={fileUrl(file.id)}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
          className="h-full w-full object-cover transition group-hover/thumb:scale-105"
        />
      </button>
    );
  }
  return (
    <a
      href={fileUrl(file.id)}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("relative flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-lg", k.badge)}
      aria-label={`Otevřít ${file.filename}`}
    >
      <Icon className="h-6 w-6" />
      <span className="mt-0.5 max-w-[3.2rem] truncate text-[9px] font-bold uppercase opacity-80">
        {(file.filename.split(".").pop() ?? "").slice(0, 5)}
      </span>
    </a>
  );
}

function FileRow({
  file, all, quotes, onEdit, onDelete, onPreview, onSend, onAnonEdit, onAnonAction, onReviewDownload,
}: {
  file: JobFile;
  all: JobFile[];
  quotes: Pick<JobQuote, "id" | "number">[];
  onEdit: (f: JobFile) => void;
  onDelete: (f: JobFile) => void;
  onPreview: (f: JobFile) => void;
  /** Poslat doklad zákazníkovi e-mailem (jen doklady a s právem na dokumenty). */
  onSend?: (f: JobFile) => void;
  /** Anonymizace pro dodavatele (editor oblastí, zařazení / schválení / přeskočení, stažení ke kontrole). */
  onAnonEdit?: (f: JobFile) => void;
  onAnonAction?: (f: JobFile, action: "enqueue" | "approve" | "skip") => void;
  onReviewDownload?: (f: JobFile) => void;
}) {
  const { perms, notify, refresh, startUpload } = useJobDetail();
  const [busy, setBusy] = React.useState(false);
  const versionInput = React.useRef<HTMLInputElement>(null);
  const replaced = replacedByLabel(file, all);
  const quote = file.quoteId ? quotes.find((q) => q.id === file.quoteId) : null;
  /** Má hotovou / ke kontrole kopii pro dodavatele → stažení originálu se označí „interně". */
  const forSupplier = supplierReady(file);

  async function toggleArchive() {
    setBusy(true);
    try {
      const res = await setJobFileArchived(file.id, !file.archived);
      if (!res.ok) notify("error", res.error ?? "Nepovedlo se.");
      else {
        notify("success", file.archived ? "Dokument obnoven z archivu." : "Dokument archivován.");
        refresh();
      }
    } catch {
      notify("error", "Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={cn("flex items-center gap-3 px-3 py-2.5", file.archived && "bg-muted/30 opacity-70")}>
      <Thumb file={file} onOpen={() => onPreview(file)} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <a
            href={fileUrl(file.id)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              if (isImageFile(file)) {
                e.preventDefault();
                onPreview(file);
              }
            }}
            className={cn("min-w-0 truncate text-sm font-medium hover:underline", file.archived && "line-through decoration-muted-foreground/50")}
          >
            {file.title || file.filename}
          </a>
          <span className="rounded bg-muted px-1.5 py-px text-[10px] font-semibold text-muted-foreground">v{file.version}</span>
          {file.hasAiData && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-fuchsia-100 px-1.5 py-px text-[10px] font-medium text-fuchsia-800 dark:bg-fuchsia-500/15 dark:text-fuchsia-300" title="AI z dokladu přečetla údaje">
              <Sparkles className="h-2.5 w-2.5" /> AI{file.aiConfidence !== null ? ` ${Math.round(file.aiConfidence * 100)} %` : ""}
            </span>
          )}
          {replaced && <span className="rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground">{replaced}</span>}
          {quote && <span className="rounded-full bg-violet-100 px-1.5 py-px text-[10px] font-medium text-violet-800 dark:bg-violet-500/15 dark:text-violet-300">k nabídce {quote.number}</span>}
          {!file.archived && <AnonFileBadge file={file} />}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          {file.title && <span className="max-w-[14rem] truncate">{file.filename}</span>}
          {file.sizeBytes ? <span>{formatBytes(file.sizeBytes)}</span> : null}
          <span title={formatTimestamp(file.createdAt) ?? undefined} suppressHydrationWarning>
            {file.uploadedBy?.name ?? "systém"} · {relativeTime(file.createdAt)}
          </span>
        </div>
        {file.note && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{file.note}</p>}
        {!file.archived && <AnonSummaryLine file={file} />}
        {forSupplier && onReviewDownload && (
          <div className="mt-1"><ForSupplierLink file={file} onReviewDownload={onReviewDownload} /></div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <Button asChild variant="ghost" size="icon-sm" className="hidden sm:inline-flex">
          <a href={fileUrl(file.id)} target="_blank" rel="noopener noreferrer" aria-label={forSupplier ? "Otevřít originál (interně)" : "Otevřít"} title={forSupplier ? "Otevřít originál (interně)" : "Otevřít"}>
            <ExternalLink className="h-4 w-4" />
          </a>
        </Button>
        <Button asChild variant="ghost" size="icon-sm">
          <a href={fileUrl(file.id, true)} aria-label={forSupplier ? "Stáhnout originál (interně)" : "Stáhnout"} title={forSupplier ? "Originál (interně) — dodavateli posílej „Pro dodavatele“" : "Stáhnout"}>
            <Download className="h-4 w-4" />
          </a>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Další akce dokumentu" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {/* u anonymizovaného výkresu nahoře kopie pro dodavatele, originál až pod ní (interně) */}
            {!file.archived && onAnonEdit && onAnonAction && onReviewDownload && (
              <AnonMenuItems file={file} onEdit={onAnonEdit} onAction={onAnonAction} onReviewDownload={onReviewDownload} />
            )}
            <DropdownMenuItem asChild>
              <a href={fileUrl(file.id)} target="_blank" rel="noopener noreferrer"><ExternalLink /> {forSupplier ? "Otevřít originál (interně)" : "Otevřít"}</a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={fileUrl(file.id, true)}><Download /> {forSupplier ? "Stáhnout originál (interně)" : "Stáhnout"}</a>
            </DropdownMenuItem>
            {onSend && !file.archived && SENDABLE[file.kind] && (
              <DropdownMenuItem onSelect={() => onSend(file)}>
                <Send /> Poslat zákazníkovi e-mailem…
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {!file.archived && (
              <DropdownMenuItem onSelect={() => versionInput.current?.click()}>
                <Upload /> Nahrát novou verzi
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => onEdit(file)}>
              <Pencil /> Změnit druh / název
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void toggleArchive()}>
              {file.archived ? <><ArchiveRestore /> Obnovit z archivu</> : <><Archive /> Archivovat</>}
            </DropdownMenuItem>
            {perms.canDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onDelete(file)} className="text-red-600 focus:text-red-700 dark:text-red-400">
                  <Trash2 className="!text-current" /> Smazat
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <input
          ref={versionInput}
          type="file"
          accept={JOB_FILE_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void startUpload([f], { replaceFileId: file.id, kind: file.kind });
          }}
        />
      </div>
    </li>
  );
}

function FileEditDialog({ file, onOpenChange }: { file: JobFile; onOpenChange: (o: boolean) => void }) {
  const { notify, refresh } = useJobDetail();
  const [kind, setKind] = React.useState<JobFileKind>(file.kind);
  const [title, setTitle] = React.useState(file.title ?? "");
  const [note, setNote] = React.useState(file.note ?? "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await updateJobFile(file.id, { kind, title, note });
      if (!res.ok) return setError(res.error ?? "Nepovedlo se uložit.");
      notify("success", "Dokument upraven.");
      onOpenChange(false);
      refresh();
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent aria-describedby={undefined} className="top-[4%] max-h-[92vh] w-[calc(100%-1.5rem)] overflow-y-auto sm:top-[10%] sm:max-w-lg">
        <DialogHead icon={Pencil} tone="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" title="Upravit dokument" subtitle={file.filename} />
        <form onSubmit={submit} className="space-y-4 p-5">
          <ErrorBox error={error} />
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">Druh dokumentu</div>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Druh dokumentu">
              {FILE_KIND_ORDER.map((k) => {
                const m = FILE_KINDS[k];
                const Icon = m.icon;
                const on = k === kind;
                return (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setKind(k)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition",
                      on ? cn(m.badge, "ring-2 ring-current") : "bg-muted text-muted-foreground hover:bg-accent",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" /> {m.label}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Název (nepovinný)</span>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={file.filename} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Poznámka</span>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Zrušit</Button>
            <Button type="submit" variant="success" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Uložit
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Náhled fotek přes celou obrazovku (šipky / swipe mezi fotkami). */
function Lightbox({ images, index, onIndex, onClose }: { images: JobFile[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const f = images[index];
  const touch = React.useRef<number | null>(null);
  const prev = React.useCallback(() => onIndex((index - 1 + images.length) % images.length), [index, images.length, onIndex]);
  const next = React.useCallback(() => onIndex((index + 1) % images.length), [index, images.length, onIndex]);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next]);

  if (!f) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        hideClose
        className="top-0 h-[100dvh] max-w-none rounded-none border-0 bg-black/95 p-0 text-white sm:top-[3%] sm:h-[94vh] sm:w-[calc(100%-2rem)] sm:max-w-6xl sm:rounded-xl"
      >
        <div className="flex items-center gap-2 px-4 py-3">
          <DialogTitle className="min-w-0 flex-1 truncate text-sm font-medium text-white">{f.title || f.filename}</DialogTitle>
          {images.length > 1 && <span className="text-xs text-white/60">{index + 1} / {images.length}</span>}
          <a href={fileUrl(f.id, true)} className="rounded-md p-2 text-white/80 hover:bg-white/10 hover:text-white" aria-label="Stáhnout"><Download className="h-4 w-4" /></a>
          <a href={fileUrl(f.id)} target="_blank" rel="noopener noreferrer" className="rounded-md p-2 text-white/80 hover:bg-white/10 hover:text-white" aria-label="Otevřít v novém panelu"><ExternalLink className="h-4 w-4" /></a>
          <button type="button" onClick={onClose} className="rounded-md p-2 text-white/80 hover:bg-white/10 hover:text-white" aria-label="Zavřít"><X className="h-5 w-5" /></button>
        </div>
        <div
          className="relative flex h-[calc(100%-3.5rem)] items-center justify-center px-2 pb-3"
          onTouchStart={(e) => {
            touch.current = e.touches[0]?.clientX ?? null;
          }}
          onTouchEnd={(e) => {
            const start = touch.current;
            const end = e.changedTouches[0]?.clientX;
            touch.current = null;
            if (start === null || end === undefined || Math.abs(end - start) < 50) return;
            if (end < start) next();
            else prev();
          }}
        >
          <img key={f.id} src={fileUrl(f.id)} alt={f.title || f.filename} className="max-h-full max-w-full rounded-md object-contain" />
          {images.length > 1 && (
            <>
              <button type="button" onClick={prev} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 hover:bg-white/20" aria-label="Předchozí"><ChevronLeft className="h-6 w-6" /></button>
              <button type="button" onClick={next} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 hover:bg-white/20" aria-label="Další"><ChevronRight className="h-6 w-6" /></button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Zamčený dokument (#25): řádek s druhem, názvem, autorem a datem zůstává, obsah ne — bez náhledu,
 * otevření, stažení a odeslání (server je odmítne také), jen text proč.
 */
function LockedFileRow({ file }: { file: JobFile }) {
  const k = FILE_KINDS[file.kind] ?? FILE_KINDS.ostatni;
  return (
    <li className={cn("flex items-center gap-3 px-3 py-2.5", file.archived && "bg-muted/30 opacity-70")} data-locked={file.locked ?? undefined}>
      <span aria-hidden className={cn("flex h-14 w-14 shrink-0 items-center justify-center rounded-lg opacity-70", k.badge)}>
        <Lock className="h-6 w-6" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="min-w-0 truncate text-sm font-medium text-muted-foreground">{file.title || file.filename}</span>
          <span className="rounded bg-muted px-1.5 py-px text-[10px] font-semibold text-muted-foreground">v{file.version}</span>
        </div>
        <p className="mt-0.5 flex items-start gap-1 text-xs font-medium text-amber-800 dark:text-amber-300">
          <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden /> <span className="min-w-0">{fileLockText(file.locked, file)}</span>
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground" title={formatTimestamp(file.createdAt) ?? undefined} suppressHydrationWarning>
          {file.uploadedBy?.name ?? "systém"} · {relativeTime(file.createdAt)}
        </p>
      </div>
    </li>
  );
}

/** Záložka Dokumenty — po druzích, s verzemi a archivem. */
export function DocumentsTab({ files, quotes }: { files: JobFile[]; quotes: Pick<JobQuote, "id" | "number">[] }) {
  const { jobId, notify, refresh } = useJobDetail();
  const { can, features } = useAccess();
  // oprávnění dorazí na klient po načtení layoutu; server akce je hlídá znovu
  const canSend = features.length === 0 || can("documents");
  const [sending, setSending] = React.useState<JobFile | null>(null);
  const [showArchive, setShowArchive] = React.useState(false);
  const [editing, setEditing] = React.useState<JobFile | null>(null);
  const [deleting, setDeleting] = React.useState<JobFile | null>(null);
  const [preview, setPreview] = React.useState<number | null>(null);
  const [anonEditing, setAnonEditing] = React.useState<JobFile | null>(null);
  const [reviewDl, setReviewDl] = React.useState<JobFile | null>(null);

  // výkresy v anonymizaci → obnovovat, dokud nedoběhne (nejvýš ~5 min)
  const anonBusy = files.some((f) => !f.archived && (f.anon?.status === "pending" || f.anon?.status === "processing"));
  React.useEffect(() => {
    if (!anonBusy) return;
    let n = 0;
    const t = window.setInterval(() => { n += 1; if (n > 50) window.clearInterval(t); else refresh(); }, 6000);
    return () => window.clearInterval(t);
  }, [anonBusy, refresh]);

  async function anonAction(f: JobFile, action: "enqueue" | "approve" | "skip") {
    if (action === "enqueue") {
      const r = await anonApi.enqueue({ fileIds: [f.id], force: true });
      if (!r.ok) return notify("error", r.error);
      // server soubor nezařadil (není kandidát, nákupní doklad…) → říct proč, ne „anonymizuje se"
      const st = r.data.statuses[f.id];
      const why = r.data.skipped.find((s) => s.id === f.id)?.reason;
      if (st !== "pending") notify("error", why ?? (st === "unsupported" ? "Formát nelze anonymizovat — pošli PDF, DXF nebo STEP." : "Soubor se nepodařilo zařadit."));
      else if (r.data.backfill?.includes(f.id)) notify("success", `${f.filename}: starší výkres — zpracuje se v rámci denního limitu.`);
      else notify("success", `${f.filename}: anonymizuje se…`);
      refresh();
      return;
    }
    const r = action === "approve" ? await anonApi.approve(f.id) : await anonApi.skip(f.id, "Náš výkres — neanonymizovat");
    if (!r.ok) return notify("error", r.error);
    notify("success", action === "approve" ? "Anonymizace schválena — výkres může jít dodavateli." : "Výkres se nebude anonymizovat.");
    refresh();
  }

  const groups = groupFiles(files);
  const archivedCount = files.filter((f) => f.archived).length;
  const visibleImages = files.filter((f) => !f.locked && isImageFile(f) && (showArchive || !f.archived));
  const openPreview = (f: JobFile) => {
    const i = visibleImages.findIndex((x) => x.id === f.id);
    if (i >= 0) setPreview(i);
  };
  const visibleGroups = groups.filter((g) => g.current.length || (showArchive && g.archived.length));
  const supplierLine = supplierSummary(files);

  return (
    <div className="space-y-4">
      <UploadDropzone />
      <UploadQueue />
      <SendQueueNotice jobId={jobId} refreshKey={files.map((f) => `${f.id}:${f.anon?.status ?? ""}`).join(",")} files={files} onEdit={setAnonEditing} />
      {supplierLine && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card px-3 py-2 text-sm" data-testid="anon-supplier-bar">
          <span className="text-muted-foreground">{supplierLine}</span>
          <SupplierPackButton jobId={jobId} files={files} onEdit={setAnonEditing} />
        </div>
      )}

      {visibleGroups.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border bg-card px-4 py-10 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
            <FolderOpen className="h-6 w-6" />
          </span>
          <p className="font-medium">Zatím žádné dokumenty</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Sem patří vše k zakázce: poptávka, výkresy, 3D modely, objednávka, dodací listy, faktury i fotky.
            Doklad z papíru vyfoť tlačítkem <strong>Přidat doklad (foto)</strong> nahoře — AI z něj rovnou vyčte údaje.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {visibleGroups.map((g) => {
            const list = showArchive ? [...g.current, ...g.archived] : g.current;
            return (
              <section key={g.kind} className="overflow-hidden rounded-xl border bg-card shadow-sm">
                <header className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
                  <FileKindBadge kind={g.kind} className="text-xs" />
                  <span className="text-xs text-muted-foreground">
                    {g.current.length} {g.current.length === 1 ? "dokument" : g.current.length >= 2 && g.current.length <= 4 ? "dokumenty" : "dokumentů"}
                    {g.archived.length > 0 && !showArchive && ` · ${g.archived.length} v archivu`}
                  </span>
                </header>
                <ul className="divide-y">
                  {list.map((f) => (
                    f.locked ? <LockedFileRow key={f.id} file={f} /> : (
                      <FileRow
                        key={f.id} file={f} all={files} quotes={quotes} onEdit={setEditing} onDelete={setDeleting} onPreview={openPreview}
                        onSend={canSend ? setSending : undefined} onAnonEdit={setAnonEditing} onAnonAction={(x, a) => void anonAction(x, a)} onReviewDownload={setReviewDl}
                      />
                    )
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {archivedCount > 0 && (
        <button
          type="button"
          onClick={() => setShowArchive((s) => !s)}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          {showArchive ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          {showArchive ? "Skrýt archiv" : `Zobrazit archiv (${archivedCount})`}
        </button>
      )}

      {editing && <FileEditDialog file={editing} onOpenChange={(o) => !o && setEditing(null)} />}
      {sending && SENDABLE[sending.kind] && (
        <DocumentSendDialog
          open
          onOpenChange={(o) => !o && setSending(null)}
          jobId={jobId}
          kind={SENDABLE[sending.kind]!.kind}
          fileId={sending.id}
          filename={sending.filename}
          quoteId={sending.quoteId ?? undefined}
          title={`Poslat ${SENDABLE[sending.kind]!.what} zákazníkovi`}
          onSent={({ to }) => {
            notify("success", `${sending.title || sending.filename} odesláno na ${to}.`);
            refresh();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setDeleting(null)}
          icon={Trash2}
          tone="bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400"
          title="Smazat dokument?"
          confirmLabel="Smazat natrvalo"
          confirmVariant="destructive"
          onConfirm={async () => {
            const res = await deleteJobFile(deleting.id);
            if (!res.ok) return res.error ?? "Nepovedlo se.";
            notify("success", `Dokument ${deleting.filename} smazán.`);
            refresh();
            return null;
          }}
        >
          <strong className="text-foreground">{deleting.title || deleting.filename}</strong> (v{deleting.version}) zmizí i z úložiště.
          Když jde jen o starou verzi, stačí ji <em>archivovat</em>.
        </ConfirmDialog>
      )}
      {anonEditing && (
        <AnonymizeEditor
          open
          onOpenChange={(o) => { if (!o) { setAnonEditing(null); refresh(); } }}
          fileId={anonEditing.id}
          sourceName={anonEditing.filename}
          title={`Anonymizace — ${anonEditing.title || anonEditing.filename}`}
        />
      )}
      {reviewDl && <ReviewDownloadDialog file={reviewDl} onClose={() => setReviewDl(null)} onEdit={setAnonEditing} />}
      {preview !== null && visibleImages[preview] && (
        <Lightbox images={visibleImages} index={preview} onIndex={setPreview} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}
