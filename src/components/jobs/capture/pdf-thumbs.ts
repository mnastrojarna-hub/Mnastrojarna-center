"use client";

import * as React from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

/**
 * Miniatury stran PDF v Roztřídění (bez <iframe>): pdfjs-dist se načte líně až tady,
 * stránky se vykreslují postupně (šetří paměť telefonu). Selže-li cokoli, volající
 * ukáže dlaždici s popiskem strany (BatchPage.aiLabel / label).
 */

export const THUMB_WIDTH = 112;

type PdfJs = typeof import("pdfjs-dist");

let lib: Promise<PdfJs> | null = null;
const docs = new Map<string, Promise<PDFDocumentProxy>>();
const thumbs = new Map<string, Promise<string | null>>();
let chain: Promise<unknown> = Promise.resolve();

function loadLib(): Promise<PdfJs> {
  if (!lib) {
    lib = import("pdfjs-dist").then((m) => {
      m.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      return m;
    });
    lib.catch(() => {
      lib = null;
    });
  }
  return lib;
}

function loadDoc(url: string): Promise<PDFDocumentProxy> {
  let p = docs.get(url);
  if (!p) {
    p = loadLib().then((m) => m.getDocument({ url, isEvalSupported: false, disableFontFace: true }).promise);
    p.catch(() => docs.delete(url));
    docs.set(url, p);
  }
  return p;
}

async function render(url: string, pageNumber: number, width: number): Promise<string | null> {
  if (typeof document === "undefined") return null;
  const pdf = await loadDoc(url);
  if (pageNumber < 1 || pageNumber > pdf.numPages) return null;
  const page = await pdf.getPage(pageNumber);
  try {
    const base = page.getViewport({ scale: 1 });
    const ratio = typeof window !== "undefined" ? Math.min(2, window.devicePixelRatio || 1) : 1;
    const viewport = page.getViewport({ scale: (width * ratio) / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.8));
    return blob ? URL.createObjectURL(blob) : null;
  } finally {
    page.cleanup();
  }
}

/** Miniatura strany PDF (object URL) nebo null; výsledky se pamatují po dobu života stránky. */
export function pdfThumb(url: string, pageNumber: number, width: number = THUMB_WIDTH): Promise<string | null> {
  const key = `${width}|${pageNumber}|${url}`;
  let p = thumbs.get(key);
  if (!p) {
    // jedna po druhé — na telefonu by souběžné vykreslování spotřebovalo moc paměti
    p = chain.then(() => render(url, pageNumber, width)).catch(() => null);
    chain = p;
    thumbs.set(key, p);
  }
  return p;
}

/** Uvolnit načtená PDF a miniatury (zavření dialogu). */
export function releasePdfThumbs(): void {
  for (const p of thumbs.values()) {
    p.then((u) => u && URL.revokeObjectURL(u)).catch(() => {});
  }
  thumbs.clear();
  for (const d of docs.values()) d.then((x) => x.destroy()).catch(() => {});
  docs.clear();
}

/** Hook: miniatura strany PDF; `failed` = ukázat náhradní dlaždici. */
export function usePdfThumb(url: string | null, pageNumber: number, width: number = THUMB_WIDTH): { src: string | null; failed: boolean } {
  const [state, setState] = React.useState<{ key: string; src: string | null; failed: boolean }>({ key: "", src: null, failed: false });
  const key = url ? `${width}|${pageNumber}|${url}` : "";
  React.useEffect(() => {
    if (!url) return;
    let alive = true;
    pdfThumb(url, pageNumber, width).then((src) => {
      if (alive) setState({ key, src, failed: !src });
    });
    return () => {
      alive = false;
    };
  }, [url, pageNumber, width, key]);
  if (!url) return { src: null, failed: true };
  return state.key === key ? { src: state.src, failed: state.failed } : { src: null, failed: false };
}
