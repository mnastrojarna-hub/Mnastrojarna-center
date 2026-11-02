/**
 * Pole, skořepina a úkos s bohatým zadáním (5. vlna). Registruje stavitele `pattern`, `shell` a `draft`
 * přes `registerFeatureBuilder`, takže `build.ts` zůstává beze změny.
 *
 * Pole – 5 druhů: lineární (směr číslem nebo odkazem, mřížka, vynechané kusy, krok / celková délka, střídavé řady),
 * kruhové (osa odkazem, rovnoměrně / krok, symetricky, vynechané kusy), po křivce skici (tečně / pevně, rozteč),
 * podle bodů skici a výplňové (mřížka / střídavě / kruhově uvnitř uzavřeného obrysu s okrajem).
 * Zdrojem je nástrojové těleso dřívějšího prvku (`ctx.tools`), lze jich opakovat více naráz (`featureIds`).
 * Referenční bod zdroje (po křivce / podle skici / výplň) = střed obalového kvádru nástroje.
 */
import * as r from "replicad";
import { applyMode, axisPlane, needSketch, sketchPathWire } from "../build";
import { planeBasis } from "../defaults";
import { faceNormal, pushPull } from "../direct";
import { axisVec, resolveAxis, resolveDirection, resolvePlaneDef, sketchTo3D, V, type ResolveCtx } from "../ref-resolve";
import { findLoops, loopPolygon, nestLoops, pointInPolygon } from "../sketch";
import type { BoolMode, Feature, SketchPlane, Vec2, Vec3 } from "../types";
import { registerFeatureBuilder, type FeatCtx } from "./registry";

type Shape = r.Shape3D;
type PatternF = Extract<Feature, { type: "pattern" }>;
type ShellF = Extract<Feature, { type: "shell" }>;
type DraftF = Extract<Feature, { type: "draft" }>;
type SketchF = Extract<Feature, { type: "sketch" }>;
type Tool = { tool: Shape; mode: BoolMode };
/** Umístění jedné kopie: transformace klonu nástroje. */
type Xf = (s: Shape) => Shape;
/** Instance pole: index (0 = zdroj, ten se znovu nestaví) + transformace. */
type Inst = { i: number; xf: Xf };

export const PATTERN_MAX = 400;
const vt = (v: { x: number; y: number; z: number }): Vec3 => [v.x, v.y, v.z];
const rc = (ctx: FeatCtx): ResolveCtx => ({ body: ctx.body, sketches: ctx.sketches, features: ctx.features });
const ERR_SOURCE = "Vyberte prvek (vysunutí, díra, primitivum…), který se má opakovat.";

function bboxCenter(shapes: Shape[]): Vec3 {
  let lo: Vec3 = [Infinity, Infinity, Infinity];
  let hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const s of shapes) {
    const [a, b] = s.boundingBox.bounds as [Vec3, Vec3];
    lo = [Math.min(lo[0], a[0]), Math.min(lo[1], a[1]), Math.min(lo[2], a[2])];
    hi = [Math.max(hi[0], b[0]), Math.max(hi[1], b[1]), Math.max(hi[2], b[2])];
  }
  return V.mul(V.add(lo, hi), 0.5);
}

/** Zdrojové nástroje pole (`featureIds` má přednost, `featureId` = zpětná kompatibilita). */
export function sourceTools(f: PatternF, ctx: FeatCtx): Tool[] {
  const ids = [...new Set((f.featureIds?.length ? f.featureIds : [f.featureId]).filter(Boolean))];
  if (!ids.length) throw new Error(ERR_SOURCE);
  return ids.map((id) => {
    const t = ctx.tools.get(id);
    if (t) return t;
    const src = ctx.doc.features.find((x) => x.id === id);
    if (!src) throw new Error(ERR_SOURCE);
    throw new Error(`Prvek „${src.name}“ nelze opakovat – pole umí opakovat jen prvky s nástrojovým tělesem (vysunutí, rotace, díra, primitiva, tažení, šablonování, text), které jsou v historii před polem a nejsou potlačené.`);
  });
}

const unit = (d: Vec3, what = "Směr pole"): Vec3 => {
  const len = V.len(d);
  if (len < 1e-12) throw new Error(`${what} nesmí být nulový.`);
  return V.mul(d, 1 / len);
};
const checkCount = (n: number) => {
  if (n > PATTERN_MAX) throw new Error(`Pole má příliš mnoho kusů (${n}, max. ${PATTERN_MAX}).`);
};
const skipSet = (f: PatternF) => new Set((f.skip ?? []).map((k) => Math.round(k)));
const translateBy = (d: Vec3): Xf => (s) => s.translate(d);

// ---------------- lineární ----------------

function linearInstances(f: Extract<PatternF, { kind: "linear" }>, ctx: FeatCtx): Inst[] {
  const n1 = Math.max(1, Math.round(f.count));
  const n2 = Math.max(1, Math.round(f.count2 ?? 1));
  checkCount(n1 * n2);
  const d1 = f.dirDef ? resolveDirection(rc(ctx), f.dirDef, { normal: [0, 0, 1] }) : unit(f.direction);
  const d2: Vec3 = n2 > 1 ? (f.dirDef2 ? resolveDirection(rc(ctx), f.dirDef2, { normal: [0, 0, 1] }) : unit(f.direction2 ?? [0, 1, 0], "Druhý směr pole")) : [0, 0, 0];
  if (n2 > 1 && Math.abs(V.dot(d1, d2)) > 0.9999) throw new Error("Druhý směr pole je rovnoběžný s prvním – zvolte jiný směr.");
  const total = f.spacingMode === "total";
  const sp2 = f.spacing2 ?? f.spacing;
  if (n1 > 1 && !(Math.abs(f.spacing) > 1e-9)) throw new Error("Rozteč pole nesmí být nulová.");
  if (n2 > 1 && !(Math.abs(sp2) > 1e-9)) throw new Error("Rozteč ve druhém směru nesmí být nulová.");
  const step1 = total ? (n1 > 1 ? f.spacing / (n1 - 1) : 0) : f.spacing;
  const step2 = total ? (n2 > 1 ? sp2 / (n2 - 1) : 0) : sp2;
  const skip = skipSet(f);
  const out: Inst[] = [];
  for (let a = 0; a < n1; a++)
    for (let b = 0; b < n2; b++) {
      const i = a * n2 + b;
      if (!i || skip.has(i)) continue;
      const shift = f.stagger && b % 2 === 1 ? step1 / 2 : 0;
      out.push({ i, xf: translateBy(V.add(V.mul(d1, step1 * a + shift), V.mul(d2, step2 * b))) });
    }
  return out;
}

// ---------------- kruhové ----------------

function circularInstances(f: Extract<PatternF, { kind: "circular" }>, ctx: FeatCtx, tools: Tool[]): Inst[] {
  const n = Math.max(1, Math.round(f.count));
  const sym = !!f.symmetric;
  checkCount(sym ? 2 * n - 1 : n);
  const ax = f.axisDef ? resolveAxis(rc(ctx), f.axisDef, null) : { origin: f.center, dir: unit(axisVec(f.axis), "Osa pole") };
  const angle = Math.abs(f.angle) || 360;
  const equal = f.equalSpacing ?? angle >= 360;
  const step = n > 1 ? (equal ? angle / n : angle / (n - 1)) : 0;
  const skip = skipSet(f);
  const center = f.radial === false ? bboxCenter(tools.map((t) => t.tool)) : null;
  const place = (deg: number): Xf => {
    if (!center) return (s) => s.rotate(deg, ax.origin, ax.dir);
    // bez natáčení: kopie se jen posune na místo otočeného středu
    const rel = V.sub(center, ax.origin);
    const moved = V.add(ax.origin, V.rotate(rel, ax.dir, deg));
    return translateBy(V.sub(moved, center));
  };
  const out: Inst[] = [];
  for (let k = 1; k < n; k++) if (!skip.has(k)) out.push({ i: k, xf: place(step * k) });
  if (sym) for (let k = 1; k < n; k++) if (!skip.has(n - 1 + k)) out.push({ i: n - 1 + k, xf: place(-step * k) });
  return out;
}

// ---------------- po křivce ----------------

type Walk = { e: r.Edge; flip: boolean; len: number };

/** Hrany drátu seřazené za sebou (s případným otočením), aby se dalo jít po délce. */
function orderedEdges(wire: r.Wire): Walk[] {
  const edges = wire.edges;
  if (!edges.length) throw new Error("Křivka pole je prázdná.");
  const P = (e: r.Edge, end: 0 | 1) => vt(end ? e.endPoint : e.startPoint);
  const [lo, hi] = wire.boundingBox.bounds as [Vec3, Vec3];
  const diag = Math.max(1, V.len(V.sub(hi, lo)));
  const near = (a: Vec3, b: Vec3) => V.len(V.sub(a, b)) < diag * 1e-6 + 1e-6;
  const ends = edges.flatMap((e) => [P(e, 0), P(e, 1)]);
  const degree = (p: Vec3) => ends.filter((q) => near(p, q)).length;
  let start = 0;
  let flip = false;
  for (let i = 0; i < edges.length; i++) {
    if (degree(P(edges[i], 0)) === 1) {
      start = i;
      flip = false;
      break;
    }
    if (degree(P(edges[i], 1)) === 1) {
      start = i;
      flip = true;
      break;
    }
  }
  const used = edges.map(() => false);
  const walk: Walk[] = [{ e: edges[start], flip, len: edges[start].length }];
  used[start] = true;
  for (;;) {
    const last = walk[walk.length - 1];
    const tail = P(last.e, last.flip ? 0 : 1);
    let found = false;
    for (let j = 0; j < edges.length; j++) {
      if (used[j]) continue;
      if (near(P(edges[j], 0), tail)) walk.push({ e: edges[j], flip: false, len: edges[j].length });
      else if (near(P(edges[j], 1), tail)) walk.push({ e: edges[j], flip: true, len: edges[j].length });
      else continue;
      used[j] = true;
      found = true;
      break;
    }
    if (!found) break;
  }
  if (used.some((u) => !u)) throw new Error("Křivka pole musí být jedna souvislá čára (bez větvení a mezer).");
  return walk;
}

/** Bod a jednotková tečna v délce `s` od začátku křivky. */
function alongCurve(walk: Walk[], s: number): { p: Vec3; t: Vec3 } {
  const total = walk.reduce((a, w) => a + w.len, 0);
  let rest = Math.max(0, Math.min(total, s));
  for (let k = 0; k < walk.length; k++) {
    const w = walk[k];
    const lastOne = k === walk.length - 1;
    if (rest <= w.len + 1e-9 || lastOne) {
      const u = w.len > 1e-12 ? Math.max(0, Math.min(1, rest / w.len)) : 0;
      const t = w.flip ? 1 - u : u;
      const tan = unit(vt(w.e.tangentAt(t)), "Tečna křivky");
      return { p: vt(w.e.pointAt(t)), t: w.flip ? V.mul(tan, -1) : tan };
    }
    rest -= w.len;
  }
  throw new Error("Křivka pole je prázdná.");
}

function curveInstances(f: Extract<PatternF, { kind: "curve" }>, ctx: FeatCtx, tools: Tool[]): Inst[] {
  const sk = needSketch(ctx, f.sketchId, "skica křivky pole");
  const n = Math.max(1, Math.round(f.count));
  checkCount(n);
  const wire = sketchPathWire(sk);
  const walk = orderedEdges(wire);
  const L = walk.reduce((a, w) => a + w.len, 0);
  if (!(L > 1e-9)) throw new Error(`Křivka ve skice „${sk.name}“ má nulovou délku.`);
  const first = walk[0];
  const last = walk[walk.length - 1];
  const closed = V.len(V.sub(vt(first.flip ? first.e.endPoint : first.e.startPoint), vt(last.flip ? last.e.startPoint : last.e.endPoint))) < 1e-6 * Math.max(1, L);
  const sp = f.spacing ?? 0;
  const pos: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = sp > 0 ? i * sp : n > 1 ? (closed ? (L * i) / n : (L * i) / (n - 1)) : 0;
    if (s > L + 1e-6) throw new Error(`Pole se na křivku nevejde (délka ${Math.round(L * 100) / 100} mm) – zmenšete rozteč nebo počet kusů.`);
    pos.push(s);
  }
  const normal = planeBasis(sk.plane).n;
  const center = bboxCenter(tools.map((t) => t.tool));
  const p0 = alongCurve(walk, 0);
  const skip = skipSet(f);
  const out: Inst[] = [];
  for (let i = 1; i < n; i++) {
    if (skip.has(i)) continue;
    const { p, t } = alongCurve(walk, pos[i]);
    const d = V.sub(p, p0.p);
    if (f.align !== "tangent") {
      out.push({ i, xf: translateBy(d) });
      continue;
    }
    const c = Math.max(-1, Math.min(1, V.dot(p0.t, t)));
    const deg = (Math.acos(c) * 180) / Math.PI;
    const cr = V.cross(p0.t, t);
    const axis = V.len(cr) > 1e-9 ? V.norm(cr) : normal;
    out.push({ i, xf: (s) => (deg > 1e-9 ? s.rotate(deg, center, axis) : s).translate(d) });
  }
  return out;
}

// ---------------- podle skici ----------------

/** Průmět bodu do roviny skici (3D) a jeho souřadnice ve skice (2D). */
function projectToSketch(plane: SketchPlane, p: Vec3): { p3: Vec3; p2: Vec2 } {
  const b = planeBasis(plane);
  const rel = V.sub(p, b.origin);
  const p2: Vec2 = [V.dot(rel, b.x), V.dot(rel, b.y)];
  return { p3: sketchTo3D(plane, p2), p2 };
}

function sketchInstances(f: Extract<PatternF, { kind: "sketch" }>, ctx: FeatCtx, tools: Tool[]): Inst[] {
  const sk = needSketch(ctx, f.sketchId, "skica s body pole");
  const pts = sk.entities.flatMap((e) => (e.type === "point" ? [e.p] : []));
  if (!pts.length) throw new Error(`Skica „${sk.name}“ neobsahuje žádné body – nakreslete body (nástroj Bod) v místech kopií.`);
  checkCount(pts.length);
  const ref = projectToSketch(sk.plane, bboxCenter(tools.map((t) => t.tool)));
  const skip = skipSet(f);
  const out: Inst[] = [];
  pts.forEach((p, i) => {
    if (skip.has(i)) return;
    const d = V.sub(sketchTo3D(sk.plane, p), ref.p3);
    if (V.len(d) < 1e-6) return; // bod v místě zdroje = zdroj sám
    out.push({ i, xf: translateBy(d) });
  });
  if (!out.length) throw new Error(`Všechny body skici „${sk.name}“ leží v místě zdrojového prvku – přidejte další body.`);
  return out;
}

// ---------------- výplňové ----------------

function segDist(p: Vec2, a: Vec2, b: Vec2) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 > 1e-18 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
}
function polyDist(p: Vec2, poly: Vec2[]) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) best = Math.min(best, segDist(p, poly[i], poly[(i + 1) % poly.length]));
  return best;
}

/** Body výplňového pole ve 2D skici: mřížka / střídavě / soustředně kolem počátku `o`, jen uvnitř obrysu s okrajem. */
export function fillPoints(outer: Vec2[][], holes: Vec2[][], o: Vec2, spacing: number, margin: number, layout: "grid" | "stagger" | "circular"): Vec2[] {
  const xs = outer.flatMap((p) => p.map((q) => q[0]));
  const ys = outer.flatMap((p) => p.map((q) => q[1]));
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const all = [...outer, ...holes];
  const inside = (p: Vec2) => outer.some((poly) => pointInPolygon(p, poly)) && !holes.some((h) => pointInPolygon(p, h)) && (margin <= 0 || all.every((poly) => polyDist(p, poly) >= margin - 1e-9));
  const cand: Vec2[] = [];
  if (layout === "circular") {
    const far = Math.max(...[[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => Math.hypot(x - o[0], y - o[1])));
    const K = Math.ceil(far / spacing);
    cand.push(o);
    for (let k = 1; k <= K; k++) {
      const nk = Math.max(1, Math.round(2 * Math.PI * k));
      for (let m = 0; m < nk; m++) {
        const a = (2 * Math.PI * m) / nk;
        cand.push([o[0] + k * spacing * Math.cos(a), o[1] + k * spacing * Math.sin(a)]);
      }
    }
  } else {
    const dy = layout === "stagger" ? (spacing * Math.sqrt(3)) / 2 : spacing;
    const j0 = Math.ceil((y0 - o[1]) / dy - 1e-9);
    const j1 = Math.floor((y1 - o[1]) / dy + 1e-9);
    for (let j = j0; j <= j1; j++) {
      const shift = layout === "stagger" && Math.abs(j % 2) === 1 ? spacing / 2 : 0;
      const i0 = Math.ceil((x0 - o[0] - shift) / spacing - 1e-9);
      const i1 = Math.floor((x1 - o[0] - shift) / spacing + 1e-9);
      for (let i = i0; i <= i1; i++) cand.push([o[0] + shift + i * spacing, o[1] + j * dy]);
    }
  }
  return cand.filter(inside);
}

function fillInstances(f: Extract<PatternF, { kind: "fill" }>, ctx: FeatCtx, tools: Tool[]): Inst[] {
  const sk = needSketch(ctx, f.sketchId, "skica obrysu výplně");
  if (!(f.spacing > 1e-9)) throw new Error("Rozteč výplňového pole musí být kladná.");
  const margin = Math.max(0, f.margin || 0);
  const { loops } = findLoops(sk.entities);
  if (!loops.length) throw new Error(`Skica „${sk.name}“ neobsahuje uzavřený obrys pro výplň.`);
  const nested = nestLoops(loops);
  const outer = nested.filter((x) => x.depth % 2 === 0).map((x) => loopPolygon(x.loop));
  const holes = nested.filter((x) => x.depth % 2 === 1).map((x) => loopPolygon(x.loop));
  const ref = projectToSketch(sk.plane, bboxCenter(tools.map((t) => t.tool)));
  const refInside = outer.some((p) => pointInPolygon(ref.p2, p)) && !holes.some((h) => pointInPolygon(ref.p2, h));
  const xs = outer.flatMap((p) => p.map((q) => q[0]));
  const ys = outer.flatMap((p) => p.map((q) => q[1]));
  const o: Vec2 = refInside ? ref.p2 : [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  const pts = fillPoints(outer, holes, o, f.spacing, margin, f.layout ?? "grid");
  if (!pts.length) throw new Error("Do obrysu se s touto roztečí a okrajem nevejde žádný kus – zmenšete rozteč nebo okraj.");
  if (pts.length > PATTERN_MAX) throw new Error(`Výplňové pole má příliš mnoho kusů (${pts.length}, max. ${PATTERN_MAX}) – zvětšete rozteč.`);
  const skip = skipSet(f);
  const out: Inst[] = [];
  pts.forEach((p, i) => {
    if (skip.has(i)) return;
    const d = V.sub(sketchTo3D(sk.plane, p), ref.p3);
    if (V.len(d) < 1e-6) return;
    out.push({ i, xf: translateBy(d) });
  });
  return out;
}

// ---------------- společné ----------------

function applyInstances(body: Shape, tools: Tool[], inst: Inst[], geometryOnly: boolean): Shape {
  let acc = body;
  if (geometryOnly) {
    for (const { tool, mode } of tools) {
      const copies = inst.map(({ xf }) => xf(tool.clone()));
      if (!copies.length) continue;
      let merged = copies[0];
      for (const c of copies.slice(1)) merged = merged.fuse(c);
      acc = applyMode(acc, merged, mode);
    }
    return acc;
  }
  for (const { xf } of inst) for (const { tool, mode } of tools) acc = applyMode(acc, xf(tool.clone()), mode);
  return acc;
}

/** Instance pole (bez zdroje) – pro stavbu i testy. */
export function patternInstances(f: PatternF, ctx: FeatCtx, tools: Tool[]): Inst[] {
  switch (f.kind) {
    case "linear":
      return linearInstances(f, ctx);
    case "circular":
      return circularInstances(f, ctx, tools);
    case "curve":
      return curveInstances(f, ctx, tools);
    case "sketch":
      return sketchInstances(f, ctx, tools);
    case "fill":
      return fillInstances(f, ctx, tools);
  }
}

registerFeatureBuilder("pattern", (f, ctx) => {
  if (!ctx.body) throw new Error("Není těleso.");
  const tools = sourceTools(f, ctx);
  const inst = patternInstances(f, ctx, tools);
  if (!inst.length) return null;
  return applyInstances(ctx.body, tools, inst, !!f.geometryOnly);
});

// ---------------- skořepina ----------------

const pickedFaces = (body: Shape, idx: number[], what: string) => {
  const all = body.faces;
  const picked = [...new Set(idx)].map((k) => all[k]).filter(Boolean);
  if (!picked.length) throw new Error(`Vyberte ${what}.`);
  return picked;
};

type OC = any; // OCCT shim (bez typů, jako v direct.ts)

/** Skořepina přímo přes OCCT: `offset` > 0 = stěna ven, < 0 = dovnitř; `join` = tvar vnějších hran (ostré / zaoblené). */
function thickSolid(body: Shape, faces: r.Face[], offset: number, join: "intersection" | "arc"): Shape {
  const oc = r.getOC() as OC;
  const list = new oc.NCollection_List_TopoDS_Shape();
  const mk = new oc.BRepOffsetAPI_MakeThickSolid();
  try {
    for (const f of faces) list.Append(f.wrapped);
    mk.MakeThickSolidByJoin(body.wrapped, list, offset, 1e-3, oc.BRepOffset_Mode.BRepOffset_Skin, false, false, join === "arc" ? oc.GeomAbs_JoinType.GeomAbs_Arc : oc.GeomAbs_JoinType.GeomAbs_Intersection, false);
    if (!mk.IsDone()) throw new Error("Skořepinu se nepodařilo vytvořit – zkuste menší tloušťku nebo jiné plochy.");
    const s = r.cast(mk.Shape()) as unknown as Shape;
    if (!(Math.abs(r.measureVolume(s)) > 0)) throw new Error("Skořepina nevytvořila objem – zkuste menší tloušťku.");
    return s;
  } finally {
    mk.delete();
    list.delete();
  }
}

registerFeatureBuilder("shell", (f: ShellF, ctx) => {
  const body = ctx.body;
  if (!body) throw new Error("Není co skořepinovat.");
  const t = f.thickness;
  if (!(t > 0)) throw new Error("Tloušťka musí být kladná.");
  const all = body.faces;
  const picked = pickedFaces(body, f.faces, "plochy, které se mají otevřít");
  const outward = !!f.outward;
  let out: Shape;
  if (outward) {
    // stěna přiroste ven (původní povrch zůstane vnitřní); vnější hrany ostré, při neúspěchu zaoblené
    try {
      out = thickSolid(body, picked, t, "intersection");
    } catch {
      out = thickSolid(body, picked, t, "arc");
    }
  } else out = body.clone().shell(t, (ff) => ff.when(({ element }) => picked.some((p) => p.isSame(element as r.Face))));
  const extra = Object.entries(f.thicknesses ?? {})
    .map(([k, v]) => ({ k: Number(k), v: Number(v) }))
    .filter(({ k, v }) => all[k] && Number.isFinite(v) && v > 0 && Math.abs(v - t) > 1e-9 && !f.faces.includes(k));
  for (const { k, v } of extra) {
    const of = all[k];
    if (of.geomType !== "PLANE") throw new Error(`Jinou tloušťku lze zadat jen u rovinných ploch (plocha ${k + 1} je ${of.geomType === "CYLINDRE" ? "válcová" : "zakřivená"}).`);
    const n = faceNormal(of);
    const o = vt(of.center);
    // protější stěna skořepiny: rovnoběžná, ve vzdálenosti t, normála dovnitř dutiny (dovnitř) / ven (ven)
    const want = outward ? n : V.mul(n, -1);
    const q = V.add(o, V.mul(n, outward ? t : -t));
    const tol = Math.max(1e-4, t * 1e-3);
    let best = -1;
    let bestD = Infinity;
    out.faces.forEach((cf, i) => {
      if (cf.geomType !== "PLANE") return;
      const cn = faceNormal(cf);
      if (V.dot(cn, want) < 0.999999) return;
      const c = vt(cf.center);
      if (Math.abs(V.dot(V.sub(c, q), n)) > tol) return;
      const d = V.len(V.sub(c, q));
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best < 0) throw new Error(`Protější stěnu skořepiny u plochy ${k + 1} se nepodařilo najít – jinou tloušťku zde nelze použít.`);
    out = pushPull(out, [best], v - t);
  }
  return out;
});

// ---------------- úkos ----------------

const roundKey = (p: Vec3, l: number) => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)},${Math.round(p[2] * 1e4)}|${Math.round(l * 1e4)}`;

/** Rozšíří výběr ploch o tečně navazující (společná hrana, normály u ní rovnoběžné do 1°). */
export function tangentFaces(body: Shape, picked: number[]): number[] {
  const all = body.faces;
  const byEdge = new Map<string, number[]>();
  const keys: string[][] = all.map((f, i) =>
    f.edges.map((e) => {
      const k = roundKey(vt(e.pointAt(0.5)), e.length);
      const list = byEdge.get(k);
      if (list) list.push(i);
      else byEdge.set(k, [i]);
      return k;
    }),
  );
  const sel = new Set(picked.filter((i) => all[i]));
  const queue = [...sel];
  const cos1 = Math.cos((1 * Math.PI) / 180);
  while (queue.length) {
    const fi = queue.pop()!;
    all[fi].edges.forEach((e, ei) => {
      for (const fj of byEdge.get(keys[fi][ei]) ?? []) {
        if (fj === fi || sel.has(fj)) continue;
        const mid = e.pointAt(0.5);
        const n1 = V.norm(vt(all[fi].normalAt(mid)));
        const n2 = V.norm(vt(all[fj].normalAt(mid)));
        if (V.dot(n1, n2) >= cos1) {
          sel.add(fj);
          queue.push(fj);
        }
      }
    });
  }
  return [...sel];
}

registerFeatureBuilder("draft", (f: DraftF, ctx) => {
  const body = ctx.body;
  if (!body) throw new Error("Není těleso pro úkos.");
  if (!(Math.abs(f.angle) > 0 && Math.abs(f.angle) < 45)) throw new Error("Úhel úkosu musí být mezi 0 a 45°.");
  const idx = f.tangentChain ? tangentFaces(body, f.faces) : f.faces;
  const picked = pickedFaces(body, idx, "plochy, které se mají zkosit");
  const pull = f.pull ? resolveDirection(rc(ctx), f.pull, { normal: [0, 0, 1] }) : null;
  let neutral: r.Plane;
  if (f.planeDef) {
    const p = resolvePlaneDef(rc(ctx), f.planeDef);
    const n = pull && V.dot(p.normal, pull) < 0 ? V.mul(p.normal, -1) : p.normal; // směr tahu jen otočí orientaci roviny
    neutral = new r.Plane(p.origin, V.perp(n), n);
  } else if (pull) {
    // neutrální rovina kolmá na směr tahu středem obalového kvádru tělesa
    neutral = new r.Plane(bboxCenter([body]), V.perp(pull), pull);
  } else neutral = axisPlane(f.plane, f.offset);
  return body.clone().draft(f.angle, (ff) => ff.when(({ element }) => picked.some((p) => p.isSame(element as r.Face))), neutral);
});
