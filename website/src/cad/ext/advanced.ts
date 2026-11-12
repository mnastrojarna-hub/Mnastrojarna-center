/**
 * Pokročilé modelování (ZW3D „Shape“/„Edit“): proměnné a plné zaoblení, zaoblení tečného řetězce, nestejné sražení,
 * zrcadlení prvků, pole podél křivky a výplňové pole, zkrut, kopule, text na válci, úkos s dělicí rovinou, lem/drážka,
 * měřítko v bodě, díry v bodech skici, booleovská operace s dřívějším nástrojem, kontrola a sjednocení geometrie.
 * Běží ve web workeru i v Node (testy). Vše se registruje přes `registerExt`.
 */
import { tr } from "../i18n";
import * as r from "replicad";
import { planeOf, sketchDrawing, sketchPathWire } from "../build";
import { findLoops, loopPolygon, nestLoops, pointInPolygon } from "../sketch";
import type { BoolMode, CadDoc, PlaneName, Vec2, Vec3 } from "../types";
import { registerExt, type ExtBuildCtx, type Shape, type SketchF } from "./registry";

type OC = any; // eslint-disable-line
const oc = (): OC => r.getOC() as OC;

type Data = Record<string, unknown>;
const num = (d: Data, k: string, def = 0) => (typeof d[k] === "number" && Number.isFinite(d[k] as number) ? (d[k] as number) : def);
const str = (d: Data, k: string, def = "") => (typeof d[k] === "string" ? (d[k] as string) : def);
const bool = (d: Data, k: string, def = false) => (typeof d[k] === "boolean" ? (d[k] as boolean) : def);
const ids = (d: Data, k: string): number[] => (Array.isArray(d[k]) ? (d[k] as unknown[]).filter((x): x is number => typeof x === "number") : []);
const vec3 = (d: Data, k: string, def: Vec3 = [0, 0, 0]): Vec3 => (Array.isArray(d[k]) && (d[k] as unknown[]).length === 3 ? ((d[k] as unknown[]).map((x) => Number(x) || 0) as Vec3) : def);
const modeOf = (d: Data, def: BoolMode = "add"): BoolMode => (["new", "add", "cut", "intersect"].includes(String(d.mode)) ? (d.mode as BoolMode) : def);

const V = (v: { x: number; y: number; z: number }): Vec3 => [v.x, v.y, v.z];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const near = (a: Vec3, b: Vec3, eps = 1e-5) => len(sub(a, b)) < eps;

const MODE_PARAM = { key: "mode", label: tr("Operace"), kind: "mode" } as const;
const PLANE_OPTS = [
  { v: "XY", l: "XY" },
  { v: "XZ", l: "XZ" },
  { v: "YZ", l: "YZ" },
];

function needBody(ctx: ExtBuildCtx, what = "Tento prvek"): Shape {
  if (!ctx.body) throw new Error(tr("{0} potřebuje těleso – nejdřív vytvořte vysunutí nebo primitivum.", what));
  return ctx.body;
}
function needSketch(ctx: ExtBuildCtx, id: string, role = "skicu"): SketchF {
  const sk = ctx.sketches.get(id);
  if (!sk) throw new Error(tr("Vyberte {0} v parametrech prvku.", role));
  return sk;
}
function needTool(ctx: ExtBuildCtx, id: string) {
  const t = ctx.tools.get(id);
  if (!t) throw new Error(tr("Vyberte dřívější prvek s tělesem (vysunutí, díra, primitivum…)."));
  return t;
}
function applyMode(body: Shape | null, tool: Shape, mode: BoolMode): Shape {
  if (!body) {
    if (mode === "cut" || mode === "intersect") throw new Error(tr("Není z čeho odebírat – nejdřív vytvořte těleso."));
    return tool;
  }
  if (mode === "cut") return body.cut(tool);
  if (mode === "intersect") return body.intersect(tool);
  return body.fuse(tool);
}
function axisPlane(name: PlaneName, offset: number, flip = false): r.Plane {
  const s = flip ? -1 : 1;
  if (name === "XY") return new r.Plane([0, 0, offset], [1, 0, 0], [0, 0, s]);
  if (name === "XZ") return new r.Plane([0, offset, 0], [1, 0, 0], [0, s, 0]);
  return new r.Plane([offset, 0, 0], [0, 1, 0], [s, 0, 0]);
}
function pickEdges(body: Shape, idx: number[]): r.Edge[] {
  const all = body.edges;
  const out = [...new Set(idx)].map((i) => all[i]).filter(Boolean);
  if (!out.length) throw new Error(tr("Vyberte hrany v modelu."));
  return out;
}
function pickFace(body: Shape, idx: number[]): r.Face {
  const f = body.faces[idx[0] ?? -1];
  if (!f) throw new Error(tr("Vyberte plochu v modelu."));
  return f;
}
function faceOfEdge(body: Shape, e: r.Edge): r.Face {
  const f = body.faces.find((ff) => ff.edges.some((x) => x.isSame(e)));
  if (!f) throw new Error(tr("K hraně se nepodařilo najít plochu."));
  return f;
}
function bboxDiag(s: Shape) {
  const [[x0, y0, z0], [x1, y1, z1]] = s.boundingBox.bounds;
  return Math.hypot(x1 - x0, y1 - y0, z1 - z0) || 100;
}
function wrapShape(ocShape: unknown, what: string): Shape {
  const s = r.cast(ocShape as never) as unknown as Shape;
  if (!s || (s as unknown as { isNull?: boolean }).isNull) throw new Error(tr("{0} se nepodařilo vytvořit.", what));
  return s;
}
function finish(mk: OC, what: string): Shape {
  mk.Build(new (oc().Message_ProgressRange)());
  if (!mk.IsDone()) throw new Error(tr("{0} se nepodařilo vytvořit – zkuste menší hodnoty nebo jiné hrany.", what));
  return wrapShape(mk.Shape(), what);
}

// ---------------- 1. proměnné zaoblení ----------------

registerExt({
  ext: "adv.varFillet",
  label: tr("Proměnné zaoblení"),
  icon: "adv-varfillet",
  tone: "feature",
  tab: "create",
  group: "Pokročilé úpravy",
  big: true,
  hint: tr("poloměr se po hraně mění od R1 k R2"),
  pick: { kind: "edges", key: "edges" },
  rollback: true,
  make: (_doc, extra) => ({ edges: extra?.edges ?? [], r1: 2, r2: 6 }),
  params: [
    { key: "edges", label: tr("Hrany"), kind: "edges" },
    { key: "r1", label: tr("Poloměr na začátku R1"), kind: "number", min: 0.01, step: 0.5 },
    { key: "r2", label: tr("Poloměr na konci R2"), kind: "number", min: 0.01, step: 0.5 },
  ],
  build: (d, ctx) => {
    const body = needBody(ctx, tr("Zaoblení"));
    const r1 = num(d, "r1");
    const r2 = num(d, "r2");
    if (!(r1 > 0 && r2 > 0)) throw new Error(tr("Oba poloměry musí být kladné."));
    const edges = pickEdges(body, ids(d, "edges"));
    const o = oc();
    const mk = new o.BRepFilletAPI_MakeFillet(body.wrapped, o.ChFi3d_FilletShape.ChFi3d_Rational);
    try {
      for (const e of edges) mk.Add(r1, r2, e.wrapped);
      return finish(mk, tr("Proměnné zaoblení"));
    } finally {
      mk.delete();
    }
  },
});

// ---------------- 2. plné zaoblení ----------------

registerExt({
  ext: "adv.fullRound",
  label: tr("Plné zaoblení"),
  icon: "adv-fullround",
  tone: "feature",
  tab: "create",
  group: "Pokročilé úpravy",
  hint: tr("zaoblí celou úzkou plochu (žebro, lem) do půlkruhu"),
  pick: { kind: "faces", key: "faces" },
  rollback: true,
  make: (_doc, extra) => ({ faces: extra?.faces ?? [], ratio: 0.98 }),
  params: [
    { key: "faces", label: tr("Střední plocha"), kind: "faces", hint: tr("úzká plocha mezi dvěma hranami") },
    { key: "ratio", label: tr("Podíl šířky"), kind: "number", unit: "", min: 0.5, max: 0.995, step: 0.01, hint: tr("0,98 = téměř plný půlkruh") },
  ],
  build: (d, ctx) => {
    const body = needBody(ctx, tr("Plné zaoblení"));
    const face = pickFace(body, ids(d, "faces"));
    const edges = [...face.edges].sort((a, b) => b.length - a.length);
    if (edges.length < 2) throw new Error(tr("Plocha musí mít alespoň dvě hrany."));
    const long = edges.slice(0, 2);
    const width = r.measureArea(face) / Math.max(1e-6, (long[0].length + long[1].length) / 2);
    const radius = (width / 2) * Math.min(0.995, Math.max(0.5, num(d, "ratio", 0.98)));
    if (!(radius > 1e-4)) throw new Error(tr("Plocha je příliš úzká."));
    return body.clone().fillet((e) => (long.some((x) => x.isSame(e)) ? radius : null) as never) as Shape;
  },
});

// ---------------- 3. zaoblení tečného řetězce ----------------

/** Rozšíří vybrané hrany o hrany navazující tečně (společný vrchol, odchylka tečen do `angleDeg`). */
export function tangentChain(body: Shape, seeds: r.Edge[], angleDeg = 2): r.Edge[] {
  const all = body.edges;
  const info = all.map((e) => ({ e, a: V(e.startPoint), b: V(e.endPoint), ta: norm(V(e.tangentAt(0))), tb: norm(V(e.tangentAt(1))) }));
  const cosLim = Math.cos((angleDeg * Math.PI) / 180);
  const chosen = new Set<number>();
  const queue = seeds.map((s) => info.findIndex((x) => x.e.isSame(s))).filter((i) => i >= 0);
  queue.forEach((i) => chosen.add(i));
  while (queue.length) {
    const i = queue.pop()!;
    const me = info[i];
    for (let j = 0; j < info.length; j++) {
      if (chosen.has(j)) continue;
      const o = info[j];
      // konce: (me.b ↔ o.a), (me.b ↔ o.b), (me.a ↔ o.a), (me.a ↔ o.b); tečny musí být souhlasné (±)
      const pairs: [Vec3, Vec3, Vec3, Vec3][] = [
        [me.b, o.a, me.tb, o.ta],
        [me.b, o.b, me.tb, o.tb],
        [me.a, o.a, me.ta, o.ta],
        [me.a, o.b, me.ta, o.tb],
      ];
      if (pairs.some(([p, q, t1, t2]) => near(p, q, 1e-4) && Math.abs(dot(t1, t2)) >= cosLim)) {
        chosen.add(j);
        queue.push(j);
      }
    }
  }
  return [...chosen].map((i) => info[i].e);
}

registerExt({
  ext: "adv.chainFillet",
  label: tr("Zaoblení řetězce"),
  icon: "adv-chain",
  tone: "feature",
  tab: "create",
  group: "Pokročilé úpravy",
  hint: tr("vyberte jednu hranu – zaoblí se celý tečně navazující řetězec"),
  pick: { kind: "edges", key: "edges" },
  rollback: true,
  make: (_doc, extra) => ({ edges: extra?.edges ?? [], radius: 2, angle: 2, chamfer: false }),
  params: [
    { key: "edges", label: tr("Výchozí hrany"), kind: "edges" },
    { key: "radius", label: tr("Poloměr / velikost"), kind: "number", min: 0.01, step: 0.5 },
    { key: "angle", label: tr("Tolerance tečnosti"), kind: "number", unit: "°", min: 0, max: 45, step: 0.5 },
    { key: "chamfer", label: tr("Srazit místo zaoblit"), kind: "bool" },
  ],
  build: (d, ctx) => {
    const body = needBody(ctx, tr("Zaoblení řetězce"));
    const radius = num(d, "radius");
    if (!(radius > 0)) throw new Error(tr("Poloměr musí být kladný."));
    const chain = tangentChain(body, pickEdges(body, ids(d, "edges")), num(d, "angle", 2));
    const cfg = (e: r.Edge) => (chain.some((x) => x.isSame(e)) ? radius : null);
    return (bool(d, "chamfer") ? body.clone().chamfer(cfg as never) : body.clone().fillet(cfg as never)) as Shape;
  },
});

// ---------------- 4. nestejné sražení ----------------

registerExt({
  ext: "adv.chamfer2",
  label: tr("Sražení D1×D2 / D×úhel"),
  icon: "adv-chamfer2",
  tone: "feature",
  tab: "create",
  group: "Pokročilé úpravy",
  big: true,
  hint: tr("nesymetrické sražení dvěma vzdálenostmi nebo vzdáleností a úhlem"),
  pick: { kind: "edges", key: "edges" },
  rollback: true,
  make: (_doc, extra) => ({ edges: extra?.edges ?? [], kind: "dd", d1: 2, d2: 1, angle: 30 }),
  params: [
    { key: "edges", label: tr("Hrany"), kind: "edges" },
    {
      key: "kind",
      label: tr("Zadání"),
      kind: "enum",
      options: [
        { v: "dd", l: tr("D1 × D2") },
        { v: "da", l: tr("D × úhel") },
      ],
    },
    { key: "d1", label: tr("Vzdálenost D1"), kind: "number", min: 0.01, step: 0.5 },
    { key: "d2", label: tr("Vzdálenost D2"), kind: "number", min: 0.01, step: 0.5, hint: tr("jen pro D1 × D2") },
    { key: "angle", label: tr("Úhel"), kind: "number", unit: "°", min: 1, max: 89, step: 1, hint: tr("jen pro D × úhel") },
  ],
  build: (d, ctx) => {
    const body = needBody(ctx, tr("Sražení"));
    const d1 = num(d, "d1");
    const d2 = num(d, "d2");
    const ang = num(d, "angle", 30);
    if (!(d1 > 0)) throw new Error(tr("Vzdálenost D1 musí být kladná."));
    const byAngle = str(d, "kind", "dd") === "da";
    if (!byAngle && !(d2 > 0)) throw new Error(tr("Vzdálenost D2 musí být kladná."));
    if (byAngle && !(ang > 0 && ang < 90)) throw new Error(tr("Úhel musí být mezi 0° a 90°."));
    const edges = pickEdges(body, ids(d, "edges"));
    const o = oc();
    const mk = new o.BRepFilletAPI_MakeChamfer(body.wrapped);
    try {
      for (const e of edges) {
        const f = faceOfEdge(body, e);
        if (byAngle) mk.AddDA(d1, (ang * Math.PI) / 180, e.wrapped, f.wrapped);
        else mk.Add(d1, d2, e.wrapped, f.wrapped);
      }
      return finish(mk, tr("Sražení"));
    } finally {
      mk.delete();
    }
  },
});

// ---------------- 5. zrcadlení prvků ----------------

registerExt({
  ext: "adv.mirrorFeatures",
  label: tr("Zrcadlit prvky"),
  icon: "adv-mirrorfeat",
  tone: "pattern",
  tab: "create",
  group: "Pole a kopie",
  big: true,
  hint: tr("zrcadlí vybrané dřívější prvky (ne celé těleso) podle roviny"),
  make: () => ({ features: [], all: false, plane: "YZ", offset: 0 }),
  params: [
    { key: "all", label: tr("Všechny dosavadní prvky"), kind: "bool" },
    { key: "plane", label: tr("Rovina zrcadlení"), kind: "enum", options: PLANE_OPTS },
    { key: "offset", label: tr("Odsazení roviny"), kind: "number", step: 1 },
  ],
  build: (d, ctx) => {
    const body = needBody(ctx, tr("Zrcadlení prvků"));
    const plane = (["XY", "XZ", "YZ"].includes(str(d, "plane")) ? str(d, "plane") : "YZ") as PlaneName;
    const off = num(d, "offset");
    const origin: Vec3 = plane === "YZ" ? [off, 0, 0] : plane === "XZ" ? [0, off, 0] : [0, 0, off];
    const list = bool(d, "all") ? [...ctx.tools.keys()] : (Array.isArray(d.features) ? (d.features as string[]) : []).concat(typeof d.feature === "string" && d.feature ? [d.feature] : []);
    if (!list.length) throw new Error(tr("Vyberte prvky, které se mají zrcadlit (nebo zaškrtněte Všechny)."));
    let acc = body;
    for (const id of list) {
      const t = needTool(ctx, id);
      const m = t.tool.clone().mirror(plane, origin) as Shape;
      acc = applyMode(acc, m, t.mode === "new" ? "add" : t.mode);
    }
    return acc;
  },
});

// ---------------- 6. pole podél křivky ----------------

registerExt({
  ext: "adv.curvePattern",
  label: tr("Pole podél křivky"),
  icon: "adv-curvepattern",
  tone: "pattern",
  tab: "create",
  group: "Pole a kopie",
  big: true,
  hint: tr("kopie prvku rozmístěné po dráze ze skici"),
  make: () => ({ feature: "", path: "", count: 5, spacing: 0, follow: true }),
  params: [
    { key: "feature", label: tr("Opakovaný prvek"), kind: "feature" },
    { key: "path", label: tr("Dráha (skica)"), kind: "sketch" },
    { key: "count", label: tr("Počet kopií"), kind: "number", unit: "", min: 1, max: 500, step: 1 },
    { key: "spacing", label: tr("Rozteč po křivce"), kind: "number", min: 0, step: 1, hint: tr("0 = rozdělit rovnoměrně") },
    { key: "follow", label: tr("Natáčet podle tečny"), kind: "bool" },
  ],
  build: (d, ctx) => {
    const body = needBody(ctx, tr("Pole podél křivky"));
    const t = needTool(ctx, str(d, "feature"));
    const sk = needSketch(ctx, str(d, "path"), tr("skicu dráhy"));
    const wire = sketchPathWire(sk);
    const L = wire.length;
    const count = Math.max(1, Math.round(num(d, "count", 5)));
    const spacing = num(d, "spacing");
    const plane = planeOf(sk.plane);
    const n = V(plane.zDir);
    const p0 = V(wire.pointAt(0));
    const t0 = norm(V(wire.tangentAt(0)));
    const c0 = t.tool.boundingBox.center as Vec3;
    let acc = body;
    for (let i = 1; i < count; i++) {
      const s = spacing > 0 ? (spacing * i) / L : i / Math.max(1, count - (wire.isClosed ? 0 : 1));
      if (s > 1 + 1e-9) throw new Error(tr("Rozteč × počet přesahuje délku dráhy ({0} mm).", Math.round(L)));
      const p = V(wire.pointAt(Math.min(1, s)));
      let copy = t.tool.clone();
      if (bool(d, "follow", true)) {
        const ti = norm(V(wire.tangentAt(Math.min(1, s))));
        const ang = (Math.atan2(dot(cross(t0, ti), n), dot(t0, ti)) * 180) / Math.PI;
        if (Math.abs(ang) > 1e-6) copy = copy.rotate(ang, c0, n);
      }
      copy = copy.translate(sub(p, p0));
      acc = applyMode(acc, copy as Shape, t.mode === "new" ? "add" : t.mode);
    }
    return acc;
  },
});

// ---------------- 7. pole vyplňující oblast ----------------

registerExt({
  ext: "adv.fillPattern",
  label: tr("Výplňové pole"),
  icon: "adv-fillpattern",
  tone: "pattern",
  tab: "create",
  group: "Pole a kopie",
  hint: tr("kopie prvku v mřížce uvnitř uzavřené skici"),
  make: () => ({ feature: "", region: "", dx: 20, dy: 20, margin: 5, stagger: false }),
  params: [
    { key: "feature", label: tr("Opakovaný prvek"), kind: "feature" },
    { key: "region", label: tr("Oblast (uzavřená skica)"), kind: "sketch" },
    { key: "dx", label: tr("Rozteč X"), kind: "number", min: 0.1, step: 1 },
    { key: "dy", label: tr("Rozteč Y"), kind: "number", min: 0.1, step: 1 },
    { key: "margin", label: tr("Odstup od okraje"), kind: "number", min: 0, step: 1 },
    { key: "stagger", label: tr("Střídavě (šachovnice)"), kind: "bool" },
  ],
  build: (d, ctx) => {
    const body = needBody(ctx, tr("Výplňové pole"));
    const t = needTool(ctx, str(d, "feature"));
    const sk = needSketch(ctx, str(d, "region"), tr("skicu oblasti"));
    const dx = num(d, "dx", 20);
    const dy = num(d, "dy", 20);
    if (!(dx > 0 && dy > 0)) throw new Error(tr("Rozteče musí být kladné."));
    const margin = Math.max(0, num(d, "margin", 0));
    const { loops } = findLoops(sk.entities);
    if (!loops.length) throw new Error(tr("Skica oblasti musí obsahovat uzavřený profil."));
    const nested = nestLoops(loops);
    const outers = nested.filter((x) => x.depth % 2 === 0).map((x) => loopPolygon(x.loop));
    const holes = nested.filter((x) => x.depth % 2 === 1).map((x) => loopPolygon(x.loop));
    const plane = planeOf(sk.plane);
    const c0 = t.tool.boundingBox.center as Vec3;
    const loc = plane.toLocalCoords(new r.Vector(c0));
    const seed: Vec2 = [loc.x, loc.y];
    const distToPoly = (p: Vec2, poly: Vec2[]) => {
      let best = Infinity;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const abx = b[0] - a[0];
        const aby = b[1] - a[1];
        const l2 = abx * abx + aby * aby || 1e-12;
        const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / l2));
        best = Math.min(best, Math.hypot(p[0] - (a[0] + u * abx), p[1] - (a[1] + u * aby)));
      }
      return best;
    };
    const inside = (p: Vec2) => outers.some((o) => pointInPolygon(p, o) && distToPoly(p, o) >= margin) && !holes.some((h) => pointInPolygon(p, h) || distToPoly(p, h) < margin);
    const xs = outers.flatMap((o) => o.map((p) => p[0]));
    const ys = outers.flatMap((o) => o.map((p) => p[1]));
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const pts: Vec2[] = [];
    const jMin = Math.floor((y0 - seed[1]) / dy) - 1;
    const jMax = Math.ceil((y1 - seed[1]) / dy) + 1;
    const iMin = Math.floor((x0 - seed[0]) / dx) - 2;
    const iMax = Math.ceil((x1 - seed[0]) / dx) + 2;
    for (let j = jMin; j <= jMax; j++)
      for (let i = iMin; i <= iMax; i++) {
        const p: Vec2 = [seed[0] + i * dx + (bool(d, "stagger") && j % 2 ? dx / 2 : 0), seed[1] + j * dy];
        if (inside(p)) pts.push(p);
      }
    if (!pts.length) throw new Error(tr("Do oblasti se nevejde žádná kopie – zmenšete rozteče nebo odstup."));
    if (pts.length > 400) throw new Error(tr("Pole by mělo {0} kopií – zvětšete rozteče (max. 400).", pts.length));
    let acc = body;
    const nrm = V(plane.zDir);
    for (const p of pts) {
      const w = V(plane.toWorldCoords(p));
      // posun v rovině skici (kolmá složka původního umístění zůstává)
      const delta = sub(w, V(plane.toWorldCoords(seed)));
      const d3 = sub(delta, mul(nrm, dot(delta, nrm)));
      if (len(d3) < 1e-9) continue; // původní prvek už v tělese je
      acc = applyMode(acc, t.tool.clone().translate(d3) as Shape, t.mode === "new" ? "add" : t.mode);
    }
    return acc;
  },
});

// ---------------- 8. zkrut (šroubovité vysunutí) ----------------

registerExt({
  ext: "adv.twist",
  label: tr("Zkrut"),
  icon: "adv-twist",
  tone: "create",
  tab: "create",
  group: "Pokročilé tvary",
  big: true,
  hint: tr("vysunutí profilu s otáčením kolem osy (šroubovitá drážka, vrták…)"),
  make: (doc) => ({ sketch: [...doc.features].reverse().find((f) => f.type === "sketch")?.id ?? "", height: 40, angle: 90, mode: "add" }),
  params: [
    { key: "sketch", label: tr("Profil (skica)"), kind: "sketch" },
    { key: "height", label: tr("Výška"), kind: "number", min: 0.01, step: 1 },
    { key: "angle", label: tr("Úhel zkrutu"), kind: "number", unit: "°", step: 5, hint: tr("záporný = opačný smysl") },
    MODE_PARAM,
  ],
  build: (d, ctx) => {
    const sk = needSketch(ctx, str(d, "sketch"), tr("skicu profilu"));
    const h = num(d, "height");
    const ang = num(d, "angle");
    if (!(h > 0)) throw new Error(tr("Výška musí být kladná."));
    const dr = sketchDrawing(sk);
    if (!dr) throw new Error(tr("Skica neobsahuje uzavřený profil."));
    const s = dr.sketchOnPlane(planeOf(sk.plane)).extrude(h, { twistAngle: ang }) as Shape;
    return applyMode(ctx.body, s, modeOf(d, ctx.body ? "add" : "new"));
  },
});

// ---------------- 9. kopule ----------------

registerExt({
  ext: "adv.dome",
  label: tr("Kopule"),
  icon: "adv-dome",
  tone: "create",
  tab: "create",
  group: "Pokročilé tvary",
  hint: tr("eliptická kopule (nebo důlek) na rovinné ploše"),
  pick: { kind: "faces", key: "faces" },
  rollback: true,
  make: (_doc, extra) => ({ faces: extra?.faces ?? [], height: 10, radius: 0, mode: "add" }),
  params: [
    { key: "faces", label: tr("Rovinná plocha"), kind: "faces" },
    { key: "height", label: tr("Výška kopule"), kind: "number", min: 0.01, step: 1 },
    { key: "radius", label: tr("Poloměr základny"), kind: "number", min: 0, step: 1, hint: tr("0 = vepsaný do plochy") },
    MODE_PARAM,
  ],
  build: (d, ctx) => {
    const body = needBody(ctx, "Kopule");
    const face = pickFace(body, ids(d, "faces"));
    if (face.geomType !== "PLANE") throw new Error(tr("Kopuli lze vytvořit jen na rovinné ploše."));
    const h = num(d, "height");
    if (!(h > 0)) throw new Error(tr("Výška musí být kladná."));
    const c = V(face.center);
    const n = norm(V(face.normalAt(face.center)));
    let R = num(d, "radius");
    if (!(R > 0)) {
      // vepsaný poloměr: nejmenší vzdálenost středu k hranám plochy
      R = Math.min(...face.edges.map((e) => Math.min(len(sub(c, V(e.startPoint))), len(sub(c, V(e.endPoint))), len(sub(c, V(e.pointAt(0.5)))))));
      if (!(R > 0.01)) throw new Error(tr("Nepodařilo se určit poloměr – zadejte ho ručně."));
    }
    const mode = modeOf(d, "add");
    const dir = mode === "cut" ? mul(n, -1) : n;
    const wires: r.Wire[] = [];
    const N = 10;
    for (let k = 0; k < N; k++) {
      const z = (h * k) / N;
      const rk = R * Math.sqrt(Math.max(0, 1 - (z / h) ** 2));
      wires.push(r.assembleWire([r.makeCircle(Math.max(rk, 1e-3), add(c, dir, z), dir)]));
    }
    const apex = add(c, dir, h);
    const cap = r.loft(wires, { endPoint: apex }) as Shape;
    return mode === "cut" ? body.cut(cap) : body.fuse(cap);
  },
});

// ---------------- 10. text na válci ----------------

const ADV_FONT = "MnRobotoAdv";
let advFont: Promise<void> | null = null;
/** Zaregistruje písmo pro text na válci (testy: data z public/fonts/Roboto-Bold.ttf). */
export async function registerAdvFont(data: ArrayBuffer | string) {
  await r.loadFont(data, ADV_FONT, true);
  advFont = Promise.resolve();
}
function ensureAdvFont(): Promise<void> {
  if (!advFont) {
    advFont = (async () => {
      if (typeof fetch !== "function" || typeof location === "undefined") throw new Error(tr("Písmo pro text není načteno."));
      const res = await fetch(new URL("/fonts/Roboto-Bold.ttf", location.origin).toString());
      if (!res.ok) throw new Error(tr("Písmo pro text se nepodařilo stáhnout."));
      await r.loadFont(await res.arrayBuffer(), ADV_FONT, true);
    })();
    advFont.catch(() => (advFont = null));
  }
  return advFont;
}

/** Osa a poloměr válcové plochy (BRepAdaptor_Surface → gp_Cylinder). */
export function cylinderOf(face: r.Face): { loc: Vec3; dir: Vec3; R: number } {
  if (face.geomType !== "CYLINDRE") throw new Error(tr("Vyberte válcovou plochu."));
  const o = oc();
  const ad = new o.BRepAdaptor_Surface(face.wrapped, false);
  try {
    const cyl = ad.Cylinder();
    const ax = cyl.Axis();
    const l = ax.Location();
    const dd = ax.Direction();
    return { loc: [l.X(), l.Y(), l.Z()], dir: norm([dd.X(), dd.Y(), dd.Z()]), R: cyl.Radius() };
  } finally {
    ad.delete();
  }
}

registerExt({
  ext: "adv.textOnCyl",
  label: tr("Text na válci"),
  icon: "adv-textcyl",
  tone: "create",
  tab: "create",
  group: "Pokročilé tvary",
  hint: tr("vystouplý nebo gravírovaný nápis na válcové ploše (radiální promítnutí)"),
  pick: { kind: "faces", key: "faces" },
  rollback: true,
  make: (_doc, extra) => ({ faces: extra?.faces ?? [], text: "MNÁSTROJÁRNA", size: 6, depth: 0.6, along: "around", angle: 0, shift: 0, mode: "cut" }),
  params: [
    { key: "faces", label: tr("Válcová plocha"), kind: "faces" },
    { key: "text", label: tr("Text"), kind: "text" },
    { key: "size", label: tr("Výška písma"), kind: "number", min: 0.5, step: 0.5 },
    { key: "depth", label: tr("Hloubka / výška reliéfu"), kind: "number", min: 0.05, step: 0.1 },
    {
      key: "along",
      label: tr("Směr textu"),
      kind: "enum",
      options: [
        { v: "around", l: tr("Po obvodu") },
        { v: "axis", l: tr("Podél osy") },
      ],
    },
    { key: "angle", label: tr("Natočení kolem osy"), kind: "number", unit: "°", step: 5 },
    { key: "shift", label: tr("Posun podél osy"), kind: "number", step: 1 },
    {
      key: "mode",
      label: tr("Operace"),
      kind: "enum",
      options: [
        { v: "cut", l: tr("Gravírovat") },
        { v: "add", l: tr("Vystouplý") },
      ],
    },
  ],
  build: async (d, ctx) => {
    const body = needBody(ctx, tr("Text na válci"));
    const face = pickFace(body, ids(d, "faces"));
    const text = str(d, "text").trim();
    if (!text) throw new Error(tr("Zadejte text."));
    const size = num(d, "size", 6);
    const depth = num(d, "depth", 0.6);
    if (!(size > 0 && depth > 0)) throw new Error(tr("Výška písma a hloubka musí být kladné."));
    const { loc, dir, R } = cylinderOf(face);
    const cut = str(d, "mode", "cut") !== "add";
    // radiální směr k středu vybrané plochy, natočený o úhel
    const c = V(face.center);
    const rel = sub(c, loc);
    let radial = norm(sub(rel, mul(dir, dot(rel, dir))));
    const ang = num(d, "angle");
    if (ang) {
      const rv = new r.Vector(radial).rotate(ang, [0, 0, 0], dir);
      radial = norm(V(rv));
    }
    const axial = dot(rel, dir) + num(d, "shift");
    const base = add(loc, dir, axial);
    const tangential = norm(cross(dir, radial));
    await ensureAdvFont();
    let dr = r.drawText(text, { fontSize: size, fontFamily: ADV_FONT });
    const bc = dr.boundingBox.center;
    dr = dr.translate(-bc[0], -bc[1]);
    const xDir = str(d, "along", "around") === "axis" ? dir : tangential;
    // rovina tečná k válci (normála = radiála ven); gravírování: z R+1 dovnitř, reliéf: z R-1 ven
    const start = cut ? R + 1 : R - 1;
    const plane = new r.Plane(add(base, radial, start), xDir, radial);
    const ext = dr.sketchOnPlane(plane).extrude(cut ? -(depth + 1) : depth + 1) as Shape;
    const bigLen = bboxDiag(body) * 2;
    const cylOf = (rad: number) => r.makeCylinder(rad, bigLen, add(loc, dir, axial - bigLen / 2), dir) as Shape;
    if (cut) {
      const tool = ext.cut(cylOf(Math.max(1e-3, R - depth)));
      return body.cut(tool);
    }
    const tool = ext.intersect(cylOf(R + depth));
    return body.fuse(tool);
  },
});

// ---------------- 11. úkos s dělicí rovinou ----------------

registerExt({
  ext: "adv.partingDraft",
  label: tr("Úkos od dělicí roviny"),
  icon: "adv-partdraft",
  tone: "feature",
  tab: "create",
  group: "Pokročilé úpravy",
  hint: tr("stěny nad i pod dělicí rovinou se ukosí směrem od ní (tvárník/tvárnice)"),
  make: () => ({ angle: 2, plane: "XY", offset: 0, flip: false }),
  params: [
    { key: "angle", label: tr("Úhel úkosu"), kind: "number", unit: "°", min: 0.1, max: 45, step: 0.5 },
    { key: "plane", label: tr("Dělicí rovina"), kind: "enum", options: PLANE_OPTS },
    { key: "offset", label: tr("Odsazení roviny"), kind: "number", step: 1 },
    { key: "flip", label: tr("Obrátit smysl úkosu"), kind: "bool" },
  ],
  build: (d, ctx) => {
    const body = needBody(ctx, tr("Úkos"));
    const angle = num(d, "angle", 2);
    if (!(angle > 0 && angle < 90)) throw new Error(tr("Úhel musí být mezi 0° a 90°."));
    const plane = (["XY", "XZ", "YZ"].includes(str(d, "plane")) ? str(d, "plane") : "XY") as PlaneName;
    const off = num(d, "offset");
    const flip = bool(d, "flip");
    const pl = axisPlane(plane, off);
    const n = V(pl.zDir);
    const res = body.clone().split(pl);
    const halves = [res.positive, res.negative] as (Shape | null | undefined)[];
    const solids = halves.filter((h): h is Shape => !!h && !(h as unknown as { isNull?: boolean }).isNull);
    if (!solids.length) throw new Error(tr("Dělicí rovina těleso neprotíná."));
    const drafted = solids.map((half) => {
      const cz = half.boundingBox.center as Vec3;
      const above = dot(sub(cz, V(pl.origin)), n) >= 0;
      const pull = axisPlane(plane, off, above === flip);
      const sides = half.faces.filter((f) => Math.abs(dot(norm(V(f.normalAt(f.center))), n)) < 0.3);
      if (!sides.length) return half;
      try {
        return half.draft(angle, (ff) => ff.when(({ element }) => sides.some((s) => s.isSame(element as r.Face))), pull) as Shape;
      } catch {
        throw new Error(tr("Úkos se nepodařilo vytvořit – zkuste menší úhel nebo jinou dělicí rovinu."));
      }
    });
    let acc = drafted[0];
    for (const s of drafted.slice(1)) acc = acc.fuse(s);
    return acc;
  },
});

// ---------------- 12. lem a drážka ----------------

registerExt({
  ext: "adv.lipGroove",
  label: tr("Lem / drážka"),
  icon: "adv-lip",
  tone: "feature",
  tab: "create",
  group: "Pokročilé tvary",
  hint: tr("vystouplý lem nebo drážka podél obrysu rovinné plochy (dosedání tvárníku a tvárnice)"),
  pick: { kind: "faces", key: "faces" },
  rollback: true,
  make: (_doc, extra) => ({ faces: extra?.faces ?? [], kind: "lip", width: 3, depth: 2, inset: 0 }),
  params: [
    { key: "faces", label: tr("Rovinná plocha"), kind: "faces" },
    {
      key: "kind",
      label: tr("Druh"),
      kind: "enum",
      options: [
        { v: "lip", l: tr("Lem (přidat)") },
        { v: "groove", l: tr("Drážka (odebrat)") },
      ],
    },
    { key: "width", label: tr("Šířka"), kind: "number", min: 0.1, step: 0.5 },
    { key: "depth", label: tr("Výška / hloubka"), kind: "number", min: 0.1, step: 0.5 },
    { key: "inset", label: tr("Odstup od okraje"), kind: "number", min: 0, step: 0.5 },
  ],
  build: (d, ctx) => {
    const body = needBody(ctx, tr("Lem / drážka"));
    const face = pickFace(body, ids(d, "faces"));
    if (face.geomType !== "PLANE") throw new Error(tr("Lem a drážku lze vytvořit jen na rovinné ploše."));
    const width = num(d, "width", 3);
    const depth = num(d, "depth", 2);
    const inset = Math.max(0, num(d, "inset"));
    if (!(width > 0 && depth > 0)) throw new Error(tr("Šířka a výška musí být kladné."));
    const n = norm(V(face.normalAt(face.center)));
    const c = V(face.center);
    const xd = norm(Math.abs(n[0]) < 0.9 ? cross(n, [1, 0, 0]) : cross(n, [0, 1, 0]));
    const plane = new r.Plane(c, xd, n);
    // obrys plochy jako 2D polygon v rovině plochy (hrany seřazené do smyčky, křivky vzorkované)
    const edges = face.outerWire().edges;
    type E2 = { a: Vec3; b: Vec3; pts: Vec3[] };
    const segs: E2[] = edges.map((e) => {
      const nS = e.geomType === "LINE" ? 1 : 16;
      const pts: Vec3[] = [];
      for (let k = 0; k < nS; k++) pts.push(V(e.pointAt(k / nS)));
      return { a: V(e.startPoint), b: V(e.endPoint), pts };
    });
    const ordered: Vec3[] = [];
    const used = new Array(segs.length).fill(false);
    let cur = segs[0];
    used[0] = true;
    ordered.push(...cur.pts);
    let end = cur.b;
    for (let step = 1; step < segs.length; step++) {
      let j = segs.findIndex((sg, i) => !used[i] && near(sg.a, end, 1e-4));
      let rev = false;
      if (j < 0) {
        j = segs.findIndex((sg, i) => !used[i] && near(sg.b, end, 1e-4));
        rev = true;
      }
      if (j < 0) throw new Error(tr("Obrys plochy není uzavřený."));
      used[j] = true;
      cur = segs[j];
      const pts = rev ? [cur.b, ...[...cur.pts.slice(1)].reverse()] : cur.pts;
      ordered.push(...pts);
      end = rev ? cur.a : cur.b;
    }
    const loc = ordered.map((p) => {
      const l = plane.toLocalCoords(new r.Vector(p));
      return [l.x, l.y] as Vec2;
    });
    let pen = r.draw(loc[0]);
    for (const p of loc.slice(1)) pen = pen.lineTo(p);
    const outline = pen.close();
    const outerD = inset > 0 ? outline.offset(-inset) : outline;
    const innerD = outline.offset(-(inset + width));
    if (!innerD || innerD.boundingBox.width < 1e-6) throw new Error(tr("Šířka lemu/drážky je větší než plocha – zmenšete ji."));
    const ring = outerD.cut(innerD);
    const groove = str(d, "kind", "lip") === "groove";
    const tool = ring.sketchOnPlane(plane).extrude(groove ? -depth : depth) as Shape;
    return groove ? body.cut(tool) : body.fuse(tool);
  },
});

// ---------------- 13. měřítko v bodě ----------------

registerExt({
  ext: "adv.scaleAbout",
  label: tr("Měřítko v bodě"),
  icon: "adv-scale",
  tone: "pattern",
  tab: "create",
  group: "Pole a kopie",
  hint: tr("zvětší/zmenší těleso kolem zadaného bodu (např. smrštění kolem středu dutiny)"),
  make: () => ({ factor: 1.02, useCenter: true, center: [0, 0, 0] }),
  params: [
    { key: "factor", label: tr("Měřítko"), kind: "number", unit: "×", min: 0.001, step: 0.01 },
    { key: "useCenter", label: tr("Kolem těžiště obálky"), kind: "bool" },
    { key: "center", label: tr("Bod měřítka"), kind: "vec3", hint: tr("použije se, není-li zaškrtnuto Kolem těžiště") },
  ],
  build: (d, ctx) => {
    const body = needBody(ctx, tr("Měřítko"));
    const k = num(d, "factor", 1);
    if (!(k > 0)) throw new Error(tr("Měřítko musí být kladné."));
    const c = bool(d, "useCenter", true) ? (body.boundingBox.center as Vec3) : vec3(d, "center");
    return body.clone().scale(k, c) as Shape;
  },
});

// ---------------- 14. díry v bodech skici ----------------

registerExt({
  ext: "adv.holesAtPoints",
  label: tr("Díry v bodech"),
  icon: "adv-holes",
  tone: "cut",
  tab: "create",
  group: "Pokročilé tvary",
  big: true,
  hint: tr("stejná díra v každém bodě (nebo středu kružnice) vybrané skici"),
  make: (doc) => ({ sketch: [...doc.features].reverse().find((f) => f.type === "sketch")?.id ?? "", diameter: 6.6, depth: 0, cbDiameter: 11, cbDepth: 0, flip: false }),
  params: [
    { key: "sketch", label: tr("Skica s body"), kind: "sketch", hint: tr("body, středy kružnic") },
    { key: "diameter", label: tr("Průměr"), kind: "number", min: 0.1, step: 0.5 },
    { key: "depth", label: tr("Hloubka"), kind: "number", min: 0, step: 1, hint: tr("0 = skrz") },
    { key: "cbDiameter", label: tr("Ø zahloubení"), kind: "number", min: 0, step: 0.5, hint: tr("0 = bez") },
    { key: "cbDepth", label: tr("Hloubka zahloubení"), kind: "number", min: 0, step: 0.5 },
    { key: "flip", label: tr("Vrtat v kladném směru normály"), kind: "bool" },
  ],
  build: (d, ctx) => {
    const body = needBody(ctx, tr("Díry v bodech"));
    const sk = needSketch(ctx, str(d, "sketch"), tr("skicu s body"));
    const dia = num(d, "diameter", 6.6);
    if (!(dia > 0)) throw new Error(tr("Průměr musí být kladný."));
    const pts: Vec2[] = [];
    for (const e of sk.entities) {
      if (e.type === "point") pts.push(e.p);
      else if (e.type === "circle") pts.push([e.cx, e.cy]);
    }
    if (!pts.length) throw new Error(tr("Skica neobsahuje body ani kružnice."));
    const plane = planeOf(sk.plane);
    const n = norm(V(plane.zDir));
    const dir = bool(d, "flip") ? n : mul(n, -1);
    const diag = bboxDiag(body);
    const depth = num(d, "depth");
    const L = depth > 0 ? depth : diag * 2;
    const cbD = num(d, "cbDiameter");
    const cbH = num(d, "cbDepth");
    let tool: Shape | null = null;
    for (const p of pts) {
      const w = V(plane.toWorldCoords(p));
      const startBack = add(w, dir, -diag); // začít daleko před plochou
      let t = r.makeCylinder(dia / 2, (depth > 0 ? L : 2 * diag) + diag, startBack, dir) as Shape;
      if (cbD > dia && cbH > 0) t = t.fuse(r.makeCylinder(cbD / 2, diag + cbH, startBack, dir) as Shape);
      tool = tool ? tool.fuse(t) : t;
    }
    ctx.tools.set(ctx.featureId, { tool: tool!.clone(), mode: "cut" });
    return body.cut(tool!);
  },
});

// ---------------- 15. boolean s dřívějším nástrojem ----------------

registerExt({
  ext: "adv.combineTool",
  label: tr("Znovu použít nástroj"),
  icon: "adv-combine",
  tone: "feature",
  tab: "create",
  group: "Pole a kopie",
  hint: tr("použije těleso dřívějšího prvku znovu jinou operací (přidat → odebrat, průnik…)"),
  make: () => ({ feature: "", mode: "cut", offset: [0, 0, 0] }),
  params: [
    { key: "feature", label: tr("Prvek (nástroj)"), kind: "feature" },
    MODE_PARAM,
    { key: "offset", label: tr("Posun kopie"), kind: "vec3" },
  ],
  build: (d, ctx) => {
    const body = needBody(ctx, tr("Operace s nástrojem"));
    const t = needTool(ctx, str(d, "feature"));
    const off = vec3(d, "offset");
    const tool = (len(off) > 1e-9 ? t.tool.clone().translate(off) : t.tool.clone()) as Shape;
    return applyMode(body, tool, modeOf(d, "cut"));
  },
});

// ---------------- 16./17. kontrola a sjednocení geometrie ----------------

/** Zkontroluje platnost tělesa (BRepCheck_Analyzer). Vrací seznam nálezů (prázdný = v pořádku). */
export function checkShape(body: Shape): string[] {
  const o = oc();
  const an = new o.BRepCheck_Analyzer(body.wrapped, true);
  try {
    if (an.IsValid()) return [];
    const bad: string[] = [];
    body.faces.forEach((f, i) => {
      if (!an.IsValid(f.wrapped)) bad.push(`plocha ${i + 1}`);
    });
    body.edges.forEach((e, i) => {
      if (!an.IsValid(e.wrapped)) bad.push(`hrana ${i + 1}`);
    });
    return bad.length ? bad : [tr("těleso jako celek")];
  } finally {
    an.delete();
  }
}

registerExt({
  ext: "adv.check",
  label: tr("Kontrola geometrie"),
  icon: "adv-check",
  tone: "tool",
  tab: "tools",
  group: "Geometrie",
  big: true,
  hint: tr("ověří platnost tělesa (OpenCascade BRepCheck); chyby se zobrazí u prvku"),
  make: () => ({ strict: true }),
  params: [{ key: "strict", label: tr("Kontrolovat i geometrii ploch"), kind: "bool" }],
  build: (_d, ctx) => {
    const body = needBody(ctx, tr("Kontrola geometrie"));
    const bad = checkShape(body);
    if (bad.length) throw new Error(tr("Těleso není platné: {0}{1}. Zkuste „Sjednotit plochy“ nebo upravte předchozí prvky.", bad.slice(0, 6).join(", "), bad.length > 6 ? "…" : ""));
    if (!(r.measureVolume(body) > 0)) throw new Error(tr("Těleso má nulový objem."));
    return body; // beze změny (null by těleso odstranilo)
  },
});

registerExt({
  ext: "adv.simplify",
  label: tr("Sjednotit plochy"),
  icon: "adv-simplify",
  tone: "tool",
  tab: "tools",
  group: "Geometrie",
  hint: tr("sloučí sousední souplošné plochy a hrany (po importu STEP, po booleovských operacích)"),
  make: () => ({}),
  build: (_d, ctx) => {
    const body = needBody(ctx, tr("Sjednocení ploch"));
    const before = body.faces.length;
    const out = body.clone().simplify() as Shape;
    if (!(r.measureVolume(out) > 0)) throw new Error(tr("Sjednocení ploch selhalo – těleso zůstává beze změny."));
    void before;
    return out;
  },
});

/** Pro UI: akce analýzy tloušťky stěn (počítá se v UI nad sítí) je registrována jako tlačítko bez prvku. */
registerExt({
  ext: "adv.wallThickness",
  label: tr("Tloušťka stěn"),
  icon: "adv-wall",
  tone: "tool",
  tab: "tools",
  group: "Geometrie",
  hint: tr("najde nejtenčí stěnu tělesa (vzorkování sítě)"),
  action: true,
  scope: "part",
  make: () => ({}),
});

export const ADV_EXT_IDS = ["adv.varFillet", "adv.fullRound", "adv.chainFillet", "adv.chamfer2", "adv.mirrorFeatures", "adv.curvePattern", "adv.fillPattern", "adv.twist", "adv.dome", "adv.textOnCyl", "adv.partingDraft", "adv.lipGroove", "adv.scaleAbout", "adv.holesAtPoints", "adv.combineTool", "adv.check", "adv.simplify", "adv.wallThickness"];

export const _advInternals = { applyMode, axisPlane };
export type { CadDoc };
