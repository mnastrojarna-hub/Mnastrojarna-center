import "server-only";
import path from "node:path";
import { existsSync } from "node:fs";

/**
 * pdf.js (legacy build) + @napi-rs/canvas v Node — JEDINÉ místo načtení rendereru.
 * Načítá se výhradně přes `await import()` uvnitř služby / rout (nikdy v server action):
 *  - @napi-rs/canvas se importuje PŘÍMO a předá pdf.js přes CanvasFactory (pdf.js by ho jinak
 *    načetl přes createRequire a tracing Vercelu by ho neviděl),
 *  - worker pdf.js se importuje přímo a nastaví jako globalThis.pdfjsWorker (žádný dynamický import
 *    relativní cesty — funguje i po bundlování),
 *  - standardní písma a cmaps z node_modules/pdfjs-dist (tracing: next.config outputFileTracingIncludes).
 */

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type NapiCanvas = typeof import("@napi-rs/canvas");

let pdfjsP: Promise<PdfJs> | null = null;
let canvasP: Promise<NapiCanvas> | null = null;

/** Adresář s daty pdf.js (přepsatelný v testu chybějících fontů). */
export function pdfjsDataDir(): string {
  return process.env.ANON_PDFJS_DIR || path.join(process.cwd(), "node_modules", "pdfjs-dist");
}

export function standardFontDataUrl(): string {
  return path.join(pdfjsDataDir(), "standard_fonts") + path.sep;
}

export function cMapUrl(): string {
  return path.join(pdfjsDataDir(), "cmaps") + path.sep;
}

/** Start-up kontrola: jsou v nasazení písma pdf.js? (jinak se nevložená písma nevykreslí) */
export function pdfFontsAvailable(): boolean {
  return existsSync(path.join(standardFontDataUrl(), "LiberationSans-Regular.ttf")) && existsSync(path.join(standardFontDataUrl(), "FoxitSerif.pfb"));
}

export class PdfFontsMissingError extends Error {
  constructor() {
    super("Chybí fonty pdf.js v nasazení (standard_fonts) — anonymizace PDF nemůže běžet.");
    this.name = "PdfFontsMissingError";
  }
}

export async function loadCanvas(): Promise<NapiCanvas> {
  if (!canvasP) canvasP = import("@napi-rs/canvas");
  return canvasP;
}

export async function loadPdfjs(): Promise<PdfJs> {
  if (!pdfjsP) {
    pdfjsP = (async () => {
      const g = globalThis as { pdfjsWorker?: unknown };
      if (!g.pdfjsWorker) g.pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
      return import("pdfjs-dist/legacy/build/pdf.mjs");
    })();
  }
  return pdfjsP;
}

export interface CanvasAndContext {
  canvas: import("@napi-rs/canvas").Canvas | null;
  context: import("@napi-rs/canvas").SKRSContext2D | null;
}

/** CanvasFactory pro pdf.js nad @napi-rs/canvas (importovaným přímo). */
export async function nodeCanvasFactoryClass() {
  const { createCanvas } = await loadCanvas();
  return class NapiCanvasFactory {
    constructor(_opts?: unknown) {
      void _opts;
    }
    create(width: number, height: number): CanvasAndContext {
      if (width <= 0 || height <= 0) throw new Error("Invalid canvas size");
      const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
      return { canvas, context: canvas.getContext("2d") };
    }
    reset(cc: CanvasAndContext, width: number, height: number) {
      if (!cc.canvas) throw new Error("Canvas is not specified");
      cc.canvas.width = Math.ceil(width);
      cc.canvas.height = Math.ceil(height);
    }
    destroy(cc: CanvasAndContext) {
      if (cc.canvas) {
        cc.canvas.width = 0;
        cc.canvas.height = 0;
      }
      cc.canvas = null;
      cc.context = null;
    }
  };
}

export type PdfDocument = import("pdfjs-dist/types/src/display/api").PDFDocumentProxy;
export type PdfPage = import("pdfjs-dist/types/src/display/api").PDFPageProxy;

export class PdfUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfUnsupportedError";
  }
}

/**
 * Největší obrázek, který pdf.js dekóduje (px). Větší by pdf.js TIŠE vynechal (prázdná stránka) —
 * pdf-prepare takové stránky nahlásí předem. 150 MPx pokryje sken A0 v 300 DPI (≈ 139 MPx).
 */
export const PDF_MAX_IMAGE_PX = 150_000_000;

/** Otevře PDF bezpečně (bez eval, bez systémových písem, s limity obrázků). */
export async function openPdf(data: Uint8Array, opts: { requireFonts?: boolean } = {}): Promise<PdfDocument> {
  if (opts.requireFonts !== false && !pdfFontsAvailable()) throw new PdfFontsMissingError();
  const pdfjs = await loadPdfjs();
  const CanvasFactory = await nodeCanvasFactoryClass();
  const task = pdfjs.getDocument({
    data: new Uint8Array(data),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    standardFontDataUrl: standardFontDataUrl(),
    cMapUrl: cMapUrl(),
    cMapPacked: true,
    maxImageSize: PDF_MAX_IMAGE_PX,
    canvasMaxAreaInBytes: 200_000_000,
    verbosity: 0,
    CanvasFactory: CanvasFactory as never,
  } as Parameters<PdfJs["getDocument"]>[0]);
  try {
    const doc = await task.promise;
    return doc;
  } catch (err) {
    const name = (err as { name?: string })?.name ?? "";
    if (name === "PasswordException") throw new PdfUnsupportedError("PDF je chráněné heslem — nelze anonymizovat.");
    if (name === "InvalidPDFException") throw new PdfUnsupportedError("Soubor není platné PDF.");
    throw err;
  }
}
