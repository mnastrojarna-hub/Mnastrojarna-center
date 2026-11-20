/**
 * Kola a ozubení – zuby, které nejsou hranol (šikmé, šípové, šnekové kolo, kuželové, hypoidní): boky JEDNOHO zubu jako
 * záplaty B-spline proložené přesnými body (řady = řezy rovinami z = konst.), z otočených kopií, dvě rovinná víka, sešít
 * do uzavřeného pláště → těleso. Sousední záplaty sdílejí hraniční křivky (stejné body i parametry → shodné B-spliny).
 */
import * as r from "replicad";
import { arcSweep, rot2, TAU } from "../gears/num";
import type { PatchGridData, PatchGroup, Profile2D, Seg2, Vec2 } from "../gears/types";
import { tr } from "../i18n";
import { interpolateCurve } from "../spline-occ";
import { bsplineSurface, curveData, faceOf, interpCurve } from "../surf-geom";
import type { Vec3 } from "../types";
import { seamMerged } from "./gears-kernel";
import type { Shape } from "./registry";

type OC = any;
const oc = (): OC => r.getOC() as OC;

/** mřížka bodů jedné záplaty: `rows[iv][iu]`, parametry v u, volitelně derivace podle u na koncích každé řady */
export type PatchGrid = PatchGridData;

/** body, parametry a koncové derivace jednoho úseku profilu (úsečka 2 body, oblouk podle úhlu, křivka tak, jak je) */
export function segSamples(s: Seg2): { pts: Vec2[]; tu: number[]; d0?: Vec2; d1?: Vec2 } {
  if (s.t === "line") return { pts: [s.a, s.b], tu: [0, 1] };
  if (s.t === "arc") {
    const sw = arcSweep(s);
    const n = Math.max(2, Math.ceil(Math.abs(sw) / 0.12));
    const sg = Math.sign(sw) || 1;
    const at = (a: number): Vec2 => [s.c[0] + s.r * Math.cos(a), s.c[1] + s.r * Math.sin(a)];
    const dv = (a: number): Vec2 => [-sg * s.r * Math.sin(a), sg * s.r * Math.cos(a)];
    return { pts: Array.from({ length: n + 1 }, (_, i) => at(s.a0 + (sw * i) / n)), tu: Array.from({ length: n + 1 }, (_, i) => (Math.abs(sw) * i) / n), d0: dv(s.a0), d1: dv(s.a0 + sw) };
  }
  return { pts: s.pts, tu: s.params, d0: s.d0, d1: s.d1 };
}

/** řez: rovina z a otočení profilu kolem osy Z (rad) */
export type Station = { z: number; rot: number };

/** mřížky záplat jednoho zubu válcového kola: profil otočený v každém řezu (šroubová plocha) */
export function sweepGrids(tooth: Seg2[], stations: Station[]): PatchGrid[] {
  return tooth.map((s) => {
    const q = segSamples(s);
    const row = (st: Station): Vec3[] => q.pts.map((p) => [...rot2(p, st.rot), st.z] as unknown as Vec3);
    const dr = (d: Vec2 | undefined) => (d ? stations.map((st) => [...rot2(d, st.rot), 0] as unknown as Vec3) : undefined);
    return { rows: stations.map(row), tu: q.tu, d0: dr(q.d0), d1: dr(q.d1) };
  });
}

/** záplata: každá řada křivkou v u (s koncovými derivacemi), póly řad proložené ve v; dvě řady = přímková plocha */
export function patchSurface(g: PatchGrid, tv: number[]): OC {
  const n = g.tu.length;
  const rows = g.rows.map((row, j) => {
    const tangents: (Vec3 | null)[] | undefined = g.d0 && g.d1 && n > 2 ? row.map((_, i) => (i === 0 ? g.d0![j] : i === n - 1 ? g.d1![j] : null)) : undefined;
    return curveData(interpCurve(row, g.tu, tangents ? { tangents } : {}));
  });
  const nu = rows[0].poles.length;
  if (rows.some((x) => x.poles.length !== nu)) throw new Error(tr("Řezy plochy nemají stejnou strukturu – zkuste jiný počet bodů."));
  const cols = Array.from({ length: nu }, (_, i) => curveData(interpCurve(rows.map((x) => x.poles[i]), tv)));
  return bsplineSurface(cols.map((c) => c.poles), { knots: rows[0].knots, mults: rows[0].mults, degree: rows[0].degree }, { knots: cols[0].knots, mults: cols[0].mults, degree: cols[0].degree });
}

/** hrana jedné řady mřížky (shodná s okrajem záplaty) */
function rowEdge(g: PatchGrid, j: number, mv: (p: Vec3) => Vec3): r.Edge {
  const n = g.tu.length;
  const pts = g.rows[j].map(mv);
  if (n === 2) return r.makeLine(pts[0], pts[1]);
  const o = mv([0, 0, 0]);
  const dir = (d: Vec3): Vec3 => {
    const q = mv(d);
    return [q[0] - o[0], q[1] - o[1], q[2] - o[2]];
  };
  const tangents: (Vec3 | null)[] | undefined = g.d0 && g.d1 ? pts.map((_, i) => (i === 0 ? dir(g.d0![j]) : i === n - 1 ? dir(g.d1![j]) : null)) : undefined;
  return interpolateCurve(pts, { params: g.tu, ...(tangents ? { tangents } : {}) }).edge;
}

const rotZ = (a: number) => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return (p: Vec3): Vec3 => [c * p[0] - s * p[1], s * p[0] + c * p[1], p[2]];
};

/**
 * Je těleso obrácené (normály dovnitř)? Rovinné víko na nejvyšší rovině z musí mít vnější normálu +Z – levná náhrada
 * znaménka objemu (integrace přes B-splinové boky trvá stovky ms). Bez rovinného horního víka rozhodne objem.
 */
function insideOut(solid: Shape): boolean {
  const o = oc();
  let best = -Infinity;
  let up = 0;
  for (const f of solid.faces) {
    if (f.geomType !== "PLANE") continue;
    const ad = new o.BRepAdaptor_Surface(f.wrapped, true);
    try {
      const ax = ad.Plane().Axis();
      const z = ax.Location().Z();
      if (Math.abs(Math.abs(ax.Direction().Z()) - 1) > 1e-9 || z <= best) continue;
      best = z;
      up = f.normalAt().z; // BRepGProp_Face: normála s ohledem na orientaci plochy
    } finally {
      ad.delete();
    }
  }
  return up === 0 ? r.measureVolume(solid) < 0 : up < 0;
}

/** sešije plochy do uzavřeného pláště a vrátí těleso; hodí chybu, když zůstanou volné hrany */
export function sewSolid(faces: { wrapped: unknown }[], tol = 1e-5): Shape {
  const o = oc();
  const s = new o.BRepBuilderAPI_Sewing(tol, true, true, true, false);
  const fix = new o.ShapeFix_Solid();
  try {
    for (const f of faces) s.Add(f.wrapped);
    s.Perform(new o.Message_ProgressRange());
    const free = Number(s.NbFreeEdges());
    if (free > 0) throw new Error(tr("Plášť ozubení se nepodařilo uzavřít ({0} volných hran) – zkuste mírně změnit rozměry.", free));
    const sewn = r.downcast(s.SewedShape());
    let solid = r.cast(fix.SolidFromShell(sewn)) as Shape;
    if (insideOut(solid)) solid = r.cast(solid.wrapped.Reversed()) as Shape;
    return solid;
  } finally {
    s.delete();
    fix.delete();
  }
}

/** volby tělesa ozubení: otvory ve víkách (díra, odlehčovací díry) se stěnami, nebo vnější válec (věnec s vnitřním ozubením / nástroj zubových mezer) */
export type VolumeOpts = {
  /** dráty otvorů ve víku v rovině z (po směru hodin) – pro obě víka stejné otvory */
  capHoles?: (z: number) => r.Wire[];
  /** stěny otvorů mezi víky (boční plochy hranolů děr) */
  walls?: { wrapped: unknown }[];
  /** vnější válec o tomto poloměru: obrys zubů je pak OTVOR ve víku (mezikruží) */
  outerR?: number;
};

/**
 * Uzavřené těleso ozubení z mřížek jednoho zubu. `groups` = po sobě jdoucí pásy záplat ve směru osy (šípové ozubení má dva,
 * kuželové tři, jinak jeden); každý pás má stejné úseky profilu, první řada pásu = poslední řada předchozího. `count` =
 * počet zubů. Víka jsou rovinná (první a poslední řada leží v rovinách z = konst.).
 */
export function toothVolume(groups: PatchGroup[], count: number, opts: VolumeOpts = {}): Shape {
  const o = oc();
  const faces: { wrapped: unknown }[] = [];
  const gc: { delete(): void }[] = [];
  try {
    for (const grp of groups) {
      for (const g of grp.grids) {
        const f0 = faceOf(patchSurface(g, grp.tv));
        faces.push(f0);
        for (let k = 1; k < count; k++) {
          const trsf = new o.gp_Trsf();
          const ax = new o.gp_Ax1(new o.gp_Pnt(0, 0, 0), new o.gp_Dir(0, 0, 1));
          trsf.SetRotation(ax, (TAU * k) / count);
          const loc = new o.TopLoc_Location(trsf);
          faces.push({ wrapped: f0.wrapped.Moved(loc, false) });
          gc.push(trsf, ax, loc);
        }
      }
    }
    const first = groups[0];
    const last = groups[groups.length - 1];
    const z0 = first.grids[0].rows[0][0][2];
    const z1 = last.grids[0].rows[last.tv.length - 1][0][2];
    const outline = (grp: PatchGroup, j: number, reverse: boolean) => {
      const edges: r.Edge[] = [];
      for (let k = 0; k < count; k++) {
        const mv = rotZ((TAU * k) / count);
        for (const g of grp.grids) edges.push(rowEdge(g, j, mv));
      }
      const w = r.assembleWire(edges);
      return reverse ? reversedWire(w) : w;
    };
    const cap = (grp: PatchGroup, j: number, z: number) => {
      if (opts.outerR) return r.makeFace(ringWire(opts.outerR, z, false), [outline(grp, j, true), ...(opts.capHoles?.(z) ?? [])]);
      return r.makeFace(outline(grp, j, false), opts.capHoles?.(z) ?? []);
    };
    faces.push(cap(first, 0, z0), cap(last, last.tv.length - 1, z1));
    if (opts.outerR) faces.push(...lateralFaces(r.basicFaceExtrusion(r.makeFace(ringWire(opts.outerR, z0, false)), new r.Vector([0, 0, z1 - z0])) as Shape, z0, z1));
    if (opts.walls) faces.push(...opts.walls);
    return sewSolid(faces);
  } finally {
    gc.forEach((x) => x.delete());
  }
}

/** kružnice ze dvou půloblouků v rovině z */
function ringWire(rad: number, z: number, reverse: boolean): r.Wire {
  const at = (a: number): Vec3 => [rad * Math.cos(a), rad * Math.sin(a), z];
  const w = r.assembleWire([r.makeThreePointArc(at(0), at(Math.PI / 2), at(Math.PI)), r.makeThreePointArc(at(Math.PI), at(1.5 * Math.PI), at(0))]);
  return reverse ? reversedWire(w) : w;
}
/** drát s opačnou orientací (otvor v ploše) */
export function reversedWire(w: r.Wire): r.Wire {
  return new r.Wire(r.downcast((w.wrapped as unknown as { Reversed(): never }).Reversed()));
}
/** boční plochy hranolu mezi rovinami z0 a z1 (bez obou vík) */
export function lateralFaces(solid: Shape, z0: number, z1: number): r.Face[] {
  const eps = 1e-6 * Math.max(1, Math.abs(z1 - z0));
  return solid.faces.filter((f) => {
    const [[, , a], [, , b]] = f.boundingBox.bounds;
    return b - a > eps;
  });
}

/** řezy šroubové plochy: z ∈ [z0, z1], zkroucení `tau` (rad/mm) od `zRef`, krok nejvýš `maxStep` (rad) zkroucení, aspoň 4 řezy */
export function helixStations(z0: number, z1: number, tau: number, zRef: number, rot0 = 0, maxStep = 0.05): Station[] {
  const n = Math.max(3, Math.ceil((Math.abs(tau) * (z1 - z0)) / maxStep));
  return Array.from({ length: n + 1 }, (_, i) => {
    const z = i === n ? z1 : z0 + ((z1 - z0) * i) / n;
    return { z, rot: rot0 + tau * (z - zRef) };
  });
}

/** těleso šroubově (nebo přímo) taženého profilu mezi rovinami řezů; `groups` řezů = pásy (šípové: dva se společným středem); oblouk na rozhraní roztečí sloučený (`seamMerged`) */
export function sweptProfileSolid(p: Profile2D, groups: Station[][], opts: VolumeOpts = {}): Shape {
  const q = seamMerged(p);
  return toothVolume(groups.map((st) => ({ grids: sweepGrids(q.tooth, st), tv: st.map((s) => s.z) })), q.count, opts);
}
