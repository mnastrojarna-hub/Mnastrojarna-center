/**
 * Plošné modelování (karta „Plochy“) – jako Surfaces v ZW3D / SolidWorks:
 * plošné vysunutí, rotace, rovinná plocha, tažení, šablonování, odsazení, prodloužení, oříznutí rovinou/skicou,
 * sešití, uzavření do tělesa, zesílení, rozdělení tělesa rovinou, nahrazení (posun) plochy, záplata z hran,
 * křivka průniku, promítnutí skici na plochu, šroubovice a tažení po šroubovici (závity, pružiny).
 *
 * Konvence modulu: plochy (Face/Shell) se do dokumentu ukládají vedle případného tělesa jako složené těleso
 * `makeCompound([těleso, plocha…])`. Operace „Sešít / Uzavřít / Zesílit“ pracují s volnými plochami (ty, které
 * nejsou součástí žádného solidu). Běží ve workeru i v Node (testy) – žádné DOM API.
 */
import { extAxis, extDirection, extPlane, extPoint, hasPlaneDef, toAxisDef } from "./place";
import { subShapes } from "../fastbox";
import { tr } from "../i18n";
import * as r from "replicad";
import { planeOf, sketchDrawing, sketchPathWire } from "../build";
import { pushPull } from "../direct";
import { noteFeatureWarning } from "../feature-notes";
import type { BoolMode, CadDoc, PlaneName, Vec3 } from "../types";
import { registerExt, setExtTool, type ExtBuildCtx, type Shape, type SketchF } from "./registry";

type OC = any;
const oc = (): OC => r.getOC() as OC;
const DEG = Math.PI / 180;

// ---------------- pomocné ----------------

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown, d: string): string => (typeof v === "string" && v ? v : d);
const ids = (v: unknown): number[] => (Array.isArray(v) ? (v.filter((x) => typeof x === "number") as number[]) : []);
const sids = (v: unknown): string[] => (Array.isArray(v) ? (v.filter((x) => typeof x === "string") as string[]) : []);
const vec3 = (v: unknown, d: Vec3 = [0, 0, 0]): Vec3 => (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number") ? (v as Vec3) : d);
const vec = (v: { x: number; y: number; z: number }): Vec3 => [v.x, v.y, v.z];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const scaleV = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const addV = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

const lastSketch = (doc: CadDoc, skip = 0) => {
  const sk = doc.features.filter((f) => f.type === "sketch");
  return sk[sk.length - 1 - skip]?.id ?? "";
};

function needSketch(ctx: ExtBuildCtx, id: unknown, role: string): SketchF {
  const sk = typeof id === "string" ? ctx.sketches.get(id) : undefined;
  if (!sk) throw new Error(tr("Vyberte {0} (skica musí být v historii před tímto prvkem).", role));
  if (!sk.entities.some((e) => !e.construction)) throw new Error(tr("Skica „{0}“ je prázdná.", sk.name));
  return sk;
}

/** Křivky skici jako dráty: jedna souvislá (otevřená i uzavřená) křivka, jinak uzavřené profily. */
function sketchWires(sk: SketchF): r.Wire[] {
  try {
    return [sketchPathWire(sk, false)]; // profil plochy – automaticky uzavřená čára zůstane uzavřená
  } catch {
    const d = sketchDrawing(sk);
    if (!d) throw new Error(tr("Skica „{0}“ neobsahuje souvislou křivku ani uzavřený profil.", sk.name));
    const shape = closedFaces(sk);
    const faces = shape instanceof r.Face ? [shape] : shape.faces;
    const list = faces.flatMap((f) => [f.outerWire(), ...f.innerWires()]);
    if (!list.length) throw new Error(tr("Skica „{0}“ neobsahuje křivku.", sk.name));
    return list;
  }
}

/** Uzavřené profily skici jako plocha (s otvory) nebo složení více ploch. */
function closedFaces(sk: SketchF): r.AnyShape {
  const d = sketchDrawing(sk);
  if (!d) throw new Error(tr("Skica „{0}“ musí obsahovat uzavřený profil.", sk.name));
  const shape = (d.sketchOnPlane(planeOf(sk.plane)) as { faces(): r.AnyShape }).faces();
  if (!shape || shape.isNull || !shape.faces.length) throw new Error(tr("Skica „{0}“ neobsahuje uzavřený profil.", sk.name));
  return shape;
}

/** Skořepina (nebo jediná plocha) z libovolného tvaru – pro OCCT operace, které chtějí Shell/Face. */
function shellOrFace(shape: r.AnyShape): r.AnyShape {
  if (shape instanceof r.Shell || shape instanceof r.Face) return shape;
  const shells = subShapes(shape, "SHELL").map((s) => r.cast(s as never));
  if (shells.length === 1) return shells[0];
  if (shells.length > 1) throw new Error(tr("Plochy netvoří jednu souvislou skořepinu – nejdřív je sešijte (Sešít plochy) nebo zvětšete toleranci."));
  const faces = shape.faces;
  if (faces.length === 1) return faces[0];
  throw new Error(tr("Plochy na sebe nenavazují – nejdřív je sešijte."));
}

/** Opraví orientaci solidu (záporný objem = obrácená skořepina). */
function fixSolid(shape: r.AnyShape): Shape {
  if (!r.isShape3D(shape)) throw new Error(tr("Výsledek není těleso."));
  let s: Shape = shape;
  if (r.measureVolume(s) < 0) {
    const o = oc();
    try {
      const fix = new o.ShapeFix_Solid(s.wrapped);
      fix.Perform(new o.Message_ProgressRange());
      const fixed = r.cast(fix.Solid());
      fix.delete();
      if (r.isShape3D(fixed)) s = fixed;
    } catch {
      /* zkusit otočení níže */
    }
    if (r.measureVolume(s) < 0) {
      const rev = r.cast(s.wrapped.Reversed());
      if (r.isShape3D(rev)) s = rev;
    }
  }
  return s;
}

/** Složené těleso z více částí; jediná 3D část se vrátí přímo. */
function asBody(parts: r.AnyShape[]): Shape {
  const live = parts.filter((p) => p && !p.isNull);
  if (!live.length) throw new Error(tr("Výsledek je prázdný."));
  if (live.length === 1 && r.isShape3D(live[0])) return live[0];
  return r.makeCompound(live) as Shape;
}

const solidsOf = (body: Shape): r.Solid[] => body.solids;

/** Plochy, které nejsou součástí žádného solidu (volné plochy / skořepiny). */
function freeFaces(body: Shape | null): r.Face[] {
  if (!body) return [];
  const inSolid = new Set(solidsOf(body).flatMap((s) => s.faces.map((f) => f.hashCode)));
  return body.faces.filter((f) => !inSolid.has(f.hashCode));
}

/** Nové těleso: zachová existující solidy i volné plochy a přidá novou plochu. */
function withSurface(ctx: ExtBuildCtx, surf: r.AnyShape | r.AnyShape[]): Shape {
  const add = Array.isArray(surf) ? surf : [surf];
  return ctx.body ? asBody([ctx.body, ...add]) : asBody(add);
}

/** Nahradí volné plochy novými (solidy zůstávají). */
function replaceFree(ctx: ExtBuildCtx, parts: r.AnyShape[]): Shape {
  return asBody([...(ctx.body ? solidsOf(ctx.body) : []), ...parts]);
}

function fuseAll(parts: Shape[]): Shape {
  let acc = parts[0];
  for (const p of parts.slice(1)) acc = acc.fuse(p);
  return acc;
}

/** Solid z operace → booleovsky s existujícími solidy; volné plochy zůstanou (pokud `consumeFree` není true). */
function applySolid(ctx: ExtBuildCtx, solid: Shape, mode: BoolMode, consumeFree = false): Shape {
  const solids = ctx.body ? solidsOf(ctx.body) : [];
  const free = consumeFree ? [] : freeFaces(ctx.body);
  let result: Shape = solid;
  if (solids.length && mode !== "new") {
    const base = fuseAll(solids as Shape[]);
    if (mode === "cut") result = base.cut(solid);
    else if (mode === "intersect") result = base.intersect(solid);
    else result = base.fuse(solid);
  }
  return asBody([result, ...free]);
}

function bboxDiag(s: Shape | null) {
  if (!s) return 200;
  const [[x0, y0, z0], [x1, y1, z1]] = s.boundingBox.bounds;
  return Math.hypot(x1 - x0, y1 - y0, z1 - z0) || 200;
}

/** Velký kvádr na jedné straně základní roviny (side = +1 ponechá kladnou stranu → kvádr leží na záporné). */
function sideBox(pl: r.Plane, removeSide: 1 | -1, D: number): r.Solid {
  // hranol nad velkým čtvercem v rovině (rovina může být obecná – plocha modelu, tři body…)
  const n = norm(vec(pl.zDir));
  return r.basicFaceExtrusion(planeFace(pl, D), new r.Vector(scaleV(n, removeSide * D)));
}

/** Velká čtvercová plocha v základní rovině. */
function planeFace(pl: r.Plane, D: number): r.Face {
  const P = (x: number, y: number) => vec(pl.toWorldCoords([x, y]));
  const w = r.assembleWire([r.makeLine(P(-D, -D), P(D, -D)), r.makeLine(P(D, -D), P(D, D)), r.makeLine(P(D, D), P(-D, D)), r.makeLine(P(-D, D), P(-D, -D))]);
  return r.makeFace(w);
}

/** Sešití ploch do skořepiny (tolerancí). `freeEdges` = počet volných (nesešitých) hran → 0 = uzavřená skořepina. */
function sewInfo(faces: r.AnyShape[], tol = 1e-4): { shape: r.AnyShape; freeEdges: number } {
  if (!faces.length) throw new Error(tr("Není co sešít – nejdřív vytvořte plochy."));
  const o = oc();
  const s = new o.BRepBuilderAPI_Sewing(tol, true, true, true, false);
  try {
    for (const f of faces) s.Add(f.wrapped);
    s.Perform(new o.Message_ProgressRange());
    const freeEdges = Number(s.NbFreeEdges());
    const shape = faces.length === 1 ? faces[0] : r.cast(r.downcast(s.SewedShape()));
    return { shape, freeEdges };
  } finally {
    s.delete();
  }
}
const sew = (faces: r.AnyShape[], tol = 1e-4): r.AnyShape => sewInfo(faces, tol).shape;

/** Volné plochy jako jedno 3D těleso (skořepina / složené), na kterém lze dělat booleovské operace. */
function surfaceBody(faces: r.Face[]): Shape {
  const s = sew(faces);
  return r.isShape3D(s) ? s : (r.makeCompound([s]) as Shape);
}

function shellFaces(s: r.AnyShape): r.Face[] {
  return (s as Shape).faces ?? [];
}

/** Otevřený drát rotovaný kolem osy → plocha. */
function revolveWire(wire: r.Wire, origin: Vec3, dir: Vec3, angleDeg: number): r.AnyShape {
  const o = oc();
  const ax = r.makeAx1(origin, dir);
  const b = new o.BRepPrimAPI_MakeRevol(wire.wrapped, ax, Math.max(0.1, Math.min(360, angleDeg)) * DEG, false);
  try {
    return r.cast(b.Shape());
  } finally {
    b.delete();
    ax.delete();
  }
}

/** Drát vysunutý o vektor → plocha (skořepina). */
function extrudeWire(wire: r.Wire, start: Vec3, v: Vec3): r.AnyShape {
  const [shell] = r.complexExtrude(wire, start, v, undefined, true);
  return shell;
}

/** Hrany seřazené do souvislé smyčky podle koncových bodů. */
function orderEdges(edges: r.Edge[]): r.Edge[] {
  const near = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-4;
  const out: r.Edge[] = [edges[0]];
  const used = new Set([0]);
  let end = vec(edges[0].endPoint);
  while (out.length < edges.length) {
    let found = false;
    for (let i = 0; i < edges.length; i++) {
      if (used.has(i)) continue;
      const e = edges[i];
      if (near(vec(e.startPoint), end)) {
        out.push(e);
        end = vec(e.endPoint);
      } else if (near(vec(e.endPoint), end)) {
        out.push(e);
        end = vec(e.startPoint);
      } else continue;
      used.add(i);
      found = true;
      break;
    }
    if (!found) throw new Error(tr("Vybrané hrany netvoří souvislou uzavřenou smyčku."));
  }
  return out;
}

const PLANES = [
  { v: "XY", l: "XY" },
  { v: "XZ", l: "XZ" },
  { v: "YZ", l: "YZ" },
];
const TAB = "surface" as const;

// ---------------- Plochy ----------------

registerExt({
  ext: "surf.extrude",
  label: tr("Plošné vysunutí"),
  icon: "surf-extrude",
  tone: "create",
  tab: TAB,
  group: "Plochy",
  big: true,
  order: 1,
  hint: tr("křivka skici (i otevřená) vysunutá do plochy"),
  make: (doc) => ({ sketchId: lastSketch(doc), distance: 20, symmetric: false, reverse: false }),
  params: [
    { key: "sketchId", label: tr("Skica (křivka)"), kind: "sketch" },
    { key: "distance", label: tr("Vzdálenost"), kind: "number", min: 0.01 },
    { key: "dir", label: tr("Směr vysunutí"), kind: "direction", allowNormal: true, hint: tr("výchozí kolmo na rovinu skici; jinak osa, vektor, hrana nebo normála plochy") },
    { key: "symmetric", label: tr("Symetricky na obě strany"), kind: "bool" },
    { key: "reverse", label: tr("Opačný směr"), kind: "bool" },
  ],
  build: (d, ctx) => {
    const sk = needSketch(ctx, d.sketchId, tr("skicu s křivkou"));
    const dist = num(d.distance);
    if (!(dist > 0)) throw new Error(tr("Vzdálenost musí být kladná."));
    const pl = planeOf(sk.plane);
    // směr: kolmo na skicu (výchozí, jako dřív), nebo zadaný osou / vektorem / odkazem
    const n = extDirection(d, ctx, "dir", { base: { normal: norm(vec(pl.zDir)), xDir: vec(pl.xDir) } });
    const len = (d.reverse ? -1 : 1) * dist;
    const shells: r.AnyShape[] = [];
    for (const w of sketchWires(sk)) {
      const start = vec(w.startPoint);
      if (d.symmetric) {
        const from = addV(start, scaleV(n, -len / 2));
        shells.push(extrudeWire(w.translate(scaleV(n, -len / 2)) as r.Wire, from, scaleV(n, len)));
      } else shells.push(extrudeWire(w, start, scaleV(n, len)));
    }
    return withSurface(ctx, shells.length > 1 ? sew(shells) : shells[0]);
  },
});

registerExt({
  ext: "surf.revolve",
  label: tr("Plošná rotace"),
  icon: "surf-revolve",
  tone: "create",
  tab: TAB,
  group: "Plochy",
  big: true,
  order: 2,
  hint: tr("otevřený profil rotovaný kolem osy (osa skici, čára skici, hrana, válcová plocha, dva body…)"),
  make: (doc) => ({ sketchId: lastSketch(doc), angle: 360, axis: { kind: "sketchY" } }),
  params: [
    { key: "sketchId", label: tr("Skica (profil)"), kind: "sketch" },
    { key: "angle", label: tr("Úhel"), kind: "number", unit: "°", min: 0.1, max: 360 },
    { key: "axis", label: tr("Osa rotace"), kind: "axis", sketchKey: "sketchId" },
  ],
  build: (d, ctx) => {
    const sk = needSketch(ctx, d.sketchId, tr("skicu s profilem"));
    const pl = planeOf(sk.plane);
    // osa: osy skici (dřívější „x“ / „y“) beze změny výpočtu, jinak čára skici / hrana / válcová plocha / dva body / globální osa…
    const ad = toAxisDef(d.axis) ?? { kind: "sketchY" };
    const fromSketch = ad.kind === "sketchX" || ad.kind === "sketchY";
    const ax = fromSketch ? { origin: vec(pl.origin), dir: norm(vec(ad.kind === "sketchX" ? pl.xDir : pl.yDir)) } : extAxis(d, ctx, "axis", { sketchKey: "sketchId" });
    const dir = ax.dir;
    const origin = ax.origin;
    const parts = sketchWires(sk).map((w) => revolveWire(w, origin, dir, num(d.angle, 360)));
    return withSurface(ctx, parts.length > 1 ? sew(parts) : parts[0]);
  },
});

registerExt({
  ext: "surf.planar",
  label: tr("Rovinná plocha"),
  icon: "surf-planar",
  tone: "create",
  tab: TAB,
  group: "Plochy",
  order: 3,
  hint: tr("uzavřený profil skici → rovinná plocha (i s otvory)"),
  make: (doc) => ({ sketchId: lastSketch(doc) }),
  params: [{ key: "sketchId", label: tr("Skica (uzavřený profil)"), kind: "sketch" }],
  build: (d, ctx) => withSurface(ctx, closedFaces(needSketch(ctx, d.sketchId, tr("skicu s uzavřeným profilem")))),
});

registerExt({
  ext: "surf.sweep",
  label: tr("Tažení plochy"),
  icon: "surf-sweep",
  tone: "create",
  tab: TAB,
  group: "Plochy",
  big: true,
  order: 4,
  hint: tr("otevřený profil tažený po dráze (druhá skica)"),
  make: (doc) => ({ profileId: lastSketch(doc, 1), pathId: lastSketch(doc), frenet: false }),
  params: [
    { key: "profileId", label: tr("Profil (skica)"), kind: "sketch" },
    { key: "pathId", label: tr("Dráha (skica)"), kind: "sketch" },
    { key: "frenet", label: tr("Frenet (profil se natáčí s dráhou)"), kind: "bool" },
  ],
  build: (d, ctx) => {
    const prof = needSketch(ctx, d.profileId, tr("skicu profilu"));
    const path = needSketch(ctx, d.pathId, tr("skicu dráhy"));
    if (prof.id === path.id) throw new Error(tr("Profil a dráha musí být dvě různé skici."));
    const spine = sketchPathWire(path);
    const parts = sketchWires(prof).map((w) => r.genericSweep(w, spine, { frenet: !!d.frenet }, true)[0]);
    return withSurface(ctx, parts.length > 1 ? sew(parts) : parts[0]);
  },
});

registerExt({
  ext: "surf.loft",
  label: tr("Šablonování ploch"),
  icon: "surf-loft",
  tone: "create",
  tab: TAB,
  group: "Plochy",
  order: 5,
  hint: tr("plocha přes 2 a více křivek (v různých rovinách)"),
  make: (doc) => ({ sketchIds: [lastSketch(doc, 1), lastSketch(doc)].filter(Boolean), ruled: false }),
  params: [
    { key: "sketchIds", label: tr("Křivky (skici v pořadí)"), kind: "sketches" },
    { key: "ruled", label: tr("Přímkové plochy (bez vyhlazení)"), kind: "bool" },
  ],
  build: (d, ctx) => {
    const list = sids(d.sketchIds).map((id) => needSketch(ctx, id, "skici"));
    if (list.length < 2) throw new Error(tr("Šablonování potřebuje alespoň dvě skici."));
    const wires = list.map((sk) => sketchWires(sk)[0]);
    const [first, ...rest] = wires.map((w) => new r.Sketch(w));
    const shell = first.loftWith(rest, { ruled: !!d.ruled }, true);
    return withSurface(ctx, shell);
  },
});

// ---------------- Úpravy ploch ----------------

registerExt({
  ext: "surf.offset",
  label: tr("Odsazená plocha"),
  icon: "surf-offset",
  tone: "feature",
  tab: TAB,
  group: "Úpravy ploch",
  big: true,
  order: 10,
  hint: tr("kopie plochy odsazená po normále (bez výběru = všechny volné plochy)"),
  pick: { kind: "faces", key: "faces" },
  rollback: true,
  make: (_doc, extra) => ({ faces: ids(extra?.faces), distance: 5, keepOriginal: true }),
  params: [
    { key: "faces", label: tr("Plochy"), kind: "faces", hint: tr("nic = všechny volné plochy") },
    { key: "distance", label: tr("Odsazení"), kind: "number", step: 0.5, hint: tr("záporné = opačným směrem") },
    { key: "keepOriginal", label: tr("Zachovat původní plochu"), kind: "bool" },
  ],
  build: (d, ctx) => {
    if (!ctx.body) throw new Error(tr("Nejdřív vytvořte plochu nebo těleso."));
    const dist = num(d.distance);
    if (!dist) throw new Error(tr("Odsazení nesmí být nulové."));
    const sel = ids(d.faces);
    const faces = sel.length ? sel.map((i) => ctx.body!.faces[i]).filter(Boolean) : freeFaces(ctx.body);
    if (!faces.length) throw new Error(tr("Vyberte plochy k odsazení."));
    const offs = faces.map((f) => {
      try {
        return r.makeOffset(f, dist);
      } catch {
        throw new Error(tr("Tuto plochu se nepodařilo odsadit – zkuste menší vzdálenost."));
      }
    });
    const res = offs.length > 1 ? sew(offs) : offs[0];
    if (d.keepOriginal !== false) return withSurface(ctx, res);
    if (!sel.length) return replaceFree(ctx, [res]); // bez výběru: všechny volné plochy nahradí odsazené
    // vybrané plochy bez zachování: volné plochy se nahradí odsazenými, ostatní volné zůstanou; plocha tělesa (solidu)
    // zůstat musí – bez ní by těleso přestalo být uzavřené (ohlásí se varováním, ne potichu)
    const free = freeFaces(ctx.body);
    const isFree = (f: r.Face) => free.some((x) => x.isSame(f));
    const inSolid = faces.filter((f) => !isFree(f)).length;
    if (inSolid) noteFeatureWarning(tr("Původní plochy tělesa ({0}) zůstávají – plochu solidu odstranit nelze; nahrazují se jen volné plochy.", inSolid));
    return replaceFree(ctx, [...free.filter((x) => !faces.some((f) => f.isSame(x))), res]);
  },
});

registerExt({
  ext: "surf.extend",
  label: tr("Prodloužit plochu"),
  icon: "surf-extend",
  tone: "feature",
  tab: TAB,
  group: "Úpravy ploch",
  order: 11,
  hint: tr("rovinná plocha se zvětší o danou délku po obvodu; zakřivená v parametrech plochy"),
  pick: { kind: "faces", key: "faces" },
  rollback: true,
  make: (_doc, extra) => ({ faces: ids(extra?.faces), length: 10 }),
  params: [
    { key: "faces", label: tr("Plochy"), kind: "faces" },
    { key: "length", label: tr("Délka prodloužení"), kind: "number", min: 0.01 },
  ],
  build: (d, ctx) => {
    if (!ctx.body) throw new Error(tr("Nejdřív vytvořte plochu."));
    const len = num(d.length);
    if (!(len > 0)) throw new Error(tr("Délka musí být kladná."));
    const sel = ids(d.faces);
    if (!sel.length) throw new Error(tr("Vyberte plochu k prodloužení."));
    const all = ctx.body.faces;
    const picked = new Set(sel);
    const kept = freeFaces(ctx.body).filter((f) => !sel.some((i) => all[i]?.isSame(f)));
    const extended = sel.map((i) => {
      const f = all[i];
      if (!f) throw new Error(tr("Vybraná plocha už v modelu není."));
      if (f.geomType === "PLANE") {
        const w = f.outerWire().offset2D(len, "arc");
        return r.makeFace(w);
      }
      // zakřivená plocha: rozšíření v parametrickém prostoru
      const o = oc();
      const { uMin, uMax, vMin, vMax } = f.UVBounds;
      const pu = (u: number, v: number) => vec(f.pointOnSurface(u, v));
      const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      const du = (len * (uMax - uMin)) / Math.max(1e-6, dist(pu(uMin, (vMin + vMax) / 2), pu(uMax, (vMin + vMax) / 2)));
      const dv = (len * (vMax - vMin)) / Math.max(1e-6, dist(pu((uMin + uMax) / 2, vMin), pu((uMin + uMax) / 2, vMax)));
      const handle = (o.BRep_Tool.Surface_2 ?? o.BRep_Tool.Surface)(f.wrapped);
      const mk = new o.BRepBuilderAPI_MakeFace(handle.get(), uMin - du, uMax + du, vMin - dv, vMax + dv, 1e-6);
      try {
        const face = r.cast(mk.Shape());
        if (!(face instanceof r.Face)) throw new Error("x");
        return face;
      } catch {
        throw new Error(tr("Zakřivenou plochu tohoto typu nelze prodloužit – použijte Odsazenou plochu nebo ji vytvořte znovu větší."));
      } finally {
        mk.delete();
      }
    });
    void picked;
    return replaceFree(ctx, [...kept, ...extended]);
  },
});

registerExt({
  ext: "surf.trimPlane",
  label: tr("Oříznout rovinou"),
  icon: "surf-trim",
  tone: "cut",
  tab: TAB,
  group: "Úpravy ploch",
  order: 12,
  hint: tr("odřízne část volných ploch na jedné straně roviny"),
  make: () => ({ plane: "XY", offset: 0, keep: "positive" }),
  params: [
    { key: "planeDef", label: tr("Rovina odkazem"), kind: "plane", hint: tr("plocha modelu, tři body, pomocná rovina… – má přednost před základní rovinou níže") },
    { key: "plane", label: tr("Rovina"), kind: "enum", options: PLANES },
    { key: "offset", label: tr("Odsazení roviny"), kind: "number" },
    { key: "keep", label: tr("Ponechat stranu"), kind: "enum", options: [{ v: "positive", l: tr("+ (po normále)") }, { v: "negative", l: "−" }] },
  ],
  build: (d, ctx) => {
    const free = freeFaces(ctx.body);
    if (!free.length) throw new Error(tr("Není co oříznout – vytvořte nejdřív plochu."));
    const D = bboxDiag(ctx.body) * 4;
    const box = sideBox(extPlane(d, ctx), str(d.keep, "positive") === "positive" ? -1 : 1, D);
    const cut = surfaceBody(free).cut(box);
    if (!shellFaces(cut).length) throw new Error(tr("Rovina plochu neprotíná na zvolené straně nic nezůstalo – otočte stranu."));
    return replaceFree(ctx, [cut]);
  },
});

registerExt({
  ext: "surf.trimSketch",
  label: tr("Oříznout skicou"),
  icon: "surf-trim-sketch",
  tone: "cut",
  tab: TAB,
  group: "Úpravy ploch",
  order: 13,
  hint: tr("uzavřený profil skici promítnutý na plochy – ponechá vnitřek nebo vnějšek"),
  make: (doc) => ({ sketchId: lastSketch(doc), keep: "inside" }),
  params: [
    { key: "sketchId", label: tr("Skica (uzavřený profil)"), kind: "sketch" },
    { key: "keep", label: tr("Ponechat"), kind: "enum", options: [{ v: "inside", l: tr("Vnitřek profilu") }, { v: "outside", l: tr("Vnějšek") }] },
  ],
  build: (d, ctx) => {
    const free = freeFaces(ctx.body);
    if (!free.length) throw new Error(tr("Není co oříznout – vytvořte nejdřív plochu."));
    const sk = needSketch(ctx, d.sketchId, tr("skicu s uzavřeným profilem"));
    const D = bboxDiag(ctx.body) * 4;
    const pl = planeOf(sk.plane);
    const n = norm(vec(pl.zDir));
    const dr = sketchDrawing(sk);
    if (!dr) throw new Error(tr("Skica musí obsahovat uzavřený profil."));
    const prism = (dr.sketchOnPlane(pl).extrude(2 * D) as Shape).translate(scaleV(n, -D));
    const surf = surfaceBody(free);
    const res = str(d.keep, "inside") === "inside" ? surf.intersect(prism) : surf.cut(prism);
    if (!shellFaces(res).length) throw new Error(tr("Profil skici plochu neprotíná."));
    return replaceFree(ctx, [res]);
  },
});

registerExt({
  ext: "surf.sew",
  label: tr("Sešít plochy"),
  icon: "surf-sew",
  tone: "feature",
  tab: TAB,
  group: "Úpravy ploch",
  order: 14,
  hint: tr("spojí volné plochy do jedné skořepiny"),
  make: () => ({ tolerance: 0.01 }),
  params: [{ key: "tolerance", label: tr("Tolerance"), kind: "number", min: 0.0001, step: 0.01 }],
  build: (d, ctx) => {
    const free = freeFaces(ctx.body);
    if (free.length < 2) throw new Error(tr("K sešití jsou potřeba alespoň dvě volné plochy."));
    return replaceFree(ctx, [sew(free, num(d.tolerance, 0.01))]);
  },
});

registerExt({
  ext: "surf.close",
  label: tr("Uzavřít do tělesa"),
  icon: "surf-close",
  tone: "feature",
  tab: TAB,
  group: "Těleso ↔ plocha",
  big: true,
  order: 20,
  hint: tr("uzavřené volné plochy → solid (lze sloučit/odebrat s existujícím tělesem)"),
  // výchozí Přidat (jako formulář): bez tělesa v dílu je totéž co dřívější „new“, s tělesem se výsledek sloučí místo náhrady
  make: () => ({ mode: "add", tolerance: 0.01 }),
  params: [
    { key: "tolerance", label: tr("Tolerance sešití"), kind: "number", min: 0.0001, step: 0.01 },
    { key: "mode", label: tr("Operace"), kind: "mode", newLabel: tr("Nahradit tělesa") },
  ],
  build: (d, ctx) => {
    const free = freeFaces(ctx.body);
    if (!free.length) throw new Error(tr("Nejsou žádné volné plochy k uzavření."));
    const info = sewInfo(free, num(d.tolerance, 0.01));
    if (info.freeEdges > 0) throw new Error(tr("Plochy neuzavírají objem – {0} volných hran (chybí stěna nebo jsou mezery; zvětšete toleranci).", info.freeEdges));
    const shell = shellOrFace(info.shape);
    if (shell instanceof r.Face) throw new Error(tr("Jedna plocha objem neuzavírá – přidejte další plochy."));
    const o = oc();
    let solid: r.AnyShape;
    try {
      const fix = new o.ShapeFix_Solid();
      solid = r.cast(fix.SolidFromShell(shell.wrapped));
      fix.delete();
    } catch {
      throw new Error(tr("Plochy neuzavírají objem – zkontrolujte, že na sebe navazují (Sešít plochy)."));
    }
    if (!r.isShape3D(solid) || !(Math.abs(r.measureVolume(solid)) > 1e-6)) throw new Error(tr("Plochy neuzavírají objem – chybí některá stěna nebo jsou mezery."));
    return applySolid(ctx, fixSolid(solid), str(d.mode, "add") as BoolMode, true);
  },
});

registerExt({
  ext: "surf.thicken",
  label: tr("Zesílit plochu"),
  icon: "surf-thicken",
  tone: "feature",
  tab: TAB,
  group: "Těleso ↔ plocha",
  big: true,
  order: 21,
  hint: tr("z volných ploch vznikne solid dané tloušťky"),
  make: () => ({ thickness: 2, side: "normal", mode: "add" }),
  params: [
    { key: "thickness", label: tr("Tloušťka"), kind: "number", min: 0.01, step: 0.5 },
    { key: "side", label: tr("Strana"), kind: "enum", options: [{ v: "normal", l: tr("Po normále") }, { v: "reverse", l: tr("Proti normále") }] },
    { key: "mode", label: tr("Operace"), kind: "mode", newLabel: tr("Nahradit tělesa") },
  ],
  build: (d, ctx) => {
    const free = freeFaces(ctx.body);
    if (!free.length) throw new Error(tr("Nejsou žádné volné plochy k zesílení."));
    const t = num(d.thickness) * (str(d.side, "normal") === "reverse" ? -1 : 1);
    if (!t) throw new Error(tr("Tloušťka musí být kladná."));
    const shell = shellOrFace(sew(free));
    const o = oc();
    const mk = new o.BRepOffsetAPI_MakeThickSolid();
    let solid: r.AnyShape;
    try {
      mk.MakeThickSolidBySimple(shell.wrapped, t);
      mk.Build(new o.Message_ProgressRange());
      solid = r.cast(mk.Shape());
    } catch {
      throw new Error(tr("Plochu se nepodařilo zesílit – zkuste menší tloušťku nebo nejdřív plochy sešijte."));
    } finally {
      mk.delete();
    }
    if (!r.isShape3D(solid) || !(Math.abs(r.measureVolume(solid)) > 1e-6)) throw new Error(tr("Zesílení nevytvořilo objem – zkuste menší tloušťku."));
    return applySolid(ctx, fixSolid(solid), str(d.mode, "add") as BoolMode, true);
  },
});

registerExt({
  ext: "surf.split",
  label: tr("Rozdělit těleso"),
  icon: "surf-split",
  tone: "cut",
  tab: TAB,
  group: "Těleso ↔ plocha",
  order: 22,
  hint: tr("rozřízne solid rovinou – obě části zůstanou, nebo jen jedna"),
  make: () => ({ plane: "XY", offset: 0, keep: "both" }),
  params: [
    { key: "planeDef", label: tr("Rovina odkazem"), kind: "plane", hint: tr("plocha modelu, tři body, pomocná rovina… – má přednost před základní rovinou níže") },
    { key: "plane", label: tr("Rovina"), kind: "enum", options: PLANES },
    { key: "offset", label: tr("Odsazení"), kind: "number" },
    { key: "keep", label: tr("Ponechat"), kind: "enum", options: [{ v: "both", l: tr("Obě části") }, { v: "positive", l: tr("+ strana") }, { v: "negative", l: tr("− strana") }] },
  ],
  build: (d, ctx) => {
    const solids = ctx.body ? solidsOf(ctx.body) : [];
    if (!solids.length) throw new Error(tr("Rozdělit lze jen těleso (solid)."));
    const base = fuseAll(solids as Shape[]);
    const res = hasPlaneDef(d) ? base.split(extPlane(d, ctx)) : base.split(str(d.plane, "XY") as PlaneName, num(d.offset));
    const keep = str(d.keep, "both");
    const parts = (keep === "both" ? [res.positive, res.negative] : keep === "positive" ? [res.positive] : [res.negative]).filter((p): p is r.Solid | r.Compound => !!p);
    if (!parts.length) throw new Error(tr("Rovina těleso neprotíná."));
    return asBody([...parts, ...freeFaces(ctx.body)]);
  },
});

registerExt({
  ext: "surf.replaceFace",
  label: tr("Nahradit plochu (posun)"),
  icon: "surf-replace",
  tone: "feature",
  tab: TAB,
  group: "Těleso ↔ plocha",
  order: 23,
  hint: tr("rovinná plocha tělesa se posune po normále a sousední plochy se dotáhnou"),
  pick: { kind: "faces", key: "faces" },
  rollback: true,
  make: (_doc, extra) => ({ faces: ids(extra?.faces), distance: 5 }),
  params: [
    { key: "faces", label: tr("Plochy tělesa"), kind: "faces" },
    { key: "distance", label: tr("Posun"), kind: "number", step: 0.5, hint: tr("záporně dovnitř") },
  ],
  build: (d, ctx) => {
    if (!ctx.body || !solidsOf(ctx.body).length) throw new Error(tr("Nahradit plochu lze jen na tělese (solidu)."));
    const sel = ids(d.faces);
    if (!sel.length) throw new Error(tr("Vyberte plochu tělesa."));
    return pushPull(ctx.body, sel, num(d.distance, 5));
  },
});

registerExt({
  ext: "surf.patch",
  label: tr("Záplata z hran"),
  icon: "surf-patch",
  tone: "create",
  tab: TAB,
  group: "Úpravy ploch",
  order: 15,
  hint: tr("hladká plocha vyplní uzavřenou smyčku vybraných hran (N-stranná výplň)"),
  pick: { kind: "edges", key: "edges" },
  rollback: true,
  make: (_doc, extra) => ({ edges: ids(extra?.edges) }),
  params: [{ key: "edges", label: tr("Hrany smyčky"), kind: "edges" }],
  build: (d, ctx) => {
    if (!ctx.body) throw new Error(tr("Nejdřív vytvořte plochu nebo těleso s hranami."));
    const all = ctx.body.edges;
    const edges = ids(d.edges).map((i) => all[i]).filter(Boolean);
    if (edges.length < 2) throw new Error(tr("Vyberte alespoň dvě hrany tvořící uzavřenou smyčku."));
    const wire = r.assembleWire(orderEdges(edges));
    let face: r.Face;
    try {
      face = r.makeNonPlanarFace(wire);
    } catch {
      try {
        face = r.makeFace(wire);
      } catch {
        throw new Error(tr("Z vybraných hran se nepodařilo vytvořit plochu – smyčka musí být uzavřená."));
      }
    }
    return withSurface(ctx, face);
  },
});

// ---------------- Křivky ----------------

registerExt({
  ext: "surf.section",
  label: tr("Křivka průniku"),
  icon: "surf-section",
  tone: "ref",
  tab: TAB,
  group: "Křivky",
  order: 30,
  hint: tr("průsečnice tělesa/ploch s rovinou (pomocná 3D křivka; do skici ji převede Promítnout hrany)"),
  make: () => ({ plane: "XY", offset: 0 }),
  params: [
    { key: "planeDef", label: tr("Rovina odkazem"), kind: "plane", hint: tr("plocha modelu, tři body, pomocná rovina… – má přednost před základní rovinou níže") },
    { key: "plane", label: tr("Rovina"), kind: "enum", options: PLANES },
    { key: "offset", label: tr("Odsazení"), kind: "number" },
  ],
  build: (d, ctx) => {
    if (!ctx.body) throw new Error(tr("Nejdřív vytvořte těleso nebo plochu."));
    const D = bboxDiag(ctx.body) * 2;
    const face = planeFace(extPlane(d, ctx), D);
    const o = oc();
    const s = new o.BRepAlgoAPI_Section(ctx.body.wrapped, face.wrapped, true);
    let curves: r.AnyShape;
    try {
      curves = r.cast(s.Shape());
    } finally {
      s.delete();
    }
    if (!curves.edges.length) throw new Error(tr("Rovina model neprotíná."));
    return asBody([ctx.body, curves]);
  },
});

registerExt({
  ext: "surf.project",
  label: tr("Promítnout skicu na plochu"),
  icon: "surf-project",
  tone: "ref",
  tab: TAB,
  group: "Křivky",
  order: 31,
  hint: tr("křivky skici promítnuté po normále skici na vybranou plochu"),
  pick: { kind: "faces", key: "faces" },
  rollback: true,
  make: (doc, extra) => ({ sketchId: lastSketch(doc), faces: ids(extra?.faces) }),
  params: [
    { key: "sketchId", label: tr("Skica"), kind: "sketch" },
    { key: "faces", label: tr("Cílové plochy"), kind: "faces" },
  ],
  build: (d, ctx) => {
    if (!ctx.body) throw new Error(tr("Nejdřív vytvořte těleso nebo plochu."));
    const sk = needSketch(ctx, d.sketchId, "skicu");
    const sel = ids(d.faces);
    if (!sel.length) throw new Error(tr("Vyberte cílovou plochu."));
    const D = bboxDiag(ctx.body) * 2;
    const pl = planeOf(sk.plane);
    const n = norm(vec(pl.zDir));
    const targets = sel.map((i) => ctx.body!.faces[i]).filter(Boolean);
    const o = oc();
    const out: r.AnyShape[] = [];
    for (const w of sketchWires(sk)) {
      const back = w.translate(scaleV(n, -D)) as r.Wire;
      const sheet = extrudeWire(back, vec(back.startPoint), scaleV(n, 2 * D));
      for (const t of targets) {
        const s = new o.BRepAlgoAPI_Section(t.wrapped, sheet.wrapped, true);
        try {
          const c = r.cast(s.Shape());
          if (c.edges.length) out.push(c);
        } finally {
          s.delete();
        }
      }
    }
    if (!out.length) throw new Error(tr("Promítnutá křivka na vybranou plochu nedopadá."));
    return asBody([ctx.body, ...out]);
  },
});

registerExt({
  ext: "surf.helix",
  label: tr("Šroubovice"),
  icon: "surf-helix",
  tone: "ref",
  tab: TAB,
  group: "Křivky",
  order: 32,
  hint: tr("pomocná 3D křivka (pružina, závit) – těleso po šroubovici vytvoří Tažení po šroubovici"),
  make: () => ({ radius: 10, pitch: 5, turns: 4, position: [0, 0, 0], axis: { kind: "axis", axis: "Z" }, lefthand: false }),
  params: [
    { key: "radius", label: tr("Poloměr"), kind: "number", min: 0.01 },
    { key: "pitch", label: tr("Stoupání"), kind: "number", min: 0.01 },
    { key: "turns", label: tr("Počet závitů"), kind: "number", min: 0.05, step: 0.5, unit: "" },
    { key: "positionRef", label: tr("Střed začátku odkazem"), kind: "point", hint: tr("vrchol, střed hrany, bod skici… – má přednost před souřadnicemi níže") },
    { key: "position", label: tr("Střed začátku"), kind: "vec3" },
    { key: "axis", label: tr("Osa"), kind: "direction", hint: tr("X / Y / Z, vektor čísly, nebo odkazem: osa válcové plochy, hrana, normála plochy") },
    { key: "lefthand", label: tr("Levotočivá"), kind: "bool" },
  ],
  build: (d, ctx) => {
    const R = num(d.radius);
    const p = num(d.pitch);
    const t = num(d.turns);
    if (!(R > 0 && p > 0 && t > 0)) throw new Error(tr("Poloměr, stoupání i počet závitů musí být kladné."));
    const helix = r.makeHelix(p, p * t, R, extPoint(d, ctx, "position"), extDirection(d, ctx, "axis"), !!d.lefthand);
    return withSurface(ctx, helix);
  },
});

registerExt({
  ext: "surf.helixSweep",
  label: tr("Tažení po šroubovici"),
  icon: "surf-helix-sweep",
  tone: "create",
  tab: TAB,
  group: "Křivky",
  order: 33,
  hint: tr("profil (kruh, závit 60° nebo skica) tažený po šroubovici – závit, pružina, spirálová drážka"),
  toolBody: true,
  make: (doc) => ({ profile: "circle", wire: 2, depth: 1.2, side: "external", leadIn: 0, sketchId: lastSketch(doc), radius: 10, pitch: 5, turns: 4, position: [0, 0, 0], axis: { kind: "axis", axis: "Z" }, lefthand: false, mode: "add" }),
  params: [
    { key: "profile", label: tr("Profil"), kind: "enum", options: [{ v: "circle", l: tr("Kruh (drát)") }, { v: "thread60", l: tr("Závit 60°") }, { v: "sketch", l: tr("Skica") }] },
    { key: "wire", label: tr("Průměr drátu"), kind: "number", min: 0.01, hint: tr("pro profil Kruh") },
    { key: "depth", label: tr("Hloubka závitu"), kind: "number", min: 0.01, hint: tr("pro profil Závit 60°") },
    { key: "side", label: tr("Závit"), kind: "enum", options: [{ v: "external", l: tr("Vnější (na válci)") }, { v: "internal", l: tr("Vnitřní (v díře)") }], hint: tr("poloměr = povrch, kde závit začíná: válec, nebo díra (jádro); hloubka jde do materiálu") },
    { key: "leadIn", label: tr("Náběh (otáček)"), kind: "number", min: 0, step: 0.25, unit: "", hint: tr("jen Závit 60°: jako u závitového kalibru – hřbet prvního závitu je od začátku vybroušený a během zadaných otáček se zvedá do plného profilu (0 = bez náběhu)") },
    { key: "sketchId", label: tr("Skica profilu"), kind: "sketch", hint: tr("uzavřený profil v rovině XZ u začátku šroubovice") },
    { key: "radius", label: tr("Poloměr šroubovice"), kind: "number", min: 0.01, hint: tr("poloměr válce / díry") },
    { key: "pitch", label: tr("Stoupání"), kind: "number", min: 0.01 },
    { key: "turns", label: tr("Počet závitů"), kind: "number", min: 0.05, step: 0.5, unit: "" },
    { key: "positionRef", label: tr("Střed začátku odkazem"), kind: "point", hint: tr("vrchol, střed hrany, bod skici… – má přednost před souřadnicemi níže") },
    { key: "position", label: tr("Střed začátku"), kind: "vec3" },
    { key: "axis", label: tr("Osa"), kind: "direction", hint: tr("X / Y / Z, vektor čísly, nebo odkazem: osa válcové plochy, hrana, normála plochy") },
    { key: "lefthand", label: tr("Levotočivá"), kind: "bool" },
    { key: "mode", label: tr("Operace"), kind: "mode" },
  ],
  build: (d, ctx) => {
    const R = num(d.radius);
    const p = num(d.pitch);
    const t = num(d.turns);
    if (!(R > 0 && p > 0 && t > 0)) throw new Error(tr("Poloměr, stoupání i počet závitů musí být kladné."));
    if (t > 200) throw new Error(tr("Nejvýš 200 závitů."));
    const center = extPoint(d, ctx, "position");
    const dir = extDirection(d, ctx, "axis");
    const lefthand = !!d.lefthand;
    const profile = str(d.profile, "circle");
    const mode = str(d.mode, "add") as BoolMode;
    const removing = mode === "cut" || mode === "intersect";
    const internal = str(d.side, "external") === "internal";
    const leadIn = profile === "thread60" ? Math.max(0, Math.min(num(d.leadIn), t)) : 0;
    const full = r.makeHelix(p, p * t, R, center, dir, lefthand);
    /** bod šroubovice v otáčce `u` (0…t): osová souřadnice a jednotkový radiální směr */
    const helixAt = (u: number) => {
      const P = vec(full.pointAt(Math.max(0, Math.min(1, u / t))));
      const rel: Vec3 = [P[0] - center[0], P[1] - center[1], P[2] - center[2]];
      const z = rel[0] * dir[0] + rel[1] * dir[1] + rel[2] * dir[2];
      return { z, rad: norm([rel[0] - dir[0] * z, rel[1] - dir[1] * z, rel[2] - dir[2] * z]) };
    };
    /** profil u začátku šroubovice */
    const wireFor = (helix: r.Wire): r.Wire => {
      const start = vec(helix.startPoint);
      const tangent = norm(vec(helix.tangentAt(0)));
      const radial = norm([start[0] - center[0], start[1] - center[1], start[2] - center[2]].map((v, i) => v - dir[i] * (dir[0] * (start[0] - center[0]) + dir[1] * (start[1] - center[1]) + dir[2] * (start[2] - center[2]))) as Vec3);
      if (profile === "circle") {
        const w = num(d.wire);
        if (!(w > 0) || w >= p) throw new Error(tr("Průměr drátu musí být kladný a menší než stoupání."));
        return r.assembleWire([r.makeCircle(w / 2, start, tangent)]);
      }
      if (profile === "thread60") {
        const h = num(d.depth);
        if (!(h > 0)) throw new Error(tr("Hloubka závitu musí být kladná."));
        const half = Math.min(p * 0.45, h * Math.tan(30 * DEG) + 0.05 * p);
        // Trojúhelník profilu: základna 0,15 mm „za“ povrchem (ve vzduchu u odebrání, v materiálu u přidání), špička v hloubce h.
        // Vnější závit: materiál uvnitř poloměru R (válec) → odebrání směřuje dovnitř, přidání ven.
        // Vnitřní závit: materiál vně poloměru R (díra) → odebrání směřuje ven (do stěny díry), přidání dovnitř.
        // Dřívější chování (bez `side`) odpovídá vnějšímu závitu. Špička nesmí být tečná k povrchu – proto základna 0,15 mimo povrch.
        const inward = (removing ? -1 : 1) * (internal ? -1 : 1);
        const P = (rad: number, ax: number): Vec3 => addV(addV(start, scaleV(radial, rad)), scaleV(dir, ax));
        const a = P(-0.15 * inward, -half);
        const b = P(-0.15 * inward, half);
        const c = P(h * inward, 0);
        return r.assembleWire([r.makeLine(a, b), r.makeLine(b, c), r.makeLine(c, a)]);
      }
      const sk = needSketch(ctx, d.sketchId, tr("skicu profilu"));
      return sketchWires(sk)[0];
    };
    const sweep = (helix: r.Wire, wire: r.Wire): Shape => {
      let solid: Shape;
      try {
        solid = r.genericSweep(wire, helix, { frenet: true }, false);
      } catch {
        throw new Error(tr("Tažení po šroubovici se nepodařilo – profil se nesmí protínat sám se sebou (zmenšete profil nebo zvětšete stoupání)."));
      }
      if (!(Math.abs(r.measureVolume(solid)) > 1e-6)) throw new Error(tr("Tažení po šroubovici nevytvořilo objem – profil musí být uzavřený."));
      return solid;
    };
    const groove = sweep(full, wireFor(full));
    setExtTool(ctx, groove, mode === "new" ? "add" : mode); // zrcadlení / pole prvků (bez výbrusu náběhu)
    if (leadIn <= 0) return applySolid(ctx, groove, mode);
    // Náběh jako u závitového kalibru: drážka je od začátku plná, ale HŘBET prvního závitu je vybroušený – od začátku
    // šroubovice (hřbet odstraněn až na dno drážky) se během `leadIn` otáček plynule zvedá do plného profilu.
    // Výbrus = šablonování obdélníkových řezů podél šroubovice (šířka = stoupání, radiální hloubka klesá k nule), odebráno z tělesa.
    const h = num(d.depth);
    const inwardSign = (removing ? -1 : 1) * (internal ? -1 : 1); // směr od povrchu R do materiálu (jako u profilu)
    const crestR = removing ? R : R + h * inwardSign; // poloměr hřbetu (povrch, který zůstal mezi drážkami)
    const outward = removing ? inwardSign : -inwardSign; // směr od hřbetu ke dnu drážky
    const M = Math.max(12, Math.ceil(leadIn * 48));
    const sections: r.Wire[] = [];
    for (let k = 0; k <= M; k++) {
      const u = (leadIn * k) / M;
      const { z, rad } = helixAt(u);
      const depth = h * (1 - k / M); // od plného výbrusu po nulu
      const r1 = crestR - outward * 0.2; // 0,2 mm ve vzduchu za hřbetem
      const r2 = crestR + outward * depth;
      const P = (rr: number, ax: number): Vec3 => addV(addV(center, scaleV(rad, rr)), scaleV(dir, ax));
      const a = P(r1, z - p / 2);
      const b = P(r2, z - p / 2);
      const c = P(r2, z + p / 2);
      const e = P(r1, z + p / 2);
      sections.push(r.assembleWire([r.makeLine(a, b), r.makeLine(b, c), r.makeLine(c, e), r.makeLine(e, a)]));
    }
    let relief: Shape;
    try {
      relief = r.loft(sections, { ruled: false }); // hladká plocha výbrusu (bez facet mezi řezy)
    } catch {
      throw new Error(tr("Náběh závitu se nepodařilo vytvořit – zmenšete počet otáček náběhu nebo hloubku závitu."));
    }
    const body = applySolid(ctx, groove, mode);
    // výbrus hřbetu se vždy odebírá (i u přidaného závitu odebírá z hřbetu nově přidaného materiálu)
    return applySolid({ ...ctx, body }, relief, "cut");
  },
});

/** pomocné funkce pro plochy třídy A (surface-a.ts) */
export { asBody, freeFaces, replaceFree, sew, withSurface };
