/**
 * Vůle mezi komponentami sestavy a spojitá kontrola úseku pohybu v jádře (vlna 22, bod 6 zprávy majitele – „Bez kolizí“ není
 * kontrola provozní vůle). Operace `clearance` (smlouva cad/clearance-types.ts):
 *
 *  - **vzdálenost dvojice** komponent nejvyšší úrovně = nejmenší vzdálenost jejich listových dílů (`BRepExtrema_DistShapeShape`;
 *    těleso uvnitř druhého = `InnerSolution` → 0, tj. průnik). Síto obálek: dvojice listů, jejichž obálky jsou dál než `cutoff`,
 *    se přesně nepočítají (vrací se dolní mez z obálek, `exact: false`). Výsledek dvojice listů závisí jen na dílech a jejich
 *    vzájemné poloze (zaokrouhlené jako u kolizí – `relOf`), proto se pamatuje (opakované kroky s tuhými skupinami se nepočítají znovu);
 *  - **spojitá kontrola úseku čistým posuvem**: je-li vzájemný pohyb B vůči A v úseku jen posuv o vektor v, je dráha B přesně
 *    B ∪ ⋃ hranol(plocha B, v) (každý bod dráhy mimo B leží na hranolu plochy, kterou úsečka zpět k B protne). Vzdálenost A od
 *    souboru hranolů = nejmenší vůle po CELÉ přímé dráze (sonda: nůž 1 mm přes kolík Ø2 mezi polohami 5 mm od sebe → 0; střižník Ø10
 *    ve vedení Ø10,02 po ose → 0,01). A celé uvnitř dráhy (bez dotyku hranic) zachytí úsečka z vrcholu A proti směru posuvu × B;
 *  - **místní obálky** komponent (kvádr a opsaná koule ve vlastních souřadnicích) pro mez posunu mezi polohami (cad/motion-clearance.ts).
 *
 * Všechny objekty OCCT se mažou hned (tělesa dílů z mezipaměti `partEntry` se nemění, B se jen umístí přes TopLoc_Location).
 */
import * as r from "replicad";
import { flattenAssembly, type FlatComponent } from "./assembly";
import { partEntry, relOf, rtOf, type Rt } from "./asm-kernel";
import type { ClrDist, ClrLocal, ClrReq, ClrRes, ClrSweep } from "./clearance-types";
import type { Vec3 } from "./types";

type Shape = r.Shape3D;
type Oc = any;

/* ───────── matice polohy (R po řádcích, posun) ───────── */

const mulR = (a: number[], b: number[]): number[] => {
  const o = new Array<number>(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return o;
};
const apR = (R: number[], v: Vec3): Vec3 => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
const apRT = (R: number[], v: Vec3): Vec3 => [R[0] * v[0] + R[3] * v[1] + R[6] * v[2], R[1] * v[0] + R[4] * v[1] + R[7] * v[2], R[2] * v[0] + R[5] * v[1] + R[8] * v[2]];
const trR = (R: number[]): number[] => [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]];
/** A∘B */
const compose = (A: Rt, B: Rt): Rt => {
  const t = apR(A.R, B.t);
  return { R: mulR(A.R, B.R), t: [t[0] + A.t[0], t[1] + A.t[1], t[2] + A.t[2]] };
};
/** A⁻¹∘B */
const relRt = (A: Rt, B: Rt): Rt => {
  const d: Vec3 = [B.t[0] - A.t[0], B.t[1] - A.t[1], B.t[2] - A.t[2]];
  return { R: mulR(trR(A.R), B.R), t: apRT(A.R, d) };
};
const toWorld = (m: Rt, p: Vec3): Vec3 => {
  const q = apR(m.R, p);
  return [q[0] + m.t[0], q[1] + m.t[1], q[2] + m.t[2]];
};

/* ───────── obálky ───────── */

type Box = [Vec3, Vec3];
const localBoxes = new Map<string, Box>();
function localBox(key: string, body: Shape): Box {
  let b = localBoxes.get(key);
  if (!b) {
    const bb = body.boundingBox;
    b = bb.bounds as Box;
    bb.delete();
    if (localBoxes.size >= 4000) localBoxes.delete(localBoxes.keys().next().value!);
    localBoxes.set(key, b);
  }
  return b;
}
/** světová obálka lokálního kvádru v poloze `m` (8 rohů) */
function worldBox([lo, hi]: Box, m: Rt): Box {
  const out: Box = [
    [Infinity, Infinity, Infinity],
    [-Infinity, -Infinity, -Infinity],
  ];
  for (let c = 0; c < 8; c++) {
    const w = toWorld(m, [c & 1 ? hi[0] : lo[0], c & 2 ? hi[1] : lo[1], c & 4 ? hi[2] : lo[2]]);
    for (let i = 0; i < 3; i++) {
      if (w[i] < out[0][i]) out[0][i] = w[i];
      if (w[i] > out[1][i]) out[1][i] = w[i];
    }
  }
  return out;
}
/** vzdálenost dvou kvádrů (0 = překryv) – dolní mez vzdálenosti těles v nich */
export function boxGap(a: Box, b: Box): number {
  let s = 0;
  for (let i = 0; i < 3; i++) {
    const g = Math.max(0, a[0][i] - b[1][i], b[0][i] - a[1][i]);
    s += g * g;
  }
  return Math.sqrt(s);
}
const grow = (a: Box, b: Box): Box => [
  [Math.min(a[0][0], b[0][0]), Math.min(a[0][1], b[0][1]), Math.min(a[0][2], b[0][2])],
  [Math.max(a[1][0], b[1][0]), Math.max(a[1][1], b[1][1]), Math.max(a[1][2], b[1][2])],
];
const shift = (b: Box, v: Vec3): Box => [
  [b[0][0] + v[0], b[0][1] + v[1], b[0][2] + v[2]],
  [b[1][0] + v[0], b[1][1] + v[1], b[1][2] + v[2]],
];

/* ───────── listy sestavy podle komponent nejvyšší úrovně ───────── */

type Leaf = { key: string; path: string[]; body: Shape; /** poloha listu vůči komponentě nejvyšší úrovně */ rel: Rt; box: Box };
type Top = { id: string; rt0: Rt; leaves: Leaf[] };

async function topsOf(doc: ClrReq["doc"], held: Map<string, Shape>): Promise<Map<string, Top>> {
  const tops = new Map<string, Top>();
  const topPl = new Map((doc.components ?? []).map((c) => [c.id, rtOf(c.placement)] as const));
  const flat: FlatComponent[] = flattenAssembly(doc);
  for (const f of flat) {
    if (f.hidden) continue;
    let body = held.get(f.key);
    if (!body) {
      const e = await partEntry(f.key, f.comp.source);
      if (!e.body) continue;
      body = e.body.clone() as Shape;
      held.set(f.key, body);
    }
    const id = f.path[0];
    const t0 = topPl.get(id);
    if (!t0) continue;
    let top = tops.get(id);
    if (!top) tops.set(id, (top = { id, rt0: t0, leaves: [] }));
    top.leaves.push({ key: f.key, path: f.path, body, rel: relRt(t0, rtOf(f.placement)), box: localBox(f.key, body) });
  }
  return tops;
}

/* ───────── přesné výpočty (mezipaměť podle vzájemné polohy) ───────── */

/** `pen` = objem průniku A s dráhou B (jen u dotyku na dráze – rozliší klouzání po ploše od průchodu tělesem) */
type LocalDist = { d: number; inside: boolean; p1?: Vec3; p2?: Vec3; pen?: number };
const distCache = new Map<string, LocalDist>();
const sweepCache = new Map<string, LocalDist>();
const CACHE_MAX = 20000;
const remember = (m: Map<string, LocalDist>, k: string, v: LocalDist) => {
  if (m.size >= CACHE_MAX) m.delete(m.keys().next().value!);
  m.set(k, v);
};

/** B umístěné vůči A maticí `m` (zaokrouhlená A⁻¹·B z `relOf`) – jen poloha, bez kopie geometrie; volající smaže */
function movedShape(b: Shape, m: number[]): unknown {
  const oc = r.getOC() as Oc;
  const rel = new oc.gp_Trsf();
  rel.SetValues(m[0], m[1], m[2], m[9], m[3], m[4], m[5], m[10], m[6], m[7], m[8], m[11]);
  rel.SetScaleFactor(1);
  const loc = new oc.TopLoc_Location(rel);
  const moved = b.wrapped.Moved(loc, false);
  loc.delete();
  rel.delete();
  return moved;
}

/** nejmenší vzdálenost dvou tvarů OCCT; průnik / těleso uvnitř = 0 */
function extrema(s1: unknown, s2: unknown): LocalDist | null {
  const oc = r.getOC() as Oc;
  const tool = new oc.BRepExtrema_DistShapeShape();
  try {
    tool.LoadS1(s1);
    tool.LoadS2(s2);
    tool.Perform();
    if (!tool.IsDone() || !(tool.NbSolution() > 0)) return null;
    const inside = !!tool.InnerSolution?.();
    const d = inside ? 0 : Math.max(0, tool.Value() as number);
    const a = tool.PointOnShape1(1);
    const b = tool.PointOnShape2(1);
    const out: LocalDist = { d, inside, p1: [a.X(), a.Y(), a.Z()], p2: [b.X(), b.Y(), b.Z()] };
    a.delete();
    b.delete();
    return out;
  } catch {
    return null;
  } finally {
    tool.delete();
  }
}

/** vzdálenost listu B (poloha `m` v souřadnicích A) od listu A – v souřadnicích A */
function leafDist(a: Leaf, b: Leaf, m: number[]): LocalDist | null {
  const moved = movedShape(b.body, m);
  try {
    return extrema(a.body.wrapped, moved);
  } finally {
    (moved as { delete(): void }).delete();
  }
}

/**
 * zmenšení B kolem středu jeho obálky tak, aby se nejvzdálenější bod přiblížil o `ret` [mm] (kopie tvaru – volající smaže);
 * dotyk ploch (klouzání po ploše, čep v díře bez vůle) tím zmizí, skutečný průnik hlubší než `ret` zůstane
 */
function retracted(moved: unknown, box: Box, m: number[], ret: number): unknown | null {
  const oc = r.getOC() as Oc;
  const R = m.slice(0, 9);
  const t: Vec3 = [m[9], m[10], m[11]];
  const lc: Vec3 = [(box[0][0] + box[1][0]) / 2, (box[0][1] + box[1][1]) / 2, (box[0][2] + box[1][2]) / 2];
  const rho = Math.hypot(box[1][0] - lc[0], box[1][1] - lc[1], box[1][2] - lc[2]);
  if (!(rho > ret * 2)) return null;
  const c = apR(R, lc);
  const pc = new oc.gp_Pnt(c[0] + t[0], c[1] + t[1], c[2] + t[2]);
  const tr = new oc.gp_Trsf();
  const mk = (() => {
    try {
      tr.SetScale(pc, 1 - ret / rho);
      return new oc.BRepBuilderAPI_Transform(moved, tr, true);
    } catch {
      return null;
    }
  })();
  try {
    if (!mk || !mk.IsDone()) return null;
    return mk.Shape();
  } catch {
    return null;
  } finally {
    mk?.delete();
    tr.delete();
    pc.delete();
  }
}

/** dotyk ploch bez průniku: zmenšení o tolerance dotyku (C1 – clash-rules.ts, výchozí 0,01 mm) */
const SLIDE_RET = 0.01;

/** hranoly ploch tvaru posunuté o `v` jako jeden složený tvar (volající smaže compound i `parts`) */
function prismCompound(shape: unknown, v: Vec3): { comp: { delete(): void }; parts: { delete(): void }[] } | null {
  const oc = r.getOC() as Oc;
  const vec = new oc.gp_Vec(v[0], v[1], v[2]);
  const builder = new oc.TopoDS_Builder();
  const comp = new oc.TopoDS_Compound();
  const parts: { delete(): void }[] = [];
  const exp = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  try {
    builder.MakeCompound(comp);
    for (; exp.More(); exp.Next()) {
      const mk = new oc.BRepPrimAPI_MakePrism(exp.Current(), vec, false, true);
      try {
        if (mk.IsDone()) {
          const s = mk.Shape();
          builder.Add(comp, s);
          parts.push(s);
        }
      } catch {
        /* plocha bez hranolu (degenerovaná) – stačí ostatní */
      } finally {
        mk.delete();
      }
    }
    if (!parts.length) {
      comp.delete();
      return null;
    }
    return { comp, parts };
  } finally {
    exp.delete();
    builder.delete();
    vec.delete();
  }
}

/** první bod hranice tělesa (vrchol), jinak střed obálky – v souřadnicích tělesa */
function probePoint(body: Shape, box: Box): Vec3 {
  const oc = r.getOC() as Oc;
  const exp = new oc.TopExp_Explorer(body.wrapped, oc.TopAbs_ShapeEnum.TopAbs_VERTEX, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  try {
    if (exp.More()) {
      const v = (r as unknown as { downcast(s: unknown): unknown }).downcast(exp.Current());
      const p = oc.BRep_Tool.Pnt(v);
      const out: Vec3 = [p.X(), p.Y(), p.Z()];
      p.delete();
      (v as { delete(): void }).delete();
      return out;
    }
  } catch {
    /* záložní střed obálky */
  } finally {
    exp.delete();
  }
  return [(box[0][0] + box[1][0]) / 2, (box[0][1] + box[1][1]) / 2, (box[0][2] + box[1][2]) / 2];
}

/**
 * Nejmenší vzdálenost listu A od dráhy listu B posunutého o `v` (vše v souřadnicích A; B v počáteční poloze `m`): hranoly všech
 * ploch B (MakePrism plochy – hranol tělesa jádro neumí spolehlivě) složené do jednoho tvaru; A celé uvnitř dráhy = úsečka
 * z vrcholu A proti směru posuvu protne B. null = výpočet selhal.
 */
function leafSweep(a: Leaf, b: Leaf, m: number[], v: Vec3, touching: boolean): LocalDist | null {
  const oc = r.getOC() as Oc;
  const moved = movedShape(b.body, m) as { delete(): void };
  if (touching) {
    // konce v dotyku: dotyk s dráhou je jistý – rovnou dráha B zmenšeného o toleranci dotyku (viz níže)
    try {
      const sh = retracted(moved, b.box, m, SLIDE_RET);
      if (!sh) return { d: 0, inside: true, pen: Infinity };
      const pr = prismCompound(sh, v);
      try {
        const h2 = pr ? extrema(a.body.wrapped, pr.comp) : null;
        if (!h2) return null;
        const slide = h2.d > 1e-7;
        return { d: 0, inside: !slide, pen: slide ? 0 : Infinity, ...(h2.p1 ? { p1: h2.p1 } : {}), ...(h2.p2 ? { p2: h2.p2 } : {}) };
      } finally {
        if (pr) {
          for (const x of pr.parts) x.delete();
          pr.comp.delete();
        }
        (sh as { delete(): void }).delete();
      }
    } finally {
      moved.delete();
    }
  }
  const pc = prismCompound(moved, v);
  try {
    if (!pc) return null;
    const hit = extrema(a.body.wrapped, pc.comp);
    if (!hit) return null;
    // Konce úseku bez dotyku: dotyk s dráhou = kontakt mezi polohami (volající najde polohu půlením). Konce v dotyku (díl klouže
    // po ploše, čep v díře bez vůle) řeší větev výše: rozhodne dráha B zmenšeného o toleranci dotyku – bez dotyku = jen klouzání
    // (pen 0), s dotykem = B do A zajede hlouběji (pen ∞). Objem průniku s hranoly ploch se nepoužívá: hranol zakřivené plochy
    // je pro OCCT „těleso“ s nulovým objemem a průnik s ním vrací nesmysl (sonda S/w22/c/C2/probe/probe2.mjs).
    if (hit.d <= 1e-9) return { ...hit, pen: Infinity };
    // A celé uvnitř dráhy B: bod hranice A, ze kterého úsečka proti směru posuvu protne B
    const p = probePoint(a.body, a.box);
    const p0 = new oc.gp_Pnt(p[0], p[1], p[2]);
    const p1 = new oc.gp_Pnt(p[0] - v[0], p[1] - v[1], p[2] - v[2]);
    const mkE = new oc.BRepBuilderAPI_MakeEdge(p0, p1);
    try {
      const e = mkE.Edge();
      const seg = extrema(e, moved);
      e.delete();
      if (seg && seg.d < 1e-7) return { d: 0, inside: true, p1: p, p2: p, pen: Infinity };
    } catch {
      /* bez úsečky – výsledek hranolů */
    } finally {
      mkE.delete();
      p0.delete();
      p1.delete();
    }
    return hit;
  } finally {
    if (pc) {
      for (const s of pc.parts) s.delete();
      pc.comp.delete();
    }
    moved.delete();
  }
}

/**
 * Smí se dráha listu při posuvu ve směru `dir` (souřadnice listu) počítat hranoly jeho ploch? Hranice dráhy tvoří plocha, její posunutá
 * kopie, dráhy hran a dráhy SILUET – bodů plochy, kde je normála kolmá na směr posuvu. Rovina (normála stálá) a válec / kužel /
 * vytažená plocha s osou ve směru posuvu siluetu uvnitř plochy nemají (hranoly ploch dráhu vystihnou přesně); válec napříč
 * pohybu (kolík, kterým projíždí nůž) siluetu uvnitř plochy má – hranoly ploch by ji vynechaly a vůle vyšla větší (kolo 6: 1,03 mm
 * místo 0,03 mm). Výsledek se pamatuje podle listu a směru.
 */
const safeCache = new Map<string, boolean>();
function sweepSafe(leaf: Leaf, dir: Vec3): boolean {
  const l = Math.hypot(dir[0], dir[1], dir[2]);
  if (!(l > 1e-12)) return true;
  const u: Vec3 = [dir[0] / l, dir[1] / l, dir[2] / l];
  const key = `${leaf.key}|${u.map((x) => Math.round(x * 1e6)).join(",")}`;
  const hit = safeCache.get(key);
  if (hit !== undefined) return hit;
  const oc = r.getOC() as Oc;
  const T = oc.GeomAbs_SurfaceType;
  const along = (d: { X(): number; Y(): number; Z(): number }) => {
    const c = [d.Y() * u[2] - d.Z() * u[1], d.Z() * u[0] - d.X() * u[2], d.X() * u[1] - d.Y() * u[0]];
    return Math.hypot(c[0], c[1], c[2]) < 1e-7;
  };
  let safe = true;
  const exp = new oc.TopExp_Explorer(leaf.body.wrapped, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  try {
    for (; exp.More() && safe; exp.Next()) {
      let ad: any = null;
      try {
        ad = new oc.BRepAdaptor_Surface(oc.TopoDS.Face(exp.Current()), true);
        const t = ad.GetType();
        if (t === T.GeomAbs_Plane) continue;
        if (t === T.GeomAbs_Cylinder || t === T.GeomAbs_Cone) {
          const g = t === T.GeomAbs_Cylinder ? ad.Cylinder() : ad.Cone();
          const ax = g.Axis();
          const d = ax.Direction();
          safe = along(d);
          d.delete();
          ax.delete();
          g.delete();
          continue;
        }
        if (t === T.GeomAbs_SurfaceOfExtrusion) {
          const d = ad.Direction();
          safe = along(d);
          d.delete();
          continue;
        }
        safe = false; // koule, anuloid, B-spline …: silueta uvnitř plochy možná
      } catch {
        safe = false;
      } finally {
        ad?.delete();
      }
    }
  } finally {
    exp.delete();
  }
  if (safeCache.size >= 4000) safeCache.delete(safeCache.keys().next().value!);
  safeCache.set(key, safe);
  return safe;
}

/** matice 12 čísel [R po řádcích, t] → body: R·p + t */
const ap12 = (m: number[], p: Vec3): Vec3 => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[9], m[3] * p[0] + m[4] * p[1] + m[5] * p[2] + m[10], m[6] * p[0] + m[7] * p[1] + m[8] * p[2] + m[11]];
/** inverze matice 12 čísel (tuhý pohyb) */
const inv12 = (m: number[]): number[] => {
  const Rt = [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
  const t = [m[9], m[10], m[11]];
  return [...Rt, -(Rt[0] * t[0] + Rt[1] * t[1] + Rt[2] * t[2]), -(Rt[3] * t[0] + Rt[4] * t[1] + Rt[5] * t[2]), -(Rt[6] * t[0] + Rt[7] * t[1] + Rt[8] * t[2])];
};

/**
 * Dráha posuvu dvojice listů v tom pořadí, ve kterém ji hranoly ploch vystihnou (kolo 6): dráha B vůči A, není-li B bezpečné
 * (`sweepSafe`) dráha A posunutého o −v vůči B (výsledek zpět do souřadnic A), jinak – obě nebezpečné – null (rozhodne půlení
 * u volajícího; žádné „spojitě“ z neúplné dráhy). Dřív jen dráha B: nůž × kolík 1,03 mm, kolík × nůž 0,03 mm.
 */
function leafSweepAny(a: Leaf, b: Leaf, m: number[], v: Vec3, touching: boolean): LocalDist | null {
  if (sweepSafe(b, apRT(m.slice(0, 9), v))) return leafSweep(a, b, m, v, touching);
  if (!sweepSafe(a, v)) return null;
  const mi = inv12(m); // A v souřadnicích B
  const vB = apR(mi.slice(0, 9), [-v[0], -v[1], -v[2]]); // posuv A vůči B v souřadnicích B
  const h = leafSweep(b, a, mi, vB, touching);
  if (!h) return null;
  // body zpět do souřadnic A a do pořadí dvojice (p1 na A, p2 na B)
  return { d: h.d, inside: h.inside, ...(h.pen !== undefined ? { pen: h.pen } : {}), ...(h.p2 ? { p1: ap12(m, h.p2) } : {}), ...(h.p1 ? { p2: ap12(m, h.p1) } : {}) };
}

/**
 * Poloha minima vzdálenosti na přímé dráze (kolo 6, `locate`): f(s) = vzdálenost A a B posunutého o s·v, s ∈ ⟨0, 1⟩ – vzorky po
 * 1/16 a zlatý řez kolem nejmenšího. Vrací zlomek `s` a body A a B v té poloze (souřadnice A).
 */
function locateMin(a: Leaf, b: Leaf, m: number[], v: Vec3): { s: number; d: number; p1?: Vec3; p2?: Vec3 } | null {
  const at = (s: number) => {
    const ms = [...m];
    ms[9] += s * v[0];
    ms[10] += s * v[1];
    ms[11] += s * v[2];
    return leafDist(a, b, ms);
  };
  const N = 16;
  let best: { s: number; h: LocalDist } | null = null;
  for (let j = 0; j <= N; j++) {
    const h = at(j / N);
    if (h && (!best || h.d < best.h.d)) best = { s: j / N, h };
  }
  if (!best) return null;
  let lo = Math.max(0, best.s - 1 / N);
  let hi = Math.min(1, best.s + 1 / N);
  const g = (Math.sqrt(5) - 1) / 2;
  let x1 = hi - g * (hi - lo);
  let x2 = lo + g * (hi - lo);
  let f1 = at(x1);
  let f2 = at(x2);
  for (let it = 0; it < 24 && hi - lo > 1e-6; it++) {
    if ((f1?.d ?? Infinity) <= (f2?.d ?? Infinity)) {
      hi = x2;
      x2 = x1;
      f2 = f1;
      x1 = hi - g * (hi - lo);
      f1 = at(x1);
    } else {
      lo = x1;
      x1 = x2;
      f1 = f2;
      x2 = lo + g * (hi - lo);
      f2 = at(x2);
    }
    for (const [x, f] of [[x1, f1], [x2, f2]] as const) if (f && f.d < best.h.d) best = { s: x, h: f };
  }
  return { s: best.s, d: best.h.d, ...(best.h.p1 ? { p1: best.h.p1 } : {}), ...(best.h.p2 ? { p2: best.h.p2 } : {}) };
}

/* ───────── operace ───────── */

const ROT_EPS = 1e-9;

/** Operace jádra `clearance` (viz hlavička modulu). */
export async function clearance(req: ClrReq): Promise<ClrRes> {
  const held = new Map<string, Shape>();
  const out: ClrRes = {};
  try {
    const tops = await topsOf(req.doc, held);
    const poses = req.poses ?? [];
    /** poloha komponenty nejvyšší úrovně v poloze `j` */
    const topAt = (t: Top, j: number): Rt => {
      const p = j > 0 ? poses[j - 1]?.[t.id] : undefined;
      return p ? rtOf(p) : t.rt0;
    };
    const leafAt = (t: Top, l: Leaf, j: number): Rt => compose(topAt(t, j), l.rel);
    if (req.local) {
      out.local = {};
      for (const id of req.local) {
        const t = tops.get(id);
        if (!t?.leaves.length) {
          out.local[id] = null;
          continue;
        }
        let box: Box | null = null;
        for (const l of t.leaves) {
          const b = worldBox(l.box, l.rel);
          box = box ? grow(box, b) : b;
        }
        const c: Vec3 = [(box![0][0] + box![1][0]) / 2, (box![0][1] + box![1][1]) / 2, (box![0][2] + box![1][2]) / 2];
        const rr = Math.hypot(box![1][0] - c[0], box![1][1] - c[1], box![1][2] - c[2]);
        out.local[id] = { box: box!, c, r: rr } satisfies ClrLocal;
      }
    }
    if (req.dist) {
      out.dist = req.dist.map((q): ClrDist => {
        const A = tops.get(q.a);
        const B = tops.get(q.b);
        if (!A?.leaves.length || !B?.leaves.length) return { d: Infinity, exact: false };
        const cutoff = q.cutoff ?? Infinity;
        // dvojice listů podle vzdálenosti obálek; přesně jen ty, které mohou zlepšit dosavadní minimum a jsou pod `cutoff`
        const cand: { la: Leaf; lb: Leaf; ma: Rt; mb: Rt; g: number }[] = [];
        for (const la of A.leaves)
          for (const lb of B.leaves) {
            const ma = leafAt(A, la, q.pose);
            const mb = leafAt(B, lb, q.pose);
            cand.push({ la, lb, ma, mb, g: boxGap(worldBox(la.box, ma), worldBox(lb.box, mb)) });
          }
        cand.sort((x, y) => x.g - y.g);
        let best: ClrDist = { d: cand[0].g, exact: false };
        let found = false;
        for (const c of cand) {
          if (found && c.g >= best.d) break;
          if (c.g > cutoff) break;
          const rel = relOf(c.ma, c.mb);
          const key = `${c.la.key}|${c.lb.key}|${rel.key}`;
          let hit = distCache.get(key);
          if (hit === undefined) {
            const h = leafDist(c.la, c.lb, rel.m);
            if (!h) continue;
            hit = h;
            remember(distCache, key, hit);
          }
          if (!found || hit.d < best.d) {
            found = true;
            best = { d: hit.d, exact: true, ...(hit.inside ? { inside: true } : {}), ...(hit.p1 ? { p1: toWorld(c.ma, hit.p1) } : {}), ...(hit.p2 ? { p2: toWorld(c.ma, hit.p2) } : {}), aPath: c.la.path, bPath: c.lb.path };
          }
          if (best.d <= 0) break;
        }
        // nic přesně: nejbližší obálka nad `cutoff` je dolní mez
        if (!found) best = { d: cand[0].g, exact: false };
        return best;
      });
    }
    if (req.sweep) {
      out.sweep = req.sweep.map((q): ClrSweep => {
        const A = tops.get(q.a);
        const B = tops.get(q.b);
        if (!A?.leaves.length || !B?.leaves.length) return { d: Infinity, exact: false, ok: false };
        // vzájemný pohyb B vůči A v úseku: čistý posuv (stejné natočení na obou koncích)?
        const r0 = relRt(topAt(A, q.from), topAt(B, q.from));
        const r1 = relRt(topAt(A, q.to), topAt(B, q.to));
        if (r0.R.some((v, i) => Math.abs(v - r1.R[i]) > ROT_EPS)) return { d: NaN, exact: false, ok: false };
        const vA: Vec3 = [r1.t[0] - r0.t[0], r1.t[1] - r0.t[1], r1.t[2] - r0.t[2]];
        const aw = topAt(A, q.from);
        const vW = apR(aw.R, vA); // posuv B vůči A ve světě (A v poloze `from`)
        const cutoff = q.cutoff ?? Infinity;
        let best: ClrSweep | null = null;
        let bestLeaf: { la: Leaf; lb: Leaf; m: number[]; v: Vec3; ma: Rt } | null = null;
        const cand: { la: Leaf; lb: Leaf; ma: Rt; mb: Rt; g: number }[] = [];
        for (const la of A.leaves)
          for (const lb of B.leaves) {
            const ma = leafAt(A, la, q.from);
            const mb = leafAt(B, lb, q.from);
            const bw = worldBox(lb.box, mb);
            cand.push({ la, lb, ma, mb, g: boxGap(worldBox(la.box, ma), grow(bw, shift(bw, vW))) });
          }
        cand.sort((x, y) => x.g - y.g);
        for (const c of cand) {
          // dotyk bez průniku: ostatní dvojice listů v dosahu dotyku se musí projít také (průnik může být jinde)
          if (best && c.g >= best.d && !(best.d <= 1e-9 && c.g <= 1e-9)) break;
          if (c.g > cutoff) break;
          const rel = relOf(c.ma, c.mb);
          const vL = apRT(c.ma.R, vW); // posuv v souřadnicích listu A
          const key = `${c.la.key}|${c.lb.key}|${rel.key}|${vL.map((x) => Math.round(x * 1e7)).join(",")}|${q.touch ? 1 : 0}`;
          let hit = sweepCache.get(key);
          if (hit === undefined) {
            // pořadí, ve kterém hranoly ploch dráhu vystihnou (kolo 6: válec napříč pohybu – silueta uvnitř plochy)
            const h = leafSweepAny(c.la, c.lb, rel.m, vL, !!q.touch);
            if (!h) return { d: NaN, exact: false, ok: false, v: vW }; // dráhu nešlo spočítat – rozhodne půlení
            hit = h;
            remember(sweepCache, key, hit);
          }
          if (!best || hit.d < best.d || (hit.d <= 1e-9 && (hit.pen ?? 0) > (best.pen ?? 0))) {
            best = { d: hit.d, exact: true, ok: true, v: vW, ...(hit.inside ? { inside: true } : {}), ...(hit.pen !== undefined ? { pen: hit.pen } : {}), ...(hit.p1 ? { p1: toWorld(c.ma, hit.p1) } : {}), ...(hit.p2 ? { p2: toWorld(c.ma, hit.p2) } : {}), aPath: c.la.path, bPath: c.lb.path };
            bestLeaf = { la: c.la, lb: c.lb, m: rel.m, v: vL, ma: c.ma };
          }
          if (best.d <= 0 && (best.pen ?? Infinity) > 1e-3) break; // průchod tělesem – víc není třeba
        }
        // poloha minima na dráze a body A a B v ní (vůle mezi kroky: „mezi kroky 17 a 18 (poloha 17,52; t = …)“ – kolo 6)
        if (q.locate && best && bestLeaf && best.d > 1e-9 && Number.isFinite(best.d)) {
          const L = locateMin(bestLeaf.la, bestLeaf.lb, bestLeaf.m, bestLeaf.v);
          // body ve světě v dohledané poloze: A se v úseku posune o s·ΔA (bez natočení); s natočením A jen poloha, body z dráhy
          const a0 = topAt(A, q.from);
          const a1 = topAt(A, q.to);
          const turn = a0.R.some((x, i) => Math.abs(x - a1.R[i]) > ROT_EPS);
          if (L) {
            const sh: Vec3 = [(a1.t[0] - a0.t[0]) * L.s, (a1.t[1] - a0.t[1]) * L.s, (a1.t[2] - a0.t[2]) * L.s];
            const w = (p: Vec3): Vec3 => {
              const q2 = toWorld(bestLeaf!.ma, p);
              return [q2[0] + sh[0], q2[1] + sh[1], q2[2] + sh[2]];
            };
            best = { ...best, s: L.s, ...(!turn && L.p1 ? { p1: w(L.p1) } : {}), ...(!turn && L.p2 ? { p2: w(L.p2) } : {}) };
          }
        }
        return best ?? { d: cand[0]?.g ?? Infinity, exact: false, ok: true, v: vW };
      });
    }
  } finally {
    for (const b of held.values()) b.delete();
  }
  return out;
}

/** Vyprázdní mezipaměti vůle (testy; po restartu jádra je modul nový). */
export function clearClearanceCache(): void {
  distCache.clear();
  sweepCache.clear();
  safeCache.clear();
  localBoxes.clear();
}
