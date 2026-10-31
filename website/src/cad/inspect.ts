/**
 * Dotazy na topologii tělesa (worker): informace o ploše/hraně/bodu/tělese a měření mezi entitami
 * (vzdálenost přes BRepExtrema_DistShapeShape, úhel, poloměr, délka).
 */
import * as r from "replicad";
import { eulerXYZ, type Mat3 } from "./assembly";
import { placed } from "./asm-kernel";
import type { Placement, Vec3 } from "./types";

type Shape = r.Shape3D;

export type EntRef = { kind: "face" | "edge" | "vertex"; index: number } | { kind: "body" } | { kind: "point"; point: Vec3 };
/** Zdroj tělesa: aktuální díl, nebo komponenta sestavy (klíč dílu v mezipaměti + světová matice po sloupcích). */
export type ShapeSrc = { kind: "part" } | { kind: "comp"; key: string; matrix: number[] };

export type Row = [string, string];
export type EntityInfo = {
  title: string;
  rows: Row[];
  center?: Vec3;
  normal?: Vec3;
  /** osa válce/kužele nebo kružnice */
  axis?: { origin: Vec3; dir: Vec3 };
  radius?: number;
  length?: number;
  area?: number;
  point?: Vec3;
  /** směr přímé hrany */
  dir?: Vec3;
  surface?: string;
  curve?: string;
};

export type MeasureResult = {
  rows: Row[];
  distance?: number;
  angle?: number;
  p1?: Vec3;
  p2?: Vec3;
  gfx: { lines: [Vec3, Vec3][]; points: Vec3[]; labels: { pos: Vec3; text: string }[] };
};

const SURF: Record<string, string> = {
  PLANE: "rovinná",
  CYLINDRE: "válcová",
  CONE: "kuželová",
  SPHERE: "kulová",
  TORUS: "toroidní",
  BEZIER_SURFACE: "Bézierova",
  BSPLINE_SURFACE: "B-spline (volná)",
  REVOLUTION_SURFACE: "rotační",
  EXTRUSION_SURFACE: "vysunutá",
  OFFSET_SURFACE: "odsazená",
  OTHER_SURFACE: "obecná",
};
const CURV: Record<string, string> = {
  LINE: "úsečka",
  CIRCLE: "kružnice / oblouk",
  ELLIPSE: "elipsa",
  HYPERBOLA: "hyperbola",
  PARABOLA: "parabola",
  BEZIER_CURVE: "Bézierova křivka",
  BSPLINE_CURVE: "B-spline",
  OFFSET_CURVE: "odsazená křivka",
  OTHER_CURVE: "obecná křivka",
};

const f = (n: number, d = 3) => (Math.round(n * 10 ** d) / 10 ** d).toLocaleString("cs-CZ", { maximumFractionDigits: d });
const fv = (v: Vec3, d = 3) => v.map((x) => f(x, d)).join(" ; ");
const vt = (v: r.Vector): Vec3 => [v.x, v.y, v.z];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const mid = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
const pnt = (p: { X(): number; Y(): number; Z(): number }): Vec3 => [p.X(), p.Y(), p.Z()];

/** Matice po sloupcích → umístění (posun + Eulerovy úhly XYZ). */
export function matrixPlacement(m: number[]): Placement {
  const R: Mat3 = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]];
  return { position: [m[12], m[13], m[14]], rotation: eulerXYZ(R) };
}

export function shapeFor(src: ShapeSrc, part: Shape | null, comp: (key: string) => Shape | null): Shape | null {
  if (src.kind === "part") return part;
  const b = comp(src.key);
  if (!b) return null;
  return placed(b, matrixPlacement(src.matrix));
}

/** Polohy topologických vrcholů (pořadí = index vrcholu). */
export function vertexPositions(shape: Shape): Float32Array {
  const oc = r.getOC() as unknown as { BRep_Tool: { Pnt(v: unknown): { X(): number; Y(): number; Z(): number; delete(): void } } };
  const out: number[] = [];
  for (const v of r.iterTopo(shape.wrapped, "vertex")) {
    const p = oc.BRep_Tool.Pnt(v);
    out.push(p.X(), p.Y(), p.Z());
    p.delete();
  }
  return new Float32Array(out);
}

function vertexAt(shape: Shape, index: number): Vec3 | null {
  const v = vertexPositions(shape);
  if (index * 3 + 2 >= v.length) return null;
  return [v[index * 3], v[index * 3 + 1], v[index * 3 + 2]];
}

type OcAny = Record<string, unknown> & { [k: string]: new (...a: unknown[]) => Record<string, (...a: unknown[]) => unknown> };

/** Podtvar entity (plocha/hrana/vrchol/těleso/bod) pro měření vzdálenosti. */
function subShape(shape: Shape, ref: EntRef): r.AnyShape | null {
  if (ref.kind === "body") return shape;
  if (ref.kind === "point") return r.makeVertex(ref.point);
  if (ref.kind === "face") return shape.faces[ref.index] ?? null;
  if (ref.kind === "edge") return shape.edges[ref.index] ?? null;
  const p = vertexAt(shape, ref.index);
  return p ? r.makeVertex(p) : null;
}

export function entityInfo(shape: Shape, ref: EntRef, density = 7.85): EntityInfo {
  const oc = r.getOC() as unknown as OcAny;
  if (ref.kind === "point") return { title: "Bod", rows: [["Souřadnice", fv(ref.point)]], point: ref.point };
  if (ref.kind === "vertex") {
    const p = vertexAt(shape, ref.index);
    if (!p) return { title: "Bod", rows: [["Chyba", "vrchol nenalezen"]] };
    return { title: `Bod ${ref.index + 1}`, rows: [["X", f(p[0])], ["Y", f(p[1])], ["Z", f(p[2])]], point: p };
  }
  if (ref.kind === "body") {
    const vol = r.measureVolume(shape);
    const area = r.measureArea(shape);
    const bb = shape.boundingBox.bounds as [Vec3, Vec3];
    let com: Vec3 | undefined;
    try {
      com = r.measureShapeVolumeProperties(shape).centerOfMass as Vec3;
    } catch {
      com = undefined;
    }
    const rows: Row[] = [
      ["Objem", `${f(vol, 2)} mm³`],
      ["Povrch", `${f(area, 2)} mm²`],
      ["Hmotnost (ρ " + f(density, 2) + ")", `${f((vol / 1e6) * density, 4)} kg`],
      ["Rozměry", fv(sub(bb[1], bb[0]), 2) + " mm"],
      ["Plochy / hrany", `${shape.faces.length} / ${shape.edges.length}`],
    ];
    if (com) rows.push(["Těžiště", fv(com, 2)]);
    return { title: "Těleso", rows, center: com, area };
  }
  if (ref.kind === "face") {
    const face = shape.faces[ref.index];
    if (!face) return { title: "Plocha", rows: [["Chyba", "plocha nenalezena"]] };
    const type = face.geomType as string;
    const area = r.measureArea(face);
    const c = vt(face.center);
    const info: EntityInfo = { title: `Plocha ${ref.index + 1}`, rows: [["Typ", SURF[type] ?? type], ["Plocha", `${f(area, 2)} mm²`], ["Střed", fv(c, 2)]], center: c, area, surface: type };
    if (type === "PLANE") {
      try {
        const n = vt(face.normalAt(face.center));
        info.normal = n;
        info.rows.push(["Normála", fv(n, 4)]);
      } catch {
        /* normálu nelze určit */
      }
    }
    try {
      const ad = new oc.BRepAdaptor_Surface(face.wrapped);
      if (type === "CYLINDRE") {
        const cyl = ad.Cylinder() as unknown as { Radius(): number; Axis(): { Location(): never; Direction(): never } };
        const ax = cyl.Axis();
        const o = pnt(ax.Location());
        const d = pnt(ax.Direction());
        info.radius = cyl.Radius();
        info.axis = { origin: o, dir: d };
        info.rows.push(["Poloměr", `${f(info.radius)} mm`], ["Průměr", `Ø ${f(info.radius * 2)} mm`], ["Osa", fv(norm(d), 4)]);
      } else if (type === "CONE") {
        const cone = ad.Cone() as unknown as { RefRadius(): number; SemiAngle(): number; Axis(): { Location(): never; Direction(): never } };
        const ax = cone.Axis();
        info.axis = { origin: pnt(ax.Location()), dir: pnt(ax.Direction()) };
        info.rows.push(["Vrcholový úhel", `${f((Math.abs(cone.SemiAngle()) * 360) / Math.PI, 3)}°`], ["Ref. poloměr", `${f(cone.RefRadius())} mm`]);
      } else if (type === "SPHERE") {
        const sp = ad.Sphere() as unknown as { Radius(): number };
        info.radius = sp.Radius();
        info.rows.push(["Poloměr", `${f(info.radius)} mm`]);
      } else if (type === "TORUS") {
        const t = ad.Torus() as unknown as { MajorRadius(): number; MinorRadius(): number };
        info.rows.push(["Poloměry", `${f(t.MajorRadius())} / ${f(t.MinorRadius())} mm`]);
      }
      (ad as unknown as { delete(): void }).delete();
    } catch {
      /* typ nepodporuje dotaz */
    }
    return info;
  }
  const edge = shape.edges[ref.index];
  if (!edge) return { title: "Hrana", rows: [["Chyba", "hrana nenalezena"]] };
  const type = edge.geomType as string;
  const length = edge.length;
  const a = vt(edge.startPoint);
  const b = vt(edge.endPoint);
  const info: EntityInfo = { title: `Hrana ${ref.index + 1}`, rows: [["Typ", CURV[type] ?? type], ["Délka", `${f(length)} mm`]], length, curve: type };
  if (type === "LINE") {
    info.dir = norm(sub(b, a));
    info.rows.push(["Začátek", fv(a, 2)], ["Konec", fv(b, 2)], ["Směr", fv(info.dir, 4)]);
  }
  if (type === "CIRCLE") {
    try {
      const circ = (edge.curve.wrapped as unknown as { Circle(): { Radius(): number; Location(): never; Axis(): { Direction(): never } } }).Circle();
      info.radius = circ.Radius();
      const c = pnt(circ.Location());
      info.center = c;
      info.axis = { origin: c, dir: pnt(circ.Axis().Direction()) };
      const full = edge.isClosed;
      info.rows.push(["Poloměr", `${f(info.radius)} mm`], ["Průměr", `Ø ${f(info.radius * 2)} mm`], ["Střed", fv(c, 2)]);
      if (!full) info.rows.push(["Úhel oblouku", `${f(((length / info.radius) * 180) / Math.PI, 2)}°`]);
    } catch {
      /* bez kružnice */
    }
  }
  return info;
}

/** Měření mezi dvěma entitami (případně jednou). */
export function measureEntities(sa: Shape, ra: EntRef, sb: Shape | null, rb: EntRef | null): MeasureResult {
  const ia = entityInfo(sa, ra);
  const res: MeasureResult = { rows: [], gfx: { lines: [], points: [], labels: [] } };
  if (!sb || !rb) {
    // jedna entita: délka, poloměr, plocha, souřadnice
    res.rows = ia.rows;
    if (ia.point) {
      res.gfx.points.push(ia.point);
      res.gfx.labels.push({ pos: ia.point, text: fv(ia.point, 2) });
    } else if (ia.radius != null && ia.center) {
      res.gfx.points.push(ia.center);
      res.gfx.labels.push({ pos: ia.center, text: `Ø ${f(ia.radius * 2, 3)}` });
    } else if (ia.length != null) {
      const e = ra.kind === "edge" ? sa.edges[ra.index] : null;
      const p = e ? mid(vt(e.startPoint), vt(e.endPoint)) : undefined;
      if (p) res.gfx.labels.push({ pos: p, text: `${f(ia.length, 3)} mm` });
    } else if (ia.area != null && ia.center) {
      res.gfx.labels.push({ pos: ia.center, text: `${f(ia.area, 2)} mm²` });
    }
    return res;
  }
  const ib = entityInfo(sb, rb);
  const A = subShape(sa, ra);
  const B = subShape(sb, rb);
  if (A && B) {
    const oc = r.getOC() as unknown as OcAny;
    const tool = new oc.BRepExtrema_DistShapeShape();
    tool.LoadS1((A as unknown as { wrapped: unknown }).wrapped);
    tool.LoadS2((B as unknown as { wrapped: unknown }).wrapped);
    tool.Perform();
    if (tool.IsDone() && (tool.NbSolution() as number) > 0) {
      const d = tool.Value() as number;
      const p1 = pnt(tool.PointOnShape1(1) as never);
      const p2 = pnt(tool.PointOnShape2(1) as never);
      res.distance = d;
      res.p1 = p1;
      res.p2 = p2;
      res.rows.push(["Min. vzdálenost", `${f(d)} mm`], ["ΔX / ΔY / ΔZ", sub(p2, p1).map((x) => f(Math.abs(x))).join(" / ")], ["Bod 1", fv(p1, 2)], ["Bod 2", fv(p2, 2)]);
      res.gfx.points.push(p1, p2);
      if (d > 1e-9) {
        res.gfx.lines.push([p1, p2]);
        res.gfx.labels.push({ pos: mid(p1, p2), text: `${f(d, 3)} mm` });
      }
    }
    (tool as unknown as { delete(): void }).delete();
  }
  // vzdálenost středů (kružnice/válce)
  const ca = ia.center ?? ia.point ?? ia.axis?.origin;
  const cb = ib.center ?? ib.point ?? ib.axis?.origin;
  if ((ia.radius != null || ib.radius != null) && ca && cb) {
    res.rows.push(["Vzdálenost středů", `${f(len(sub(cb, ca)))} mm`]);
    if (ia.axis && ib.axis && Math.abs(Math.abs(dot(norm(ia.axis.dir), norm(ib.axis.dir))) - 1) < 1e-6) {
      // rovnoběžné osy: kolmá vzdálenost os
      const d = norm(ia.axis.dir);
      const w = sub(ib.axis.origin, ia.axis.origin);
      const t = dot(w, d);
      const perp = len(sub(w, [d[0] * t, d[1] * t, d[2] * t]));
      res.rows.push(["Vzdálenost os", `${f(perp)} mm`]);
    }
  }
  // úhel
  const da = ia.normal ?? ia.dir ?? ia.axis?.dir;
  const db = ib.normal ?? ib.dir ?? ib.axis?.dir;
  if (da && db) {
    const c = Math.max(-1, Math.min(1, dot(norm(da), norm(db))));
    let ang = (Math.acos(c) * 180) / Math.PI;
    const mixed = (!!ia.normal && !ia.dir) !== (!!ib.normal && !ib.dir) && (ia.dir || ib.dir) && (ia.normal || ib.normal);
    if (mixed) ang = Math.abs(90 - ang); // úhel přímky k rovině
    res.angle = ang;
    res.rows.push(["Úhel", `${f(ang, 3)}°${ang > 90 ? ` (doplněk ${f(180 - ang, 3)}°)` : ""}`]);
    if (res.p1 && res.p2) res.gfx.labels.push({ pos: res.p2, text: `∠ ${f(Math.min(ang, 180 - ang), 2)}°` });
  }
  return res;
}
