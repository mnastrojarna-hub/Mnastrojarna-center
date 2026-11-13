"use client";
import type { SurfQuery, SurfQueryResult } from "./surf-query";
import { getLang, tr, type CadLang } from "./i18n";
import type { BuildProgress } from "./build";
import type { EdgeLite, FaceLite } from "./agent";
import type { DrawingMeta, DrawingOptions, DrawingResult } from "./drawing";
import type { SmartDims } from "./drawing-dims";
import type { Interference, MateFaceInfo } from "./asm-kernel";
import type { CompareOptions, CompareResult, ReferenceFile } from "./compare";
import type { EntRef, EntityInfo, MeasureResult, ShapeSrc } from "./inspect";
import type { MeasureQuery, MeasureReport } from "./measure";
import type { DatumDisplay } from "./feat/refs-more";
import type { Geo, PlaneDef, Ref, ResolvedPlane, Sig } from "./refs";
import type { BodyInfo, BuildResult, CadDoc, ComponentSource, ExportFormat, FaceInfo, Feature, Vec3 } from "./types";
import { blobIdOf, blobOf, blobRefsIn, putBlobAs } from "./blobs";
import { perfMark, perfPush, type PerfEntry } from "./perf-log";
import { fatalKernelText } from "./kernel-errors";
import type { SplitPart, StepSplit } from "./formats/step-assembly";

let worker: Worker | null = null;
let seq = 0;
/** data importů (otisky), která už má běžící jádro – posílají se jen jednou; nové jádro začíná s prázdnou sadou */
let sent = new Set<string>();
/** pořadí instance jádra (po pádu / zrušení se spouští nové) */
let generation = 0;
const restartListeners = new Set<(reason: string) => void>();
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; op: string; at: number }>();

/**
 * Průběh právě běžícího výpočtu v jádře: operace, počítaný prvek (k z n) a čas od začátku výpočtu / prvku.
 * `phase: "start"` = operace běží, ale průběh po prvcích nehlásí (export, výkres, kolize).
 */
export type CadProgress = Omit<BuildProgress, "phase"> & { phase: BuildProgress["phase"] | "start"; op: string; startedAt: number; featureAt: number };
/** operace, které mohou trvat dlouho – ukazuje se u nich průběh a jdou zrušit */
const LONG_OPS = new Set(["build", "topology", "measure", "export", "drawing", "interference", "asmParts", "compare", "stepSplit"]);
const progressListeners = new Set<(p: CadProgress | null) => void>();
let lastProgress: CadProgress | null = null;
const emitProgress = (p: CadProgress | null) => {
  lastProgress = p;
  for (const l of progressListeners) l(p);
};

/** Výpočet zrušený uživatelem (tlačítko Zrušit) – volající ho nemá hlásit jako chybu jádra. */
export class CadCancelled extends Error {
  constructor() {
    super(tr("Výpočet zrušen."));
    this.name = "CadCancelled";
  }
}
export const isCancelled = (e: unknown): e is CadCancelled => e instanceof CadCancelled;

/** Pád jádra (WASM): ukončit, všechny čekající požadavky odmítnout srozumitelnou chybou, příště spustit nové jádro. */
function crashed(raw: string) {
  const text = fatalKernelText(raw);
  const waiting = [...pending.values()];
  pending.clear();
  worker?.terminate();
  worker = null;
  emitProgress(null);
  perfMark("kernel.crash", 0, { error: raw.slice(0, 160) });
  for (const p of waiting) p.reject(new Error(text));
  for (const l of restartListeners) l(text);
}

function w() {
  if (!worker) {
    worker = new Worker(new URL("./cad.worker.ts", import.meta.url), { type: "module" });
    sent = new Set();
    generation++;
    worker.onmessage = (e: MessageEvent<{ id: number; ok?: boolean; result?: unknown; error?: string; progress?: BuildProgress; perf?: PerfEntry; fatal?: boolean; at?: number }>) => {
      if (e.data.perf) return perfPush(e.data.perf);
      if (e.data.fatal) return crashed(e.data.error || "");
      const p = pending.get(e.data.id);
      if (!p) return;
      if (e.data.at && !e.data.progress) perfMark("ui.fromKernel", Date.now() - e.data.at, { op: p.op });
      if (e.data.progress) {
        emitProgress({ ...e.data.progress, op: p.op, startedAt: p.at, featureAt: Date.now() });
        return;
      }
      pending.delete(e.data.id);
      if (lastProgress) {
        // další čekající dlouhá operace přebírá ukazatel průběhu; jinak se průběh ukončí
        const next = [...pending.values()].find((x) => LONG_OPS.has(x.op));
        emitProgress(next ? { op: next.op, phase: "start", index: -1, total: 0, startedAt: Date.now(), featureAt: Date.now() } : null);
      }
      if (e.data.ok) p.resolve(e.data.result);
      else p.reject(new Error(e.data.error || tr("Chyba CAD jádra.")));
    };
    worker.onerror = (e) => {
      // nezachycená chyba ve workeru: před prvním načtením = jádro se nenačetlo, později = pád (jádro se spustí znovu)
      if (generation > 1 || pending.size > 1 || [...pending.values()].some((p) => p.op !== "init" && p.op !== "lang")) return crashed(e.message || "worker error");
      for (const p of pending.values()) p.reject(new Error(tr("CAD jádro se nepodařilo načíst: ") + (e.message || "")));
      pending.clear();
      emitProgress(null);
      worker?.terminate();
      worker = null;
    };
    // nové jádro (první start nebo po zrušení výpočtu) dostane jazyk rozhraní dřív než první požadavek
    if (getLang() !== "cs") worker.postMessage({ id: ++seq, op: "lang", lang: getLang() });
  }
  return worker;
}

/** začátek načítání dílů sestavy po dávkách – průběh ukazuje celkový čas, ne čas dávky */
let seriesAt = 0;

function call<T>(msg: Record<string, unknown>): Promise<T> {
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    const op = String(msg.op);
    if (op === "asmParts" && !msg.offset) seriesAt = Date.now();
    const at = op === "asmParts" && msg.offset ? seriesAt || Date.now() : Date.now();
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, op, at });
    const wk = w();
    // data importů, která jádro ještě nemá (odkazy mnblob: v dokumentu) – jen poprvé, další stavby posílají jen odkaz
    let blobs: Record<string, Uint8Array> | undefined;
    let bytes = 0;
    for (const ref of blobRefsIn(msg)) {
      const bid = blobIdOf(ref);
      if (sent.has(bid)) continue;
      const b = blobOf(ref);
      if (!b) continue; // chybějící data ohlásí jádro srozumitelnou chybou
      (blobs ??= {})[bid] = b;
      bytes += b.length;
      sent.add(bid);
    }
    const tp = performance.now();
    wk.postMessage(blobs ? { id, ...msg, blobs } : { id, ...msg });
    const dt = performance.now() - tp;
    if (bytes || dt > 20) perfMark("ui.postMessage", dt, { op, mb: +(bytes / 1048576).toFixed(2) });
    if (LONG_OPS.has(op) && !lastProgress) emitProgress({ op, phase: "start", index: -1, total: 0, startedAt: at, featureAt: at });
  });
}

/**
 * Zruší běžící výpočet: jádro počítá synchronně (WASM), takže jediný spolehlivý způsob je worker ukončit. Všechny čekající
 * požadavky skončí chybou `CadCancelled`; další požadavek si jádro spustí znovu (mezipaměť stavby tím zaniká).
 */
function cancel(): boolean {
  if (!worker || !pending.size) return false;
  const waiting = [...pending.values()];
  pending.clear();
  worker.terminate();
  worker = null;
  emitProgress(null);
  for (const p of waiting) p.reject(new CadCancelled());
  return true;
}

export type TopologyResult = { faces: FaceLite[]; edges: EdgeLite[]; bbox: [Vec3, Vec3]; metrics: NonNullable<BuildResult["metrics"]>; /** tělesa dílu (aktivní první) s rozsahy indexů ploch a hran */ bodies?: BodyInfo[] };

export const cad = {
  init: () => call<void>({ op: "init" }),
  /** zruší běžící výpočet (viz `cancel`); vrací false, když nic neběží */
  cancel,
  /** běží v jádře právě nějaký požadavek? */
  busy: () => pending.size > 0,
  /** průběh běžícího výpočtu (null = nic dlouhého neběží) */
  progress: () => lastProgress,
  /** odběr průběhu výpočtu (prvek k z n); `null` = výpočet skončil. Vrací funkci pro odhlášení. */
  onProgress: (fn: (p: CadProgress | null) => void) => {
    progressListeners.add(fn);
    return () => void progressListeners.delete(fn);
  },
  /** jazyk hlášek jádra a textů výkresu (cs / en / de) – nastaví se při startu a při přepnutí jazyka */
  setLang: (lang: CadLang) => call<void>({ op: "lang", lang }),
  build: (doc: CadDoc) => call<BuildResult>({ op: "build", doc }),
  /** sestaví dokument a v jednom kroku vrátí plochy a hrany pro výběr pravidlem (bez závodu s dalšími sestaveními) */
  topology: (doc: CadDoc) => call<TopologyResult | null>({ op: "topology", doc }),
  face: (index: number) => call<FaceInfo | null>({ op: "face", index }),
  /** geometrie + otisk odkazu nad aktuálním tělesem (pro formuláře a náhledy) */
  refInfo: (doc: CadDoc, ref: Ref) => call<{ geo: Geo | null; sig: Sig | null; error?: string }>({ op: "refInfo", doc, ref }),
  /** otisky výběru hran/ploch prvku nad tělesem před ním (`doc` oříznutý před prvek) – viz pick-sigs.ts `stampPicks` */
  pickSigs: (doc: CadDoc, feature: Feature) => call<{ feature: Feature; changed: boolean; warnings: string[] } | null>({ op: "pickSigs", doc, feature }),
  planeDef: (doc: CadDoc, def: PlaneDef) => call<{ plane: ResolvedPlane | null; error?: string }>({ op: "planeDef", doc, def }),
  /** pomocné osy / body / souřadné systémy k vykreslení */
  datumGfx: (doc: CadDoc) => call<{ id: string; gfx: DatumDisplay }[]>({ op: "datumGfx", doc }),
  exportFile: (doc: CadDoc, format: ExportFormat) => call<ArrayBuffer>({ op: "export", doc, format }),
  /** díly sestavy; `offset`/`total` = pořadí dávky v celém načítání (pro průběh „díl k z n“) */
  asmParts: (parts: { key: string; source: ComponentSource }[], offset = 0, total = parts.length) => call<{ key: string; result: BuildResult }[]>({ op: "asmParts", parts, offset, total }),
  /**
   * Sestava STEP → díly (každý svůj STEP). `null` = soubor není sestava. Data dílů zůstávají v jádře a ukládají se i v UI
   * (pro uložení .mncad a nové jádro po pádu).
   */
  stepSplit: async (bytes: Uint8Array, fileName: string): Promise<(Omit<StepSplit, "parts"> & { parts: (SplitPart & { id: string })[] }) | null> => {
    w();
    const gen = generation;
    const res = await call<(Omit<StepSplit, "parts"> & { parts: (SplitPart & { id: string })[] }) | null>({ op: "stepSplit", bytes, fileName });
    if (res)
      for (const p of res.parts) {
        putBlobAs(p.id, p.bytes);
        if (gen === generation) sent.add(p.id);
      }
    return res;
  },
  /** odběr pádů jádra (po pádu se spustí nové) – UI zobrazí zprávu a přestaví model */
  onRestart: (fn: (reason: string) => void) => {
    restartListeners.add(fn);
    return () => void restartListeners.delete(fn);
  },
  asmFace: (key: string, index: number) => call<FaceInfo | null>({ op: "asmFace", key, index }),
  interference: (doc: CadDoc) => call<Interference[]>({ op: "interference", doc }),
  /** porovnání dílu s referenčním modelem (STEP / BREP / STL): objemy, rozdílová tělesa, mapa odchylek – viz compare.ts */
  compare: (doc: CadDoc, file: ReferenceFile, opts?: CompareOptions) => call<CompareResult>({ op: "compare", doc, file, opts }),
  mateFace: (key: string, index: number) => call<MateFaceInfo | null>({ op: "mateFace", key, index }),
  /** hrana / vrchol dílu nebo jemná síť plochy („mesh“) pro pokročilé vazby sestavy */
  mateEnt: (key: string, index: number, ent: "edge" | "vertex" | "mesh") => call<MateFaceInfo | null>({ op: "mateEnt", key, index, ent }),
  cylFace: (key: string, radius: number) => call<number>({ op: "cylFace", key, radius }),
  inspect: (src: ShapeSrc, ref: EntRef, density?: number) => call<EntityInfo>({ op: "inspect", src, ref, density }),
  measureEnt: (a: { src: ShapeSrc; ref: EntRef }, b: { src: ShapeSrc; ref: EntRef } | null) => call<MeasureResult>({ op: "measureEnt", a, b }),
  /** měření pro příkaz „měřit“ / window.mncad.measure (measure.ts): `doc` = díl, který se postaví a změří; `sources` = díly komponent sestavy */
  measure: (q: MeasureQuery, o: { doc?: CadDoc; density?: number; sources?: { key: string; source: ComponentSource }[] } = {}) => call<MeasureReport>({ op: "measure", q, ...o }),
  drawing: (doc: CadDoc, meta: DrawingMeta, opts?: Partial<DrawingOptions>) => call<DrawingResult & { smart?: SmartDims }>({ op: "drawing", doc, meta, opts }),
  /** plochy třídy A: návaznost hran, hřebeny křivosti, řídicí body plochy (surf-query.ts); `doc` = postavit nejdřív tento díl */
  surfA: (q: SurfQuery, doc?: CadDoc) => call<SurfQueryResult>({ op: "surfA", q, doc }),
};
