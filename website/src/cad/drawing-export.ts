/**
 * Export výkresu do souborů – sdílí ho výkresové prostředí (tlačítka PDF / DWG / DXF / SVG / Kusovník CSV) a API pro agenty
 * `window.mncad.exportDrawing(format, { sheet, dwgVersion, width })` (bez dialogu uložení). Stejný výpočet jako výkresové
 * prostředí: výkres listu z jádra → vložení Chytrých kót, které ještě nejsou na listu → kóty a značky (withAnnotations) →
 * SVG / DXF R12 / PDF (jsPDF) / DWG (acad-ts) / PNG (rastr SVG v prohlížeči).
 */
import { annotationStatus, bomToCsv, withAnnotations, type DrawingResult } from "./drawing";
import { activeSheetIndex, mergeSmart, newSheet, resolveSheet, sheetMeta, sheetOptions, type DrawingCompute, type DrawingExtras } from "./drawing-agent";
import type { DwgVersion } from "./formats/dwg-versions";
import { DWG_VERSIONS } from "./formats/dwg-versions";
import { tr } from "./i18n";
import type { CadDoc } from "./types";

export type DrawingExportFormat = "pdf" | "dxf" | "dwg" | "svg" | "csv" | "png";
export type DrawingExportOptions = {
  /** list: číslo (od 1) nebo název; bez zadání aktivní list */
  sheet?: number | string;
  /** verze DWG (výchozí R2018) */
  dwgVersion?: DwgVersion;
  /** šířka PNG v pixelech (výchozí 2000) */
  width?: number;
};
export type DrawingExportResult = { name: string; mime: string; bytes: number; base64: string; width?: number; height?: number; warnings?: string[] };

export const DRAWING_FORMATS: DrawingExportFormat[] = ["pdf", "dxf", "dwg", "svg", "csv", "png"];
const MIME: Record<DrawingExportFormat, string> = { pdf: "application/pdf", dxf: "application/dxf", dwg: "application/acad", svg: "image/svg+xml", csv: "text/csv;charset=utf-8", png: "image/png" };

/** název souboru bez diakritiky a zvláštních znaků */
export const safeName = (s: string) => (s || "vykres").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_").slice(0, 60);

/**
 * Soubor výkresu z hotového listu (`out` = výkres včetně kót a značek). `base` = základ názvu souboru, `title` = název do PDF,
 * `bom` = kusovník pro CSV. PNG jen v prohlížeči (rastr SVG přes canvas).
 */
export async function drawingFile(
  out: DrawingResult,
  format: DrawingExportFormat,
  o: { base: string; title: string; dwgVersion?: DwgVersion; bom?: { pos: number; name: string; qty: number }[]; width?: number },
): Promise<{ name: string; mime: string; data: Uint8Array; width?: number; height?: number }> {
  const enc = (s: string) => new TextEncoder().encode(s);
  switch (format) {
    case "svg":
      return { name: `${o.base}_vykres.svg`, mime: MIME.svg, data: enc(out.svg) };
    case "dxf":
      return { name: `${o.base}_vykres.dxf`, mime: MIME.dxf, data: enc(out.dxf) };
    case "csv":
      if (!o.bom?.length) throw new Error(tr("Kusovník CSV je jen u sestavy s komponentami – díl kusovník nemá."));
      return { name: `${o.base}_kusovnik.csv`, mime: MIME.csv, data: enc(bomToCsv(o.bom as Parameters<typeof bomToCsv>[0])) };
    case "pdf": {
      const { drawingToPdf } = await import("./pdf");
      const blob = await drawingToPdf({ ...out, title: o.title });
      return { name: `${o.base}_vykres.pdf`, mime: MIME.pdf, data: new Uint8Array(await blob.arrayBuffer()) };
    }
    case "dwg": {
      const version = o.dwgVersion ?? "R2018";
      if (!DWG_VERSIONS.some((v) => v.id === version)) throw new Error(tr("Neznámá verze DWG „{0}“ – {1}", version, DWG_VERSIONS.map((v) => v.id).join(", ")));
      const { drawingToDwg } = await import("./formats/dwg");
      return { name: `${o.base}_vykres.dwg`, mime: MIME.dwg, data: new Uint8Array(await drawingToDwg(out, { version })) };
    }
    case "png": {
      const r = await svgToPng(out.svg, out.sheet.w, out.sheet.h, o.width ?? 2000);
      return { name: `${o.base}_vykres.png`, mime: MIME.png, data: r.data, width: r.width, height: r.height };
    }
    default:
      throw new Error(tr("Neznámý formát výkresu „{0}“ – pdf, dxf, dwg, svg, csv, png.", String(format)));
  }
}

/** Rastr listu: SVG → obrázek → canvas → PNG (bílé pozadí, šířka v px, výška podle formátu listu). */
export async function svgToPng(svg: string, wMm: number, hMm: number, width: number): Promise<{ data: Uint8Array; width: number; height: number }> {
  if (typeof document === "undefined") throw new Error(tr("PNG výkresu jde vytvořit jen v prohlížeči."));
  const W = Math.round(Math.max(200, Math.min(8000, width || 2000)));
  const H = Math.round((W * hMm) / wMm);
  const img = new Image();
  img.decoding = "async";
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/width="[^"]*mm" height="[^"]*mm"/, `width="${W}" height="${H}"`))}`;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  if (!g) throw new Error(tr("Prohlížeč nepodporuje kreslení do canvasu."));
  g.fillStyle = "#fff";
  g.fillRect(0, 0, W, H);
  g.drawImage(img, 0, 0, W, H);
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/png"));
  if (!blob) throw new Error(tr("PNG výkresu se nepodařilo vytvořit."));
  return { data: new Uint8Array(await blob.arrayBuffer()), width: W, height: H };
}

/** bajty → base64 (po částech – velké soubory) */
export function toBase64(u8: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(u8).toString("base64");
  let b = "";
  for (let i = 0; i < u8.length; i += 0x8000) b += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(b);
}

/**
 * Výkres listu dokumentu jako soubor (API pro agenty): list podle čísla / názvu (jinak aktivní), výpočet jako výkresové
 * prostředí včetně Chytrých kót, které ještě nejsou na listu, kót a značek. Vrací název, MIME, velikost, base64
 * a varování (pohled se nevešel, kóta bez geometrie…).
 */
export async function exportDrawing(doc: CadDoc, format: DrawingExportFormat, opts: DrawingExportOptions, compute: DrawingCompute, extras?: DrawingExtras): Promise<DrawingExportResult> {
  if (!DRAWING_FORMATS.includes(format)) throw new Error(tr("Neznámý formát výkresu „{0}“ – pdf, dxf, dwg, svg, csv, png.", String(format)));
  if (!doc.features.length && !doc.components?.length) throw new Error(tr("Výkres: model je prázdný – nejdřív vymodelujte díl"));
  const has = !!doc.drawings?.length;
  const idx = !has ? 0 : opts.sheet === undefined ? activeSheetIndex(doc) : resolveSheet(doc, opts.sheet);
  if (!has && opts.sheet !== undefined && opts.sheet !== 1) throw new Error(tr("Dokument zatím nemá výkres – export prvního listu: bez „sheet“ nebo sheet 1."));
  const s = has ? doc.drawings![idx] : newSheet(doc);
  const o = sheetOptions(s);
  const meta = sheetMeta(doc, s, idx, extras);
  const res = await compute(doc, meta, o);
  let anns = s.annotations;
  if (o.dimensions === "smart" && res.smart) {
    const m = mergeSmart(anns, o, res.smart);
    if (m) anns = m.annotations;
  }
  const out = withAnnotations(res, anns);
  const f = await drawingFile(out, format, { base: safeName(meta.name || doc.name), title: meta.name, dwgVersion: opts.dwgVersion, bom: meta.bom, width: opts.width });
  const st = annotationStatus(res, anns);
  const lost = Object.values(st).filter((x) => x !== "ok").length;
  const warnings = [...res.warnings, ...(lost ? [tr("Kóty a poznámky bez geometrie: {0}", lost)] : [])];
  return { name: f.name, mime: f.mime, bytes: f.data.length, base64: toBase64(f.data), ...(f.width ? { width: f.width, height: f.height } : {}), ...(warnings.length ? { warnings } : {}) };
}
