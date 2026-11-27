/**
 * Výstupní soubory enginu (CAD-HEADLESS-NAVRH.md kap. 2.5, 3.1, 3.5; balík B3 – jediný vlastník): projekt .mncad,
 * 3D model s kontrolou znovunačtením (`verifyExport` přes `kernel.exportStats`), výkresy – list, listy aktivního výkresu,
 * nebo všechny listy dokumentu včetně výkresů dílů uložených v komponentách sestavy (`documentSheets`) jako jedno
 * vícestránkové PDF (`drawingsToPdf`) –, skica DXF a výstupy `--formats` CLI / HTTP (`writeDocFormat`).
 *
 * Bez prohlížeče a bez Reactu: soubory zapisuje hostitel (`host.files`, FileSink – prohlížeč stažení bez dialogu, CLI
 * `--out`, serve paměť relace), písma PDF dává hostitel (`host.fonts`), jádro `host.kernel`. Textové příkazy (`uložit`,
 * `export`, `výkres export`, `skica export`) provádí engine/ops/out.ts, odkazy engine/share-out.ts.
 */
import { checkFailed, exportCheck, FORMAT_EXT, outFileName, type ExportCheck, type Export3dFormat, type OutDrawingFormat } from "../agent-out";
import { solidVerdict, type SolidParts } from "../solid-export";
import { modelSolids } from "./solid-check";
import type { DrawingResult } from "../drawing";
import { sourceKey } from "../assembly";
import { docSupply, docSupplyLine, makeIncomplete, supplyOf } from "../bom-model";
import { modelId } from "../doc-outputs";
import { embedBlobs, missingBlobFiles } from "../blobs";
import { docHasContent } from "../draft/doc";
import type { DrawingCompute, DrawingExtras } from "../drawing-agent";
import { getLang, tr } from "../i18n";
import { staleCopies, staleCopyText, staleHints } from "../asm-refresh";
import type { PdfFonts } from "../pdf";
import { sketchToDxf } from "../sketch";
import type { AsmComponent, CadDoc, ExportFormat, Feature } from "../types";
import type { AsmEnvOptions } from "./asm-env";
import { drawExtras, partInfo } from "./asm-status";
import { drawingMemo, issueArgs, sheetLabel, sheetWarningCode } from "./sheet-eval";
import type { EngineHost, FileSink } from "./host";
import type { KernelApi } from "./kernel";
import type { OutFile } from "./protocol-types";
import { projectJson } from "./project-json";
import type { Workspace } from "./workspace";
import { exactBeforeExport } from "./validity-store";

/* ───────────────────────── formáty a názvy ───────────────────────── */

/** MIME výstupů (stažení v prohlížeči, `files[].mime` v HTTP) */
export const OUT_MIME: Record<string, string> = {
  step: "model/step",
  stl: "model/stl",
  brep: "application/octet-stream",
  obj: "model/obj",
  glb: "model/gltf-binary",
  "3mf": "model/3mf",
  wrl: "model/vrml",
  mncad: "application/json",
  pdf: "application/pdf",
  dxf: "application/dxf",
  dwg: "application/acad",
  svg: "image/svg+xml",
  csv: "text/csv;charset=utf-8",
  png: "image/png",
  zip: "application/zip",
};

/** výchozí název souboru jako u tlačítek aplikace (bez diakritiky, `Konzola.step`) */
export const plainName = (s: string) => (s || "model").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_").slice(0, 60);

/** prázdný dokument: bez prvků, komponent a 2D entit (jako tlačítko Sdílet a CLI – `docHasContent`) */
export const isEmptyDoc = (d: CadDoc) => !docHasContent(d);

/**
 * Výkres 3D modelu jde exportovat: ne 2D výkres (ten má vlastní export „2d export dxf|dwg“) a ne prázdný model – jinak
 * chyba s důvodem (dřív u 2D výkresu zavádějící „model je prázdný“).
 */
export function assertDrawable(d: CadDoc): void {
  if (d.kind === "draft") throw new Error(tr("výkres export: „{0}“ je 2D výkres – exportuje se příkazem „2d export dxf“ nebo „2d export dwg“", d.name));
  if (isEmptyDoc(d)) throw new Error(tr("Výkres: model je prázdný – nejdřív vymodelujte díl"));
}

/** nejvyšší velikost souboru doručeného do protokolu jako base64 (`… base64`) */
export const OUT_BASE64_MAX = 2 * 1024 * 1024;

/** bajty → base64 (Node Buffer, jinak po částech přes btoa) */
export function bytesToBase64(u8: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString("base64");
  let b = "";
  for (let i = 0; i < u8.length; i += 0x8000) b += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(b);
}
const fromBase64 = (s: string): Uint8Array => {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(s, "base64"));
  const b = atob(s);
  const u8 = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u8[i] = b.charCodeAt(i);
  return u8;
};

/** hotový soubor k zápisu (`host.files.write`) */
export type Produced = {
  name: string;
  mime: string;
  data: Uint8Array;
  /** formát řádku F (`step`, `pdf`, `dxf` – i u ZIPu listů) */
  format: string;
  /** listů v souboru (PDF stránek / souborů v ZIPu) */
  sheets?: number;
  /** soubory uvnitř ZIP */
  files?: string[];
  width?: number;
  height?: number;
  /** varování výpočtu listů (pohled se nevešel, kóta bez geometrie…) – u více listů s názvem listu */
  warnings: { sheet: string; text: string }[];
};

/* ───────────────────────── projekt .mncad ───────────────────────── */

/** projekt .mncad: data, kontrola zpětného čtení (počet prvků / komponent) a importy bez dat */
export function projectFile(d: CadDoc, name: string): Produced & { count: number; asm: boolean; docName: string; lost: string[]; modelRev: string } {
  const lost = missingBlobFiles(d);
  // revize modelu v souboru (vlna 22, bod 12 – engine/project-json.ts)
  const { json, modelRev } = projectJson(d);
  const data = new TextEncoder().encode(json);
  const back = JSON.parse(json) as CadDoc;
  const asm = back.kind === "assembly";
  return { name, mime: OUT_MIME.mncad, data, format: "mncad", warnings: [], count: asm ? (back.components?.length ?? 0) : back.features.length, asm, docName: back.name, lost, modelRev };
}

/* ───────────────────────── 3D model a kontrola ───────────────────────── */

/**
 * Poslední kontroly podle stavu dokumentu a formátu: opakovaný export nezměněného modelu (STEP má v hlavičce čas, bajty
 * se liší, těleso ne) kontrolu nepočítá znovu. Jen pár položek – nic dalšího se nedrží.
 */
const checks = new Map<string, ExportCheck>();
const CHECKS_MAX = 4;

/**
 * Exportovaný soubor znovu načte jádrem a porovná s modelem (tělesa, objem, obálka) – `kernel.exportStats`, bez sítě a
 * bez úložiště importů. Jen úspěšná kontrola se pamatuje (další export nezměněného modelu ji převezme s poznámkou).
 */
export async function verifyExport(kernel: Pick<KernelApi, "exportStats">, d: CadDoc, bytes: Uint8Array, format: "step" | "brep", parts?: SolidParts, full = false): Promise<ExportCheck> {
  const label = format === "step" ? "STEP" : "BREP";
  // záznamy exportů (`outputs`, vlna 22 D2) mění dokument po každém exportu, model ne – do klíče nepatří (jinak by se
  // kontrola nezměněného modelu nikdy nepřevzala)
  const key = `${format}${full ? ":full" : ""}:${JSON.stringify({ ...d, name: "", outputs: undefined })}`;
  const hit = checks.get(key);
  if (hit) return { ...hit, line: `${hit.line}${tr(" (model od minulé kontroly beze změny)")}` };
  try {
    // `full` (přísný režim, 22c kolo 7): rychlá kontrola platnosti souboru i nad mezí ploch
    const { model, file } = await (full ? kernel.exportStats(d, bytes, format, true) : kernel.exportStats(d, bytes, format));
    // soubor bez jediné plochy = nic se nenačetlo; soubor jen s plochami / skořepinami posoudí exportCheck (✗ out.no-solid, 22c)
    if (!file.solids && !(file.freeShells > 0) && !(file.freeFaces > 0) && !(file.volume > 0)) return checkFailed(label, tr("jádro v souboru nenašlo těleso ani plochy"));
    const c = exportCheck(model, file, label, parts);
    if (c.ok) {
      checks.delete(key);
      checks.set(key, c);
      while (checks.size > CHECKS_MAX) checks.delete(checks.keys().next().value!);
    }
    return c;
  } catch (err) {
    return checkFailed(label, (err as Error).message);
  }
}
/** zapomene uložené kontroly (testy) */
export const resetExportChecks = () => checks.clear();

/** pevný čas v hlavičce STEP (`stableStep`) */
export const STEP_STABLE_TIME = "2000-01-01T00:00:00";

/**
 * STEP se stejnými bajty při stejném modelu: OCCT do souboru píše čas exportu (`FILE_NAME('…','<čas>',…)`), výchozí
 * název produktu s pořadovým číslem exportu v procesu (`PRODUCT('Open CASCADE STEP translator 8.0 <n>[.<m>]'`) a u sestavy
 * id výskytů `NEXT_ASSEMBLY_USAGE_OCCURRENCE('<k>'` číslovaná průběžně přes všechny exporty procesu. Vše se nahradí pevnou
 * hodnotou (čas `STEP_STABLE_TIME`, export 1, výskyty 1…n v pořadí souboru), takže dva exporty nezměněného modelu – v jednom běhu
 * i v různých bězích – mají stejný otisk SHA-256 (porovnání, verzování výstupů). Ostatní bajty zapisuje OCCT při stejném
 * modelu ve stejném pořadí (ověřuje outputs-kernel.test.ts). Soubor bez rozpoznané hlavičky zůstane beze změny.
 */
export function stableStep(bytes: Uint8Array): Uint8Array {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); // latin1: znak = bajt
  const head = /FILE_NAME\s*\(\s*'(?:[^']|'')*'\s*,\s*'(\d{4}-\d{2}-\d{2}T[^']*)'/.exec(text.slice(0, 8192));
  if (!head) return bytes;
  const at = head.index + head[0].length - 1 - head[1].length;
  let out = text.slice(0, at) + STEP_STABLE_TIME + text.slice(at + head[1].length);
  // výchozí názvy produktů „… translator 8.0 <export>[.<podprodukt>]“ → export 1; id výskytů v sestavě podle pořadí v souboru
  out = out.replace(/(Open CASCADE STEP translator \d+\.\d+) \d+((?:\.\d+)*)'/g, "$1 1$2'");
  let nauo = 0;
  out = out.replace(/(NEXT_ASSEMBLY_USAGE_OCCURRENCE\s*\(\s*')\d+'/g, (_m, pre: string) => `${pre}${++nauo}'`);
  if (out === text) return bytes;
  const u8 = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) u8[i] = out.charCodeAt(i);
  return u8;
}

/**
 * Revize modelu v hlavičce STEP (vlna 22, bod 12): `FILE_DESCRIPTION(('Open CASCADE Model','MNCAD model revision r\X\B7a1b2c3'),'2;1')`
 * – druhá položka popisu (ISO 10303-21: seznam řetězců; `\X\B7` = „·“ v kódování ISO 8859-1). Soubor tak sám říká, ze které
 * revize modelu vznikl (stejně jako .mncad `modelRev`, řádek F `rev=` a PDF Info). Stejná revize = stejné bajty v prohlížeči
 * i v CLI. Už označený soubor se neoznačí podruhé; soubor bez hlavičky FILE_DESCRIPTION se vrátí beze změny.
 */
export function stampStepRev(bytes: Uint8Array, rev: string): Uint8Array {
  let head = "";
  const n = Math.min(bytes.length, 8192);
  for (let i = 0; i < n; i++) head += String.fromCharCode(bytes[i]);
  const m = /FILE_DESCRIPTION\s*\(\s*\(((?:'(?:[^']|'')*'\s*,?\s*)*)\)/.exec(head);
  if (!m || /MNCAD model revision/.test(m[1])) return bytes;
  const tag = `'MNCAD model revision ${rev.replace(/·/g, "\\X\\B7").replace(/[^\x20-\x7e]/g, "?")}'`;
  const at = m.index + m[0].length - 1; // před „)“ seznamu popisu
  const ins = (m[1].trim() ? "," : "") + tag;
  const out = new Uint8Array(bytes.length + ins.length);
  out.set(bytes.subarray(0, at), 0);
  for (let i = 0; i < ins.length; i++) out[at + i] = ins.charCodeAt(i);
  out.set(bytes.subarray(at), at + ins.length);
  return out;
}

/** revize modelu z hlavičky STEP (`stampStepRev`) – `r·a1b2c3`, nebo null */
export function stepRevOf(bytes: Uint8Array): string | null {
  let head = "";
  for (let i = 0; i < Math.min(bytes.length, 8192); i++) head += String.fromCharCode(bytes[i]);
  const m = /'MNCAD model revision (r\\X\\B7[0-9a-f]{6})'/.exec(head);
  return m ? m[1].replace("\\X\\B7", "·") : null;
}

/** 3D model v jádře (STEP, STL, BREP, OBJ, glTF, 3MF, VRML); STEP s pevným časem v hlavičce (`stableStep`) */
export async function modelBytes(kernel: Pick<KernelApi, "exportFile">, d: CadDoc, format: Exclude<Export3dFormat, "mncad">): Promise<Uint8Array> {
  if (d.kind === "draft") throw new Error(tr("2D výkres nemá 3D model pro {0}", format.toUpperCase()));
  if (isEmptyDoc(d)) throw new Error(tr("export: model je prázdný – nejdřív vymodelujte díl"));
  const data = new Uint8Array(await kernel.exportFile(d, format as ExportFormat));
  return format === "step" ? stableStep(data) : data;
}

/* ───────────────────────── výkresy ───────────────────────── */

/** prostředí výpočtu výkresů: jádro, pracovní prostor (díly sestavy, kusovník), písma hostitele */
export type DrawEnv = {
  kernel: KernelApi;
  ws: Workspace;
  fonts?: EngineHost["fonts"];
  /** kusovník plochý (výchozí) / strukturovaný – přepínač aplikace */
  flat?: boolean;
  hooks?: AsmEnvOptions;
};

/** list k výpočtu: dokument, index listu v `doc.drawings`, popis do PDF / varování a komponenta (výkres dílu ze sestavy) */
export type SheetJob = { doc: CadDoc; index: number; label: string; comp?: AsmComponent };

/**
 * Listy dokumentu: všechny listy všech jeho výkresů (pořadí v dokumentu) a u sestavy výkresy dílů a podsestav uložené
 * v komponentách – každý zdrojový díl jednou (`sourceKey`, pořadí prvního výskytu, i v podsestavách). Prázdné pole =
 * dokument ani jeho komponenty výkres nemají.
 */
export function documentSheetJobs(d: CadDoc): SheetJob[] {
  const jobs: SheetJob[] = [];
  const own = d.drawings ?? [];
  own.forEach((s, i) => jobs.push({ doc: d, index: i, label: own.length > 1 ? `${d.name}: ${s.name}` : d.name }));
  if (d.kind !== "assembly") return jobs;
  const seen = new Set<string>();
  const walk = (comps: AsmComponent[], depth: number) => {
    for (const c of comps) {
      if (c.source.kind !== "part" && c.source.kind !== "asm") continue;
      // výkresy jen vyráběných dílů – normálie a nakupované položky se nepřibalují, ani když výkres mají (bod 19, bom-model.ts)
      if (c.source.kind === "part" && supplyOf(c).kind !== "make") continue;
      const key = sourceKey(c.source);
      if (seen.has(key)) continue;
      seen.add(key);
      const sub = c.source.doc;
      const list = sub.drawings ?? [];
      list.forEach((s, i) => jobs.push({ doc: sub, index: i, label: list.length > 1 ? `${sub.name}: ${s.name}` : sub.name, comp: c }));
      if (c.source.kind === "asm" && depth < 8) walk(sub.components ?? [], depth + 1);
    }
  };
  walk(d.components ?? [], 0);
  return jobs;
}

/** hotový list s popisem */
export type DocSheet = {
  out: DrawingResult;
  label: string;
  name: string;
  warnings: string[];
  lost: number;
  /** list v hláškách protokolu: list hlavního dokumentu jako vyhodnocení listu během (sheet-eval.ts `sheetLabel` –
   *  stejný text = táž hláška se neopakuje), výkres dílu z komponenty s názvem dílu */
  issue: string;
  /** revize modelu listu (díl z komponenty = revize dílu) a písmeno revize listu – metadata PDF / DXF (vlna 22, bod 20) */
  modelRev?: string;
  rev?: string;
};

/**
 * Spočítané listy dokumentu v rozsahu jednoho běhu CLI / serve (`sheetCacheScope`): `výkres export pdf dokument`
 * a `--formats pdf` téhož nezměněného dokumentu je nepočítají dvakrát (sestava 959: ~45 s za jeden výpočet). Mimo rozsah
 * (konzole prohlížeče – výchozí šablona razítka a jiná nastavení jsou mimo dokument) se nic nedrží. Klíč = jazyk, kusovník
 * plochý / strukturovaný a dokument (JSON); drží se nejvýš 2 dokumenty.
 */
let sheetCache: Map<string, DocSheet[]> | null = null;
const SHEET_CACHE_MAX = 2;
/** zapne paměť listů pro jeden běh; vrátí funkci, která ji vypne a zahodí */
export function sheetCacheScope(): () => void {
  const prev = sheetCache;
  sheetCache = new Map();
  return () => void (sheetCache = prev);
}

/**
 * Spočítá listy (`documentSheetJobs`) jako výkresové prostředí: hlavní dokument s doplňky razítka (hmotnost, kusovník,
 * balónky – `drawExtras`), výkresy dílů z komponent s hmotností dílu z postavených dílů sestavy. Dokument bez výkresu =
 * výchozí list (jako `výkres export` bez výkresu).
 */
export async function documentSheets(env: DrawEnv, d: CadDoc, jobs?: SheetJob[]): Promise<DocSheet[]> {
  const cache = jobs ? null : sheetCache; // vlastní výběr listů (volající) se nepamatuje
  const key = cache ? `${getLang()}|${env.flat ?? true}|${JSON.stringify(d)}` : "";
  const hit = cache?.get(key);
  if (hit) return hit;
  const out = await computeSheets(env, d, jobs ?? documentSheetJobs(d));
  if (cache) {
    cache.delete(key);
    cache.set(key, out);
    while (cache.size > SHEET_CACHE_MAX) cache.delete(cache.keys().next().value!);
  }
  return out;
}

async function computeSheets(env: DrawEnv, d: CadDoc, jobs: SheetJob[]): Promise<DocSheet[]> {
  const { generalTolWarnings, renderSheet } = await import("../drawing-export");
  // list vyhodnocený během (konec bloku / konec běhu – engine/drawing-track.ts) se nepočítá znovu (sheet-eval.ts)
  const compute: DrawingCompute = drawingMemo(env.kernel);
  const extrasOf = new Map<CadDoc, DrawingExtras>();
  const main = await drawExtras(env.ws, env.kernel, d, { ...(env.hooks ?? {}), flat: env.flat ?? true });
  extrasOf.set(d, main);
  const extras = async (j: SheetJob): Promise<DrawingExtras> => {
    let x = extrasOf.get(j.doc);
    if (!x) {
      // díl ze sestavy: hmotnost z dílů, které postavil kusovník sestavy (bez nové stavby); podsestava = vlastní kusovník
      const mass = j.comp && j.comp.source.kind === "part" ? partInfo(env.ws.asm.cache, j.comp).massKg : undefined;
      x = mass !== undefined ? { massKg: mass } : await drawExtras(env.ws, env.kernel, j.doc, { ...(env.hooks ?? {}), flat: env.flat ?? true });
      extrasOf.set(j.doc, x);
    }
    return x;
  };
  const list = jobs.length ? jobs : [{ doc: d, index: 0, label: d.name }];
  const out: DocSheet[] = [];
  for (const j of list) {
    const x = await extras(j);
    const s = await renderSheet(j.doc, j.index, compute, x);
    // výkres dílu bez nepředepsaných tolerancí není úplný – export to ohlásí u listu (vlna 15, drawing-export.ts)
    out.push({ out: s.out, label: j.label, name: s.name, warnings: [...s.warnings, ...generalTolWarnings(j.doc, [s])], lost: s.lost, issue: j.doc === d ? sheetLabel(j.doc, j.index) : j.label, ...(s.meta.modelRev ? { modelRev: s.meta.modelRev } : {}), ...(s.meta.revision ? { rev: s.meta.revision } : {}) });
  }
  return out;
}

/** Vícestránkové PDF listů (jedna stránka na list ve svém formátu a orientaci) s písmy hostitele; `modelRev` = revize modelu do Info PDF. */
export async function drawingsToPdf(sheets: Pick<DocSheet, "out" | "rev">[], fonts?: PdfFonts, title?: string, modelRev?: string): Promise<Uint8Array> {
  const { drawingsToPdf: toPdf } = await import("../pdf");
  const { pdfInfo } = await import("../drawing-export");
  const blob = await toPdf(
    sheets.map((s) => s.out),
    title,
    fonts,
    pdfInfo({ modelRev, ...(sheets.length === 1 && sheets[0].rev ? { rev: sheets[0].rev } : {}) }),
  );
  return new Uint8Array(await blob.arrayBuffer());
}

/** varování listů ve tvaru pro protokol (u více listů s popisem listu) */
const sheetWarnings = (sheets: DocSheet[]): Produced["warnings"] => {
  const multi = sheets.length > 1;
  const out: Produced["warnings"] = [];
  for (const s of sheets) {
    for (const w of s.warnings) out.push({ sheet: multi ? s.label : "", text: w });
    if (s.lost) out.push({ sheet: multi ? s.label : "", text: tr("Kóty a poznámky bez geometrie: {0}", s.lost) });
  }
  return out;
};

/** kusovník sestavy jako CSV (jako tlačítko Kusovník CSV); díl / sestava bez komponent → null */
async function bomCsv(env: DrawEnv, d: CadDoc): Promise<Uint8Array | null> {
  if (d.kind !== "assembly" || !d.components?.length) return null;
  const x = await drawExtras(env.ws, env.kernel, d, { ...(env.hooks ?? {}), flat: env.flat ?? true });
  if (!x.bom?.length) return null;
  const { bomToCsv } = await import("../drawing");
  return new TextEncoder().encode(bomToCsv(x.bom));
}

/** písma hostitele (CLI: složka fonts/ vedle svazku); bez nich si pdf.ts písma načte samo (prohlížeč z webu) */
async function hostPdfFonts(fonts?: EngineHost["fonts"]): Promise<PdfFonts | undefined> {
  return fonts ? fonts() : undefined;
}

/**
 * Soubor ze všech listů dokumentu (`documentSheets`): PDF = jedno vícestránkové PDF; CSV = kusovník hlavního dokumentu;
 * DXF / DWG / SVG / PNG = ZIP s jedním souborem na list (jako „vše“ ve výkresovém prostředí). `base` = základ názvu.
 */
export async function documentDrawingFile(env: DrawEnv, d: CadDoc, format: OutDrawingFormat, base: string): Promise<Produced> {
  assertDrawable(d);
  if (format === "csv") {
    const csv = await bomCsv(env, d);
    if (!csv) throw new Error(tr("Kusovník CSV je jen u sestavy s komponentami – díl kusovník nemá."));
    return { name: `${base}_kusovnik.csv`, mime: OUT_MIME.csv, data: csv, format, warnings: [] };
  }
  const sheets = await documentSheets(env, d);
  // vyráběné díly bez výkresu / čísla – výkresy dílů z komponent jsou jen vyráběné (bod 19)
  // díly v záložkách: zastaralá kopie, jejíž díl výkres / číslo má, dostane radu `sestava obnovit #N` jako v `kusovník`
  // a `--formats` (bod 22g, kolo 6 – i `výkres export pdf vše`)
  const miss = d.kind === "assembly" ? makeIncomplete(docSupply(d, (c) => sourceKey(c.source)), staleHints(d, (x) => env.ws.findPart(x))) : [];
  const warnings = [...sheetWarnings(sheets), ...(miss.length ? [{ sheet: "", text: tr("vyráběnému dílu chybí výkres, číslo nebo označení materiálu: {0}", miss.join(", ")) }] : [])];
  if (format === "pdf") {
    const data = await drawingsToPdf(sheets, await hostPdfFonts(env.fonts), d.name, modelId(d).rev);
    return { name: `${base}.pdf`, mime: OUT_MIME.pdf, data, format, sheets: sheets.length, warnings };
  }
  const { drawingFileSheets } = await import("../drawing-export");
  const f = await drawingFileSheets(
    sheets.map((s) => ({ out: s.out, name: s.label })),
    format,
    { base, title: d.name, modelRev: modelId(d).rev },
  );
  // název jako u PDF (`Deska_vykresy.pdf`): jeden list `<základ>.<přípona>`, víc listů `<základ>_<formát>.zip`
  // (drawingFileSheets by k základu přidal „_vykres…“ – „Deska_vykresy_vykres.dxf“)
  const name = f.files ? `${base}_${format}.zip` : `${base}${f.name.slice(f.name.lastIndexOf("."))}`;
  return { name, mime: f.mime, data: f.data, format, ...(sheets.length > 1 ? { sheets: sheets.length } : {}), ...(f.files ? { files: f.files } : {}), warnings };
}

/**
 * Rozsah „vše“ (`výkres export pdf vše`, kap. 3.1 / B3 – vícestránkové PDF): u sestavy, jejíž komponenty nesou výkresy dílů,
 * jsou to všechny listy dokumentu včetně výkresů dílů (jako „dokument“, každý zdrojový díl jednou) – jinak by agent podle
 * zadání dostal jen list sestavy; u dílu listy aktivního výkresu (beze změny, w11).
 */
export const sheetScope = (d: CadDoc, sheet: number | string | "all" | "doc" | undefined): number | string | "all" | "doc" | undefined =>
  sheet === "all" && d.kind === "assembly" && documentSheetJobs(d).some((j) => j.doc !== d) ? "doc" : sheet;

/**
 * Soubor výkresu podle listu: číslo / název (aktivní výkres), „all“ = listy aktivního výkresu jedním souborem (PDF
 * vícestránkové, jinak ZIP), bez zadání aktivní list – výpočet `exportDrawing` (drawing-export.ts) s doplňky razítka
 * z enginu. „doc“ = `documentDrawingFile`. `name` = název zadaný příkazem (jinak název z výkresu).
 */
export async function drawingOutput(env: DrawEnv, d: CadDoc, format: OutDrawingFormat, sheet0: number | string | "all" | "doc" | undefined, name?: string): Promise<Produced> {
  assertDrawable(d);
  const sheet = sheetScope(d, sheet0);
  if (sheet === "doc") {
    const exts = [...FORMAT_EXT[format], "zip"];
    const given = name ? name.replace(new RegExp(`\\.(${exts.join("|")})$`, "i"), "") : "";
    const f = await documentDrawingFile(env, d, format, given || `${plainName(d.name)}_vykresy`);
    return f;
  }
  const { exportDrawing } = await import("../drawing-export");
  const compute: DrawingCompute = drawingMemo(env.kernel);
  const extras = await drawExtras(env.ws, env.kernel, d, { ...(env.hooks ?? {}), flat: env.flat ?? true });
  const r = await exportDrawing(d, format, sheet === undefined ? {} : { sheet }, compute, extras);
  const ext = r.files ? ["zip"] : FORMAT_EXT[format];
  const base = name ? name.replace(new RegExp(`\\.(${[...FORMAT_EXT[format], "zip"].join("|")})$`, "i"), "") : r.name.replace(/\.[^.]+$/, "");
  const file = outFileName(base, "vykres", ext);
  const sheets = r.sheets ?? r.files?.length;
  return {
    name: file,
    mime: r.mime,
    data: fromBase64(r.base64),
    format,
    ...(sheets ? { sheets } : {}),
    ...(r.files ? { files: r.files } : {}),
    ...(r.width ? { width: r.width, height: r.height } : {}),
    warnings: (r.warnings ?? []).map((w) => ({ sheet: "", text: w })),
  };
}

/* ───────────────────────── skica DXF ───────────────────────── */

type SketchFeature = Extract<Feature, { type: "sketch" }>;

/** skica jako DXF: podle názvu / id (poslední stejného názvu), jinak otevřená ve skicáři (`openId`), jinak poslední */
export function sketchDxf(d: CadDoc, sketch: string | undefined, openId: string | null | undefined): { sketch: SketchFeature; data: Uint8Array } {
  const sketches = d.features.filter((f): f is SketchFeature => f.type === "sketch");
  let sk: SketchFeature | undefined;
  if (sketch) {
    const n = sketch.toLowerCase();
    sk = [...sketches].reverse().find((s) => s.id === sketch || s.name.toLowerCase() === n);
    if (!sk) throw new Error(tr("skica „{0}“ v dokumentu není – skici: {1}", sketch, sketches.map((s) => s.name).join(", ") || "—"));
  } else {
    sk = (openId && sketches.find((s) => s.id === openId)) || sketches[sketches.length - 1];
    if (!sk) throw new Error(tr("dokument nemá žádnou skicu k exportu DXF"));
  }
  if (!sk.entities.length) throw new Error(tr("skica „{0}“ je prázdná", sk.name));
  return { sketch: sk, data: new TextEncoder().encode(sketchToDxf(sk.entities)) };
}

/* ───────────────────────── výstupy `--formats` (CLI, HTTP) ───────────────────────── */

/** formáty `--formats` (CLI args.ts) */
export type DocFormat = "step" | "stl" | "mncad" | "pdf" | "dxf" | "dwg" | "svg" | "csv";

/** má dokument (nebo díl v jeho komponentách) výkres? – `--formats auto` pak přidá PDF všech listů */
export const hasDrawings = (d: CadDoc): boolean => documentSheetJobs(d).length > 0;

/** hláška pro protokol: kód, argumenty / text, dokument */
export type OutNote = { code: "drawing.warning" | "drawing.section-miss" | "drawing.dims-incomplete" | "drawing.default-sheet" | "host.app-only" | "out.check-failed" | "out.reload-invalid" | "out.unsupported" | "geom.exact-invalid" | "msg.note" | "out.no-solid" | "out.free-surfaces" | "bom.docs" | "bom.make-incomplete" | "asm.stale-copy" | "drawing.dim-detached"; args?: unknown[]; text?: string; level?: "error" | "warn" | "note" };

/**
 * Úplnost výrobní dokumentace sestavy pro výstupy (vlna 22, bod 19): ℹ souhrn „vyráběné 2 (bez výkresu 1), normálie 2,
 * nakupované 0“ a ⚠ vyráběné díly bez výkresu nebo čísla – výkresy normálií a nakupovaných položek se nepřibalují.
 * Díl / sestava bez komponent → nic.
 */
export function asmDocNotes(d: CadDoc, partOf?: (name: string) => CadDoc | null | undefined): OutNote[] {
  if (d.kind !== "assembly" || !d.components?.length) return [];
  const s = docSupply(d, (c) => sourceKey(c.source));
  // díly v záložkách (`partOf`): zastaralá kopie, jejíž díl výkres / číslo má, dostane radu `sestava obnovit #N` (bod 22g)
  const hints = staleHints(d, partOf);
  const out: OutNote[] = [{ code: "bom.docs", args: [docSupplyLine(s, hints)] }];
  const miss = makeIncomplete(s, hints);
  if (miss.length) out.push({ code: "bom.make-incomplete", args: [miss.join(", ")] });
  return out;
}

/**
 * Jeden výstup `--formats` dokumentu `d` (kap. 3.1, rozhodnutí 15.7): `.mncad`, STEP (znovu načtený a změřený –
 * `check=ok|fail` v řádku F), STL, výkres = všechny listy dokumentu i výkresy dílů z komponent (PDF jedno vícestránkové,
 * DXF / DWG / SVG soubor na list), CSV = kusovník sestavy. Názvy podle dokumentu (`Deska 1.step`, `Deska 1 výkres.pdf`).
 * Vrací zapsané soubory; hlášky (varování listů, kontrola STEP, formát jen v aplikaci) předá `note`.
 */
export async function writeDocFormat(host: Pick<EngineHost, "kernel" | "fonts" | "phase"> & { files: FileSink }, ws: Workspace, d: CadDoc, fmt: DocFormat, note: (n: OutNote) => void, o: { flat?: boolean; hooks?: AsmEnvOptions } = {}): Promise<OutFile[]> {
  const base = d.name.trim() || "model";
  const write = (name: string, mime: string, data: Uint8Array, format: string) => host.files.write({ name, mime, data, doc: d.name, format });
  if (fmt === "mncad") {
    const p = projectFile(d, "");
    const f = await write(`${base}.mncad`, OUT_MIME.mncad, p.data, "mncad");
    f.modelRev = p.modelRev; // revize modelu v souboru i v řádku F (vlna 22, bod 12)
    return [f];
  }
  if (fmt === "step" || fmt === "stl") {
    // fáze „přestavba modelu“ PŘED stavbou při složení modelu (vlna 22 kolo 6, bod 22h – dřív až po řádcích build i/n)
    let lastPhase = "";
    const phase = (p: string) => {
      if (p !== lastPhase) host.phase?.(`out:${fmt}`, p);
      lastPhase = p;
    };
    phase("model");
    // složení modelu (22c): bez tělesa → STL ✗ out.no-solid, u STEP to řekne kontrola souboru; jména komponent sestavy
    const ms = await modelSolids(host.kernel, ws, d, o.hooks ?? {});
    // STEP: přesná kontrola platnosti před exportem (do 400 ploch, vlna 22 bod 22a) – nález ⚠, neproběhlá ℹ; model bez tělesa ne
    const pre = fmt === "step" && ms?.solids !== 0 && "validity" in host.kernel ? await exactBeforeExport(host.kernel, null, undefined, d).catch(() => null) : null;
    // export jako úloha s fázemi (vlna 22, bod 22h): přestavba, převod, zápis, kontrola STEP zpětným načtením
    const { runExportJob } = await import("./export-job");
    const job = await runExportJob(d, fmt, { kernel: host.kernel, phase, write: (data) => write(`${base}.${fmt}`, OUT_MIME[fmt], data, fmt) }, { check: fmt === "step", verifyFirst: false, ...(ms?.parts ? { parts: ms.parts } : {}) });
    const f = job.out;
    f.modelRev = job.modelRev;
    f.phases = job.phases;
    if (pre && pre.level === "warn") note({ code: "geom.exact-invalid", args: [d.name, pre.text] });
    else if (pre && pre.level === "note") note({ code: "msg.note", text: pre.text, level: "note" });
    if (job.check) {
      const c = job.check;
      f.check = { ok: c.ok, text: c.line.replace(/^[✓⚠✗ℹ]\s*/, "") };
      if (!c.ok) note({ code: c.code ?? "out.check-failed", text: f.check.text, level: c.level === "error" || Number.isNaN(c.volumeDiffPct) ? "error" : "warn" });
      else if (c.level === "note") note({ code: "msg.note", text: f.check.text, level: "note" }); // platnost souboru nezkontrolována (22c kolo 7)
    } else if (ms) {
      const v = solidVerdict(ms, "STL", "model", ms.parts);
      if (v) {
        f.check = { ok: false, text: v.text };
        note({ code: v.code, text: v.text, level: v.level });
      }
    }
    return [f];
  }
  if (d.kind === "draft") {
    // DXF / DWG 2D výkresu píše stejný exportér jako `2d export …` (běží i v Node); tisk PDF / SVG rozvržení je jen v aplikaci
    if ((fmt === "dxf" || fmt === "dwg") && d.draft) {
      const f = await (await import("../draft/io")).draftExport(d.draft, fmt, { name: base });
      for (const w of f.warnings.slice(0, 5)) note({ code: "drawing.warning", text: w, level: "warn" });
      return [await write(`${base}.${fmt}`, f.mime, f.data, fmt)];
    }
    note({ code: "host.app-only", args: [tr("export 2D výkresu do {0}", fmt.toUpperCase())] });
    return [];
  }
  const env: DrawEnv = { kernel: host.kernel, ws, ...(host.fonts ? { fonts: host.fonts } : {}), flat: o.flat ?? true, ...(o.hooks ? { hooks: o.hooks } : {}) };
  // úplnost dokumentace sestavy (ℹ souhrn + ⚠ vyráběné bez výkresu / čísla) – u výkresu a kusovníku; job.ts opakování vynechá
  for (const n of asmDocNotes(d, (x) => ws.findPart(x))) note(n);
  // 22g (kolo 3): kusovník / výkres sestavy z kopie dílu starší než díl v záložce – export to řekne vždy (dřív jen řádek změny
  // dílu nebo `kusovník`; CSV s prázdným číslem a „— (třída Ocel)“ se zapsal bez ⚠)
  if (d.kind === "assembly") for (const sc of staleCopies(d, (n) => ws.findPart(n))) note({ code: "asm.stale-copy", text: tr("{0} sestavy se zapisuje z kopie dílu: {1}", fmt.toUpperCase(), staleCopyText(sc)), level: "warn" });
  if (fmt === "csv") {
    const csv = await bomCsv(env, d);
    if (!csv) {
      // `--formats csv` je vždy výslovná volba (auto ho neobsahuje) → ✗
      note({ code: "out.unsupported", args: ["CSV", tr("Kusovník CSV je jen u sestavy s komponentami – díl kusovník nemá.")], level: "error" });
      return [];
    }
    return [await write(tr("{0} kusovník", base) + ".csv", OUT_MIME.csv, csv, "csv")];
  }
  // dokument bez výkresu: výchozí list – jako `výkres export` (⚠ drawing.default-sheet, přísný režim ho zastaví)
  if (!hasDrawings(d)) note({ code: "drawing.default-sheet" });
  const sheets = await documentSheets(env, d);
  // kód podle textu jádra (sheet-eval.ts): rovina řezu mimo těleso = ✗ drawing.section-miss (B5), jinak ⚠ drawing.warning;
  // list jako vyhodnocení listu během běhu (engine/drawing-track.ts) – job.ts tutéž hlášku podruhé nepřidá
  for (const s of sheets) {
    for (const w of s.warnings) {
      // neúplné kóty listu (bod 18) = ⚠ drawing.dims-incomplete
      const wc = sheetWarningCode(w);
      const code = wc === "drawing.section-miss" || wc === "drawing.dims-incomplete" || wc === "drawing.dim-detached" ? wc : "drawing.warning";
      note({ code, args: issueArgs(code, s.issue, w), ...(code === "drawing.section-miss" ? { level: "error" as const } : {}) });
    }
    if (s.lost) note({ code: "drawing.warning", args: [s.issue, tr("Kóty a poznámky bez geometrie: {0}", s.lost)] });
  }
  if (fmt === "pdf") {
    const data = await drawingsToPdf(sheets, await hostPdfFonts(host.fonts), d.name, modelId(d).rev);
    const f = await write(tr("{0} výkres", base) + ".pdf", OUT_MIME.pdf, data, "pdf");
    f.sheets = sheets.length;
    return [f];
  }
  const { drawingFile } = await import("../drawing-export");
  const out: OutFile[] = [];
  for (const [i, s] of sheets.entries()) {
    const r = await drawingFile(s.out, fmt, { base, title: s.label, ...(s.modelRev ? { modelRev: s.modelRev } : {}), ...(s.rev ? { rev: s.rev } : {}) });
    const name = sheets.length > 1 ? tr("{0} výkres {1}", base, i + 1) : tr("{0} výkres", base);
    const f = await write(`${name}.${fmt}`, r.mime, r.data, fmt);
    f.sheets = 1;
    out.push(f);
  }
  return out;
}
