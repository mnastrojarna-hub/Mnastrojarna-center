/**
 * Měření pro textový příkaz `měřit` a `window.mncad.measure` (běží ve workeru nad postaveným tělesem).
 * Entity se adresují stejně jako popisky pro výběr (F3 = plocha s indexem 2, E5, V2 – viz `window.mncad.hints()`).
 * Vrací jen čísla (mm, mm², mm³, stupně); text do protokolu skládá `agent-measure.ts` v jazyce rozhraní.
 */
import * as r from "replicad";
import { subShapes } from "./fastbox";
import { tr } from "./i18n";
import { entityInfo, measureEntities, vertexPositions, type EntRef, type ShapeSrc } from "./inspect";
import type { Vec3 } from "./types";

type Shape = r.Shape3D;

/** Údaje o jedné entitě (plocha, hrana, vrchol, bod, těleso). */
export type MeasureEnt = {
  label: string;
  kind: "face" | "edge" | "vertex" | "point" | "body";
  /** typ plochy / křivky z jádra: PLANE, CYLINDRE, CONE, SPHERE, TORUS, BSPLINE_SURFACE… · LINE, CIRCLE, ELLIPSE, BSPLINE_CURVE… */
  type?: string;
  area?: number;
  length?: number;
  radius?: number;
  diameter?: number;
  center?: Vec3;
  /** rovinná plocha: normála (ven z materiálu) */
  normal?: Vec3;
  /** válec / kužel / kružnice: osa (u válcové plochy bod osy uprostřed plochy) */
  axis?: { origin: Vec3; dir: Vec3 };
  point?: Vec3;
  /** hrana: začátek a konec; přímá hrana: směr */
  start?: Vec3;
  end?: Vec3;
  dir?: Vec3;
  /** neúplná kružnice: úhel oblouku (°) */
  arc?: number;
  /** válcová plocha: obvod (°, 360 = celý), úsek osy, díra (normála míří k ose) / vnější válec */
  span?: number;
  extent?: { from: Vec3; to: Vec3; length: number };
  hole?: boolean;
  /** kužel: vrcholový úhel (°) */
  coneAngle?: number;
};
/** Dvě entity: nejmenší vzdálenost, úhel, rovnoběžnost, vzdálenost rovin / os / středů. */
export type MeasurePair = {
  a: MeasureEnt;
  b: MeasureEnt;
  distance?: number;
  p1?: Vec3;
  p2?: Vec3;
  /** |p2 − p1| po osách */
  delta?: Vec3;
  /** úhel (°): dvě roviny = úhel normál 0–180; přímky / osy = 0–90; přímka nebo osa k rovině = 0–90 (0 = rovnoběžně s rovinou) */
  angle?: number;
  angleKind?: "planes" | "lines" | "linePlane";
  parallel?: boolean;
  perpendicular?: boolean;
  /** rovnoběžné roviny: vzdálenost rovin; přímka / osa rovnoběžná s rovinou: její vzdálenost od roviny */
  planeDistance?: number;
  /** rovnoběžné přímky / osy (válce, kružnice): kolmá vzdálenost os = rozteč */
  axisDistance?: number;
  /** vzdálenost středů (kružnice, válcové plochy – střed úseku osy, koule) */
  centerDistance?: number;
};
export type MeasureBody = { label: string; bbox: [Vec3, Vec3]; size: Vec3; volume: number; area: number; mass: number; density: number; com?: Vec3; faces: number; edges: number; vertices: number; solids: number };
/** Díra nebo vnější válec (souosé válcové plochy stejného průměru sloučené do jednoho úseku). */
export type MeasureCyl = {
  diameter: number;
  radius: number;
  /** jednotkový směr osy s kladnou převažující složkou (+Z, +X…) */
  axis: Vec3;
  /** konce úseku osy (from = menší souřadnice podél osy) */
  from: Vec3;
  to: Vec3;
  length: number;
  /** obvod (°) – menší než 360 = část válce (např. díra vybíhající z boku) */
  span: number;
  /** čísla ploch F (od 1) */
  faces: number[];
  /** díra: střed vstupu (otevřený konec; u průchozí díry konec s větší souřadnicí podél osy) */
  entry?: Vec3;
  /** díra: směr vrtání od vstupu (jednotkový) */
  drill?: Vec3;
  through?: boolean;
  /** slepá díra: hloubka válcové části */
  depth?: number;
};
export type MeasureReport =
  | { kind: "entity"; entity: MeasureEnt }
  | { kind: "pair"; pair: MeasurePair }
  | { kind: "list"; what: "faces" | "edges"; rule: string; entities: MeasureEnt[] }
  | { kind: "body"; body: MeasureBody }
  | { kind: "holes"; label: string; holes: MeasureCyl[] }
  | { kind: "cylinders"; label: string; cylinders: MeasureCyl[] };

export type MeasureItem = { src: ShapeSrc; ref: EntRef; label: string };
export type MeasureQuery =
  | { kind: "entities"; items: MeasureItem[] }
  | { kind: "list"; what: "faces" | "edges"; rule: string; items: MeasureItem[] }
  | { kind: "body" | "holes" | "cylinders"; src: ShapeSrc; label: string };

/* ───────────── vektory ───────────── */
const vt = (v: { x: number; y: number; z: number }): Vec3 => [v.x, v.y, v.z];
const pnt = (p: { X(): number; Y(): number; Z(): number }): Vec3 => [p.X(), p.Y(), p.Z()];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => mul(a, 1 / (len(a) || 1));
const deg = (rad: number) => (rad * 180) / Math.PI;
/** zaokrouhlení výsledků (numerický šum jádra pryč, -0 → 0) */
const q6 = (x: number) => Math.round(x * 1e6) / 1e6 + 0;
const qv = (v: Vec3): Vec3 => [q6(v[0]), q6(v[1]), q6(v[2])];
/** směr s kladnou převažující složkou (osa díry +Z místo −Z) */
const canonDir = (d: Vec3): Vec3 => {
  const u = unit(d);
  const k = [0, 1, 2].reduce((a, b) => (Math.abs(u[b]) > Math.abs(u[a]) + 1e-9 ? b : a), 0);
  return u[k] < 0 ? mul(u, -1) : u;
};
/** kolmá vzdálenost bodu od přímky (bod o, jednotkový směr d) */
const lineDist = (p: Vec3, o: Vec3, d: Vec3) => {
  const w = sub(p, o);
  return len(sub(w, mul(d, dot(w, d))));
};
const PAR = 1e-6;

type OcAny = Record<string, new (...a: unknown[]) => Record<string, (...a: unknown[]) => unknown>>;
const oc = () => r.getOC() as unknown as OcAny;

/* ───────────── kontrola čísel entit ───────────── */
function checkRange(shape: Shape, ref: EntRef) {
  if (ref.kind === "face") {
    const n = shape.faces.length;
    if (ref.index < 0 || ref.index >= n) throw new Error(tr("plocha F{0} v tělese není – těleso má {1} ploch (F1 až F{1})", ref.index + 1, n));
  } else if (ref.kind === "edge") {
    const n = shape.edges.length;
    if (ref.index < 0 || ref.index >= n) throw new Error(tr("hrana E{0} v tělese není – těleso má {1} hran (E1 až E{1})", ref.index + 1, n));
  } else if (ref.kind === "vertex") {
    const n = vertexPositions(shape).length / 3;
    if (ref.index < 0 || ref.index >= n) throw new Error(tr("vrchol V{0} v tělese není – těleso má {1} vrcholů (V1 až V{1})", ref.index + 1, n));
  }
}

/* ───────────── válcová plocha ───────────── */
type CylGeom = { radius: number; origin: Vec3; dir: Vec3; vMin: number; vMax: number; span: number; inner: boolean };
/** Geometrie válcové plochy: poloměr, osa, rozsah parametru podél osy (v), obvod a zda je to díra (normála ven z materiálu míří k ose). */
function cylGeom(face: r.Face): CylGeom | null {
  const ad = new (oc().BRepAdaptor_Surface)(face.wrapped, false);
  try {
    const cyl = ad.Cylinder() as unknown as { Radius(): number; Axis(): { Location(): never; Direction(): never } };
    const ax = cyl.Axis();
    const origin = pnt(ax.Location());
    const dir = unit(pnt(ax.Direction()));
    const { uMin, uMax, vMin, vMax } = face.UVBounds;
    const p = vt(face.pointOnSurface(0.5, 0.5));
    const n = vt(face.normalAt());
    const w = sub(p, origin);
    const radial = sub(w, mul(dir, dot(w, dir)));
    return { radius: cyl.Radius(), origin, dir, vMin, vMax, span: Math.min(360, deg(uMax - uMin)), inner: dot(n, radial) < 0 };
  } catch {
    return null;
  } finally {
    (ad as unknown as { delete(): void }).delete();
  }
}

function coneAngleOf(face: r.Face): number | undefined {
  const ad = new (oc().BRepAdaptor_Surface)(face.wrapped, false);
  try {
    const c = ad.Cone() as unknown as { SemiAngle(): number };
    return deg(Math.abs(c.SemiAngle()) * 2);
  } catch {
    return undefined;
  } finally {
    (ad as unknown as { delete(): void }).delete();
  }
}

/* ───────────── jedna entita ───────────── */
export function measureEnt(shape: Shape, ref: EntRef, label: string): MeasureEnt {
  checkRange(shape, ref);
  if (ref.kind === "point") return { label, kind: "point", point: qv(ref.point) };
  const info = entityInfo(shape, ref);
  if (ref.kind === "vertex") return { label, kind: "vertex", point: info.point && qv(info.point) };
  if (ref.kind === "body") return { label, kind: "body", area: info.area, center: info.center && qv(info.center) };
  if (ref.kind === "face") {
    const face = shape.faces[ref.index];
    const e: MeasureEnt = { label, kind: "face", type: info.surface, area: info.area != null ? q6(info.area) : undefined, center: info.center && qv(info.center) };
    if (info.normal) e.normal = qv(unit(info.normal));
    if (info.radius != null) {
      e.radius = q6(info.radius);
      e.diameter = q6(2 * info.radius);
    }
    if (info.surface === "CYLINDRE") {
      const g = cylGeom(face);
      if (g) {
        const from = add(g.origin, mul(g.dir, g.vMin));
        const to = add(g.origin, mul(g.dir, g.vMax));
        e.axis = { origin: qv(mul(add(from, to), 0.5)), dir: qv(canonDir(g.dir)) };
        e.extent = { from: qv(from), to: qv(to), length: q6(Math.abs(g.vMax - g.vMin)) };
        e.span = q6(g.span);
        e.hole = g.inner;
      }
    } else if (info.axis) e.axis = { origin: qv(info.axis.origin), dir: qv(canonDir(info.axis.dir)) };
    if (info.surface === "CONE") e.coneAngle = coneAngleOf(face);
    if (info.surface === "SPHERE" && info.radius != null) {
      try {
        const ad = new (oc().BRepAdaptor_Surface)(face.wrapped, false);
        e.center = qv(pnt((ad.Sphere() as unknown as { Location(): never }).Location()));
        (ad as unknown as { delete(): void }).delete();
      } catch {
        /* střed koule nelze určit */
      }
    }
    return e;
  }
  const edge = shape.edges[ref.index];
  const e: MeasureEnt = { label, kind: "edge", type: info.curve, length: info.length != null ? q6(info.length) : undefined };
  try {
    e.start = qv(vt(edge.startPoint));
    e.end = qv(vt(edge.endPoint));
  } catch {
    /* bez koncových bodů */
  }
  if (info.dir) e.dir = qv(info.dir);
  if (info.radius != null) {
    e.radius = q6(info.radius);
    e.diameter = q6(2 * info.radius);
  }
  if (info.center) e.center = qv(info.center);
  if (info.axis) e.axis = { origin: qv(info.axis.origin), dir: qv(canonDir(info.axis.dir)) };
  if (info.curve === "CIRCLE" && info.radius && info.length != null && !edge.isClosed) e.arc = q6(deg(info.length / info.radius));
  return e;
}

/* ───────────── dvě entity ───────────── */
const isPlane = (e: MeasureEnt) => e.kind === "face" && e.type === "PLANE" && !!e.normal;
/** směr přímky: přímá hrana nebo osa (válec, kužel, kružnice) */
const lineOf = (e: MeasureEnt): { o: Vec3; d: Vec3 } | null => (e.dir && e.start ? { o: e.start, d: unit(e.dir) } : e.axis ? { o: e.axis.origin, d: unit(e.axis.dir) } : null);
/** střed pro vzdálenost středů (kružnice, válcová plocha, koule) */
const centerOf = (e: MeasureEnt): Vec3 | undefined => (e.radius != null ? (e.kind === "face" && e.type === "CYLINDRE" ? e.axis?.origin : e.center) : undefined);

export function measurePair(sa: Shape, ra: EntRef, la: string, sb: Shape, rb: EntRef, lb: string): MeasurePair {
  const a = measureEnt(sa, ra, la);
  const b = measureEnt(sb, rb, lb);
  const res: MeasurePair = { a, b };
  const m = measureEntities(sa, ra, sb, rb);
  if (m.distance != null && m.p1 && m.p2) {
    res.distance = q6(m.distance);
    res.p1 = qv(m.p1);
    res.p2 = qv(m.p2);
    res.delta = qv(sub(m.p2, m.p1).map(Math.abs) as Vec3);
  }
  const la2 = lineOf(a);
  const lb2 = lineOf(b);
  if (isPlane(a) && isPlane(b)) {
    const na = unit(a.normal!);
    const nb = unit(b.normal!);
    const c = Math.max(-1, Math.min(1, dot(na, nb)));
    res.angle = q6(deg(Math.acos(c)));
    res.angleKind = "planes";
    res.parallel = Math.abs(Math.abs(c) - 1) < PAR;
    res.perpendicular = Math.abs(c) < PAR;
    if (res.parallel && a.center && b.center) res.planeDistance = q6(Math.abs(dot(sub(b.center, a.center), na)));
  } else if (la2 && lb2) {
    const c = Math.min(1, Math.abs(dot(la2.d, lb2.d)));
    res.angle = q6(deg(Math.acos(c)));
    res.angleKind = "lines";
    res.parallel = Math.abs(c - 1) < PAR;
    res.perpendicular = c < PAR;
    if (res.parallel) res.axisDistance = q6(lineDist(lb2.o, la2.o, la2.d));
  } else if ((isPlane(a) && lb2) || (isPlane(b) && la2)) {
    const [pl, ln] = isPlane(a) ? [a, lb2!] : [b, la2!];
    const n = unit(pl.normal!);
    const c = Math.min(1, Math.abs(dot(n, ln.d)));
    res.angle = q6(deg(Math.asin(c)));
    res.angleKind = "linePlane";
    res.parallel = c < PAR;
    res.perpendicular = Math.abs(c - 1) < PAR;
    if (res.parallel && pl.center) res.planeDistance = q6(Math.abs(dot(sub(ln.o, pl.center), n)));
  }
  const ca = centerOf(a);
  const cb = centerOf(b);
  if (ca && cb) res.centerDistance = q6(len(sub(cb, ca)));
  return res;
}

/* ───────────── těleso ───────────── */
export function measureBody(shape: Shape, label: string, density = 7.85): MeasureBody {
  const volume = r.measureVolume(shape);
  const area = r.measureArea(shape);
  const bb = shape.boundingBox.bounds as [Vec3, Vec3];
  let com: Vec3 | undefined;
  try {
    com = qv(r.measureShapeVolumeProperties(shape).centerOfMass as Vec3);
  } catch {
    com = undefined;
  }
  const solids = subShapes(shape, "SOLID");
  const nSolids = solids.length;
  for (const s of solids) (s as { delete(): void }).delete();
  return {
    label,
    bbox: [qv(bb[0]), qv(bb[1])],
    size: qv(sub(bb[1], bb[0])),
    volume: q6(volume),
    area: q6(area),
    density,
    mass: q6((volume / 1e6) * density),
    com,
    faces: shape.faces.length,
    edges: shape.edges.length,
    vertices: vertexPositions(shape).length / 3,
    solids: nSolids,
  };
}

/* ───────────── díry a válce ───────────── */
type Group = { r: number; o: Vec3; d: Vec3; t0: number; t1: number; span: number; inner: number; outer: number; faces: number[] };

/** Leží bod uvnitř materiálu? (BRepExtrema: bod uvnitř tělesa = „vnitřní řešení“) */
function insideFn(shape: Shape) {
  const solids = subShapes(shape, "SOLID") as { delete(): void }[];
  const test = (p: Vec3) => {
    const v = r.makeVertex(p);
    try {
      return solids.some((s) => {
        const tool = new (oc().BRepExtrema_DistShapeShape)();
        try {
          tool.LoadS1((v as unknown as { wrapped: unknown }).wrapped);
          tool.LoadS2(s);
          tool.Perform();
          return !!tool.InnerSolution();
        } finally {
          (tool as unknown as { delete(): void }).delete();
        }
      });
    } finally {
      v.delete();
    }
  };
  return { test, done: () => solids.forEach((s) => s.delete()) };
}

/** Válcové plochy sloučené podle osy a průměru (souosé, navazující úseky = jedna díra / jeden válec). */
function cylGroups(shape: Shape): Group[] {
  const groups: Group[] = [];
  const tol = 1e-3;
  shape.faces.forEach((face, i) => {
    if (face.geomType !== "CYLINDRE") return;
    const g = cylGeom(face);
    if (!g) return;
    const d = canonDir(g.dir);
    const pa = add(g.origin, mul(g.dir, g.vMin));
    const pb = add(g.origin, mul(g.dir, g.vMax));
    const hit = groups.find((x) => {
      if (Math.abs(x.r - g.radius) > tol || Math.abs(Math.abs(dot(x.d, d)) - 1) > PAR || lineDist(pa, x.o, x.d) > tol) return false;
      const ta = dot(sub(pa, x.o), x.d);
      const tb = dot(sub(pb, x.o), x.d);
      return Math.min(ta, tb) <= x.t1 + tol && Math.max(ta, tb) >= x.t0 - tol;
    });
    const grp = hit ?? { r: g.radius, o: pa, d, t0: Infinity, t1: -Infinity, span: 0, inner: 0, outer: 0, faces: [] };
    const ta = dot(sub(pa, grp.o), grp.d);
    const tb = dot(sub(pb, grp.o), grp.d);
    grp.t0 = Math.min(grp.t0, ta, tb);
    grp.t1 = Math.max(grp.t1, ta, tb);
    grp.span = Math.min(360, grp.span + g.span);
    if (g.inner) grp.inner++;
    else grp.outer++;
    grp.faces.push(i + 1);
    if (!hit) groups.push(grp);
  });
  return groups;
}

/** obvod nad polovinu (díra / válec, ne zaoblení ani konec drážky) */
const MIN_SPAN = 181;
const byPos = (a: MeasureCyl, b: MeasureCyl) => a.diameter - b.diameter || (a.entry ?? a.from)[0] - (b.entry ?? b.from)[0] || (a.entry ?? a.from)[1] - (b.entry ?? b.from)[1] || (a.entry ?? a.from)[2] - (b.entry ?? b.from)[2];

/** Díry (vnitřní válcové plochy) nebo vnější válce (osazení, čepy) tělesa. */
export function measureCylinders(shape: Shape, holes: boolean): MeasureCyl[] {
  const groups = cylGroups(shape).filter((g) => (holes ? g.inner >= g.outer : g.outer > g.inner) && g.span >= MIN_SPAN);
  const inside = holes && groups.length ? insideFn(shape) : null;
  try {
    const out = groups.map((g): MeasureCyl => {
      const from = add(g.o, mul(g.d, g.t0));
      const to = add(g.o, mul(g.d, g.t1));
      const c: MeasureCyl = { diameter: q6(2 * g.r), radius: q6(g.r), axis: qv(g.d), from: qv(from), to: qv(to), length: q6(g.t1 - g.t0), span: q6(g.span), faces: g.faces };
      if (inside) {
        // konec díry je uzavřený (dno, hrot vrtáku, osazení), když je kousek za ním (podél osy) u stěny díry materiál
        const u = unit(cross(g.d, Math.abs(g.d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
        const step = Math.max(0.15 * g.r, 0.05);
        const closed = (end: Vec3, out: Vec3) => [u, mul(u, -1)].some((s) => inside.test(add(add(end, mul(out, step)), mul(s, 0.9 * g.r))));
        const c0 = closed(from, mul(g.d, -1));
        const c1 = closed(to, g.d);
        c.through = !c0 && !c1;
        const entryAtTo = c.through || !c1 || c0;
        c.entry = qv(entryAtTo ? to : from);
        c.drill = qv(entryAtTo ? mul(g.d, -1) : g.d);
        if (!c.through) c.depth = c.length;
      }
      return c;
    });
    return out.sort(byPos);
  } finally {
    inside?.done();
  }
}

/* ───────────── dotaz z UI ───────────── */
/** Provede dotaz měření; `get` vrací těleso pro zdroj (díl / komponenta sestavy), `density` v g/cm³ (hmotnost tělesa). */
export function measureQuery(get: (src: ShapeSrc) => Shape | null, qy: MeasureQuery, density?: number): MeasureReport {
  const need = (src: ShapeSrc) => {
    const s = get(src);
    if (!s) throw new Error(src.kind === "part" ? tr("žádné těleso – nejdřív vytvořte tvar (kvádr, vysunutí…)") : tr("těleso komponenty není načtené – otevřete sestavu a zopakujte měření"));
    return s;
  };
  switch (qy.kind) {
    case "entities": {
      const [a, b] = qy.items;
      if (!a) throw new Error("measure: no entity");
      if (!b) return { kind: "entity", entity: measureEnt(need(a.src), a.ref, a.label) };
      return { kind: "pair", pair: measurePair(need(a.src), a.ref, a.label, need(b.src), b.ref, b.label) };
    }
    case "list":
      return { kind: "list", what: qy.what, rule: qy.rule, entities: qy.items.map((it) => measureEnt(need(it.src), it.ref, it.label)) };
    case "body":
      return { kind: "body", body: measureBody(need(qy.src), qy.label, density) };
    case "holes":
      return { kind: "holes", label: qy.label, holes: measureCylinders(need(qy.src), true) };
    case "cylinders":
      return { kind: "cylinders", label: qy.label, cylinders: measureCylinders(need(qy.src), false) };
  }
}
