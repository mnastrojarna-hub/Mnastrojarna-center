/**
 * Export výkresu do souborů – sdílí ho výkresové prostředí (tlačítka PDF / DWG / DXF / SVG / Kusovník CSV) a API pro agenty
 * `window.mncad.exportDrawing(format, { sheet, dwgVersion, width })` (bez dialogu uložení). Stejný výpočet jako výkresové
 * prostředí: výkres listu z jádra → vložení Chytrých kót, které ještě nejsou na listu → kóty a značky (withAnnotations) →
 * SVG / DXF R12 / PDF (jsPDF) / DWG (acad-ts) / PNG (rastr SVG v prohlížeči).
 */
import { annotationStatus, bomToCsv, withAnnotations, type DrawingMeta, type DrawingResult } from "./drawing";
import { activeSheetIndex, mergeSmart, newSheet, resolveSheet, sheetMeta, sheetOptions, type DrawingCompute, type DrawingExtras } from "./drawing-agent";
import { drawingKey, drawingLabel, drawingSets, setSheets } from "./drawing-sets";
import type { DwgVersion } from "./formats/dwg-versions";
import { DWG_VERSIONS } from "./formats/dwg-versions";
import { writeZip } from "./formats/zip";
import { tr } from "./i18n";
import type { CadDoc } from "./types";

export type DrawingExportFormat = "pdf" | "dxf" | "dwg" | "svg" | "csv" | "png";
export type DrawingExportOptions = {
  /** list: číslo (od 1) nebo název; "all" = všechny listy aktivního výkresu (PDF vícestránkové, ostatní formáty ZIP); bez zadání aktivní list */
  sheet?: number | string | "all";
  /** verze DWG (výchozí R2018) */
  dwgVersion?: DwgVersion;
  /** šířka PNG v pixelech (výchozí 2000) */
  width?: number;
};
/** `sheets` = počet listů v souboru; `files` = soubory uvnitř ZIP (více listů DXF / DWG / SVG / PNG) */
export type DrawingExportResult = { name: string; mime: string; bytes: number; base64: string; width?: number; height?: number; warnings?: string[]; sheets?: number; files?: string[] };

export const DRAWING_FORMATS: DrawingExportFormat[] = ["pdf", "dxf", "dwg", "svg", "csv", "png"];
const MIME: Record<DrawingExportFormat, string> = { pdf: "application/pdf", dxf: "application/dxf", dwg: "application/acad", svg: "image/svg+xml", csv: "text/csv;charset=utf-8", png: "image/png" };

/** název souboru bez diakritiky a zvláštních znaků */
export const safeName = (s: string) => (s || "vykres").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_").slice(0, 60);

/**
 * Základ názvu souborů výkresu: název z razítka (jinak dokumentu); má-li dokument víc výkresů, s názvem výkresu
 * („Hridel_Vykres_2“), aby se exporty různých výkresů téhož dílu nepřepsaly. `key` = klíč výkresu listu (drawing-sets.ts).
 */
export const drawingBase = (name: string, doc: Pick<CadDoc, "drawings">, key: string) => safeName(name) + (drawingSets(doc as CadDoc).length > 1 ? `_${safeName(drawingLabel(key))}` : "");

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

/** Hotový list výkresu (výpočet jako výkresové prostředí včetně Chytrých kót, které ještě nejsou na listu). */
export type SheetOut = { out: DrawingResult; meta: DrawingMeta; name: string; lost: number; warnings: string[] };

async function renderSheet(doc: CadDoc, idx: number, compute: DrawingCompute, extras?: DrawingExtras): Promise<SheetOut> {
  const has = !!doc.drawings?.length;
  const s = has ? doc.drawings![idx] : newSheet(doc);
  const o = sheetOptions(s);
  const meta = sheetMeta(doc, s, idx, extras);
  const res = await compute(doc, meta, o);
  let anns = s.annotations;
  if (o.dimensions === "smart" && res.smart) {
    const m = mergeSmart(anns, o, res.smart);
    if (m) anns = m.annotations;
  }
  const st = annotationStatus(res, anns);
  return { out: withAnnotations(res, anns), meta, name: s.name, lost: Object.values(st).filter((x) => x !== "ok").length, warnings: res.warnings };
}

/**
 * Listy k exportu: číslo / název (aktivní výkres), "all" = všechny listy výkresu aktivního listu, bez zadání aktivní list.
 * Vrací indexy v doc.drawings (bez uloženého výkresu [0] = nový list s výchozími volbami).
 */
export function exportSheets(doc: CadDoc, sheet: DrawingExportOptions["sheet"]): number[] {
  const has = !!doc.drawings?.length;
  if (!has) {
    if (sheet !== undefined && sheet !== 1 && sheet !== "all") throw new Error(tr("Dokument zatím nemá výkres – export prvního listu: bez „sheet“ nebo sheet 1."));
    return [0];
  }
  if (sheet === "all") return setSheets(doc, activeSheetIndex(doc));
  return [sheet === undefined ? activeSheetIndex(doc) : resolveSheet(doc, sheet)];
}

/** Hotové listy pro export / tisk (stejný výpočet jako exportDrawing). */
export async function drawingSheetsOut(doc: CadDoc, sheet: DrawingExportOptions["sheet"], compute: DrawingCompute, extras?: DrawingExtras): Promise<SheetOut[]> {
  const out: SheetOut[] = [];
  for (const i of exportSheets(doc, sheet)) out.push(await renderSheet(doc, i, compute, extras));
  return out;
}

/**
 * Soubor z více listů: PDF = jedno vícestránkové PDF; DXF / DWG / SVG / PNG = ZIP s jedním souborem na list
 * (DXF R12 rozvržení nemá, DWG se zapisuje do modelového prostoru – proto soubor na list); CSV = kusovník (jednou).
 */
export async function drawingFileSheets(
  sheets: { out: DrawingResult; name: string }[],
  format: DrawingExportFormat,
  o: { base: string; title: string; dwgVersion?: DwgVersion; bom?: { pos: number; name: string; qty: number }[]; width?: number },
): Promise<{ name: string; mime: string; data: Uint8Array; files?: string[] }> {
  if (sheets.length === 1 || format === "csv") return drawingFile(sheets[0].out, format, o);
  if (format === "pdf") {
    const { drawingsToPdf } = await import("./pdf");
    const blob = await drawingsToPdf(sheets.map((x) => x.out), o.title);
    return { name: `${o.base}_vykres.pdf`, mime: MIME.pdf, data: new Uint8Array(await blob.arrayBuffer()) };
  }
  const files: { name: string; data: Uint8Array }[] = [];
  for (const [i, sh] of sheets.entries()) {
    const f = await drawingFile(sh.out, format, o);
    const ext = f.name.slice(f.name.lastIndexOf("."));
    files.push({ name: `${o.base}_list${i + 1}_${safeName(sh.name)}${ext}`, data: f.data });
  }
  return { name: `${o.base}_vykres_${format}_listy.zip`, mime: "application/zip", data: writeZip(files), files: files.map((f) => f.name) };
}

/**
 * Výkres listu dokumentu jako soubor (API pro agenty): list podle čísla / názvu (jinak aktivní), výpočet jako výkresové
 * prostředí včetně Chytrých kót, které ještě nejsou na listu, kót a značek. Vrací název, MIME, velikost, base64
 * a varování (pohled se nevešel, kóta bez geometrie…).
 */
export async function exportDrawing(doc: CadDoc, format: DrawingExportFormat, opts: DrawingExportOptions, compute: DrawingCompute, extras?: DrawingExtras): Promise<DrawingExportResult> {
  if (!DRAWING_FORMATS.includes(format)) throw new Error(tr("Neznámý formát výkresu „{0}“ – pdf, dxf, dwg, svg, csv, png.", String(format)));
  if (!doc.features.length && !doc.components?.length) throw new Error(tr("Výkres: model je prázdný – nejdřív vymodelujte díl"));
  const sheets = await drawingSheetsOut(doc, opts.sheet, compute, extras);
  const meta = sheets[0].meta;
  const sheet0 = doc.drawings?.[exportSheets(doc, opts.sheet)[0]];
  const base = drawingBase(meta.name || doc.name, doc, sheet0 ? drawingKey(sheet0) : "");
  const f = await drawingFileSheets(sheets, format, { base, title: meta.name, dwgVersion: opts.dwgVersion, bom: meta.bom, width: opts.width });
  const multi = sheets.length > 1;
  const lost = sheets.reduce((n, x) => n + x.lost, 0);
  const warnings = [...sheets.flatMap((x) => x.warnings.map((w) => (multi ? `${x.name}: ${w}` : w))), ...(lost ? [tr("Kóty a poznámky bez geometrie: {0}", lost)] : [])];
  const px = f as { width?: number; height?: number };
  const one = !multi && px.width ? { width: px.width, height: px.height } : {};
  return { name: f.name, mime: f.mime, bytes: f.data.length, base64: toBase64(f.data), ...one, ...(warnings.length ? { warnings } : {}), ...(multi && format !== "csv" ? { sheets: sheets.length } : {}), ...("files" in f && f.files ? { files: f.files } : {}) };
}
