/**
 * Svařence (modul rozšíření): konstrukční profily podél úseček skici (pokos / tupý spoj / bez úpravy),
 * rám z profilů, ořez rovinou, víčka, styčníky, svarové housenky, desky, značky svarů ISO 2553
 * a akce Kusovník řezů / Tabulka svarů (UI). Geometrie: OpenCascade přes replicad (líně načtené).
 */
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

type Rep = typeof R;
let repP: Promise<Rep> | null = null;
const rep = () => (repP ??= import("replicad"));
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const vt = (v: { x: number; y: number; z: number }): Vec3 => [v.x, v.y, v.z];
const BIG = 100000;

type SketchF = Extract<Feature, { type: "sketch" }>;
function needSketch(ctx: ExtBuildCtx, id: unknown): SketchF {
  const sk = ctx.sketches.get(String(id ?? ""));
  if (!sk) throw new Error("Vyberte skicu s úsečkami (musí být v historii před tímto prvkem).");
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
  if (total <= 1e-6) throw new Error("Profil má po zkrácení nulovou délku.");
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
  { key: "family", label: "Profil", kind: "enum" as const, options: [{ v: "shs", l: "Jäkl čtvercový" }, { v: "rhs", l: "Jäkl obdélníkový" }, { v: "chs", l: "Trubka" }, { v: "L", l: "Úhelník L" }, { v: "U", l: "UPN" }, { v: "IPE", l: "IPE" }, { v: "HEB", l: "HEB" }, { v: "flat", l: "Plochá" }, { v: "round", l: "Kulatina" }, { v: "square", l: "Čtyřhran" }] },
  { key: "w", label: "Šířka / rameno a", kind: "number" as const, min: 1 },
  { key: "h", label: "Výška / rameno b", kind: "number" as const, min: 1 },
  { key: "t", label: "Tloušťka stěny", kind: "number" as const, min: 0.5, step: 0.5 },
  { key: "d", label: "Průměr D", kind: "number" as const, min: 1 },
  { key: "size", label: "Velikost (UPN/IPE/HEB)", kind: "text" as const },
];

// ---------------- Konstrukční profil ----------------

registerExt({
  ext: "weld.member",
  label: "Konstrukční profil",
  icon: "weld-member",
  tone: "create",
  tab: "weld",
  group: "Konstrukce",
  big: true,
  order: 0,
  kbd: "Shift+W",
  hint: "profily (jäkl, trubka, L, U, IPE…) podél úseček skici, rohy pokos/tupý",
  make: (doc) => {
    const last = [...doc.features].reverse().find((f) => f.type === "sketch");
    return { sketchId: last?.id ?? "", family: "shs", w: 40, h: 40, t: 3, d: 33.7, size: "100", align: "center", angle: 0, corner: "mitre", gap: 0, extStart: 0, extEnd: 0, separate: false, mode: "add" };
  },
  params: [
    { key: "sketchId", label: "Skica s úsečkami", kind: "sketch" },
    ...PROFILE_PARAMS,
    { key: "align", label: "Zarovnání", kind: "enum", options: [{ v: "center", l: "Střed" }, { v: "bl", l: "Vlevo dole" }, { v: "bc", l: "Dole" }, { v: "br", l: "Vpravo dole" }, { v: "cl", l: "Vlevo" }, { v: "cr", l: "Vpravo" }, { v: "tl", l: "Vlevo nahoře" }, { v: "tc", l: "Nahoře" }, { v: "tr", l: "Vpravo nahoře" }] },
    { key: "angle", label: "Natočení profilu", kind: "number", unit: "°", step: 15 },
    { key: "corner", label: "Spoj v rohu", kind: "enum", options: [{ v: "mitre", l: "Pokos" }, { v: "butt", l: "Tupý" }, { v: "none", l: "Žádný" }] },
    { key: "gap", label: "Mezera ve spoji", kind: "number", min: 0, step: 0.5 },
    { key: "extStart", label: "Prodloužit začátek", kind: "number", hint: "záporné = zkrátit" },
    { key: "extEnd", label: "Prodloužit konec", kind: "number" },
    { key: "separate", label: "Jako samostatná tělesa", kind: "bool" },
    { key: "mode", label: "Operace", kind: "mode" },
  ],
  build: async (data, ctx) => {
    const d = memberData(data);
    const sk = needSketch(ctx, d.sketchId);
    const segs = sketchSegments(sk);
    if (!segs.length) throw new Error("Skica neobsahuje žádné úsečky (oblouky se pro profily zatím nepoužijí).");
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
  label: "Rám z profilů",
  icon: "weld-frame",
  tone: "create",
  tab: "weld",
  group: "Konstrukce",
  big: true,
  order: 1,
  hint: "kvádrový rám: dva obdélníky (pokos) + 4 sloupky",
  make: () => ({ family: "shs", w: 40, h: 40, t: 3, d: 33.7, size: "100", width: 600, depth: 400, height: 800, corner: "mitre", mode: "add" }),
  params: [
    ...PROFILE_PARAMS,
    { key: "width", label: "Šířka rámu (X)", kind: "number", min: 10 },
    { key: "depth", label: "Hloubka rámu (Y)", kind: "number", min: 10 },
    { key: "height", label: "Výška rámu (Z)", kind: "number", min: 10 },
    { key: "corner", label: "Rohy obdélníků", kind: "enum", options: [{ v: "mitre", l: "Pokos" }, { v: "butt", l: "Tupý" }] },
    { key: "mode", label: "Operace", kind: "mode" },
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
  label: "Deska",
  icon: "weld-plate",
  tone: "create",
  tab: "weld",
  group: "Konstrukce",
  order: 2,
  hint: "obdélníková deska (patka, příložka) s volitelným polem děr",
  make: () => ({ plane: "XY", offset: 0, cx: 0, cy: 0, w: 200, h: 150, t: 10, flip: false, nx: 0, ny: 0, hole: 13, margin: 25, mode: "add" }),
  params: [
    { key: "plane", label: "Rovina", kind: "enum", options: [{ v: "XY", l: "XY" }, { v: "XZ", l: "XZ" }, { v: "YZ", l: "YZ" }] },
    { key: "offset", label: "Odsazení roviny", kind: "number" },
    { key: "cx", label: "Střed X", kind: "number" },
    { key: "cy", label: "Střed Y", kind: "number" },
    { key: "w", label: "Šířka", kind: "number", min: 1 },
    { key: "h", label: "Výška", kind: "number", min: 1 },
    { key: "t", label: "Tloušťka", kind: "number", min: 0.5 },
    { key: "flip", label: "Vysunout opačně", kind: "bool" },
    { key: "nx", label: "Díry v řadě (X)", kind: "number", min: 0, step: 1, unit: "ks" },
    { key: "ny", label: "Díry ve sloupci (Y)", kind: "number", min: 0, step: 1, unit: "ks" },
    { key: "hole", label: "Průměr díry", kind: "number", min: 0.5 },
    { key: "margin", label: "Odstup děr od okraje", kind: "number", min: 0 },
    { key: "mode", label: "Operace", kind: "mode" },
  ],
  build: async (data, ctx) => {
    const r = await rep();
    const w = num(data.w, 200);
    const h = num(data.h, 150);
    const t = num(data.t, 10);
    if (!(w > 0 && h > 0 && t > 0)) throw new Error("Rozměry desky musí být kladné.");
    const plane = r.makePlane(String(data.plane ?? "XY") as "XY" | "XZ" | "YZ", num(data.offset, 0));
    let d = r.drawRectangle(w, h).translate(num(data.cx, 0), num(data.cy, 0));
    const nx = Math.round(num(data.nx, 0));
    const ny = Math.round(num(data.ny, 0));
    const hole = num(data.hole, 13);
    const m = num(data.margin, 25);
    if (nx > 0 && ny > 0) {
      if (hole >= Math.min(w, h)) throw new Error("Díra je větší než deska.");
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
  label: "Ořezat rovinou",
  icon: "weld-trim",
  tone: "cut",
  tab: "weld",
  group: "Spoje",
  order: 0,
  hint: "odřízne vše na jedné straně roviny (zkrácení profilů)",
  make: () => ({ plane: "XY", offset: 0, keep: "+" }),
  params: [
    { key: "plane", label: "Rovina", kind: "enum", options: [{ v: "XY", l: "XY" }, { v: "XZ", l: "XZ" }, { v: "YZ", l: "YZ" }] },
    { key: "offset", label: "Odsazení", kind: "number" },
    { key: "keep", label: "Ponechat stranu", kind: "enum", options: [{ v: "+", l: "+ (kladná)" }, { v: "-", l: "− (záporná)" }] },
  ],
  build: async (data, ctx) => {
    if (!ctx.body) throw new Error("Není co ořezat – nejdřív vytvořte profily.");
    const axis: Vec3 = data.plane === "YZ" ? [1, 0, 0] : data.plane === "XZ" ? [0, 1, 0] : [0, 0, 1];
    const sign = data.keep === "-" ? -1 : 1;
    const origin = mul(axis, num(data.offset, 0));
    const box = await halfSpace(origin, mul(axis, sign));
    const out = ctx.body.clone().intersect(box) as Shape;
    const r = await rep();
    if (r.measureVolume(out) < 1e-6) throw new Error("Na zvolené straně roviny nezůstal žádný materiál.");
    return out;
  },
});

// ---------------- Víčko ----------------

registerExt({
  ext: "weld.endCap",
  label: "Víčko",
  icon: "weld-cap",
  tone: "feature",
  tab: "weld",
  group: "Spoje",
  order: 1,
  big: true,
  hint: "destička na otevřený konec profilu (vyberte čelní plochy)",
  pick: { kind: "faces", key: "faces" },
  rollback: true,
  make: (_doc, extra) => ({ faces: (extra?.faces as number[]) ?? [], t: 4, inset: 0, cornerR: 0, inside: false }),
  params: [
    { key: "faces", label: "Čelní plochy", kind: "faces" },
    { key: "t", label: "Tloušťka víčka", kind: "number", min: 0.5, step: 0.5 },
    { key: "inset", label: "Zmenšení od obrysu", kind: "number", min: 0, step: 0.5 },
    { key: "cornerR", label: "Zaoblení rohů", kind: "number", min: 0, step: 0.5 },
    { key: "inside", label: "Zapustit dovnitř profilu", kind: "bool", hint: "víčko lícuje s koncem" },
  ],
  build: async (data, ctx) => {
    const r = await rep();
    if (!ctx.body) throw new Error("Není těleso – nejdřív vytvořte profily.");
    const faces = Array.isArray(data.faces) ? (data.faces as number[]) : [];
    if (!faces.length) throw new Error("Vyberte čelní plochu profilu v modelu.");
    const t = num(data.t, 4);
    const inset = Math.max(0, num(data.inset, 0));
    const cr = Math.max(0, num(data.cornerR, 0));
    if (!(t > 0)) throw new Error("Tloušťka víčka musí být kladná.");
    const caps: Shape[] = [];
    for (const i of faces) {
      const f = ctx.body.faces[i];
      if (!f) throw new Error(`Plocha ${i + 1} v tělese neexistuje – vyberte ji znovu.`);
      if (f.geomType !== "PLANE") throw new Error("Víčko lze udělat jen na rovinné čelní ploše.");
      const n = norm(vt(f.normalAt(f.center)));
      let w = f.outerWire();
      try {
        if (inset + cr > 0) w = w.offset2D(-(inset + cr), "arc");
        if (cr > 0) w = w.offset2D(cr, "arc");
      } catch {
        throw new Error("Obrys plochy nelze zmenšit o zadané hodnoty – zvolte menší zmenšení/zaoblení.");
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
  if (Math.abs(det) < 1e-12) throw new Error("Plochy styčníku jsou rovnoběžné – vyberte dvě plochy svírající úhel.");
  const col = (k: number): Vec3 => [k === 0 ? rhs[0] : a[k - 1 + (k === 0 ? 0 : 0)] , 0, 0];
  void col;
  const D = (m: Vec3[]) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const rep = (k: number): Vec3[] => rows.map((row, i) => row.map((v, j) => (j === k ? rhs[i] : v)) as Vec3);
  return [D(rep(0)) / det, D(rep(1)) / det, D(rep(2)) / det];
}

registerExt({
  ext: "weld.gusset",
  label: "Styčník",
  icon: "weld-gusset",
  tone: "feature",
  tab: "weld",
  group: "Spoje",
  order: 2,
  big: true,
  hint: "trojúhelníková výztuha v rohu dvou profilů (vyberte 2 vnitřní plochy)",
  pick: { kind: "faces", key: "faces" },
  rollback: true,
  make: (_doc, extra) => ({ faces: (extra?.faces as number[]) ?? [], d1: 80, d2: 80, t: 6, chamfer: 10 }),
  params: [
    { key: "faces", label: "Dvě vnitřní plochy rohu", kind: "faces" },
    { key: "d1", label: "Rameno 1", kind: "number", min: 1 },
    { key: "d2", label: "Rameno 2", kind: "number", min: 1 },
    { key: "t", label: "Tloušťka", kind: "number", min: 0.5, step: 0.5 },
    { key: "chamfer", label: "Sražení špiček", kind: "number", min: 0 },
  ],
  build: async (data, ctx) => {
    const r = await rep();
    if (!ctx.body) throw new Error("Není těleso – nejdřív vytvořte profily.");
    const faces = Array.isArray(data.faces) ? (data.faces as number[]) : [];
    if (faces.length !== 2) throw new Error("Vyberte přesně dvě rovinné plochy, které svírají roh.");
    const [f1, f2] = faces.map((i) => {
      const f = ctx.body!.faces[i];
      if (!f) throw new Error(`Plocha ${i + 1} v tělese neexistuje – vyberte ji znovu.`);
      if (f.geomType !== "PLANE") throw new Error("Styčník lze vložit jen mezi rovinné plochy.");
      return f;
    });
    const d1 = num(data.d1, 80);
    const d2 = num(data.d2, 80);
    const t = num(data.t, 6);
    const ch = Math.max(0, num(data.chamfer, 0));
    if (!(d1 > 0 && d2 > 0 && t > 0)) throw new Error("Rozměry styčníku musí být kladné.");
    const c1 = vt(f1.center);
    const c2 = vt(f2.center);
    const n1 = norm(vt(f1.normalAt(f1.center)));
    const n2 = norm(vt(f2.normalAt(f2.center)));
    const e = cross(n1, n2);
    if (len(e) < 1e-6) throw new Error("Plochy styčníku jsou rovnoběžné – vyberte dvě plochy svírající úhel.");
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

// ---------------- Svarová housenka ----------------

registerExt({
  ext: "weld.bead",
  label: "Svarová housenka",
  icon: "weld-bead",
  tone: "feature",
  tab: "weld",
  group: "Svary",
  order: 0,
  big: true,
  hint: "koutový svar a×a podél vnitřní hrany (vyberte hrany)",
  pick: { kind: "edges", key: "edges" },
  rollback: true,
  make: (_doc, extra) => ({ edges: (extra?.edges as number[]) ?? [], a: 4, intermittent: false, segLen: 50, pitch: 100, edgeLens: [] }),
  params: [
    { key: "edges", label: "Hrany koutu", kind: "edges" },
    { key: "a", label: "Velikost svaru a", kind: "number", min: 0.5, step: 0.5 },
    { key: "intermittent", label: "Přerušovaný svar", kind: "bool" },
    { key: "segLen", label: "Délka úseku", kind: "number", min: 1 },
    { key: "pitch", label: "Rozteč úseků", kind: "number", min: 1 },
  ],
  build: async (data, ctx) => {
    const r = await rep();
    if (!ctx.body) throw new Error("Není těleso – nejdřív vytvořte profily.");
    const b = beadData(data);
    if (!b.edges.length) throw new Error("Vyberte hranu vnitřního rohu v modelu.");
    if (!(b.a > 0)) throw new Error("Velikost svaru musí být kladná.");
    const beads: Shape[] = [];
    for (const idx of b.edges) {
      const edge = ctx.body.edges[idx];
      if (!edge) throw new Error(`Hrana ${idx + 1} v tělese neexistuje – vyberte ji znovu.`);
      if (edge.geomType !== "LINE") throw new Error("Housenku lze zatím vést jen po rovné hraně.");
      const E = vt(edge.startPoint);
      const F = vt(edge.endPoint);
      const L = len(sub(F, E));
      const e = norm(sub(F, E));
      const mid = add(E, mul(e, L / 2));
      const adj = ctx.body.faces.filter((f) => f.edges.some((x) => x.isSame(edge)));
      if (adj.length !== 2) throw new Error("Hrana musí ležet mezi dvěma plochami tělesa.");
      const dirs = adj.map((f) => {
        const n = norm(vt(f.normalAt(mid)));
        let tdir = norm(cross(e, n));
        if (dot(tdir, sub(vt(f.center), mid)) < 0) tdir = mul(tdir, -1);
        return { n, t: tdir };
      });
      const [A, B] = dirs;
      if (dot(A.t, B.n) <= 1e-6 || dot(B.t, A.n) <= 1e-6) throw new Error("Hrana není vnitřní (konkávní) – housenka se dělá jen do vnitřního rohu mezi dvěma plochami.");
      const yDir = cross(e, A.t);
      const p2: Vec2 = [b.a * dot(B.t, A.t), b.a * dot(B.t, yDir)];
      const drawing = polyDrawing(r, [[0, 0], [b.a, 0], p2]);
      const spans: [number, number][] = [];
      if (b.intermittent && b.pitch > 0) for (let s = 0; s < L - 1e-6; s += b.pitch) spans.push([s, Math.min(b.segLen, L - s)]);
      else spans.push([0, L]);
      for (const [s, l] of spans) {
        const plane = new r.Plane(add(E, mul(e, s)), A.t, e);
        beads.push(drawing.sketchOnPlane(plane).extrude(l) as Shape);
      }
    }
    return ctx.body.fuse(fuseAll(beads)) as Shape;
  },
});

// ---------------- Značka svaru ----------------

registerExt({
  ext: "weld.symbol",
  label: "Značka svaru",
  icon: "weld-symbol",
  tone: "ref",
  tab: "weld",
  group: "Svary",
  order: 1,
  hint: "ISO 2553 – uloží se k dílu, zobrazí se v tabulce svarů a na výkresu",
  make: () => ({ kind: "fillet", size: 4, length: 0, pitch: 0, allAround: false, field: false, otherSide: false, note: "" }),
  params: [
    { key: "kind", label: "Typ svaru", kind: "enum", options: SYMBOL_TYPES },
    { key: "size", label: "Velikost a / s", kind: "number", min: 0, step: 0.5 },
    { key: "length", label: "Délka svaru", kind: "number", min: 0, hint: "0 = po celé délce" },
    { key: "pitch", label: "Rozteč (přerušovaný)", kind: "number", min: 0 },
    { key: "allAround", label: "Svar po obvodu", kind: "bool" },
    { key: "field", label: "Montážní svar", kind: "bool" },
    { key: "otherSide", label: "Svar na druhé straně", kind: "bool" },
    { key: "note", label: "Poznámka (metoda, ISO 4063)", kind: "text" },
  ],
  build: (_d, ctx) => ctx.body,
});

// ---------------- Výstupy (akce v UI) ----------------

registerExt({ ext: "weld.cutList", label: "Kusovník řezů", icon: "weld-list", tone: "file", tab: "weld", group: "Výstupy", order: 0, big: true, hint: "délky a úhly řezů profilů, hmotnosti, CSV", make: () => ({}), action: true, scope: "both" });
registerExt({ ext: "weld.weldTable", label: "Tabulka svarů", icon: "weld-table", tone: "file", tab: "weld", group: "Výstupy", order: 1, hint: "délky svarů a svarový kov", make: () => ({}), action: true, scope: "both" });

export { sectionOf, layoutMembers, sketchSegments, type Cut };
