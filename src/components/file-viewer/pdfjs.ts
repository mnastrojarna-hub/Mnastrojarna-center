"use client";

/** pdf.js v prohlížeči (prohlížeč souborů, tisk) — jedno načtení knihovny i workeru. */

export type PdfJs = typeof import("pdfjs-dist");
let lib: Promise<PdfJs> | null = null;

export function loadPdfJs(): Promise<PdfJs> {
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
