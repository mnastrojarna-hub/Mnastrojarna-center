/**
 * Port hostitele enginu (CAD-HEADLESS-NAVRH.md kap. 2.3): jádro, výstupní soubory, vstupní soubory, písma, sdílení a
 * volitelné háčky UI. Prohlížeč, CLI (`mncad run`) i `mncad serve` dodají každý svou implementaci; engine nezná nic jiného.
 *
 * Zde jsou i implementace v paměti (`memoryFileSink`, `memoryFileSource`) – pro `mncad serve` (vstupy jen z `body.files`,
 * výstupy do paměti relace) a testy – a společné očištění názvů souborů (`safeFileName`), které používá i FileSink CLI.
 */
import type { ApiCmd } from "../agent-api";
import type { MotionSignal } from "../asm-agent-kin";
import { tr } from "../i18n";
import type { PdfFonts } from "../pdf";
import type { PdfJs } from "../pdfjs";
import type { CadDoc } from "../types";
import type { KernelApi } from "./kernel";
import type { OutFile } from "./protocol-types";

export type { OutFile, PdfFonts, PdfJs };

/** soubor k zápisu: `doc` = název dokumentu, ze kterého vznikl; `format` = step | pdf | mncad | … */
export type OutWrite = { name: string; mime: string; data: Uint8Array; doc: string; format: string };
/** výstupy: prohlížeč = stažení bez dialogu (w11 `writeSaved`), CLI = `<out>/`, serve = paměť relace */
export type FileSink = { write(f: OutWrite): Promise<OutFile> };
/** vstupy: CLI = `--files DIR` a složka skriptu, serve = jen klíče `body.files`, prohlížeč = přiložené soubory */
export type FileSource = { read(name: string): Promise<{ name: string; data: Uint8Array }>; list(): string[] };

/** háčky aplikace v prohlížeči – v CLI chybí a příkazy, které je potřebují, dají ℹ `ui.no-view` nebo ✗ `host.app-only` */
export type UiHooks = {
  /** id skici otevřené v editoru skici (příkazy skici bez názvu pracují s ní) */
  openSketchId?(): string | null;
  /** otevřít výkres aktivního dokumentu v záložce */
  openDrawing?(): void;
  /** zásobník úprav v kontextu sestavy se změnil */
  asmStack?(stack: { asm: CadDoc; key: string }[]): void;
  /** pokyn panelu pohybové studie (přehrát, zastavit, krok, export snímků) */
  motion?(sig: MotionSignal): void;
  /** pohled 3D okna (iso, zepředu, …) */
  view?(v: string): void;
  /** překryv ploch třídy A (návaznost, hřebeny) – typ vlastní aplikace */
  surfOverlay?(overlay: unknown): void;
  /** zobrazení výsledku příkazu `api` (řez, styl, analýzy) – výpočet je v engine, zobrazení v aplikaci (B2) */
  api?(cmd: ApiCmd, doc: CadDoc): Promise<unknown>;
  /** po běhu (statistika, zavření úvodní obrazovky) */
  afterRun?(): void;
};

export type EngineHost = {
  kernel: KernelApi;
  files: FileSink;
  inputs: FileSource;
  /** písma PDF (po B2; ve fázi A je v Node obstará shim `fetch("/fonts/…")`) */
  fonts?: () => Promise<PdfFonts>;
  /** písmo textu modelu (prvek text, rytina) */
  textFont?: () => Promise<ArrayBuffer>;
  /** pdf.js – v Node `pdfjs-dist/legacy/build/pdf.mjs` */
  pdfjs?: () => Promise<PdfJs>;
  /** sdílení: základ odkazu a úložiště krátkých odkazů (`null` = jen dlouhý odkaz) */
  share?: { base: string; store: string | null };
  ui?: UiHooks;
  limits?: { maxMemMB: number };
  now?: () => number;
};

/* ───────────────────────── názvy souborů ───────────────────────── */

/** Chyba zápisu mimo výstupní složku (engine ji hlásí jako ✗ `out.path`). */
export class OutPathError extends Error {
  constructor(readonly fileName: string) {
    super(tr("název souboru „{0}“ míří mimo výstupní složku", fileName));
    this.name = "OutPathError";
  }
}

/** nejdelší název souboru: znaky (kódové body) a bajty UTF-8 – ext4/APFS dovolí 255 B, rezerva na „ (99)“ z `uniqueFileName` */
export const FILE_NAME_MAX = { chars: 120, bytes: 240 } as const;

/** název → základ a přípona (`.step`, `.pdf`, `.mncad`; 1–8 písmen a číslic) */
const splitExt = (name: string) => {
  const m = /^([\s\S]*?)(\.[A-Za-z0-9]{1,8})?$/.exec(name)!;
  return { base: m[1], ext: m[2] ?? "" };
};
const utf8Len = (s: string) => new TextEncoder().encode(s).length;

/**
 * Očištěný název souboru bez cesty: bez `/ \ : * ? " < > |`, řídicích znaků (C0, DEL, C1), U+2028/U+2029 a osamělých
 * náhradních znaků UTF-16 (→ `_`; zapsaný soubor má přesně vrácený název), bez úvodních a koncových teček a mezer.
 * Dlouhý název se zkrátí na `FILE_NAME_MAX` (120 znaků, 240 B UTF-8) po celých znacích a **s ponechanou příponou**.
 * Název, který po očištění zůstane prázdný nebo je `.`/`..`, vyhodí `OutPathError` (nic se nezapíše). Výsledek nikdy
 * neobsahuje oddělovač cesty, takže zápis `realpath(out)/název` nemůže z `out` uniknout.
 */
export function safeFileName(name: string): string {
  const clean = String(name ?? "")
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "_")
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, "_")
    .replace(/^[.\s]+|[.\s]+$/g, "");
  if (!clean || clean === "." || clean === ".." || /^_+$/.test(clean)) throw new OutPathError(name);
  if (clean.length <= FILE_NAME_MAX.chars && utf8Len(clean) <= FILE_NAME_MAX.bytes) return clean;
  const { base, ext } = splitExt(clean);
  const cps = [...base];
  let room = FILE_NAME_MAX.chars - ext.length;
  let bytes = FILE_NAME_MAX.bytes - ext.length;
  let n = 0;
  for (; n < cps.length && room > 0; n++, room--) {
    bytes -= utf8Len(cps[n]);
    if (bytes < 0) break;
  }
  return cps.slice(0, Math.max(1, n)).join("").replace(/[.\s]+$/g, "") + ext;
}

/** jedinečný název vůči `taken`: „Díl.step“, „Díl (2).step“, „Díl (3).step“… (jako w11 `outFileName`) */
export function uniqueFileName(name: string, taken: (n: string) => boolean): string {
  if (!taken(name)) return name;
  const m = /^([\s\S]*?)(\.[A-Za-z0-9]{1,8})?$/.exec(name)!;
  const base = m[1] || name;
  const ext = m[2] ?? "";
  for (let i = 2; ; i++) {
    const n = `${base} (${i})${ext}`;
    if (!taken(n)) return n;
  }
}

/** SHA-256 v šestnáctkové soustavě (WebCrypto – prohlížeč i Node ≥ 19) */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", data as BufferSource);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ───────────────────────── implementace v paměti ───────────────────────── */

export type MemoryFiles = FileSink & {
  /** zapsané soubory podle (očištěného, jedinečného) názvu */
  readonly files: Map<string, { file: OutFile; data: Uint8Array; mime: string }>;
};

/** FileSink v paměti (`mncad serve`, testy): očištěné a jedinečné názvy, SHA-256, `OutFile` jako v CLI */
export function memoryFileSink(): MemoryFiles {
  const files = new Map<string, { file: OutFile; data: Uint8Array; mime: string }>();
  return {
    files,
    async write(f: OutWrite): Promise<OutFile> {
      const name = uniqueFileName(safeFileName(f.name), (n) => files.has(n));
      const file: OutFile = { name, format: f.format, bytes: f.data.length, sha256: await sha256Hex(f.data), doc: f.doc };
      files.set(name, { file, data: f.data, mime: f.mime });
      return file;
    },
  };
}

/** Chybějící vstupní soubor (engine ho hlásí jako ✗ `file.missing` se seznamem dostupných). */
export class MissingInputError extends Error {
  constructor(
    readonly fileName: string,
    readonly available: string[],
  ) {
    super(tr("soubor „{0}“ není k dispozici – dostupné: {1}", fileName, available.join(", ") || "—"));
    this.name = "MissingInputError";
  }
}

/** FileSource z mapy název → data (`mncad serve`: jen `body.files`; testy). Jiné názvy než klíče mapy se nečtou. */
export function memoryFileSource(map: Record<string, Uint8Array> | Map<string, Uint8Array>): FileSource {
  const m = map instanceof Map ? new Map(map) : new Map(Object.entries(map));
  return {
    list: () => [...m.keys()].sort(),
    async read(name: string) {
      const data = m.get(name);
      if (!data) throw new MissingInputError(name, [...m.keys()].sort());
      return { name, data };
    },
  };
}
