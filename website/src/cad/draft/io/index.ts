/**
 * BALÍK 4 (io) – DWG / DXF import a export 2D výkresu. Vstupní bod balíku: registruje příkazy EXPORT a IMPORT
 * a poskytuje funkce pro GUI (Výstup → Export / Otevřít, Ctrl+O, přetažení souboru) a API (window.mncad.draftImport).
 *
 * Zápis: DXF R12 (vlastní zapisovač), DXF R2000–R2018 ASCII i binární, DWG R2000–R2018 (acad-ts, opravený zápis
 * velkých výkresů). Čtení: DWG R2000–R2018, DXF R12–R2018 ASCII i binární, kódové stránky. Převod pokrývá všechny
 * druhy entit jádra a balíků 2 a 3 (mtext, kóty, odkazy, šrafy, tolerance, bloky s atributy, rozvržení s výřezy),
 * tabulky (hladiny, typy čar, textové a kótovací styly), XDATA a handle; co model neumí, je v `ext` a zapíše se zpět.
 * Velké soubory se čtou v pracovním vlákně (průběh, Zrušit). Soubory balíku: draft/io/*.
 */
import { getLang, tr } from "../../i18n";
import { registerCommand } from "../commands";
import type { DraftModel } from "../model";
import type { DwgVersion } from "../../formats/dwg-versions";
import type { ImportNote } from "./from-cad";
import type { MergeReport } from "./merge";
import { setSelection } from "../session";
import "./types";

export type DraftExportFormat = "dxf" | "dwg";
export const DRAFT_IMPORT_ACCEPT = ".dxf,.dwg";
/** verze pro export: DWG R2000–R2018, DXF navíc R12 */
export type DraftExportVersion = DwgVersion | "R12";
export const DXF_VERSIONS: DraftExportVersion[] = ["R2018", "R2013", "R2010", "R2007", "R2004", "R2000", "R12"];

/** výsledný soubor exportu */
export type DraftFile = { name: string; mime: string; bytes: number; text?: string; base64?: string; data: Uint8Array; version: string; warnings: string[] };

const toB64 = (u8: Uint8Array) => {
  let b = "";
  for (let i = 0; i < u8.length; i += 0x8000) b += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(b);
};
export const fromB64 = (s: string): Uint8Array => {
  const bin = atob(s.replace(/^data:[^,]*,/, ""));
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
};
const safe = (s: string) => (s || "vykres").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_").slice(0, 60);

/**
 * Export 2D modelu do DXF / DWG. DWG R2000–R2018 (výchozí R2018); DXF R12 (vlastní zapisovač), R2000–R2018
 * (výchozí R2018), `binary` = binární DXF (R2000+).
 */
export async function draftExport(model: DraftModel, format: DraftExportFormat, opts: { name?: string; version?: DraftExportVersion; binary?: boolean } = {}): Promise<DraftFile> {
  const io = await import("./files");
  const name = `${safe(opts.name ?? "vykres")}.${format}`;
  if (format === "dxf") {
    const version = opts.version ?? "R2018";
    const binary = !!opts.binary && version !== "R12";
    const r = io.draftToDxfFile(model, { version, binary });
    return { name, mime: "image/vnd.dxf", bytes: r.data.length, ...(binary ? { base64: toB64(r.data) } : { text: r.text }), data: r.data, version: binary ? `${version} binary` : version, warnings: r.warnings };
  }
  if (opts.version === "R12") throw new Error(tr("DWG R12 nelze zapsat – použijte DXF R12 nebo DWG R2000 a novější"));
  const version = (opts.version ?? "R2018") as DwgVersion;
  const r = io.draftToDwgFile(model, version);
  return { name, mime: "application/acad", bytes: r.data.length, base64: toB64(r.data), data: r.data, version, warnings: r.warnings };
}

/** text poznámky importu */
export function importNoteText(n: ImportNote, version?: string): string {
  const parts = [tr("Načteno {0} entit, {1} hladin, {2} bloků, {3} rozvržení.", n.entities, n.layers, n.blocks, n.layouts)];
  if (version) parts.unshift(tr("Formát {0}.", version));
  const list = (r: Record<string, number>) => Object.entries(r).map(([k, v]) => `${k} ${v}`).join(", ");
  if (Object.keys(n.converted).length) parts.push(tr("Převedeno na 2D entity: {0}.", list(n.converted)));
  if (Object.keys(n.kept).length) parts.push(tr("Uchováno bez zobrazení (zapíše se zpět): {0}.", list(n.kept)));
  if (Object.keys(n.skipped).length) parts.push(tr("Nepřevedeno: {0}.", list(n.skipped)));
  const xrefs = n.warnings.filter((w) => w.startsWith("xref:")).map((w) => w.slice(5));
  if (xrefs.length) parts.push(tr("Externí reference (XREF) se nenačítají: {0}.", xrefs.join(", ")));
  const other = n.warnings.filter((w) => !w.startsWith("xref:"));
  if (other.length) parts.push(tr("Varování: {0}", other.slice(0, 5).join("; ") + (other.length > 5 ? " …" : "")));
  return parts.join(" ");
}

export type DraftImportProgress = (stage: "read" | "build" | "convert", f: number) => void;
export type DraftImportResult = { model: DraftModel; note: string; format: DraftExportFormat; version: string; report: ImportNote };

/** chyba zrušeného importu (Zrušit) */
export class DraftImportCancelled extends Error {
  constructor() {
    super(tr("Načítání zrušeno."));
    this.name = "AbortError";
  }
}

/** pracovní vlákno je k dispozici (prohlížeč) – v testech a bez Workeru se čte v hlavním vlákně */
const canWorker = () => typeof window !== "undefined" && typeof Worker !== "undefined";

/**
 * Import DXF / DWG jako nový 2D model (s poznámkou, co se převedlo jinak / nepřevedlo). V prohlížeči v pracovním
 * vlákně: `onProgress` hlásí průběh, `signal` (AbortController) import zruší.
 */
export async function draftImport(name: string, bytes: Uint8Array, opts: { onProgress?: DraftImportProgress; signal?: AbortSignal; worker?: boolean } = {}): Promise<DraftImportResult> {
  if (opts.signal?.aborted) throw new DraftImportCancelled();
  const useWorker = opts.worker ?? canWorker();
  try {
    if (!useWorker) {
      const io = await import("./files");
      const r = io.draftFromFile(name, bytes, opts.onProgress);
      return { model: r.model, note: importNoteText(r.note, r.version), format: r.format, version: r.version, report: r.note };
    }
    return await new Promise<DraftImportResult>((resolve, reject) => {
      const w = new Worker(new URL("./import-worker.ts", import.meta.url), { type: "module" });
      const done = () => {
        w.terminate();
        opts.signal?.removeEventListener("abort", abort);
      };
      const abort = () => {
        done();
        reject(new DraftImportCancelled());
      };
      opts.signal?.addEventListener("abort", abort);
      w.onmessage = (ev: MessageEvent<{ t: string; stage?: "read" | "build" | "convert"; f?: number; model?: DraftModel; note?: ImportNote; format?: DraftExportFormat; version?: string; msg?: string }>) => {
        const m = ev.data;
        if (m.t === "p") opts.onProgress?.(m.stage!, m.f ?? 0);
        else if (m.t === "done") {
          done();
          resolve({ model: m.model!, note: importNoteText(m.note!, m.version), format: m.format!, version: m.version ?? "", report: m.note! });
        } else {
          done();
          reject(new Error(m.msg ?? "?"));
        }
      };
      w.onerror = (ev) => {
        done();
        reject(new Error(ev.message || tr("pracovní vlákno importu selhalo")));
      };
      const copy = bytes.slice();
      w.postMessage({ name, bytes: copy, lang: getLang() }, [copy.buffer]);
    });
  } catch (e) {
    if (e instanceof DraftImportCancelled) throw e;
    throw new Error(tr("Soubor {0} se nepodařilo přečíst: {1}", name, (e as Error)?.message ?? String(e)));
  }
}

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const VER_RE = /^(r12|r2000|r2004|r2007|r2010|r2013|r2018|ac1009|ac1015|ac1018|ac1021|ac1024|ac1027|ac1032)$/i;
const AC: Record<string, DraftExportVersion> = { AC1009: "R12", AC1015: "R2000", AC1018: "R2004", AC1021: "R2007", AC1024: "R2010", AC1027: "R2013", AC1032: "R2018" };

registerCommand({
  id: "EXPORT",
  names: { cs: ["export", "exportovat", "uložit-jako"], en: ["export", "saveas", "dxfout"], de: ["exportieren", "export2"] },
  group: "output",
  readonly: true,
  desc: () => tr("export výkresu do DXF (R12, R2000–R2018, ASCII i binární) nebo DWG (R2000–R2018); soubor se stáhne (v API je v results[].data.file)"),
  usage: () => tr("export dxf | export dxf verze R12 | export dxf binární | export dwg verze R2013 | export dxf název \"Deska\""),
  async: async (c, a) => {
    const fmt = (a[0] ?? "dxf").toLowerCase() as DraftExportFormat;
    if (fmt !== "dxf" && fmt !== "dwg") throw new Error(tr("export: dxf nebo dwg"));
    let version: DraftExportVersion | undefined;
    let name: string | undefined;
    let binary = false;
    for (let i = 1; i < a.length; i++) {
      const w = fold(a[i]);
      if (["verze", "version"].includes(w)) {
        const v = (a[++i] ?? "").toUpperCase();
        if (!VER_RE.test(v)) throw new Error(tr("export: neznámá verze {0} – R12 (jen DXF), R2000, R2004, R2007, R2010, R2013, R2018", a[i] ?? ""));
        version = (AC[v] ?? v) as DraftExportVersion;
      } else if (VER_RE.test(a[i])) version = (AC[a[i].toUpperCase()] ?? a[i].toUpperCase()) as DraftExportVersion;
      else if (["binarni", "binary", "binar", "bin"].includes(w)) binary = true;
      else if (["nazev", "name", "soubor", "file", "datei"].includes(w)) name = a[++i];
      else throw new Error(tr("export: neznámá volba {0}", a[i]));
    }
    if (binary && fmt !== "dxf") throw new Error(tr("export: binární je jen DXF"));
    const f = await draftExport(c.tx.model, fmt, { name: name ?? c.ui?.docName?.(), version, binary });
    c.out("file", { name: f.name, mime: f.mime, bytes: f.bytes, version: f.version, ...(f.warnings.length ? { warnings: f.warnings } : {}), ...(f.text !== undefined ? { text: f.text } : { base64: f.base64 }) });
    c.ui?.download?.(f.name, f.data, f.mime);
    c.log(tr("✓ {0} ({1}, {2} kB)", f.name, f.version, Math.max(1, Math.round(f.bytes / 1024))));
    for (const w of f.warnings.slice(0, 5)) c.log(`⚠ ${w}`);
  },
});

/**
 * Most do GUI (ui-io.tsx): v pracovní ploše otevře výběr souboru s průběhem a Zrušit – `merge` = vložit do otevřeného
 * výkresu místo otevření v nové záložce. Bez GUI (agenti, testy) chybí.
 */
export const ioUiBridge: { open?: (o: { merge: boolean }) => void } = {};

const MERGE_WORDS = ["sloucit", "vlozit", "do-vykresu", "merge", "insert", "einfugen", "zusammenfuhren"];
const isMergeWord = (w: string) => MERGE_WORDS.includes(fold(w));

/** text přehledu vložení výkresu */
export function mergeNoteText(name: string, r: MergeReport): string {
  const parts = [tr("✓ {0}: vloženo {1} entit do výkresu (vybrané).", name, r.entities)];
  const locked = r.entities - (r.selectable?.length ?? r.entities);
  if (locked > 0) parts.push(tr("Na zamčených, zmrazených nebo vypnutých hladinách: {0} (nevybrané).", locked));
  if (r.scale !== 1) parts.push(tr("Jednotky převedeny měřítkem {0}.", +r.scale.toPrecision(10)));
  const nw = [...r.layers.map((x) => tr("hladina {0}", x)), ...r.blocks.filter((b) => !b.startsWith("*")).map((x) => tr("blok {0}", x))];
  if (nw.length) parts.push(tr("Nové: {0}.", nw.slice(0, 8).join(", ") + (nw.length > 8 ? " …" : "")));
  if (r.keptBlocks.length) parts.push(tr("Bloky se stejným názvem už ve výkresu jsou – ponechány stávající: {0}.", r.keptBlocks.slice(0, 6).join(", ")));
  if (r.layouts) parts.push(tr("Rozvržení zdroje ({0}) se nevkládají – jen modelový prostor.", r.layouts));
  if (r.unscaled.length) parts.push(tr("Bez převodu měřítka (neznámý druh): {0}.", r.unscaled.join(", ")));
  return parts.join(" ");
}

registerCommand({
  id: "IMPORT",
  names: { cs: ["import", "otevřít-dxf", "importovat"], en: ["import", "dxfin", "open"], de: ["importieren", "import2"] },
  group: "output",
  desc: () => tr("otevře DXF / DWG jako nový 2D výkres v nové záložce, nebo s volbou sloučit vloží jeho obsah do otevřeného výkresu (GUI: výběr souboru s průběhem; textem: import \"název.dxf\" base64)"),
  usage: () => tr("import (GUI) | import sloučit (GUI) | import \"vykres.dxf\" <base64> | import \"deska.dwg\" <base64> sloučit"),
  async: async (c, a) => {
    const merge = a.some(isMergeWord);
    const args = a.filter((w) => !isMergeWord(w));
    if (!args[1]) {
      if (c.interactive && ioUiBridge.open) return ioUiBridge.open({ merge });
      if (!merge && c.ui?.pickFile) return c.ui.pickFile();
      throw new Error(tr("import: zadejte název a obsah souboru v base64, nebo použijte window.mncad.draftImport"));
    }
    if (args.length > 2) throw new Error(tr("import: neznámá volba {0}", args[2]));
    const r = await draftImport(args[0], fromB64(args[1]));
    c.out("import", { format: r.format, version: r.version, ...r.report });
    if (merge) {
      const { mergeDraftInto } = await import("./merge");
      const rep = mergeDraftInto(c.tx, r.model);
      setSelection(c.session, rep.selectable);
      c.out("merge", { ...rep, ids: undefined, selectable: undefined, selected: rep.selectable.length });
      c.log(mergeNoteText(args[0], rep));
      return;
    }
    c.out("newModel", r.model);
    c.out("name", args[0].replace(/\.[^.]+$/, ""));
    c.log(`✓ ${args[0]}: ${r.note}`);
  },
});
