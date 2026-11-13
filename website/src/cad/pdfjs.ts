/**
 * Čtečka PDF (pdf.js, Apache-2.0) pro podklad skici. Načítá se líně z /public/vendor (kopíruje
 * scripts/vendor-pdfjs.mjs při instalaci a před sestavením) – hlavní balík zůstává malý a knihovnu nezpracovává
 * sestavovací nástroj. Používá se sestavení „legacy“ (funguje i ve starších prohlížečích a v Node pro testy).
 */
import { tr } from "./i18n";

/** verze balíčku pdfjs-dist (v package.json je přesně tato; hlídá ji test v pdf-vector.test.ts) */
export const PDFJS_VERSION = "6.5.438";
export const PDFJS_BASE = `/vendor/pdfjs-${PDFJS_VERSION}/`;

export type PdfJs = typeof import("pdfjs-dist");

let loading: Promise<PdfJs> | null = null;

/** Knihovna pdf.js (jen v prohlížeči). Při neúspěchu vyhodí chybu s českým textem; další pokus ji načte znovu. */
export function loadPdfJs(): Promise<PdfJs> {
  if (!loading) {
    if (typeof document === "undefined") return Promise.reject(new Error(tr("PDF lze načíst jen v prohlížeči.")));
    const url = `${PDFJS_BASE}pdf.min.mjs`;
    loading = (import(/* webpackIgnore: true */ /* @vite-ignore */ url) as Promise<PdfJs>).then(
      (m) => {
        m.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}pdf.worker.min.mjs`;
        return m;
      },
      () => {
        throw new Error(tr("Čtečku PDF se nepodařilo načíst."));
      },
    );
    loading.catch(() => (loading = null));
  }
  return loading;
}

/** Volby `getDocument` s cestami k písmům, tabulkám znaků a dekodérům obrázků ve /public/vendor. */
export const pdfDocOptions = (data: Uint8Array) => ({
  data,
  standardFontDataUrl: `${PDFJS_BASE}standard_fonts/`,
  cMapUrl: `${PDFJS_BASE}cmaps/`,
  cMapPacked: true,
  wasmUrl: `${PDFJS_BASE}wasm/`,
  iccUrl: `${PDFJS_BASE}iccs/`,
});
