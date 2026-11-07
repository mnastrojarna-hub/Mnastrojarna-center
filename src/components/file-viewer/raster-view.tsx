"use client";

import * as React from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Download, Loader2 } from "lucide-react";
import { ImageView } from "./image-view";
import { downloadHref } from "./viewer-links";

/**
 * TIFF (i vícestránkový) a HEIC / HEIF: prohlížeč (Chrome, Android) je sám nevykreslí — server je
 * převede na PNG / JPEG (`?view=image&page=N`, stejná kontrola přístupu jako originál). Strany TIFFu
 * se listují tlačítky nahoře; swipe přepíná výkresy zakázky. Když převod selže, zůstane hlavička se
 * „Zpět" a „Stáhnout originál".
 */

/** Adresa náhledu strany (jen dokumenty zakázky — jiné zdroje převod nemají). */
export function rasterPreviewHref(href: string, page: number): string | null {
  if (!/^\/api\/jobs\/files\/[^/?#]+(?:$|\?)/.test(href)) return null;
  const base = href.replace(/[?#].*$/, "");
  return `${base}?view=image&page=${Math.max(1, Math.floor(page) || 1)}`;
}

/** TIFF / HEIC podle obsahu (přípona chybí nebo lže). */
export function isServerRasterBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  if ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0) || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && bytes[3] === 0x2a)) return true;
  const box = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
  const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  return box === "ftyp" && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(brand);
}

export interface RasterState {
  page: number;
  pages: number | null;
}

export function RasterView({ href, filename, onState }: { href: string; filename: string; onState?: (s: RasterState) => void }) {
  const [page, setPage] = React.useState(1);
  const [pages, setPages] = React.useState<number | null>(null);
  const [state, setState] = React.useState<{ loading: true } | { loading: false; src: string } | { loading: false; error: string }>({ loading: true });

  React.useEffect(() => {
    const url = rasterPreviewHref(href, page);
    if (!url) {
      setState({ loading: false, error: "Náhled tohoto formátu tady neumím — stáhni si originál." });
      return;
    }
    const ac = new AbortController();
    let blobUrl: string | null = null;
    setState({ loading: true });
    (async () => {
      try {
        const res = await fetch(url, { signal: ac.signal, credentials: "same-origin" });
        if (!res.ok) {
          let msg = res.status === 401 ? "Přihlášení vypršelo — obnov stránku a přihlas se znovu." : `Náhled se nepodařilo připravit (chyba ${res.status}).`;
          try {
            const j = (await res.json()) as { error?: string };
            if (j?.error && res.status !== 401) msg = j.error;
          } catch {
            /* tělo není JSON */
          }
          setState({ loading: false, error: msg });
          return;
        }
        const n = Number(res.headers.get("x-page-count") ?? "");
        if (Number.isFinite(n) && n >= 1) setPages(Math.floor(n));
        blobUrl = URL.createObjectURL(await res.blob());
        setState({ loading: false, src: blobUrl });
      } catch (e) {
        if (ac.signal.aborted) return;
        setState({ loading: false, error: e instanceof Error && e.name !== "TypeError" ? e.message : "Spojení se nepovedlo — zkontroluj internet a zkus to znovu." });
      }
    })();
    return () => {
      ac.abort();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [href, page]);

  React.useEffect(() => {
    onState?.({ page, pages });
  }, [page, pages, onState]);

  return (
    <div className="relative h-full w-full" data-testid="raster-view">
      {state.loading ? (
        <div className="flex h-full items-center justify-center gap-2 bg-neutral-900 text-sm text-white/70">
          <Loader2 className="h-5 w-5 animate-spin" /> Připravuji náhled{pages && pages > 1 ? ` strany ${page}` : ""}…
        </div>
      ) : "error" in state ? (
        <div className="flex h-full items-center justify-center p-6">
          <div className="max-w-md rounded-xl border bg-card p-6 text-center shadow-sm" role="alert">
            <AlertTriangle className="mx-auto h-8 w-8 text-amber-500" />
            <p className="mt-2 font-semibold">Náhled se nepovedl</p>
            <p className="mt-1 text-sm text-muted-foreground">{state.error}</p>
            <a
              href={downloadHref(href)}
              data-no-viewer=""
              className="mt-3 inline-flex h-10 items-center gap-2 rounded-lg bg-foreground px-4 text-sm font-medium text-background"
              data-testid="raster-download"
            >
              <Download className="h-4 w-4" /> Stáhnout originál
            </a>
          </div>
        </div>
      ) : (
        <ImageView key={state.src} src={state.src} alt={filename} />
      )}
      {pages !== null && pages > 1 && (
        <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/10 bg-black/60 px-1.5 py-1 text-white shadow-lg backdrop-blur" data-testid="raster-pages">
          <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="rounded-full p-2 hover:bg-white/10 disabled:opacity-40" aria-label="Předchozí strana">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="whitespace-nowrap px-1 text-xs tabular-nums">Strana {page} / {pages}</span>
          <button type="button" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages} className="rounded-full p-2 hover:bg-white/10 disabled:opacity-40" aria-label="Další strana">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
