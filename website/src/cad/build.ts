/**
 * Stavba modelu z historie prvků nad jádrem OpenCascade (replicad).
 * Běží ve web workeru (prohlížeč) i v Node (testy). Předpokládá zavolané setOC().
 */
import * as r from "replicad";
import { deleteFaces, offsetFaces, pushPull, ribTool, springSolid, thickenFaces, vertexPositions } from "./direct";
import { importBody } from "./formats/kernel-import";
import { threadByName } from "./defaults";
import { resolveDoc } from "./params";
import { findLoops, nestLoops, shapeSegs, type Loop, type Seg } from "./sketch";
import type { Axis, BoolMode, BuildResult, CadDoc, FaceInfo, Feature, FeatureStatus, PlaneName, SketchPlane, Vec2, Vec3 } from "./types";

type Shape = r.Shape3D;

export function planeOf(p: SketchPlane): r.Plane {
  if (p.kind === "base") return r.makePlane(p.name, p.offset);
  return new r.Plane(p.origin, p.xDir, p.normal);
}

const vec = (v: r.Vector): Vec3 => [v.x, v.y, v.z];

/** Uzavřené profily skici → replicad Drawing (s otvory dle vnoření). */
export function sketchDrawing(f: Extract<Feature, { type: "sketch" }>): r.Drawing | null {
  const { loops } = findLoops(f.entities);
  if (!loops.length) return null;
  const nested = nestLoops(loops).sort((a, b) => b.area - a.area);
  let result: r.Drawing | null = null;
  for (const { loop, depth } of nested) {
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

function applyMode(body: Shape | null, tool: Shape, mode: BoolMode): Shape {
  if (!body) {
    if (mode === "cut" || mode === "intersect") throw new Error("Není z čeho odebírat – nejdřív vytvořte těleso.");
    return tool;
  }
  if (mode === "cut") return body.cut(tool);
  if (mode === "intersect") return body.intersect(tool);
  return body.fuse(tool);
}

function bboxDiag(s: Shape) {
  const b = s.boundingBox;
  const [[x0, y0, z0], [x1, y1, z1]] = b.bounds;
  return Math.hypot(x1 - x0, y1 - y0, z1 - z0) || 100;
}

type SketchF = Extract<Feature, { type: "sketch" }>;
type Ctx = { sketches: Map<string, SketchF>; body: Shape | null };

function needSketch(ctx: Ctx, id: string, role = "skica"): SketchF {
  const sk = ctx.sketches.get(id);
  if (!sk) throw new Error(`Chybí ${role} – vyberte ji v parametrech.`);
  return sk;
}

/** Uzavřené smyčky skici jako dráty v prostoru, s hloubkou vnoření (0 = vnější obrys, 1 = otvor…). */
function sketchWires(sk: SketchF): { wire: r.Wire; depth: number; area: number }[] {
  const { loops } = findLoops(sk.entities);
  if (!loops.length) throw new Error(`Skica „${sk.name}“ neobsahuje uzavřený profil.`);
  const plane = planeOf(sk.plane);
  return nestLoops(loops).map(({ loop, depth, area }) => {
    const d = loopDrawing(loop);
    if (!d) throw new Error(`Skica „${sk.name}“ obsahuje neplatný profil.`);
    const s = d.sketchOnPlane(plane) as r.Sketch;
    if (!s.wire) throw new Error(`Skica „${sk.name}“ obsahuje neplatný profil.`);
    return { wire: s.wire, depth, area };
  });
}

/** Otevřená i uzavřená křivka skici (úsečky, oblouky, lomené čáry, tvary) jako jeden drát – dráha tažení. */
export function sketchPathWire(sk: SketchF): r.Wire {
  const plane = planeOf(sk.plane);
  const W = (p: Vec2): Vec3 => vec(plane.toWorldCoords(p));
  const segs: Seg[] = [];
  const closedEdges: r.Edge[] = [];
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
    if (closedEdges.length > 1) throw new Error("Dráha musí být jedna souvislá křivka.");
    return r.assembleWire(closedEdges);
  }
  if (!segs.length) throw new Error(`Skica dráhy „${sk.name}“ je prázdná.`);
  const ordered = chainSegs(segs);
  const edges = ordered.map((s) => (s.kind === "line" ? r.makeLine(W(s.a), W(s.b)) : r.makeThreePointArc(W(s.a), W(s.m), W(s.b))));
  return r.assembleWire(edges);
}

/** Otevřená (nebo uzavřená) křivka skici jako seřazené 2D segmenty – pro žebro. */
function sketchChain(sk: SketchF): Seg[] {
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
  if (!segs.length) throw new Error(`Skica „${sk.name}“ musí obsahovat čáru (úsečku, lomenou čáru nebo oblouk).`);
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
  if (used.some((u) => !u)) throw new Error("Dráha musí být jedna souvislá křivka (bez větvení a mezer).");
  return chain;
}

function combine(parts: { solid: Shape; depth: number }[]): Shape {
  let acc: Shape | null = null;
  for (const { solid, depth } of parts.sort((a, b) => a.depth - b.depth)) {
    if (!acc) acc = solid;
    else acc = depth % 2 === 0 ? acc.fuse(solid) : acc.cut(solid);
  }
  if (!acc) throw new Error("Profil je prázdný.");
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
    throw new Error("Písmo pro text se nepodařilo načíst – zkontrolujte připojení a zkuste to znovu.");
  });
}

// ---------------- díry a závity ----------------

/** Hloubka kuželového zahloubení. */
const csDepthOf = (csD: number, d: number, angle: number) => Math.max(0, (csD / 2 - d / 2) / Math.tan(((angle || 90) * Math.PI) / 360));

function holeTool(f: Extract<Feature, { type: "hole" }>, body: Shape | null): Shape {
  const kind = f.kind ?? (f.cbDiameter > f.diameter && f.cbDepth > 0 ? "counterbore" : "simple");
  let d = f.diameter;
  if (kind === "tapped") {
    const t = threadByName(f.thread);
    if (!t) throw new Error(`Neznámý závit „${f.thread ?? ""}“ – vyberte M2 až M48.`);
    d = t.tap;
  }
  if (!(d > 0)) throw new Error("Průměr díry musí být kladný.");
  const dir = axisVec(f.axis).map((v) => (f.flip ? v : -v)) as Vec3; // výchozí: vrtání proti ose (shora dolů)
  const big = body ? bboxDiag(body) * 2 + 10 : 1000;
  const through = !(f.depth > 0);
  const rd = d / 2;
  const B = big; // přesah nad povrch
  const pts: [number, number][] = [[0, -B]];
  if (kind === "counterbore") {
    if (!(f.cbDiameter > d && f.cbDepth > 0)) throw new Error("Zahloubení musí mít větší průměr než díra a kladnou hloubku.");
    pts.push([f.cbDiameter / 2, -B], [f.cbDiameter / 2, f.cbDepth], [rd, f.cbDepth]);
  } else if (kind === "countersink") {
    const csD = f.csDiameter ?? 0;
    if (!(csD > d)) throw new Error("Průměr kuželového zahloubení musí být větší než průměr díry.");
    const angle = Math.min(170, Math.max(30, f.csAngle ?? 90));
    pts.push([csD / 2, -B], [csD / 2, 0], [rd, csDepthOf(csD, d, angle)]);
  } else pts.push([rd, -B]);
  if (through) pts.push([rd, big], [0, big]);
  else {
    if (kind === "counterbore" && f.depth <= f.cbDepth) throw new Error("Hloubka díry musí být větší než hloubka zahloubení.");
    pts.push([rd, f.depth], [0, f.depth + rd / Math.tan((59 * Math.PI) / 180)]); // špička vrtáku 118°
  }
  return revolvedAlong(pts, dir, f.position);
}

/** Zjednodušený modelovaný závit: soustava V-drážek (vizuálně i hmotnostně odpovídá závitu). */
function threadTool(f: Extract<Feature, { type: "thread" }>): Shape {
  const t = threadByName(f.designation);
  if (!t) throw new Error(`Neznámý závit „${f.designation}“ – použijte M2 až M48.`);
  if (!(f.length > 0)) throw new Error("Délka závitu musí být kladná.");
  const n = Math.max(1, Math.round(f.length / t.pitch));
  const P = f.length / n;
  const R = t.d / 2;
  const rmin = R - 0.6134 * t.pitch;
  const Rout = R + t.pitch + 1;
  const pts: [number, number][] = [[Rout, 0], [Rout, f.length], [R, f.length]];
  for (let k = n - 1; k >= 0; k--) pts.push([rmin, k * P + P / 2], [R, k * P]);
  return revolved(pts, f.axis, f.position);
}

/** Nástrojové těleso prvku (pro pole/zrcadlení) — null u prvků, které nástroj nemají. */
async function toolOf(f: Feature, ctx: Ctx): Promise<Shape | null> {
  switch (f.type) {
    case "extrude": {
      const sk = needSketch(ctx, f.sketchId);
      if (!(f.distance > 0)) throw new Error("Vzdálenost musí být kladná.");
      const plane = planeOf(sk.plane);
      const dist = f.reverse ? -f.distance : f.distance;
      const n = plane.zDir;
      let s: Shape;
      const draft = f.draftAngle ?? 0;
      if (Math.abs(draft) > 1e-6) {
        if (Math.abs(draft) >= 45) throw new Error("Úkos vysunutí musí být menší než 45°.");
        // úkos: šablonování mezi profilem a odsazeným profilem na konci
        const off = Math.abs(dist) * Math.tan((draft * Math.PI) / 180);
        const shift: Vec3 = [n.x * dist, n.y * dist, n.z * dist];
        s = combine(
          sketchWires(sk).map(({ wire, depth }) => {
            const inward = depth % 2 === 0 ? -off : off; // vnější obrys se zužuje, otvory rozšiřují
            const top = wire.clone().offset2D(inward).translate(shift);
            return { solid: r.loft([wire, top], { ruled: true }), depth };
          }),
        );
      } else {
        const d = sketchDrawing(sk);
        if (!d) throw new Error("Skica neobsahuje uzavřený profil.");
        s = d.sketchOnPlane(plane).extrude(dist) as Shape;
      }
      if (f.symmetric) s = s.translate([(-n.x * dist) / 2, (-n.y * dist) / 2, (-n.z * dist) / 2]);
      return s;
    }
    case "revolve": {
      const sk = needSketch(ctx, f.sketchId);
      const d = sketchDrawing(sk);
      if (!d) throw new Error("Skica neobsahuje uzavřený profil.");
      const plane = planeOf(sk.plane);
      const ax = f.axis === "x" ? plane.xDir : plane.yDir;
      const angle = Math.max(1, Math.min(360, f.angle || 360));
      return d.sketchOnPlane(plane).revolve(vec(ax), { origin: vec(plane.origin), angle }) as Shape;
    }
    case "sweep": {
      const prof = needSketch(ctx, f.profileId, "skica profilu");
      const path = needSketch(ctx, f.pathId, "skica dráhy");
      if (prof.id === path.id) throw new Error("Profil a dráha musí být dvě různé skici.");
      const spine = sketchPathWire(path);
      return combine(
        sketchWires(prof).map(({ wire, depth }) => {
          const s = r.genericSweep(wire, spine, { frenet: f.frenet, transitionMode: "right" }) as Shape;
          return { solid: s, depth };
        }),
      );
    }
    case "loft": {
      if (f.sketchIds.length < 2) throw new Error("Šablonování potřebuje alespoň dvě skici (profily).");
      const sets = f.sketchIds.map((id, k) => sketchWires(needSketch(ctx, id, `skica ${k + 1}`)));
      const outer = sets.map((ws) => ws.filter((w) => w.depth === 0).sort((a, b) => b.area - a.area)[0]?.wire);
      if (outer.some((w) => !w)) throw new Error("Každá skica musí mít uzavřený vnější profil.");
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
      if (!(w > 0 && h > 0 && d > 0)) throw new Error("Rozměry musí být kladné.");
      const [x, y, z] = f.position;
      const c1: Vec3 = f.centered ? [x - w / 2, y - h / 2, z - d / 2] : [x, y, z];
      return r.makeBox(c1, [c1[0] + w, c1[1] + h, c1[2] + d]);
    }
    case "cylinder":
      if (!(f.radius > 0 && f.height > 0)) throw new Error("Rozměry musí být kladné.");
      return r.makeCylinder(f.radius, f.height, f.position, axisVec(f.axis));
    case "sphere":
      if (!(f.radius > 0)) throw new Error("Poloměr musí být kladný.");
      return r.makeSphere(f.radius).translate(f.position);
    case "cone":
      if (!(f.height > 0) || f.radius1 < 0 || f.radius2 < 0 || f.radius1 + f.radius2 <= 0) throw new Error("Neplatné rozměry kuželu.");
      return revolved(
        [[0, 0], [Math.max(f.radius1, 1e-4), 0], [Math.max(f.radius2, 1e-4), f.height], [0, f.height]],
        f.axis,
        f.position,
      );
    case "tube": {
      if (!(f.outer > f.inner && f.inner >= 0 && f.height > 0)) throw new Error("Vnější průměr musí být větší než vnitřní.");
      let t = r.makeCylinder(f.outer / 2, f.height) as Shape;
      if (f.inner > 0) t = t.cut(r.makeCylinder(f.inner / 2, f.height));
      return oriented(t, f.axis, f.position);
    }
    case "hole":
      return holeTool(f, ctx.body);
    case "thread":
      return f.modeled ? threadTool(f) : null;
    case "text": {
      if (!f.text.trim()) throw new Error("Zadejte text.");
      if (!(f.height > 0 && f.depth > 0)) throw new Error("Výška písma a hloubka musí být kladné.");
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

function edgeFilter(body: Shape, edges: number[] | "all") {
  if (edges === "all") return null;
  const all = body.edges;
  const picked = edges.map((i) => all[i]).filter(Boolean);
  if (!picked.length) throw new Error("Vyberte hrany v modelu.");
  return picked;
}

/** Rovina kolmá na osu (XY ⟂ Z, XZ ⟂ Y, YZ ⟂ X) posunutá o `offset` v kladném směru osy. */
function axisPlane(name: PlaneName, offset: number): r.Plane {
  if (name === "XY") return new r.Plane([0, 0, offset], [1, 0, 0], [0, 0, 1]);
  if (name === "XZ") return new r.Plane([0, offset, 0], [1, 0, 0], [0, 1, 0]);
  return new r.Plane([offset, 0, 0], [0, 1, 0], [1, 0, 0]);
}

function asShape(s: unknown): Shape | null {
  return s ? (s as Shape) : null;
}

/** Vrátí výsledné těleso po prvek `untilIndex` (vč.) + stav prvků. Proměnné, vazby a aktivní stav se uplatní předem. */
export async function buildShape(input: CadDoc, untilIndex = Infinity): Promise<{ body: Shape | null; status: FeatureStatus[]; paramErrors: string[] }> {
  const { doc, errors: paramErrors } = resolveDoc(input);
  const sketches = new Map<string, SketchF>();
  const tools = new Map<string, { tool: Shape; mode: BoolMode }>();
  const status: FeatureStatus[] = [];
  let body: Shape | null = null;

  for (let i = 0; i < doc.features.length && i <= untilIndex; i++) {
    const f = doc.features[i];
    if (f.suppressed) {
      status.push({ id: f.id, ok: true });
      if (f.type === "sketch") sketches.set(f.id, f);
      continue;
    }
    try {
      let next: Shape | null = body;
      switch (f.type) {
        case "sketch":
          sketches.set(f.id, f);
          break;
        case "datum":
          if (Math.hypot(...f.normal) < 1e-9) throw new Error("Normála roviny nesmí být nulová.");
          break;
        case "import": {
          const s = await importBody(f);
          next = body ? body.fuse(s) : s;
          break;
        }
        case "fillet":
        case "chamfer": {
          if (!body) throw new Error("Není co zaoblit – nejdřív vytvořte těleso.");
          const size = f.type === "fillet" ? f.radius : f.distance;
          if (!(size > 0)) throw new Error("Hodnota musí být kladná.");
          const picked = edgeFilter(body, f.edges);
          const cfg = picked ? (e: r.Edge) => (picked.some((p) => p.isSame(e)) ? size : null) : size;
          next = f.type === "fillet" ? body.clone().fillet(cfg as never) : body.clone().chamfer(cfg as never);
          break;
        }
        case "shell": {
          if (!body) throw new Error("Není co skořepinovat.");
          if (!(f.thickness > 0)) throw new Error("Tloušťka musí být kladná.");
          const all = body.faces;
          const picked = f.faces.map((k) => all[k]).filter(Boolean);
          if (!picked.length) throw new Error("Vyberte plochy, které se mají otevřít.");
          next = body.clone().shell(Math.abs(f.thickness), (ff) => ff.when(({ element }) => picked.some((p) => p.isSame(element as r.Face))));
          break;
        }
        case "draft": {
          if (!body) throw new Error("Není těleso pro úkos.");
          if (!(Math.abs(f.angle) > 0 && Math.abs(f.angle) < 45)) throw new Error("Úhel úkosu musí být mezi 0 a 45°.");
          const all = body.faces;
          const picked = f.faces.map((k) => all[k]).filter(Boolean);
          if (!picked.length) throw new Error("Vyberte plochy, které se mají zkosit.");
          next = body.clone().draft(f.angle, (ff) => ff.when(({ element }) => picked.some((p) => p.isSame(element as r.Face))), axisPlane(f.plane, f.offset));
          break;
        }
        case "split": {
          if (!body) throw new Error("Není co rozříznout.");
          const res = body.clone().split(axisPlane(f.plane, f.offset));
          const keep = asShape(f.keep === "positive" ? res.positive : res.negative);
          if (!keep) throw new Error("Na zvolené straně roviny nic nezůstane – změňte stranu nebo posunutí.");
          next = keep;
          break;
        }
        case "transform": {
          if (!body) throw new Error("Není těleso k transformaci.");
          if (!(f.scale > 0)) throw new Error("Měřítko musí být kladné.");
          let s: Shape = body;
          if (Math.abs(f.scale - 1) > 1e-12) s = s.scale(f.scale, [0, 0, 0]);
          if (f.rotateAngle) s = s.rotate(f.rotateAngle, [0, 0, 0], axisVec(f.rotateAxis));
          if (f.translate.some((v) => v)) s = s.translate(f.translate);
          next = s;
          break;
        }
        case "pattern": {
          if (!body) throw new Error("Není těleso.");
          const src = tools.get(f.featureId);
          if (!src) throw new Error("Vyberte prvek (vysunutí, díra, primitivum…), který se má opakovat.");
          let acc: Shape = body;
          if (f.kind === "linear") {
            const n1 = Math.max(1, Math.round(f.count));
            const n2 = Math.max(1, Math.round(f.count2 ?? 1));
            const unit = (d: Vec3): Vec3 => {
              const len = Math.hypot(d[0], d[1], d[2]);
              if (!len) throw new Error("Směr pole nesmí být nulový.");
              return [d[0] / len, d[1] / len, d[2] / len];
            };
            const d1 = unit(f.direction);
            const d2 = n2 > 1 ? unit(f.direction2 ?? [0, 1, 0]) : ([0, 0, 0] as Vec3);
            const s2 = f.spacing2 ?? f.spacing;
            if (n1 * n2 > 400) throw new Error("Pole má příliš mnoho kusů (max. 400).");
            for (let a = 0; a < n1; a++)
              for (let b = 0; b < n2; b++) {
                if (!a && !b) continue;
                const off: Vec3 = [0, 1, 2].map((k) => d1[k] * f.spacing * a + d2[k] * s2 * b) as Vec3;
                acc = applyMode(acc, src.tool.clone().translate(off), src.mode);
              }
          } else {
            if (f.count > 400) throw new Error("Pole má příliš mnoho kusů (max. 400).");
            for (let k = 1; k < Math.max(1, Math.round(f.count)); k++) {
              const step = (f.angle >= 360 ? 360 / f.count : f.angle / Math.max(1, f.count - 1)) * k;
              acc = applyMode(acc, src.tool.clone().rotate(step, f.center, axisVec(f.axis)), src.mode);
            }
          }
          next = acc;
          break;
        }
        case "pushPull":
          if (!body) throw new Error("Není těleso – nejdřív vytvořte nebo importujte model.");
          next = pushPull(body, f.faces, f.distance);
          break;
        case "offsetFace":
          if (!body) throw new Error("Není těleso – nejdřív vytvořte nebo importujte model.");
          next = offsetFaces(body, f.faces, f.distance);
          break;
        case "deleteFace":
          if (!body) throw new Error("Není těleso – nejdřív vytvořte nebo importujte model.");
          next = deleteFaces(body, f.faces);
          break;
        case "thicken": {
          if (!body) throw new Error("Zesílení potřebuje těleso s plochami.");
          const tool = thickenFaces(body, f.faces, f.thickness);
          next = f.mode === "new" ? tool : applyMode(body, tool, f.mode);
          break;
        }
        case "rib": {
          if (!body) throw new Error("Žebro potřebuje těleso, ke kterému se připojí.");
          const sk = needSketch({ sketches, body }, f.sketchId, "skica žebra");
          next = body.fuse(ribTool(body, sk, sketchChain(sk), planeOf(sk.plane), f.thickness, f.direction, f.flip));
          break;
        }
        case "mirror": {
          if (!body) throw new Error("Není co zrcadlit.");
          const origin: Vec3 = f.plane === "YZ" ? [f.offset, 0, 0] : f.plane === "XZ" ? [0, f.offset, 0] : [0, 0, f.offset];
          const m = body.clone().mirror(f.plane, origin) as Shape;
          next = f.keepOriginal ? body.fuse(m) : m;
          break;
        }
        default: {
          if (f.type === "thread" && !body) throw new Error("Závit potřebuje těleso (válcovou plochu).");
          const tool = await toolOf(f, { sketches, body });
          if (!tool) break;
          const mode = modeOf(f);
          tools.set(f.id, { tool: tool.clone(), mode });
          next = applyMode(body, tool, mode);
        }
      }
      body = next;
      status.push({ id: f.id, ok: true });
    } catch (e) {
      status.push({ id: f.id, ok: false, error: humanError(e) });
    }
  }
  return { body, status, paramErrors };
}

function humanError(e: unknown): string {
  if (e instanceof Error && e.message && !/^\d+$/.test(e.message)) {
    if (/deleted/i.test(e.message)) return "Vnitřní chyba jádra – zkuste upravit parametry.";
    return e.message;
  }
  return "Operaci nelze provést s těmito parametry (např. příliš velký poloměr zaoblení nebo neplatná geometrie).";
}

export async function buildDoc(doc: CadDoc, opts: { tolerance?: number } = {}): Promise<BuildResult & { body: Shape | null }> {
  const t0 = Date.now();
  const { body, status, paramErrors } = await buildShape(doc);
  return shapeResult(body, { status, paramErrors, t0, tolerance: opts.tolerance });
}

/** Síť, hrany, vrcholy a metriky libovolného tělesa (i složeného – např. podsestavy). */
export function shapeResult(body: Shape | null, o: { status?: FeatureStatus[]; paramErrors?: string[]; t0?: number; tolerance?: number } = {}): BuildResult & { body: Shape | null } {
  const t0 = o.t0 ?? Date.now();
  const status = o.status ?? [];
  const paramErrors = o.paramErrors ?? [];
  const opts = { tolerance: o.tolerance };
  if (!body) return { status, paramErrors, mesh: null, metrics: null, ms: Date.now() - t0, body: null };
  const tol = opts.tolerance ?? Math.max(0.01, bboxDiag(body) / 2000);
  const m = body.mesh({ tolerance: tol, angularTolerance: 0.2 });
  const em = body.meshEdges({ tolerance: tol, angularTolerance: 0.2 });
  const faceIndex = new Map(body.faces.map((f, i) => [f.hashCode, i]));
  const edgeIndex = new Map(body.edges.map((e, i) => [e.hashCode, i]));
  const faceGroups = new Int32Array(m.faceGroups.length * 3);
  m.faceGroups.forEach((g, i) => faceGroups.set([g.start, g.count, faceIndex.get(g.faceId) ?? -1], i * 3));
  const edgeGroups = new Int32Array(em.edgeGroups.length * 3);
  em.edgeGroups.forEach((g, i) => edgeGroups.set([g.start, g.count, edgeIndex.get(g.edgeId) ?? -1], i * 3));
  let volume = 0;
  let area = 0;
  try {
    volume = r.measureVolume(body);
    area = r.measureArea(body);
  } catch {
    /* otevřené těleso */
  }
  const bb = body.boundingBox.bounds as [Vec3, Vec3];
  return {
    status,
    paramErrors,
    body,
    ms: Date.now() - t0,
    mesh: {
      vertices: new Float32Array(m.vertices),
      normals: new Float32Array(m.normals),
      triangles: new Uint32Array(m.triangles),
      faceGroups,
      lines: new Float32Array(em.lines),
      edgeGroups,
    },
    metrics: { volume, area, bbox: bb, faces: body.faces.length, edges: body.edges.length },
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
