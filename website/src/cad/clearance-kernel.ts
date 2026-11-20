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

/** objem tvaru (0 při selhání) */
function volumeOf(s: unknown): number {
  const oc = r.getOC() as Oc;
  const props = new oc.GProp_GProps();
  try {
    oc.BRepGProp.VolumeProperties(s, props, false, false, false);
    return Math.abs(props.Mass() as number);
  } catch {
    return 0;
  } finally {
    props.delete();
  }
}

/** objem průniku A ∩ T (T = hranol plochy); selhání booleovské operace = NaN */
function commonVolume(a: unknown, t: unknown): number {
  const oc = r.getOC() as Oc;
  const args = new oc.NCollection_List_TopoDS_Shape();
  const tools = new oc.NCollection_List_TopoDS_Shape();
  const op = new oc.BRepAlgoAPI_Common();
  try {
    args.Append(a);
    tools.Append(t);
    op.SetArguments(args);
    op.SetTools(tools);
    op.SetNonDestructive(true);
    op.Build();
    if (op.HasErrors() || !op.IsDone()) return NaN;
    const res = op.Shape();
    try {
      return volumeOf(res);
    } finally {
      res.delete();
    }
  } catch {
    return NaN;
  } finally {
    op.Clear();
    op.delete();
    tools.delete();
    args.delete();
  }
}

/** objem průniku menší než tento = dotyk (stejný práh jako kolize – asm-kernel.ts `interference`) */
const PEN_TOL = 1e-3;

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
function leafSweep(a: Leaf, b: Leaf, m: number[], v: Vec3): LocalDist | null {
  const oc = r.getOC() as Oc;
  const moved = movedShape(b.body, m) as { delete(): void };
  const vec = new oc.gp_Vec(v[0], v[1], v[2]);
  const builder = new oc.TopoDS_Builder();
  const comp = new oc.TopoDS_Compound();
  const parts: { delete(): void }[] = [];
  const exp = new oc.TopExp_Explorer(moved, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  try {
    builder.MakeCompound(comp);
    let n = 0;
    for (; exp.More(); exp.Next()) {
      const mk = new oc.BRepPrimAPI_MakePrism(exp.Current(), vec, false, true);
      try {
        if (mk.IsDone()) {
          const s = mk.Shape();
          builder.Add(comp, s);
          parts.push(s);
          n++;
        }
      } catch {
        /* plocha bez hranolu (degenerovaná) – stačí ostatní */
      } finally {
        mk.delete();
      }
    }
    if (!n) return null;
    const hit = extrema(a.body.wrapped, comp);
    if (!hit) return null;
    if (hit.d <= 1e-9) {
      // dotyk s dráhou: klouzání po ploše (objem průniku 0) × průchod tělesem – objem A ∩ hranol u hranolů, které se A dotýkají
      // (hranol plochy rovnoběžné s posuvem je plochý a objem nemá; průnik s B v počáteční poloze hlásí kontrola kroku)
      let pen = 0;
      for (const prism of parts) {
        if (volumeOf(prism) < 1e-9) continue;
        const near = extrema(a.body.wrapped, prism);
        if (!near || near.d > 1e-9) continue;
        const v = commonVolume(a.body.wrapped, prism);
        if (!Number.isFinite(v)) return { ...hit, pen: Infinity }; // nejde rozhodnout – volající půlí
        pen += v;
        if (pen > PEN_TOL) break;
      }
      return { ...hit, inside: pen > PEN_TOL, pen };
    }
    if (hit.d > 1e-9) {
      // A celé uvnitř dráhy B: bod hranice A, ze kterého úsečka proti směru posuvu protne B
      const p = probePoint(a.body, a.box);
      const p0 = new oc.gp_Pnt(p[0], p[1], p[2]);
      const p1 = new oc.gp_Pnt(p[0] - v[0], p[1] - v[1], p[2] - v[2]);
      const mkE = new oc.BRepBuilderAPI_MakeEdge(p0, p1);
      try {
        const e = mkE.Edge();
        const seg = extrema(e, moved);
        e.delete();
        if (seg && seg.d < 1e-7) return { d: 0, inside: true, p1: p, p2: p };
      } catch {
        /* bez úsečky – výsledek hranolů */
      } finally {
        mkE.delete();
        p0.delete();
        p1.delete();
      }
    }
    return hit;
  } finally {
    exp.delete();
    for (const s of parts) s.delete();
    comp.delete();
    builder.delete();
    vec.delete();
    moved.delete();
  }
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
          const key = `${c.la.key}|${c.lb.key}|${rel.key}|${vL.map((x) => Math.round(x * 1e7)).join(",")}`;
          let hit = sweepCache.get(key);
          if (hit === undefined) {
            const h = leafSweep(c.la, c.lb, rel.m, vL);
            if (!h) return { d: NaN, exact: false, ok: false, v: vW }; // dráhu nešlo spočítat – rozhodne půlení
            hit = h;
            remember(sweepCache, key, hit);
          }
          if (!best || hit.d < best.d || (hit.d <= 1e-9 && (hit.pen ?? 0) > (best.pen ?? 0)))
            best = { d: hit.d, exact: true, ok: true, v: vW, ...(hit.inside ? { inside: true } : {}), ...(hit.pen !== undefined ? { pen: hit.pen } : {}), ...(hit.p1 ? { p1: toWorld(c.ma, hit.p1) } : {}), ...(hit.p2 ? { p2: toWorld(c.ma, hit.p2) } : {}), aPath: c.la.path, bPath: c.lb.path };
          if (best.d <= 0 && (best.pen ?? Infinity) > PEN_TOL) break;
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
  localBoxes.clear();
}
