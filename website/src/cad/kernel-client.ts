/**
 * Klient CAD jádra nezávislý na transportu (CAD-HEADLESS-NAVRH.md kap. 2.3, balík B1) – vyjmuto z `client.ts` beze změny
 * chování: data importů posílaná jen poprvé (sada `sent` na instanci jádra), pád jádra (`fatal`) a nová instance, zrušení
 * výpočtu, průběh dlouhých operací (`LONG_OPS`) a pořadí instance `generation()`.
 *
 * Transporty: Web Worker v prohlížeči (`client.ts` → `cad.worker.ts`) a in-process ve vlákně běhu CLI (`kernel-inprocess.ts`
 * → `kernel-ops.ts`). Modul nesmí načíst jádro ani prohlížečové API – používá ho hlavní vlákno prohlížeče i Node.
 */
import { getLang, tr, type CadLang } from "./i18n";
import type { BuildProgress } from "./build";
import type { DrawingMeta, DrawingOptions } from "./drawing";
import type { CompareOptions, ReferenceFile } from "./compare";
import type { ClashPair } from "./clash-class";
import type { ClrReq } from "./clearance-types";
import type { EntRef, ShapeSrc } from "./inspect";
import type { MeasureQuery } from "./measure";
import type { SurfQuery } from "./surf-query";
import type { PlaneDef, Ref } from "./refs";
import type { CadDoc, ComponentSource, ExportFormat, Feature, Vec3 } from "./types";
import { blobIdOf, blobOf, blobRefsIn, putBlobAs } from "./blobs";
import { perfMark, perfPush } from "./perf-log";
import { fatalKernelText } from "./kernel-errors";
import type { KernelArgs, KernelEnvelope, KernelMsg, KernelReqOp, KernelResults, StepSplitResult } from "./kernel-protocol";

export type { TopologyResult } from "./kernel-protocol";

/** události běžící instance jádra pro klienta */
export type KernelTransportEvents = {
  /** zpráva jádra (odpověď, průběh, měření) */
  message(m: KernelMsg): void;
  /** nezachycená chyba instance (Web Worker `onerror`: jádro se nenačetlo nebo spadlo mimo obsluhu požadavku) */
  error(message: string): void;
};

/** jedna instance jádra (Web Worker nebo jádro ve vlákně) */
export type KernelInstance = {
  post(msg: KernelEnvelope): void;
  /** ukončí instanci; její další zprávy se zahodí, další požadavek spustí novou */
  terminate(): void;
};

/** Transport jádra: jak spustit novou instanci. */
export type KernelTransport = {
  spawn(on: KernelTransportEvents): KernelInstance;
  /**
   * jádro sdílí úložiště blobů s klientem (in-process ve stejném vlákně) – data importů (`mnblob:`) se neposílají;
   * Web Worker má vlastní úložiště, posílají se jen poprvé na instanci
   */
  sharedBlobs?: boolean;
  /**
   * běžící výpočet jde zrušit ukončením instance (Web Worker); in-process ne – synchronní volání WASM ve stejném vlákně
   * přeruší jen hlídač vlákna (`terminate()` celého vlákna běhu)
   */
  cancellable?: boolean;
};

/**
 * Průběh právě běžícího výpočtu v jádře: operace, počítaný prvek (k z n) a čas od začátku výpočtu / prvku.
 * `phase: "start"` = operace běží, ale průběh po prvcích nehlásí (export, výkres, kolize).
 */
export type CadProgress = Omit<BuildProgress, "phase"> & { phase: BuildProgress["phase"] | "start"; op: string; startedAt: number; featureAt: number };
/** operace, které mohou trvat dlouho – ukazuje se u nich průběh a jdou zrušit */
export const LONG_OPS: ReadonlySet<string> = new Set(["build", "check", "topology", "measure", "export", "exportStats", "drawing", "interference", "clashDetail", "clearance", "asmParts", "compare", "stepSplit"]);

/** Výpočet zrušený uživatelem (tlačítko Zrušit) – volající ho nemá hlásit jako chybu jádra. */
export class CadCancelled extends Error {
  constructor() {
    super(tr("Výpočet zrušen."));
    this.name = "CadCancelled";
  }
}
export const isCancelled = (e: unknown): e is CadCancelled => e instanceof CadCancelled;

/** klient jádra (`cad` v prohlížeči, jádro vlákna běhu v CLI) */
export type KernelClient = ReturnType<typeof makeKernelClient>;

/** Klient jádra nad transportem `t`. Instance jádra se spouští líně (první požadavek, po pádu nebo zrušení nová). */
export function makeKernelClient(t: KernelTransport) {
  let inst: KernelInstance | null = null;
  let seq = 0;
  /** data importů (otisky), která už má běžící jádro – posílají se jen jednou; nové jádro začíná s prázdnou sadou */
  let sent = new Set<string>();
  /** pořadí instance jádra (po pádu / zrušení se spouští nové) */
  let generation = 0;
  const restartListeners = new Set<(reason: string, raw: string) => void>();
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; op: string; at: number }>();
  const progressListeners = new Set<(p: CadProgress | null) => void>();
  let lastProgress: CadProgress | null = null;
  const emitProgress = (p: CadProgress | null) => {
    lastProgress = p;
    for (const l of progressListeners) l(p);
  };

  /** Pád jádra (WASM): ukončit, všechny čekající požadavky odmítnout srozumitelnou chybou, příště spustit nové jádro. */
  function crashed(raw: string) {
    const text = fatalKernelText(raw);
    const waiting = [...pending.values()];
    pending.clear();
    inst?.terminate();
    inst = null;
    emitProgress(null);
    perfMark("kernel.crash", 0, { error: raw.slice(0, 160) });
    for (const p of waiting) p.reject(new Error(text));
    for (const l of restartListeners) l(text, raw);
  }

  function onMessage(m: KernelMsg) {
    if (m.perf) return perfPush(m.perf);
    if (m.fatal) return crashed(m.error || "");
    const p = m.id !== undefined ? pending.get(m.id) : undefined;
    if (!p) return;
    if (m.at && !m.progress) perfMark("ui.fromKernel", Date.now() - m.at, { op: p.op });
    if (m.progress) {
      emitProgress({ ...m.progress, op: p.op, startedAt: p.at, featureAt: Date.now() });
      return;
    }
    pending.delete(m.id!);
    if (lastProgress) {
      // další čekající dlouhá operace přebírá ukazatel průběhu; jinak se průběh ukončí
      const next = [...pending.values()].find((x) => LONG_OPS.has(x.op));
      emitProgress(next ? { op: next.op, phase: "start", index: -1, total: 0, startedAt: Date.now(), featureAt: Date.now() } : null);
    }
    if (m.ok) p.resolve(m.result);
    else p.reject(new Error(m.error || tr("Chyba CAD jádra.")));
  }

  function onError(message: string) {
    // nezachycená chyba v jádře: před prvním načtením = jádro se nenačetlo, později = pád (jádro se spustí znovu)
    if (generation > 1 || pending.size > 1 || [...pending.values()].some((p) => p.op !== "init" && p.op !== "lang")) return crashed(message || "worker error");
    for (const p of pending.values()) p.reject(new Error(tr("CAD jádro se nepodařilo načíst: ") + (message || "")));
    pending.clear();
    emitProgress(null);
    inst?.terminate();
    inst = null;
  }

  function w(): KernelInstance {
    if (!inst) {
      inst = t.spawn({ message: onMessage, error: onError });
      sent = new Set();
      generation++;
      // nové jádro (první start nebo po zrušení výpočtu) dostane jazyk rozhraní dřív než první požadavek
      if (getLang() !== "cs") inst.post({ id: ++seq, op: "lang", lang: getLang() });
    }
    return inst;
  }

  /** začátek načítání dílů sestavy po dávkách – průběh ukazuje celkový čas, ne čas dávky */
  let seriesAt = 0;

  /** typovaná operace jádra: `call({ op: "build", doc })` → `Promise<BuildResult>` (mapa `KernelResults`) */
  function call<K extends KernelReqOp>(msg: KernelArgs<K> & { op: K }): Promise<KernelResults[K]> {
    const id = ++seq;
    return new Promise<KernelResults[K]>((resolve, reject) => {
      const op: string = msg.op;
      const offset = (msg as { offset?: number }).offset;
      if (op === "asmParts" && !offset) seriesAt = Date.now();
      const at = op === "asmParts" && offset ? seriesAt || Date.now() : Date.now();
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject, op, at });
      const wk = w();
      // data importů, která jádro ještě nemá (odkazy mnblob: v dokumentu) – jen poprvé, další stavby posílají jen odkaz
      let blobs: Record<string, Uint8Array> | undefined;
      let bytes = 0;
      if (!t.sharedBlobs)
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
      wk.post((blobs ? { id, ...msg, blobs } : { id, ...msg }) as unknown as KernelEnvelope);
      const dt = performance.now() - tp;
      if (bytes || dt > 20) perfMark("ui.postMessage", dt, { op, mb: +(bytes / 1048576).toFixed(2) });
      if (LONG_OPS.has(op) && !lastProgress) emitProgress({ op, phase: "start", index: -1, total: 0, startedAt: at, featureAt: at });
    });
  }

  /**
   * Zruší běžící výpočet: jádro počítá synchronně (WASM), takže jediný spolehlivý způsob je instanci ukončit. Všechny čekající
   * požadavky skončí chybou `CadCancelled`; další požadavek si jádro spustí znovu (mezipaměť stavby tím zaniká).
   * Transport bez zrušení (in-process) vrací false – výpočet přeruší jen hlídač vlákna.
   */
  function cancel(): boolean {
    if (t.cancellable === false || !inst || !pending.size) return false;
    const waiting = [...pending.values()];
    pending.clear();
    inst.terminate();
    inst = null;
    emitProgress(null);
    for (const p of waiting) p.reject(new CadCancelled());
    return true;
  }

  return {
    init: () => call({ op: "init" }),
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
    /**
     * Pořadí instance jádra, které platí mezipaměti nad jádrem (`ws.asm`): instance, která běží, nebo ta, která obslouží příští
     * požadavek (1 = první). Po pádu nebo zrušení se zvýší hned – mezipaměti staré instance už neplatí.
     */
    generation: (): number => (inst ? generation : generation + 1),
    /** jazyk hlášek jádra a textů výkresu (cs / en / de) – nastaví se při startu a při přepnutí jazyka */
    setLang: (lang: CadLang) => call({ op: "lang", lang }),
    build: (doc: CadDoc) => call({ op: "build", doc }),
    /** stavba bez sítě – jen výsledek prvků (přísný režim po každé operaci měnící geometrii, balík B4) */
    check: (doc: CadDoc) => call({ op: "check", doc }),
    /** sestaví dokument a v jednom kroku vrátí plochy a hrany pro výběr pravidlem (bez závodu s dalšími sestaveními) */
    topology: (doc: CadDoc) => call({ op: "topology", doc }),
    face: (index: number) => call({ op: "face", index }),
    /** geometrie + otisk odkazu nad aktuálním tělesem (pro formuláře a náhledy) */
    refInfo: (doc: CadDoc, ref: Ref) => call({ op: "refInfo", doc, ref }),
    /** otisky výběru hran/ploch prvku nad tělesem před ním (`doc` oříznutý před prvek) – viz pick-sigs.ts `stampPicks` */
    pickSigs: (doc: CadDoc, feature: Feature) => call({ op: "pickSigs", doc, feature }),
    planeDef: (doc: CadDoc, def: PlaneDef) => call({ op: "planeDef", doc, def }),
    /** pomocné osy / body / souřadné systémy k vykreslení */
    datumGfx: (doc: CadDoc) => call({ op: "datumGfx", doc }),
    exportFile: (doc: CadDoc, format: ExportFormat) => call({ op: "export", doc, format }),
    /** exportovaný STEP / BREP znovu načtený jádrem a model: tělesa, objem, obálka (bez sítě – export-verify.ts) */
    exportStats: (doc: CadDoc, bytes: Uint8Array, format: "step" | "brep") => call({ op: "exportStats", doc, bytes, format }),
    /** díly sestavy; `offset`/`total` = pořadí dávky v celém načítání (pro průběh „díl k z n“) */
    asmParts: (parts: { key: string; source: ComponentSource }[], offset = 0, total = parts.length) => call({ op: "asmParts", parts, offset, total }),
    /**
     * Sestava STEP → díly (každý svůj STEP). `null` = soubor není sestava. Data dílů zůstávají v jádře a ukládají se i
     * u klienta (pro uložení .mncad a nové jádro po pádu).
     */
    stepSplit: async (bytes: Uint8Array, fileName: string): Promise<StepSplitResult> => {
      w();
      const gen = generation;
      const res = await call({ op: "stepSplit", bytes, fileName });
      if (res)
        for (const p of res.parts) {
          putBlobAs(p.id, p.bytes);
          if (gen === generation) sent.add(p.id);
        }
      return res;
    },
    /** odběr pádů jádra (po pádu se spustí nové) – UI zobrazí zprávu (`reason`) a přestaví model; `raw` = původní chyba */
    onRestart: (fn: (reason: string, raw: string) => void) => {
      restartListeners.add(fn);
      return () => void restartListeners.delete(fn);
    },
    asmFace: (key: string, index: number) => call({ op: "asmFace", key, index }),
    interference: (doc: CadDoc) => call({ op: "interference", doc }),
    /** přesná obálka sestavy z těles listových dílů v jejich umístění (OCCT, ne síť) – řádek „Sestava: … obálka“ ve stavu */
    asmEnvelope: (doc: CadDoc) => call({ op: "asmEnvelope", doc }),
    /** zařazení dvojic kolizí (šroub v závitu / pod hlavou / skutečná / nevyhodnotitelná) – clash-class.ts, clash-detail.ts */
    clashDetail: (doc: CadDoc, pairs: ClashPair[]) => call({ op: "clashDetail", doc, pairs }),
    /** vůle mezi komponentami a spojitá kontrola úseku pohybu (vlna 22, bod 6 – clearance-kernel.ts) */
    clearance: (req: ClrReq) => call({ op: "clearance", req }),
    /** porovnání dílu s referenčním modelem (STEP / BREP / STL): objemy, rozdílová tělesa, mapa odchylek – viz compare.ts */
    compare: (doc: CadDoc, file: ReferenceFile, opts?: CompareOptions) => call({ op: "compare", doc, file, opts }),
    mateFace: (key: string, index: number) => call({ op: "mateFace", key, index }),
    /** hrana / vrchol dílu nebo jemná síť plochy („mesh“) pro pokročilé vazby sestavy */
    mateEnt: (key: string, index: number, ent: "edge" | "vertex" | "mesh") => call({ op: "mateEnt", key, index, ent }),
    cylFace: (key: string, radius: number) => call({ op: "cylFace", key, radius }),
    inspect: (src: ShapeSrc, ref: EntRef, density?: number) => call({ op: "inspect", src, ref, density }),
    /** filtr výběru Prvek: prvek historie, který vytvořil plochu `index` dílu, a všechny jeho plochy */
    faceOwner: (doc: CadDoc, index: number, point?: Vec3) => call({ op: "faceOwner", doc, index, point }),
    measureEnt: (a: { src: ShapeSrc; ref: EntRef }, b: { src: ShapeSrc; ref: EntRef } | null) => call({ op: "measureEnt", a, b }),
    /** měření pro příkaz „měřit“ / window.mncad.measure (measure.ts): `doc` = díl, který se postaví a změří; `sources` = díly komponent sestavy */
    measure: (q: MeasureQuery, o: { doc?: CadDoc; density?: number; sources?: { key: string; source: ComponentSource }[] } = {}) => call({ op: "measure", q, ...o }),
    drawing: (doc: CadDoc, meta: DrawingMeta, opts?: Partial<DrawingOptions>) => call({ op: "drawing", doc, meta, opts }),
    /** plochy třídy A: návaznost hran, hřebeny křivosti, řídicí body plochy (surf-query.ts); `doc` = postavit nejdřív tento díl */
    surfA: (q: SurfQuery, doc?: CadDoc) => call({ op: "surfA", q, doc }),
  };
}
