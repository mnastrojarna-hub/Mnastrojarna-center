/**
 * Třídy kolizí sestavy pro protokol (CAD-HEADLESS-NAVRH.md 6.3, 5.2 č. 20; balík B4 strict-silent, nález 2 fáze A).
 *
 * Šroub zašroubovaný do závitové díry se s dílem v CADu vždy „protíná“ (dřík ve jmenovitém průměru × díra s průměrem
 * vrtáku). Taková dvojice není chyba konstrukce: `kolize` i `pohyb … kolize` ji hlásí jako ℹ `clash.thread`, aby přísný
 * režim nezastavil a skutečné kolize (⚠ `clash.real`) nezapadly mezi desítkami šroubů.
 *
 * Toto je zatím **odhad z prvků** (bez geometrie průniku), ale s polohou: šroub = díl s vnějším závitem nebo s názvem
 * „… M8x30“ / „šroub M8“ a s osou z prvků (závit, válec Ø d, rotace, jinak lokální Z); protějšek = díl se závitovou dírou
 * (nebo vnitřním závitem) téhož jmenovitého průměru, jejíž **osa ve světových souřadnicích je souosá s osou šroubu**
 * (úhel < 1°, vzdálenost os < 0,1 mm – polohy komponent včetně podsestav, v pohybu poloha kroku). Objem průniku nesmí
 * přesáhnout mezikruží (D² − d²)·π/4 × hloubka **té jedné díry** (+20 % + 1 mm³) – jinak je to kolize hlavy, dříku mimo
 * díru nebo šroub delší než díra (`real`). Šroub mimo všechny díry (v plném materiálu) je vždy `real`, i když má deska
 * mnoho děr téhož závitu. Díra s polohou odkazem (vrchol, bod skici) se bez geometrie ověřit nedá → `undetermined` (⚠).
 * Produktové cesty (`kolize`, `kontrola sestava`, `pohyb … kolize` – asm-agent-kin.ts `classifyStepClashes`) třídí
 * geometricky podle 6.3 v jádře (`clash-class.ts` + operace `clashDetail`, balík B5); tento odhad z prvků zůstává jen jako
 * náhrada pro prostředí bez operace jádra `clashDetail` (testy, cizí `AsmEnv`) se stejnými třídami.
 */
import { flattenAssembly, rotMatrix, apply3 } from "./assembly";
import { planeBasis, threadByName } from "./defaults";
import type { Direction } from "./refs";
import type { AsmComponent, Axis, CadDoc, Feature, Placement, Vec3 } from "./types";

export type ClashClass = "thread" | "underhead" | "real" | "undetermined";
export type ClashPair = { a: string; b: string; volume: number; aPath?: string[]; bPath?: string[] };
export type ClassifiedClash = ClashPair & { cls: ClashClass };
export type ClashCounts = { total: number; thread: number; underhead: number; real: number; undetermined: number };

const SCREW_WORD = /\b(šroub|sroub|screw|schraube|bolt|iso\s?4762|iso\s?4017|iso\s?4014|iso\s?7380|iso\s?10642|din\s?912|din\s?933|din\s?7984|ssb)\b/i;
const SIZE = /\bM\s?(\d+(?:[.,]\d+)?)(?:\s*[x×]\s*(\d+(?:[.,]\d+)?))?/i;
/** souosost os šroubu a díry: sin úhlu (1°) a vzdálenost os (mm) */
const ANGLE_TOL = Math.sin((1 * Math.PI) / 180);
const AXIS_TOL = 0.1;

type Line = { p: Vec3; d: Vec3 };
type HoleInfo = { line: Line | null; band: number };

/** jmenovitý průměr a délka šroubu dílu (null = díl není šroub) */
export function screwOf(c: AsmComponent): { d: number; length?: number } | null {
  if (c.source.kind !== "part") return null;
  const doc = c.source.doc;
  for (const f of doc.features) {
    if (f.suppressed || f.type !== "thread" || f.internal) continue;
    const t = threadByName(f.designation);
    if (t) return { d: t.d, length: f.length };
  }
  const label = [c.name, doc.name, doc.props?.number ?? ""].join(" ");
  const m = SIZE.exec(label);
  if (!m) return null;
  // „Šroub M6“ / „ISO 4762 M8x30“, nebo samotné „M6x20“ (rozměr × délka) – jinak (deska M8) to šroub není
  if (!SCREW_WORD.test(label) && m[2] === undefined) return null;
  const d = Number(m[1].replace(",", "."));
  return { d, ...(m[2] !== undefined ? { length: Number(m[2].replace(",", ".")) } : {}) };
}

const AXIS_VEC: Record<Axis, Vec3> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
const axisVec = (a: string | undefined): Vec3 => AXIS_VEC[(String(a ?? "Z").toUpperCase() as Axis)] ?? [0, 0, 1];
const dirVec = (dir: Direction | undefined, axis: string | undefined): Vec3 => (dir?.kind === "vector" ? dir.v : dir?.kind === "axis" ? axisVec(dir.axis) : axisVec(axis));

/** možné osy šroubu v souřadnicích dílu: vnější závit, válec Ø d, rotace (osa skici / globální), jinak lokální Z */
export function screwAxes(doc: CadDoc, d: number): Line[] {
  const out: Line[] = [];
  const sketches = new Map(doc.features.filter((f) => f.type === "sketch").map((f) => [f.id, f]));
  let lastSketch: Feature | undefined;
  for (const f of doc.features) {
    if (f.suppressed) continue;
    if (f.type === "sketch") lastSketch = f;
    if (f.type === "thread" && !f.internal && !f.positionRef) out.push({ p: f.position, d: dirVec(f.dirDef, f.axis) });
    else if (f.type === "cylinder" && f.mode !== "cut" && !f.positionRef && Math.abs(2 * f.radius - d) <= Math.max(0.5, 0.25 * d)) out.push({ p: f.position, d: dirVec(f.dirDef, f.axis) });
    else if (f.type === "revolve" && f.mode !== "cut") {
      const sk = (sketches.get(f.sketchId) ?? lastSketch) as Extract<Feature, { type: "sketch" }> | undefined;
      if (f.axisDef?.kind === "global") out.push({ p: [0, 0, 0], d: axisVec(f.axisDef.axis) });
      else if (sk && (!f.axisDef || f.axisDef.kind === "sketchX" || f.axisDef.kind === "sketchY")) {
        const b = planeBasis(sk.plane);
        const useX = f.axisDef ? f.axisDef.kind === "sketchX" : f.axis === "x";
        out.push({ p: b.origin, d: useX ? b.x : b.y });
      }
    }
  }
  out.push({ p: [0, 0, 0], d: [0, 0, 1] });
  return out;
}

/** závitové díry (a vnitřní závity) jmenovitého průměru `d` v souřadnicích dílu: osa (null = poloha odkazem) a mezikruží */
export function threadHoles(c: AsmComponent, d: number, screwLength?: number): HoleInfo[] {
  if (c.source.kind !== "part") return [];
  const out: HoleInfo[] = [];
  for (const f of c.source.doc.features) {
    if (f.suppressed) continue;
    if (f.type === "hole" && f.kind === "tapped" && f.thread) {
      const t = threadByName(f.thread);
      if (!t || Math.abs(t.d - d) > 1e-6) continue;
      const drill = f.tapDrill === "custom" || (f.diameter > 0 && f.tapDrill !== "table" && f.tapDrill !== "minor") ? f.diameter : t.tap;
      // pás mezikruží po celé hloubce vrtané díry (slepá: hloubka; skrz: nejvýš délka šroubu)
      const len = f.depth > 0 ? Math.max(f.depth, f.threadDepth ?? 0) : f.threadDepth || screwLength || 3 * d;
      const band = (Math.PI / 4) * Math.max(0, d * d - drill * drill) * len;
      const dir = dirVec(f.dirDef, f.axis);
      const pts = f.points?.length ? f.points : [{ kind: "xyz" as const, p: f.position }];
      for (const r of pts) out.push({ line: r.kind === "xyz" ? { p: r.p, d: dir } : null, band });
    } else if (f.type === "thread" && f.internal) {
      const t = threadByName(f.designation);
      if (!t || Math.abs(t.d - d) > 1e-6) continue;
      out.push({ line: f.positionRef ? null : { p: f.position, d: dirVec(f.dirDef, f.axis) }, band: (Math.PI / 4) * (d * d - t.tap * t.tap) * f.length });
    }
  }
  return out;
}

/** horní mez objemu průniku šroubu Ø`d` s nejlépe padnoucí závitovou dírou dílu (mm³); 0 = díl nemá závit tohoto průměru */
export function threadBand(c: AsmComponent, d: number, screwLength?: number): number {
  return Math.max(0, ...threadHoles(c, d, screwLength).map((h) => h.band));
}

const toWorld = (pl: Placement, l: Line): Line => {
  const R = rotMatrix(pl.rotation);
  const p = apply3(R, l.p);
  return { p: [p[0] + pl.position[0], p[1] + pl.position[1], p[2] + pl.position[2]], d: apply3(R, l.d) };
};
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const crossV = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
/** dvě přímky jsou souosé (rovnoběžné do 1°, vzdálenost os do 0,1 mm) */
export function coaxial(a: Line, b: Line): boolean {
  const da = unit(a.d);
  const db = unit(b.d);
  if (len(crossV(da, db)) > ANGLE_TOL) return false;
  return len(crossV(sub(b.p, a.p), da)) <= AXIS_TOL;
}

/** komponenta a její světová poloha podle cesty kolize (podsestavy) nebo id nejvyšší úrovně */
type Leaf = { comp: AsmComponent; placement: Placement };
function leafIndex(doc: CadDoc): Map<string, Leaf> {
  const m = new Map<string, Leaf>();
  for (const f of flattenAssembly(doc)) {
    const l = { comp: f.comp, placement: f.placement };
    m.set(f.path.join("/"), l);
    if (f.path.length === 1) m.set(f.path[0], l);
  }
  return m;
}

/** třída jedné dvojice podle listů (komponenta + světová poloha) */
function classifyLeaves(A: Leaf, B: Leaf, volume: number): ClashClass {
  let undetermined = false;
  for (const [s, other] of [
    [A, B],
    [B, A],
  ] as const) {
    const sc = screwOf(s.comp);
    if (!sc || s.comp.source.kind !== "part") continue;
    const holes = threadHoles(other.comp, sc.d, sc.length);
    if (!holes.length) continue;
    const axes = screwAxes(s.comp.source.doc, sc.d).map((l) => toWorld(s.placement, l));
    for (const h of holes) {
      if (!h.line) {
        undetermined = true;
        continue;
      }
      const hw = toWorld(other.placement, h.line);
      if (axes.some((a) => coaxial(a, hw)) && volume <= h.band * 1.2 + 1) return "thread";
    }
  }
  return undetermined ? "undetermined" : "real";
}

/** třída jedné dvojice kolize (polohy komponent z `doc`) */
export function classifyClash(doc: CadDoc, p: ClashPair, index = leafIndex(doc)): ClashClass {
  const A = index.get(p.aPath?.join("/") ?? p.a) ?? index.get(p.a);
  const B = index.get(p.bPath?.join("/") ?? p.b) ?? index.get(p.b);
  if (!A || !B) return "undetermined";
  return classifyLeaves(A, B, p.volume);
}

/** zařazení všech dvojic a počty tříd (polohy komponent z `doc` – v pohybu dokument v poloze kroku) */
export function classifyClashes(doc: CadDoc, pairs: readonly ClashPair[]): { list: ClassifiedClash[]; counts: ClashCounts } {
  const index = leafIndex(doc);
  const list = pairs.map((p) => ({ ...p, cls: classifyClash(doc, p, index) }));
  const counts: ClashCounts = { total: list.length, thread: 0, underhead: 0, real: 0, undetermined: 0 };
  for (const x of list) counts[x.cls]++;
  return { list, counts };
}

/** strojová část výpisu kolizí (`= clash …`), stejná v cs/en/de */
export const clashKv = (c: ClashCounts) => `total=${c.total} thread=${c.thread} underhead=${c.underhead} real=${c.real} undetermined=${c.undetermined}`;
