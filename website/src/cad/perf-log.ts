/**
 * Měření kroků otevření a zobrazení modelu (čtení souboru, otisk, předání jádru, čtení STEP, přenos, kontrola, kvádr, síť,
 * přenos do UI, nahrání do WebGL, přizpůsobení pohledu) s pamětí JS a WASM. Jádro (worker) posílá své záznamy do UI,
 * kde je čte automatizace přes `window.mncad.perf()` (e2e testy, diagnostika velkých souborů).
 */
export type PerfEntry = { stage: string; ms: number; at: number; info?: Record<string, number | string> };

/** záznamů nejvýš (sestava 150 dílů ≈ 750 záznamů jádra) */
const MAX = 5000;
const log: PerfEntry[] = [];
let sink: ((e: PerfEntry) => void) | null = null;

/** záznam kroku (v UI rovnou do protokolu, v jádře přes `setPerfSink` do UI) */
export function perfMark(stage: string, ms: number, info?: PerfEntry["info"]) {
  const e: PerfEntry = { stage, ms: Math.round(ms), at: Date.now(), ...(info ? { info } : {}) };
  if (sink) return sink(e);
  log.push(e);
  if (log.length > MAX) log.splice(0, log.length - MAX);
}
/** přijatý záznam z jádra */
export const perfPush = (e: PerfEntry) => {
  log.push(e);
  if (log.length > MAX) log.splice(0, log.length - MAX);
};
export const perfEntries = (): PerfEntry[] => log.map((e) => ({ ...e, info: e.info ? { ...e.info } : undefined }));
export const perfClear = () => void log.splice(0, log.length);
/** jádro: kam posílat záznamy (worker → UI) */
export const setPerfSink = (fn: ((e: PerfEntry) => void) | null) => void (sink = fn);

/** obsazená paměť JS v MB (Chromium), jinak undefined */
export function jsHeapMB(): number | undefined {
  const m = (globalThis.performance as unknown as { memory?: { usedJSHeapSize: number } } | undefined)?.memory;
  return m ? Math.round(m.usedJSHeapSize / 1048576) : undefined;
}

/** změří synchronní krok */
export function timed<T>(stage: string, fn: () => T, info?: (r: T) => PerfEntry["info"]): T {
  const t = performance.now();
  const r = fn();
  perfMark(stage, performance.now() - t, info?.(r));
  return r;
}
