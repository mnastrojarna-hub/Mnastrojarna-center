/**
 * Načtení předlohy: bajty souboru → 2D model (DWG / DXF importem cad/draft/io, PDF přes pdf.js a pdf.ts) → výtah.
 * Formát podle obsahu (hlavička „%PDF“, „AC10xx“, DXF) a přípony.
 */
import { tr } from "../i18n";
import { blobId } from "../blobs";
import type { DraftModel } from "../draft/model";
import { extractReference } from "./extract";
import { pdfPagesToDraft, readPdfPages, type PdfJsLike } from "./pdf";
import type { RefState } from "./store";
import type { RefDocInfo, RefExtract, RefFormat } from "./types";

export type LoadOpts = {
  /** modul pdf.js (prohlížeč: loadPdfJs(), testy: sestavení legacy) a volby getDocument */
  pdfjs?: () => Promise<{ lib: PdfJsLike; docOptions?: Record<string, unknown> }>;
  /** import DWG / DXF v pracovním vlákně (prohlížeč); výchozí podle prostředí */
  worker?: boolean;
};

const isPdf = (u8: Uint8Array) => u8.length > 4 && u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46;

/** souhrn výtahu (počty) do dokumentu */
export function extractSummary(ex: RefExtract): Record<string, number> {
  const bomRows = ex.boms.reduce((s, b) => s + b.rows.length, 0);
  return {
    sheets: ex.sheets.length,
    views: ex.views.length,
    dims: ex.dims.length,
    tolerances: ex.dims.filter((d) => d.tol).length,
    fits: ex.dims.filter((d) => d.fit).length,
    holes: ex.holes.length,
    bom: bomRows,
    balloons: ex.balloons.length,
    titles: ex.titles.length,
    notes: ex.notes.length,
    symbols: ex.symbols.length,
    contradictions: ex.contradictions.length,
  };
}

/** soubor předlohy → stav předlohy (2D model, výtah, souhrn pro dokument) */
export async function loadReference(name: string, bytes: Uint8Array, o: LoadOpts = {}): Promise<RefState> {
  if (!bytes.length) throw new Error(tr("předloha „{0}“: soubor je prázdný", name));
  let model: DraftModel;
  let format: RefFormat;
  let note = "";
  let version: string | undefined;
  let skipped: Record<string, number> = {};
  if (isPdf(bytes) || /\.pdf$/i.test(name)) {
    if (!o.pdfjs) throw new Error(tr("PDF lze načíst jen v prohlížeči."));
    const { lib, docOptions } = await o.pdfjs();
    const pages = await readPdfPages(lib, bytes, { docOptions });
    if (!pages.length) throw new Error(tr("předloha „{0}“: PDF nemá žádnou stránku", name));
    model = pdfPagesToDraft(pages);
    format = "pdf";
    const paths = pages.reduce((s, p) => s + p.paths.length, 0);
    note = tr("PDF: {0} stránek, {1} vektorových cest, {2} textů.", pages.length, paths, pages.reduce((s, p) => s + p.texts.length, 0));
    if (!paths) note += " " + tr("Stránky nemají vektorovou kresbu (sken?) – geometrie pro porovnání chybí.");
  } else {
    const { draftImport } = await import("../draft/io/index");
    const r = await draftImport(name, bytes, { worker: o.worker });
    model = r.model;
    format = r.format;
    note = r.note;
    version = r.version;
    skipped = r.report.skipped;
  }
  const extract = extractReference(model, { name, format, ...(version ? { version } : {}), skipped });
  const info: RefDocInfo = { name, format, bytes: bytes.length, id: blobId(bytes), summary: extractSummary(extract) };
  return { info, model, extract, note, ...(version ? { version } : {}) };
}
