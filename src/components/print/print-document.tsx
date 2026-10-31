"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ArrowLeft, Loader2, Printer } from "lucide-react";
import { extensionOf, filenameFromDisposition, sniffFile } from "@/lib/viewer3d/sniff";
import { loadPdfJs } from "@/components/file-viewer/pdfjs";
import {
  isMobileUa, isRasterPreview, maxPagePixels, orientationOf, pageRenderScale, paperLabel, printabilityOf, printDpi,
  rasterFallbackSrc, rasterPageUrl, type Orientation,
} from "@/lib/print/print-links";

/**
 * Vykreslení dokumentu k tisku: PDF po stranách přes pdf.js do obrázků (~200 dpi, na telefonu méně),
 * obrázky přímo, HEIC / TIFF přes serverový náhled, text jako text. Strany jdou do #mn-print-out
 * (přímý potomek <body>) — tiskové CSS (globals.css) při tisku skryje vše ostatní (lišty aplikace,
 * dialogy, debug lištu). Režimy:
 *  - "page": tisková stránka /print (náhled stran, „Tisknout" a „Zpět", tisk se otevře sám),
 *  - "embed": tatáž stránka ve skrytém rámu na počítači (zprávy rodiči přes onEvent),
 *  - "hidden": tisk z aplikace bez opuštění stránky (obsah už v paměti, např. náhled z dialogu).
 */

export type PrintMode = "page" | "embed" | "hidden";

export interface PrintSource {
  /** Vlastní /api/… adresa (ověřená safePrintSrc). */
  src?: string | null;
  /** Obsah už v paměti (náhled vytvořený na serveru, snímek 3D pohledu). */
  bytes?: Uint8Array;
  contentType?: string | null;
  name?: string | null;
}

export type PrintEvent =
  | { type: "progress"; done: number; total: number }
  | { type: "ready"; pages: number }
  | { type: "printed" }
  | { type: "error"; message: string };

interface PageImg {
  url: string;
  /** Rozměr strany (body PDF nebo px obrázku) — jen pro orientaci a popis papíru. */
  w: number;
  h: number;
  pdf: boolean;
}

type Phase =
  | { phase: "download"; done: number; total: number }
  | { phase: "render"; done: number; total: number }
  | { phase: "ready" }
  | { phase: "error"; message: string };

const MAX_RASTER_PAGES = 300;

function fmtSize(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} kB`;
  return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

async function errorFrom(res: Response): Promise<string> {
  if (res.status === 401) return "Přihlášení vypršelo — obnov stránku a přihlas se znovu.";
  try {
    const j = (await res.json()) as { error?: string };
    if (j?.error) return j.error;
  } catch {
    /* tělo není JSON */
  }
  return res.status === 403 ? "K tomuto dokumentu nemáš oprávnění." : `Dokument se nepodařilo načíst (chyba ${res.status}).`;
}

async function readAll(res: Response, onProgress: (done: number, total: number) => void, signal: AbortSignal): Promise<Uint8Array> {
  const total = Number(res.headers.get("content-length") ?? 0);
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let done = 0;
  for (;;) {
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
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

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (canvas.toBlob) {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Stranu se nepodařilo vykreslit (málo paměti?)."))), "image/png");
      return;
    }
    fetch(canvas.toDataURL("image/png")).then((r) => r.blob()).then(resolve, reject);
  });
}

/** Načte obrázek a vrátí jeho rozměr; null = prohlížeč formát neumí (HEIC v Chrome, TIFF…). */
function decodeImage(url: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => {
      const done = () => resolve(im.naturalWidth > 0 ? { w: im.naturalWidth, h: im.naturalHeight } : null);
      if (typeof im.decode === "function") im.decode().then(done, done);
      else done();
    };
    im.onerror = () => resolve(null);
    im.src = url;
  });
}

function isHeicOrTiff(bytes: Uint8Array, name: string | null | undefined): "heic" | "tiff" | null {
  const ext = extensionOf(name);
  if (ext === "heic" || ext === "heif") return "heic";
  if (ext === "tif" || ext === "tiff") return "tiff";
  if (bytes.length > 12) {
    if ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0) || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && bytes[3] === 0x2a)) return "tiff";
    const ftyp = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (ftyp === "ftyp" && /^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(brand)) return "heic";
  }
  return null;
}

function looksLikeDxf(bytes: Uint8Array): boolean {
  const head = new TextDecoder().decode(bytes.subarray(0, 256)).replace(/\r/g, "");
  return /^\s*0\s*\n\s*SECTION\s*\n/.test(head) || head.startsWith("AutoCAD Binary DXF");
}

function useMobile(): boolean {
  const [m] = React.useState(() => (typeof navigator === "undefined" ? false : isMobileUa(navigator.userAgent, navigator.maxTouchPoints ?? 0)));
  return m;
}

export function PrintDocument({
  source, mode, autoPrint = true, onBack, onEvent,
}: {
  source: PrintSource;
  mode: PrintMode;
  autoPrint?: boolean;
  onBack?: () => void;
  onEvent?: (e: PrintEvent) => void;
}) {
  const mobile = useMobile();
  const [phase, setPhase] = React.useState<Phase>({ phase: "download", done: 0, total: 0 });
  const [pages, setPages] = React.useState<PageImg[]>([]);
  const [text, setText] = React.useState<string | null>(null);
  const [title, setTitle] = React.useState<string>(source.name || "Dokument");
  const [out, setOut] = React.useState<HTMLElement | null>(null);
  const printed = React.useRef(false);
  const eventRef = React.useRef(onEvent);
  eventRef.current = onEvent;
  const emit = React.useCallback((e: PrintEvent) => eventRef.current?.(e), []);

  // kontejner stran = přímý potomek <body> (tiskové CSS skryje všechno ostatní) + značka na <html>
  React.useEffect(() => {
    const el = document.createElement("div");
    el.id = "mn-print-out";
    el.setAttribute("data-testid", "print-out");
    document.body.appendChild(el);
    document.documentElement.setAttribute("data-mn-print", mode);
    setOut(el);
    return () => {
      el.remove();
      if (document.documentElement.getAttribute("data-mn-print") === mode) document.documentElement.removeAttribute("data-mn-print");
    };
  }, [mode]);

  // načtení a vykreslení
  React.useEffect(() => {
    const ac = new AbortController();
    const urls: string[] = [];
    // nový zdroj (i druhé spuštění efektu ve vývojovém StrictMode) začíná od nuly
    setPages([]);
    setText(null);
    setPhase({ phase: "download", done: 0, total: 0 });
    printed.current = false;
    const add = (p: PageImg) => {
      if (ac.signal.aborted) {
        URL.revokeObjectURL(p.url);
        return;
      }
      urls.push(p.url);
      setPages((cur) => [...cur, p]);
    };
    const fail = (message: string) => {
      if (ac.signal.aborted) return;
      setPhase({ phase: "error", message });
      emit({ type: "error", message });
    };

    /**
     * Serverový náhled po stranách (?page=n): počet stran předem neznáme → do první chybějící strany.
     * Jednostránkový obrázek route vrací pro každé n stejný → shodná strana = konec.
     */
    async function rasterPages(src: string, maxPages = MAX_RASTER_PAGES): Promise<number> {
      let n = 0;
      let prevSig = "";
      for (let page = 1; page <= maxPages; page++) {
        if (ac.signal.aborted) return n;
        setPhase({ phase: "render", done: n, total: 0 });
        emit({ type: "progress", done: n, total: 0 });
        const res = await fetch(rasterPageUrl(src, page, mobile ? 1800 : 2400), { signal: ac.signal, credentials: "same-origin" });
        if (!res.ok) {
          if (page === 1) throw new Error(await errorFrom(res));
          break; // za poslední stranou
        }
        const blob = await res.blob();
        const head = new Uint8Array(await blob.slice(Math.max(0, blob.size - 256)).arrayBuffer());
        const sig = `${blob.size}:${Array.from(head).join(",")}`;
        if (sig === prevSig) break;
        prevSig = sig;
        const url = URL.createObjectURL(blob);
        const size = await decodeImage(url);
        if (!size) {
          URL.revokeObjectURL(url);
          if (page === 1) throw new Error("Náhled dokumentu se nepodařilo vykreslit.");
          break;
        }
        add({ url, w: size.w, h: size.h, pdf: false });
        n++;
      }
      return n;
    }

    async function pdfPages(bytes: Uint8Array): Promise<number> {
      const pdfjs = await loadPdfJs();
      let doc;
      try {
        doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(/password/i.test(msg) ? "PDF je chráněné heslem — stáhni ho a vytiskni z prohlížeče PDF." : "PDF se nepodařilo načíst (soubor je poškozený?).");
      }
      try {
        const total = doc.numPages;
        // dlouhé dokumenty: nižší rozlišení (paměť telefonu)
        const dpi = mobile ? (total > 30 ? 110 : printDpi(true)) : total > 100 ? 150 : printDpi(false);
        const maxPx = maxPagePixels(mobile);
        for (let i = 1; i <= total; i++) {
          if (ac.signal.aborted) return i - 1;
          setPhase({ phase: "render", done: i - 1, total });
          emit({ type: "progress", done: i - 1, total });
          const page = await doc.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const vp = page.getViewport({ scale: pageRenderScale(base.width, base.height, dpi, maxPx) });
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.floor(vp.width));
          canvas.height = Math.max(1, Math.floor(vp.height));
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Prohlížeč nemá dost paměti na vykreslení strany.");
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, viewport: vp, intent: "print" }).promise;
          const blob = await canvasToBlob(canvas);
          canvas.width = 0;
          canvas.height = 0;
          page.cleanup();
          add({ url: URL.createObjectURL(blob), w: base.width, h: base.height, pdf: true });
        }
        return total;
      } finally {
        void doc.destroy();
      }
    }

    (async () => {
      try {
        const name = source.name ?? null;
        const pre = printabilityOf(name);
        if (!pre.ok) return fail(pre.hint);
        let count = 0;
        if (!source.bytes && source.src && isRasterPreview(source.src)) {
          count = await rasterPages(source.src);
        } else {
          let bytes: Uint8Array;
          let ct = source.contentType ?? "";
          let filename = name;
          if (source.bytes) {
            bytes = source.bytes;
          } else if (source.src) {
            const res = await fetch(source.src, { signal: ac.signal, credentials: "same-origin" });
            if (!res.ok) return fail(await errorFrom(res));
            ct = res.headers.get("content-type") ?? "";
            filename = name || filenameFromDisposition(res.headers.get("content-disposition"));
            if (filename && !name) setTitle(filename);
            bytes = await readAll(res, (done, total) => setPhase({ phase: "download", done, total }), ac.signal);
          } else {
            return fail("Chybí dokument k tisku.");
          }
          const after = printabilityOf(filename);
          if (!after.ok) return fail(after.hint);
          const sniffed = sniffFile(bytes, filename, ct);
          const special = isHeicOrTiff(bytes, filename);
          if (sniffed.kind === "pdf") {
            count = await pdfPages(bytes);
          } else if (special === "tiff" && source.src && rasterFallbackSrc(source.src)) {
            // vícestránkový TIFF (sken): všechny strany ze serveru (prohlížeč ukáže nanejvýš první)
            count = await rasterPages(rasterFallbackSrc(source.src)!);
          } else if (sniffed.kind === "image" || special) {
            const mime = special === "heic" ? "image/heic" : special === "tiff" ? "image/tiff" : ct.startsWith("image/") ? ct : "image/png";
            const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
            const size = await decodeImage(url);
            if (size) {
              add({ url, w: size.w, h: size.h, pdf: false });
              count = 1;
            } else {
              URL.revokeObjectURL(url);
              const fb = source.src ? rasterFallbackSrc(source.src) : null;
              if (!fb) return fail(special ? `Obrázek ${special.toUpperCase()} tento prohlížeč neumí vykreslit — otevři ho v telefonu (Fotky) nebo ho ulož jako JPEG či PDF.` : "Obrázek se nepodařilo načíst (soubor je poškozený?).");
              count = await rasterPages(fb, special === "tiff" ? MAX_RASTER_PAGES : 1);
            }
          } else if (sniffed.kind === "text" && !looksLikeDxf(bytes)) {
            setText(new TextDecoder().decode(bytes.subarray(0, 2_000_000)));
            count = 1;
          } else if (sniffed.kind === "model") {
            return fail("3D model: otevři ho a použij „Tisknout pohled“.");
          } else if (looksLikeDxf(bytes)) {
            return fail("DXF vytiskneš po uložení jako PDF.");
          } else {
            return fail(`Formát ${sniffed.label} nejde vytisknout přímo — stáhni ho a vytiskni z programu, který ho umí.`);
          }
        }
        if (ac.signal.aborted) return;
        if (count === 0) return fail("Dokument nemá žádnou stranu k tisku.");
        setPhase({ phase: "ready" });
        emit({ type: "ready", pages: count });
      } catch (e) {
        if (ac.signal.aborted) return;
        fail(e instanceof Error && e.name !== "TypeError" ? e.message : "Spojení se nepovedlo — zkontroluj internet a zkus to znovu.");
      }
    })();
    return () => {
      ac.abort();
      for (const u of urls) URL.revokeObjectURL(u);
    };
  }, [source.src, source.bytes, source.name, source.contentType, mobile, emit]);

  // orientace papíru: první strana; smíšené dokumenty přes pojmenované strany (globals.css)
  const firstOrient: Orientation = pages[0] ? orientationOf(pages[0].w, pages[0].h) : "portrait";
  React.useEffect(() => {
    const st = document.createElement("style");
    st.id = "mn-print-page-style";
    st.textContent = `@media print{@page{size:${text !== null ? "portrait" : firstOrient};margin:0}@page mn-landscape{size:landscape;margin:0}@page mn-portrait{size:portrait;margin:0}}`;
    document.head.appendChild(st);
    return () => st.remove();
  }, [firstOrient, text]);

  const doPrint = React.useCallback(() => {
    printed.current = true;
    try {
      window.print();
    } finally {
      emit({ type: "printed" });
    }
  }, [emit]);

  // po vykreslení všech stran (obrázky dekódované) se tisk otevře sám
  const ready = phase.phase === "ready";
  React.useEffect(() => {
    if (!ready || !autoPrint || printed.current) return;
    let cancelled = false;
    const imgs = Array.from(out?.querySelectorAll("img") ?? []);
    Promise.all(imgs.map((im) => (im.complete && im.naturalWidth > 0 ? Promise.resolve() : im.decode?.().catch(() => undefined))))
      .then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
      .then(() => {
        if (!cancelled && !printed.current) doPrint();
      });
    return () => {
      cancelled = true;
    };
  }, [ready, autoPrint, out, doPrint]);

  // po zavření tiskového dialogu (i Zrušit)
  React.useEffect(() => {
    const after = () => emit({ type: "printed" });
    window.addEventListener("afterprint", after);
    return () => window.removeEventListener("afterprint", after);
  }, [emit]);

  const n = text !== null ? 1 : pages.length;
  const paper = pages[0] && pages[0].pdf ? paperLabel(pages[0].w, pages[0].h) : null;
  const mixed = pages.some((p) => orientationOf(p.w, p.h) !== firstOrient);

  const portal = out
    ? createPortal(
        <>
          {text !== null ? (
            <pre className="mn-print-text">{text}</pre>
          ) : (
            pages.map((p, i) => (
              <div key={p.url} className="mn-print-page" data-orient={orientationOf(p.w, p.h)} data-page={i + 1}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={`Strana ${i + 1}`} className="mn-print-img" />
              </div>
            ))
          )}
        </>,
        out,
      )
    : null;

  if (mode === "hidden") return portal;

  let status: React.ReactNode;
  if (phase.phase === "download") {
    status = <>Stahuji dokument…{phase.done > 0 && ` ${phase.total ? `${fmtSize(phase.done)} / ${fmtSize(phase.total)}` : fmtSize(phase.done)}`}</>;
  } else if (phase.phase === "render") {
    status = phase.total ? <>Připravuji stranu {Math.min(phase.done + 1, phase.total)} / {phase.total}…</> : <>Připravuji stranu {phase.done + 1}…</>;
  } else if (phase.phase === "ready") {
    status = <>{n} {n === 1 ? "strana" : n < 5 ? "strany" : "stran"}{paper ? ` · ${paper}` : ""}{mixed ? " (různé orientace)" : ""}</>;
  } else {
    status = null;
  }
  const pct = phase.phase === "download" && phase.total ? phase.done / phase.total : phase.phase === "render" && phase.total ? phase.done / phase.total : null;

  return (
    <>
      <div
        className="sticky top-0 z-10 border-b bg-card/95 pt-[env(safe-area-inset-top)] shadow-sm backdrop-blur"
        data-testid="print-toolbar"
        data-print-ready={ready ? "1" : undefined}
        data-print-pages={ready ? n : undefined}
      >
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-2 px-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg border bg-background px-3 text-sm font-semibold hover:bg-accent active:scale-[0.98]"
              data-testid="print-back"
            >
              <ArrowLeft className="h-5 w-5" /> Zpět
            </button>
          )}
          <div className="min-w-0 flex-1 px-1">
            <p className="truncate text-sm font-semibold" title={title}>{title}</p>
            <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground" data-testid="print-status" role="status">
              {phase.phase !== "ready" && phase.phase !== "error" && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />}
              {status}
            </p>
          </div>
          <button
            type="button"
            onClick={doPrint}
            disabled={!ready}
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50"
            data-testid="print-now"
          >
            <Printer className="h-5 w-5" /> Tisknout
          </button>
        </div>
        {ready && mode === "page" && (
          <p className="mx-auto max-w-5xl px-4 pb-2 text-center text-[11px] leading-tight text-muted-foreground">
            Tiskárnu, papír a počet kopií vybereš v dialogu tisku. Když se neotevřel sám, klepni na „Tisknout“.
          </p>
        )}
        {pct !== null && (
          <div className="h-1 w-full bg-muted">
            <div className="h-full bg-primary transition-all" style={{ width: `${Math.round(pct * 100)}%` }} />
          </div>
        )}
      </div>
      {phase.phase === "error" && (
        <div className="flex justify-center p-6">
          <div className="max-w-md rounded-xl border bg-card p-6 text-center shadow-sm" role="alert" data-testid="print-error">
            <AlertTriangle className="mx-auto h-8 w-8 text-amber-500" />
            <p className="mt-2 font-semibold">Dokument nejde vytisknout</p>
            <p className="mt-1 text-sm text-muted-foreground">{phase.message}</p>
          </div>
        </div>
      )}
      {portal}
    </>
  );
}
