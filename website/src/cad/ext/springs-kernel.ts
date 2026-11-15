/**
 * Pružiny v jádře (OpenCascade přes replicad): kruhový průřez drátu tažený po střednici z `cad/springs` (B-spline hrana na úsek
 * proložená body s přesnými derivacemi), broušené konce = průnik s deskou 0 ≤ z ≤ L (rovinné plochy kolmé na osu), talířové
 * pružiny = rotační průřezy. Vše v souřadnicích prvku (osa +Z), natočení do osy a posun do bodu dělá `placeSpring`.
 */
import * as r from "replicad";
import { tr } from "../i18n";
import { isValidShape } from "../check";
import { interpolateCurve } from "../spline-occ";
import { coilDeriv, coilPoint, discSection, TRANSITION, type CoilSpec, type PathPiece, type SpringPieces } from "../springs";
import type { Vec3 } from "../types";
import type { Shape } from "./registry";

const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/**
 * Kusy dráhy tlačné pružiny: úseky se stálým stoupáním (závěrné závity, činné závity) jako přesná šroubovice jádra
 * (`helix`), přechody stoupání jako B-spline (12 bodů na úsek s derivacemi podle parametru 0…1).
 */
export function compressionPieces(s: CoilSpec): (PathPiece & { helix?: { a: number; b: number; pitch: number } })[] {
  const total = s.n + 2 * s.ne;
  const h = TRANSITION / 2;
  const cuts = s.ne > 0 ? [0, s.ne - h, s.ne + h, total - s.ne - h, total - s.ne + h, total] : [0, total];
  const out: (PathPiece & { helix?: { a: number; b: number; pitch: number } })[] = [];
  for (let i = 1; i < cuts.length; i++) {
    const a = 2 * Math.PI * cuts[i - 1];
    const b = 2 * Math.PI * cuts[i];
    if (b - a < 1e-9) continue;
    const transition = s.ne > 0 && (i === 2 || i === 4);
    if (!transition) {
      const pitch = s.ne > 0 && i !== 3 ? s.pe : s.pa;
      out.push({ pts: [coilPoint(s, a), coilPoint(s, b)], ders: [coilDeriv(s, a), coilDeriv(s, b)], helix: { a, b, pitch } });
      continue;
    }
    out.push(bsplinePiece(s, a, b));
  }
  return out;
}

function bsplinePiece(s: CoilSpec, a: number, b: number): PathPiece {
  const m = 12;
  const pts: Vec3[] = [];
  const ders: Vec3[] = [];
  for (let i = 0; i <= m; i++) {
    const t = a + ((b - a) * i) / m;
    pts.push(coilPoint(s, t));
    const dv = coilDeriv(s, t);
    ders.push([dv[0] * (b - a), dv[1] * (b - a), dv[2] * (b - a)]);
  }
  return { pts, ders };
}

/** přesná šroubovice jádra se stálým stoupáním od úhlu a do b (střednice podle `coilPoint`) */
function helixEdge(s: CoilSpec, hx: { a: number; b: number; pitch: number }): r.Edge {
  const height = (hx.pitch * (hx.b - hx.a)) / (2 * Math.PI);
  const w = r.makeHelix(hx.pitch, height, s.R, [0, 0, 0], [0, 0, 1], s.hand < 0);
  const z0 = coilPoint(s, hx.a)[2];
  return w.rotate((s.hand * hx.a * 180) / Math.PI, [0, 0, 0], [0, 0, 1]).translate([0, 0, z0]) as unknown as r.Edge;
}

/** Drát (kruh průměru d) tažený po kusech dráhy; konce kusů, které se míjejí o < 1e-6 mm, se sjednotí. */
export function sweepWire(pieces: (PathPiece & { helix?: { a: number; b: number; pitch: number } })[], d: number, spec?: CoilSpec): Shape {
  if (!pieces.length) throw new Error(tr("Pružina nemá dráhu drátu."));
  const edges: r.Edge[] = [];
  let prevEnd: Vec3 | null = null;
  for (const p of pieces) {
    const pts = p.pts.map((x) => [...x] as Vec3);
    if (p.helix && spec) {
      edges.push(helixEdge(spec, p.helix));
      prevEnd = pts[pts.length - 1];
      continue;
    }
    if (prevEnd && Math.hypot(pts[0][0] - prevEnd[0], pts[0][1] - prevEnd[1], pts[0][2] - prevEnd[2]) < 1e-6) pts[0] = prevEnd;
    if (p.line || pts.length === 2) edges.push(r.makeLine(pts[0], pts[pts.length - 1]));
    else {
      const k = pts.length - 1;
      edges.push(interpolateCurve(pts, { tangents: p.ders, params: pts.map((_, i) => i / k) }).edge);
    }
    prevEnd = pts[pts.length - 1];
  }
  const spine = r.assembleWire(edges);
  const start = pieces[0].pts[0];
  const t0 = unit(pieces[0].ders[0]);
  const profile = r.assembleWire([r.makeCircle(d / 2, start, t0)]);
  const s = r.genericSweep(profile, spine, { transitionMode: "right" }, false) as Shape;
  if (!(r.measureVolume(s) > 0)) throw new Error(tr("Drát pružiny se nepodařilo vytáhnout po dráze."));
  return s;
}

/**
 * Tlačná pružina v souřadnicích prvku: tažení + broušené konce. Broušení = průnik s deskou 0 ≤ z ≤ L jen u KONCOVÝCH úseků
 * (závěrné závity, krátké tažení), střed pružiny se booleovskou operací nedotkne – plochy se pak sešijí do jednoho tělesa
 * (u n = 20 zhruba 2× rychlejší než průnik celé pružiny). Nepovede-li se sešití, použije se průnik celé pružiny.
 */
export function compressionSolid(s: CoilSpec): Shape {
  const pieces = compressionPieces(s);
  if (!s.ground) return sweepWire(pieces, s.d, s);
  const B = s.R * 2 + s.d * 4;
  const slab = () => r.makeBaseBox(2 * B, 2 * B, s.L) as Shape;
  if (pieces.length >= 3) {
    try {
      const first = pieces[0];
      const last = pieces[pieces.length - 1];
      const j1 = first.pts[first.pts.length - 1];
      const j2 = last.pts[0];
      const e1 = sweepWire([first], s.d, s).intersect(slab()) as Shape;
      const e2 = sweepWire([last], s.d, s).intersect(slab()) as Shape;
      const mid = sweepWire(pieces.slice(1, -1), s.d, s);
      const tol = Math.max(1e-5, s.d * 1e-5);
      const cap = (f: r.Face, j: Vec3) => f.geomType === "PLANE" && Math.hypot(f.center.x - j[0], f.center.y - j[1], f.center.z - j[2]) < tol;
      const faces = [...e1.faces.filter((f) => !cap(f, j1)), ...mid.faces.filter((f) => !cap(f, j1) && !cap(f, j2)), ...e2.faces.filter((f) => !cap(f, j2))];
      const solid = r.makeSolid(faces) as unknown as Shape;
      if (isValidShape(solid) && r.measureVolume(solid) > 0) return solid;
    } catch {
      /* sešití se nepovedlo – průnik celé pružiny */
    }
  }
  return sweepWire(pieces, s.d, s).intersect(slab()) as Shape;
}

export const piecesSolid = (sp: SpringPieces): Shape => sweepWire(sp.pieces, sp.d);

/** Sloupec talířových pružin: `ns` talířů střídavě, v každém `np` talířů v sobě; od z = 0. */
export function discStackSolid(o: { De: number; Di: number; t: number; h0: number; ns: number; np: number }): Shape {
  let acc: Shape | null = null;
  let z = 0;
  for (let i = 0; i < o.ns; i++) {
    const up = i % 2 === 0;
    for (let j = 0; j < o.np; j++) {
      const prof = discSection({ De: o.De, Di: o.Di, t: o.t, h0: o.h0, z: z + j * o.t, up });
      let pen = r.draw(prof[0]);
      for (const p of prof.slice(1)) pen = pen.lineTo(p);
      const disc = pen.close().sketchOnPlane("XZ").revolve([0, 0, 1]) as Shape;
      acc = acc ? (acc.fuse(disc) as Shape) : disc;
    }
    z += o.h0 + o.np * o.t;
  }
  if (!acc) throw new Error(tr("Sloupec talířových pružin je prázdný."));
  return acc;
}

/** Natočení z osy +Z do `axis` a posun do `at`. */
export function placeSpring(s: Shape, axis: Vec3, at: Vec3): Shape {
  const a = unit(axis);
  let out = s;
  const c = a[2];
  if (c < 1 - 1e-12) {
    if (c < -1 + 1e-12) out = out.rotate(180, [0, 0, 0], [1, 0, 0]) as Shape;
    else {
      const ax: Vec3 = [-a[1], a[0], 0]; // Z × a
      out = out.rotate((Math.acos(c) * 180) / Math.PI, [0, 0, 0], ax) as Shape;
    }
  }
  if (at[0] || at[1] || at[2]) out = out.translate(at) as Shape;
  return out;
}
