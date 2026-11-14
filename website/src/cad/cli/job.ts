/**
 * Vlákno běhu `mncad` (CAD-HEADLESS-NAVRH.md kap. 2.2, 3.1): parser, engine i jádro běží tady, ve `worker_threads`.
 * Hlavní vlákno je jen hlídač (`watchdog.ts`) – časový limit, paměť, Ctrl+C a pád řeší `terminate()` zvenku, protože
 * volání OCCT jsou synchronní a ve vlákně běhu by žádný časovač nedoběhl.
 *
 * Vlákno po každé operaci posílá průběžný stav (řádek, nové záznamy, nové soubory, paměť WASM + RSS), aby hlídač po
 * `terminate()` složil protokol z posledního známého stavu a doplnil ✗ `run.timeout` / `run.memory` na řádek rozpracované
 * operace. Jazyk (`setLang`) je modulový stav, tedy na vlákno – souběžné úlohy `mncad serve` s různým jazykem se nemíchají.
 *
 * Jádro je ve fázi A nezměněný `cad.worker.ts` přes smyčku (`node-shims.ts`); od balíku B1 in-process `handleKernel`.
 * Smyčka běhu skriptu je ve fázi A `interimRun`: rozbor (`parseAgentText`), operace z registru enginu (`runEngineOp`);
 * operace, které registr ještě nemá (dnes všechny – obsluhy přesune balík B2 z `cad-app.tsx`), dají ✗ `host.app-only`.
 * B2 nahradí `interimRun` voláním `runScript` (stejný podpis `JobRunner`), B3 výstupy `writeOutputs` souborem `engine/files.ts`.
 */
import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { parseAgentText, AGENT_COMMANDS, type AgentOp } from "../agent";
import { AGENT_GUIDE } from "../agent-guide";
import { embedBlobs } from "../blobs";
import { docHasContent } from "../draft/doc";
import { exportDrawing, type DrawingExportFormat } from "../drawing-export";
import type { DrawingCompute } from "../drawing-agent";
import { setLang, tr, type CadLang } from "../i18n";
import { MATERIALS } from "@/lib/mesh-metrics";
import { emptyDoc, type CadDoc, type ExportFormat, type Feature } from "../types";
import { sourceKey } from "../assembly";
import { CODE_RE } from "../engine/codes";
import { memoryFileSink, memoryFileSource, MissingInputError, OutPathError, safeFileName, type EngineHost, type FileSink, type MemoryFiles, type OutWrite } from "../engine/host";
import { MemoryWorkspace, loadWorkspace } from "../engine/memory-workspace";
import { runEngineOp, type OpCtx, type RunState } from "../engine/ops/registry";
import { ReportBuilder } from "../engine/protocol";
import type { DocSummary, Entry, OutFile, RunReport, ShareInfo } from "../engine/protocol-types";
import type { Workspace } from "../engine/workspace";
import type { Formats, OutFormat, ShareView, StrictOpt } from "./args";
import { CliFileSink, CliFileSource } from "./file-sink";
import { scriptLines, strictStopper } from "./watchdog";
import { installLoopbackSelf, installNodeShims, installWasmGrowHook, makeLoopbackKernel, memorySample, publishWasmHeap, type InstalledShims, type LoopbackKernel, type LoopbackPort } from "./node-shims";

export { strictStopper };

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
};

export type ToJob = { t: "run"; id: number; req: JobRequest } | { t: "selftest"; id: number } | { t: "close" };

export type DoneFile = { file: OutFile; data?: Uint8Array; mime?: string };
export type FromJob =
  | { t: "ready"; ms: number; mem: Mem }
  | { t: "op-start"; id: number; line: number | null; op: string }
  | { t: "op-end"; id: number; line: number | null; op: string; ms: number; entries: Entry[]; files: OutFile[]; mem: Mem }
  | { t: "progress"; id: number; op: string; index?: number; total?: number; name?: string }
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
/** podpis smyčky běhu: fáze A `interimRun`, od B2 `runScript` (engine/run.ts) se stejnými porty */
export type JobRunner = (ws: Workspace, text: string, host: EngineHost, rb: ReportBuilder, o: JobRunOptions, hooks: RunHooks) => Promise<void>;

/** popis operace pro hlášky (`feature:box`, `asm:mate`, `drawingCmd:sheet`) */
export function opLabel(op: AgentOp): string {
  const o = op as { k: string; feature?: Feature; cmd?: { k?: string; kind?: string } };
  const sub = op.k === "feature" ? o.feature?.type : (o.cmd?.k ?? o.cmd?.kind);
  return sub ? `${op.k}:${sub}` : op.k;
}

/** přísný režim: první ⚠/✗ mezi záznamy `entries` zastaví běh (STOP); vrací true, když se běh zastavil */
function strictStop(rb: ReportBuilder, entries: readonly Entry[], strict: StrictOpt, line: number | null = null): boolean {
  if (rb.stopped) return true;
  const s = strictStopper(entries, strict);
  if (!s) return false;
  rb.stop(s.line ?? line, s.code ?? "msg.error");
  return true;
}

const isDocJson = (v: unknown): v is CadDoc => !!v && typeof v === "object" && typeof (v as CadDoc).name === "string" && Array.isArray((v as CadDoc).features);

/** chybová hláška výjimky pro protokol */
export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Smyčka fáze A: otevře `--open` dokumenty (.mncad/.json přes FileSource), rozebere skript a operace pošle do registru
 * enginu. Operace bez obsluhy = ✗ `host.app-only` (příkaz zatím funguje jen v aplikaci v prohlížeči – B2 přesune
 * obsluhy do `engine/ops/*`). Žádná obsluha se zde nekopíruje.
 */
export const interimRun: JobRunner = async (ws, text, host, rb, o, hooks) => {
  for (const name of o.open) {
    hooks.opStart(null, "open");
    const t0 = Date.now();
    const before = rb.entries.length;
    try {
      const f = await host.inputs.read(name);
      if (!/\.(mncad|json)$/i.test(f.name)) rb.code("host.app-only", { args: [tr("otevřít „{0}“ (zatím jen .mncad)", name)] });
      else {
        let doc: unknown;
        try {
          doc = JSON.parse(new TextDecoder().decode(f.data));
        } catch (e) {
          throw new Error(tr("„{0}“ není platný JSON dokumentu: {1}", name, errText(e)));
        }
        if (!isDocJson(doc)) throw new Error(tr("„{0}“ není dokument MN CAD (chybí název nebo prvky)", name));
        await ws.openInTab(doc);
        rb.ok(null, tr("otevřeno „{0}“", f.name), doc.name);
      }
    } catch (e) {
      if (e instanceof MissingInputError) rb.code("file.missing", { text: e.message });
      else rb.code("op.failed", { args: [errText(e)] });
    }
    hooks.opEnd(null, "open", Date.now() - t0);
    // přísný režim: chybějící / neplatný `--open` zastaví běh dřív, než se provede skript (kap. 5.3)
    if (strictStop(rb, rb.entries.slice(before), o.strict)) return;
  }
  ws.beginRun?.();
  if (!text.trim()) {
    if (!o.open.length && !o.allowEmpty) rb.code("parse.error", { args: [tr("Prázdný vstup.")] });
    return;
  }
  const prog = parseAgentText(text);
  for (const e of prog.errors) rb.code("parse.error", { line: e.line > 0 ? e.line : null, args: [e.text ? `${e.message} ← „${e.text.slice(0, 80)}“` : e.message] });
  if (o.strict && prog.errors.length) {
    const first = strictStopper(rb.entries, o.strict);
    if (first) {
      rb.stop(first.line, first.code ?? "parse.error");
      return;
    }
  }
  const run: RunState = { doc: ws.present(), changed: false, openNew: false };
  const ctx: OpCtx = { ws, host, opts: { strict: o.strict }, report: rb, run, line: 0 };
  for (const op of prog.ops) {
    const label = opLabel(op);
    const before = rb.entries.length;
    hooks.opStart(op.line, label);
    const t0 = Date.now();
    try {
      if (!(await runEngineOp(op, ctx))) {
        rb.code("host.app-only", { line: op.line, args: [label] });
        rb.op(op.line, label, Date.now() - t0);
      }
    } catch (e) {
      if (e instanceof OutPathError) rb.code("out.path", { line: op.line, args: [e.fileName] });
      else if (e instanceof MissingInputError) rb.code("file.missing", { line: op.line, text: e.message });
      else rb.code("op.failed", { line: op.line, args: [errText(e)] });
    }
    hooks.opEnd(op.line, label, Date.now() - t0);
    if (strictStop(rb, rb.entries.slice(before), o.strict, op.line)) return;
  }
};

/* ───────────────────────── dokumenty, výstupy, sdílení ───────────────────────── */

type DocItem = { id: string; doc: CadDoc };
const docKind = (d: CadDoc): DocSummary["kind"] => (d.kind === "assembly" ? "assembly" : d.kind === "draft" ? "draft" : "part");

/** dokumenty všech záložek (aktivní záložka se obnoví) */
export async function workspaceDocs(ws: Workspace): Promise<{ items: DocItem[]; activeId: string | null }> {
  const tabs = ws.tabs();
  const activeId = tabs.find((t) => t.active)?.id ?? null;
  const items: DocItem[] = [];
  for (const t of tabs) items.push({ id: t.id, doc: await ws.activate(t.id) });
  if (activeId) await ws.activate(activeId);
  return { items, activeId };
}

/** hlavní dokument (kap. 3.1): `--doc`, jinak poslední sestava, jinak aktivní dokument */
export function pickMain(items: DocItem[], activeId: string | null, name?: string): DocItem | null | "missing" {
  if (name) {
    const f = name.trim().toLowerCase();
    return items.find((x) => x.doc.name.trim().toLowerCase() === f) ?? "missing";
  }
  return [...items].reverse().find((x) => x.doc.kind === "assembly" && docHasContent(x.doc)) ?? items.find((x) => x.id === activeId) ?? items[items.length - 1] ?? null;
}

/** formáty k zápisu pro dokument (`auto` = STEP dílu/sestavy + .mncad + PDF listů, je-li výkres; rozhodnutí 15.7) */
export function formatsFor(d: CadDoc, f: Formats): OutFormat[] {
  if (f === "none") return [];
  if (f !== "auto") return f;
  if (d.kind === "draft") return ["mncad"];
  return ["step", "mncad", ...(d.drawings?.length ? (["pdf"] as const) : [])];
}

const MIME: Record<OutFormat, string> = {
  step: "model/step",
  stl: "model/stl",
  mncad: "application/json",
  pdf: "application/pdf",
  dxf: "application/dxf",
  dwg: "application/acad",
  svg: "image/svg+xml",
  csv: "text/csv;charset=utf-8",
};
const DRAWING_FMT = new Set<OutFormat>(["pdf", "dxf", "dwg", "svg"]);
const b64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

type BuildOutcome = { summary: DocSummary; built: boolean };

/** Závěrečná stavba a souhrn dokumentu (řádek D). Díl se postaví v jádře; sestava a 2D výkres se jen spočítají (B2: asm-status). */
export async function summarize(d: CadDoc, kernel: EngineHost["kernel"], rb: ReportBuilder, build: boolean): Promise<BuildOutcome> {
  const s: DocSummary = { ref: d.name, name: d.name, kind: docKind(d) };
  if (d.drawings?.length) s.sheets = d.drawings.length;
  if (s.kind === "assembly") {
    s.components = d.components?.length ?? 0;
    s.parts = new Set((d.components ?? []).map((c) => sourceKey(c.source))).size;
    return { summary: s, built: true };
  }
  if (s.kind === "draft" || !build) return { summary: s, built: s.kind === "draft" };
  if (!d.features.length) {
    s.features = { ok: 0, warn: 0, error: 0 };
    return { summary: s, built: false };
  }
  try {
    const res = await kernel.build(d);
    const names = new Map(d.features.map((f) => [f.id, f.name]));
    let ok = 0;
    let warn = 0;
    let error = 0;
    for (const st of res.status) {
      if (!st.ok) {
        error++;
        rb.code("feature.failed", { doc: d.name, args: [names.get(st.id) ?? st.id, st.error ?? ""] });
      } else if (st.warning) {
        warn++;
        rb.code("feature.warning", { doc: d.name, args: [names.get(st.id) ?? st.id, st.warning] });
      } else ok++;
    }
    for (const pe of res.paramErrors ?? []) rb.code("build.failed", { doc: d.name, args: [pe] });
    s.features = { ok, warn, error };
    if (res.metrics) {
      s.volume_mm3 = res.metrics.volume;
      s.bbox = res.metrics.bbox;
      const mt = MATERIALS.find((m) => m.id === d.material);
      if (mt) {
        s.density = mt.density;
        s.mass_kg = (res.metrics.volume / 1e6) * mt.density;
      }
    }
    const built = !!res.metrics && error === 0 && !(res.paramErrors?.length);
    if (!built && !error) rb.code("build.failed", { doc: d.name, args: [tr("model nemá těleso")] });
    return { summary: s, built };
  } catch (e) {
    rb.code("build.failed", { doc: d.name, args: [errText(e)] });
    return { summary: s, built: false };
  }
}

/** jeden soubor dokumentu v daném formátu (fáze A; B3 přesune do engine/files.ts včetně vícestránkového PDF a ověření STEP) */
async function produce(d: CadDoc, fmt: OutFormat, host: EngineHost, rb: ReportBuilder): Promise<OutFile[]> {
  const base = d.name.trim() || "model";
  if (fmt === "mncad") {
    const data = new TextEncoder().encode(JSON.stringify(embedBlobs(d)));
    return [await host.files.write({ name: `${base}.mncad`, mime: MIME.mncad, data, doc: d.name, format: "mncad" })];
  }
  if (fmt === "step" || fmt === "stl") {
    if (d.kind === "draft") throw new Error(tr("2D výkres nemá 3D model pro {0}", fmt.toUpperCase()));
    const buf = await host.kernel.exportFile(d, fmt as ExportFormat);
    return [await host.files.write({ name: `${base}.${fmt}`, mime: MIME[fmt], data: new Uint8Array(buf), doc: d.name, format: fmt })];
  }
  if (DRAWING_FMT.has(fmt)) {
    if (d.kind === "draft") {
      rb.code("host.app-only", { doc: d.name, args: [tr("export 2D výkresu do {0}", fmt.toUpperCase())] });
      return [];
    }
    const sheets = d.drawings?.length ? d.drawings.map((_, i) => i + 1) : [1];
    const compute = host.kernel.drawing as unknown as DrawingCompute;
    const out: OutFile[] = [];
    for (const n of sheets) {
      const res = await exportDrawing(d, fmt as DrawingExportFormat, { sheet: n }, compute);
      for (const w of res.warnings ?? []) rb.code("drawing.warning", { doc: d.name, args: [n, w] });
      const name = sheets.length > 1 ? tr("{0} výkres {1}", base, n) : tr("{0} výkres", base);
      const f = await host.files.write({ name: `${name}.${fmt}`, mime: res.mime, data: b64(res.base64), doc: d.name, format: fmt });
      f.sheets = 1;
      out.push(f);
    }
    return out;
  }
  rb.code("host.app-only", { doc: d.name, args: [tr("export {0}", fmt.toUpperCase())] });
  return [];
}

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
  const strict = p.strict ?? false;
  const { items, activeId } = await workspaceDocs(ws);
  const main = pickMain(items, activeId, p.doc);
  const beforeBuild = rb.entries.length;
  if (main === "missing") rb.code("op.failed", { args: [tr("dokument „{0}“ (--doc) není otevřený – otevřené: {1}", p.doc, items.map((x) => x.doc.name).join(", ") || "—")] });
  const mainItem = main === "missing" ? null : main;
  const wanted = p.allDocs ? items : mainItem ? [mainItem] : [];
  const targets = wanted.filter((x) => docHasContent(x.doc));
  const targetIds = new Set(targets.map((x) => x.id));
  const docs: DocSummary[] = [];
  const built = new Map<string, boolean>();
  hooks.opStart(null, "build");
  const t0 = Date.now();
  for (const it of items) {
    if (!docHasContent(it.doc) && it.id !== mainItem?.id) continue; // prázdný úvodní díl relace se nehlásí
    const o = await summarize(it.doc, host.kernel, rb, targetIds.has(it.id));
    if (it.id === mainItem?.id) o.summary.main = true;
    built.set(it.id, o.built);
    docs.push(o.summary);
  }
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
  if (strictStop(rb, rb.entries.slice(beforeBuild), strict)) return { docs };
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
        await produce(it.doc, fmt, outHost, rb);
      } catch (e) {
        if (e instanceof OutPathError) rb.code("out.path", { doc: it.doc.name, args: [e.fileName] });
        else rb.code("op.failed", { doc: it.doc.name, args: [`${fmt}: ${errText(e)}`] });
      }
      hooks.opEnd(null, `out:${fmt}`, Date.now() - t1);
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
      const { createShareLink } = await import("../share");
      const res = await createShareLink(mainItem.doc, { days: p.share.days, view: p.share.view });
      share = { url: res.url, mode: res.mode, bytes: res.bytes, exp: res.exp ? new Date(res.exp).toISOString().slice(0, 10) : null, ...(res.note ? { note: res.note } : {}) };
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

/* ───────────────────────── vlákno ───────────────────────── */

type JobState = { kernel: LoopbackKernel; port: LoopbackPort; shims: InstalledShims; ws: MemoryWorkspace | null; init: JobInit };

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
  if (when === "op" && f === "fatal") for (const l of st.port.listeners) l({ fatal: true, error: "Aborted(MNCAD_TEST_FAULT)" });
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
  const host: EngineHost = { kernel: st.kernel, files: sink, inputs, now: () => Date.now() };
  const rb = new ReportBuilder({ lang: req.lang, lines: scriptLines(req.script), strict: !!req.strict });
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
  const stopProgress = st.kernel.onKernelProgress((p) => post({ t: "progress", id, op: p.op, index: p.index, total: p.total, name: p.name }));
  try {
    await interimRun(ws, req.script, host, rb, { strict: req.strict, open: req.open, allowEmpty: req.allowEmpty || !!req.resume }, hooks);
    const fin = await finishRun(ws, host, rb, { formats: req.formats, allDocs: req.allDocs, doc: req.doc, noOutputOnError: req.noOutputOnError, share: req.share, strict: req.strict }, hooks);
    if (sink instanceof CliFileSink) for (const rn of sink.renamed) rb.code("out.renamed", { args: [rn.from, rn.to] });
    // pojistka přísného režimu: ⚠/✗ z jakékoli cesty, kterou smyčka nezastavila, je STOP (hlavička, JSON `stopped`, kód 2)
    strictStop(rb, rb.entries, req.strict);
    const files = writtenList();
    if (rb.count("error") > 0) for (const f of files) f.run = "fail";
    const m = memorySample();
    rb.memory(Math.max(m.rssMB, m.heapMB));
    const report = rb.finish({ docs: fin.docs, files, ...(fin.share ? { share: fin.share } : {}) });
    const done: DoneFile[] = mem ? [...mem.files.values()].map((x) => ({ file: x.file, data: x.data, mime: x.mime })) : files.map((file) => ({ file }));
    const session = req.saveSession ? ws.save() : undefined;
    post({ t: "done", id, report, files: done, ...(session ? { session } : {}), mem: m });
  } finally {
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
    if (!st.shims.fontsRead.some((f) => /Roboto-Regular/.test(f))) throw new Error(tr("písma se nečetla přes shim"));
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
      const host: EngineHost = { kernel: st.kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() };
      const rb = new ReportBuilder({ lang: "cs", lines: ex.text.split("\n").length });
      const noop: RunHooks = { opStart: () => undefined, opEnd: () => undefined };
      try {
        await interimRun(ws, ex.text, host, rb, { strict: false, open: [] }, noop);
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

/** vstup vlákna běhu (volá ho `main.ts`, když běží ve `worker_threads` s `workerData.mncad === JOB_TAG`) */
export async function jobMain(): Promise<void> {
  if (isMainThread || !parentPort) throw new Error("jobMain: not in a worker thread");
  const init = workerData as JobInit;
  setLang(init.lang);
  const t0 = Date.now();
  const shims = installNodeShims({ origin: init.origin, fontsDir: init.fontsDir, version: init.version, shareStore: init.shareStore });
  installWasmGrowHook(init.memSab);
  const port = installLoopbackSelf();
  await import("../cad.worker");
  const kernel = makeLoopbackKernel(port);
  const st: JobState = { kernel, port, shims, ws: null, init };
  kernel.onFatal((reason) => post({ t: "fatal", error: reason }));
  try {
    await kernel.init();
  } catch (e) {
    post({ t: "fatal", error: tr("jádro CAD se nenačetlo: {0}", errText(e)) });
    return;
  }
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

