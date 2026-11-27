/**
 * Vlákno běhu `mncad` (CAD-HEADLESS-NAVRH.md kap. 2.2, 3.1): parser, engine i jádro běží tady, ve `worker_threads`.
 * Hlavní vlákno je jen hlídač (`watchdog.ts`) – časový limit, paměť, Ctrl+C a pád řeší `terminate()` zvenku, protože
 * volání OCCT jsou synchronní a ve vlákně běhu by žádný časovač nedoběhl.
 *
 * Vlákno po každé operaci posílá průběžný stav (řádek, nové záznamy, nové soubory, paměť WASM + RSS), aby hlídač po
 * `terminate()` složil protokol z posledního známého stavu a doplnil ✗ `run.timeout` / `run.memory` na řádek rozpracované
 * operace. Jazyk (`setLang`) je modulový stav, tedy na vlákno – souběžné úlohy `mncad serve` s různým jazykem se nemíchají.
 *
 * Jádro je in-process (balík B1): klient `makeKernelClient` (kernel-client.ts, stejný jako v prohlížeči) nad transportem
 * `inProcessTransport` (kernel-inprocess.ts → `handleKernel` z kernel-ops.ts) ve stejném vlákně. Pád WASM = konec vlákna (kód 4):
 * nová instance OCCT se ve vlákně nespouští (`restart: false`). WASM jádra hledá hostitel (`main.ts` `wasmFile`) a cestu
 * předá v `JobInit.wasm` → `locateFile` (soubor může mít obsahový hash v názvu nebo ležet jinde – `MNCAD_WASM`).
 * Smyčka běhu skriptu je engine (balík B2): `engineRun` otevře `--open` dokumenty (FileSource, STEP přes jádro) a pak
 * `runInto` z engine/run.ts – tatáž smyčka a tytéž obsluhy operací (`engine/ops/*`) jako `runAgentText` v aplikaci.
 * Písma a sdílení dává engine hostitel (`setHostAssets`), Node shim zůstává jen jako záloha. Výstupy `--formats` zapisuje
 * `engine/files.ts` (`writeDocFormat`: STEP s kontrolou znovunačtením, jedno PDF všech listů včetně výkresů dílů
 * z komponent sestavy, .mncad), odkaz `--share` `engine/share-out.ts` (stejná pravidla jako text `sdílet`).
 */
import fs from "node:fs";
import path from "node:path";
import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { parseAgentText, AGENT_COMMANDS, type AgentOp } from "../agent";
import type { PdfFonts } from "../pdf";
import { AGENT_GUIDE } from "../agent-guide";
import { docHasContent } from "../draft/doc";
import { exportDrawing } from "../drawing-export";
import type { DrawingCompute } from "../drawing-agent";
import { setLang, tr, type CadLang } from "../i18n";
import { emptyDoc, type CadDoc, type Feature } from "../types";
import { loadsModel, modelTail } from "../engine/accept";
import { CODE_RE, codeEntry } from "../engine/codes";
import { memoryFileSink, memoryFileSource, MissingInputError, OutPathError, safeFileName, type EngineHost, type FileSink, type MemoryFiles, type OutWrite } from "../engine/host";
import { MemoryWorkspace, loadWorkspace } from "../engine/memory-workspace";
import { readDocument } from "../engine/open-file";
import { ReportBuilder } from "../engine/protocol";
import { opLabel, runInto } from "../engine/run";
import { docSummaries, pickMain, summarize, workspaceDocs, type DocItem } from "../engine/run-summary";
import { verifyKeyOf } from "../engine/verify";
import { hostAssets, setHostAssets } from "../host-assets";
import { selfStoreBase } from "../share";
import { asmDocNotes, hasDrawings, sheetCacheScope, writeDocFormat } from "../engine/files";
import { sameSheetFinding } from "../engine/sheet-eval";
import { shareInfo, shareWithPolicy } from "../engine/share-out";
import { shareContent, shareLinkKv } from "../engine/share-content";
import type { DocSummary, Entry, OutFile, RunReport, ShareInfo } from "../engine/protocol-types";
import type { Workspace } from "../engine/workspace";
import { inputRevOf, type RunStamp } from "../engine/run-queue";
import type { Formats, OutFormat, ShareView, StrictOpt } from "./args";
import { CliFileSink, CliFileSource } from "./file-sink";
import { scriptLines, strictStopper } from "./watchdog";
import { installNodeShims, installWasmGrowHook, memorySample, publishWasmHeap, type InstalledShims } from "./node-shims";
import { makeKernelClient, type KernelClient } from "../kernel-client";
import { inProcessTransport, type InProcessTransport } from "../kernel-inprocess";

export { strictStopper, opLabel };
// souhrny dokumentů (řádky D) jsou od vlny E v enginu – sdílí je prohlížeč (engine/run-summary.ts)
export { pickMain, summarize, workspaceDocs, type DocItem };

/* ───────────────────────── zprávy hlídač ↔ vlákno ───────────────────────── */

/** značka vlákna běhu ve `workerData` (hlavní vlákno ji má jako literál typu `JobInit["mncad"]`) */
export type Mem = { heapMB: number; jsMB: number; rssMB: number };

/** `workerData` vlákna běhu */
export type JobInit = {
  mncad: "mncad-job";
  lang: CadLang;
  version: string;
  /** základ sdílení (location.origin) */
  origin?: string;
  fontsDir: string | null;
  /** WASM jádra (`replicad_single.wasm`, i s hashem v názvu) od hostitele → `locateFile`; bez něj hledá emscripten vedle svazku */
  wasm?: string;
  shareStore?: string;
  /** jen testy (`MNCAD_TEST_FAULT`): throw | exit | fatal | busy:<ms> | grow:<MB> */
  fault?: string;
  /**
   * sdílená paměť s hlídačem: [0] = velikost haldy WASM v MB, zapisuje ji háček `WebAssembly.Memory.prototype.grow`
   * (emscripten zvětšuje haldu z JS i uprostřed dlouhého volání jádra) – hlídač ji čte bez čekání na konec operace
   */
  memSab?: SharedArrayBuffer;
};

export type JobInputs = { kind: "dirs"; roots: string[]; explicit: string[] } | { kind: "memory"; files: Record<string, Uint8Array> };
export type JobOut = { kind: "dir"; dir: string } | { kind: "memory" };

/** jeden běh skriptu (CLI `run`, HTTP `POST /run`) */
export type JobRequest = {
  script: string;
  lang: CadLang;
  strict: StrictOpt;
  open: string[];
  formats: Formats;
  doc?: string;
  allDocs: boolean;
  noOutputOnError: boolean;
  share: false | { view: ShareView; days: number };
  inputs: JobInputs;
  out: JobOut;
  /** relace k obnovení (`--resume`, obnova relace `serve` v novém vlákně) */
  resume?: Uint8Array | null;
  /** vrátit relaci (`ws.save()`) po běhu */
  saveSession: boolean;
  /** prázdný skript není chyba (pokračování relace: `--resume`, HTTP `session`) */
  allowEmpty?: boolean;
  /** id běhu (vlna 22, bod 12): `mncad run` = `r1`, `mncad serve` = id úlohy `j<n>` – `RunReport.run.id`, Σ `run=` */
  runId?: string;
};

export type ToJob = { t: "run"; id: number; req: JobRequest } | { t: "selftest"; id: number } | { t: "close" };

export type DoneFile = { file: OutFile; data?: Uint8Array; mime?: string };
export type FromJob =
  | { t: "ready"; ms: number; mem: Mem }
  | { t: "op-start"; id: number; line: number | null; op: string }
  | { t: "op-end"; id: number; line: number | null; op: string; ms: number; entries: Entry[]; files: OutFile[]; mem: Mem }
  | { t: "progress"; id: number; op: string; index?: number; total?: number; name?: string; phase?: string }
  /** identita běhu (id + revize vstupu) – hlídač ji dá i do protokolu přerušeného běhu */
  | { t: "run"; id: number; run: RunStamp }
  | { t: "done"; id: number; report: RunReport; files: DoneFile[]; session?: Uint8Array; mem: Mem }
  | { t: "failed"; id: number; error: string }
  | { t: "selftest"; id: number; result: SelftestResult }
  | { t: "fatal"; error: string };

/* ───────────────────────── smyčka běhu (fáze A) ───────────────────────── */

/** háčky průběhu – hlídač z nich zná rozpracovanou operaci a poslední stav */
export type RunHooks = {
  opStart(line: number | null, op: string): void;
  opEnd(line: number | null, op: string, ms: number): void;
};
export type JobRunOptions = { strict: StrictOpt; open: string[]; allowEmpty?: boolean };
/** podpis smyčky běhu CLI / HTTP (`engineRun` = `--open` + engine `runInto`) */
export type JobRunner = (ws: Workspace, text: string, host: EngineHost, rb: ReportBuilder, o: JobRunOptions, hooks: RunHooks) => Promise<void>;

/**
 * přísný režim: první ⚠/✗ mezi záznamy `entries` zastaví běh (STOP); vrací true, když se běh zastavil. Po skriptu
 * rozhoduje stav přísného režimu na řádku záznamu (`rb.strictMode.hit` – úseky `přísně` / `přísně vyp`, předpony výjimek;
 * záznam bez řádku = stav na konci skriptu), stejně jako smyčka enginu v prohlížeči; před skriptem (`--open`) volba běhu.
 */
function strictStop(rb: ReportBuilder, entries: readonly Entry[], strict: StrictOpt, line: number | null = null): boolean {
  if (rb.stopped) return true;
  const s = rb.strictMode ? rb.strictMode.hit(entries, line) : strictStopper(entries, strict);
  if (!s) return false;
  rb.stop(s.line ?? line, s.code ?? "msg.error");
  return true;
}

/** chybová hláška výjimky pro protokol */
export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Smyčka běhu CLI / HTTP: otevře `--open` dokumenty přes FileSource (.mncad/.json; STEP – sestava rozdělená jádrem
 * hostitele –, BREP, STL, DXF přes `readDocument`), pak provede skript enginem (`runInto`, engine/run.ts) – tatáž smyčka
 * a tytéž obsluhy jako `runAgentText` v aplikaci. Přísný režim: chyba rozboru zastaví běh před provedením, jinak první
 * ⚠/✗ operace (kromě výjimek) zastaví (STOP).
 */
export const engineRun: JobRunner = async (ws, text, host, rb, o, hooks) => {
  /** dokumenty `--open`: engine je ověří stavbou jako JSON na řádku skriptu (✗/⚠ prvků, i když skript přejde jinam) */
  const preloaded: { key: string; doc: CadDoc }[] = [];
  for (const name of o.open) {
    hooks.opStart(null, "open");
    const t0 = Date.now();
    const before = rb.entries.length;
    try {
      const f = await readDocument(host, name);
      await ws.openInTab(f.doc);
      preloaded.push({ key: verifyKeyOf(ws.docKey(), f.doc), doc: ws.present() });
      // dokument s prvky se teprve postaví: otevření je přijetí (ℹ op.accepted), výsledek dá ověřovací stavba enginu
      if (loadsModel(f.doc)) rb.code("op.accepted", { text: `${tr("otevřeno „{0}“", f.file)} – ${modelTail()}`, doc: f.doc.name });
      else rb.ok(null, tr("otevřeno „{0}“", f.file), f.doc.name);
      if (f.note) rb.code("msg.note", { text: f.note, doc: f.doc.name });
    } catch (e) {
      if (e instanceof MissingInputError) rb.code("file.missing", { text: e.message });
      else rb.code("op.failed", { args: [errText(e)] });
    }
    hooks.opEnd(null, "open", Date.now() - t0);
    // přísný režim: chybějící / neplatný `--open` zastaví běh dřív, než se provede skript (kap. 5.3)
    if (strictStop(rb, rb.entries.slice(before), o.strict)) return;
  }
  if (!text.trim() && !preloaded.length) {
    ws.beginRun?.();
    if (!o.open.length && !o.allowEmpty) rb.code("parse.error", { args: [tr("Prázdný vstup.")] });
    return;
  }
  // přísný režim (volba i řádky `přísně` ve skriptu) zastavuje smyčka enginu sama (engine/strict.ts) – i v prohlížeči;
  // samotné `--open` bez skriptu = prázdný skript: otevřené dokumenty se i tak ověří stavbou
  await runInto(ws, text, host, rb, {
    strict: o.strict,
    preloaded,
    hooks: {
      opStart: (line, op) => hooks.opStart(line, op),
      opEnd: (line, op, ms) => hooks.opEnd(line, op, ms),
    },
  });
};

/* ───────────────────────── dokumenty, výstupy, sdílení ───────────────────────── */

/**
 * formáty k zápisu pro dokument (rozhodnutí 15.7): `auto` = STEP dílu/sestavy + .mncad + jedno PDF všech listů, má-li
 * výkres dokument nebo díl v jeho komponentách (engine/files.ts `hasDrawings`)
 */
export function formatsFor(d: CadDoc, f: Formats): OutFormat[] {
  if (f === "none") return [];
  if (f !== "auto") return f;
  if (d.kind === "draft") return ["mncad"];
  return ["step", "mncad", ...(hasDrawings(d) ? (["pdf"] as const) : [])];
}

const b64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));


export type OutputPolicy = { formats: Formats; allDocs: boolean; doc?: string; noOutputOnError: boolean; share: JobRequest["share"]; strict?: StrictOpt };

/**
 * Zápis výstupů přísného běhu nanečisto (kap. 3.1, 5.3): soubory se drží v paměti, dokud všechny výstupy nevzniknou bez
 * ⚠/✗ – teprve pak se zapíší (`flush`); jinak STOP a nezapíše se nic (`--formats` ani odkaz). Název se ověří hned
 * (`safeFileName` → `OutPathError` = ✗ `out.path` u formátu), jedinečnost a SHA-256 až při zápisu.
 */
export class StagingSink implements FileSink {
  private readonly staged: { req: OutWrite; file: OutFile }[] = [];
  constructor(private readonly target: FileSink) {}
  get size(): number {
    return this.staged.length;
  }
  async write(f: OutWrite): Promise<OutFile> {
    const file: OutFile = { name: safeFileName(f.name), format: f.format, bytes: f.data.length, sha256: "", doc: f.doc };
    this.staged.push({ req: f, file });
    return file;
  }
  /** zapíše všechny odložené soubory do cíle; údaje doplněné k souboru po zápisu nanečisto (`sheets`) se přenesou */
  async flush(onError: (e: unknown, f: OutWrite) => void): Promise<void> {
    for (const { req, file } of this.staged.splice(0)) {
      try {
        const real = await this.target.write(req);
        for (const [k, v] of Object.entries(file)) if (!(k in real)) (real as Record<string, unknown>)[k] = v;
      } catch (e) {
        onError(e, req);
      }
    }
  }
  discard(): void {
    this.staged.length = 0;
  }
}

/** formáty a odkaz, které se pro prázdný dokument nezapíšou (pro ⚠/✗ `out.empty`) */
function emptyWanted(d: CadDoc, p: OutputPolicy, isMain: boolean): { what: string[]; explicit: boolean } {
  const fmts = formatsFor(d, p.formats);
  const what = fmts.map((f) => (f === "mncad" ? ".mncad" : f.toUpperCase()));
  if (p.share && isMain) what.push(tr("odkaz"));
  return { what, explicit: (Array.isArray(p.formats) && fmts.length > 0) || (!!p.share && isMain) };
}

/**
 * Závěr běhu (kap. 3.1): souhrny dokumentů (D), výstupy `--formats` a odkaz `--share`.
 * * prázdný dokument nic nezapíše, ale nikdy tiše: ⚠ `out.empty` (`--formats auto`), ✗ (výslovné formáty nebo `--share`),
 *   ℹ u dalších dokumentů `--all-docs`;
 * * přísný běh: první ⚠/✗ ze závěrečné stavby, z prázdného dokumentu, z výstupů nebo odkazu = STOP; výstupy se zapisují
 *   nanečisto (`StagingSink`) a na disk / do paměti relace jdou, jen když nic nezastavilo;
 * * přísný běh zastavený (STOP) → žádné výstupy `--formats` ani odkaz (soubory, které skript uložil sám, zůstávají);
 * * `--no-output-on-error` a jsou ✗ → žádné výstupy;
 * * jinak se zapíší soubory dokumentů, jejichž závěrečná stavba prošla; jsou-li v běhu ✗, každý soubor má `run=fail`.
 */
export async function finishRun(ws: Workspace, host: EngineHost, rb: ReportBuilder, p: OutputPolicy, hooks: RunHooks): Promise<{ docs: DocSummary[]; share?: ShareInfo }> {
  // přísný režim podle stavu na konci skriptu (volba běhu + řádky `přísně` / `přísně vyp`)
  const strict = rb.strictMode ? rb.strictMode.opt : (p.strict ?? false);
  const { items, activeId } = await workspaceDocs(ws);
  const main = pickMain(items, activeId, p.doc);
  // všechny dosavadní záznamy: ⚠/✗ v přísném úseku, které smyčka nezastavila, zastaví běh dřív, než se cokoli zapíše
  // (rozhodnutí 15.2 – STOP = žádné výstupy); záznamy závěru bez řádku posoudí stav přísného režimu na konci skriptu
  if (main === "missing") rb.code("op.failed", { args: [tr("dokument „{0}“ (--doc) není otevřený – otevřené: {1}", p.doc, items.map((x) => x.doc.name).join(", ") || "—")] });
  const mainItem = main === "missing" ? null : main;
  const wanted = p.allDocs ? items : mainItem ? [mainItem] : [];
  const targets = wanted.filter((x) => docHasContent(x.doc));
  const targetIds = new Set(targets.map((x) => x.id));
  hooks.opStart(null, "build");
  const t0 = Date.now();
  // řádky D: hlavní dokument, --all-docs a každý dokument, který běh založil nebo změnil (engine/run-summary.ts)
  const { docs, built } = await docSummaries(ws, host.kernel, rb, items, mainItem, targetIds);
  // vyžádané výstupy prázdného dokumentu: nikdy tiše (zpráva agenta, bod 3 „tiše zahodí prázdnou sestavu“)
  if (!rb.stopped)
    for (const it of wanted) {
      if (docHasContent(it.doc)) continue;
      const isMain = it.id === mainItem?.id;
      const w = emptyWanted(it.doc, p, isMain);
      if (!w.what.length) continue;
      rb.code("out.empty", { doc: it.doc.name, args: [w.what.join(", ")], level: !isMain ? "note" : w.explicit ? "error" : "warn" });
    }
  hooks.opEnd(null, "build", Date.now() - t0);
  if (strictStop(rb, rb.entries, strict)) return { docs };
  if (p.noOutputOnError && rb.count("error") > 0) return { docs };
  const staging = strict ? new StagingSink(host.files) : null;
  const outHost: EngineHost = staging ? { ...host, files: staging } : host;
  const beforeOut = rb.entries.length;
  for (const it of targets) {
    if (!built.get(it.id)) continue;
    for (const fmt of formatsFor(it.doc, p.formats)) {
      const t1 = Date.now();
      hooks.opStart(null, `out:${fmt}`);
      try {
        // STEP s kontrolou znovunačtením, PDF všech listů (i výkresy dílů z komponent) s kusovníkem, balónky a hmotností;
        // varování listu, které běh už ohlásil (vyhodnocení listu na řádku bloku – engine/drawing-track.ts), se neopakuje
        await writeDocFormat(outHost, ws, it.doc, fmt, (n) => {
          const e = codeEntry(n.code, { doc: it.doc.name, ...(n.args ? { args: n.args } : {}), ...(n.text ? { text: n.text } : {}), ...(n.level ? { level: n.level } : {}) });
          // týž nález listu i s upřesněným důvodem (řez mimo těleso z řádku příkazu: „… : List 1 – rovina řezu Y = …“) – 22i kolo 6
          if (!rb.entries.some((x) => sameSheetFinding(x, e))) rb.add(e);
        });
      } catch (e) {
        if (e instanceof OutPathError) rb.code("out.path", { doc: it.doc.name, args: [e.fileName] });
        // chybějící písma PDF / textu modelu (hostitel bez složky fonts) – ✗ host.fonts, ne obecná chyba (5.2 č. 36)
        else if (/Písmo se nenačetlo|font|fonts\//i.test(errText(e))) rb.code("host.fonts", { doc: it.doc.name });
        else rb.code("op.failed", { doc: it.doc.name, args: [`${fmt}: ${errText(e)}`] });
      }
      hooks.opEnd(null, `out:${fmt}`, Date.now() - t1);
    }
    // sestava: úplnost výrobní dokumentace i bez výkresového výstupu (vlna 22, bod 19 – vyráběné bez výkresu / čísla)
    if (formatsFor(it.doc, p.formats).length)
      for (const n of asmDocNotes(it.doc, (x) => ws.findPart(x))) {
        // bez výkresového výstupu jen ℹ (přísný běh kvůli tomu nezastaví); výkres / kusovník ji hlásí jako ⚠ (writeDocFormat)
        const e = codeEntry(n.code, { doc: it.doc.name, ...(n.args ? { args: n.args } : {}), level: "note" });
        if (!rb.entries.some((x) => x.code === e.code && x.doc === e.doc && x.text === e.text)) rb.add(e);
      }
  }
  if (strictStop(rb, rb.entries.slice(beforeOut), strict)) {
    staging?.discard();
    return { docs };
  }
  let share: ShareInfo | undefined;
  if (p.share && mainItem && docHasContent(mainItem.doc)) {
    const t1 = Date.now();
    const beforeShare = rb.entries.length;
    hooks.opStart(null, "share");
    try {
      // krátký odkaz přes úložiště; odmítnutí → ✗ share.rejected + ⚠ share.fallback-link s dlouhým odkazem (kap. 3.4)
      const doc = mainItem.doc.name;
      const res = await shareWithPolicy(mainItem.doc, { days: p.share.days, view: p.share.view, want: "auto" }, (n) => rb.code(n.code, { doc, ...(n.args ? { args: n.args } : {}), ...(n.text ? { text: n.text } : {}) }));
      if (res) {
        // obsah odkazu a výpis `= L- link …` jako u textového `sdílet` (vlna 22, bod 16)
        const content = shareContent(mainItem.doc);
        share = { ...shareInfo({ ...res, ...(res.note ? { note: res.note } : {}) }), line: null, view: p.share.view, password: res.password, content };
        rb.measure(null, "link", shareLinkKv(share, content), { doc, data: share });
      }
    } catch (e) {
      rb.code("share.rejected", { doc: mainItem.doc.name, args: [errText(e)] });
    }
    hooks.opEnd(null, "share", Date.now() - t1);
    if (strictStop(rb, rb.entries.slice(beforeShare), strict)) {
      staging?.discard();
      return { docs };
    }
  }
  if (staging?.size) {
    const t1 = Date.now();
    hooks.opStart(null, "out:write");
    await staging.flush((e, f) => {
      if (e instanceof OutPathError) rb.code("out.path", { doc: f.doc, args: [e.fileName] });
      else rb.code("op.failed", { doc: f.doc, args: [`${f.format}: ${errText(e)}`] });
    });
    hooks.opEnd(null, "out:write", Date.now() - t1);
  }
  return { docs, ...(share ? { share } : {}) };
}

/* ───────────────────────── písma a sdílení od hostitele ───────────────────────── */

/**
 * Písma ze složky vedle svazku a sdílení (stránka odkazu, vlastní úložiště) jako zdroje hostitele enginu
 * (`setHostAssets`): `pdf.ts`, písmo textu modelu a `share.ts` je berou odsud, ne přes shim `fetch` / `location`.
 * Stránka a úložiště se spočtou stejně jako dřív ze shimu (`--share-store`, `MNCAD_ORIGIN`); shim zůstává jako záloha.
 */
export function installHostAssets(shims: InstalledShims): void {
  const loc = (globalThis as { location?: { origin: string; pathname: string } }).location;
  const page = loc ? loc.origin + loc.pathname.replace(/\/$/, "") : null;
  const store = selfStoreBase();
  const fontCache = new Map<string, Promise<ArrayBuffer>>();
  setHostAssets({
    font: (name) => {
      let p = fontCache.get(name);
      if (!p) {
        p = (async () => {
          if (!/^[\w.-]+$/.test(name) || name.startsWith(".")) throw new Error(tr("písmo „{0}“ není ve složce písem", name));
          const file = shims.fontsDir ? path.join(shims.fontsDir, name) : null;
          if (!file || !fs.existsSync(file)) throw new Error(tr("písmo „{0}“ není ve složce písem", name));
          shims.fontsRead.push(name);
          const b = fs.readFileSync(file);
          return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
        })();
        p.catch(() => fontCache.delete(name));
        fontCache.set(name, p);
      }
      return p;
    },
    ...(page ? { share: { page, store, ...(shims.linkPage ? { linkPage: shims.linkPage } : {}) } } : {}),
  });
}

/** písma pro `EngineHost` (fonts / textFont) ze zdrojů hostitele */
function hostFonts(): Pick<EngineHost, "fonts" | "textFont"> {
  const font = hostAssets().font;
  if (!font) return {};
  return {
    fonts: async (): Promise<PdfFonts> => ({ regular: await font("Roboto-Regular.ttf"), bold: await font("Roboto-Bold.ttf").catch(() => undefined) }),
    textFont: () => font("Roboto-Bold.ttf"),
  };
}

/* ───────────────────────── vlákno ───────────────────────── */

type JobState = { kernel: KernelClient; transport: InProcessTransport; shims: InstalledShims; ws: MemoryWorkspace | null; init: JobInit };

function post(m: FromJob, transfer?: ArrayBuffer[]) {
  parentPort!.postMessage(m, transfer);
}

/** zkušební závada (jen `MNCAD_TEST_FAULT`): ověření hlídače bez skutečného pádu jádra */
function applyFault(st: JobState, when: "op" | "ready") {
  const f = st.init.fault;
  if (!f) return;
  if (when === "op" && f === "throw")
    queueMicrotask(() => {
      throw new Error("MNCAD_TEST_FAULT=throw");
    });
  if (when === "op" && f === "exit") process.exit(7);
  if (when === "op" && f === "fatal") st.transport.inject({ fatal: true, error: "Aborted(MNCAD_TEST_FAULT)" });
  const grow = /^grow:(\d+)$/.exec(f);
  if (when === "op" && grow) {
    // jedno dlouhé volání, během kterého roste paměť WebAssembly (jako stavba v OCCT) – hlídač ji vidí přes háček grow
    const m = new WebAssembly.Memory({ initial: 1 });
    const until = Date.now() + 30_000;
    while (m.buffer.byteLength < Number(grow[1]) * 1048576 && Date.now() < until) m.grow(160);
    while (Date.now() < until) {
      /* dál synchronní práce */
    }
  }
  const busy = /^busy:(\d+)$/.exec(f);
  if (when === "op" && busy) {
    const until = Date.now() + Number(busy[1]);
    while (Date.now() < until) {
      /* synchronní práce jako jedno dlouhé volání OCCT */
    }
  }
}

async function handleRun(st: JobState, id: number, req: JobRequest): Promise<void> {
  setLang(req.lang);
  if (req.resume) {
    try {
      st.ws = loadWorkspace(req.resume);
    } catch (e) {
      post({ t: "failed", id, error: tr("relaci nelze načíst: {0}", errText(e)) });
      return;
    }
  }
  const ws = (st.ws ??= new MemoryWorkspace());
  let sink: FileSink & { written?: OutFile[] };
  let mem: MemoryFiles | null = null;
  try {
    if (req.out.kind === "dir") sink = CliFileSink.create(req.out.dir);
    else sink = mem = memoryFileSink();
  } catch (e) {
    post({ t: "failed", id, error: tr("výstupní složku „{0}“ nelze použít: {1}", req.out.kind === "dir" ? req.out.dir : "-", errText(e)) });
    return;
  }
  const writtenList = () => (mem ? [...mem.files.values()].map((x) => x.file) : ((sink as CliFileSink).written ?? []));
  const inputs = req.inputs.kind === "dirs" ? new CliFileSource(req.inputs.roots, req.inputs.explicit) : memoryFileSource(req.inputs.files);
  // fáze výstupů (export: přestavba / převod / kontrola / zápis – engine/export-job.ts) → průběh hlídače (`--progress`)
  const host: EngineHost = { kernel: st.kernel, files: sink, inputs, ...hostFonts(), now: () => Date.now(), phase: (op, phase) => post({ t: "progress", id, op, phase }) };
  const rb = new ReportBuilder({ lang: req.lang, lines: scriptLines(req.script), strict: !!req.strict });
  // identita běhu (vlna 22, bod 12): id + revize vstupu (klíč dokumentu a revize modelu před během – relace / --resume)
  const run: RunStamp = { id: req.runId ?? "r1", inputRev: inputRevOf(ws.docKey(), ws.present()) };
  rb.run = run;
  post({ t: "run", id, run });
  if (req.resume) rb.code("session.history");
  let sentEntries = 0;
  let sentFiles = 0;
  const hooks: RunHooks = {
    opStart(line, op) {
      post({ t: "op-start", id, line, op });
      applyFault(st, "op");
    },
    opEnd(line, op, ms) {
      const files = writtenList();
      const mem = memorySample();
      publishWasmHeap(st.init.memSab, mem.heapMB);
      post({ t: "op-end", id, line, op, ms, entries: rb.entries.slice(sentEntries) as Entry[], files: files.slice(sentFiles), mem });
      sentEntries = rb.entries.length;
      sentFiles = files.length;
    },
  };
  // průběh po prvcích z jádra (ne „start“ – ten klient hlásí sám u každé dlouhé operace)
  const stopProgress = st.kernel.onProgress((p) => {
    // fáze sítě se jmenuje (dřív „build 3/2“ – index za posledním prvkem)
    if (p && p.phase !== "start") post({ t: "progress", id, op: p.op, index: p.index, total: p.total, name: p.name, ...(p.phase === "mesh" ? { phase: "mesh" } : {}) });
  });
  // listy výkresů spočítané v běhu (`výkres export pdf dokument`) převezme `--formats pdf` téhož dokumentu (jen v tomto běhu)
  const closeSheets = sheetCacheScope();
  try {
    await engineRun(ws, req.script, host, rb, { strict: req.strict, open: req.open, allowEmpty: req.allowEmpty || !!req.resume }, hooks);
    const fin = await finishRun(ws, host, rb, { formats: req.formats, allDocs: req.allDocs, doc: req.doc, noOutputOnError: req.noOutputOnError, share: req.share, strict: req.strict }, hooks);
    if (sink instanceof CliFileSink) for (const rn of sink.renamed) rb.code("out.renamed", { args: [rn.from, rn.to] });
    // pojistka přísného režimu: ⚠/✗ v přísném úseku z jakékoli cesty, kterou smyčka nezastavila, je STOP (hlavička, JSON
    // `stopped`, kód 2) – podle stavu na řádku záznamu jako smyčka enginu (úseky za `přísně vyp` / před `přísně` nevadí)
    strictStop(rb, rb.entries, req.strict);
    const files = writtenList();
    if (rb.count("error") > 0) for (const f of files) f.run = "fail";
    const m = memorySample();
    rb.memory(Math.max(m.rssMB, m.heapMB));
    rb.run = { ...run, state: "done" };
    const report = rb.finish({ docs: fin.docs, files, ...(fin.share ? { share: fin.share } : {}) });
    const done: DoneFile[] = mem ? [...mem.files.values()].map((x) => ({ file: x.file, data: x.data, mime: x.mime })) : files.map((file) => ({ file }));
    const session = req.saveSession ? ws.save() : undefined;
    post({ t: "done", id, report, files: done, ...(session ? { session } : {}), mem: m });
  } finally {
    closeSheets();
    stopProgress();
  }
}

/* ───────────────────────── selftest ───────────────────────── */

export type SelftestCheck = { name: string; ok: boolean; ms: number; detail: string };
export type SelftestResult = { ok: boolean; checks: SelftestCheck[]; examples: number; entries: number; mem: Mem };

/** příklady k smoke testu: každý `cmd` z `AGENT_COMMANDS` (varianty oddělené „ · “) a každý blok kódu z `AGENT_GUIDE` */
export function agentExamples(): { src: string; text: string }[] {
  const out: { src: string; text: string }[] = [];
  AGENT_COMMANDS.forEach((c, i) => {
    for (const part of c.cmd.split(" · ")) if (part.trim()) out.push({ src: `AGENT_COMMANDS[${i}]`, text: part.trim() });
  });
  const re = /```[^\n]*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(AGENT_GUIDE))) {
    n++;
    if (m[1].trim()) out.push({ src: `AGENT_GUIDE block ${n}`, text: m[1] });
  }
  return out;
}

/** známky chyby prostředí (chybějící prohlížečové API) místo řádné hlášky s kódem */
export const ENV_ERROR = /ReferenceError|TypeError|is not defined|is not a function|Cannot read propert|undefined \(reading/;

async function selftest(st: JobState): Promise<SelftestResult> {
  const checks: SelftestCheck[] = [];
  const check = async (name: string, fn: () => Promise<string>) => {
    const t0 = Date.now();
    try {
      checks.push({ name, ok: true, ms: Date.now() - t0, detail: await fn() });
    } catch (e) {
      checks.push({ name, ok: false, ms: Date.now() - t0, detail: errText(e) });
    }
    checks[checks.length - 1].ms = Date.now() - t0;
  };
  const g = globalThis as Record<string, unknown>;
  await check("globals", async () => {
    const bad = ["Worker", "document", "window"].filter((k) => typeof g[k] !== "undefined");
    if (bad.length) throw new Error(`defined: ${bad.join(", ")}`);
    return `Worker/document/window undefined, location.origin=${(g.location as { origin: string }).origin}`;
  });
  const parsed = parseAgentText("kvádr 40 30 20");
  const op = parsed.ops[0] as Extract<AgentOp, { k: "feature" }> | undefined;
  const box = op?.k === "feature" ? ({ ...op.feature, mode: "new" } as Feature) : null;
  const doc: CadDoc = { ...emptyDoc("selftest"), features: box ? [box] : [] };
  await check("kernel.build", async () => {
    const res = await st.kernel.build(doc);
    const v = res.metrics?.volume ?? NaN;
    if (Math.abs(v - 24000) > 1e-3) throw new Error(`volume ${v} != 24000`);
    return `V=${v.toFixed(3)}mm3 faces=${res.metrics?.faces}`;
  });
  await check("export.step", async () => {
    const buf = new Uint8Array(await st.kernel.exportFile(doc, "step"));
    const head = new TextDecoder().decode(buf.slice(0, 13));
    if (head !== "ISO-10303-21;") throw new Error(`head ${JSON.stringify(head)}`);
    return `${buf.length}B`;
  });
  await check("drawing.pdf+fonts", async () => {
    const res = await exportDrawing(doc, "pdf", {}, st.kernel.drawing as unknown as DrawingCompute);
    const data = b64(res.base64);
    if (new TextDecoder().decode(data.slice(0, 5)) !== "%PDF-") throw new Error("not a PDF");
    if (!st.shims.fontsRead.some((f) => /Roboto-Regular/.test(f))) throw new Error(tr("písma se nečetla od hostitele"));
    return `${data.length}B fonts=${[...new Set(st.shims.fontsRead)].join(",")}`;
  });
  await check("text.font", async () => {
    const t = parseAgentText('nápis "MN" 8 1 v 5 5 20').ops[0] as Extract<AgentOp, { k: "feature" }> | undefined;
    if (!t || t.k !== "feature") throw new Error("parse");
    const res = await st.kernel.build({ ...doc, features: [...doc.features, { ...t.feature, mode: "add" } as Feature] });
    const bad = res.status.find((s) => !s.ok);
    if (bad) throw new Error(bad.error);
    return `V=${res.metrics?.volume.toFixed(1)}mm3`;
  });
  await check("share.link", async () => {
    const { createShareLink } = await import("../share");
    const res = await createShareLink(doc, { days: 10, mode: "link" });
    if (!/#s=/.test(res.url) || !res.url.startsWith((g.location as { origin: string }).origin)) throw new Error(res.url.slice(0, 80));
    return `mode=${res.mode} ${res.url.length} chars`;
  });
  // smoke test příkladů: každý ve vlastním prostoru, bez Worker/document/window – jen řádné hlášky s kódem
  const examples = agentExamples();
  let entries = 0;
  await check("examples", async () => {
    const bad: string[] = [];
    for (const ex of examples) {
      const ws = new MemoryWorkspace();
      // sdílení bez úložiště (store: null): příklad `sdílet` z nápovědy nesmí nahrávat do úložiště webu – jen dlouhý odkaz s ⚠
      const share = { base: hostAssets().share?.page ?? "https://www.mnastrojarna.cz/cad", store: null };
      const host: EngineHost = { kernel: st.kernel, files: memoryFileSink(), inputs: memoryFileSource({}), ...hostFonts(), share, now: () => Date.now() };
      const rb = new ReportBuilder({ lang: "cs", lines: ex.text.split("\n").length });
      const noop: RunHooks = { opStart: () => undefined, opEnd: () => undefined };
      try {
        await engineRun(ws, ex.text, host, rb, { strict: false, open: [] }, noop);
      } catch (e) {
        bad.push(`${ex.src}: uncaught ${errText(e)}`);
        continue;
      }
      for (const e of rb.entries) {
        entries++;
        if ((e.level === "error" || e.level === "warn" || e.level === "note") && !(e.code && CODE_RE.test(e.code))) bad.push(`${ex.src}: ${e.level} without code: ${e.text}`);
        if (e.level === "error" && ENV_ERROR.test(e.text)) bad.push(`${ex.src}: ${e.code} ${e.text}`);
      }
    }
    if (bad.length) throw new Error(`${bad.length} ✗: ${bad.slice(0, 5).join(" | ")}`);
    return `${examples.length} examples, ${entries} entries, all coded`;
  });
  return { ok: checks.every((c) => c.ok), checks, examples: examples.length, entries, mem: memorySample() };
}

/** `locateFile` emscriptenu: WASM jádra z cesty hostitele (`JobInit.wasm`), ostatní soubory beze změny */
export const wasmLocator =
  (wasm: string) =>
  (file: string, prefix: string): string =>
    file.endsWith(".wasm") ? wasm : prefix + file;

/** jádro se nenačetlo – bez WASM od hostitele s nápovědou, kam soubor patří (před původní chybou: řádek protokolu se zkracuje) */
export function loadError(raw: string, wasm: string | undefined): string {
  return wasm ? tr("jádro CAD se nenačetlo: {0}", raw) : tr("jádro CAD se nenačetlo (replicad_single.wasm patří vedle mncad.mjs, jinou cestu zadejte v MNCAD_WASM): {0}", raw);
}

/** vstup vlákna běhu (volá ho `main.ts`, když běží ve `worker_threads` s `workerData.mncad === JOB_TAG`) */
export async function jobMain(): Promise<void> {
  if (isMainThread || !parentPort) throw new Error("jobMain: not in a worker thread");
  const init = workerData as JobInit;
  setLang(init.lang);
  const t0 = Date.now();
  const shims = installNodeShims({ origin: init.origin, fontsDir: init.fontsDir, version: init.version, shareStore: init.shareStore });
  installHostAssets(shims);
  installWasmGrowHook(init.memSab);
  const transport = inProcessTransport({ ...(init.wasm ? { locateFile: wasmLocator(init.wasm) } : {}), restart: false });
  const kernel = makeKernelClient(transport);
  const st: JobState = { kernel, transport, shims, ws: null, init };
  let loading = true;
  // pád WASM: hlídač ukončí vlákno (kód 4, ✗ run.crash s původní chybou); nové jádro ve vlákně se nespouští (`restart: false`
  // – požadavky do ukončení vlákna hned skončí chybou pádu)
  kernel.onRestart((_reason, raw) => post({ t: "fatal", error: loading ? loadError(raw, init.wasm) : raw }));
  try {
    await kernel.init();
  } catch (e) {
    post({ t: "fatal", error: loadError(errText(e), init.wasm) });
    return;
  }
  loading = false;
  if (init.lang !== "cs") await kernel.setLang(init.lang);
  const mem0 = memorySample();
  publishWasmHeap(init.memSab, mem0.heapMB);
  post({ t: "ready", ms: Date.now() - t0, mem: mem0 });
  let chain: Promise<void> = Promise.resolve();
  parentPort.on("message", (m: ToJob) => {
    if (m.t === "close") {
      parentPort!.close();
      return;
    }
    chain = chain.then(async () => {
      try {
        if (m.t === "run") await handleRun(st, m.id, m.req);
        else if (m.t === "selftest") post({ t: "selftest", id: m.id, result: await selftest(st) });
      } catch (e) {
        post({ t: "failed", id: m.id, error: errText(e) });
      }
    });
  });
}

