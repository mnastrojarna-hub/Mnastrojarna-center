"use client";

import * as React from "react";
import {
  AlertTriangle, Archive, ArrowLeft, ArrowRight, Camera, FileText, History, Images, Layers, Loader2, Paperclip, Plus,
  Sparkles, Sun, Trash2, ScanLine, PenLine, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PageDraft } from "@/components/jobs/capture/capture-flow";
import { CAD_2D_EXTENSIONS, CAD_3D_EXTENSIONS, CAPTURE_FILES_ACCEPT, FILE_KINDS } from "@/lib/jobs/file-kinds";
import { cadFormatOf } from "@/lib/jobs/capture-batch";
import { cn } from "@/lib/utils";

/** Výběr souborů: fotky, PDF, CAD (3D modely, DXF/DWG), kancelářské soubory, ZIP (na konci cokoli). */
export const CAPTURE_ACCEPT = CAPTURE_FILES_ACCEPT;
/** Fotoaparát: jen obrázky — s PDF v `accept` Android místo fotoaparátu otevře výběr souboru. */
export const CAMERA_ACCEPT = "image/*";

export type PickTileKind = "image" | "pdf" | "cad3d" | "cad2d" | "zip" | "other";

function extOf(name: string): string {
  return /\.([a-z0-9_]{1,12})$/i.exec(name)?.[1]?.toLowerCase() ?? "";
}

/** Jak soubor v dávce ukázat (fotka / PDF = stránka dokladu, ostatní = soubor). */
export function pickTileKind(name: string, mime: string): PickTileKind {
  const ext = extOf(name);
  if ((CAD_3D_EXTENSIONS as readonly string[]).includes(ext)) return "cad3d";
  if ((CAD_2D_EXTENSIONS as readonly string[]).includes(ext)) return "cad2d";
  if (ext === "zip" || mime === "application/zip" || mime === "application/x-zip-compressed") return "zip";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (mime.startsWith("image/") || /^(jpe?g|png|webp|gif|heic|heif)$/.test(ext)) return "image";
  return "other";
}

/** Počítadlo dávky: „2 stránky dokladu · 1 soubor CAD · 1 ZIP". */
export function pickCountLabel(pages: Pick<PageDraft, "name" | "mimeType">[]): string {
  let visual = 0, cad = 0, zip = 0, other = 0;
  for (const p of pages) {
    const k = pickTileKind(p.name, p.mimeType);
    if (k === "image" || k === "pdf") visual += 1;
    else if (k === "cad3d" || k === "cad2d") cad += 1;
    else if (k === "zip") zip += 1;
    else other += 1;
  }
  const parts: string[] = [];
  if (visual || (!cad && !zip && !other)) parts.push(`${visual === 1 ? "1 stránka" : `${visual} ${visual > 1 && visual < 5 ? "stránky" : "stránek"}`} dokladu`);
  if (cad) parts.push(`${cad} ${cad === 1 ? "soubor" : cad < 5 ? "soubory" : "souborů"} CAD`);
  if (zip) parts.push(`${zip} ZIP`);
  if (other) parts.push(`${other} ${other === 1 ? "další soubor" : other < 5 ? "další soubory" : "dalších souborů"}`);
  return parts.join(" · ");
}

/** Popisek otevírající výběr souboru: klepnutí řeší prohlížeč (label for), klávesnice Enter / mezerník. */
function keyOpen(ref: React.RefObject<HTMLInputElement | null>) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        ref.current?.click();
      }
    },
  };
}

function FileTile({ name, kind }: { name: string; kind: PickTileKind }) {
  if (kind === "cad3d" || kind === "cad2d") {
    const fk = FILE_KINDS[kind === "cad3d" ? "model_3d" : "vykres"];
    const Icon = fk.icon;
    return (
      <div className={cn("flex h-full flex-col items-center justify-center gap-1.5 px-2 text-center", fk.badge)}>
        <Icon className="h-10 w-10" />
        <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide dark:bg-black/30">
          {cadFormatOf(name) ?? extOf(name).toUpperCase()}
        </span>
        <span className="line-clamp-2 break-all text-[11px] opacity-80">{name}</span>
      </div>
    );
  }
  if (kind === "zip") {
    return (
      <div className={cn("flex h-full flex-col items-center justify-center gap-1.5 px-2 text-center", FILE_KINDS.ostatni.badge)}>
        <Archive className="h-10 w-10" />
        <span className="text-[11px] font-semibold">ZIP · rozbalí se</span>
        <span className="line-clamp-2 break-all text-[11px] opacity-80">{name}</span>
      </div>
    );
  }
  const Icon = kind === "pdf" ? FileText : Paperclip;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 px-2 text-center">
      <Icon className={cn("h-10 w-10", kind === "pdf" ? "text-red-500" : "text-slate-500")} />
      <span className="line-clamp-2 break-all text-[11px] text-muted-foreground">{name}</span>
    </div>
  );
}

function filesFrom(list: FileList | null | undefined): File[] {
  return list ? Array.from(list).filter((f) => f.size > 0) : [];
}

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} kB`;
}

/**
 * Krok 1 — vyfotit / vybrat stránky dokladu. Stránky se nahrávají hned po výběru,
 * takže čtení pak začne bez čekání. Pořadí jde měnit, stránky odebrat.
 */
export function CapturePick({
  pages,
  onAddFiles,
  onRemove,
  onMove,
  aiHint,
  notice = null,
  resume = null,
  onResume,
  onDiscardResume,
}: {
  pages: PageDraft[];
  onAddFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, delta: -1 | 1) => void;
  /** Uživatel má AI čtení (jinak vyplní ručně vedle fotky). */
  aiHint: boolean;
  /** Krátká informace („Už je v dávce"). */
  notice?: string | null;
  /** Rozpracované focení (sessionStorage + živá relace na serveru). */
  resume?: { pages: number; busy?: boolean } | null;
  onResume?: () => void;
  onDiscardResume?: () => void;
}) {
  const cameraRef = React.useRef<HTMLInputElement>(null);
  const filesRef = React.useRef<HTMLInputElement>(null);
  const uid = React.useId();
  const cameraId = `${uid}-camera`;
  const filesId = `${uid}-files`;
  const [dragOver, setDragOver] = React.useState(false);

  // vložení obrázku ze schránky (Ctrl+V na počítači)
  React.useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.size > 0);
      if (files.length) {
        e.preventDefault();
        onAddFiles(files);
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [onAddFiles]);

  const inputs = (
    <>
      {/* Pole jsou vizuálně skrytá (ne display:none) a otevírá je <label for> — nativní klepnutí
          funguje i tam, kde prohlížeč blokuje programové input.click() (iOS, vestavěné prohlížeče). */}
      <input
        ref={cameraRef}
        id={cameraId}
        type="file"
        accept={CAMERA_ACCEPT}
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        data-testid="capture-camera-input"
        onChange={(e) => {
          onAddFiles(filesFrom(e.target.files));
          e.target.value = "";
        }}
      />
      <input
        ref={filesRef}
        id={filesId}
        type="file"
        accept={CAPTURE_ACCEPT}
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        data-testid="capture-files-input"
        onChange={(e) => {
          onAddFiles(filesFrom(e.target.files));
          e.target.value = "";
        }}
      />
    </>
  );

  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if (Array.from(e.dataTransfer.types).includes("Files")) {
        e.preventDefault();
        setDragOver(true);
      }
    },
    onDragLeave: () => setDragOver(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      onAddFiles(filesFrom(e.dataTransfer.files));
    },
  };

  const resumeBanner = resume ? (
    <div
      data-testid="capture-resume"
      className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-950 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-100"
    >
      <History className="h-5 w-5 shrink-0 text-indigo-600 dark:text-indigo-300" />
      <span className="min-w-0 flex-1 font-medium">
        Máš rozpracované focení ({resume.pages === 1 ? "1 stránka" : `${resume.pages} ${resume.pages > 1 && resume.pages < 5 ? "stránky" : "stránek"}`})
      </span>
      <span className="flex shrink-0 gap-2">
        <Button type="button" size="sm" onClick={onResume} disabled={resume.busy} className="bg-indigo-600 text-white hover:bg-indigo-700">
          {resume.busy ? <Loader2 className="animate-spin" /> : null} Pokračovat
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDiscardResume} disabled={resume.busy}>Zahodit</Button>
      </span>
    </div>
  ) : null;
  const noticeLine = (
    <p role="status" aria-live="polite" className={cn("text-xs font-medium text-sky-700 dark:text-sky-300", !notice && "sr-only")}>
      {notice ? <><Info className="mr-1 inline h-3.5 w-3.5 align-[-3px]" />{notice}</> : null}
    </p>
  );

  if (!pages.length) {
    return (
      <div className="flex min-h-full flex-col">
      {resumeBanner}
      <div
        {...dropProps}
        className={cn(
          "flex flex-1 flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-8 text-center transition sm:py-12",
          dragOver ? "border-rose-400 bg-rose-50 dark:bg-rose-500/10" : "border-border",
        )}
      >
        {inputs}
        <span className="relative mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-rose-100 text-rose-600 shadow-inner dark:bg-rose-500/15 dark:text-rose-300">
          <Camera className="h-9 w-9" />
          <span className="absolute -right-1 -top-1 flex h-7 w-7 items-center justify-center rounded-full bg-fuchsia-500 text-white shadow">
            {aiHint ? <Sparkles className="h-4 w-4" /> : <PenLine className="h-4 w-4" />}
          </span>
        </span>
        <h3 className="text-lg font-semibold">Vyfoť doklad</h3>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          {aiHint
            ? "Objednávka, poptávka, nabídka, dodací list, faktura… AI pozná, co to je, najde zákazníka i zakázku a vše předvyplní. Ty jen zkontroluješ."
            : "Objednávka, poptávka, dodací list, faktura… Vedle fotky pak vyplníš pár údajů a doklad se uloží k zakázce."}
        </p>

        <div className="mt-6 flex w-full max-w-sm flex-col gap-2 sm:max-w-md sm:flex-row">
          <Button asChild size="lg" className="h-12 w-full shrink-0 cursor-pointer sm:w-auto sm:flex-1 bg-rose-600 text-base text-white shadow-md shadow-rose-600/25 hover:bg-rose-700">
            <label htmlFor={cameraId} {...keyOpen(cameraRef)}>
              <Camera className="!size-5" /> Vyfotit
            </label>
          </Button>
          <Button asChild size="lg" variant="outline" className="h-12 w-full shrink-0 cursor-pointer sm:w-auto sm:flex-1 text-base">
            <label htmlFor={filesId} {...keyOpen(filesRef)}>
              <Images className="!size-5 text-sky-600 dark:text-sky-400" /> Vybrat soubory
            </label>
          </Button>
        </div>
        <p className="mt-3 hidden text-xs text-muted-foreground sm:block">
          …nebo sem fotky / PDF / výkresy / 3D modely přetáhni, případně vlož ze schránky (Ctrl+V).
        </p>

        <ul className="mt-6 grid w-full max-w-lg gap-2 text-left text-xs sm:grid-cols-3">
          <li className="flex items-start gap-2 rounded-lg bg-amber-50 p-2.5 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            <Sun className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            Dobré světlo, bez stínu ruky
          </li>
          <li className="flex items-start gap-2 rounded-lg bg-sky-50 p-2.5 text-sky-900 dark:bg-sky-500/10 dark:text-sky-200">
            <ScanLine className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
            Celý list v záběru, rovně
          </li>
          <li className="flex items-start gap-2 rounded-lg bg-violet-50 p-2.5 text-violet-900 dark:bg-violet-500/10 dark:text-violet-200">
            <Layers className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />
            {aiHint ? "Víc dokladů najednou — AI je roztřídí" : "Víc stránek = víc fotek"}
          </li>
        </ul>
        {noticeLine}
      </div>
      </div>
    );
  }

  return (
    <div {...dropProps} className={cn("rounded-2xl p-1 transition", dragOver && "bg-rose-50 ring-2 ring-rose-300 dark:bg-rose-500/10")}>
      {inputs}
      {resumeBanner}
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{pickCountLabel(pages)}</h3>
        <p className="text-xs text-muted-foreground">
          {pages.length >= 2 && aiHint ? (
            <span className="font-medium text-fuchsia-700 dark:text-fuchsia-300"><Sparkles className="mr-1 inline h-3.5 w-3.5 align-[-3px]" />Klidně vše najednou — AI roztřídí</span>
          ) : "Má doklad víc stránek? Přidej je ve správném pořadí."}
        </p>
      </div>
      <div className="mb-2">{noticeLine}</div>
      <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {pages.map((p, i) => {
          const kind = pickTileKind(p.name, p.mimeType);
          return (
          <li key={p.id} className="group relative overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="relative aspect-[3/4] bg-muted">
              {kind === "image" && p.previewUrl && !/hei[cf]/i.test(p.mimeType) ? (
                // eslint-disable-next-line @next/next/no-img-element -- místní náhled fotky
                <img src={p.previewUrl} alt={`Stránka ${i + 1}`} className="h-full w-full object-cover" />
              ) : (
                <FileTile name={p.name} kind={kind} />
              )}
              <span className="absolute left-2 top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-rose-600 px-1.5 text-xs font-bold text-white shadow">
                {i + 1}
              </span>
              {p.status === "uploading" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-background/70 text-xs font-medium backdrop-blur-[1px]">
                  <Loader2 className="h-6 w-6 animate-spin text-rose-600" />
                  Nahrávám…
                </div>
              )}
              {p.status === "error" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-red-50/90 p-2 text-center text-[11px] font-medium text-red-700 dark:bg-red-950/80 dark:text-red-300">
                  <AlertTriangle className="h-6 w-6" />
                  {p.error ?? "Nahrání selhalo"}
                </div>
              )}
            </div>
            <div className="flex items-center justify-between gap-1 border-t px-1.5 py-1">
              <span className="truncate pl-1 text-[11px] text-muted-foreground">{sizeLabel(p.size)}</span>
              <span className="flex shrink-0">
                <Button type="button" variant="ghost" size="icon-sm" className="h-9 w-9" disabled={i === 0} onClick={() => onMove(p.id, -1)} aria-label="Posunout dopředu">
                  <ArrowLeft />
                </Button>
                <Button type="button" variant="ghost" size="icon-sm" className="h-9 w-9" disabled={i === pages.length - 1} onClick={() => onMove(p.id, 1)} aria-label="Posunout dozadu">
                  <ArrowRight />
                </Button>
                <Button type="button" variant="ghost" size="icon-sm" className="h-9 w-9 text-red-600 hover:text-red-700 dark:text-red-400" onClick={() => onRemove(p.id)} aria-label="Odebrat stránku">
                  <Trash2 />
                </Button>
              </span>
            </div>
          </li>
          );
        })}
        <li className="flex flex-col gap-2">
          <label
            htmlFor={cameraId}
            {...keyOpen(cameraRef)}
            className="flex flex-1 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-rose-300 bg-rose-50/60 p-3 text-sm font-medium text-rose-700 transition hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300"
          >
            <Camera className="h-6 w-6" /> <span className="text-center">Vyfotit další (stránku nebo doklad)</span>
          </label>
          <label
            htmlFor={filesId}
            {...keyOpen(filesRef)}
            className="flex cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-dashed p-2.5 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="h-4 w-4" /> Vybrat soubory
          </label>
        </li>
      </ol>
    </div>
  );
}
