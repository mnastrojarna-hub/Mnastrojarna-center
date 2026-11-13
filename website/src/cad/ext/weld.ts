/**
 * Svařence (modul rozšíření): konstrukční profily podél úseček skici (pokos / tupý spoj / bez úpravy),
 * rám z profilů, ořez rovinou, víčka, styčníky, svarové housenky, desky, značky svarů ISO 2553
 * a akce Kusovník řezů / Tabulka svarů (UI). Geometrie: OpenCascade přes replicad (líně načtené).
 */
import { extPlane, hasPlaneDef } from "./place";
import { tr } from "../i18n";
import type * as R from "replicad";
import { registerExt, type ExtBuildCtx, type Shape } from "./registry";
import {
  add,
  alignShift,
  cross,
  dot,
  frameData,
  frameSegments,
  layoutMembers,
  len,
  memberData,
  mul,
  norm,
  sectionCorners,
  sectionOf,
  sketchSegments,
  sub,
  SYMBOL_TYPES,
  beadData,
  type Align,
  type Cut,
  type MemberLayout,
  type Section,
} from "./weld-layout";
import type { Feature, Vec2, Vec3 } from "../types";
import { buildBead, buildGroove, buildPlug, buildSpot, symbolAnchor } from "./weld-kernel";
import { PREPS, PROCESSES } from "./weld-calc";

type Rep = typeof R;
let repP: Promise<Rep> | null = null;
const rep = () => (repP ??= import("replicad"));
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const vt = (v: { x: number; y: number; z: number }): Vec3 => [v.x, v.y, v.z];
const BIG = 100000;

type SketchF = Extract<Feature, { type: "sketch" }>;
function needSketch(ctx: ExtBuildCtx, id: unknown): SketchF {
  const sk = ctx.sketches.get(String(id ?? ""));
  if (!sk) throw new Error(tr("Vyberte skicu s úsečkami (musí být v historii před tímto prvkem)."));
  return sk;
}

/** Kolmý vektor k n. */
function perp(n: Vec3): Vec3 {
  const c = Math.abs(n[2]) < 0.9 ? cross(n, [0, 0, 1]) : cross(n, [1, 0, 0]);
  return norm(c);
}

/** Poloprostor: krychle na straně +normála od bodu. */
async function halfSpace(origin: Vec3, normal: Vec3): Promise<Shape> {
  const r = await rep();
  const n = norm(normal);
  const plane = new r.Plane(origin, perp(n), n);
  return r.drawRectangle(BIG, BIG).sketchOnPlane(plane).extrude(BIG / 2) as Shape;
}

function polyDrawing(r: Rep, pts: Vec2[]): R.Drawing {
  const clean: Vec2[] = [];
  for (const p of pts) {
    const q = clean[clean.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6) clean.push(p);
  }
  if (clean.length > 2 && Math.hypot(clean[0][0] - clean[clean.length - 1][0], clean[0][1] - clean[clean.length - 1][1]) < 1e-6) clean.pop();
  let pen = r.draw(clean[0]);
  for (const p of clean.slice(1)) pen = pen.lineTo(p);
  return pen.close();
}

/** 2D výkres průřezu (zarovnaný a natočený) v lokální rovině profilu. */
export async function profileDrawing(sec: Section, align: Align, angle: number): Promise<R.Drawing> {
  const r = await rep();
  let d: R.Drawing;
  if (sec.circle) {
    d = r.drawCircle(sec.circle.ro);
    if (sec.circle.ri > 0) d = d.cut(r.drawCircle(sec.circle.ri));
  } else {
    d = polyDrawing(r, sec.outer!);
    if (sec.inner) d = d.cut(polyDrawing(r, sec.inner));
  }
  const [sx, sy] = alignShift(sec.bbox, align);
  if (Math.abs(sx) > 1e-9 || Math.abs(sy) > 1e-9) d = d.translate(sx, sy);
  if (angle) d = d.rotate(angle, [0, 0]);
  return d;
}

/** Těleso jednoho profilu podle rozložení (prodloužení konců + řezy spojů). */
async function memberSolid(lay: MemberLayout, drawing: R.Drawing): Promise<Shape> {
  const r = await rep();
  const total = lay.L + lay.extA + lay.extB;
  if (total <= 1e-6) throw new Error(tr("Profil má po zkrácení nulovou délku."));
  const origin = sub(lay.seg.a, mul(lay.u, lay.extA));
  const plane = new r.Plane(origin, lay.X, lay.u);
  let solid = drawing.sketchOnPlane(plane).extrude(total) as Shape;
  for (const c of lay.cuts) solid = solid.intersect(await halfSpace(c.origin, c.normal)) as Shape;
  return solid;
}

function fuseAll(shapes: Shape[]): Shape {
  let acc = shapes[0];
  for (const s of shapes.slice(1)) acc = acc.fuse(s) as Shape;
  return acc;
}

async function combine(ctx: ExtBuildCtx, parts: Shape[], separate: boolean, mode: "new" | "add"): Promise<Shape> {
  const r = await rep();
  const result = separate ? (r.makeCompound(parts) as unknown as Shape) : fuseAll(parts);
  if (!ctx.body || mode === "new") return result;
  if (separate) return r.makeCompound([ctx.body, result]) as unknown as Shape;
  return ctx.body.fuse(result) as Shape;
}

const PROFILE_PARAMS = [
  { key: "family", label: tr("Profil"), kind: "enum" as const, options: [{ v: "shs", l: tr("Jäkl čtvercový") }, { v: "rhs", l: tr("Jäkl obdélníkový") }, { v: "chs", l: tr("Trubka") }, { v: "L", l: tr("Úhelník L") }, { v: "U", l: "UPN" }, { v: "IPE", l: "IPE" }, { v: "HEB", l: "HEB" }, { v: "flat", l: tr("Plochá") }, { v: "round", l: tr("Kulatina") }, { v: "square", l: tr("Čtyřhran") }] },
  { key: "w", label: tr("Šířka / rameno a"), kind: "number" as const, min: 1 },
  { key: "h", label: tr("Výška / rameno b"), kind: "number" as const, min: 1 },
  { key: "t", label: tr("Tloušťka stěny"), kind: "number" as const, min: 0.5, step: 0.5 },
  { key: "d", label: tr("Průměr D"), kind: "number" as const, min: 1 },
  { key: "size", label: tr("Velikost (UPN/IPE/HEB)"), kind: "text" as const },
];

// ---------------- Konstrukční profil ----------------

registerExt({
  ext: "weld.member",
  label: tr("Konstrukční profil"),
  icon: "weld-member",
  tone: "create",
  tab: "weld",
  group: "Konstrukce",
  big: true,
  order: 0,
  kbd: "Shift+W",
  hint: tr("profily (jäkl, trubka, L, U, IPE…) podél úseček skici, rohy pokos/tupý"),
  make: (doc) => {
    const last = [...doc.features].reverse().find((f) => f.type === "sketch");
    return { sketchId: last?.id ?? "", family: "shs", w: 40, h: 40, t: 3, d: 33.7, size: "100", align: "center", angle: 0, corner: "mitre", gap: 0, extStart: 0, extEnd: 0, separate: false, mode: "add" };
  },
  params: [
    { key: "sketchId", label: tr("Skica s úsečkami"), kind: "sketch" },
    ...PROFILE_PARAMS,
    { key: "align", label: tr("Zarovnání"), kind: "enum", options: [{ v: "center", l: tr("Střed") }, { v: "bl", l: tr("Vlevo dole") }, { v: "bc", l: tr("Dole") }, { v: "br", l: tr("Vpravo dole") }, { v: "cl", l: tr("Vlevo") }, { v: "cr", l: tr("Vpravo") }, { v: "tl", l: tr("Vlevo nahoře") }, { v: "tc", l: tr("Nahoře") }, { v: "tr", l: tr("Vpravo nahoře") }] },
    { key: "angle", label: tr("Natočení profilu"), kind: "number", unit: "°", step: 15 },
    { key: "corner", label: tr("Spoj v rohu"), kind: "enum", options: [{ v: "mitre", l: tr("Pokos") }, { v: "butt", l: tr("Tupý") }, { v: "none", l: tr("Žádný") }] },
    { key: "gap", label: tr("Mezera ve spoji"), kind: "number", min: 0, step: 0.5 },
    { key: "extStart", label: tr("Prodloužit začátek"), kind: "number", hint: tr("záporné = zkrátit") },
    { key: "extEnd", label: tr("Prodloužit konec"), kind: "number" },
    { key: "separate", label: tr("Jako samostatná tělesa"), kind: "bool" },
    { key: "mode", label: tr("Operace"), kind: "mode" },
  ],
  build: async (data, ctx) => {
    const d = memberData(data);
    const sk = needSketch(ctx, d.sketchId);
    const segs = sketchSegments(sk);
    if (!segs.length) throw new Error(tr("Skica neobsahuje žádné úsečky (oblouky se pro profily zatím nepoužijí)."));
    const sec = sectionOf(d);
    const corners = sectionCorners(sec, d.align, d.angle);
    const layouts = layoutMembers(segs, { mode: d.corner, gap: d.gap, extStart: d.extStart, extEnd: d.extEnd, corners });
    const drawing = await profileDrawing(sec, d.align, d.angle);
    const solids: Shape[] = [];
    for (const lay of layouts) solids.push(await memberSolid(lay, drawing));
    const result = await combine(ctx, solids, d.separate, d.mode);
    if (!d.separate) ctx.tools.set(ctx.featureId, { tool: fuseAll(solids.map((s) => s.clone() as Shape)), mode: "add" });
    return result;
  },
});

// ---------------- Rám z profilů ----------------

registerExt({
  ext: "weld.frame",
  label: tr("Rám z profilů"),
  icon: "weld-frame",
  tone: "create",
  tab: "weld",
  group: "Konstrukce",
  big: true,
  order: 1,
  hint: tr("kvádrový rám: dva obdélníky (pokos) + 4 sloupky"),
  make: () => ({ family: "shs", w: 40, h: 40, t: 3, d: 33.7, size: "100", width: 600, depth: 400, height: 800, corner: "mitre", mode: "add" }),
  params: [
    ...PROFILE_PARAMS,
    { key: "width", label: tr("Šířka rámu (X)"), kind: "number", min: 10 },
    { key: "depth", label: tr("Hloubka rámu (Y)"), kind: "number", min: 10 },
    { key: "height", label: tr("Výška rámu (Z)"), kind: "number", min: 10 },
    { key: "corner", label: tr("Rohy obdélníků"), kind: "enum", options: [{ v: "mitre", l: tr("Pokos") }, { v: "butt", l: tr("Tupý") }] },
    { key: "mode", label: tr("Operace"), kind: "mode" },
  ],
  build: async (data, ctx) => {
    const d = frameData(data);
    const { rect, posts, sec } = frameSegments(d);
    const corners = sectionCorners(sec, "center", 0);
    const drawing = await profileDrawing(sec, "center", 0);
    const lays = [
      ...layoutMembers(rect.slice(0, 4), { mode: d.corner, gap: 0, extStart: 0, extEnd: 0, corners }),
      ...layoutMembers(rect.slice(4), { mode: d.corner, gap: 0, extStart: 0, extEnd: 0, corners }),
      ...layoutMembers(posts, { mode: "none", gap: 0, extStart: 0, extEnd: 0, corners }),
    ];
    const solids: Shape[] = [];
    for (const lay of lays) solids.push(await memberSolid(lay, drawing));
    return combine(ctx, solids, false, d.mode);
  },
});

// ---------------- Deska ----------------

registerExt({
  ext: "weld.plate",
  label: tr("Deska"),
  icon: "weld-plate",
  tone: "create",
  tab: "weld",
  group: "Konstrukce",
  order: 2,
  hint: tr("obdélníková deska (patka, příložka) s volitelným polem děr"),
  make: () => ({ plane: "XY", offset: 0, cx: 0, cy: 0, w: 200, h: 150, t: 10, flip: false, nx: 0, ny: 0, hole: 13, margin: 25, mode: "add" }),
  params: [
    { key: "planeDef", label: tr("Rovina odkazem"), kind: "plane", hint: tr("plocha modelu, tři body, pomocná rovina… – má přednost před základní rovinou níže") },
    { key: "plane", label: tr("Rovina"), kind: "enum", options: [{ v: "XY", l: "XY" }, { v: "XZ", l: "XZ" }, { v: "YZ", l: "YZ" }] },
    { key: "offset", label: tr("Odsazení roviny"), kind: "number" },
    { key: "cx", label: tr("Střed X"), kind: "number" },
    { key: "cy", label: tr("Střed Y"), kind: "number" },
    { key: "w", label: tr("Šířka"), kind: "number", min: 1 },
    { key: "h", label: tr("Výška"), kind: "number", min: 1 },
    { key: "t", label: tr("Tloušťka"), kind: "number", min: 0.5 },
    { key: "flip", label: tr("Vysunout opačně"), kind: "bool" },
    { key: "nx", label: tr("Díry v řadě (X)"), kind: "number", min: 0, step: 1, unit: "ks" },
    { key: "ny", label: tr("Díry ve sloupci (Y)"), kind: "number", min: 0, step: 1, unit: "ks" },
    { key: "hole", label: tr("Průměr díry"), kind: "number", min: 0.5 },
    { key: "margin", label: tr("Odstup děr od okraje"), kind: "number", min: 0 },
    { key: "mode", label: tr("Operace"), kind: "mode" },
  ],
  build: async (data, ctx) => {
    const r = await rep();
    const w = num(data.w, 200);
    const h = num(data.h, 150);
    const t = num(data.t, 10);
    if (!(w > 0 && h > 0 && t > 0)) throw new Error(tr("Rozměry desky musí být kladné."));
    const plane = hasPlaneDef(data) ? extPlane(data, ctx) : r.makePlane(String(data.plane ?? "XY") as "XY" | "XZ" | "YZ", num(data.offset, 0));
    let d = r.drawRectangle(w, h).translate(num(data.cx, 0), num(data.cy, 0));
    const nx = Math.round(num(data.nx, 0));
    const ny = Math.round(num(data.ny, 0));
    const hole = num(data.hole, 13);
    const m = num(data.margin, 25);
    if (nx > 0 && ny > 0) {
      if (hole >= Math.min(w, h)) throw new Error(tr("Díra je větší než deska."));
      for (let i = 0; i < nx; i++)
        for (let j = 0; j < ny; j++) {
          const x = num(data.cx, 0) - w / 2 + (nx === 1 ? w / 2 : m + ((w - 2 * m) * i) / (nx - 1));
          const y = num(data.cy, 0) - h / 2 + (ny === 1 ? h / 2 : m + ((h - 2 * m) * j) / (ny - 1));
          d = d.cut(r.drawCircle(hole / 2).translate(x, y));
        }
    }
    const solid = d.sketchOnPlane(plane).extrude(data.flip ? -t : t) as Shape;
    const mode = data.mode === "cut" ? "cut" : data.mode === "new" ? "new" : "add";
    if (!ctx.body || mode === "new") return solid;
    return (mode === "cut" ? ctx.body.cut(solid) : ctx.body.fuse(solid)) as Shape;
  },
});

// ---------------- Ořezat rovinou ----------------

registerExt({
  ext: "weld.trim",
  label: tr("Ořezat rovinou"),
  icon: "weld-trim",
  tone: "cut",
  tab: "weld",
  group: "Spoje",
  order: 0,
  hint: tr("odřízne vše na jedné straně roviny (zkrácení profilů)"),
  make: () => ({ plane: "XY", offset: 0, keep: "+" }),
  params: [
    { key: "planeDef", label: tr("Rovina odkazem"), kind: "plane", hint: tr("plocha modelu, tři body, pomocná rovina… – má přednost před základní rovinou níže") },
    { key: "plane", label: tr("Rovina"), kind: "enum", options: [{ v: "XY", l: "XY" }, { v: "XZ", l: "XZ" }, { v: "YZ", l: "YZ" }] },
    { key: "offset", label: tr("Odsazení"), kind: "number" },
    { key: "keep", label: tr("Ponechat stranu"), kind: "enum", options: [{ v: "+", l: tr("+ (kladná)") }, { v: "-", l: tr("− (záporná)") }] },
  ],
  build: async (data, ctx) => {
    if (!ctx.body) throw new Error(tr("Není co ořezat – nejdřív vytvořte profily."));
    const byRef = hasPlaneDef(data) ? extPlane(data, ctx) : null;
    const axis: Vec3 = byRef ? [byRef.zDir.x, byRef.zDir.y, byRef.zDir.z] : data.plane === "YZ" ? [1, 0, 0] : data.plane === "XZ" ? [0, 1, 0] : [0, 0, 1];
    const sign = data.keep === "-" ? -1 : 1;
    const origin: Vec3 = byRef ? [byRef.origin.x, byRef.origin.y, byRef.origin.z] : mul(axis, num(data.offset, 0));
    const box = await halfSpace(origin, mul(axis, sign));
    const out = ctx.body.clone().intersect(box) as Shape;
    const r = await rep();
    if (r.measureVolume(out) < 1e-6) throw new Error(tr("Na zvolené straně roviny nezůstal žádný materiál."));
    return out;
  },
});

// ---------------- Víčko ----------------

registerExt({
  ext: "weld.endCap",
  label: tr("Víčko"),
  icon: "weld-cap",
  tone: "feature",
  tab: "weld",
  group: "Spoje",
  order: 1,
  big: true,
  hint: tr("destička na otevřený konec profilu (vyberte čelní plochy)"),
  pick: { kind: "faces", key: "faces" },
  rollback: true,
  make: (_doc, extra) => ({ faces: (extra?.faces as number[]) ?? [], t: 4, inset: 0, cornerR: 0, inside: false }),
  params: [
    { key: "faces", label: tr("Čelní plochy"), kind: "faces" },
    { key: "t", label: tr("Tloušťka víčka"), kind: "number", min: 0.5, step: 0.5 },
    { key: "inset", label: tr("Zmenšení od obrysu"), kind: "number", min: 0, step: 0.5 },
    { key: "cornerR", label: tr("Zaoblení rohů"), kind: "number", min: 0, step: 0.5 },
    { key: "inside", label: tr("Zapustit dovnitř profilu"), kind: "bool", hint: tr("víčko lícuje s koncem") },
  ],
  build: async (data, ctx) => {
    const r = await rep();
    if (!ctx.body) throw new Error(tr("Není těleso – nejdřív vytvořte profily."));
    const faces = Array.isArray(data.faces) ? (data.faces as number[]) : [];
    if (!faces.length) throw new Error(tr("Vyberte čelní plochu profilu v modelu."));
    const t = num(data.t, 4);
    const inset = Math.max(0, num(data.inset, 0));
    const cr = Math.max(0, num(data.cornerR, 0));
    if (!(t > 0)) throw new Error(tr("Tloušťka víčka musí být kladná."));
    const caps: Shape[] = [];
    for (const i of faces) {
      const f = ctx.body.faces[i];
      if (!f) throw new Error(tr("Plocha {0} v tělese neexistuje – vyberte ji znovu.", i + 1));
      if (f.geomType !== "PLANE") throw new Error(tr("Víčko lze udělat jen na rovinné čelní ploše."));
      const n = norm(vt(f.normalAt(f.center)));
      let w = f.outerWire();
      try {
        if (inset + cr > 0) w = w.offset2D(-(inset + cr), "arc");
        if (cr > 0) w = w.offset2D(cr, "arc");
      } catch {
        throw new Error(tr("Obrys plochy nelze zmenšit o zadané hodnoty – zvolte menší zmenšení/zaoblení."));
      }
      const face = r.makeFace(w);
      const dir = data.inside ? -t : t;
      caps.push(r.basicFaceExtrusion(face, new r.Vector([n[0] * dir, n[1] * dir, n[2] * dir])) as unknown as Shape);
    }
    return ctx.body.fuse(fuseAll(caps)) as Shape;
  },
});

// ---------------- Styčník ----------------

function solve3(rows: Vec3[], rhs: Vec3): Vec3 {
  const [a, b, c] = rows;
  const det = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  if (Math.abs(det) < 1e-12) throw new Error(tr("Plochy styčníku jsou rovnoběžné – vyberte dvě plochy svírající úhel."));
  const D = (m: Vec3[]) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const rep = (k: number): Vec3[] => rows.map((row, i) => row.map((v, j) => (j === k ? rhs[i] : v)) as Vec3);
  return [D(rep(0)) / det, D(rep(1)) / det, D(rep(2)) / det];
}

registerExt({
  ext: "weld.gusset",
  label: tr("Styčník"),
  icon: "weld-gusset",
  tone: "feature",
  tab: "weld",
  group: "Spoje",
  order: 2,
  big: true,
  hint: tr("trojúhelníková výztuha v rohu dvou profilů (vyberte 2 vnitřní plochy)"),
  pick: { kind: "faces", key: "faces" },
  rollback: true,
  make: (_doc, extra) => ({ faces: (extra?.faces as number[]) ?? [], d1: 80, d2: 80, t: 6, chamfer: 10 }),
  params: [
    { key: "faces", label: tr("Dvě vnitřní plochy rohu"), kind: "faces" },
    { key: "d1", label: tr("Rameno 1"), kind: "number", min: 1 },
    { key: "d2", label: tr("Rameno 2"), kind: "number", min: 1 },
    { key: "t", label: tr("Tloušťka"), kind: "number", min: 0.5, step: 0.5 },
    { key: "chamfer", label: tr("Sražení špiček"), kind: "number", min: 0 },
  ],
  build: async (data, ctx) => {
    const r = await rep();
    if (!ctx.body) throw new Error(tr("Není těleso – nejdřív vytvořte profily."));
    const faces = Array.isArray(data.faces) ? (data.faces as number[]) : [];
    if (faces.length !== 2) throw new Error(tr("Vyberte přesně dvě rovinné plochy, které svírají roh."));
    const [f1, f2] = faces.map((i) => {
      const f = ctx.body!.faces[i];
      if (!f) throw new Error(tr("Plocha {0} v tělese neexistuje – vyberte ji znovu.", i + 1));
      if (f.geomType !== "PLANE") throw new Error(tr("Styčník lze vložit jen mezi rovinné plochy."));
      return f;
    });
    const d1 = num(data.d1, 80);
    const d2 = num(data.d2, 80);
    const t = num(data.t, 6);
    const ch = Math.max(0, num(data.chamfer, 0));
    if (!(d1 > 0 && d2 > 0 && t > 0)) throw new Error(tr("Rozměry styčníku musí být kladné."));
    const c1 = vt(f1.center);
    const c2 = vt(f2.center);
    const n1 = norm(vt(f1.normalAt(f1.center)));
    const n2 = norm(vt(f2.normalAt(f2.center)));
    const e = cross(n1, n2);
    if (len(e) < 1e-6) throw new Error(tr("Plochy styčníku jsou rovnoběžné – vyberte dvě plochy svírající úhel."));
    const ev = norm(e);
    const C = solve3([n1, n2, ev], [dot(n1, c1), dot(n2, c2), dot(ev, c1)]);
    let t1 = norm(cross(ev, n1));
    if (dot(t1, sub(c1, C)) < 0) t1 = mul(t1, -1);
    let t2 = norm(cross(ev, n2));
    if (dot(t2, sub(c2, C)) < 0) t2 = mul(t2, -1);
    const yDir = cross(ev, t1);
    const to2 = (p: Vec3): Vec2 => [dot(sub(p, C), t1), dot(sub(p, C), yDir)];
    const A = add(C, mul(t1, d1));
    const B = add(C, mul(t2, d2));
    const pts: Vec3[] = [];
    const ab = norm(sub(B, A));
    const hyp = len(sub(B, A));
    const c = Math.min(ch, d1 * 0.45, d2 * 0.45, hyp * 0.45);
    pts.push(C);
    if (c > 0) pts.push(add(C, mul(t1, d1 - c)), add(A, mul(ab, c)), sub(B, mul(ab, c)), add(C, mul(t2, d2 - c)));
    else pts.push(A, B);
    const plane = new r.Plane(sub(C, mul(ev, t / 2)), t1, ev);
    const drawing = polyDrawing(r, pts.map(to2));
    const plate = drawing.sketchOnPlane(plane).extrude(t) as Shape;
    return ctx.body.fuse(plate) as Shape;
  },
});

// ---------------- Svarová housenka (koutový svar) ----------------

const PROCESS_OPTIONS = PROCESSES.map((p) => ({ v: p.v, l: p.l }));

registerExt({
  ext: "weld.bead",
  label: tr("Svarová housenka"),
  icon: "weld-bead",
  tone: "feature",
  tab: "weld",
  group: "Svary",
  order: 0,
  big: true,
  hint: tr("koutový svar a (z = a·√2) do koutu dvou ploch nebo dvou dílů; oboustranný, kolem, přerušovaný"),
  pick: { kind: "edges", key: "edges" },
  rollback: true,
  make: (_doc, extra) => ({ edges: (extra?.edges as number[]) ?? [], edgeAt: [], a: 4, measure: "a", intermittent: false, segLen: 50, pitch: 100, both: false, allAround: false, separate: true, field: false, process: "135", edgeLens: [] }),
  params: [
    { key: "edges", label: tr("Hrany koutu"), kind: "edges" },
    { key: "a", label: tr("Velikost svaru"), kind: "number", min: 0.5, step: 0.5 },
    { key: "measure", label: tr("Velikost je"), kind: "enum", options: [{ v: "a", l: tr("a – účinná tloušťka") }, { v: "z", l: tr("z – rameno") }] },
    { key: "both", label: tr("Oboustranný"), kind: "bool", hint: tr("i na druhé straně stěny") },
    { key: "allAround", label: tr("Kolem"), kind: "bool", hint: tr("po celé uzavřené smyčce koutu") },
    { key: "intermittent", label: tr("Přerušovaný svar"), kind: "bool" },
    { key: "segLen", label: tr("Délka úseku"), kind: "number", min: 1 },
    { key: "pitch", label: tr("Rozteč úseků"), kind: "number", min: 1 },
    { key: "separate", label: tr("Svarový kov jako těleso"), kind: "bool", hint: tr("vlastní těleso „Svar k“ (jinak se sloučí s dílem)") },
    { key: "field", label: tr("Montážní svar"), kind: "bool" },
    { key: "process", label: tr("Metoda (ISO 4063)"), kind: "enum", options: PROCESS_OPTIONS },
    { key: "eff", label: tr("Účinnost navaření"), kind: "number", min: 0, max: 1, step: 0.05, hint: tr("0 = podle metody (135: 0,9)") },
  ],
  build: (data, ctx) => buildBead(data, ctx, beadData(data)),
});

// ---------------- Tupý svar s úpravou ----------------

registerExt({
  ext: "weld.groove",
  label: tr("Tupý svar"),
  icon: "weld-groove",
  tone: "feature",
  tab: "weld",
  group: "Svary",
  order: 1,
  big: true,
  hint: tr("úprava I, V, Y, X, U, ½V, K, J (ISO 9692-1) vyříznutá do dílů + svarový kov jako těleso; tupý, T i rohový spoj"),
  pick: { kind: "faces", key: "faces" },
  rollback: true,
  make: (_doc, extra) => ({ faces: (extra?.faces as number[]) ?? [], edges: (extra?.edges as number[]) ?? [], faceAt: [], edgeAt: [], prep: "V", cap: 1.5, root: 0, backing: false, flip: false, t: 0, field: false, process: "135" }),
  params: [
    { key: "faces", label: tr("Čelo spoje (plocha)"), kind: "faces" },
    { key: "edges", label: tr("nebo hrana spáry"), kind: "edges" },
    { key: "prep", label: tr("Úprava (ISO 9692-1)"), kind: "enum", options: PREPS.map((p) => ({ v: p.v, l: p.l })) },
    { key: "angle", label: tr("Úhel α / β"), kind: "number", unit: "°", min: 0, max: 150, hint: tr("V, Y, X: celkový úhel rozevření α; ½V, K, U, J: úhel úkosu / boku β") },
    { key: "rootFace", label: tr("Otupení c"), kind: "number", min: 0, step: 0.5 },
    { key: "gap", label: tr("Mezera b"), kind: "number", min: 0, step: 0.5 },
    { key: "radius", label: tr("Poloměr dna R (U, J)"), kind: "number", min: 0, step: 0.5 },
    { key: "cap", label: tr("Převýšení housenky"), kind: "number", min: 0, step: 0.5 },
    { key: "root", label: tr("Převýšení kořene"), kind: "number", min: 0, step: 0.5 },
    { key: "backing", label: tr("Podložka"), kind: "bool" },
    { key: "t", label: tr("Tloušťka t (0 = z modelu)"), kind: "number", min: 0 },
    { key: "flip", label: tr("Obrátit stranu svaru"), kind: "bool" },
    { key: "field", label: tr("Montážní svar"), kind: "bool" },
    { key: "process", label: tr("Metoda (ISO 4063)"), kind: "enum", options: PROCESS_OPTIONS },
    { key: "eff", label: tr("Účinnost navaření"), kind: "number", min: 0, max: 1, step: 0.05, hint: tr("0 = podle metody (135: 0,9)") },
  ],
  build: (data, ctx) => buildGroove(data, ctx),
});

// ---------------- Děrový / žlábkový svar ----------------

registerExt({
  ext: "weld.plug",
  label: tr("Děrový svar"),
  icon: "weld-plug",
  tone: "feature",
  tab: "weld",
  group: "Svary",
  order: 2,
  hint: tr("otvory Ø d (žlábky l × d) v horním plechu vyplněné svarem – přeplátovaný spoj"),
  pick: { kind: "faces", key: "faces" },
  rollback: true,
  make: (_doc, extra) => ({ faces: (extra?.faces as number[]) ?? [], faceAt: [], d: 12, slot: 0, n: 2, pitch: 60, axis: "long", shift: 0, t: 0, cap: 0, field: false, process: "135" }),
  params: [
    { key: "faces", label: tr("Horní plocha horního plechu"), kind: "faces" },
    { key: "d", label: tr("Průměr / šířka otvoru d"), kind: "number", min: 1 },
    { key: "slot", label: tr("Délka žlábku l (0 = kruhový otvor)"), kind: "number", min: 0 },
    { key: "n", label: tr("Počet"), kind: "number", min: 1, step: 1, unit: "ks" },
    { key: "pitch", label: tr("Rozteč e"), kind: "number", min: 1 },
    { key: "axis", label: tr("Řada podél"), kind: "enum", options: [{ v: "long", l: tr("delší strany plochy") }, { v: "short", l: tr("kratší strany plochy") }] },
    { key: "shift", label: tr("Posun řady"), kind: "number" },
    { key: "t", label: tr("Tloušťka horního plechu (0 = z modelu)"), kind: "number", min: 0 },
    { key: "cap", label: tr("Převýšení (kruhový otvor)"), kind: "number", min: 0, step: 0.5 },
    { key: "field", label: tr("Montážní svar"), kind: "bool" },
    { key: "process", label: tr("Metoda (ISO 4063)"), kind: "enum", options: PROCESS_OPTIONS },
  ],
  build: (data, ctx) => buildPlug(data, ctx),
});

// ---------------- Bodový svar ----------------

registerExt({
  ext: "weld.spot",
  label: tr("Bodový svar"),
  icon: "weld-spot",
  tone: "feature",
  tab: "weld",
  group: "Svary",
  order: 3,
  hint: tr("značky bodových svarů Ø d s roztečí e na ploše přeplátování (bez přídavného materiálu)"),
  pick: { kind: "faces", key: "faces" },
  rollback: true,
  make: (_doc, extra) => ({ faces: (extra?.faces as number[]) ?? [], faceAt: [], d: 6, n: 5, pitch: 40, axis: "long", shift: 0, field: false, process: "21" }),
  params: [
    { key: "faces", label: tr("Plocha horního plechu"), kind: "faces" },
    { key: "d", label: tr("Průměr bodu d"), kind: "number", min: 1 },
    { key: "n", label: tr("Počet bodů"), kind: "number", min: 1, step: 1, unit: "ks" },
    { key: "pitch", label: tr("Rozteč e"), kind: "number", min: 1 },
    { key: "axis", label: tr("Řada podél"), kind: "enum", options: [{ v: "long", l: tr("delší strany plochy") }, { v: "short", l: tr("kratší strany plochy") }] },
    { key: "shift", label: tr("Posun řady"), kind: "number" },
    { key: "field", label: tr("Montážní svar"), kind: "bool" },
    { key: "process", label: tr("Metoda (ISO 4063)"), kind: "enum", options: PROCESS_OPTIONS },
  ],
  build: (data, ctx) => buildSpot(data, ctx),
});

// ---------------- Značka svaru ----------------

registerExt({
  ext: "weld.symbol",
  label: tr("Značka svaru"),
  icon: "weld-symbol",
  tone: "ref",
  tab: "weld",
  group: "Svary",
  order: 4,
  hint: tr("ISO 2553 – ruční značka (bez geometrie); s hranou ukáže šipkou na výkrese, jinak v seznamu značek"),
  pick: { kind: "edges", key: "edges" },
  rollback: true,
  make: (_doc, extra) => ({ kind: "fillet", size: 4, length: 0, pitch: 0, allAround: false, field: false, otherSide: false, both: false, process: "", note: "", edges: (extra?.edges as number[]) ?? [] }),
  params: [
    { key: "kind", label: tr("Typ svaru"), kind: "enum", options: SYMBOL_TYPES },
    { key: "size", label: tr("Velikost a / s"), kind: "number", min: 0, step: 0.5 },
    { key: "length", label: tr("Délka svaru"), kind: "number", min: 0, hint: tr("0 = po celé délce") },
    { key: "pitch", label: tr("Rozteč (přerušovaný)"), kind: "number", min: 0 },
    { key: "allAround", label: tr("Svar po obvodu"), kind: "bool" },
    { key: "field", label: tr("Montážní svar"), kind: "bool" },
    { key: "otherSide", label: tr("Svar na druhé straně"), kind: "bool" },
    { key: "both", label: tr("Oboustranný"), kind: "bool" },
    { key: "process", label: tr("Metoda (ISO 4063)"), kind: "text" },
    { key: "note", label: tr("Poznámka"), kind: "text" },
    { key: "edges", label: tr("Hrana spoje (šipka na výkrese)"), kind: "edges" },
  ],
  build: async (d, ctx) => {
    await symbolAnchor(d, ctx);
    return ctx.body;
  },
});

// ---------------- Výstupy (akce v UI) ----------------

registerExt({ ext: "weld.cutList", label: tr("Kusovník řezů"), icon: "weld-list", tone: "file", tab: "weld", group: "Výstupy", order: 0, big: true, hint: tr("délky a úhly řezů profilů, hmotnosti, CSV"), make: () => ({}), action: true, scope: "both" });
registerExt({ ext: "weld.weldTable", label: tr("Tabulka svarů"), icon: "weld-table", tone: "file", tab: "weld", group: "Výstupy", order: 1, hint: tr("délky svarů a svarový kov"), make: () => ({}), action: true, scope: "both" });

export { sectionOf, layoutMembers, sketchSegments, type Cut };
