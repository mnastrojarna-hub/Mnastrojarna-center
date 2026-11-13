/**
 * BALÍK 4 (io) – DWG / DXF import a export 2D výkresu. Vstupní bod balíku: registruje příkazy EXPORT a IMPORT
 * a poskytuje funkce pro GUI (Výstup → Export / Otevřít) a API (window.mncad.draftImport).
 *
 * Fáze A (jádro) dodává základní převod přes acad-ts (./basic.ts): hladiny, typy čar, hlavička, entity jádra.
 * Balík 4 rozšíří převod o všechny entity (MTEXT, DIMENSION, HATCH, LEADER/MLEADER, INSERT/ATTRIB, VIEWPORT…),
 * tabulky (styly textu a kót, bloky, rozvržení), XDATA, handle a věrný přenos tam a zpět. Soubory balíku: draft/io/*.
 */
import { tr } from "../../i18n";
import { registerCommand } from "../commands";
import type { DraftModel } from "../model";
import type { DwgVersion } from "../../formats/dwg-versions";

export type DraftExportFormat = "dxf" | "dwg";
export const DRAFT_IMPORT_ACCEPT = ".dxf,.dwg";

/** výsledný soubor exportu */
export type DraftFile = { name: string; mime: string; bytes: number; text?: string; base64?: string; data: Uint8Array };

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

/** Export 2D modelu do DXF / DWG (verze R2000–R2018, výchozí R2018). */
export async function draftExport(model: DraftModel, format: DraftExportFormat, opts: { name?: string; version?: DwgVersion } = {}): Promise<DraftFile> {
  const io = await import("./basic");
  const name = `${safe(opts.name ?? "vykres")}.${format}`;
  if (format === "dxf") {
    const text = io.draftToDxf(model, opts.version);
    const data = new TextEncoder().encode(text);
    return { name, mime: "image/vnd.dxf", bytes: data.length, text, data };
  }
  const data = io.draftToDwg(model, opts.version);
  return { name, mime: "application/acad", bytes: data.length, base64: toB64(data), data };
}

/** Import DXF / DWG jako nový 2D model (s poznámkou, co se zatím nepřevedlo). */
export async function draftImport(name: string, bytes: Uint8Array): Promise<{ model: DraftModel; note: string; format: DraftExportFormat }> {
  const io = await import("./basic");
  try {
    const r = io.draftFromFile(name, bytes);
    return { model: r.model, note: io.importNoteText(r.note), format: r.format };
  } catch (e) {
    throw new Error(tr("Soubor {0} se nepodařilo přečíst: {1}", name, (e as Error)?.message ?? String(e)));
  }
}

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

registerCommand({
  id: "EXPORT",
  names: { cs: ["export", "exportovat", "uložit-jako"], en: ["export", "saveas", "dxfout"], de: ["exportieren", "export2"] },
  group: "output",
  readonly: true,
  desc: () => tr("export výkresu do DXF nebo DWG (verze R2000–R2018); soubor se stáhne (v API je v results[].data.file)"),
  usage: () => tr("export dxf | export dwg verze R2013 | export dxf název \"Deska\""),
  async: async (c, a) => {
    const fmt = (a[0] ?? "dxf").toLowerCase() as DraftExportFormat;
    if (fmt !== "dxf" && fmt !== "dwg") throw new Error(tr("export: dxf nebo dwg"));
    let version: DwgVersion | undefined;
    let name: string | undefined;
    for (let i = 1; i < a.length; i++) {
      if (["verze", "version"].includes(fold(a[i]))) version = a[++i]?.toUpperCase() as DwgVersion;
      else if (["nazev", "name", "soubor", "file", "datei"].includes(fold(a[i]))) name = a[++i];
    }
    const f = await draftExport(c.tx.model, fmt, { name: name ?? c.ui?.docName?.(), version });
    c.out("file", { name: f.name, mime: f.mime, bytes: f.bytes, ...(f.text !== undefined ? { text: f.text } : { base64: f.base64 }) });
    c.ui?.download?.(f.name, f.data, f.mime);
    c.log(tr("✓ {0} ({1} kB)", f.name, Math.max(1, Math.round(f.bytes / 1024))));
  },
});

registerCommand({
  id: "IMPORT",
  names: { cs: ["import", "otevřít-dxf", "importovat"], en: ["import", "dxfin", "open"], de: ["importieren", "import2"] },
  group: "output",
  readonly: true,
  desc: () => tr("otevře DXF / DWG jako nový 2D výkres v nové záložce (v GUI výběr souboru; textem: import \"název.dxf\" base64)"),
  usage: () => tr("import (GUI) | import \"vykres.dxf\" <base64>"),
  async: async (c, a) => {
    if (!a[1]) {
      if (c.ui?.pickFile) return c.ui.pickFile();
      throw new Error(tr("import: zadejte název a obsah souboru v base64, nebo použijte window.mncad.draftImport"));
    }
    const r = await draftImport(a[0], fromB64(a[1]));
    c.out("newModel", r.model);
    c.out("name", a[0].replace(/\.[^.]+$/, ""));
    c.log(`✓ ${a[0]}: ${r.note}`);
  },
});
