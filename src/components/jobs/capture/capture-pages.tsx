"use client";

import * as React from "react";
import { Box, ChevronLeft, ChevronRight, Download, ExternalLink, FileText, ImageOff, Paperclip, ZoomIn, ZoomOut } from "lucide-react";
import { usePdfThumb } from "@/components/jobs/capture/pdf-thumbs";
import { cn } from "@/lib/utils";

export interface ViewerPage {
  key: string;
  /** Místní náhled nebo podepsaná URL ze serveru. */
  url: string | null;
  mimeType: string;
  name: string;
  /** Strana PDF (dávka: doklad z části PDF) — prohlížeč ji otevře přes #page=N. */
  page?: number;
  /** Soubor bez náhledu (CAD, kancelářský…): formát na dlaždici („STEP"). */
  file?: { format: string | null; cad: boolean } | null;
}

function isPdf(p: Pick<ViewerPage, "mimeType" | "name" | "file">): boolean {
  return !p.file && (p.mimeType === "application/pdf" || /\.pdf$/i.test(p.name));
}

function pdfSrc(p: ViewerPage): string | null {
  if (!p.url) return null;
  return p.page && p.page > 1 ? `${p.url}#page=${p.page}` : p.url;
}

/** Dotykové zařízení (Android Chrome PDF v <iframe> nevykreslí, iOS ukáže jen 1. stranu). */
function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(pointer: coarse)");
    setCoarse(mq.matches);
    const on = () => setCoarse(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return coarse;
}

/** Strana PDF vykreslená přes pdf.js jako obrázek (správná strana i na mobilu); selže-li, <iframe>. */
function PdfPage({ page, index, zoom, onZoom }: { page: ViewerPage; index: number; zoom: boolean; onZoom: () => void }) {
  const img = usePdfThumb(page.url, page.page ?? 1, 1000);
  if (img.failed) {
    return <iframe key={page.key} title={`Stránka ${index + 1}: ${page.name}`} src={pdfSrc(page) ?? undefined} className="h-full min-h-[50vh] w-full bg-white" />;
  }
  if (!img.src) {
    return <div className="flex h-full min-h-40 items-center justify-center text-sm text-slate-300"><FileText className="mr-2 h-5 w-5 animate-pulse" /> Načítám stranu…</div>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- vykreslená strana PDF
    <img
      key={page.key}
      src={img.src}
      alt={`Stránka ${index + 1}: ${page.name}`}
      onClick={onZoom}
      className={cn("select-none bg-white transition-[width]", zoom ? "w-[220%] max-w-none cursor-zoom-out" : "mx-auto h-full w-full cursor-zoom-in object-contain")}
      draggable={false}
    />
  );
}

/**
 * Náhled stránek dokladu vedle formuláře: přiblížení klepnutím, listování
 * šipkami / tažením prstem, miniatury. PDF na počítači přímo (prohlížeč); strana z části
 * PDF (dávka) a PDF na mobilu se vykreslí jako obrázek (pdf.js).
 */
export function CapturePages({ pages, className }: { pages: ViewerPage[]; className?: string }) {
  const [index, setIndex] = React.useState(0);
  const [zoom, setZoom] = React.useState(false);
  const touch = React.useRef<{ x: number; y: number } | null>(null);
  const coarse = useCoarsePointer();
  const count = pages.length;
  const i = Math.min(index, Math.max(0, count - 1));
  const page = pages[i];

  const go = React.useCallback((delta: number) => {
    if (count < 2) return;
    setZoom(false);
    setIndex((x) => (Math.min(x, count - 1) + delta + count) % count);
  }, [count]);

  if (!page) {
    return (
      <div className={cn("flex items-center justify-center rounded-xl bg-muted text-sm text-muted-foreground", className)}>
        Bez náhledu
      </div>
    );
  }

  return (
    <div
      className={cn("flex min-h-0 flex-col gap-2", className)}
      tabIndex={0}
      aria-label="Náhled dokladu (šipky = další stránka)"
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
        if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
      }}
    >
      <div
        className="relative min-h-0 flex-1 overflow-auto rounded-xl bg-slate-800 shadow-inner dark:bg-slate-950"
        onTouchStart={(e) => {
          const t = e.touches[0];
          touch.current = t ? { x: t.clientX, y: t.clientY } : null;
        }}
        onTouchEnd={(e) => {
          const start = touch.current;
          const t = e.changedTouches[0];
          touch.current = null;
          if (!start || !t || zoom) return;
          const dx = t.clientX - start.x;
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(t.clientY - start.y)) go(dx < 0 ? 1 : -1);
        }}
      >
        {page.file ? (
          <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 p-4 text-center text-sm text-slate-200">
            {page.file.cad ? <Box className="h-12 w-12 text-purple-300" /> : <Paperclip className="h-10 w-10" />}
            <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide">{page.file.format ?? "Soubor"}</span>
            <span className="max-w-full break-all text-xs text-slate-300">{page.name}</span>
            <span className="text-xs text-slate-400">Bez náhledu — uloží se jako soubor zakázky.</span>
            {page.url && (
              <a href={page.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white hover:bg-white/25">
                <Download className="h-3.5 w-3.5" /> Stáhnout
              </a>
            )}
          </div>
        ) : !page.url ? (
          <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 text-sm text-slate-300">
            <ImageOff className="h-8 w-8" />
            Náhled není k dispozici
          </div>
        ) : isPdf(page) && (page.page || coarse) ? (
          <PdfPage page={page} index={i} zoom={zoom} onZoom={() => setZoom((z) => !z)} />
        ) : isPdf(page) ? (
          <iframe key={page.key} title={`Stránka ${i + 1}: ${page.name}`} src={pdfSrc(page) ?? undefined} className="h-full min-h-[50vh] w-full bg-white" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- místní náhled / podepsaná URL
          <img
            key={page.key}
            src={page.url}
            alt={`Stránka ${i + 1}: ${page.name}`}
            onClick={() => setZoom((z) => !z)}
            className={cn(
              "select-none transition-[width]",
              zoom ? "w-[220%] max-w-none cursor-zoom-out" : "mx-auto h-full w-full cursor-zoom-in object-contain",
            )}
            draggable={false}
          />
        )}

        <div className="pointer-events-none absolute inset-x-2 top-2 flex items-center justify-between gap-2">
          {count > 1 ? (
            <span className="rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium tabular-nums text-white">
              {i + 1} / {count}
            </span>
          ) : <span />}
          <span className="pointer-events-auto flex gap-1">
            {!isPdf(page) && !page.file && page.url && (
              <button
                type="button"
                onClick={() => setZoom((z) => !z)}
                className="rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80"
                aria-label={zoom ? "Oddálit" : "Přiblížit"}
                title={zoom ? "Oddálit" : "Přiblížit"}
              >
                {zoom ? <ZoomOut className="h-4 w-4" /> : <ZoomIn className="h-4 w-4" />}
              </button>
            )}
            {page.url && !page.file && (
              <a
                href={pdfSrc(page) ?? page.url}
                target="_blank"
                rel="noreferrer"
                className="rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80"
                aria-label="Otevřít v novém okně"
                title="Otevřít v novém okně"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
          </span>
        </div>

        {count > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/55 p-2 text-white shadow hover:bg-black/80"
              aria-label="Předchozí stránka"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/55 p-2 text-white shadow hover:bg-black/80"
              aria-label="Další stránka"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        )}
      </div>

      {count > 1 && (
        <div className="flex shrink-0 gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
          {pages.map((p, n) => (
            <button
              key={p.key}
              type="button"
              onClick={() => { setZoom(false); setIndex(n); }}
              aria-label={`Stránka ${n + 1}`}
              aria-current={n === i ? "true" : undefined}
              className={cn(
                "relative h-14 w-11 shrink-0 overflow-hidden rounded-md border-2 bg-muted transition",
                n === i ? "border-rose-500 ring-2 ring-rose-500/30" : "border-transparent opacity-70 hover:opacity-100",
              )}
            >
              {p.file ? (
                p.file.cad ? <Box className="m-auto h-5 w-5 text-purple-500" /> : <Paperclip className="m-auto h-5 w-5 text-slate-500" />
              ) : p.url && !isPdf(p) ? (
                // eslint-disable-next-line @next/next/no-img-element -- miniatura
                <img src={p.url} alt="" className="h-full w-full object-cover" />
              ) : (
                <FileText className="m-auto h-5 w-5 text-red-500" />
              )}
              <span className="absolute bottom-0 right-0 rounded-tl bg-black/60 px-1 text-[9px] font-semibold text-white">{n + 1}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
