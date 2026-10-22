"use client";

import * as React from "react";
import {
  AlertTriangle, ArrowLeft, ArrowRight, Camera, FileText, Images, Layers, Loader2, Plus, Sparkles, Sun, Trash2,
  ScanLine, PenLine,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PageDraft } from "@/components/jobs/capture/capture-flow";
import { cn } from "@/lib/utils";

/** Fotky a PDF (na mobilu fotoaparát, na počítači výběr / přetažení / vložení ze schránky). */
export const CAPTURE_ACCEPT = "image/*,application/pdf,.pdf,.heic,.heif";

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
}: {
  pages: PageDraft[];
  onAddFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, delta: -1 | 1) => void;
  /** Uživatel má AI čtení (jinak vyplní ručně vedle fotky). */
  aiHint: boolean;
}) {
  const cameraRef = React.useRef<HTMLInputElement>(null);
  const filesRef = React.useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = React.useState(false);

  // vložení obrázku ze schránky (Ctrl+V na počítači)
  React.useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/") || f.type === "application/pdf");
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
      <input
        ref={cameraRef}
        type="file"
        accept={CAPTURE_ACCEPT}
        capture="environment"
        className="hidden"
        data-testid="capture-camera-input"
        onChange={(e) => {
          onAddFiles(filesFrom(e.target.files));
          e.target.value = "";
        }}
      />
      <input
        ref={filesRef}
        type="file"
        accept={CAPTURE_ACCEPT}
        multiple
        className="hidden"
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

  if (!pages.length) {
    return (
      <div
        {...dropProps}
        className={cn(
          "flex min-h-full flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-8 text-center transition sm:py-12",
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
          <Button
            type="button"
            size="lg"
            onClick={() => cameraRef.current?.click()}
            className="h-12 flex-1 bg-rose-600 text-base text-white shadow-md shadow-rose-600/25 hover:bg-rose-700"
          >
            <Camera className="!size-5" /> Vyfotit
          </Button>
          <Button type="button" size="lg" variant="outline" onClick={() => filesRef.current?.click()} className="h-12 flex-1 text-base">
            <Images className="!size-5 text-sky-600 dark:text-sky-400" /> Vybrat soubory
          </Button>
        </div>
        <p className="mt-3 hidden text-xs text-muted-foreground sm:block">
          …nebo sem fotky / PDF přetáhni, případně vlož ze schránky (Ctrl+V).
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
            Víc stránek = víc fotek
          </li>
        </ul>
      </div>
    );
  }

  return (
    <div {...dropProps} className={cn("rounded-2xl p-1 transition", dragOver && "bg-rose-50 ring-2 ring-rose-300 dark:bg-rose-500/10")}>
      {inputs}
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {pages.length === 1 ? "1 stránka" : `${pages.length} ${pages.length < 5 ? "stránky" : "stránek"}`} dokladu
        </h3>
        <p className="text-xs text-muted-foreground">Má doklad víc stránek? Přidej je ve správném pořadí.</p>
      </div>
      <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {pages.map((p, i) => (
          <li key={p.id} className="group relative overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="relative aspect-[3/4] bg-muted">
              {p.previewUrl && p.mimeType.startsWith("image/") && !/hei[cf]/i.test(p.mimeType) ? (
                // eslint-disable-next-line @next/next/no-img-element -- místní náhled fotky
                <img src={p.previewUrl} alt={`Stránka ${i + 1}`} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-1 px-2 text-center">
                  <FileText className="h-10 w-10 text-red-500" />
                  <span className="line-clamp-2 break-all text-[11px] text-muted-foreground">{p.name}</span>
                </div>
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
                <Button type="button" variant="ghost" size="icon-sm" className="h-7 w-7" disabled={i === 0} onClick={() => onMove(p.id, -1)} aria-label="Posunout dopředu">
                  <ArrowLeft />
                </Button>
                <Button type="button" variant="ghost" size="icon-sm" className="h-7 w-7" disabled={i === pages.length - 1} onClick={() => onMove(p.id, 1)} aria-label="Posunout dozadu">
                  <ArrowRight />
                </Button>
                <Button type="button" variant="ghost" size="icon-sm" className="h-7 w-7 text-red-600 hover:text-red-700 dark:text-red-400" onClick={() => onRemove(p.id)} aria-label="Odebrat stránku">
                  <Trash2 />
                </Button>
              </span>
            </div>
          </li>
        ))}
        <li className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            className="flex flex-1 flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-rose-300 bg-rose-50/60 p-3 text-sm font-medium text-rose-700 transition hover:bg-rose-100 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300"
          >
            <Camera className="h-6 w-6" /> Vyfotit další stránku
          </button>
          <button
            type="button"
            onClick={() => filesRef.current?.click()}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed p-2.5 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            <Plus className="h-4 w-4" /> Vybrat soubory
          </button>
        </li>
      </ol>
    </div>
  );
}
