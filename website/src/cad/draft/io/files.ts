/**
 * Soubory DWG / DXF ⇄ 2D model: rozpoznání formátu a verze, ASCII i binární DXF, kódové stránky, průběh čtení.
 * Zápis: DXF R2000–R2018 (ASCII / binární) a DWG R2000–R2018 přes acad-ts, DXF R12 vlastním zapisovačem (r12.ts).
 * Modul se načítá líně (acad-ts je velký) – v prohlížeči ho používá pracovní vlákno importu (import-worker.ts).
 */
import { ACadVersion, DwgReader, DwgWriter, DxfReader, DxfWriter } from "@node-projects/acad-ts";
import { tr } from "../../i18n";
import type { DwgVersion } from "../../formats/dwg-versions";
import type { DraftModel } from "../model";
import { applyAcadPatches } from "./acad-patch";
import { cadToDraft, type ImportNote } from "./from-cad";
import { cp1250Map, uEsc } from "./common";
import { draftToR12 } from "./r12";
import { ACAD, draftToCad } from "./to-cad";

export type DraftFileFormat = "dxf" | "dwg";
export type DxfVersion = DwgVersion | "R12";
export type DraftExportResult = { data: Uint8Array; text?: string; warnings: string[] };
export type DraftReadResult = { model: DraftModel; note: ImportNote; format: DraftFileFormat; version: string; binary?: boolean };

/** bajty → řetězec 1:1 (latin1) */
export function latin1(u8: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return s;
}

/** kódování windows-1250 (čeština) pro DXF před R2007; znaky mimo tabulku jako \U+XXXX (mimo BMP dvojice náhradních kódů) */
export function encodeCp1250(s: string): Uint8Array {
  const map = cp1250Map();
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else {
      const b = map.get(c);
      if (b !== undefined) out.push(b);
      else for (const x of uEsc(c)) out.push(x.charCodeAt(0));
    }
  }
  return Uint8Array.from(out);
}

/** 2D model → DXF (výchozí R2018 ASCII; R12 vlastním zapisovačem; `binary` = binární DXF) */
export function draftToDxfFile(model: DraftModel, opts: { version?: DxfVersion; binary?: boolean } = {}): DraftExportResult {
  const version = opts.version ?? "R2018";
  if (version === "R12") {
    const r = draftToR12(model);
    return { data: encodeCp1250(r.text), text: r.text, warnings: r.warnings };
  }
  const { doc, warnings } = draftToCad(model, { version, fmt: "dxf", binary: !!opts.binary });
  const unicode = (ACAD[version] ?? ACadVersion.AC1032) >= ACadVersion.AC1021;
  if (opts.binary) {
    const parts: Uint8Array[] = [];
    let n = 0;
    const w = new DxfWriter({ write: (u: Uint8Array) => void (parts.push(u.slice()), (n += u.length)) }, doc, true);
    // binární DXF R2007+ je v UTF-8 (acad-ts by kódoval podle $DWGCODEPAGE); starší cp1250
    const wr = w as unknown as { _createStreamWriter: () => void; _encoding: string };
    const create = wr._createStreamWriter.bind(w);
    wr._createStreamWriter = () => {
      wr._encoding = unicode ? "utf-8" : "windows-1250";
      create();
    };
    w.write();
    const data = new Uint8Array(n);
    let o = 0;
    for (const p of parts) {
      data.set(p, o);
      o += p.length;
    }
    return { data, warnings };
  }
  const chunks: string[] = [];
  DxfWriter.writeToStream({ write: (s: string) => void chunks.push(s) }, doc, false);
  const text = chunks.join("");
  return { data: unicode ? new TextEncoder().encode(text) : encodeCp1250(text), text, warnings };
}

/** 2D model → DWG R2000–R2018 */
export function draftToDwgFile(model: DraftModel, version: DwgVersion = "R2018"): DraftExportResult {
  const { doc, warnings } = draftToCad(model, { version, fmt: "dwg" });
  return { data: DwgWriter.writeToBuffer(doc), warnings };
}

/** poloha řetězce ASCII v bajtech (bez převodu celého souboru na řetězec) */
export function indexOfAscii(u8: Uint8Array, s: string, from = 0): number {
  const c0 = s.charCodeAt(0);
  for (let i = u8.indexOf(c0, from); i >= 0 && i + s.length <= u8.length; i = u8.indexOf(c0, i + 1)) {
    let k = 1;
    while (k < s.length && u8[i + k] === s.charCodeAt(k)) k++;
    if (k === s.length) return i;
  }
  return -1;
}
/** obsahuje znaky mimo ASCII a je to platné UTF-8 (cp1250 / cp1252 s diakritikou platné UTF-8 prakticky nikdy není) */
export function isUtf8(u8: Uint8Array): boolean {
  let hi = false;
  for (let i = 0; i < u8.length; i++)
    if (u8[i] >= 0x80) {
      hi = true;
      break;
    }
  if (!hi) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(u8);
    return true;
  } catch {
    return false;
  }
}
/** bajty s nahrazeným úsekem [at, at + len) řetězcem ASCII */
function spliceBytes(u8: Uint8Array, at: number, len: number, rep: string): Uint8Array {
  const r = new TextEncoder().encode(rep);
  const out = new Uint8Array(u8.length - len + r.length);
  out.set(u8.subarray(0, at));
  out.set(r, at);
  out.set(u8.subarray(at + len), at + r.length);
  return out;
}
/** počet řádků „  0“ (skupinový kód 0 = začátek objektu; odhad pro průběh čtení) */
function countGroupZero(u8: Uint8Array): number {
  let n = 0;
  for (let i = u8.indexOf(10); i >= 0 && i + 4 < u8.length; i = u8.indexOf(10, i + 1))
    if (u8[i + 1] === 32 && u8[i + 2] === 32 && u8[i + 3] === 48 && (u8[i + 4] === 10 || u8[i + 4] === 13)) n++;
  return n;
}

/** verze DXF z hlavičky ($ACADVER) */
export const dxfVersionOf = (raw: string) => /\$ACADVER\r?\n\s*1\r?\n\s*(AC\d{4})/.exec(raw.slice(0, 4000))?.[1] ?? "AC1009";
const DWG_NAMES: Record<string, string> = { AC1009: "R12", AC1012: "R13", AC1014: "R14", AC1015: "R2000", AC1018: "R2004", AC1021: "R2007", AC1024: "R2010", AC1027: "R2013", AC1032: "R2018" };
export const versionLabel = (ac: string) => `${DWG_NAMES[ac] ?? ac} (${ac})`;

export type ReadProgress = (stage: "read" | "build" | "convert", f: number) => void;

/** chyba knihovny při čtení → srozumitelná zpráva (technický detail zkráceně v závorce) */
function readFailed(kind: "DWG" | "DXF", e: unknown): Error {
  const msg = String((e as Error)?.message ?? e).replace(/\s+/g, " ").trim();
  const short = msg.length > 90 ? `${msg.slice(0, 87)}…` : msg;
  return new Error(tr("{0} je poškozený, neúplný nebo to není výkres {0} (chyba čtení: {1})", kind, short || "?"));
}
/** začátek ASCII DXF: (komentáře 999) a „0 / SECTION“ */
const looksLikeDxf = (u8: Uint8Array) => /^\s*(999\r?\n[^\n]*\n\s*)*0\r?\n\s*SECTION\s/.test(latin1(u8.subarray(0, 4096)).replace(/^\uFEFF|^\xEF\xBB\xBF/, ""));

/** DXF / DWG → 2D model (formát podle obsahu, jinak podle přípony) */
export function draftFromFile(name: string, bytes: Uint8Array, onProgress?: ReadProgress): DraftReadResult {
  applyAcadPatches(); // rychlé čtení souřadnic DWG (acad-patch.ts) – i v pracovním vlákně, kde se nezapisuje
  const head = latin1(bytes.subarray(0, 6));
  if (!bytes.length || !/\S/.test(latin1(bytes.subarray(0, 4096)))) throw new Error(tr("soubor je prázdný"));
  const isDwg = /^AC\d{4}$/.test(head) || (/\.dwg$/i.test(name) && !/^\s*0\s*$/m.test(latin1(bytes.subarray(0, 32))));
  if (isDwg && !/^AC\d{4}$/.test(head)) throw new Error(tr("není to výkres DWG (chybí hlavička verze AC10xx) ani DXF"));
  if (!isDwg && !DxfReader.isBinaryStream(bytes, true) && !looksLikeDxf(bytes)) throw new Error(tr("není to výkres DXF (soubor nezačíná sekcí „0 / SECTION“) ani DWG"));
  let est = 1;
  const reading = (stageBase: "read" | "build") => (_s: object, e: { stage: number }) => {
    if (!onProgress) return;
    readCount++;
    if ((readCount & 1023) === 0) onProgress(e.stage === 1 ? "build" : stageBase, Math.min(0.99, readCount / est));
  };
  let readCount = 0;
  if (isDwg) {
    const ver = head;
    if (ver === "AC1009" || ver === "AC1012" || ver === "AC1014" || /^AC1\.|^AC2\.|^MC0/.test(ver)) throw new Error(tr("DWG {0} – podporované jsou verze R2000–R2018 (AC1015–AC1032). Uložte výkres v novější verzi.", versionLabel(ver)));
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const r = new DwgReader(buf);
    if (onProgress) {
      try {
        est = Math.max(1000, Number(new DwgReader(buf).readHeader().handleSeed) || bytes.length / 30) * 2;
      } catch {
        est = Math.max(1000, bytes.length / 30) * 2;
      }
      r.onProgress = reading("read");
    }
    let doc: ReturnType<DwgReader["read"]>;
    try {
      doc = r.read();
    } catch (e) {
      throw readFailed("DWG", e);
    }
    onProgress?.("convert", 0);
    const res = cadToDraft(doc, { fmt: "dwg", onProgress: (f) => onProgress?.("convert", f) });
    return { ...res, format: "dwg", version: versionLabel(ver) };
  }
  const isBinary = DxfReader.isBinaryStream(bytes, true);
  let data = bytes;
  let ver = "AC1009";
  if (!isBinary) {
    // jen hlavička a sekce TABLES jako řetězec – celý soubor (desítky MB) se převádí až v acad-ts
    const head = latin1(bytes.subarray(0, Math.min(bytes.length, 20000)));
    ver = dxfVersionOf(head);
    // DXF R2007+ je vždy v UTF-8 (bez ohledu na $DWGCODEPAGE) – acad-ts by četl podle kódové stránky; starší DXF
    // v UTF-8 (text předaný agentem jako řetězec, některé programy) se pozná podle platných vícebajtových znaků
    const utf8 = Number(ver.slice(2)) >= 1021 || isUtf8(bytes);
    if (utf8) {
      const m = /(\$DWGCODEPAGE\r?\n\s*3\r?\n)([^\r\n]*)/.exec(head);
      if (m && m[2] !== "utf-8") data = spliceBytes(bytes, m.index + m[1].length, m[2].length, "utf-8");
    }
    if (onProgress) est = Math.max(1000, countGroupZero(bytes) || bytes.length / 120) * 2;
  } else {
    // binární DXF R2007+: řetězce v UTF-8 bez ohledu na $DWGCODEPAGE
    const head2 = latin1(bytes.subarray(0, Math.min(bytes.length, 8192)));
    const vm = /\$ACADVER\0\x01\0(AC\d{4})\0/.exec(head2);
    if (vm) ver = vm[1];
    const cm = /\$DWGCODEPAGE\0\x03\0([^\0]*)\0/.exec(head2);
    if (vm && Number(vm[1].slice(2)) >= 1021 && cm) {
      const at = cm.index + "$DWGCODEPAGE".length + 3;
      const rep = new TextEncoder().encode("utf-8");
      const out = new Uint8Array(bytes.length - cm[1].length + rep.length);
      out.set(bytes.subarray(0, at));
      out.set(rep, at);
      out.set(bytes.subarray(at + cm[1].length), at + rep.length);
      data = out;
    }
    if (onProgress) est = Math.max(1000, bytes.length / 80) * 2;
  }
  const reader = new DxfReader(data);
  if (onProgress) reader.onProgress = reading("read");
  let doc: ReturnType<DxfReader["read"]>;
  try {
    doc = reader.read();
  } catch (e) {
    throw readFailed("DXF", e);
  }
  onProgress?.("convert", 0);
  const res = cadToDraft(doc, { fmt: "dxf", onProgress: (f) => onProgress?.("convert", f) });
  return { ...res, format: "dxf", version: isBinary ? `${versionLabel(ver)} binary` : versionLabel(ver), ...(isBinary ? { binary: true } : {}) };
}
