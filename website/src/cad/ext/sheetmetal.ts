/**
 * Plechové díly (modul rozšíření): základní plech, ohyb z hrany, lem, ohyb podle čáry, výřez, rohová úleva,
 * prolis, parametry plechu, rozvinutí (plochý díl) + akce exportu rozvinu (DXF/SVG) a tabulka ohybů (UI).
 *
 * Geometrie ohybu: vnitřní poloměr R, tloušťka t, úhel α. Ohyb z hrany = válcový segment (R..R+t) + rovná příruba,
 * spojené s tělesem. Rozvin se počítá analyticky (sheetmetal-flat.ts) s BA = π/180·α·(R + K·t).
 * replicad/build.ts se načítají líně, aby modul nešel do hlavního balíčku UI.
 */
import { extDirection, extPoint } from "./place";
import { tr } from "../i18n";
import type * as R from "replicad";
import { planeBasis, toWorld } from "../defaults";
import type { CadDoc, Feature, Vec2, Vec3 } from "../types";
import { registerExt, type ExtBuildCtx, type Shape } from "./registry";
import { baseFeatureIndex, bendAllowance, bendRadius, flatLayout, sheetParamsAt, type EdgeGeom } from "./sheetmetal-flat";

type Rep = typeof R;
let repP: Promise<Rep> | null = null;
const rep = () => (repP ??= import("replicad"));
const bld = () => import("../build");

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const vt = (v: { x: number; y: number; z: number }): Vec3 => [v.x, v.y, v.z];

function bboxDiag(s: Shape) {
  const [[x0, y0, z0], [x1, y1, z1]] = s.boundingBox.bounds;
  return Math.hypot(x1 - x0, y1 - y0, z1 - z0) || 100;
}

type SketchF = Extract<Feature, { type: "sketch" }>;
function needSketch(ctx: ExtBuildCtx, id: unknown, what = "skicu"): SketchF {
  const sk = ctx.sketches.get(String(id ?? ""));
  if (!sk) throw new Error(tr("Vyberte {0} (musí být v historii před tímto prvkem).", what));
  return sk;
}

/** Hrana tělesa: koncové body, normála plochy plechu (větší sousední plocha) a vnější směr (boční plocha). */
export async function sheetEdge(body: Shape, idx: number): Promise<EdgeGeom & { faceN: Vec3; sideN: Vec3; len: number }> {
  const r = await rep();
  const edge = body.edges[idx];
  if (!edge) throw new Error(tr("Hrana {0} v tělese neexistuje – vyberte hranu znovu.", idx + 1));
  if (edge.geomType !== "LINE") throw new Error(tr("Ohyb lze založit jen na rovné hraně plechu (ne na oblouku)."));
  const a = vt(edge.startPoint);
  const b = vt(edge.endPoint);
  const adj = body.faces.filter((f) => f.geomType === "PLANE" && f.edges.some((e) => e.isSame(edge)));
  if (adj.length < 2) throw new Error(tr("Hrana musí ležet mezi plochou plechu a boční plochou (rovná hrana obrysu)."));
  const ranked = adj.map((f) => ({ f, area: r.measureArea(f) })).sort((x, y) => y.area - x.area);
  const flat = ranked[0].f;
  const side = ranked[ranked.length - 1].f;
  const faceN = norm(vt(flat.normalAt(flat.center)));
  let sideN = norm(vt(side.normalAt(side.center)));
  // boční normála musí být kolmá na hranu i na plochu plechu
  const u = norm(sub(b, a));
  sideN = norm(sub(sideN, mul(u, dot(sideN, u))));
  sideN = norm(sub(sideN, mul(faceN, dot(sideN, faceN))));
  return { a, b, faceN, sideN, len: Math.hypot(...sub(b, a)) };
}

/** Těleso ohybu (válcový segment + rovná příruba) v rámci (origin na vnitřní ploše, w ven, n směr ohybu, u podél hrany). */
async function bendSolid(origin: Vec3, w: Vec3, n: Vec3, u: Vec3, L: number, angle: number, R: number, t: number, len: number, extraBack = 0): Promise<Shape> {
  const r = await rep();
  const ar = (angle * Math.PI) / 180;
  const h = ar / 2;
  const pIn = (a: number): Vec2 => [R * Math.sin(a), R - R * Math.cos(a)];
  const pOut = (a: number): Vec2 => [(R + t) * Math.sin(a), R - (R + t) * Math.cos(a)];
  const d: Vec2 = [Math.cos(ar), Math.sin(ar)];
  const Ein = pIn(ar);
  const Eout = pOut(ar);
  const Fin: Vec2 = [Ein[0] + d[0] * len, Ein[1] + d[1] * len];
  const Fout: Vec2 = [Eout[0] + d[0] * len, Eout[1] + d[1] * len];
  let pen = r.draw([-extraBack, 0]);
  if (extraBack > 0) pen = pen.lineTo([0, 0]);
  pen = pen.threePointsArcTo(Ein, pIn(h));
  pen = len > 1e-6 ? pen.lineTo(Fin).lineTo(Fout).lineTo(Eout) : pen.lineTo(Eout);
  pen = pen.threePointsArcTo([0, -t], pOut(h));
  if (extraBack > 0) pen = pen.lineTo([-extraBack, -t]);
  const drawing = pen.close();
  const plane = new r.Plane(origin, w, u);
  return drawing.sketchOnPlane(plane).extrude(L) as Shape;
}

/** Poloprostor / deska v rámci: oblast d ∈ [from, to] podél normály `n` od bodu p. */
async function slab(p: Vec3, xDir: Vec3, n: Vec3, from: number, to: number, size: number): Promise<Shape> {
  const r = await rep();
  const plane = new r.Plane(add(p, mul(n, from)), xDir, n);
  return r.drawRectangle(size, size).sketchOnPlane(plane).extrude(to - from) as Shape;
}

function sketchLine(sk: SketchF): [Vec2, Vec2] {
  for (const e of sk.entities) {
    if (e.type === "line") return [e.a, e.b];
    if (e.type === "polyline" && e.points.length >= 2) return [e.points[0], e.points[1]];
  }
  throw new Error(tr("Skica musí obsahovat úsečku."));
}

/** Je materiál tělesa na straně +n od bodu p? (sonda malou krychlí) */
async function materialOn(body: Shape, p: Vec3, n: Vec3, t: number): Promise<boolean> {
  const r = await rep();
  const c = add(p, mul(n, Math.max(0.05, t * 0.25)));
  const s = Math.max(0.02, t * 0.1);
  const probe = r.makeBox([c[0] - s, c[1] - s, c[2] - s], [c[0] + s, c[1] + s, c[2] + s]) as Shape;
  try {
    return r.measureVolume(body.clone().intersect(probe)) > 1e-9;
  } catch {
    return false;
  }
}

const SHEET_PARAMS = [
  { key: "t", label: tr("Tloušťka plechu"), kind: "number" as const, min: 0.1, step: 0.5 },
  { key: "r", label: tr("Vnitřní poloměr ohybu"), kind: "number" as const, min: 0.05, step: 0.5 },
  { key: "k", label: "K-faktor", kind: "number" as const, min: 0, max: 1, step: 0.01, unit: "", hint: tr("ocel 0,44 · hliník 0,40 · nerez 0,45") },
];

// ---------------- prvky ----------------

registerExt({
  ext: "sheet.params",
  label: tr("Parametry plechu"),
  icon: "sheet-params",
  tone: "ref",
  tab: "sheet",
  group: "Plech",
  order: 1,
  hint: tr("tloušťka, poloměr ohybu a K-faktor pro další prvky"),
  make: (doc) => ({ ...sheetParamsAt(doc, doc.features.length) }),
  params: SHEET_PARAMS,
  build: (_d, ctx) => ctx.body,
});

registerExt({
  ext: "sheet.base",
  label: tr("Základní plech"),
  icon: "sheet-base",
  tone: "create",
  tab: "sheet",
  group: "Plech",
  big: true,
  order: 0,
  hint: tr("uzavřená skica → deska o tloušťce plechu"),
  make: (doc) => {
    const sk = [...doc.features].reverse().find((f) => f.type === "sketch");
    return { sketchId: sk?.id ?? "", direction: "normal", ...sheetParamsAt(doc, doc.features.length) };
  },
  params: [
    { key: "sketchId", label: tr("Skica obrysu"), kind: "sketch" },
    { key: "direction", label: tr("Směr tloušťky"), kind: "enum", options: [{ v: "normal", l: tr("Nad skicu") }, { v: "reverse", l: tr("Pod skicu") }, { v: "symmetric", l: tr("Symetricky") }] },
    ...SHEET_PARAMS,
  ],
  build: async (d, ctx) => {
    const { sketchDrawing, planeOf } = await bld();
    const sk = needSketch(ctx, d.sketchId, tr("skicu obrysu plechu"));
    const dr = sketchDrawing(sk);
    if (!dr) throw new Error(tr("Skica obrysu plechu musí být uzavřená."));
    const t = num(d.t, 2);
    if (!(t > 0)) throw new Error(tr("Tloušťka plechu musí být kladná."));
    const plane = planeOf(sk.plane);
    const dir = d.direction;
    let s = dr.sketchOnPlane(plane).extrude(dir === "reverse" ? -t : t) as Shape;
    if (dir === "symmetric") {
      const n = plane.zDir;
      s = s.translate([(-n.x * t) / 2, (-n.y * t) / 2, (-n.z * t) / 2]) as Shape;
    }
    return ctx.body ? (ctx.body.fuse(s) as Shape) : s;
  },
});

const FLANGE_PARAMS = [
  { key: "edges", label: tr("Hrany ohybu"), kind: "edges" as const, hint: tr("rovné hrany obrysu plechu") },
  { key: "length", label: tr("Délka příruby"), kind: "number" as const, min: 0.1 },
  { key: "angle", label: tr("Úhel ohybu"), kind: "number" as const, min: 1, max: 180, unit: "°" },
  { key: "radius", label: tr("Vnitřní poloměr"), kind: "number" as const, min: 0, step: 0.5, hint: tr("0 = dle parametrů plechu") },
  { key: "flip", label: tr("Ohnout na opačnou stranu"), kind: "bool" as const },
  { key: "position", label: tr("Poloha materiálu"), kind: "enum" as const, options: [{ v: "bendOutside", l: tr("Ohyb vně") }, { v: "materialInside", l: tr("Materiál uvnitř") }] },
  { key: "relief", label: tr("Úleva ohybu"), kind: "enum" as const, options: [{ v: "none", l: tr("Žádná") }, { v: "rect", l: tr("Obdélník") }, { v: "obround", l: tr("Oválná") }] },
  { key: "reliefWidth", label: tr("Šířka úlevy"), kind: "number" as const, min: 0.1 },
  { key: "reliefDepth", label: tr("Hloubka úlevy"), kind: "number" as const, min: 0 },
];

/** Společná stavba ohybu z hrany / lemu. */
async function buildFlange(d: Record<string, unknown>, ctx: ExtBuildCtx, hem: boolean): Promise<Shape> {
  if (!ctx.body) throw new Error(tr("Nejdřív vytvořte Základní plech."));
  const r = await rep();
  const p = sheetParamsAt(ctx.doc, ctx.index);
  const t = p.t;
  const edges = (d.edges as number[] | undefined) ?? [];
  if (!edges.length) throw new Error(tr("Vyberte hranu plechu, ze které se má ohyb vytvořit."));
  const angle = hem ? 180 : num(d.angle, 90);
  if (!(angle > 0 && angle <= 180)) throw new Error(tr("Úhel ohybu musí být 1–180°."));
  const length = num(d.length, hem ? 10 : 20);
  if (!(length > 0)) throw new Error(tr("Délka příruby musí být kladná."));
  const R = hem ? (d.kind === "closed" ? Math.max(0.05, 0.1 * t) : bendRadius(d, p)) : bendRadius(d, p);
  let body: Shape = ctx.body;
  const infos = [];
  for (const ei of edges) infos.push(await sheetEdge(ctx.body, ei));
  for (const e of infos) {
    const nEff = d.flip ? mul(e.faceN, -1) : e.faceN;
    const w = e.sideN;
    const u = norm(cross(w, nEff));
    const s0 = dot(e.a, u) <= dot(e.b, u) ? e.a : e.b;
    const originIn = d.flip ? sub(s0, mul(e.faceN, t)) : s0;
    const inside = d.position === "materialInside";
    const shift = inside ? R + t : 0;
    const fl = await bendSolid(sub(originIn, mul(w, shift)), w, nEff, u, e.len, angle, R, t, length, 0);
    if (inside) {
      // odebrat pruh základního plechu, kam se ohyb posunul
      const plane = new r.Plane(add(originIn, mul(nEff, 0.5)), u, w);
      const cutter = r
        .drawRectangle(e.len + 1, t + 1)
        .translate(e.len / 2, 0)
        .sketchOnPlane(plane)
        .extrude(-shift) as Shape;
      body = body.cut(cutter) as Shape;
      const rw = num(d.reliefWidth, t);
      const rd = num(d.reliefDepth, 0);
      if (d.relief && d.relief !== "none" && rw > 0 && rd > 0) {
        for (const s of [0, e.len - rw]) {
          const rp = new r.Plane(add(add(originIn, mul(nEff, 0.5)), mul(u, s)), u, w);
          let rc = r
            .drawRectangle(rw, t + 1)
            .translate(rw / 2, 0)
            .sketchOnPlane(rp)
            .extrude(-(shift + rd)) as Shape;
          if (d.relief === "obround") {
            const cp = new r.Plane(add(add(originIn, mul(nEff, 0.5)), add(mul(u, s + rw / 2), mul(w, -(shift + rd)))), u, nEff);
            const cyl = r.drawCircle(rw / 2).sketchOnPlane(cp).extrude(-(t + 1)) as Shape;
            rc = rc.fuse(cyl) as Shape;
          }
          body = body.cut(rc) as Shape;
        }
      }
    }
    body = body.fuse(fl) as Shape;
  }
  return body;
}

registerExt({
  ext: "sheet.flange",
  label: tr("Ohyb z hrany"),
  icon: "sheet-flange",
  tone: "create",
  tab: "sheet",
  group: "Ohyby",
  big: true,
  order: 0,
  kbd: "Shift+F",
  hint: tr("příruba pod úhlem z vybrané hrany plechu"),
  pick: { kind: "edges", key: "edges" },
  rollback: true,
  make: (doc, extra) => ({ edges: (extra?.edges as number[]) ?? [], length: 20, angle: 90, radius: 0, flip: false, position: "bendOutside", relief: "none", reliefWidth: sheetParamsAt(doc, doc.features.length).t, reliefDepth: 0 }),
  params: FLANGE_PARAMS,
  build: (d, ctx) => buildFlange(d, ctx, false),
});

registerExt({
  ext: "sheet.hem",
  label: tr("Lem"),
  icon: "sheet-hem",
  tone: "create",
  tab: "sheet",
  group: "Ohyby",
  order: 1,
  hint: tr("zahnutý okraj 180° – uzavřený nebo otevřený"),
  pick: { kind: "edges", key: "edges" },
  rollback: true,
  make: (_doc, extra) => ({ edges: (extra?.edges as number[]) ?? [], length: 8, kind: "open", radius: 0, flip: false, position: "bendOutside" }),
  params: [
    { key: "edges", label: tr("Hrany lemu"), kind: "edges" },
    { key: "length", label: tr("Délka lemu"), kind: "number", min: 0.1 },
    { key: "kind", label: tr("Typ lemu"), kind: "enum", options: [{ v: "open", l: tr("Otevřený") }, { v: "closed", l: tr("Uzavřený") }, { v: "teardrop", l: tr("Kapka") }] },
    { key: "radius", label: tr("Vnitřní poloměr (otevřený)"), kind: "number", min: 0, step: 0.5, hint: tr("0 = dle parametrů plechu") },
    { key: "flip", label: tr("Zahnout na opačnou stranu"), kind: "bool" },
  ],
  build: (d, ctx) => buildFlange(d, ctx, true),
});

registerExt({
  ext: "sheet.bend",
  label: tr("Ohyb podle čáry"),
  icon: "sheet-bend",
  tone: "create",
  tab: "sheet",
  group: "Ohyby",
  order: 2,
  hint: tr("úsečka ve skice na ploše plechu rozdělí plech a jednu stranu ohne"),
  make: (doc) => {
    const sk = [...doc.features].reverse().find((f) => f.type === "sketch");
    return { sketchId: sk?.id ?? "", angle: 90, radius: 0, side: "left", direction: "up" };
  },
  params: [
    { key: "sketchId", label: tr("Skica s čárou ohybu"), kind: "sketch" },
    { key: "angle", label: tr("Úhel ohybu"), kind: "number", min: 1, max: 179, unit: "°" },
    { key: "radius", label: tr("Vnitřní poloměr"), kind: "number", min: 0, step: 0.5, hint: tr("0 = dle parametrů plechu") },
    { key: "side", label: tr("Ohýbaná strana"), kind: "enum", options: [{ v: "left", l: tr("Vlevo od čáry") }, { v: "right", l: tr("Vpravo od čáry") }] },
    { key: "direction", label: tr("Směr ohybu"), kind: "enum", options: [{ v: "up", l: tr("K normále skici") }, { v: "down", l: tr("Od normály skici") }] },
  ],
  build: async (d, ctx) => {
    if (!ctx.body) throw new Error(tr("Nejdřív vytvořte Základní plech."));
    const r = await rep();
    const p = sheetParamsAt(ctx.doc, ctx.index);
    const t = p.t;
    const sk = needSketch(ctx, d.sketchId, tr("skicu s čárou ohybu"));
    const [q0, q1] = sketchLine(sk);
    const pb = planeBasis(sk.plane);
    const p0 = toWorld(sk.plane, q0);
    const p1 = toWorld(sk.plane, q1);
    const ns = pb.n;
    const u0 = norm(sub(p1, p0));
    const leftW = norm(cross(ns, u0));
    const w = d.side === "right" ? mul(leftW, -1) : leftW;
    const angle = num(d.angle, 90);
    const R = bendRadius(d, p);
    const ba = bendAllowance(angle, R, t, p.k);
    const pm = mul(add(p0, p1), 0.5);
    const matAbove = await materialOn(ctx.body, pm, ns, t);
    const matBelow = await materialOn(ctx.body, pm, mul(ns, -1), t);
    if (!matAbove && !matBelow) throw new Error(tr("Čára ohybu musí ležet na ploše plechu (skica na horní nebo spodní ploše) a procházet materiálem."));
    const down = d.direction === "down";
    const nEff = down ? mul(ns, -1) : ns;
    // vnitřní plocha ohybu: horní (ve směru nEff) plocha plechu
    const topOrigin = matAbove ? add(p0, mul(ns, t)) : p0; // plocha plechu ve směru +ns
    const innerOrigin = down ? sub(topOrigin, mul(ns, t)) : topOrigin;
    const u = norm(cross(w, nEff));
    const BIG = bboxDiag(ctx.body) * 4 + 100;
    const fixed = ctx.body.clone().intersect(await slab(innerOrigin, u, w, -BIG, 0, BIG)) as Shape;
    const moving = ctx.body.clone().intersect(await slab(innerOrigin, u, w, ba, BIG, BIG)) as Shape;
    const strip = ctx.body.clone().intersect(await slab(innerOrigin, u, w, 0, ba, BIG)) as Shape;
    const vol = (s: Shape) => {
      try {
        return r.measureVolume(s);
      } catch {
        return 0;
      }
    };
    if (vol(fixed) < 1e-6 || vol(moving) < 1e-6) throw new Error(tr("Čára ohybu musí rozdělit plech na dvě části (leží mimo plech nebo u okraje)."));
    // rozsah materiálu podél osy ohybu
    const corners = strip.boundingBox.bounds;
    const us = [corners[0], corners[1]].flatMap((c) => [[c[0], corners[0][1], corners[0][2]], [c[0], corners[1][1], corners[1][2]]]);
    let umin = Infinity;
    let umax = -Infinity;
    for (const x of [corners[0][0], corners[1][0]]) for (const y of [corners[0][1], corners[1][1]]) for (const z of [corners[0][2], corners[1][2]]) {
      const v = dot([x, y, z], u);
      umin = Math.min(umin, v);
      umax = Math.max(umax, v);
    }
    void us;
    const uBase = dot(innerOrigin, u);
    const start = add(innerOrigin, mul(u, umin - uBase));
    const arc = await bendSolid(start, w, nEff, u, umax - umin, angle, R, t, 0, 0);
    const c = add(innerOrigin, mul(nEff, R));
    const moved = moving.translate(mul(w, -ba)).rotate(angle, c, u) as Shape;
    return fixed.fuse(arc).fuse(moved) as Shape;
  },
});

registerExt({
  ext: "sheet.cut",
  label: tr("Výřez"),
  icon: "sheet-cut",
  tone: "cut",
  tab: "sheet",
  group: "Plech",
  order: 2,
  hint: tr("uzavřená skica na ploše plechu → otvor skrz"),
  make: (doc) => {
    const sk = [...doc.features].reverse().find((f) => f.type === "sketch");
    return { sketchId: sk?.id ?? "" };
  },
  params: [{ key: "sketchId", label: tr("Skica výřezu"), kind: "sketch" }],
  build: async (d, ctx) => {
    if (!ctx.body) throw new Error(tr("Nejdřív vytvořte Základní plech."));
    const { sketchDrawing, planeOf } = await bld();
    const sk = needSketch(ctx, d.sketchId, tr("skicu výřezu"));
    const dr = sketchDrawing(sk);
    if (!dr) throw new Error(tr("Skica výřezu musí být uzavřená."));
    const plane = planeOf(sk.plane);
    const BIG = bboxDiag(ctx.body) * 2 + 50;
    const n = plane.zDir;
    const tool = (dr.sketchOnPlane(plane).extrude(BIG) as Shape).translate([(-n.x * BIG) / 2, (-n.y * BIG) / 2, (-n.z * BIG) / 2]) as Shape;
    return ctx.body.cut(tool) as Shape;
  },
});

registerExt({
  ext: "sheet.relief",
  label: tr("Rohová úleva"),
  icon: "sheet-relief",
  tone: "cut",
  tab: "sheet",
  group: "Plech",
  order: 3,
  hint: tr("čtvercový nebo kruhový výřez v rohu mezi ohyby"),
  make: (doc) => ({ point: [0, 0, 0], kind: "round", size: 2 * sheetParamsAt(doc, doc.features.length).t, axis: { kind: "axis", axis: "Z" } }),
  params: [
    { key: "pointRef", label: tr("Střed úlevy odkazem"), kind: "point", hint: tr("vrchol, střed hrany, bod skici… – má přednost před souřadnicemi níže") },
    { key: "point", label: tr("Střed úlevy"), kind: "vec3" },
    { key: "kind", label: tr("Tvar"), kind: "enum", options: [{ v: "round", l: tr("Kruhová") }, { v: "rect", l: tr("Čtvercová") }] },
    { key: "size", label: tr("Velikost (Ø / strana)"), kind: "number", min: 0.1 },
    { key: "axis", label: tr("Osa výřezu"), kind: "direction", hint: tr("X / Y / Z, vektor čísly, nebo odkazem: normála plochy plechu, hrana") },
  ],
  build: async (d, ctx) => {
    if (!ctx.body) throw new Error(tr("Nejdřív vytvořte Základní plech."));
    const r = await rep();
    const pt = extPoint(d, ctx, "point");
    const size = num(d.size, 4);
    // osa: dřívější „X“ / „Y“ / „Z“, nebo směr vektorem / odkazem (normála plochy, hrana)
    const axis = extDirection(d, ctx, "axis");
    const L = bboxDiag(ctx.body) * 2;
    const start = sub(pt, mul(axis as Vec3, L / 2));
    // +X / +Y / +Z = původní výpočet (krabice v osách); obecný směr = čtvercový výřez natočený do osy
    const alongAxis = axis.filter((c) => c === 0).length === 2 && axis.includes(1);
    let tool: Shape;
    if (d.kind === "rect" && !alongAxis) {
      const h = size / 2;
      let box = r.makeBox([-h, -h, -L / 2], [h, h, L / 2]) as Shape;
      const c = dot([0, 0, 1], axis);
      if (c < -0.999999) box = box.rotate(180, [0, 0, 0], [1, 0, 0]) as Shape;
      else if (c < 0.999999) box = box.rotate((Math.acos(c) * 180) / Math.PI, [0, 0, 0], norm(cross([0, 0, 1], axis))) as Shape;
      tool = box.translate(pt) as Shape;
    } else if (d.kind === "rect") {
      const h = size / 2;
      tool = r.makeBox([pt[0] - h, pt[1] - h, pt[2] - h], [pt[0] + h, pt[1] + h, pt[2] + h]) as Shape;
      const ext = axis.map((v) => v * L) as Vec3;
      const box = r.makeBox([start[0] - h * (1 - axis[0]), start[1] - h * (1 - axis[1]), start[2] - h * (1 - axis[2])], [start[0] + ext[0] + h * (1 - axis[0]), start[1] + ext[1] + h * (1 - axis[1]), start[2] + ext[2] + h * (1 - axis[2])]) as Shape;
      tool = box;
    } else tool = r.makeCylinder(size / 2, L, start, axis as Vec3) as Shape;
    return ctx.body.cut(tool) as Shape;
  },
});

registerExt({
  ext: "sheet.rib",
  label: tr("Prolis (žebro)"),
  icon: "sheet-rib",
  tone: "feature",
  tab: "sheet",
  group: "Plech",
  order: 4,
  hint: tr("vylisované žebro podél úsečky ve skice (zjednodušeně: zaoblený výstupek)"),
  make: (doc) => {
    const sk = [...doc.features].reverse().find((f) => f.type === "sketch");
    return { sketchId: sk?.id ?? "", width: 6, height: 2 };
  },
  params: [
    { key: "sketchId", label: tr("Skica s osou prolisu"), kind: "sketch" },
    { key: "width", label: tr("Šířka"), kind: "number", min: 0.5 },
    { key: "height", label: tr("Výška"), kind: "number", min: 0.1 },
  ],
  build: async (d, ctx) => {
    if (!ctx.body) throw new Error(tr("Nejdřív vytvořte Základní plech."));
    const r = await rep();
    const { planeOf } = await bld();
    const p = sheetParamsAt(ctx.doc, ctx.index);
    const sk = needSketch(ctx, d.sketchId, tr("skicu s osou prolisu"));
    const [q0, q1] = sketchLine(sk);
    const wdt = num(d.width, 6);
    const hgt = num(d.height, 2);
    const plane = planeOf(sk.plane);
    const pb = planeBasis(sk.plane);
    const p0 = toWorld(sk.plane, q0);
    const pm = mul(add(p0, toWorld(sk.plane, q1)), 0.5);
    const matAbove = await materialOn(ctx.body, pm, pb.n, p.t);
    const matBelow = await materialOn(ctx.body, pm, mul(pb.n, -1), p.t);
    if (!matAbove && !matBelow) throw new Error(tr("Osa prolisu musí ležet na ploše plechu."));
    const dx = q1[0] - q0[0];
    const dy = q1[1] - q0[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) throw new Error(tr("Osa prolisu má nulovou délku."));
    const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    const rect = r.drawRectangle(len, wdt).translate(len / 2, 0).rotate(ang, [0, 0]).translate(q0[0], q0[1]);
    // výstupek směrem ven z materiálu, zaoblený shora
    const dirSign = matAbove ? -1 : 1;
    let rib = rect.sketchOnPlane(plane).extrude(dirSign * hgt) as Shape;
    try {
      rib = rib.fillet(Math.min(wdt / 2.2, hgt * 0.9)) as Shape;
    } catch {
      /* bez zaoblení */
    }
    return ctx.body.fuse(rib) as Shape;
  },
});

registerExt({
  ext: "sheet.unfold",
  label: tr("Rozvinout"),
  icon: "sheet-unfold",
  tone: "pattern",
  tab: "sheet",
  group: "Rozvin",
  big: true,
  order: 0,
  hint: tr("plochý díl (rozvin) z historie ohybů – potlačením prvku se vrátí ohnutý tvar"),
  make: () => ({}),
  params: [],
  build: async (_d, ctx) => {
    const r = await rep();
    const { buildShape, planeOf } = await bld();
    const cache = new Map<number, Shape | null>();
    const resolve = async (fi: number, ei: number): Promise<EdgeGeom | null> => {
      if (!cache.has(fi)) cache.set(fi, (await buildShape(ctx.doc, fi - 1)).body);
      const b = cache.get(fi);
      if (!b) return null;
      const e = b.edges[ei];
      if (!e || e.geomType !== "LINE") return null;
      return { a: vt(e.startPoint), b: vt(e.endPoint) };
    };
    const resolveFace = async (fi: number, fx: number) => {
      if (!cache.has(fi)) cache.set(fi, (await buildShape(ctx.doc, fi - 1)).body);
      const f = cache.get(fi)?.faces[fx];
      if (!f || f.geomType !== "PLANE") return null;
      return { origin: vt(f.center), normal: norm(vt(f.normalAt(f.center))) };
    };
    const lay = await flatLayout(ctx.doc, resolve, ctx.index, resolveFace);
    const toPen = (segs: typeof lay.outer) => {
      let pen = r.draw(segs[0].a);
      for (const s of segs) pen = s.kind === "line" ? pen.lineTo(s.b) : pen.threePointsArcTo(s.b, s.m);
      return pen.close();
    };
    let dr = toPen(lay.outer);
    for (const h of lay.holes) {
      try {
        dr = dr.cut(toPen(h));
      } catch {
        /* díra mimo obrys */
      }
    }
    const plane = planeOf(lay.basePlane);
    const t = lay.t;
    let s = dr.sketchOnPlane(plane).extrude(lay.baseDirection === "reverse" ? -t : t) as Shape;
    if (lay.baseDirection === "symmetric") {
      const n = plane.zDir;
      s = s.translate([(-n.x * t) / 2, (-n.y * t) / 2, (-n.z * t) / 2]) as Shape;
    }
    return s;
  },
});

// akce (UI): export rozvinu, tabulka ohybů
registerExt({ ext: "sheet.dxf", label: tr("Rozvin → DXF"), icon: "sheet-dxf", tone: "file", tab: "sheet", group: "Rozvin", order: 1, hint: tr("obrys, díry, čáry ohybů a tabulka ohybů (AutoCAD, laser, ohraňovací lis)"), make: () => ({}), action: true, scope: "both" });
registerExt({ ext: "sheet.svg", label: tr("Rozvin → SVG"), icon: "sheet-dxf", tone: "file", tab: "sheet", group: "Rozvin", order: 2, hint: tr("rozvin s čarami ohybů pro tisk/náhled"), make: () => ({}), action: true, scope: "both" });
registerExt({ ext: "sheet.table", label: tr("Tabulka ohybů"), icon: "sheet-table", tone: "tool", tab: "sheet", group: "Rozvin", order: 3, hint: tr("pořadí, úhly, poloměry a BA všech ohybů"), make: () => ({}), action: true, scope: "both" });

/** Pomocné exporty pro testy a UI. */
export { baseFeatureIndex, bendAllowance, sheetParamsAt };
export type { CadDoc };
