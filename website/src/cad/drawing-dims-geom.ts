/**
 * Geometrický výtah tělesa pro Chytré kóty (běží v jádře – web worker / vitest s OpenCascade):
 * válcové, kuželové, toroidní a rovinné plochy s osou, poloměry a rozsahem podél osy, vnější / vnitřní strana.
 * Z něj plánovač (cad/drawing-dims.ts) pozná rotační díl, osazení, zápichy, sražení, zaoblení a díry.
 */
import * as r from "replicad";
import type { Vec3 } from "./types";

export type GAxis = { /** jednotkový směr (největší složka kladná) */ dir: Vec3; /** bod osy nejblíž počátku */ p: Vec3 };
export type GCyl = GAxis & { r: number; t0: number; t1: number; /** vnější plocha (materiál uvnitř) */ ext: boolean; area: number; face: number };
export type GCone = GAxis & { t0: number; t1: number; r0: number; r1: number; ext: boolean; area: number; face: number };
export type GTorus = GAxis & { /** střed (t podél osy) */ t: number; R: number; r: number; area: number; face: number };
export type GPlane = { n: Vec3; c: Vec3; area: number; face: number; /** poloměry kruhových hran (střed, poloměr) */ circles: { c: Vec3; r: number }[] };
export type PartGeom = { bbox: [Vec3, Vec3]; cyls: GCyl[]; cones: GCone[]; tori: GTorus[]; planes: GPlane[]; otherArea: number; faces: number };

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const V = (v: { x: number; y: number; z: number }): Vec3 => [v.x, v.y, v.z];
const pnt = (p: { X(): number; Y(): number; Z(): number }): Vec3 => [p.X(), p.Y(), p.Z()];

/** osa v normálním tvaru: směr s kladnou největší složkou, bod nejblíž počátku */
export function normAxis(loc: Vec3, d: Vec3): GAxis {
  const l = len(d) || 1;
  let dir = mul(d, 1 / l);
  const k = [0, 1, 2].reduce((m, i) => (Math.abs(dir[i]) > Math.abs(dir[m]) ? i : m), 0);
  if (dir[k] < 0) dir = mul(dir, -1);
  dir = dir.map((v) => (Math.abs(v) < 1e-9 ? 0 : v)) as Vec3;
  return { dir, p: sub(loc, mul(dir, dot(loc, dir))) };
}

/** body hran plochy (kruhové hrany: středy a poloměry) */
function edgeInfo(f: r.Face): { pts: Vec3[]; circles: { c: Vec3; r: number; n: Vec3 }[] } {
  const pts: Vec3[] = [];
  const circles: { c: Vec3; r: number; n: Vec3 }[] = [];
  for (const e of f.edges) {
    try {
      const a = V(e.pointAt(0));
      const b = V(e.pointAt(0.5));
      const c = V(e.pointAt(1));
      pts.push(a, b, c);
      if (e.geomType === "CIRCLE") {
        const m = V(e.pointAt(0.25));
        const cc = circumcenter(a, m, b);
        const ab = sub(m, a);
        const ac = sub(b, a);
        const n: Vec3 = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
        if (cc) circles.push({ c: cc, r: len(sub(a, cc)), n: mul(n, 1 / (len(n) || 1)) });
      }
    } catch {
      /* hrana bez geometrie */
    }
  }
  return { pts, circles };
}

function circumcenter(a: Vec3, b: Vec3, c: Vec3): Vec3 | null {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const n: Vec3 = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
  const n2 = dot(n, n);
  if (n2 < 1e-12) return null;
  const cross = (u: Vec3, v: Vec3): Vec3 => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const t1 = mul(cross(n, ab), dot(ac, ac));
  const t2 = mul(cross(ac, n), dot(ab, ab));
  const s = mul([t1[0] + t2[0], t1[1] + t2[1], t1[2] + t2[2]], 1 / (2 * n2));
  return [a[0] + s[0], a[1] + s[1], a[2] + s[2]];
}

const cache = new WeakMap<object, PartGeom>();

/** Geometrický výtah tělesa (s mezipamětí pro totéž těleso). */
export function partGeom(shape: r.Shape3D): PartGeom {
  const hit = cache.get(shape);
  if (hit) return hit;
  const g = partGeomRaw(shape);
  cache.set(shape, g);
  return g;
}

function partGeomRaw(shape: r.Shape3D): PartGeom {
  const bb = shape.boundingBox.bounds as [Vec3, Vec3];
  const out: PartGeom = { bbox: [bb[0], bb[1]], cyls: [], cones: [], tori: [], planes: [], otherArea: 0, faces: 0 };
  let faces: r.Face[] = [];
  try {
    faces = shape.faces;
  } catch {
    return out;
  }
  out.faces = faces.length;
  faces.forEach((f, index) => {
    let area = 0;
    try {
      area = r.measureArea(f);
    } catch {
      /* bez plochy */
    }
    let type = "";
    try {
      type = f.geomType as string;
    } catch {
      out.otherArea += area;
      return;
    }
    try {
      if (type === "PLANE") {
        const { pts, circles } = edgeInfo(f);
        void pts;
        out.planes.push({ n: V(f.normalAt(f.center)), c: V(f.center), area, face: index, circles });
        return;
      }
      if (type !== "CYLINDRE" && type !== "CONE" && type !== "TORUS") {
        out.otherArea += area;
        return;
      }
      const { pts, circles } = edgeInfo(f);
      const mid = V(f.pointOnSurface(0.5, 0.5));
      const nrm = V(f.normalAt(f.pointOnSurface(0.5, 0.5)));
      const radialOf = (ax: GAxis, q: Vec3) => sub(sub(q, ax.p), mul(ax.dir, dot(sub(q, ax.p), ax.dir)));
      if (type === "CYLINDRE") {
        const oc = r.getOC() as unknown as { BRepAdaptor_Surface: new (f: unknown, restr: boolean) => { Cylinder(): never; delete(): void } };
        const ad = new oc.BRepAdaptor_Surface(f.wrapped, false);
        try {
          const cyl = ad.Cylinder() as unknown as { Radius(): number; Axis(): { Location(): never; Direction(): never } };
          const ax = normAxis(pnt(cyl.Axis().Location()), pnt(cyl.Axis().Direction()));
          const ts = pts.map((q) => dot(sub(q, ax.p), ax.dir));
          out.cyls.push({ ...ax, r: cyl.Radius(), t0: Math.min(...ts), t1: Math.max(...ts), ext: dot(radialOf(ax, mid), nrm) > 0, area, face: index });
        } finally {
          ad.delete();
        }
        return;
      }
      // kužel a anuloid: osa a poloměry z kruhových hran (gp_Cone / gp_Torus jádro v prohlížeči nezpřístupňuje)
      // osa podle největší kruhové hrany (švová kružnice anuloidu má jinou osu); souosé hrany s ní
      const ref = circles.reduce<(typeof circles)[number] | null>((m, q) => (!m || q.r > m.r ? q : m), null);
      if (!ref) {
        out.otherArea += area;
        return;
      }
      const ax = normAxis(ref.c, ref.n);
      const tr = circles.filter((q) => Math.abs(Math.abs(dot(q.n, ax.dir)) - 1) < 1e-6).map((q) => ({ t: dot(sub(q.c, ax.p), ax.dir), r: q.r, off: len(radialOf(ax, q.c)) })).filter((q) => q.off <= 1e-3 * (1 + q.r));
      if (tr.length < 2) {
        out.otherArea += area;
        return;
      }
      tr.sort((a, b) => a.t - b.t);
      if (type === "CONE") {
        const ts = pts.map((q) => dot(sub(q, ax.p), ax.dir));
        out.cones.push({ ...ax, t0: Math.min(...ts, tr[0].t), t1: Math.max(...ts, tr[tr.length - 1].t), r0: tr[0].r, r1: tr[tr.length - 1].r, ext: dot(radialOf(ax, mid), nrm) > 0, area, face: index });
      } else {
        const a = tr[0];
        const b = tr[tr.length - 1];
        const rr = (Math.abs(b.t - a.t) + Math.abs(b.r - a.r)) / 2;
        const m = { t: dot(sub(mid, ax.p), ax.dir), r: len(radialOf(ax, mid)) };
        const cands = [{ t: a.t, r: b.r }, { t: b.t, r: a.r }];
        const best = cands.reduce((x, y) => (Math.abs(Math.hypot(m.t - x.t, m.r - x.r) - rr) <= Math.abs(Math.hypot(m.t - y.t, m.r - y.r) - rr) ? x : y));
        out.tori.push({ ...ax, t: best.t, R: best.r, r: rr, area, face: index });
      }
    } catch {
      out.otherArea += area;
    }
  });
  return out;
}
