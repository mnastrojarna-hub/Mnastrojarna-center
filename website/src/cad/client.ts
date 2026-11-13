"use client";
import { getLang, tr, type CadLang } from "./i18n";
import type { BuildProgress } from "./build";
import type { EdgeLite, FaceLite } from "./agent";
import type { DrawingMeta, DrawingOptions, DrawingResult } from "./drawing";
import type { SmartDims } from "./drawing-dims";
import type { Interference, MateFaceInfo } from "./asm-kernel";
import type { CompareOptions, CompareResult, ReferenceFile } from "./compare";
import type { EntRef, EntityInfo, MeasureResult, ShapeSrc } from "./inspect";
import type { DatumDisplay } from "./feat/refs-more";
import type { Geo, PlaneDef, Ref, ResolvedPlane, Sig } from "./refs";
import type { BodyInfo, BuildResult, CadDoc, ComponentSource, ExportFormat, FaceInfo, Feature, Vec3 } from "./types";

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; op: string; at: number }>();

/**
 * Průběh právě běžícího výpočtu v jádře: operace, počítaný prvek (k z n) a čas od začátku výpočtu / prvku.
 * `phase: "start"` = operace běží, ale průběh po prvcích nehlásí (export, výkres, kolize).
 */
export type CadProgress = Omit<BuildProgress, "phase"> & { phase: BuildProgress["phase"] | "start"; op: string; startedAt: number; featureAt: number };
/** operace, které mohou trvat dlouho – ukazuje se u nich průběh a jdou zrušit */
const LONG_OPS = new Set(["build", "topology", "export", "drawing", "interference", "asmParts", "compare"]);
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

function w() {
  if (!worker) {
    worker = new Worker(new URL("./cad.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; ok?: boolean; result?: unknown; error?: string; progress?: BuildProgress }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
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

function call<T>(msg: Record<string, unknown>): Promise<T> {
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    const op = String(msg.op);
    const at = Date.now();
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, op, at });
    w().postMessage({ id, ...msg });
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
  asmParts: (parts: { key: string; source: ComponentSource }[]) => call<{ key: string; result: BuildResult }[]>({ op: "asmParts", parts }),
  asmFace: (key: string, index: number) => call<FaceInfo | null>({ op: "asmFace", key, index }),
  interference: (doc: CadDoc) => call<Interference[]>({ op: "interference", doc }),
  /** porovnání dílu s referenčním modelem (STEP / BREP / STL): objemy, rozdílová tělesa, mapa odchylek – viz compare.ts */
  compare: (doc: CadDoc, file: ReferenceFile, opts?: CompareOptions) => call<CompareResult>({ op: "compare", doc, file, opts }),
  mateFace: (key: string, index: number) => call<MateFaceInfo | null>({ op: "mateFace", key, index }),
  cylFace: (key: string, radius: number) => call<number>({ op: "cylFace", key, radius }),
  inspect: (src: ShapeSrc, ref: EntRef, density?: number) => call<EntityInfo>({ op: "inspect", src, ref, density }),
  measureEnt: (a: { src: ShapeSrc; ref: EntRef }, b: { src: ShapeSrc; ref: EntRef } | null) => call<MeasureResult>({ op: "measureEnt", a, b }),
  drawing: (doc: CadDoc, meta: DrawingMeta, opts?: Partial<DrawingOptions>) => call<DrawingResult & { smart?: SmartDims }>({ op: "drawing", doc, meta, opts }),
};
