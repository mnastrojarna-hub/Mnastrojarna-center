/**
 * Operace jádra `clashDetail(doc, pairs)` (CAD-HEADLESS-NAVRH.md kap. 6.3, balík B5): geometrické zařazení dvojic, které
 * označila kontrola kolizí (`interference`, asm-kernel.ts) – šroub v závitové díře (ℹ `clash.thread`), prstenec pod hlavou
 * (ℹ `clash.underhead`), skutečná kolize (⚠ `clash.real`), nevyhodnotitelné (⚠ `clash.undetermined`). Pravidlo a meze jsou
 * v clash-class.ts (čisté funkce); zde jen geometrie v OCCT.
 *
 * Průnik se počítá stejně jako v `interference` (`pairIntersection`: druhý díl jen s polohou TopLoc_Location, vzájemná poloha
 * zaokrouhlená na mřížku 1e-7 – šum poloh z řešiče nerozbije souosé plochy), ale v souřadnicích dílu s dírou: díry dílu
 * (`measureCylinders`, i se vstupem a smyslem vrtání) i jeho prvky jsou v týchž souřadnicích. Výsledek dvojice (díl s dírou,
 * druhý díl, vzájemná poloha) se pamatuje – opakovaná `kolize` a kroky pohybu se stejnou vzájemnou polohou nic nepočítají.
 * Všechny objekty OCCT se hned mažou (booleovské operace s `Clear()`, jako `pairVolume`).
 */
import * as r from "replicad";
import { flattenAssembly } from "./assembly";
import { pairIntersection, partEntry, relOf, rtOf } from "./asm-kernel";
import { CLASH_RULE, axisAngle, decideBand, lineDist, matchTapHoles, tapFeatureOf, tappedFeatures, worstClass, type ClashClass, type ClashDetail, type ClashPair, type ClashWhy, type GeoHole, type TapFeature, type TapHole } from "./clash-class";
import { subShapes } from "./fastbox";
import { measureCylinders } from "./measure";
import type { CadDoc, Vec3 } from "./types";

type Shape = r.Shape3D;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Oc = any;

/** díry dílu podle klíče dílu (obsah) – platí trvale */
const holeCache = new Map<string, GeoHole[]>();
/** (díl s dírou, druhý díl, vzájemná poloha) → zařazení strany */
const sideCache = new Map<string, Side>();
const HOLE_MAX = 2000;
const SIDE_MAX = 20000;

/** Vyprázdní mezipaměti zařazení (nová instance jádra, testy). */
export function clearClashDetailCache(): void {
  holeCache.clear();
  sideCache.clear();
}

type Side = { cls: ClashClass; why: ClashWhy; hole?: TapHole; band?: number; rest?: number; restDepth?: number; note?: string };

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];

/** objem tvaru (mm³) */
function volumeOf(s: Shape): number {
  const oc = r.getOC() as Oc;
  const props = new oc.GProp_GProps();
  try {
    oc.BRepGProp.VolumeProperties(s.wrapped, props, false, false, false);
    return props.Mass() as number;
  } finally {
    props.delete();
  }
}

/** booleovská operace s okamžitým úklidem (výsledek smaže volající); selhání → null */
function boolOp(kind: "common" | "cut", a: Shape, b: Shape): Shape | null {
  const oc = r.getOC() as Oc;
  const args = new oc.NCollection_List_TopoDS_Shape();
  const tools = new oc.NCollection_List_TopoDS_Shape();
  const op = kind === "common" ? new oc.BRepAlgoAPI_Common() : new oc.BRepAlgoAPI_Cut();
  try {
    args.Append(a.wrapped);
    tools.Append(b.wrapped);
    op.SetArguments(args);
    op.SetTools(tools);
    op.SetNonDestructive(true);
    op.Build();
    if (op.HasErrors() || !op.IsDone()) return null;
    const res = op.Shape();
    try {
      return r.cast(res) as Shape;
    } finally {
      res.delete();
    }
  } catch {
    return null;
  } finally {
    op.Clear();
    op.delete();
    tools.delete();
    args.delete();
  }
}

/** díry dílu (vnitřní válcové plochy se vstupem, smyslem vrtání a délkou) */
function holesOf(key: string, body: Shape, feats: readonly TapFeature[]): GeoHole[] {
  let h = holeCache.get(key);
  if (!h) {
    // jen díry, které můžou mít závitový prvek (vstup se zjišťuje body uvnitř tělesa – u desky s desítkami děr sekundy)
    h = measureCylinders(body, true, { bottom: false, keep: (c) => !!tapFeatureOf(feats, c.radius, c.axis, c.from) }).map((c) => {
      const drill = (c.drill ?? mul(c.axis, -1)) as Vec3;
      return { r: c.radius, axis: c.axis, entry: (c.entry ?? c.to) as Vec3, drill, length: c.length, through: !!c.through };
    });
    if (holeCache.size >= HOLE_MAX) holeCache.delete(holeCache.keys().next().value!);
    holeCache.set(key, h);
  }
  return h;
}

/** válcové plochy kusu průniku: osa (bod, směr) a poloměr */
function cylindersOf(s: Shape): { o: Vec3; d: Vec3; r: number }[] {
  const out: { o: Vec3; d: Vec3; r: number }[] = [];
  const oc = r.getOC() as Oc;
  s.faces.forEach((f) => {
    if (f.geomType !== "CYLINDRE") return;
    const ad = new oc.BRepAdaptor_Surface(f.wrapped, true);
    try {
      const cy = ad.Cylinder();
      const ax = cy.Axis();
      const l = ax.Location();
      const d = ax.Direction();
      out.push({ o: [l.X(), l.Y(), l.Z()], d: [d.X(), d.Y(), d.Z()], r: cy.Radius() });
    } finally {
      ad.delete();
    }
  });
  return out;
}

/** mezikruží pásma závitu díry `h` (jmenovitý průměr D): [r − ε, D/2 + ε] × [vstup − ε, vstup + délka + ε] */
function bandTube(h: TapHole, D: number): Shape | null {
  const eps = CLASH_RULE.eps;
  const start = sub(h.entry, mul(h.drill, eps));
  const len = h.length + 2 * eps;
  const outer = r.makeCylinder(D / 2 + eps, len, start as never, h.drill as never) as Shape;
  const inner = r.makeCylinder(Math.max(0.01, h.r - eps), len, start as never, h.drill as never) as Shape;
  try {
    return boolOp("cut", outer, inner);
  } finally {
    outer.delete();
    inner.delete();
  }
}

/** nejhlubší místo tvaru od vstupu díry podél smyslu vrtání (průchozí díra: od bližšího konce) */
function depthFromEntry(s: Shape, h: TapHole): number {
  const m = s.mesh({ tolerance: 0.005, angularTolerance: 0.05 });
  let tMin = Infinity;
  let tMax = -Infinity;
  for (let k = 0; k + 2 < m.vertices.length; k += 3) {
    const t = dot(sub([m.vertices[k], m.vertices[k + 1], m.vertices[k + 2]], h.entry), h.drill);
    if (t < tMin) tMin = t;
    if (t > tMax) tMax = t;
  }
  if (!Number.isFinite(tMax)) return 0;
  return h.through ? Math.min(tMax, h.length - tMin) : tMax;
}

/**
 * Zařazení jednoho kusu průniku `x` (souřadnice dílu s dírami) podle děr se závitem `holes`: válcové plochy kusu musí být
 * souosé s jednou dírou (bez válců rozhodne objem v pásmu – vezme se díra s největším objemem v pásmu).
 */
function classifyPiece(x: Shape, holes: TapHole[]): Side {
  const cyls = cylindersOf(x);
  const coaxial = (h: TapHole) => cyls.every((c) => axisAngle(c.d, h.axis) <= CLASH_RULE.maxAngle && lineDist(c.o, h.entry, h.axis) <= CLASH_RULE.maxAxisDist);
  const cands = holes.filter(coaxial);
  if (!cands.length) {
    const c = cyls[0];
    const near = holes.reduce<{ h: TapHole; a: number; d: number } | null>((best, h) => {
      const a = c ? axisAngle(c.d, h.axis) : 0;
      const d = c ? lineDist(c.o, h.entry, h.axis) : 0;
      return !best || d < best.d ? { h, a, d } : best;
    }, null);
    return { cls: "real", why: "off-axis", ...(near && c ? { note: `${near.h.designation} ${near.a.toFixed(2)}deg ${near.d.toFixed(3)}mm` } : {}) };
  }
  const volume = volumeOf(x);
  let best: Side | null = null;
  for (const h of cands) {
    if (h.D === null) {
      best ??= { cls: "undetermined", why: "unknown-designation", hole: h, note: h.designation };
      continue;
    }
    const tube = bandTube(h, h.D);
    if (!tube) {
      best ??= { cls: "undetermined", why: "kernel-failed", hole: h };
      continue;
    }
    let band = 0;
    let restDepth = 0;
    try {
      const inBand = boolOp("common", x, tube);
      band = inBand ? volumeOf(inBand) : 0;
      inBand?.delete();
      const rest = volume - band;
      if (rest > 1e-3) {
        const out = boolOp("cut", x, tube);
        restDepth = out ? depthFromEntry(out, h) : Infinity;
        out?.delete();
      }
    } finally {
      tube.delete();
    }
    const rest = Math.max(0, volume - band);
    const d = decideBand({ volume, band, rest, restDepth, D: h.D });
    const side: Side = { cls: d.cls, why: d.why, hole: h, band, rest, restDepth };
    // nejlepší díra: zařazená jako závit / pod hlavou, jinak ta s největším objemem v pásmu
    if (!best || rank(side.cls) < rank(best.cls) || (side.cls === best.cls && (side.band ?? 0) > (best.band ?? 0))) best = side;
  }
  return best!;
}
const rank = (c: ClashClass) => ({ thread: 0, underhead: 1, undetermined: 2, real: 3 })[c];

/**
 * Strana dvojice: díry se závitem v dílu `hole` (list `hk`), druhý díl `other` (list `ok`), vzájemná poloha z umístění listů.
 * null = díl nemá závitový prvek (tato strana dvojici nezařadí).
 */
function classifySide(hk: string, holeBody: Shape, holeDoc: CadDoc | null, holeAt: ReturnType<typeof rtOf>, ok: string, otherBody: Shape, otherAt: ReturnType<typeof rtOf>): Side | null {
  const feats = tappedFeatures(holeDoc);
  if (!feats.length) return null;
  const rel = relOf(holeAt, otherAt);
  const key = `${hk}|${ok}|${rel.key}`;
  const hit = sideCache.get(key);
  if (hit) return hit;
  let side: Side;
  const holes = matchTapHoles(feats, holesOf(hk, holeBody, feats));
  if (!holes.length) side = { cls: "real", why: "no-geometry", note: feats.map((f) => f.designation).join(",") };
  else {
    const x = pairIntersection(holeBody, otherBody, rel.m);
    if (!x) side = { cls: "undetermined", why: "kernel-failed" };
    else
      try {
        const raw = subShapes(x, "SOLID") as { delete(): void }[];
        const pieces = raw.map((s) => r.cast(s as never) as Shape);
        try {
          const list = (pieces.length ? pieces : [x]).filter((p) => volumeOf(p) > 1e-6).map((p) => classifyPiece(p, holes));
          // průnik v souřadnicích dílu s dírou vyšel prázdný, ač kontrola kolizí kolizi našla – nedá se rozhodnout
          if (!list.length) side = { cls: "undetermined", why: "kernel-failed" };
          else {
            const cls = worstClass(list.map((s) => s.cls));
            const pick = list.find((s) => s.cls === cls)!;
            const measured = list.filter((s) => s.band !== undefined);
            const sum = (k: "band" | "rest") => measured.reduce((a, s) => a + (s[k] ?? 0), 0);
            side = measured.length ? { ...pick, cls, band: sum("band"), rest: sum("rest"), restDepth: Math.max(...measured.map((s) => s.restDepth ?? 0)) } : { ...pick, cls };
          }
        } finally {
          for (const p of pieces) p.delete();
          for (const q of raw) q.delete();
        }
      } finally {
        x.delete();
      }
  }
  if (sideCache.size >= SIDE_MAX) sideCache.delete(sideCache.keys().next().value!);
  sideCache.set(key, side);
  return side;
}

const pathKey = (p: string[]) => p.join("/");

/**
 * Zařazení dvojic kolizí sestavy `doc` (kap. 6.3). Díra se hledá v obou dílech dvojice (nejdřív ve druhém – v pořadí
 * `interference` je deska obvykle dřív než šroub); bez závitového prvku v obou → `clash.real`.
 */
export async function clashDetail(doc: CadDoc, pairs: readonly ClashPair[]): Promise<ClashDetail[]> {
  const leaves = new Map(flattenAssembly(doc).map((f) => [pathKey(f.path), f]));
  const held = new Map<string, Shape | null>();
  const bodyOf = async (key: string, src: Parameters<typeof partEntry>[1]) => {
    if (!held.has(key)) {
      const e = await partEntry(key, src);
      held.set(key, e.body ? (e.body.clone() as Shape) : null);
    }
    return held.get(key)!;
  };
  const out: ClashDetail[] = [];
  try {
    for (const p of pairs) {
      const A = leaves.get(pathKey(p.aPath ?? [p.a]));
      const B = leaves.get(pathKey(p.bPath ?? [p.b]));
      const base: ClashPair = { a: p.a, b: p.b, volume: p.volume, ...(p.aPath ? { aPath: p.aPath } : {}), ...(p.bPath ? { bPath: p.bPath } : {}) };
      if (!A || !B) {
        out.push({ ...base, cls: "undetermined", why: "missing-component" });
        continue;
      }
      const ba = await bodyOf(A.key, A.comp.source);
      const bb = await bodyOf(B.key, B.comp.source);
      if (!ba || !bb) {
        out.push({ ...base, cls: "undetermined", why: "no-geometry" });
        continue;
      }
      const docOf = (c: typeof A) => (c.comp.source.kind === "part" ? c.comp.source.doc : null);
      const sides: { s: Side; holeIn: "a" | "b" }[] = [];
      const sb = classifySide(B.key, bb, docOf(B), rtOf(B.placement), A.key, ba, rtOf(A.placement));
      if (sb) sides.push({ s: sb, holeIn: "b" });
      if (!sb || sb.cls === "real" || sb.cls === "undetermined") {
        const sa = classifySide(A.key, ba, docOf(A), rtOf(A.placement), B.key, bb, rtOf(B.placement));
        if (sa) sides.push({ s: sa, holeIn: "a" });
      }
      if (!sides.length) {
        out.push({ ...base, cls: "real", why: "no-thread" });
        continue;
      }
      const best = sides.reduce((x, y) => (rank(y.s.cls) < rank(x.s.cls) ? y : x));
      const h = best.s.hole;
      out.push({
        ...base,
        cls: best.s.cls,
        why: best.s.why,
        holeIn: best.holeIn,
        ...(h ? { hole: { designation: h.designation, D: h.D, r: round(h.r), depth: round(h.length), through: h.through } } : {}),
        ...(best.s.band !== undefined ? { band: round(best.s.band) } : {}),
        ...(best.s.rest !== undefined ? { rest: round(best.s.rest) } : {}),
        ...(best.s.restDepth !== undefined && Number.isFinite(best.s.restDepth) ? { restDepth: round(best.s.restDepth) } : {}),
        ...(best.s.note ? { note: best.s.note } : {}),
      });
    }
  } finally {
    for (const b of held.values()) b?.delete();
  }
  return out;
}

const round = (v: number) => Math.round(v * 1e4) / 1e4 + 0;
