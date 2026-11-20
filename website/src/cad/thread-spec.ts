/**
 * Jedna cesta k závitu (vlna 22, bod 22d zprávy majitele: „Příkaz thread odmítl M18×1,5, přestože alternativní helixSweep
 * vlastní stoupání umožňoval. Je potřeba propojit tyto cesty a sjednotit ovládání.“).
 *
 * Čisté funkce bez jádra, sdílené textem, formuláři, stavbou, výkresem, kolizemi a převodníkem do skriptu:
 *  – `mergeThreadTokens`: označení zapsané s mezerami („m18 x 1,5“, „M18 ×1.5“, „M18× 1,5“, X / x / ×, čárka i tečka)
 *    se před rozborem řádku spojí do jednoho slova – závit, díra se závitem i `thread=` u prvku;
 *  – ISO 261: řada stoupání pro každý jmenovitý průměr; stoupání mimo řadu (M18×3) se postaví, ale je ⚠
 *    `thread.pitch-nonstandard` (`pitchNote`) – nikdy ne tiše;
 *  – `helixThreadDims`: z označení poloměr povrchu, hloubka a stoupání skutečné šroubovice (profil Závit 60°) – stejná
 *    čísla pro prvek Závit se šroubovicí i pro Tažení po šroubovici s `thread=M18×1,5`;
 *  – `threadOfFeature`: jednotný pohled na závit v historii (Závit kosmetický / drážky / šroubovice, Tažení po šroubovici
 *    s označením) pro výkres (`drawing-doc.ts`, `drawing-prim.ts`), kolize (`clash-thread.ts`, `clash-class.ts`) a kontrolu.
 */
import { METRIC_THREADS, threadByName, type MetricThread } from "./defaults";
import { getLang, tr } from "./i18n";
import type { Direction, Ref } from "./refs";
import type { Axis, Feature, Vec3 } from "./types";

/**
 * ISO 261 (výběr řad 1–3 pro M2 až M48): hrubé stoupání + jemná stoupání. Stoupání mimo řadu se dá zadat (dopočítá se
 * jádro), ale je nestandardní – ⚠ `thread.pitch-nonstandard`.
 */
export const ISO261: Readonly<Record<string, readonly number[]>> = {
  "2": [0.4, 0.25],
  "2.5": [0.45, 0.35],
  "3": [0.5, 0.35],
  "4": [0.7, 0.5],
  "5": [0.8, 0.5],
  "6": [1, 0.75],
  "8": [1.25, 1, 0.75],
  "10": [1.5, 1.25, 1, 0.75],
  "12": [1.75, 1.5, 1.25, 1],
  "14": [2, 1.5, 1.25, 1],
  "16": [2, 1.5, 1],
  "18": [2.5, 2, 1.5, 1],
  "20": [2.5, 2, 1.5, 1],
  "22": [2.5, 2, 1.5, 1],
  "24": [3, 2, 1.5, 1],
  "27": [3, 2, 1.5, 1],
  "30": [3.5, 3, 2, 1.5, 1],
  "33": [3.5, 3, 2, 1.5],
  "36": [4, 3, 2, 1.5],
  "39": [4, 3, 2, 1.5],
  "42": [4.5, 4, 3, 2, 1.5],
  "45": [4.5, 4, 3, 2, 1.5],
  "48": [5, 4, 3, 2, 1.5],
};

/** řada stoupání ISO 261 pro jmenovitý průměr (prázdná = průměr mimo katalog) */
export const isoPitches = (d: number): readonly number[] => ISO261[String(d)] ?? [];
/** je stoupání `p` pro průměr `d` v ISO 261? */
export const isIsoPitch = (d: number, p: number): boolean => isoPitches(d).some((x) => Math.abs(x - p) < 1e-9);

const num = (v: number) => {
  const s = String(Math.round(v * 1000) / 1000);
  return getLang() === "en" ? s : s.replace(".", ",");
};

/**
 * Varování k nestandardnímu stoupání (text pro ⚠ prvku), nebo null. `M18×3` → „stoupání 3 mm není pro M18 v ISO 261
 * (řada: 2,5 / 2 / 1,5 / 1) …“.
 */
export function pitchNote(t: Pick<MetricThread, "d" | "pitch" | "name"> | undefined | null): string | null {
  if (!t || isIsoPitch(t.d, t.pitch)) return null;
  const row = isoPitches(t.d);
  if (!row.length) return null;
  return tr("stoupání {0} mm není pro M{1} v ISO 261 (řada: {2}) – závit {3} se postaví, ale je nestandardní (nástroj, kalibr a protikus nejsou běžné).", num(t.pitch), num(t.d), row.map(num).join(" / "), t.name);
}

const NUM_TOKEN = /^\d+(?:[.,]\d+)?$/;
const SEP_TOKEN = /^[x×]$/i;
/** slovo s označením na začátku: volitelně `klíč=` (thread=, závit=, gewinde=), pak M a průměr, volitelně oddělovač na konci */
const HEAD = /^((?:[^\s=]+=)?m\d+(?:[.,]\d+)?)([x×])?$/i;

/**
 * Spojí označení závitu rozdělené mezerami do jednoho slova: `m18 x 1,5` → `m18×1,5`, `M18 ×1.5` → `M18×1.5`,
 * `M18× 1,5` → `M18×1,5`, `thread=M18 x 1,5` → `thread=M18×1,5`. Ostatní slova beze změny.
 */
export function mergeThreadTokens(tokens: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const m = HEAD.exec(t);
    if (m) {
      const a = tokens[i + 1];
      const b = tokens[i + 2];
      if (!m[2] && a !== undefined && SEP_TOKEN.test(a) && b !== undefined && NUM_TOKEN.test(b)) {
        out.push(`${m[1]}×${b}`);
        i += 2;
        continue;
      }
      if (!m[2] && a !== undefined && /^[x×]\d+(?:[.,]\d+)?$/i.test(a)) {
        out.push(`${m[1]}×${a.slice(1)}`);
        i += 1;
        continue;
      }
      if (m[2] && a !== undefined && NUM_TOKEN.test(a)) {
        out.push(`${m[1]}×${a}`);
        i += 1;
        continue;
      }
    }
    out.push(t);
  }
  return out;
}

/** totéž pro text `klíč=hodnota` (obecný příkaz `prvek … thread=M18 x 1,5`): spojí označení za `=` */
export const mergeThreadText = (text: string): string => text.replace(/((?:^|\s)[^\s=]+=m\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)(?=\s|$)/gi, "$1×$2");

/** hloubka profilu vnějšího závitu (ISO 68-1: h3 = 0,61343·P) */
export const H3 = 0.61343;
/** nosná hloubka vnitřního závitu (ISO 68-1: H1 = 5/8·H = 0,54127·P) */
export const H1 = 0.541266;

/**
 * Skutečná šroubovice z označení (profil Závit 60° Tažení po šroubovici): poloměr povrchu, na kterém drážka začíná,
 * hloubka do materiálu a stoupání.
 *  – vnější (na válci Ø d): povrch R = d/2, hloubka h3 = 0,6134·P (dno na malém průměru d3);
 *  – vnitřní (v díře): povrch R = D1/2 (malý průměr matice, d − 1,0825·P), hloubka do stěny H1 = 0,5413·P – špička na d/2.
 * Díra vrtaná tabulkovým vrtákem (Ø16,5 u M18×1,5) má poloměr mezi R a R + hloubka – drážka ji protne.
 */
export function helixThreadDims(t: Pick<MetricThread, "d" | "pitch">, internal: boolean): { radius: number; depth: number; pitch: number } {
  const P = t.pitch;
  if (!internal) return { radius: t.d / 2, depth: Math.round(H3 * P * 1e6) / 1e6, pitch: P };
  const radius = Math.round(((t.d - 1.082532 * P) / 2) * 1e6) / 1e6;
  return { radius, depth: Math.round((t.d / 2 - radius) * 1e6) / 1e6, pitch: P };
}

/** Provedení závitu: kosmetický (jen výkres), soustružené drážky (prstence), skutečná šroubovice. */
export type ThreadGeometry = "cosmetic" | "rings" | "helix";
export const threadGeometryOf = (f: { modeled?: boolean; helix?: boolean }): ThreadGeometry => (!f.modeled ? "cosmetic" : f.helix ? "helix" : "rings");

/** Závit v historii dílu jednotně (prvek Závit, Tažení po šroubovici s označením `thread=`). */
export type ThreadView = {
  id: string;
  name: string;
  /** katalogové označení „M18×1,5“ */
  designation: string;
  t: MetricThread;
  internal: boolean;
  /** délka závitu (u šroubovice otáčky × stoupání) */
  length: number;
  position: Vec3;
  axis?: Axis;
  dirDef?: Direction;
  positionRef?: Ref;
  geometry: ThreadGeometry;
  source: "thread" | "helixSweep";
};

const AXES = new Set(["X", "Y", "Z"]);
const isVec = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x));

/** směr osy prvku rozšíření (Direction, starší „X“ / „Y“ / „Z“ nebo vektor) jako `Direction` */
export function extAxisDirection(v: unknown): Direction | undefined {
  if (typeof v === "string" && AXES.has(v.toUpperCase())) return { kind: "axis", axis: v.toUpperCase() as Axis };
  if (isVec(v)) return { kind: "vector", v };
  if (v && typeof v === "object" && typeof (v as { kind?: unknown }).kind === "string") return v as Direction;
  return undefined;
}

/** označení závitu u Tažení po šroubovici (`thread`), nebo null */
export function helixSweepThread(data: Record<string, unknown> | undefined): MetricThread | null {
  if (!data || data.profile !== "thread60") return null;
  const s = typeof data.thread === "string" ? data.thread.trim() : "";
  return s ? (threadByName(s) ?? null) : null;
}

/**
 * Závit prvku jednotně, nebo null (prvek není závit / neznámé označení / potlačený). Tažení po šroubovici je závitem jen
 * s profilem Závit 60° a s katalogovým označením `thread` (odvozené označení z čísel zůstává v `drawing-doc.ts`).
 */
export function threadOfFeature(f: Feature): ThreadView | null {
  if (f.suppressed) return null;
  if (f.type === "thread") {
    const t = threadByName(f.designation);
    if (!t) return null;
    return { id: f.id, name: f.name, designation: t.name, t, internal: !!f.internal, length: f.length, position: f.position, axis: f.axis, ...(f.dirDef ? { dirDef: f.dirDef } : {}), ...(f.positionRef ? { positionRef: f.positionRef } : {}), geometry: threadGeometryOf(f), source: "thread" };
  }
  if (f.type === "ext" && f.ext === "surf.helixSweep") {
    const d = f.data ?? {};
    const t = helixSweepThread(d);
    if (!t) return null;
    const turns = typeof d.turns === "number" ? d.turns : 0;
    const dirDef = extAxisDirection(d.axis);
    const position = isVec(d.position) ? d.position : ([0, 0, 0] as Vec3);
    const ref = d.positionRef && typeof d.positionRef === "object" ? (d.positionRef as Ref) : undefined;
    return { id: f.id, name: f.name, designation: t.name, t, internal: d.side === "internal", length: turns * t.pitch, position, ...(dirDef ? { dirDef } : {}), ...(ref ? { positionRef: ref } : {}), geometry: "helix", source: "helixSweep" };
  }
  return null;
}

/** závity dílu jednotně (v pořadí historie) */
export const threadsOfFeatures = (features: readonly Feature[]): ThreadView[] => features.map(threadOfFeature).filter((x): x is ThreadView => !!x);

/** jmenovité průměry katalogu (M2 … M48) – pro hlášky */
export const THREAD_SIZES = METRIC_THREADS.map((t) => t.d);
