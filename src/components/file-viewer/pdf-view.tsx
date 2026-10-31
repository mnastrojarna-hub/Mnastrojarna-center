"use client";

import * as React from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { AlertTriangle, Loader2, Minus, MoveHorizontal, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { loadPdfJs as loadLib } from "./pdfjs";

/**
 * PDF přímo v aplikaci (pdf.js) — funguje stejně na počítači i na telefonu (Android neumí PDF
 * v kartě zobrazit, iOS ho otevře bez cesty zpět). Strany se kreslí postupně podle posunu,
 * přiblížení tlačítky, Ctrl+kolečkem nebo dvěma prsty.
 */

/** Největší plátno (px²) — iOS víc nevykreslí. */
const MAX_CANVAS_PIXELS = 16_000_000;
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

export function PdfView({ data, className }: { data: Uint8Array; className?: string }) {
  const [doc, setDoc] = React.useState<PDFDocumentProxy | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [aspects, setAspects] = React.useState<number[]>([]);
  const [zoom, setZoom] = React.useState(1);
  const [width, setWidth] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const pinch = React.useRef<{ d: number; z: number } | null>(null);
  const [pinchScale, setPinchScale] = React.useState(1);

  React.useEffect(() => {
    let alive = true;
    let loaded: PDFDocumentProxy | null = null;
    loadLib()
      .then((m) => m.getDocument({ data: data.slice(), isEvalSupported: false }).promise)
      .then(async (d) => {
        loaded = d;
        if (!alive) return void d.destroy();
        const first = await d.getPage(1);
        const vp = first.getViewport({ scale: 1 });
        setAspects(Array.from({ length: d.numPages }, () => vp.height / vp.width));
        setDoc(d);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(/password/i.test(msg) ? "PDF je chráněné heslem — stáhni ho a otevři v prohlížeči PDF." : "PDF se nepodařilo zobrazit (soubor je poškozený?).");
      });
    return () => {
      alive = false;
      loaded?.destroy();
    };
  }, [data]);

  // šířka stránky = šířka okna (bez okrajů)
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const setAspect = React.useCallback((i: number, a: number) => {
    setAspects((cur) => (Math.abs((cur[i] ?? 0) - a) < 1e-3 ? cur : cur.map((x, j) => (j === i ? a : x))));
  }, []);

  const pageWidth = Math.max(200, Math.min(width - 24, 1400) * zoom);

  // Ctrl + kolečko = přiblížení
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom((z) => Math.min(4, Math.max(0.4, z * Math.exp(-e.deltaY * 0.01))));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // pinch dvěma prsty: náhled CSS zvětšením, po puštění přepočet
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      pinch.current = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z: zoom };
    }
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinch.current) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      setPinchScale(Math.min(4 / pinch.current.z, Math.max(0.4 / pinch.current.z, d / pinch.current.d)));
    }
  };
  const onTouchEnd = () => {
    if (pinch.current) {
      const z = pinch.current.z * pinchScale;
      pinch.current = null;
      setPinchScale(1);
      setZoom(Math.min(4, Math.max(0.4, z)));
    }
  };

  // aktuální strana podle posunu
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const pages = el.querySelectorAll<HTMLElement>("[data-page]");
    const mid = el.scrollTop + el.clientHeight / 3;
    let cur = 1;
    pages.forEach((p) => {
      if (p.offsetTop <= mid) cur = Number(p.dataset.page);
    });
    setPage(cur);
  };

  const step = (dir: 1 | -1) => {
    setZoom((z) => {
      const i = ZOOMS.findIndex((x) => x >= z - 1e-3);
      const idx = dir > 0 ? (ZOOMS[i] > z + 1e-3 ? i : i + 1) : i - 1;
      return ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, idx))] ?? z;
    });
  };

  return (
    <div className={cn("relative flex h-full flex-col bg-neutral-200 dark:bg-neutral-900", className)}>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        className="min-h-0 flex-1 overflow-auto overscroll-contain scrollbar-thin"
        style={{ touchAction: "pan-x pan-y" }}
        data-testid="pdf-view"
      >
        {error ? (
          <div className="flex h-full items-center justify-center p-6">
            <div className="max-w-sm rounded-xl border bg-card p-5 text-center shadow">
              <AlertTriangle className="mx-auto h-7 w-7 text-amber-500" />
              <p className="mt-2 text-sm">{error}</p>
            </div>
          </div>
        ) : !doc ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Načítám PDF…
          </div>
        ) : (
          <div
            className="mx-auto flex w-max min-w-full flex-col items-center gap-3 px-3 py-3"
            style={pinchScale !== 1 ? { transform: `scale(${pinchScale})`, transformOrigin: "top center" } : undefined}
          >
            {aspects.map((a, i) => (
              <PdfPage key={i} doc={doc} index={i} width={pageWidth} aspect={a} onAspect={setAspect} root={scrollRef} />
            ))}
          </div>
        )}
      </div>
      {doc && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border bg-card/95 px-1.5 py-1 shadow-lg backdrop-blur">
          <span className="whitespace-nowrap px-2 text-xs tabular-nums text-muted-foreground">{page} / {doc.numPages}</span>
          <button type="button" onClick={() => step(-1)} className="pointer-events-auto rounded-full p-2 hover:bg-accent" aria-label="Oddálit"><Minus className="h-4 w-4" /></button>
          <span className="w-11 text-center text-xs font-medium tabular-nums">{Math.round(zoom * 100)} %</span>
          <button type="button" onClick={() => step(1)} className="pointer-events-auto rounded-full p-2 hover:bg-accent" aria-label="Přiblížit"><Plus className="h-4 w-4" /></button>
          <button type="button" onClick={() => setZoom(1)} className="pointer-events-auto rounded-full p-2 hover:bg-accent" aria-label="Na šířku okna" title="Na šířku okna"><MoveHorizontal className="h-4 w-4" /></button>
        </div>
      )}
    </div>
  );
}

function PdfPage({
  doc, index, width, aspect, onAspect, root,
}: {
  doc: PDFDocumentProxy;
  index: number;
  width: number;
  aspect: number;
  onAspect: (i: number, a: number) => void;
  root: React.RefObject<HTMLDivElement | null>;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = React.useState(index < 2);
  const [rendered, setRendered] = React.useState<number | null>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { root: root.current, rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  React.useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
    const t = window.setTimeout(async () => {
      try {
        const pg = await doc.getPage(index + 1);
        if (cancelled) return;
        const base = pg.getViewport({ scale: 1 });
        onAspect(index, base.height / base.width);
        let dpr = Math.min(window.devicePixelRatio || 1, 2);
        let scale = (width / base.width) * dpr;
        const px = base.width * base.height * scale * scale;
        if (px > MAX_CANVAS_PIXELS) {
          const k = Math.sqrt(MAX_CANVAS_PIXELS / px);
          scale *= k;
          dpr *= k;
        }
        const vp = pg.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const off = document.createElement("canvas");
        off.width = Math.floor(vp.width);
        off.height = Math.floor(vp.height);
        const ctx = off.getContext("2d");
        if (!ctx) return;
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, off.width, off.height);
        task = pg.render({ canvasContext: ctx, viewport: vp });
        await task.promise;
        if (cancelled) return;
        canvas.width = off.width;
        canvas.height = off.height;
        canvas.getContext("2d")?.drawImage(off, 0, 0);
        setRendered(width);
        pg.cleanup();
      } catch {
        /* zrušené vykreslení při změně přiblížení */
      }
    }, 60);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
      task?.cancel();
    };
  }, [visible, width, doc, index, onAspect]);

  return (
    <div
      ref={ref}
      data-page={index + 1}
      className="relative shrink-0 bg-white shadow-md"
      style={{ width, height: Math.round(width * aspect) }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
      {rendered === null && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-neutral-400">
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Strana {index + 1}
        </div>
      )}
    </div>
  );
}
