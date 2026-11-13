/**
 * Přizpůsobivá jemnost sítě (tessellation) a prahy pro velké modely.
 *
 * Malé modely se čtou beze změny (průhyb 0,1 % průměrného rozměru, úhel 0,35 rad). U velkých
 * sestav roste počet trojúhelníků s počtem ploch × výskytů — síť se proto zhrubí podle celkového
 * počtu ploch, aby se model vešel do paměti a grafiky běžného kancelářského PC.
 */

export type MeshLevel = "fine" | "normal" | "coarse" | "draft";

export interface Tessellation {
  level: MeshLevel;
  /** Lineární průhyb jako podíl průměrného rozměru modelu ((dx + dy + dz) / 3). */
  linearRatio: number;
  /** Úhlový průhyb v radiánech. */
  angular: number;
}

/** Výchozí (dosavadní) jemnost — malé modely zůstávají beze změny. */
export const FINE: Tessellation = { level: "fine", linearRatio: 0.001, angular: 0.35 };

/** Prahy podle celkového počtu ploch B-repu (přes všechny výskyty dílů). */
const LEVELS: { maxFaces: number; t: Tessellation }[] = [
  { maxFaces: 40_000, t: FINE },
  { maxFaces: 150_000, t: { level: "normal", linearRatio: 0.0015, angular: 0.45 } },
  { maxFaces: 400_000, t: { level: "coarse", linearRatio: 0.0025, angular: 0.6 } },
  { maxFaces: Infinity, t: { level: "draft", linearRatio: 0.004, angular: 0.8 } },
];

export function tessellationFor(totalFaces: number): Tessellation {
  const n = Number.isFinite(totalFaces) && totalFaces > 0 ? totalFaces : 0;
  return (LEVELS.find((l) => n <= l.maxFaces) ?? LEVELS[LEVELS.length - 1]).t;
}

/** Odhad počtu ploch, když soubor nejde rozebrat (≈ 400 B souboru STEP / IGES na plochu). */
export function estimateFacesFromBytes(bytes: number): number {
  return Math.round(Math.max(0, bytes) / 400);
}

/**
 * Absolutní lineární průhyb v mm pro rozdělenou sestavu (stejný vzorec jako OpenCascade
 * u „bounding_box_ratio" pro celý model); bez rozměru → 1 mm.
 */
export function absoluteDeflection(t: Tessellation, avgSizeMm: number): number {
  const d = avgSizeMm > 0 && Number.isFinite(avgSizeMm) ? avgSizeMm * t.linearRatio : 0;
  return d >= 1e-7 ? d : 1;
}

/** Od této velikosti se STEP sestava čte po dílech (paralelně, s průběhem). */
export const SPLIT_MIN_BYTES = 6 * 1024 * 1024;
/**
 * Když rozbor sestavy nepokryje všechna tělesa (neznámá vazba), čte se pod touto velikostí celý
 * soubor najednou (jako dřív); nad ní by to OpenCascade nezvládlo → po dílech s upozorněním.
 */
export const SPLIT_UNSURE_MIN_BYTES = 40 * 1024 * 1024;

/**
 * Nad tímto počtem trojúhelníků (po načtení) se vynechá přesná topologie pro měření
 * (hrany a body se počítají až na vyžádání) — jinak by příprava trvala minuty.
 */
export const TOPOLOGY_MAX_TRIANGLES = 6_000_000;
/** Totéž pro sítě bez ploch B-repu (STL, OBJ, PLY) — plochy se hledají podle úhlů, je to dražší. */
export const TOPOLOGY_MAX_MESH_TRIANGLES = 1_500_000;

/** Hranice, nad kterou už prohlížeč model raději nezkouší (prohlížeč by spadl na paměť). */
export const MAX_MODEL_BYTES = 600 * 1024 * 1024;

/** Počet souběžných workerů OpenCascade (nechá jedno jádro stránce, max 4 kvůli paměti). */
export function partWorkerCount(hardwareConcurrency: number | undefined, deviceMemoryGb?: number): number {
  const cores = hardwareConcurrency && hardwareConcurrency > 0 ? hardwareConcurrency : 2;
  let n = Math.max(1, Math.min(4, cores - 1));
  // málo paměti (navigator.deviceMemory ≤ 2 GB) → nejvýš 2 workery
  if (deviceMemoryGb && deviceMemoryGb <= 2) n = Math.min(n, 2);
  return n;
}

/** Text pro uživatele, když se síť zhrubila. */
export function meshLevelNote(level: MeshLevel): string | null {
  if (level === "fine") return null;
  return "Velký model: síť je zjednodušená (hrubší) — rozměry a průměry z měření jsou orientační.";
}

/** Chyba z WebAssembly / alokace → srozumitelná hláška (nedostatek paměti). */
export function isOutOfMemory(message: string): boolean {
  return /\bOOM\b|out of memory|Array buffer allocation failed|allocation failed|Cannot enlarge memory|memory access out of bounds|Maximum call stack|could not allocate|RangeError: Invalid typed array length/i.test(message);
}

export function fmtMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1).replace(".", ",")} MB`;
}

/**
 * Kolik workerů OpenCascade opravdu pomáhá: v Chromu sdílejí workery jedné stránky proces a OpenCascade
 * (hodně volání mezi JS a WebAssembly) se v nich navzájem brzdí — na některých PC jsou 3 workery
 * pomalejší než 1. Začne se jedním, po oknech měření se přidává další, dokud propustnost roste
 * aspoň o `gain`; jinak se vrátí na nejlepší počet a dál nezkouší.
 */
export class LaneTuner {
  target = 1;
  settled = false;
  private best = 0;
  private bestLanes = 1;

  constructor(readonly max: number, readonly gain = 1.15) {
    if (max <= 1) this.settled = true;
  }

  /** Propustnost (např. bajty / ms) posledního okna při `target` workerech → nový počet. */
  next(rate: number): number {
    if (this.settled) return this.target;
    if (this.best === 0 || rate >= this.best * this.gain) {
      this.best = Math.max(this.best, rate);
      this.bestLanes = this.target;
      if (this.target < this.max) this.target++;
      else this.settled = true;
    } else {
      this.target = this.bestLanes;
      this.settled = true;
    }
    return this.target;
  }
}
