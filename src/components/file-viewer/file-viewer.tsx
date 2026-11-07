"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, ArrowLeft, Box, ChevronLeft, ChevronRight, Download, ExternalLink, FileQuestion, FileText, Loader2, Printer } from "lucide-react";
import { filenameFromDisposition, sniffFile, type Sniffed } from "@/lib/viewer3d/sniff";
import { pdfHas3D } from "@/lib/viewer3d/formats/pdf3d";
import { printModeFor, safePrintSrc } from "@/lib/print/print-links";
import { printDocument } from "@/components/print/print-action";
import { cn } from "@/lib/utils";
import { PdfView } from "./pdf-view";
import { ImageView } from "./image-view";
import { downloadHref, standaloneViewerHref } from "./viewer-links";
import { RasterView, isServerRasterBytes, rasterPreviewHref, type RasterState } from "./raster-view";
import { swipeAllowed, swipeDirection, swipeGateOf, type SwipeGate, type SwipePoint } from "./swipe";
import { drawingNumberText, drawingQuantityText, isServerRasterName, type DrawingInfo } from "@/lib/jobs/drawing-set";

// three.js + OpenCascade jen když se otevírá 3D model
const ModelViewer = dynamic(() => import("@/components/viewer3d/model-viewer").then((m) => m.ModelViewer), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" /> Spouštím 3D prohlížeč…
    </div>
  ),
});

export interface ViewerRequest {
  /** Vlastní /api/… adresa souboru (u `blob` jen identifikace). */
  href: string;
  filename?: string | null;
  /** Už stažený obsah (např. náhled PDF vytvořený na serveru) — nestahuje se znovu. */
  blob?: Blob;
  /** Vlastní tlačítka v hlavičce (jen při otevření z kódu, např. „Mít vedle" na Nacenění). */
  toolbar?: React.ReactNode;
  /** Výkres zakázky: číslo, název, počet kusů a materiál navázané položky (bez cen). */
  info?: DrawingInfo | null;
}

/** Listování sadou výkresů (swipe, ‹ ›, šipky). */
export interface ViewerNav {
  index: number;
  count: number;
  prev: () => void;
  next: () => void;
}

interface Loaded {
  bytes: Uint8Array;
  blobUrl: string;
  filename: string;
  sniffed: Sniffed;
  has3D: boolean;
  contentType: string;
}

function fmtSize(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} kB`;
  return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

async function readWithProgress(res: Response, onProgress: (done: number, total: number) => void): Promise<Uint8Array> {
  const total = Number(res.headers.get("content-length") ?? 0);
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let done = 0;
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    chunks.push(r.value);
    done += r.value.length;
    onProgress(done, total);
  }
  const out = new Uint8Array(done);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Název z cesty podepsané URL úložiště (…/soubor.step?token=…). */
function filenameFromUrl(url: string): string | null {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    return /\.[a-z0-9_]{1,8}$/i.test(last) ? last.replace(/^\d{10,}[-_]/, "") : null;
  } catch {
    return null;
  }
}

/**
 * Prohlížeč souboru přes celou obrazovku: PDF (i 3D PDF), obrázky, 3D modely (STEP, IGES, STL…),
 * text; ostatní ke stažení. Nahoře vždy velké „Zpět" (i na telefonu).
 */
export function FileViewer({
  request, onBack, standalone = false, backLabel = "Zpět", toolbar, nav,
}: {
  request: ViewerRequest;
  onBack: () => void;
  standalone?: boolean;
  /** Text tlačítka vlevo nahoře (panel vedle stránky: „Zavřít"). */
  backLabel?: string;
  /** Vlastní tlačítka v hlavičce (před tiskem a stažením). */
  toolbar?: React.ReactNode;
  /** Sada výkresů zakázky — swipe / ‹ › / šipky na další výkres. */
  nav?: ViewerNav;
}) {
  // TIFF / HEIC dokumentu zakázky: originál se nestahuje, náhled strany připraví server
  const rasterDirect = !request.blob && isServerRasterName(request.filename) && rasterPreviewHref(request.href, 1) !== null;
  const [raster, setRaster] = React.useState<RasterState | null>(null);
  const [state, setState] = React.useState<{ loading: true; done: number; total: number } | { loading: false; error: string } | { loading: false; data: Loaded }>({ loading: true, done: 0, total: 0 });
  const [mode, setMode] = React.useState<"3d" | "pages">("3d");

  React.useEffect(() => {
    if (rasterDirect) return;
    const ac = new AbortController();
    let blobUrl: string | null = null;
    (async () => {
      try {
        if (request.blob) {
          const bytes = new Uint8Array(await request.blob.arrayBuffer());
          const filename = request.filename || "dokument";
          const sniffed = sniffFile(bytes, filename, request.blob.type);
          blobUrl = URL.createObjectURL(request.blob);
          setState({ loading: false, data: { bytes, blobUrl, filename, sniffed, has3D: sniffed.kind === "pdf" && pdfHas3D(bytes), contentType: request.blob.type } });
          return;
        }
        const res = await fetch(request.href, { signal: ac.signal, credentials: "same-origin" });
        if (!res.ok) {
          let msg = `Soubor se nepodařilo načíst (chyba ${res.status}).`;
          try {
            const j = (await res.json()) as { error?: string };
            if (j?.error) msg = j.error;
          } catch {
            /* tělo není JSON */
          }
          if (res.status === 401) msg = "Přihlášení vypršelo — obnov stránku a přihlas se znovu.";
          setState({ loading: false, error: msg });
          return;
        }
        const ct = res.headers.get("content-type") ?? "";
        const bytes = await readWithProgress(res, (done, total) => setState({ loading: true, done, total }));
        const filename = request.filename || filenameFromDisposition(res.headers.get("content-disposition")) || filenameFromUrl(res.url) || "soubor";
        const sniffed = sniffFile(bytes, filename, ct);
        const mime = sniffed.kind === "pdf" ? "application/pdf" : sniffed.kind === "image" ? (ct.startsWith("image/") ? ct : "image/*") : ct || "application/octet-stream";
        blobUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
        const has3D = sniffed.kind === "pdf" && pdfHas3D(bytes);
        setState({ loading: false, data: { bytes, blobUrl, filename, sniffed, has3D, contentType: ct } });
      } catch (e) {
        if (ac.signal.aborted) return;
        setState({ loading: false, error: e instanceof Error && e.name !== "TypeError" ? e.message : "Spojení se nepovedlo — zkontroluj internet a zkus to znovu." });
      }
    })();
    return () => {
      ac.abort();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [request.href, request.filename, request.blob, rasterDirect]);

  const data = "data" in state ? state.data : null;
  // TIFF / HEIC poznaný až podle obsahu (bez přípony) → náhled ze serveru, jinak ke stažení
  const rasterLate = Boolean(data && isServerRasterBytes(data.bytes));
  const rasterMode = rasterDirect || (rasterLate && rasterPreviewHref(request.href, 1) !== null);
  const title = data?.filename ?? request.filename ?? "Dokument";
  const isModel = data?.sniffed.kind === "model" || !!data?.has3D;
  const modelBytes = React.useMemo(() => (data && (data.sniffed.kind === "model" || data.has3D) ? (data.bytes.buffer as ArrayBuffer) : null), [data]);
  // tisk: PDF (u 3D PDF v režimu Stránky), obrázky, text — 3D model má vlastní „Tisknout pohled"
  const printable = Boolean(data) && !rasterLate && (data!.sniffed.kind === "pdf" || data!.sniffed.kind === "image" || data!.sniffed.kind === "text") && !(data!.has3D && mode === "3d");
  const print = React.useCallback(() => {
    if (!data) return;
    const href = request.blob ? null : safePrintSrc(request.href);
    // telefon: tisková stránka (vlastní „Tisknout" i „Zpět"); počítač: už stažený obsah, dialog hned
    if (href && printModeFor(navigator.userAgent, navigator.maxTouchPoints ?? 0) === "page") {
      void printDocument({ href, filename: data.filename });
      return;
    }
    const type = data.sniffed.kind === "pdf" ? "application/pdf" : data.contentType || "";
    void printDocument({ blob: request.blob ?? new Blob([data.bytes as BlobPart], { type }), filename: data.filename });
  }, [data, request.blob, request.href]);

  // Ctrl+P / Cmd+P v prohlížeči vytiskne dokument, ne stránku aplikace
  React.useEffect(() => {
    if (!printable) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        e.stopPropagation();
        print();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [printable, print]);

  // listování výkresy: šipky ← → (ne v poli formuláře, ne když šipky posouvají přiblížené PDF)
  const contentRef = React.useRef<HTMLDivElement>(null);
  const navRef = React.useRef(nav);
  navRef.current = nav;
  const hasNav = Boolean(nav);
  React.useEffect(() => {
    if (!hasNav) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const pdf = contentRef.current?.querySelector<HTMLElement>("[data-testid=pdf-view]");
      if (pdf && pdf.scrollWidth > pdf.clientWidth + 2) return;
      e.preventDefault();
      if (e.key === "ArrowLeft") navRef.current?.prev();
      else navRef.current?.next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasNav]);

  // swipe jedním prstem (dva prsty = přiblížení → swipe se ruší)
  React.useEffect(() => {
    const root = contentRef.current;
    if (!root || !hasNav) return;
    let start: (SwipePoint & { gate: SwipeGate; scroller: Element | null }) | null = null;
    let cancelled = false;
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        cancelled = true;
        start = null;
        return;
      }
      cancelled = false;
      const p = e.touches[0];
      const { gate, scroller } = swipeGateOf(e.target, root);
      start = { x: p.clientX, y: p.clientY, t: Date.now(), gate, scroller };
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length > 1) cancelled = true;
    };
    const onEnd = (e: TouchEvent) => {
      const s = start;
      if (e.touches.length === 0) start = null;
      if (!s || cancelled || e.touches.length > 0) return;
      const p = e.changedTouches[0];
      if (!p) return;
      const dir = swipeDirection(s, { x: p.clientX, y: p.clientY, t: Date.now() });
      if (!dir || !swipeAllowed(s.gate, dir, s.scroller ? s.scroller.scrollLeft : null)) return;
      if (dir === 1) navRef.current?.next();
      else navRef.current?.prev();
    };
    const onCancel = () => {
      start = null;
      cancelled = false;
    };
    root.addEventListener("touchstart", onStart, { passive: true, capture: true });
    root.addEventListener("touchmove", onMove, { passive: true, capture: true });
    root.addEventListener("touchend", onEnd, { passive: true, capture: true });
    root.addEventListener("touchcancel", onCancel, { passive: true, capture: true });
    return () => {
      root.removeEventListener("touchstart", onStart, { capture: true });
      root.removeEventListener("touchmove", onMove, { capture: true });
      root.removeEventListener("touchend", onEnd, { capture: true });
      root.removeEventListener("touchcancel", onCancel, { capture: true });
    };
  }, [hasNav]);

  const info = request.info ?? null;
  const infoNumber = drawingNumberText(info);
  const infoQty = drawingQuantityText(info);
  const subtitle = rasterMode
    ? `${/\.hei[cf]$/i.test(title) ? "HEIC" : "TIFF"}${raster?.pages && raster.pages > 1 ? ` · ${raster.pages} ${raster.pages < 5 ? "strany" : "stran"}` : ""}`
    : data ? `${data.has3D ? "3D PDF" : data.sniffed.label} · ${fmtSize(data.bytes.length)}` : null;

  return (
    <div className="flex h-full flex-col bg-background" data-testid="file-viewer">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-card px-2 pt-[env(safe-area-inset-top)] sm:px-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 active:scale-[0.98]"
          data-testid="viewer-back"
        >
          <ArrowLeft className="h-5 w-5" /> {backLabel}
        </button>
        <div className="min-w-0 flex-1 px-1">
          <p className="truncate text-sm font-semibold" title={title}>{title}</p>
          {subtitle && <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p>}
        </div>
        {nav && (
          <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-xs font-semibold tabular-nums" data-testid="viewer-counter" aria-label={`Výkres ${nav.index + 1} z ${nav.count}`}>
            {nav.index + 1} / {nav.count}
          </span>
        )}
        {data?.has3D && (
          <div className="flex shrink-0 rounded-lg border p-0.5 text-xs font-medium" role="tablist" aria-label="Zobrazení 3D PDF">
            <button type="button" role="tab" aria-selected={mode === "3d"} onClick={() => setMode("3d")} className={cn("inline-flex h-9 items-center gap-1 rounded-md px-2", mode === "3d" ? "bg-foreground text-background" : "hover:bg-accent")}>
              <Box className="h-3.5 w-3.5" /> 3D
            </button>
            <button type="button" role="tab" aria-selected={mode === "pages"} onClick={() => setMode("pages")} className={cn("inline-flex h-9 items-center gap-1 rounded-md px-2", mode === "pages" ? "bg-foreground text-background" : "hover:bg-accent")}>
              <FileText className="h-3.5 w-3.5" /> Stránky
            </button>
          </div>
        )}
        {toolbar ?? request.toolbar}
        {printable && (
          <button
            type="button"
            onClick={print}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-accent"
            aria-label="Tisknout"
            title="Tisknout (Ctrl+P)"
            data-testid="viewer-print"
          >
            <Printer className="h-5 w-5" />
          </button>
        )}
        {rasterMode && (
          <a
            href={downloadHref(request.href)}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-accent"
            aria-label="Stáhnout originál"
            title="Stáhnout originál"
            data-no-viewer=""
          >
            <Download className="h-5 w-5" />
          </a>
        )}
        {data && !rasterMode && (
          <a
            href={data.blobUrl}
            download={data.filename}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-accent"
            aria-label="Stáhnout"
            title="Stáhnout"
            data-no-viewer=""
          >
            <Download className="h-5 w-5" />
          </a>
        )}
        {!standalone && !request.blob && (
          <a
            href={standaloneViewerHref(request.href, data?.filename ?? request.filename)}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-accent sm:inline-flex"
            aria-label="Otevřít v novém okně"
            title="Otevřít v novém okně"
            data-no-viewer=""
          >
            <ExternalLink className="h-5 w-5" />
          </a>
        )}
      </header>

      {info && (infoNumber || info.name || infoQty || info.material) && (
        // výkres zakázky: počet kusů a materiál z položky (nahoře, ať je vidět i na telefonu)
        <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b bg-muted/40 px-3 py-1.5 text-xs scrollbar-thin" data-testid="viewer-drawing-info">
          {infoNumber && <span className="shrink-0 font-mono font-semibold" data-field="drawing">{infoNumber}</span>}
          {info.name && <span className="min-w-0 max-w-[45%] shrink truncate text-muted-foreground" data-field="name">{info.name}</span>}
          {infoQty && (
            <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary tabular-nums" data-field="quantity">{infoQty}</span>
          )}
          {info.material && (
            <span className="shrink-0 rounded-full bg-background px-2 py-0.5 font-medium ring-1 ring-border" data-field="material">
              <span className="text-muted-foreground">Materiál</span> {info.material}
            </span>
          )}
        </div>
      )}

      <div ref={contentRef} className="relative min-h-0 flex-1" data-testid="viewer-content">
        {rasterMode ? (
          <RasterView href={request.href} filename={title} onState={setRaster} />
        ) : state.loading ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span>
              Stahuji soubor…{" "}
              {state.done > 0 && (state.total ? `${fmtSize(state.done)} / ${fmtSize(state.total)}` : fmtSize(state.done))}
            </span>
            {state.total > 0 && (
              <div className="h-1.5 w-56 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary transition-all" style={{ width: `${Math.round((state.done / state.total) * 100)}%` }} />
              </div>
            )}
          </div>
        ) : "error" in state ? (
          <Message icon={AlertTriangle} tone="text-amber-500" title="Soubor nejde otevřít" text={state.error} />
        ) : data && isModel && modelBytes ? (
          <>
            {/* 3D zůstává načtené i při přepnutí na stránky PDF */}
            <div className={cn("absolute inset-0", data.has3D && mode === "pages" && "invisible")}>
              <ModelViewer
                bytes={modelBytes}
                format={data.has3D ? "pdf" : data.sniffed.format!}
                name={data.filename}
                formatLabel={data.has3D ? "3D PDF" : data.sniffed.label}
              />
            </div>
            {data.has3D && mode === "pages" && (
              <div className="absolute inset-0">
                <PdfView data={data.bytes} />
              </div>
            )}
          </>
        ) : data && rasterLate ? (
          <Message
            icon={FileQuestion}
            tone="text-muted-foreground"
            title="Náhled TIFF / HEIC tady neumím"
            text="Soubor si stáhni a otevři v programu, který ho umí."
            action={<a href={data.blobUrl} download={data.filename} data-no-viewer="" className="mt-3 inline-flex h-10 items-center gap-2 rounded-lg bg-foreground px-4 text-sm font-medium text-background"><Download className="h-4 w-4" /> Stáhnout {data.filename}</a>}
          />
        ) : data?.sniffed.kind === "pdf" ? (
          <PdfView data={data.bytes} />
        ) : data?.sniffed.kind === "image" ? (
          <ImageView src={data.blobUrl} alt={data.filename} />
        ) : data?.sniffed.kind === "text" ? (
          <pre className="h-full overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs">{new TextDecoder().decode(data.bytes.subarray(0, 2_000_000))}</pre>
        ) : data ? (
          <Message
            icon={FileQuestion}
            tone="text-muted-foreground"
            title={`Náhled formátu ${data.sniffed.label} zatím neumím`}
            text="Soubor si stáhni a otevři v programu, který ho umí (Word, Excel, CAD…)."
            action={<a href={data.blobUrl} download={data.filename} data-no-viewer="" className="mt-3 inline-flex h-10 items-center gap-2 rounded-lg bg-foreground px-4 text-sm font-medium text-background"><Download className="h-4 w-4" /> Stáhnout {data.filename}</a>}
          />
        ) : null}
        {nav && (
          <>
            <button
              type="button"
              onClick={nav.prev}
              className="absolute left-1.5 top-1/2 z-10 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border bg-background/85 shadow-md backdrop-blur hover:bg-accent sm:left-3"
              aria-label="Předchozí výkres"
              title="Předchozí výkres (←)"
              data-testid="viewer-prev"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={nav.next}
              className="absolute right-1.5 top-1/2 z-10 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border bg-background/85 shadow-md backdrop-blur hover:bg-accent sm:right-3"
              aria-label="Další výkres"
              title="Další výkres (→)"
              data-testid="viewer-next"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Message({ icon: Icon, tone, title, text, action }: { icon: React.ComponentType<{ className?: string }>; tone: string; title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md rounded-xl border bg-card p-6 text-center shadow-sm" role="alert">
        <Icon className={cn("mx-auto h-8 w-8", tone)} />
        <p className="mt-2 font-semibold">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{text}</p>
        {action}
      </div>
    </div>
  );
}
