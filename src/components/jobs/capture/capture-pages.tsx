"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, ExternalLink, FileText, ImageOff, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ViewerPage {
  key: string;
  /** Místní náhled nebo podepsaná URL ze serveru. */
  url: string | null;
  mimeType: string;
  name: string;
}

function isPdf(p: Pick<ViewerPage, "mimeType" | "name">): boolean {
  return p.mimeType === "application/pdf" || /\.pdf$/i.test(p.name);
}

/**
 * Náhled stránek dokladu vedle formuláře: přiblížení klepnutím, listování
 * šipkami / tažením prstem, miniatury. PDF se zobrazí přímo (prohlížeč).
 */
export function CapturePages({ pages, className }: { pages: ViewerPage[]; className?: string }) {
  const [index, setIndex] = React.useState(0);
  const [zoom, setZoom] = React.useState(false);
  const touch = React.useRef<{ x: number; y: number } | null>(null);
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
        {!page.url ? (
          <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 text-sm text-slate-300">
            <ImageOff className="h-8 w-8" />
            Náhled není k dispozici
          </div>
        ) : isPdf(page) ? (
          <iframe key={page.key} title={`Stránka ${i + 1}: ${page.name}`} src={page.url} className="h-full min-h-[50vh] w-full bg-white" />
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
            {!isPdf(page) && page.url && (
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
            {page.url && (
              <a
                href={page.url}
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
              {p.url && !isPdf(p) ? (
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
