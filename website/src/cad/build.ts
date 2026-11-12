/**
 * Stavba modelu z historie prvků nad jádrem OpenCascade (replicad).
 * Běží ve web workeru (prohlížeč) i v Node (testy). Předpokládá zavolané setOC().
 */
import { tr } from "./i18n";
import * as r from "replicad";
import { DEFAULT_BODY, isNewBodyMode, nextBodyName } from "./bodies";
import "./fastbox";
import { MESH_ANGULAR, meshTolerance } from "./fastbool";
import { checkShape, describeCheck, sameSignature, signatureOf, tryFixShape, type ShapeSignature } from "./check";
import { deleteFaces, offsetFaces, pushPull, ribTool, springSolid, thickenFaces, vertexPositions } from "./direct";
import { getExt } from "./ext/index";
import "./feat/index";
import { getFeatureBuilder } from "./feat/registry";
import { importBody } from "./formats/kernel-import";
import { threadByName } from "./defaults";
import { resolveDoc } from "./params";
import { entityIndex, planeDefToSketchPlane, pointOf, resolveAxis, resolveDirection, resolvePlaneDef, resolveRef, V, type ResolveCtx } from "./ref-resolve";
import { planeDefLabel, type Extent, type PlaneDef, type Thin } from "./refs";
import { findLoops, nestLoops, shapeSegs, splinePoints, type Loop, type Seg } from "./sketch";
import type { Axis, BodyInfo, BoolMode, BuildResult, CadDoc, FaceInfo, Feature, FeatureStatus, MeshData, PlaneName, SketchPlane, Vec2, Vec3 } from "./types";

type Shape = r.Shape3D;

export function planeOf(p: SketchPlane): r.Plane {
  if (p.kind === "base") return r.makePlane(p.name, p.offset);
  return new r.Plane(p.origin, p.xDir, p.normal);
}

const vec = (v: r.Vector): Vec3 => [v.x, v.y, v.z];

/** Uzavřené profily skici → replicad Drawing (s otvory dle vnoření). `outerOnly` = bez otvorů. */
export function sketchDrawing(f: Extract<Feature, { type: "sketch" }>, outerOnly = false): r.Drawing | null {
  const { loops } = findLoops(f.entities);
  if (!loops.length) return null;
  const nested = nestLoops(loops).sort((a, b) => b.area - a.area);
  let result: r.Drawing | null = null;
  for (const { loop, depth } of nested) {
    if (outerOnly && depth > 0) continue;
    const d = loopDrawing(loop);
    if (!d) continue;
    if (!result) result = d;
    else if (depth % 2 === 0) result = result.fuse(d);
    else result = result.cut(d);
  }
  return result;
}

function loopDrawing(l: Loop): r.Drawing | null {
  if (l.kind === "circle") return r.drawCircle(l.r).translate(l.cx, l.cy);
  if (!l.segs.length) return null;
  let pen = r.draw(l.segs[0].a);
  for (const s of l.segs) {
    if (s.kind === "line") pen = pen.lineTo(s.b);
    else pen = pen.threePointsArcTo(s.b, s.m);
  }
  return pen.close();
}

const axisVec = (a: Axis): Vec3 => (a === "X" ? [1, 0, 0] : a === "Y" ? [0, 1, 0] : [0, 0, 1]);

/** Rotační těleso z profilu (poloměr, výška) kolem osy Z v počátku, pak natočené do osy. */
function revolved(profile: [number, number][], axis: Axis, position: Vec3): Shape {
  let pen = r.draw(profile[0]);
  for (const p of profile.slice(1)) pen = pen.lineTo(p);
  let s = pen.close().sketchOnPlane("XZ").revolve([0, 0, 1]) as Shape;
  if (axis === "X") s = s.rotate(90, [0, 0, 0], [0, 1, 0]);
  if (axis === "Y") s = s.rotate(-90, [0, 0, 0], [1, 0, 0]);
  return s.translate(position);
}

/** Rotační profil (r, t) kolem osy Z → natočený tak, aby +Z mířila do `dir` (osový ± vektor), posunutý do `at`. */
function revolvedAlong(profile: [number, number][], dir: Vec3, at: Vec3): Shape {
  let pen = r.draw(profile[0]);
  for (const p of profile.slice(1)) pen = pen.lineTo(p);
  let s = pen.close().sketchOnPlane("XZ").revolve([0, 0, 1]) as Shape;
  const [x, y, z] = dir;
  if (z < -0.5) s = s.rotate(180, [0, 0, 0], [1, 0, 0]);
  else if (x > 0.5) s = s.rotate(90, [0, 0, 0], [0, 1, 0]);
  else if (x < -0.5) s = s.rotate(-90, [0, 0, 0], [0, 1, 0]);
  else if (y > 0.5) s = s.rotate(-90, [0, 0, 0], [1, 0, 0]);
  else if (y < -0.5) s = s.rotate(90, [0, 0, 0], [1, 0, 0]);
  return s.translate(at);
}

function oriented(s: Shape, axis: Axis, position: Vec3): Shape {
  if (axis === "X") s = s.rotate(90, [0, 0, 0], [0, 1, 0]);
  if (axis === "Y") s = s.rotate(-90, [0, 0, 0], [1, 0, 0]);
  return s.translate(position);
}

export function applyMode(body: Shape | null, tool: Shape, mode: BoolMode): Shape {
  if (!body) {
    if (mode === "cut" || mode === "intersect") throw new Error(tr("Není z čeho odebírat – nejdřív vytvořte těleso."));
    return tool;
  }
  if (mode === "cut") return body.cut(tool);
  if (mode === "intersect") return body.intersect(tool);
  return body.fuse(tool);
}

export function bboxDiag(s: Shape) {
  const b = s.boundingBox;
  const [[x0, y0, z0], [x1, y1, z1]] = b.bounds;
  return Math.hypot(x1 - x0, y1 - y0, z1 - z0) || 100;
}

type SketchF = Extract<Feature, { type: "sketch" }>;
type Ctx = { sketches: Map<string, SketchF>; body: Shape | null; features: Feature[] };
const rctx = (ctx: Ctx): ResolveCtx => ({ body: ctx.body, sketches: ctx.sketches, features: ctx.features });
const planeFrom = (p: { origin: Vec3; normal: Vec3; xDir: Vec3 }) => new r.Plane(p.origin, p.xDir, p.normal);

/** Tenká stěna z uzavřeného profilu: prstenec kolem obrysu (ven / dovnitř / na střed / dvě tloušťky). */
export function thinDrawing(d: r.Drawing, thin: Thin): r.Drawing {
  const t1 = Math.abs(thin.t1);
  const t2 = Math.abs(thin.t2 ?? thin.t1);
  if (!(t1 > 0)) throw new Error(tr("Tloušťka tenké stěny musí být kladná."));
  switch (thin.side) {
    case "one":
      return d.offset(t1).cut(d);
    case "in":
      return d.cut(d.offset(-t1));
    case "mid":
      return d.offset(t1 / 2).cut(d.offset(-t1 / 2));
    case "two":
      return d.offset(t1).cut(d.offset(-t2));
  }
}

/** Profil skici jako replicad skica v dané rovině (volitelně bez otvorů / jako tenká stěna; otevřený profil jen s tenkou stěnou). */
export function profileSketch(sk: SketchF, plane: r.Plane, o: { outerOnly?: boolean; thin?: Thin }, shift: Vec3 = [0, 0, 0]): r.SketchInterface {
  const d = sketchDrawing(sk, o.outerOnly);
  if (d) return (o.thin ? thinDrawing(d, o.thin) : d).sketchOnPlane(plane) as r.SketchInterface;
  if (!o.thin) throw new Error(tr("Skica neobsahuje uzavřený profil (pro otevřený profil zapněte Tenkou stěnu)."));
  const t1 = Math.abs(o.thin.t1);
  const t = o.thin.side === "two" ? (t1 + Math.abs(o.thin.t2 ?? t1)) / 2 : o.thin.side === "mid" ? t1 / 2 : t1;
  let w = sketchPathWire(sk);
  if (shift.some((v) => v)) w = w.translate(shift) as r.Wire;
  const ow = w.offset2D(t, "arc");
  return new r.Sketch(ow, { defaultOrigin: plane.origin, defaultDirection: plane.zDir });
}

/** Tělesa složeného tvaru (po booleovské operaci může vzniknout více kusů). */
/** Složený tvar z více těles BEZ zániku vstupů (`r.makeCompound` vstupní tvary maže – tělesa dílu se ale dál používají). */
export function compoundOf(shapes: Shape[]): Shape {
  const oc = r.getOC();
  const builder = new oc.TopoDS_Builder();
  const compound = new oc.TopoDS_Compound();
  builder.MakeCompound(compound);
  for (const s of shapes) builder.Add(compound, s.wrapped);
  builder.delete();
  return r.cast(compound) as unknown as Shape;
}
/**
 * Nezávislá kopie tvaru (nové plochy, hrany i vrcholy). Tělesa dílu nesmějí sdílet topologii – rozdělením vzniklé poloviny
 * sdílejí plochu řezu a složený výsledek by ji počítal jen jednou (indexy ploch těles by pak nesouhlasily).
 */
export function deepCopy(s: Shape): Shape {
  const oc = r.getOC();
  const t = new oc.gp_Trsf();
  const b = new oc.BRepBuilderAPI_Transform(s.wrapped, t, true);
  try {
    return r.cast(b.Shape()) as unknown as Shape;
  } finally {
    b.delete();
    t.delete();
  }
}
export function solidsOf(s: Shape): Shape[] {
  const list = (s as unknown as { solids?: Shape[] }).solids;
  return list && list.length ? list : [s];
}
const corners = (s: Shape): Vec3[] => {
  const [[x0, y0, z0], [x1, y1, z1]] = s.boundingBox.bounds as [Vec3, Vec3];
  return [x0, x1].flatMap((x) => [y0, y1].flatMap((y) => [z0, z1].map((z): Vec3 => [x, y, z])));
};
const minProj = (s: Shape, o: Vec3, d: Vec3) => Math.min(...corners(s).map((c) => V.dot(V.sub(c, o), d)));
const maxProj = (s: Shape, o: Vec3, d: Vec3) => Math.max(...corners(s).map((c) => V.dot(V.sub(c, o), d)));
/** Kus nejblíže počátku ve směru d (pro „k dalšímu“). */
export function nearestSolid(parts: Shape, o: Vec3, d: Vec3): { solid: Shape; far: number } {
  let best: Shape | null = null;
  let bestT = Infinity;
  for (const sl of solidsOf(parts)) {
    const t = minProj(sl, o, d);
    if (t < bestT) {
      bestT = t;
      best = sl;
    }
  }
  if (!best) throw new Error(tr("Ve směru operace není žádné těleso."));
  return { solid: best, far: maxProj(best, o, d) };
}

export function needSketch(ctx: { sketches: Map<string, SketchF> }, id: string, role = "skica"): SketchF {
  const sk = ctx.sketches.get(id);
  if (!sk) throw new Error(tr("Chybí {0} – vyberte ji v parametrech.", role));
  return sk;
}

/** Uzavřené smyčky skici jako dráty v prostoru, s hloubkou vnoření (0 = vnější obrys, 1 = otvor…). */
export function sketchWires(sk: SketchF, plane: r.Plane = planeOf(sk.plane)): { wire: r.Wire; depth: number; area: number }[] {
  const { loops } = findLoops(sk.entities);
  if (!loops.length) throw new Error(tr("Skica „{0}“ neobsahuje uzavřený profil.", sk.name));
  return nestLoops(loops).map(({ loop, depth, area }) => {
    const d = loopDrawing(loop);
    if (!d) throw new Error(tr("Skica „{0}“ obsahuje neplatný profil.", sk.name));
    const s = d.sketchOnPlane(plane) as r.Sketch;
    if (!s.wire) throw new Error(tr("Skica „{0}“ obsahuje neplatný profil.", sk.name));
    return { wire: s.wire, depth, area };
  });
}

/** Otevřená i uzavřená křivka skici (úsečky, oblouky, lomené čáry, tvary) jako jeden drát – dráha tažení. */
export function sketchPathWire(sk: SketchF): r.Wire {
  const plane = planeOf(sk.plane);
  const W = (p: Vec2): Vec3 => vec(plane.toWorldCoords(p));
  const segs: Seg[] = [];
  const closedEdges: r.Edge[] = [];
  // Hladká křivka (spline) jako dráha = jedna B-spline hrana. Řetězec oblouků (jak se spline kreslí v profilu) má v navázání
  // oblouků skoky křivosti, po kterých tažení vytvoří sebeprotínající plochy a booleovská operace selže.
  const splines = sk.entities.filter((e) => e.type === "spline" && !e.construction && e.points.length >= 2);
  const others = sk.entities.filter((e) => !e.construction && e.type !== "point" && e.type !== "spline");
  if (splines.length === 1 && !others.length) {
    const e = splines[0] as Extract<typeof splines[number], { type: "spline" }>;
    const pts = splinePoints(e.points, e.closed, 8).map(W);
    if (e.closed) pts.push(pts[0]);
    const edge = r.makeBSplineApproximation(pts, { tolerance: 1e-3, degMin: 3, degMax: 3 });
    return r.assembleWire([edge]);
  }
  for (const e of sk.entities) {
    if (e.type === "line") {
      if (!e.construction) segs.push({ kind: "line", a: e.a, b: e.b });
    } else if (e.type === "arc") segs.push({ kind: "arc", a: e.a, m: e.b, b: e.c });
    else if (e.type === "polyline") {
      e.points.slice(1).forEach((p, i) => segs.push({ kind: "line", a: e.points[i], b: p }));
      if (e.closed && e.points.length > 2) segs.push({ kind: "line", a: e.points[e.points.length - 1], b: e.points[0] });
    } else if (e.type === "circle") {
      closedEdges.push(r.makeCircle(e.r, W([e.cx, e.cy]), vec(plane.zDir)));
    } else {
      const s = shapeSegs(e);
      if (s) segs.push(...s);
    }
  }
  if (closedEdges.length && !segs.length) {
    if (closedEdges.length > 1) throw new Error(tr("Dráha musí být jedna souvislá křivka."));
    return r.assembleWire(closedEdges);
  }
  if (!segs.length) throw new Error(tr("Skica dráhy „{0}“ je prázdná.", sk.name));
  const ordered = chainSegs(segs);
  const edges = ordered.map((s) => (s.kind === "line" ? r.makeLine(W(s.a), W(s.b)) : r.makeThreePointArc(W(s.a), W(s.m), W(s.b))));
  return r.assembleWire(edges);
}

/** Otevřená (nebo uzavřená) křivka skici jako seřazené 2D segmenty – pro žebro. */
export function sketchChain(sk: SketchF): Seg[] {
  const segs: Seg[] = [];
  for (const e of sk.entities) {
    if (e.construction) continue;
    if (e.type === "line") segs.push({ kind: "line", a: e.a, b: e.b });
    else if (e.type === "arc") segs.push({ kind: "arc", a: e.a, m: e.b, b: e.c });
    else if (e.type === "polyline") {
      e.points.slice(1).forEach((p, i) => segs.push({ kind: "line", a: e.points[i], b: p }));
      if (e.closed && e.points.length > 2) segs.push({ kind: "line", a: e.points[e.points.length - 1], b: e.points[0] });
    }
  }
  if (!segs.length) throw new Error(tr("Skica „{0}“ musí obsahovat čáru (úsečku, lomenou čáru nebo oblouk).", sk.name));
  return chainSegs(segs);
}

const near2 = (p: Vec2, q: Vec2, eps = 1e-3) => Math.abs(p[0] - q[0]) < eps && Math.abs(p[1] - q[1]) < eps;
const revSeg = (s: Seg): Seg => (s.kind === "line" ? { kind: "line", a: s.b, b: s.a } : { kind: "arc", a: s.b, m: s.m, b: s.a });

/** Seřadí segmenty do jedné souvislé křivky (začíná volným koncem, pokud existuje). */
export function chainSegs(segs: Seg[]): Seg[] {
  const ends = segs.flatMap((s) => [s.a, s.b]);
  const degree = (p: Vec2) => ends.filter((q) => near2(p, q)).length;
  let startIdx = 0;
  let flip = false;
  for (let i = 0; i < segs.length; i++) {
    if (degree(segs[i].a) === 1) {
      startIdx = i;
      flip = false;
      break;
    }
    if (degree(segs[i].b) === 1) {
      startIdx = i;
      flip = true;
      break;
    }
  }
  const used = new Array(segs.length).fill(false);
  const chain: Seg[] = [flip ? revSeg(segs[startIdx]) : segs[startIdx]];
  used[startIdx] = true;
  for (;;) {
    const end = chain[chain.length - 1].b;
    let found = false;
    for (let j = 0; j < segs.length; j++) {
      if (used[j]) continue;
      if (near2(segs[j].a, end)) chain.push(segs[j]);
      else if (near2(segs[j].b, end)) chain.push(revSeg(segs[j]));
      else continue;
      used[j] = true;
      found = true;
      break;
    }
    if (!found) break;
  }
  if (used.some((u) => !u)) throw new Error(tr("Dráha musí být jedna souvislá křivka (bez větvení a mezer)."));
  return chain;
}

export function combine(parts: { solid: Shape; depth: number }[]): Shape {
  let acc: Shape | null = null;
  for (const { solid, depth } of parts.sort((a, b) => a.depth - b.depth)) {
    if (!acc) acc = solid;
    else acc = depth % 2 === 0 ? acc.fuse(solid) : acc.cut(solid);
  }
  if (!acc) throw new Error(tr("Profil je prázdný."));
  return acc;
}

// ---------------- text ----------------

const FONT_FAMILY = "MnRoboto";
let fontReady: Promise<void> | null = null;

/** Zaregistruje písmo pro prvek Text (v Node testech; v prohlížeči se načte /fonts/Roboto-Bold.ttf). */
export async function registerTextFont(data: ArrayBuffer | string) {
  await r.loadFont(data, FONT_FAMILY, true);
  fontReady = Promise.resolve();
}

function ensureFont(): Promise<void> {
  if (!fontReady) {
    fontReady = (async () => {
      if (typeof fetch !== "function" || typeof location === "undefined") throw new Error("no fetch");
      const res = await fetch(new URL("/fonts/Roboto-Bold.ttf", location.origin).toString());
      if (!res.ok) throw new Error("font");
      await r.loadFont(await res.arrayBuffer(), FONT_FAMILY, true);
    })();
    fontReady.catch(() => (fontReady = null));
  }
  return fontReady.catch(() => {
    throw new Error(tr("Písmo pro text se nepodařilo načíst – zkontrolujte připojení a zkuste to znovu."));
  });
}

// ---------------- díry a závity ----------------

/** Hloubka kuželového zahloubení. */
const csDepthOf = (csD: number, d: number, angle: number) => Math.max(0, (csD / 2 - d / 2) / Math.tan(((angle || 90) * Math.PI) / 360));

type HoleF = Extract<Feature, { type: "hole" }>;

/** Průměr vrtání a poloměr „hlavy“ díry (zahloubení) – z něj se odvozuje krátký nástup nad zadaným bodem. */
function holeHead(f: HoleF): { kind: NonNullable<HoleF["kind"]>; d: number; headR: number; back: number } {
  const kind = f.kind ?? (f.cbDiameter > f.diameter && f.cbDepth > 0 ? "counterbore" : "simple");
  let d = f.diameter;
  if (kind === "tapped") {
    const t = threadByName(f.thread);
    if (!t) throw new Error(tr("Neznámý závit „{0}“ – {1}.", f.thread ?? "", tr(THREAD_HINT)));
    d = t.tap;
  }
  if (!(d > 0)) throw new Error(tr("Průměr díry musí být kladný."));
  const rd = d / 2;
  const headR = kind === "counterbore" ? Math.max(rd, f.cbDiameter / 2) : kind === "countersink" ? Math.max(rd, (f.csDiameter ?? 0) / 2) : rd;
  return { kind, d, headR, back: Math.max(headR, 0.5) };
}

/**
 * Nástroj jedné díry v bodě `at`, vrtané ve směru `dir` (jednotkový). `end.flat` = rovné dno (ukončení k ploše).
 * `strict` = bez nástupu nad bodem (přesně od bodu) – pro kontrolu, že díra ve směru vrtání opravdu zasáhne materiál.
 */
function holeToolAt(f: HoleF, body: Shape | null, at: Vec3, dir: Vec3, end: { through: boolean; depth: number; flat: boolean }, strict = false): Shape {
  const { kind, d, back } = holeHead(f);
  const big = body ? bboxDiag(body) * 2 + V.len(V.sub(at, body.boundingBox.center as Vec3)) * 2 + 10 : 1000;
  const rd = d / 2;
  // Díra začíná v zadaném bodě a vrtá jen ve směru vrtání. Nad bodem se odebere jen krátký nástup (poloměr hlavy díry) –
  // čistý začátek na šikmé nebo válcové ploše; materiál dál nad bodem (protější stěna) zůstane. `bothWays` = skrz oběma směry.
  const B = f.bothWays && end.through ? big : strict ? 0 : back;
  const pts: [number, number][] = [[0, -B]];
  if (kind === "counterbore") {
    if (!(f.cbDiameter > d && f.cbDepth > 0)) throw new Error(tr("Zahloubení musí mít větší průměr než díra a kladnou hloubku."));
    pts.push([f.cbDiameter / 2, -B], [f.cbDiameter / 2, f.cbDepth], [rd, f.cbDepth]);
  } else if (kind === "countersink") {
    const csD = f.csDiameter ?? 0;
    if (!(csD > d)) throw new Error(tr("Průměr kuželového zahloubení musí být větší než průměr díry."));
    const angle = Math.min(170, Math.max(30, f.csAngle ?? 90));
    pts.push([csD / 2, -B], [csD / 2, 0], [rd, csDepthOf(csD, d, angle)]);
  } else pts.push([rd, -B]);
  if (end.through) pts.push([rd, big], [0, big]);
  else {
    if (!(end.depth > 0)) throw new Error(tr("Hloubka díry musí být kladná."));
    if (kind === "counterbore" && end.depth <= f.cbDepth) throw new Error(tr("Hloubka díry musí být větší než hloubka zahloubení."));
    const tip = Math.min(170, Math.max(60, f.tipAngle ?? 118));
    pts.push([rd, end.depth], [0, end.flat ? end.depth : end.depth + rd / Math.tan((tip * Math.PI) / 360)]);
  }
  // bez nástupu (strict) splývají dva body profilu zahloubení – nulová úsečka by jádro shodila
  const clean = pts.filter((q, i) => i === 0 || Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1]) > 1e-9);
  return revolvedAlongAny(clean, dir, at);
}

/** Rotační profil (r, t) kolem +Z → natočený do libovolného jednotkového směru `dir`, posunutý do `at`. */
function revolvedAlongAny(profile: [number, number][], dir: Vec3, at: Vec3): Shape {
  let pen = r.draw(profile[0]);
  for (const p of profile.slice(1)) pen = pen.lineTo(p);
  let s = pen.close().sketchOnPlane("XZ").revolve([0, 0, 1]) as Shape;
  const z: Vec3 = [0, 0, 1];
  const c = V.dot(z, dir);
  if (c < -0.999999) s = s.rotate(180, [0, 0, 0], [1, 0, 0]);
  else if (c < 0.999999) {
    const ax = V.norm(V.cross(z, dir));
    s = s.rotate((Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI, [0, 0, 0], ax);
  }
  return s.translate(at);
}

/** Všechny díry prvku (více poloh), s ukončením slepá / skrz / k dalšímu / k ploše. */
function holeTools(f: HoleF, ctx: Ctx, strict = false): Shape {
  const rc = rctx(ctx);
  const body = ctx.body;
  const pts: Vec3[] = f.points?.length ? f.points.map((p) => pointOf(rc, p, tr("bod díry"))) : [f.position];
  let dir: Vec3;
  if (f.dirDef) {
    const d = resolveDirection(rc, f.dirDef, { normal: axisVec(f.axis) });
    dir = f.flip ? d : V.mul(d, -1); // výchozí: vrtání proti směru (shora dolů)
  } else dir = axisVec(f.axis).map((v) => (f.flip ? v : -v)) as Vec3;
  const end = f.end ?? (f.depth > 0 ? { kind: "blind" as const } : { kind: "throughAll" as const });
  const tools = pts.map((at) => {
    if (end.kind === "blind") return holeToolAt(f, body, at, dir, { through: false, depth: f.depth, flat: false }, strict);
    if (end.kind === "throughAll") return holeToolAt(f, body, at, dir, { through: true, depth: 0, flat: false }, strict);
    if (end.kind === "toFace") {
      const g = resolveRef(rc, end.ref);
      if (!g.plane || g.radius) throw new Error(tr("Ukončení díry „k ploše“ vyžaduje rovinnou plochu nebo pomocnou rovinu."));
      const n = g.plane.normal;
      const den = V.dot(dir, n);
      if (Math.abs(den) < 1e-9) throw new Error(tr("Cílová plocha je rovnoběžná s osou díry."));
      const o2 = V.add(g.plane.origin, V.mul(n, (end.offset ?? 0) * (den > 0 ? -1 : 1)));
      const t = V.dot(V.sub(o2, at), n) / den;
      if (!(t > 1e-6)) throw new Error(tr("Cílová plocha neleží ve směru vrtání (zkuste obrátit směr)."));
      return holeToolAt(f, body, at, dir, { through: false, depth: t, flat: true }, strict);
    }
    if (!body) throw new Error(tr("Ukončení „k dalšímu“ potřebuje těleso."));
    const T = holeToolAt(f, body, at, dir, { through: true, depth: 0, flat: false }, strict);
    const inside = T.intersect(body);
    return nearestSolid(inside, at, dir).solid;
  });
  return tools.reduce((a, b) => a.fuse(b));
}

/**
 * Profil (r, t) zjednodušeného modelovaného závitu: soustava V-drážek (bez stoupání – vizuálně i hmotnostně odpovídá závitu).
 * Vnější: prstenec vně válce Ø d s drážkami dovnitř. Vnitřní (v díře Ø jádra): jádro uvnitř díry s drážkami ven (do materiálu).
 */
export function threadProfile(t: { d: number; pitch: number }, length: number, internal = false): [number, number][] {
  const n = Math.max(1, Math.round(length / t.pitch));
  const P = length / n;
  const R = t.d / 2;
  const rmin = R - 0.6134 * t.pitch;
  if (internal) {
    // nástroj od osy po zuby: valley rmin (ve vzduchu díry), špička R (v materiálu)
    const pts: [number, number][] = [[0, 0], [0, length], [rmin, length]];
    for (let k = n - 1; k >= 0; k--) pts.push([R, k * P + P / 2], [rmin, k * P]);
    return pts;
  }
  const Rout = R + t.pitch + 1;
  const pts: [number, number][] = [[Rout, 0], [Rout, length], [R, length]];
  for (let k = n - 1; k >= 0; k--) pts.push([rmin, k * P + P / 2], [R, k * P]);
  return pts;
}

export const THREAD_HINT = "zadejte M2 až M48, hrubé nebo jemné stoupání (např. M18×1,5)";

/** Zjednodušený modelovaný závit: soustava V-drážek (vizuálně i hmotnostně odpovídá závitu). */
function threadTool(f: Extract<Feature, { type: "thread" }>): Shape {
  const t = threadByName(f.designation);
  if (!t) throw new Error(tr("Neznámý závit „{0}“ – {1}.", f.designation, tr(THREAD_HINT)));
  if (!(f.length > 0)) throw new Error(tr("Délka závitu musí být kladná."));
  return revolved(threadProfile(t, f.length, f.internal), f.axis, f.position);
}

type ExtrudeF = Extract<Feature, { type: "extrude" }>;

/**
 * Vysunutí se všemi způsoby zadání: začátek (rovina skici / odsazení / od plochy / od vrcholu), směr (normála / osa /
 * hrana / 2 body / normála plochy / vektor / úhel), ukončení (na vzdálenost / skrz vše / k dalšímu / k vrcholu /
 * k ploše / odsazeně od plochy / k tělesu / střední rovina), nezávislý druhý směr, tenká stěna, úkos, kroucení, měřítko konce.
 */
function extrudeTool(f: ExtrudeF, ctx: Ctx): Shape {
  const sk = needSketch(ctx, f.sketchId);
  const rc = rctx(ctx);
  let plane = planeOf(sk.plane);
  const n0 = V.norm(vec(plane.zDir));
  const xDir = vec(plane.xDir);
  const origin0 = vec(plane.origin);
  // začátek
  let shift = 0;
  if (f.from?.kind === "offset") shift = f.from.d;
  else if (f.from?.kind === "face" || f.from?.kind === "vertex") shift = V.dot(V.sub(pointOf(rc, f.from.ref, f.from.kind === "face" ? tr("plochu začátku") : tr("vrchol začátku")), origin0), n0);
  const shiftV = V.mul(n0, shift);
  if (shift) plane = plane.translate(shiftV);
  const origin = V.add(origin0, shiftV);
  // směr
  const dirV = resolveDirection(rc, f.dir, { normal: n0, xDir });
  if (Math.abs(V.dot(dirV, n0)) < 1e-6) throw new Error(tr("Směr vysunutí nesmí ležet v rovině skici."));
  const d1 = f.reverse ? V.mul(dirV, -1) : dirV;
  const ext1: Extent = f.extent ?? (f.symmetric ? { kind: "midPlane", d: f.distance } : { kind: "blind", d: f.distance });
  const sketch = () => profileSketch(sk, plane, { outerOnly: f.outerOnly, thin: f.thin }, shiftV);
  const body = ctx.body;
  const big = body ? bboxDiag(body) * 2 + V.len(V.sub(origin, body.boundingBox.center as Vec3)) * 2 + 10 : 1000;
  const draft = f.draftAngle ?? 0;

  const side = (dir: Vec3, ext: Extent): Shape => {
    const blind = (dist: number): Shape => {
      if (!(dist > 1e-9)) throw new Error(tr("Vzdálenost vysunutí musí být kladná."));
      if (Math.abs(draft) > 1e-6) {
        if (Math.abs(draft) >= 45) throw new Error(tr("Úkos vysunutí musí být menší než 45°."));
        if (Math.abs(Math.abs(V.dot(dir, n0)) - 1) > 1e-6) throw new Error(tr("Úkos lze použít jen při vysunutí kolmo na skicu."));
        if (f.thin) throw new Error(tr("Úkos a tenkou stěnu nelze kombinovat."));
        const off = dist * Math.tan((draft * Math.PI) / 180);
        const sh = V.mul(dir, dist);
        return combine(
          sketchWires(sk, plane).map(({ wire, depth }) => {
            const inward = depth % 2 === 0 ? -off : off; // vnější obrys se zužuje, otvory rozšiřují
            const top = wire.clone().offset2D(inward).translate(sh);
            return { solid: r.loft([wire, top], { ruled: true }), depth };
          }),
        );
      }
      const opts: { extrusionDirection: Vec3; twistAngle?: number; extrusionProfile?: { profile: "linear"; endFactor: number } } = { extrusionDirection: dir };
      if (f.twist) opts.twistAngle = f.twist;
      if (f.endScale && Math.abs(f.endScale - 1) > 1e-9) opts.extrusionProfile = { profile: "linear", endFactor: f.endScale };
      return sketch().extrude(dist, opts) as Shape;
    };
    switch (ext.kind) {
      case "blind":
        return blind(ext.d);
      case "midPlane":
        return blind(ext.d).translate(V.mul(dir, -ext.d / 2)) as Shape;
      case "throughAll":
        return blind(big);
      case "toVertex": {
        const p = pointOf(rc, ext.ref, tr("vrchol ukončení"));
        const t = V.dot(V.sub(p, origin), dir);
        if (!(t > 1e-6)) throw new Error(tr("Vybraný bod neleží před rovinou skici ve směru vysunutí (zkuste Opačný směr)."));
        return blind(t);
      }
      case "toFace":
      case "offsetFromFace": {
        const off = ext.kind === "toFace" ? (ext.offset ?? 0) : ext.d;
        const g = resolveRef(rc, ext.ref);
        if (g.plane && !g.radius) {
          // rovinná plocha / pomocná rovina: přesně rovinným řezem (platí i pro šikmou plochu)
          const nn = g.plane.normal;
          const den = V.dot(dir, nn);
          if (Math.abs(den) < 1e-9) throw new Error(tr("Cílová plocha je rovnoběžná se směrem vysunutí."));
          const toward = V.mul(nn, den > 0 ? -1 : 1); // normála mířící zpět k profilu
          const o2 = V.add(g.plane.origin, V.mul(toward, off));
          const tC = V.dot(V.sub(o2, origin), nn) / den;
          if (!(tC > 1e-6)) throw new Error(tr("Cílová plocha neleží před rovinou skici ve směru vysunutí (zkuste Opačný směr)."));
          const T = blind(big);
          const res = T.split(new r.Plane(o2, V.perp(nn), nn));
          const keep = asShape(V.dot(V.sub(origin, o2), nn) >= 0 ? res.positive : res.negative);
          if (!keep) throw new Error(tr("Vysunutí k ploše nevytvořilo těleso."));
          return keep;
        }
        if (off) throw new Error(tr("Odsazení lze použít jen u rovinné plochy nebo pomocné roviny."));
        if (!body || ext.ref.kind !== "face") throw new Error(tr("Vyberte plochu tělesa."));
        const i = entityIndex(body, "face", ext.ref.index, ext.ref.sig);
        try {
          return sketch().extrudeUntil(body.faces[i], { extrusionDirection: dir }) as Shape;
        } catch {
          throw new Error(tr("Vysunutí k zakřivené ploše se nezdařilo – plocha musí celý profil zakrýt. Zkuste „K dalšímu“ nebo rovinnou plochu."));
        }
      }
      case "toNext":
      case "toBody": {
        if (!body) throw new Error(tr("Ukončení „k dalšímu“ potřebuje stávající těleso."));
        const T = blind(big);
        const removing = f.mode === "cut" || f.mode === "intersect";
        const parts = removing ? T.intersect(body) : T.cut(body);
        const near = nearestSolid(parts, origin, dir);
        if (!removing && near.far > big * 0.95) throw new Error(tr("Ve směru vysunutí není další plocha tělesa (použijte Na vzdálenost nebo Skrz vše)."));
        return near.solid;
      }
    }
  };
  let tool = side(d1, ext1);
  if (f.extent2) tool = tool.fuse(side(V.mul(d1, -1), f.extent2));
  return tool;
}

type RevolveF = Extract<Feature, { type: "revolve" }>;

/** Rotace: osa 8 způsoby, úhel v jednom / obou směrech / symetricky, tenká stěna. */
function revolveTool(f: RevolveF, ctx: Ctx): Shape {
  const sk = needSketch(ctx, f.sketchId);
  const rc = rctx(ctx);
  const plane = planeOf(sk.plane);
  const ax = resolveAxis(rc, f.axisDef, sk, f.axis);
  const prof = () => profileSketch(sk, plane, { thin: f.thin });
  const a1 = Math.max(0.01, Math.min(360, f.angle || 360));
  const rev = (dir: Vec3, angle: number) => prof().revolve(dir, { origin: ax.origin, angle }) as Shape;
  let s = rev(ax.dir, a1);
  if (f.symmetric && a1 < 360) s = s.rotate(-a1 / 2, ax.origin, ax.dir) as Shape;
  else if (f.angle2 && f.angle2 > 0 && a1 < 360) s = s.fuse(rev(V.mul(ax.dir, -1), Math.min(360 - a1, f.angle2)));
  return s;
}

/** Nástrojové těleso prvku (pro pole/zrcadlení) — null u prvků, které nástroj nemají. */
async function toolOf(f: Feature, ctx: Ctx): Promise<Shape | null> {
  switch (f.type) {
    case "extrude":
      return extrudeTool(f, ctx);
    case "revolve":
      return revolveTool(f, ctx);
    case "sweep": {
      const prof = needSketch(ctx, f.profileId, tr("skica profilu"));
      const path = needSketch(ctx, f.pathId, tr("skica dráhy"));
      if (prof.id === path.id) throw new Error(tr("Profil a dráha musí být dvě různé skici."));
      const spine = sketchPathWire(path);
      return combine(
        sketchWires(prof).map(({ wire, depth }) => {
          const s = r.genericSweep(wire, spine, { frenet: f.frenet, transitionMode: "right" }) as Shape;
          return { solid: s, depth };
        }),
      );
    }
    case "loft": {
      if (f.sketchIds.length < 2) throw new Error(tr("Šablonování potřebuje alespoň dvě skici (profily)."));
      const sets = f.sketchIds.map((id, k) => sketchWires(needSketch(ctx, id, `skica ${k + 1}`)));
      const outer = sets.map((ws) => ws.filter((w) => w.depth === 0).sort((a, b) => b.area - a.area)[0]?.wire);
      if (outer.some((w) => !w)) throw new Error(tr("Každá skica musí mít uzavřený vnější profil."));
      let s = r.loft(outer as r.Wire[], { ruled: f.ruled }) as Shape;
      // otvory: jen pokud mají všechny skici stejný počet
      const holes = sets.map((ws) => ws.filter((w) => w.depth === 1).sort((a, b) => b.area - a.area));
      if (holes[0].length && holes.every((h) => h.length === holes[0].length)) {
        for (let k = 0; k < holes[0].length; k++) s = s.cut(r.loft(holes.map((h) => h[k].wire), { ruled: f.ruled }));
      }
      return s;
    }
    case "box": {
      const [w, h, d] = f.size;
      if (!(w > 0 && h > 0 && d > 0)) throw new Error(tr("Rozměry musí být kladné."));
      const [x, y, z] = f.position;
      const c1: Vec3 = f.centered ? [x - w / 2, y - h / 2, z - d / 2] : [x, y, z];
      return r.makeBox(c1, [c1[0] + w, c1[1] + h, c1[2] + d]);
    }
    case "cylinder":
      if (!(f.radius > 0 && f.height > 0)) throw new Error(tr("Rozměry musí být kladné."));
      return r.makeCylinder(f.radius, f.height, f.position, axisVec(f.axis));
    case "sphere":
      if (!(f.radius > 0)) throw new Error(tr("Poloměr musí být kladný."));
      return r.makeSphere(f.radius).translate(f.position);
    case "cone":
      if (!(f.height > 0) || f.radius1 < 0 || f.radius2 < 0 || f.radius1 + f.radius2 <= 0) throw new Error(tr("Neplatné rozměry kuželu."));
      return revolved(
        [[0, 0], [Math.max(f.radius1, 1e-4), 0], [Math.max(f.radius2, 1e-4), f.height], [0, f.height]],
        f.axis,
        f.position,
      );
    case "tube": {
      if (!(f.outer > f.inner && f.inner >= 0 && f.height > 0)) throw new Error(tr("Vnější průměr musí být větší než vnitřní."));
      let t = r.makeCylinder(f.outer / 2, f.height) as Shape;
      if (f.inner > 0) t = t.cut(r.makeCylinder(f.inner / 2, f.height));
      return oriented(t, f.axis, f.position);
    }
    case "hole":
      return holeTools(f, ctx);
    case "thread":
      return f.modeled ? threadTool(f) : null;
    case "text": {
      if (!f.text.trim()) throw new Error(tr("Zadejte text."));
      if (!(f.height > 0 && f.depth > 0)) throw new Error(tr("Výška písma a hloubka musí být kladné."));
      await ensureFont();
      let d = r.drawText(f.text, { fontSize: f.height, fontFamily: FONT_FAMILY });
      const c = d.boundingBox.center;
      d = d.translate(-c[0], -c[1]);
      if (f.angle) d = d.rotate(f.angle, [0, 0]);
      d = d.translate(f.position[0], f.position[1]);
      const plane = planeOf(f.plane);
      // gravírování jde proti normále roviny (do materiálu), vystouplý text po normále
      const s = d.sketchOnPlane(plane).extrude(f.mode === "cut" ? -f.depth : f.depth) as Shape;
      return s;
    }
    case "spring":
      return springSolid(f);
    default:
      return null;
  }
}

function modeOf(f: Feature): BoolMode {
  if (f.type === "hole" || f.type === "thread") return "cut";
  return "mode" in f ? f.mode : "add";
}

export function edgeFilter(body: Shape, edges: number[] | "all") {
  if (edges === "all") return null;
  const all = body.edges;
  const picked = edges.map((i) => all[i]).filter(Boolean);
  if (!picked.length) throw new Error(tr("Vyberte hrany v modelu."));
  return picked;
}

/** Rovina kolmá na osu (XY ⟂ Z, XZ ⟂ Y, YZ ⟂ X) posunutá o `offset` v kladném směru osy. */
export function axisPlane(name: PlaneName, offset: number): r.Plane {
  if (name === "XY") return new r.Plane([0, 0, offset], [1, 0, 0], [0, 0, 1]);
  if (name === "XZ") return new r.Plane([0, offset, 0], [1, 0, 0], [0, 1, 0]);
  return new r.Plane([offset, 0, 0], [0, 1, 0], [1, 0, 0]);
}

function asShape(s: unknown): Shape | null {
  return s ? (s as Shape) : null;
}

/** Vrátí výsledné těleso po prvek `untilIndex` (vč.) + stav prvků. Proměnné, vazby a aktivní stav se uplatní předem. */
export type Resolved = NonNullable<BuildResult["resolved"]>;

/** Průběh stavby: právě počítaný prvek (index od 0) z celkového počtu; `phase: "mesh"` = závěrečný výpočet sítě. */
export type BuildProgress = { index: number; total: number; id?: string; name?: string; type?: string; phase: "feature" | "mesh" };
export type BuildProgressFn = (p: BuildProgress) => void;

/** Těleso dílu s názvem (více těles): první v seznamu je aktivní. */
export type NamedBody = { name: string; shape: Shape };

// ── mezipaměť stavby ──────────────────────────────────────────────────────────────────────────────────────────────
// Stav po prvcích, jejichž výpočet trval déle. Další stavba dokumentu se stejným začátkem historie (přidaný prvek na konci,
// úprava posledního prvku, návrat v historii, opakovaná stavba téhož dokumentu) začne od posledního shodného stavu místo od
// nuly. Tvary se po vzniku nemění, proto stačí držet jejich kopie (kopie = další odkaz na tutéž geometrii, levné).
type ToolEntry = { tool: Shape; mode: BoolMode };
type Checkpoint = {
  /** počet prvků, po kterých stav platí */
  n: number;
  ms: number;
  body: Shape | null;
  bodySig: ShapeSignature | null;
  others: [string, Shape][];
  activeName: string;
  sketches: [string, SketchF][];
  tools: [string, ToolEntry][];
  status: FeatureStatus[];
  features: Feature[];
  resolved: Resolved;
};
type Chain = { docKey: string; keys: string[]; points: Checkpoint[]; used: number };
const CHAIN_MAX = 3; // model, výkres (závity zjednodušeně) a jeden další dokument vedle sebe
const CHECKPOINT_MIN_MS = 0; // stav se ukládá po každém prvku (kopie tvaru je jen další odkaz); počet stavů hlídá CHECKPOINT_MAX
const CHECKPOINT_MAX = 24;
let chains: Chain[] = [];
let chainClock = 0;
/** Zahodí mezipaměť stavby (testy, uvolnění paměti). */
export function clearBuildCache() {
  chains = [];
  lastDocResult = null;
}
/** vstupy na úrovni dokumentu, které mohou ovlivnit geometrii prvků */
const docKeyOf = (d: CadDoc) => JSON.stringify([d.variables ?? null, d.bindings ?? null, d.configs ?? null, d.activeConfig ?? null, d.material, d.kind ?? "part"]);

/**
 * `opts.preferActive`: po stavbě přepne aktivní těleso na `doc.activeBody` (jen pro zobrazení v editoru dílu – aktivní těleso je
 * ve výsledném složeném tvaru první, takže indexy jeho ploch a hran souhlasí s tím, co prvky ukládají). Komponenty sestav se staví bez toho.
 */
export async function buildShape(input: CadDoc, untilIndex = Infinity, opts: { preferActive?: boolean; onProgress?: BuildProgressFn; noCache?: boolean } = {}): Promise<{ body: Shape | null; status: FeatureStatus[]; paramErrors: string[]; resolved: Resolved; bodies: NamedBody[] }> {
  const { doc, errors: paramErrors } = resolveDoc(input);
  const sketches = new Map<string, SketchF>();
  const tools = new Map<string, ToolEntry>();
  const status: FeatureStatus[] = [];
  const features: Feature[] = doc.features.slice(); // vyřešené skici / pomocné roviny nahrazují původní (pro odkazy)
  const resolved: Resolved = { planes: {}, datums: {} };
  let body: Shape | null = null;
  /** podpis aktuálního tělesa (objem, plochy, hrany) – pro zjištění, že prvek těleso nezměnil */
  let bodySig: ShapeSignature | null = null;
  // ── více těles: `body` je aktivní těleso `activeName`, ostatní čekají v `others` (viz bodies.ts) ──
  const others = new Map<string, Shape>();
  let activeName = DEFAULT_BODY;
  const bodyNames = () => [activeName, ...others.keys()];
  /** přepne aktivní těleso na existující odložené */
  const activate = (name: string) => {
    const s = others.get(name);
    if (!s) throw new Error(tr("Těleso „{0}“ v dílu není (tělesa: {1}).", name, bodyNames().join(", ")));
    if (body) others.set(activeName, body);
    others.delete(name);
    body = s;
    activeName = name;
    bodySig = signatureOf(body);
  };
  const shapeOfBody = (name: string): Shape | null => (name === activeName ? body : (others.get(name) ?? null));
  const ctxOf = (): Ctx => ({ sketches, body, features });
  /** Dokončení prvku: kontrola, že se operace projevila a že výsledek je platné objemové těleso → ✓ / ⚠ / ✗. */
  const finish = (f: Feature, next: Shape | null): Shape | null => {
    if (next === body || !next) {
      status.push({ id: f.id, ok: true });
      return next;
    }
    const sig = signatureOf(next);
    let warning: string | undefined;
    if (body && expectsChange(f) && sameSignature(bodySig, sig)) {
      if (f.type === "shell") throw new Error(tr("Skořepinu se nepodařilo vytvořit – jádro vrátilo těleso beze změny. Otevřete jen rovinné plochy (zaoblené plochy jádro otevřít neumí); u zaoblených hran musí být tloušťka stěny menší než poloměr zaoblení, nebo zaoblete až po skořepině."));
      warning = tr("Prvek těleso nezměnil (objem i počet ploch zůstaly stejné) – nástroj se s tělesem nepřekrývá, leží mimo něj, nebo operace v jádře selhala. Zkontrolujte polohu a rozměry.");
    }
    // platnost výsledku: jen u prvků, které mění těleso (jinak by se kontrola opakovala zbytečně); velká tělesa se kontrolují až na konci
    if (expectsChange(f) && sig && sig.faces <= 400) {
      let chk = checkShape(next);
      if (body && bodySig && !chk.solids && bodySig.faces > 0) throw new Error(tr("Operace nevrátila objemové těleso ({0}) – jádro selhalo; změňte parametry (dráha se nesmí protínat ani být tečná k povrchu, profil musí být uzavřený a kolmý na dráhu).", describeCheck(chk)));
      if (!chk.valid) {
        const fixed = tryFixShape(next);
        if (fixed) {
          next = fixed;
          chk = checkShape(next);
        }
      }
      if (!chk.valid) warning = (warning ? warning + " " : "") + tr("Výsledek má neplatnou geometrii (sebeprotínající nebo neorientovatelné plochy) – export STEP může selhat. Změňte parametry: profil nesmí být tečný k povrchu tělesa, dráha se nesmí protínat.");
    }
    bodySig = sig;
    status.push(warning ? { id: f.id, ok: true, warning } : { id: f.id, ok: true });
    return next;
  };

  // ── mezipaměť: najít nejdelší shodný začátek historie a navázat na uložený stav ──
  const count = Math.min(doc.features.length, untilIndex === Infinity ? doc.features.length : untilIndex + 1);
  let start = 0;
  let mine: Chain | null = null;
  if (!opts.noCache) {
    const docKey = docKeyOf(doc);
    const keys = doc.features.slice(0, count).map((f) => JSON.stringify(f));
    let best: Chain | null = null;
    let bestLen = 0;
    for (const c of chains) {
      if (c.docKey !== docKey) continue;
      let m = 0;
      while (m < keys.length && m < c.keys.length && keys[m] === c.keys[m]) m++;
      if (m > bestLen) {
        best = c;
        bestLen = m;
      }
    }
    const cp = best ? best.points.filter((p) => p.n <= bestLen).sort((a, b) => b.n - a.n)[0] : undefined;
    mine = { docKey, keys, points: best ? best.points.filter((p) => p.n <= bestLen) : [], used: ++chainClock };
    if (cp) {
      start = cp.n;
      body = cp.body ? (cp.body.clone() as Shape) : null;
      bodySig = cp.bodySig;
      for (const [k, v] of cp.others) others.set(k, v.clone() as Shape);
      activeName = cp.activeName;
      for (const [k, v] of cp.sketches) sketches.set(k, v);
      for (const [k, v] of cp.tools) tools.set(k, { tool: v.tool.clone() as Shape, mode: v.mode });
      status.push(...cp.status.map((x) => ({ ...x })));
      for (let i = 0; i < cp.n; i++) features[i] = cp.features[i];
      Object.assign(resolved.planes, cp.resolved.planes);
      Object.assign(resolved.datums, cp.resolved.datums);
    }
    // řetěz, na který se navázalo, se nahradí; jinak se uvolní nejdéle nepoužitý
    chains = chains.filter((c) => c !== best);
    chains.push(mine);
    if (chains.length > CHAIN_MAX) chains = chains.sort((a, b) => b.used - a.used).slice(0, CHAIN_MAX);
  }
  /** uloží stav po `n` prvcích (kopie tvarů – původní objekty může další prvek spotřebovat) */
  const checkpoint = (n: number, ms: number) => {
    if (!mine) return;
    mine.points = mine.points.filter((p) => p.n !== n);
    mine.points.push({
      n,
      ms,
      body: body ? (body.clone() as Shape) : null,
      bodySig,
      others: [...others].map(([k, v]) => [k, v.clone() as Shape]),
      activeName,
      sketches: [...sketches],
      tools: [...tools].map(([k, v]) => [k, { tool: v.tool.clone() as Shape, mode: v.mode }]),
      status: status.map((x) => ({ ...x })),
      features: features.slice(0, n),
      resolved: { planes: { ...resolved.planes }, datums: { ...resolved.datums } },
    });
    if (mine.points.length > CHECKPOINT_MAX) {
      // vyřadit nejlevnější stav (jeho prvek se příště přepočítá nejrychleji); poslední stav zůstává
      const last = Math.max(...mine.points.map((p) => p.n));
      const drop = mine.points.filter((p) => p.n !== last).sort((a, b) => a.ms - b.ms)[0];
      mine.points = mine.points.filter((p) => p !== drop);
    }
  };

  for (let i = start; i < doc.features.length && i <= untilIndex; i++) {
    const f = doc.features[i];
    if (f.suppressed) {
      status.push({ id: f.id, ok: true });
      if (f.type === "sketch") sketches.set(f.id, f);
      continue;
    }
    /** stav před založením nového tělesa – při chybě prvku se vrátí */
    let startedNew: { name: string } | null = null;
    const tFeature = Date.now();
    const nStatus = status.length;
    opts.onProgress?.({ index: i, total: doc.features.length, id: f.id, name: f.name, type: f.type, phase: "feature" });
    try {
      if (f.body && f.body !== activeName) {
        if (others.has(f.body)) activate(f.body);
        else if (!body) activeName = f.body; // první těleso s vlastním názvem
        else if (isNewBodyMode(f)) {
          startedNew = { name: activeName };
          others.set(activeName, body);
          body = null;
          bodySig = null;
          activeName = f.body;
        } else throw new Error(tr("Těleso „{0}“ v dílu není – zvolte existující těleso, nebo operaci „Nové těleso“.", f.body));
      }
      let next: Shape | null = body;
      const custom = f.type !== "sketch" && f.type !== "datum" && f.type !== "ext" ? getFeatureBuilder(f.type) : undefined;
      if (custom) {
        const out = await custom(f, { body, sketches, features, tools, index: i, doc });
        if (out !== null && out !== undefined) next = out;
        body = finish(f, next);
        continue;
      }
      switch (f.type) {
        case "sketch": {
          if (!f.planeDef) {
            sketches.set(f.id, f);
            break;
          }
          try {
            const plane = planeDefToSketchPlane(rctx(ctxOf()), f.planeDef, planeDefLabel(f.planeDef));
            const sk: SketchF = { ...f, plane };
            sketches.set(f.id, sk);
            features[i] = sk;
            resolved.planes[f.id] = plane;
          } catch (e) {
            sketches.set(f.id, f); // rovinu nelze vyřešit – použije se poslední známá
            throw e;
          }
          break;
        }
        case "datum": {
          if (f.planeDef) {
            const p = resolvePlaneDef(rctx(ctxOf()), f.planeDef);
            features[i] = { ...f, origin: p.origin, normal: p.normal, xDir: p.xDir };
            resolved.datums[f.id] = p;
          }
          if (Math.hypot(...f.normal) < 1e-9) throw new Error(tr("Normála roviny nesmí být nulová."));
          break;
        }
        case "import": {
          const s = await importBody(f);
          next = body ? body.fuse(s) : s;
          break;
        }
        case "fillet":
        case "chamfer": {
          if (!body) throw new Error(tr("Není co zaoblit – nejdřív vytvořte těleso."));
          const size = f.type === "fillet" ? f.radius : f.distance;
          if (!(size > 0)) throw new Error(tr("Hodnota musí být kladná."));
          const picked = edgeFilter(body, f.edges);
          const cfg = picked ? (e: r.Edge) => (picked.some((p) => p.isSame(e)) ? size : null) : size;
          next = f.type === "fillet" ? body.clone().fillet(cfg as never) : body.clone().chamfer(cfg as never);
          break;
        }
        case "shell": {
          if (!body) throw new Error(tr("Není co skořepinovat."));
          if (!(f.thickness > 0)) throw new Error(tr("Tloušťka musí být kladná."));
          const all = body.faces;
          const picked = f.faces.map((k) => all[k]).filter(Boolean);
          if (!picked.length) throw new Error(tr("Vyberte plochy, které se mají otevřít."));
          next = body.clone().shell(Math.abs(f.thickness), (ff) => ff.when(({ element }) => picked.some((p) => p.isSame(element as r.Face))));
          break;
        }
        case "draft": {
          if (!body) throw new Error(tr("Není těleso pro úkos."));
          if (!(Math.abs(f.angle) > 0 && Math.abs(f.angle) < 45)) throw new Error(tr("Úhel úkosu musí být mezi 0 a 45°."));
          const all = body.faces;
          const picked = f.faces.map((k) => all[k]).filter(Boolean);
          if (!picked.length) throw new Error(tr("Vyberte plochy, které se mají zkosit."));
          const neutral = f.planeDef ? planeFrom(resolvePlaneDef(rctx(ctxOf()), f.planeDef)) : axisPlane(f.plane, f.offset);
          next = body.clone().draft(f.angle, (ff) => ff.when(({ element }) => picked.some((p) => p.isSame(element as r.Face))), neutral);
          break;
        }
        case "split": {
          if (!body) throw new Error(tr("Není co rozříznout."));
          const res = body.clone().split(f.planeDef ? planeFrom(resolvePlaneDef(rctx(ctxOf()), f.planeDef)) : axisPlane(f.plane, f.offset));
          const keep = asShape(f.keep === "positive" ? res.positive : res.negative);
          if (!keep) throw new Error(tr("Na zvolené straně roviny nic nezůstane – změňte stranu nebo posunutí."));
          next = keep;
          break;
        }
        case "splitBodies": {
          if (!body) throw new Error(tr("Není co rozdělit – nejdřív vytvořte těleso."));
          const res = body.clone().split(f.planeDef ? planeFrom(resolvePlaneDef(rctx(ctxOf()), f.planeDef)) : axisPlane(f.plane, f.offset));
          const pos = asShape(res.positive);
          const neg = asShape(res.negative);
          if (!pos || !neg || !solidsOf(pos).length || !solidsOf(neg).length) throw new Error(tr("Rovina těleso nerozdělí – musí jím procházet (změňte rovinu nebo posunutí)."));
          const nameB = f.nameB?.trim() || nextBodyName(bodyNames());
          if (bodyNames().includes(nameB)) throw new Error(tr("Těleso „{0}“ už v dílu je – zvolte jiný název.", nameB));
          others.set(nameB, deepCopy(neg));
          next = pos;
          break;
        }
        case "copyBody": {
          const srcName = f.source?.trim() || activeName;
          const src = shapeOfBody(srcName);
          if (!src) throw new Error(tr("Těleso „{0}“ v dílu není (tělesa: {1}).", srcName, bodyNames().join(", ")));
          const name = f.newName?.trim() || nextBodyName(bodyNames());
          if (bodyNames().includes(name)) throw new Error(tr("Těleso „{0}“ už v dílu je – zvolte jiný název.", name));
          let copy = deepCopy(src);
          if (f.translate.some((v) => v)) copy = copy.translate(f.translate);
          others.set(name, copy);
          break; // aktivní těleso se nemění
        }
        case "combine": {
          const targetName = f.target?.trim() || activeName;
          const toolName = f.tool?.trim();
          if (!toolName) throw new Error(tr("Vyberte nástrojové těleso."));
          if (toolName === targetName) throw new Error(tr("Cílové a nástrojové těleso musí být dvě různá tělesa."));
          if (!shapeOfBody(targetName)) throw new Error(tr("Těleso „{0}“ v dílu není (tělesa: {1}).", targetName, bodyNames().join(", ")));
          if (!shapeOfBody(toolName)) throw new Error(tr("Těleso „{0}“ v dílu není (tělesa: {1}).", toolName, bodyNames().join(", ")));
          if (targetName !== activeName) activate(targetName); // výsledek patří cílovému tělesu – stane se aktivním
          // ponechaný nástroj: operace pracuje s jeho nezávislou kopií, aby výsledek s nástrojem nesdílel plochy
          const toolShape = f.keepTool ? deepCopy(others.get(toolName)!) : others.get(toolName)!;
          const target = body!;
          next = f.op === "cut" ? target.cut(toolShape) : f.op === "intersect" ? target.intersect(toolShape) : target.fuse(toolShape);
          if (!f.keepTool) others.delete(toolName);
          break;
        }
        case "transform": {
          if (!body) throw new Error(tr("Není těleso k transformaci."));
          if (!(f.scale > 0)) throw new Error(tr("Měřítko musí být kladné."));
          let s: Shape = body;
          if (Math.abs(f.scale - 1) > 1e-12) s = s.scale(f.scale, [0, 0, 0]);
          if (f.rotateAngle) s = s.rotate(f.rotateAngle, [0, 0, 0], axisVec(f.rotateAxis));
          if (f.translate.some((v) => v)) s = s.translate(f.translate);
          next = s;
          break;
        }
        case "pattern": {
          if (!body) throw new Error(tr("Není těleso."));
          const src = tools.get(f.featureId);
          if (!src) throw new Error(tr("Vyberte prvek (vysunutí, díra, primitivum…), který se má opakovat."));
          let acc: Shape = body;
          if (f.kind === "linear") {
            const n1 = Math.max(1, Math.round(f.count));
            const n2 = Math.max(1, Math.round(f.count2 ?? 1));
            const unit = (d: Vec3): Vec3 => {
              const len = Math.hypot(d[0], d[1], d[2]);
              if (!len) throw new Error(tr("Směr pole nesmí být nulový."));
              return [d[0] / len, d[1] / len, d[2] / len];
            };
            const d1 = unit(f.direction);
            const d2 = n2 > 1 ? unit(f.direction2 ?? [0, 1, 0]) : ([0, 0, 0] as Vec3);
            const s2 = f.spacing2 ?? f.spacing;
            if (n1 * n2 > 400) throw new Error(tr("Pole má příliš mnoho kusů (max. 400)."));
            for (let a = 0; a < n1; a++)
              for (let b = 0; b < n2; b++) {
                if (!a && !b) continue;
                const off: Vec3 = [0, 1, 2].map((k) => d1[k] * f.spacing * a + d2[k] * s2 * b) as Vec3;
                acc = applyMode(acc, src.tool.clone().translate(off), src.mode);
              }
          } else if (f.kind === "circular") {
            if (f.count > 400) throw new Error(tr("Pole má příliš mnoho kusů (max. 400)."));
            for (let k = 1; k < Math.max(1, Math.round(f.count)); k++) {
              const step = (f.angle >= 360 ? 360 / f.count : f.angle / Math.max(1, f.count - 1)) * k;
              acc = applyMode(acc, src.tool.clone().rotate(step, f.center, axisVec(f.axis)), src.mode);
            }
          } else throw new Error(tr("Tento typ pole (po křivce / podle skici / výplňové) zatím není v jádře k dispozici."));
          next = acc;
          break;
        }
        case "pushPull":
          if (!body) throw new Error(tr("Není těleso – nejdřív vytvořte nebo importujte model."));
          next = pushPull(body, f.faces, f.distance);
          break;
        case "offsetFace":
          if (!body) throw new Error(tr("Není těleso – nejdřív vytvořte nebo importujte model."));
          next = offsetFaces(body, f.faces, f.distance);
          break;
        case "deleteFace":
          if (!body) throw new Error(tr("Není těleso – nejdřív vytvořte nebo importujte model."));
          next = deleteFaces(body, f.faces);
          break;
        case "thicken": {
          if (!body) throw new Error(tr("Zesílení potřebuje těleso s plochami."));
          const tool = thickenFaces(body, f.faces, f.thickness);
          next = f.mode === "new" ? tool : applyMode(body, tool, f.mode);
          break;
        }
        case "rib": {
          if (!body) throw new Error(tr("Žebro potřebuje těleso, ke kterému se připojí."));
          const sk = needSketch(ctxOf(), f.sketchId, tr("skica žebra"));
          next = body.fuse(ribTool(body, sk, sketchChain(sk), planeOf(sk.plane), f.thickness, f.direction, f.flip));
          break;
        }
        case "mirror": {
          if (!body) throw new Error(tr("Není co zrcadlit."));
          const origin: Vec3 = f.plane === "YZ" ? [f.offset, 0, 0] : f.plane === "XZ" ? [0, f.offset, 0] : [0, 0, f.offset];
          const m = (f.planeDef ? body.clone().mirror(planeFrom(resolvePlaneDef(rctx(ctxOf()), f.planeDef))) : body.clone().mirror(f.plane, origin)) as Shape;
          next = f.keepOriginal ? body.fuse(m) : m;
          break;
        }
        case "ext": {
          const def = getExt(f.ext);
          if (!def) throw new Error(tr("Neznámý prvek rozšíření „{0}“ – modul není načten.", f.ext));
          if (!def.build) break;
          const out = await def.build(f.data ?? {}, { body, sketches, doc, index: i, featureId: f.id, tools, bodies: new Map<string, Shape>([...(body ? [[activeName, body] as [string, Shape]] : []), ...others]), activeBody: activeName });
          if (out !== null && out !== undefined) next = out; // null = prvek bez geometrie (těleso zůstává)
          break;
        }
        default: {
          if (f.type === "thread" && !body) throw new Error(tr("Závit potřebuje těleso (válcovou plochu)."));
          const tool = await toolOf(f, ctxOf());
          if (!tool) break;
          const mode = modeOf(f);
          tools.set(f.id, { tool: tool.clone(), mode });
          next = applyMode(body, tool, mode);
          if (f.type === "hole" && body && !f.bothWays) {
            // Krátký nástup nad zadaným bodem nesmí být jediné, co díra odebrala: bod na spodní ploše s vrtáním ven z tělesa
            // by jinak tiše vyřízl mělkou kapsu. Je-li úbytek jen v rozsahu nástupu, ověří se díra přesně od bodu.
            const h = holeHead(f);
            const n = f.points?.length || 1;
            const v0 = bodySig?.volume ?? r.measureVolume(body);
            const removed = v0 - r.measureVolume(next);
            if (removed <= n * Math.PI * h.headR * h.headR * h.back * 1.001 + 1e-9) {
              try {
                const strict = applyMode(body, holeTools(f, ctxOf(), true), mode);
                if (Math.abs(r.measureVolume(strict) - v0) <= 1e-9 * Math.max(1, Math.abs(v0))) next = strict; // ve směru vrtání není materiál → ⚠ „těleso nezměnil“
              } catch {
                /* kontrolu nelze provést – platí výsledek s nástupem */
              }
            }
          }
        }
      }
      body = finish(f, next);
    } catch (e) {
      status.push({ id: f.id, ok: false, error: humanError(e) });
      if (startedNew && !body) {
        // nové těleso nevzniklo – vrátit se k původnímu aktivnímu
        const prev = others.get(startedNew.name);
        if (prev) {
          others.delete(startedNew.name);
          body = prev;
          activeName = startedNew.name;
          bodySig = signatureOf(body);
        }
      }
    } finally {
      const dt = Date.now() - tFeature;
      if (status.length > nStatus && f.type !== "sketch" && dt >= 1) status[status.length - 1].ms = dt;
      if (dt >= CHECKPOINT_MIN_MS || i === count - 1) checkpoint(i + 1, dt);
    }
  }
  if (opts.preferActive && input.activeBody && input.activeBody !== activeName && others.has(input.activeBody)) activate(input.activeBody);
  const bodies: NamedBody[] = [...(body ? [{ name: activeName, shape: body as Shape }] : []), ...[...others].map(([name, shape]) => ({ name, shape }))];
  const all = bodies.length > 1 ? compoundOf(bodies.map((b) => b.shape)) : (bodies[0]?.shape ?? null);
  return { body: all, status, paramErrors, resolved, bodies };
}

/** Prvky, u kterých se očekává změna tělesa (přidání / odebrání materiálu, úprava tvaru). */
const CHANGING_TYPES = new Set<string>(["extrude", "revolve", "sweep", "loft", "box", "cylinder", "sphere", "cone", "tube", "hole", "text", "spring", "import", "fillet", "chamfer", "shell", "draft", "split", "pattern", "pushPull", "offsetFace", "deleteFace", "thicken", "rib", "combine", "splitBodies"]);
function expectsChange(f: Feature): boolean {
  if (f.type === "ext") return typeof f.data?.mode === "string";
  if (f.type === "thread") return !!f.modeled;
  if (f.type === "mirror") return !!f.keepOriginal;
  return CHANGING_TYPES.has(f.type);
}

function humanError(e: unknown): string {
  if (e instanceof Error && e.message && !/^\d+$/.test(e.message)) {
    if (/deleted/i.test(e.message)) return tr("Vnitřní chyba jádra – zkuste upravit parametry.");
    if (/has not type|is null/i.test(e.message)) return tr("Operace vrátila prázdné těleso – nejčastěji kvůli volným plochám v modelu (sešijte je nebo uzavřete do tělesa) nebo neplatné geometrii.");
    return e.message;
  }
  return tr("Operaci nelze provést s těmito parametry (např. příliš velký poloměr zaoblení nebo neplatná geometrie).");
}

type DocResult = BuildResult & { body: Shape | null };
/** poslední výsledek `buildDoc` – tentýž dokument podruhé (ověřovací stavba konzole a hned nato stavba aplikace, opakovaný „stav“) se nepočítá znovu */
let lastDocResult: { key: string; res: DocResult } | null = null;
const copyMeshData = (m: MeshData): MeshData => ({ vertices: m.vertices.slice(), normals: m.normals.slice(), triangles: m.triangles.slice(), faceGroups: m.faceGroups.slice(), lines: m.lines.slice(), edgeGroups: m.edgeGroups.slice() });
/** kopie výsledku: pole sítě se do UI předávají přenosem (původní pole tím zanikají) a těleso si jádro po další stavbě uvolní */
const copyDocResult = (x: DocResult): DocResult => ({ ...x, mesh: x.mesh ? copyMeshData(x.mesh) : null, vertices: x.vertices?.slice(), status: x.status.map((s) => ({ ...s })), body: x.body ? (x.body.clone() as Shape) : null });

export async function buildDoc(doc: CadDoc, opts: { tolerance?: number; onProgress?: BuildProgressFn } = {}): Promise<DocResult> {
  const t0 = Date.now();
  const key = JSON.stringify([doc.features, doc.variables ?? null, doc.bindings ?? null, doc.configs ?? null, doc.activeConfig ?? null, doc.material, doc.kind ?? "part", doc.activeBody ?? null, opts.tolerance ?? null]);
  if (lastDocResult?.key === key) return { ...copyDocResult(lastDocResult.res), ms: Date.now() - t0 };
  const { body, status, paramErrors, resolved, bodies } = await buildShape(doc, Infinity, { preferActive: true, onProgress: opts.onProgress });
  opts.onProgress?.({ index: doc.features.length, total: doc.features.length, phase: "mesh" });
  const res: DocResult = { ...shapeResult(body, { status, paramErrors, t0, tolerance: opts.tolerance }), resolved, bodies: bodyInfos(bodies) };
  lastDocResult = { key, res: copyDocResult(res) };
  return res;
}

/** Přehled těles dílu: rozsahy globálních indexů ploch a hran ve složeném tvaru (aktivní těleso je první) a objem. */
export function bodyInfos(bodies: NamedBody[]): BodyInfo[] {
  let fs = 0;
  let es = 0;
  return bodies.map((b, i) => {
    const faceCount = b.shape.faces.length;
    const edgeCount = b.shape.edges.length;
    let volume = 0;
    try {
      volume = r.measureVolume(b.shape);
    } catch {
      /* otevřené těleso */
    }
    const info: BodyInfo = { name: b.name, active: i === 0, faceStart: fs, faceCount, edgeStart: es, edgeCount, volume };
    fs += faceCount;
    es += edgeCount;
    return info;
  });
}

/**
 * Síť ploch a hran tělesa rovnou jako typovaná pole. replicad (`shape.mesh()`) převádí data z paměti jádra na obyčejná pole
 * čísel prvek po prvku (u 240 tisíc trojúhelníků 1,5 s); tady se paměť jen zkopíruje.
 */
function meshArrays(body: Shape, tolerance: number, angular: number) {
  const oc = r.getOC() as unknown as {
    wasmMemory: { buffer: ArrayBuffer };
    ReplicadMeshExtractor: { extract(s: unknown, t: number, a: number, x: boolean): Record<string, () => number> & { delete(): void } };
    ReplicadEdgeMeshExtractor: { extract(s: unknown, t: number, a: number): Record<string, () => number> & { delete(): void } };
  };
  const raw = oc.ReplicadMeshExtractor.extract(body.wrapped, tolerance, angular, false);
  let vertices: Float32Array, normals: Float32Array, triangles: Uint32Array, faceGroups: Int32Array;
  try {
    const buf = oc.wasmMemory.buffer; // až po výpočtu – paměť jádra se při něm mohla zvětšit
    vertices = new Float32Array(buf, raw.getVerticesPtr() >>> 0, raw.getVerticesSize()).slice();
    normals = new Float32Array(buf, raw.getNormalsPtr() >>> 0, raw.getNormalsSize()).slice();
    triangles = new Uint32Array(buf, raw.getTrianglesPtr() >>> 0, raw.getTrianglesSize()).slice();
    faceGroups = new Int32Array(buf, raw.getFaceGroupsPtr() >>> 0, raw.getFaceGroupsSize()).slice();
  } finally {
    raw.delete();
  }
  const er = oc.ReplicadEdgeMeshExtractor.extract(body.wrapped, tolerance, angular);
  try {
    const buf = oc.wasmMemory.buffer;
    const lines = new Float32Array(buf, er.getLinesPtr() >>> 0, er.getLinesSize()).slice();
    const edgeGroups = new Int32Array(buf, er.getEdgeGroupsPtr() >>> 0, er.getEdgeGroupsSize()).slice();
    return { vertices, normals, triangles, faceGroups, lines, edgeGroups };
  } finally {
    er.delete();
  }
}

/** Síť, hrany, vrcholy a metriky libovolného tělesa (i složeného – např. podsestavy). */
export function shapeResult(body: Shape | null, o: { status?: FeatureStatus[]; paramErrors?: string[]; t0?: number; tolerance?: number } = {}): BuildResult & { body: Shape | null } {
  const t0 = o.t0 ?? Date.now();
  const status = o.status ?? [];
  const paramErrors = o.paramErrors ?? [];
  const opts = { tolerance: o.tolerance };
  if (!body) return { status, paramErrors, mesh: null, metrics: null, ms: Date.now() - t0, body: null };
  const tol = opts.tolerance ?? meshTolerance(bboxDiag(body));
  const m = meshArrays(body, tol, MESH_ANGULAR);
  const faces = body.faces;
  const edges = body.edges;
  const faceIndex = new Map(faces.map((f, i) => [f.hashCode, i]));
  const edgeIndex = new Map(edges.map((e, i) => [e.hashCode, i]));
  // skupiny [začátek, počet, otisk plochy / hrany] → [začátek, počet, index plochy / hrany]
  const faceGroups = m.faceGroups;
  for (let i = 2; i < faceGroups.length; i += 3) faceGroups[i] = faceIndex.get(faceGroups[i]) ?? -1;
  const edgeGroups = m.edgeGroups;
  for (let i = 2; i < edgeGroups.length; i += 3) edgeGroups[i] = edgeIndex.get(edgeGroups[i]) ?? -1;
  let volume = 0;
  let area = 0;
  try {
    volume = r.measureVolume(body);
    area = r.measureArea(body);
  } catch {
    /* otevřené těleso */
  }
  const bb = body.boundingBox.bounds as [Vec3, Vec3];
  // platnost a počet těles – u velmi složitých tvarů (sestavy) se kontrola platnosti vynechá (drahá)
  let valid: boolean | undefined;
  let solids: number | undefined;
  try {
    const chk = faces.length <= 2000 ? checkShape(body) : null;
    if (chk) {
      valid = chk.valid;
      solids = chk.solids;
    }
  } catch {
    /* bez kontroly */
  }
  return {
    status,
    paramErrors,
    body,
    ms: Date.now() - t0,
    mesh: { vertices: m.vertices, normals: m.normals, triangles: m.triangles, faceGroups, lines: m.lines, edgeGroups },
    metrics: { volume, area, bbox: bb, faces: faces.length, edges: edges.length, valid, solids },
    vertices: safeVertices(body),
  };
}

function safeVertices(body: Shape): Float32Array {
  try {
    return vertexPositions(body);
  } catch {
    return new Float32Array(0);
  }
}

/** Informace o ploše (pro „skicu na ploše“). */
export function faceInfo(body: Shape, index: number): FaceInfo | null {
  const f = body.faces[index];
  if (!f) return null;
  const planar = f.geomType === "PLANE";
  const c = f.center;
  const n = f.normalAt(c);
  // xDir kolmý na normálu (preferuje globální X, jinak Y)
  const ref: Vec3 = Math.abs(n.x) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const nv: Vec3 = [n.x, n.y, n.z];
  const dot = ref[0] * nv[0] + ref[1] * nv[1] + ref[2] * nv[2];
  const x: Vec3 = [ref[0] - dot * nv[0], ref[1] - dot * nv[1], ref[2] - dot * nv[2]];
  const xl = Math.hypot(...x) || 1;
  const round = (v: number) => Math.round(v * 1e6) / 1e6;
  return {
    index,
    planar,
    origin: [round(c.x), round(c.y), round(c.z)],
    normal: nv.map(round) as Vec3,
    xDir: x.map((v) => round(v / xl)) as Vec3,
  };
}
