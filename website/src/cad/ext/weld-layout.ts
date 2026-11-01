/**
 * Svařence – čistá (bez OCCT) část: průřezy profilů, rozložení konstrukčních profilů podél úseček
 * (spoje pokos / tupý / žádný, prodloužení konců), kusovník řezů, tabulka svarů a značka svaru pro výkres.
 * Běží v UI i v jádře.
 */
import { toWorld } from "../defaults";
import { HEB, IPE, UPN, type IProfile } from "../library/tables";
import type { DText, Poly } from "../drawing";
import type { CadDoc, Feature, SketchEntity, Vec2, Vec3 } from "../types";

export const STEEL_DENSITY = 7.85e-6; // kg/mm³

// ---------------- vektory ----------------
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: Vec3): Vec3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const same = (a: Vec3, b: Vec3, tol = 1e-6) => len(sub(a, b)) < tol;

// ---------------- profily ----------------

export type ProfileFamily = "shs" | "rhs" | "chs" | "L" | "U" | "IPE" | "HEB" | "flat" | "round" | "square";
export type ProfileSpec = { family: ProfileFamily; w: number; h: number; t: number; d: number; size: string };
export type Align = "center" | "bl" | "bc" | "br" | "cl" | "cr" | "tl" | "tc" | "tr";

export const PROFILE_FAMILIES: { v: ProfileFamily; l: string }[] = [
  { v: "shs", l: "Jäkl čtvercový" },
  { v: "rhs", l: "Jäkl obdélníkový" },
  { v: "chs", l: "Trubka kruhová" },
  { v: "L", l: "Úhelník L" },
  { v: "U", l: "Profil U (UPN)" },
  { v: "IPE", l: "Nosník IPE" },
  { v: "HEB", l: "Nosník HEB" },
  { v: "flat", l: "Plochá tyč" },
  { v: "round", l: "Kulatina" },
  { v: "square", l: "Čtyřhranná tyč" },
];

export const ALIGN_OPTIONS: { v: Align; l: string }[] = [
  { v: "center", l: "Střed" },
  { v: "bl", l: "Vlevo dole" },
  { v: "bc", l: "Dole" },
  { v: "br", l: "Vpravo dole" },
  { v: "cl", l: "Vlevo" },
  { v: "cr", l: "Vpravo" },
  { v: "tl", l: "Vlevo nahoře" },
  { v: "tc", l: "Nahoře" },
  { v: "tr", l: "Vpravo nahoře" },
];

export const DEFAULT_PROFILE: ProfileSpec = { family: "shs", w: 40, h: 40, t: 3, d: 33.7, size: "100" };

export function profileSpec(data: Record<string, unknown>): ProfileSpec {
  const n = (k: string, d: number) => (typeof data[k] === "number" && Number.isFinite(data[k] as number) ? (data[k] as number) : d);
  const fam = String(data.family ?? DEFAULT_PROFILE.family) as ProfileFamily;
  return { family: PROFILE_FAMILIES.some((f) => f.v === fam) ? fam : "shs", w: n("w", 40), h: n("h", 40), t: n("t", 3), d: n("d", 33.7), size: String(data.size ?? "100") };
}

const fmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString("cs-CZ");

function arcPts(cx: number, cy: number, r: number, a0: number, a1: number, n = 4): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}
function rounded(w: number, h: number, ro: number): Vec2[] {
  const x = w / 2 - ro;
  const y = h / 2 - ro;
  if (ro <= 1e-9) return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
  return [...arcPts(x, -y, ro, 270, 360), ...arcPts(x, y, ro, 0, 90), ...arcPts(-x, y, ro, 90, 180), ...arcPts(-x, -y, ro, 180, 270)];
}
function iOutline({ h, b, tw, tf, r }: IProfile): Vec2[] {
  const x1 = tw / 2;
  const y1 = h / 2 - tf;
  const right: Vec2[] = [[b / 2, -h / 2], [b / 2, -y1], [x1 + r, -y1], ...arcPts(x1 + r, -y1 + r, r, 270, 180), [x1, y1 - r], ...arcPts(x1 + r, y1 - r, r, 180, 90), [b / 2, y1], [b / 2, h / 2]];
  const left = right.map(([x, y]) => [-x, y] as Vec2).reverse();
  return [...right, ...left];
}
function uOutline({ h, b, tw, tf, r }: IProfile): Vec2[] {
  const y1 = h / 2 - tf;
  return [[0, -h / 2], [b, -h / 2], [b, -y1], [tw + r, -y1], ...arcPts(tw + r, -y1 + r, r, 270, 180), [tw, y1 - r], ...arcPts(tw + r, y1 - r, r, 180, 90), [b, y1], [b, h / 2], [0, h / 2]];
}
function lOutline(a: number, b: number, t: number, r: number): Vec2[] {
  return [[0, 0], [a, 0], [a, t], [t + r, t], ...arcPts(t + r, t + r, r, 270, 180), [t, b], [0, b]];
}

export function polygonArea(p: Vec2[]) {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

export type Section = {
  /** vnější obrys (null = kruh) */
  outer: Vec2[] | null;
  /** vnitřní obrys (díra) */
  inner: Vec2[] | null;
  /** kruhový průřez: vnější a vnitřní poloměr */
  circle: { ro: number; ri: number } | null;
  area: number;
  designation: string;
  /** [xmin, ymin, xmax, ymax] v základní poloze */
  bbox: [number, number, number, number];
};

function bboxOf(pts: Vec2[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

/** Průřez profilu v základní poloze (střed/roh dle konvence rodiny) + plocha a označení. */
export function sectionOf(p: ProfileSpec): Section {
  const { family: fam, w, h, t, d } = p;
  const pos = (v: number, what: string) => {
    if (!(v > 0)) throw new Error(`${what} profilu musí být kladný.`);
  };
  switch (fam) {
    case "shs":
    case "rhs": {
      const W = w;
      const H = fam === "shs" ? w : h;
      pos(W, "Rozměr"); pos(H, "Rozměr"); pos(t, "Tloušťka stěny");
      if (2 * t >= Math.min(W, H)) throw new Error("Tloušťka stěny jäklu je příliš velká.");
      const outer = rounded(W, H, 2 * t);
      const inner = rounded(W - 2 * t, H - 2 * t, t);
      return { outer, inner, circle: null, area: polygonArea(outer) - polygonArea(inner), designation: fam === "shs" ? `Jäkl ${fmt(W)}×${fmt(W)}×${fmt(t)}` : `Jäkl ${fmt(W)}×${fmt(H)}×${fmt(t)}`, bbox: bboxOf(outer) };
    }
    case "chs": {
      pos(d, "Průměr"); pos(t, "Tloušťka stěny");
      if (2 * t >= d) throw new Error("Tloušťka stěny trubky je příliš velká.");
      const ro = d / 2;
      const ri = d / 2 - t;
      return { outer: null, inner: null, circle: { ro, ri }, area: Math.PI * (ro * ro - ri * ri), designation: `Trubka Ø${fmt(d)}×${fmt(t)}`, bbox: [-ro, -ro, ro, ro] };
    }
    case "L": {
      pos(w, "Rameno"); pos(h, "Rameno"); pos(t, "Tloušťka");
      if (t >= Math.min(w, h)) throw new Error("Tloušťka úhelníku je příliš velká.");
      const outer = lOutline(w, h, t, t);
      return { outer, inner: null, circle: null, area: polygonArea(outer), designation: `L ${fmt(w)}×${fmt(h)}×${fmt(t)}`, bbox: bboxOf(outer) };
    }
    case "U": {
      const tab = UPN[p.size];
      if (!tab) throw new Error(`Profil UPN ${p.size} není v tabulce.`);
      const outer = uOutline(tab);
      return { outer, inner: null, circle: null, area: polygonArea(outer), designation: `UPN ${p.size}`, bbox: bboxOf(outer) };
    }
    case "IPE":
    case "HEB": {
      const tab = (fam === "IPE" ? IPE : HEB)[p.size];
      if (!tab) throw new Error(`Profil ${fam} ${p.size} není v tabulce.`);
      const outer = iOutline(tab);
      return { outer, inner: null, circle: null, area: polygonArea(outer), designation: `${fam} ${p.size}`, bbox: bboxOf(outer) };
    }
    case "flat": {
      pos(w, "Šířka"); pos(t, "Tloušťka");
      const outer = rounded(w, t, 0);
      return { outer, inner: null, circle: null, area: w * t, designation: `Plochá ${fmt(w)}×${fmt(t)}`, bbox: bboxOf(outer) };
    }
    case "square": {
      pos(w, "Rozměr");
      const outer = rounded(w, w, 0);
      return { outer, inner: null, circle: null, area: w * w, designation: `Čtyřhran ${fmt(w)}`, bbox: bboxOf(outer) };
    }
    case "round": {
      pos(d, "Průměr");
      return { outer: null, inner: null, circle: { ro: d / 2, ri: 0 }, area: (Math.PI * d * d) / 4, designation: `Kulatina Ø${fmt(d)}`, bbox: [-d / 2, -d / 2, d / 2, d / 2] };
    }
  }
}

/** Posun průřezu tak, aby zarovnávací bod byl v počátku; vrací vektor posunu (dx, dy). */
export function alignShift(bbox: [number, number, number, number], align: Align): Vec2 {
  const [x0, y0, x1, y1] = bbox;
  const xs = { l: x0, c: (x0 + x1) / 2, r: x1 };
  const ys = { b: y0, c: (y0 + y1) / 2, t: y1 };
  if (align === "center") return [-(x0 + x1) / 2, -(y0 + y1) / 2];
  const y = ys[align[0] as "b" | "c" | "t"];
  const x = xs[align[1] as "l" | "c" | "r"];
  return [-x, -y];
}

/** Rohy obalového obdélníku průřezu po zarovnání a natočení (v lokální rovině X/Y profilu). */
export function sectionCorners(sec: Section, align: Align, angleDeg: number): Vec2[] {
  const [sx, sy] = alignShift(sec.bbox, align);
  const [x0, y0, x1, y1] = sec.bbox;
  const a = (angleDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => {
    const px = x + sx;
    const py = y + sy;
    return [px * c - py * s, px * s + py * c] as Vec2;
  });
}

/** Největší průmět rohů průřezu na směr (qx, qy) v lokální rovině (kladná strana). */
export function extentAlong(corners: Vec2[], qx: number, qy: number) {
  return Math.max(0, ...corners.map(([x, y]) => x * qx + y * qy));
}
export function sectionRadius(corners: Vec2[]) {
  return Math.max(...corners.map(([x, y]) => Math.hypot(x, y)));
}

// ---------------- rozložení profilů ----------------

export type Seg3 = { a: Vec3; b: Vec3; up: Vec3 };
export type JointMode = "mitre" | "butt" | "none";
export type Cut = { origin: Vec3; normal: Vec3 };
export type MemberLayout = {
  seg: Seg3;
  u: Vec3;
  X: Vec3;
  Y: Vec3;
  /** původní délka osy mezi body skici */
  L: number;
  /** prodloužení (záporné = zkrácení) na začátku / konci */
  extA: number;
  extB: number;
  /** řezy poloprostorem (ponechá se strana +normála) */
  cuts: Cut[];
  /** délka osy po úpravách (pro kusovník) */
  axisLen: number;
  /** vnější (největší) délka včetně špiček pokosu */
  outerLen: number;
  /** úhly řezů na začátku/konci (0 = kolmý řez) */
  angleA: number;
  angleB: number;
  jointA: JointMode | "free";
  jointB: JointMode | "free";
};

/** Lokální rámec profilu: osa u, X = up × u, Y = u × X (≈ up). */
export function memberFrame(seg: Seg3): { u: Vec3; X: Vec3; Y: Vec3; L: number } {
  const d = sub(seg.b, seg.a);
  const L = len(d);
  if (L < 1e-6) throw new Error("Úsečka profilu má nulovou délku.");
  const u = mul(d, 1 / L);
  let up = norm(seg.up);
  if (len(cross(up, u)) < 1e-6) up = Math.abs(u[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const X = norm(cross(up, u));
  const Y = cross(u, X);
  return { u, X, Y, L };
}

/** Úsečky skici (úsečky a lomené čáry) převedené do prostoru; `up` = normála roviny skici. */
export function sketchSegments(sk: Extract<Feature, { type: "sketch" }>): Seg3[] {
  const out: Seg3[] = [];
  const basis = (() => {
    const o = toWorld(sk.plane, [0, 0]);
    const x = toWorld(sk.plane, [1, 0]);
    const y = toWorld(sk.plane, [0, 1]);
    return norm(cross(sub(x, o), sub(y, o)));
  })();
  const push = (a: Vec2, b: Vec2) => {
    const A = toWorld(sk.plane, a);
    const B = toWorld(sk.plane, b);
    if (len(sub(B, A)) > 1e-6) out.push({ a: A, b: B, up: basis });
  };
  for (const e of sk.entities as SketchEntity[]) {
    if (e.construction) continue;
    if (e.type === "line") push(e.a, e.b);
    else if (e.type === "polyline") {
      for (let i = 0; i + 1 < e.points.length; i++) push(e.points[i], e.points[i + 1]);
      if (e.closed && e.points.length > 2) push(e.points[e.points.length - 1], e.points[0]);
    } else if (e.type === "rect") {
      const c = Math.cos((e.angle * Math.PI) / 180);
      const s = Math.sin((e.angle * Math.PI) / 180);
      const corners: Vec2[] = [[-e.w / 2, -e.h / 2], [e.w / 2, -e.h / 2], [e.w / 2, e.h / 2], [-e.w / 2, e.h / 2]].map(([x, y]) => [e.cx + x * c - y * s, e.cy + x * s + y * c]);
      for (let i = 0; i < 4; i++) push(corners[i], corners[(i + 1) % 4]);
    }
  }
  return out;
}

export type LayoutOptions = { mode: JointMode; gap: number; extStart: number; extEnd: number; corners: Vec2[] };

/** Rozloží profily podél úseček: spoje v místech společných koncových bodů, prodloužení volných konců. */
export function layoutMembers(segs: Seg3[], o: LayoutOptions): MemberLayout[] {
  const frames = segs.map(memberFrame);
  const R = sectionRadius(o.corners);
  const out: MemberLayout[] = segs.map((seg, i) => ({ seg, ...frames[i], extA: 0, extB: 0, cuts: [], axisLen: frames[i].L, outerLen: frames[i].L, angleA: 0, angleB: 0, jointA: "free", jointB: "free" }));
  // incidence vrcholů
  type End = { i: number; end: "a" | "b" };
  const verts: { v: Vec3; ends: End[] }[] = [];
  segs.forEach((s, i) => {
    for (const end of ["a", "b"] as const) {
      const p = s[end];
      const hit = verts.find((x) => same(x.v, p));
      if (hit) hit.ends.push({ i, end });
      else verts.push({ v: p, ends: [{ i, end }] });
    }
  });
  const dirAway = (e: End): Vec3 => (e.end === "a" ? out[e.i].u : mul(out[e.i].u, -1));
  const tipExt: number[][] = segs.map(() => [0, 0]);
  for (const vx of verts) {
    if (vx.ends.length !== 2 || o.mode === "none") continue;
    const [e1, e2] = vx.ends;
    if (e1.i === e2.i) continue;
    const d1 = dirAway(e1);
    const d2 = dirAway(e2);
    const cosT = Math.max(-1, Math.min(1, dot(d1, d2)));
    const theta = (Math.acos(cosT) * 180) / Math.PI;
    if (theta > 178 || theta < 3) continue; // rovné pokračování / přeložení
    const setJoint = (e: End, mode: JointMode) => {
      if (e.end === "a") out[e.i].jointA = mode;
      else out[e.i].jointB = mode;
    };
    if (o.mode === "mitre") {
      const half = (theta * Math.PI) / 360;
      const ext = R / Math.tan(half) + o.gap + 1;
      const shorten = o.gap / (2 * Math.sin(half));
      for (const [e, dMine, dOther] of [[e1, d1, d2], [e2, d2, d1]] as [End, Vec3, Vec3][]) {
        const n = norm(sub(dMine, dOther));
        const m = out[e.i];
        if (e.end === "a") m.extA = ext;
        else m.extB = ext;
        m.cuts.push({ origin: add(vx.v, mul(n, o.gap / 2)), normal: n });
        m.axisLen -= shorten;
        // vnější špička: rozměr průřezu směrem od druhého profilu (v rovině průřezu)
        const q = norm(sub(dOther, mul(m.u, dot(m.u, dOther))));
        const eOut = extentAlong(o.corners, -dot(q, m.X), -dot(q, m.Y));
        tipExt[e.i][e.end === "a" ? 0 : 1] = eOut / Math.tan(half) - shorten;
        const ang = (180 - theta) / 2;
        if (e.end === "a") m.angleA = ang;
        else m.angleB = ang;
        setJoint(e, "mitre");
      }
    } else if (o.mode === "butt") {
      const first = e1.i <= e2.i ? e1 : e2;
      const second = first === e1 ? e2 : e1;
      const dF = first === e1 ? d1 : d2;
      const dS = first === e1 ? d2 : d1;
      const mF = out[first.i];
      const mS = out[second.i];
      // druhý profil zkrátit o rozměr prvního ve směru druhého (+ mezera)
      const h = extentAlong(o.corners, dot(dS, mF.X), dot(dS, mF.Y)) + o.gap;
      // první prodloužit přes druhý (rozměr druhého ve směru −dF)
      const e2x = extentAlong(o.corners, -dot(dF, mS.X), -dot(dF, mS.Y));
      if (second.end === "a") {
        mS.extA = -h;
      } else mS.extB = -h;
      mS.axisLen -= h;
      if (first.end === "a") mF.extA = e2x;
      else mF.extB = e2x;
      mF.axisLen += e2x;
      setJoint(first, "butt");
      setJoint(second, "butt");
    }
  }
  // volné konce
  for (const m of out) {
    if (m.jointA === "free") {
      m.extA = o.extStart;
      m.axisLen += o.extStart;
    }
    if (m.jointB === "free") {
      m.extB = o.extEnd;
      m.axisLen += o.extEnd;
    }
  }
  out.forEach((m, i) => {
    m.outerLen = m.axisLen + Math.max(0, tipExt[i][0]) + Math.max(0, tipExt[i][1]);
    if (m.axisLen <= 0) throw new Error("Profil je po ořezání spojů záporný – zvolte menší profil nebo jiný typ spoje.");
  });
  return out;
}

// ---------------- data prvků ----------------

export type MemberData = {
  sketchId: string;
  family: ProfileFamily;
  w: number;
  h: number;
  t: number;
  d: number;
  size: string;
  align: Align;
  angle: number;
  corner: JointMode;
  gap: number;
  extStart: number;
  extEnd: number;
  separate: boolean;
  mode: "new" | "add";
};

export function memberData(data: Record<string, unknown>): MemberData {
  const p = profileSpec(data);
  const n = (k: string, d: number) => (typeof data[k] === "number" && Number.isFinite(data[k] as number) ? (data[k] as number) : d);
  const corner = String(data.corner ?? "mitre");
  return {
    sketchId: String(data.sketchId ?? ""),
    ...p,
    align: (ALIGN_OPTIONS.some((a) => a.v === data.align) ? data.align : "center") as Align,
    angle: n("angle", 0),
    corner: corner === "butt" || corner === "none" ? corner : "mitre",
    gap: Math.max(0, n("gap", 0)),
    extStart: n("extStart", 0),
    extEnd: n("extEnd", 0),
    separate: !!data.separate,
    mode: data.mode === "new" ? "new" : "add",
  };
}

export type FrameData = { family: ProfileFamily; w: number; h: number; t: number; d: number; size: string; width: number; depth: number; height: number; corner: JointMode; mode: "new" | "add" };
export function frameData(data: Record<string, unknown>): FrameData {
  const p = profileSpec(data);
  const n = (k: string, d: number) => (typeof data[k] === "number" && Number.isFinite(data[k] as number) ? (data[k] as number) : d);
  const corner = String(data.corner ?? "mitre");
  return { ...p, width: n("width", 600), depth: n("depth", 400), height: n("height", 800), corner: corner === "butt" ? "butt" : "mitre", mode: data.mode === "new" ? "new" : "add" };
}

/** Úsečky rámu: spodní a horní obdélník (pokos/tupý) + 4 sloupky (tupě mezi obdélníky). */
export function frameSegments(f: FrameData): { rect: Seg3[]; posts: Seg3[]; sec: Section; secW: number; secH: number } {
  const sec = sectionOf(f);
  const corners = sectionCorners(sec, "center", 0);
  const secW = 2 * extentAlong(corners, 1, 0);
  const secH = 2 * extentAlong(corners, 0, 1);
  if (f.width <= 2 * secW || f.depth <= 2 * secW || f.height <= 2 * secH) throw new Error("Rozměry rámu jsou menší než dvojnásobek profilu.");
  const x0 = secW / 2;
  const x1 = f.width - secW / 2;
  const y0 = secW / 2;
  const y1 = f.depth - secW / 2;
  const up: Vec3 = [0, 0, 1];
  const rectAt = (z: number): Seg3[] => [
    { a: [x0, y0, z], b: [x1, y0, z], up },
    { a: [x1, y0, z], b: [x1, y1, z], up },
    { a: [x1, y1, z], b: [x0, y1, z], up },
    { a: [x0, y1, z], b: [x0, y0, z], up },
  ];
  const rect = [...rectAt(secH / 2), ...rectAt(f.height - secH / 2)];
  const posts: Seg3[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => ({ a: [x, y, secH], b: [x, y, f.height - secH], up: [1, 0, 0] }));
  return { rect, posts, sec, secW, secH };
}

// ---------------- kusovník řezů ----------------

export type CutRow = { pos: number; designation: string; count: number; length: number; angleA: number; angleB: number; massEach: number; feature: string };

/** Všechny profily v dokumentu (prvky weld.member a weld.frame) – bez OCCT. */
export function membersOf(doc: CadDoc): { feature: Feature; designation: string; area: number; layouts: MemberLayout[] }[] {
  const out: { feature: Feature; designation: string; area: number; layouts: MemberLayout[] }[] = [];
  const sketches = new Map(doc.features.filter((f): f is Extract<Feature, { type: "sketch" }> => f.type === "sketch").map((s) => [s.id, s]));
  for (const f of doc.features) {
    if (f.type !== "ext" || f.suppressed) continue;
    try {
      if (f.ext === "weld.member") {
        const d = memberData(f.data);
        const sk = sketches.get(d.sketchId);
        if (!sk) continue;
        const sec = sectionOf(d);
        const corners = sectionCorners(sec, d.align, d.angle);
        out.push({ feature: f, designation: sec.designation, area: sec.area, layouts: layoutMembers(sketchSegments(sk), { mode: d.corner, gap: d.gap, extStart: d.extStart, extEnd: d.extEnd, corners }) });
      } else if (f.ext === "weld.frame") {
        const d = frameData(f.data);
        const { rect, posts, sec } = frameSegments(d);
        const corners = sectionCorners(sec, "center", 0);
        const lay = [...layoutMembers(rect.slice(0, 4), { mode: d.corner, gap: 0, extStart: 0, extEnd: 0, corners }), ...layoutMembers(rect.slice(4), { mode: d.corner, gap: 0, extStart: 0, extEnd: 0, corners }), ...layoutMembers(posts, { mode: "none", gap: 0, extStart: 0, extEnd: 0, corners })];
        out.push({ feature: f, designation: sec.designation, area: sec.area, layouts: lay });
      }
    } catch {
      /* chybný prvek – v kusovníku se neobjeví */
    }
  }
  return out;
}

export function cutList(doc: CadDoc): { rows: CutRow[]; totals: { designation: string; count: number; length: number; mass: number }[] } {
  const rows = new Map<string, CutRow>();
  for (const m of membersOf(doc)) {
    for (const l of m.layouts) {
      const length = Math.round(l.outerLen * 10) / 10;
      const key = `${m.designation}|${length}|${Math.round(l.angleA)}|${Math.round(l.angleB)}`;
      const row = rows.get(key);
      if (row) row.count++;
      else rows.set(key, { pos: 0, designation: m.designation, count: 1, length, angleA: Math.round(l.angleA * 10) / 10, angleB: Math.round(l.angleB * 10) / 10, massEach: m.area * l.axisLen * STEEL_DENSITY, feature: m.feature.name });
    }
  }
  const list = [...rows.values()].sort((a, b) => a.designation.localeCompare(b.designation, "cs") || b.length - a.length);
  list.forEach((r, i) => (r.pos = i + 1));
  const totals = new Map<string, { designation: string; count: number; length: number; mass: number }>();
  for (const r of list) {
    const t = totals.get(r.designation) ?? { designation: r.designation, count: 0, length: 0, mass: 0 };
    t.count += r.count;
    t.length += r.length * r.count;
    t.mass += r.massEach * r.count;
    totals.set(r.designation, t);
  }
  return { rows: list, totals: [...totals.values()] };
}

export function cutListText(doc: CadDoc): string {
  const { rows, totals } = cutList(doc);
  if (!rows.length) return "Žádné konstrukční profily (přidejte prvek Konstrukční profil nebo Rám z profilů).";
  const lines = ["Poz.  Profil                 Ks   Délka [mm]  Řez A  Řez B  kg/ks"];
  for (const r of rows) lines.push(`${String(r.pos).padEnd(5)} ${r.designation.padEnd(22)} ${String(r.count).padStart(3)}   ${fmt(r.length).padStart(9)}  ${(r.angleA ? fmt(r.angleA) + "°" : "90°").padEnd(6)} ${(r.angleB ? fmt(r.angleB) + "°" : "90°").padEnd(6)} ${fmt(r.massEach)}`);
  lines.push("");
  lines.push("Celkem na profil:");
  for (const t of totals) lines.push(`  ${t.designation.padEnd(22)} ${String(t.count).padStart(3)} ks   ${fmt(t.length / 1000)} m   ${fmt(t.mass)} kg`);
  lines.push(`Hmotnost svařence (profily): ${fmt(totals.reduce((s, t) => s + t.mass, 0))} kg`);
  return lines.join("\n");
}

export function cutListCsv(doc: CadDoc): string {
  const { rows, totals } = cutList(doc);
  const q = (s: string | number) => `"${String(s).replace(/"/g, '""')}"`;
  const n = (x: number) => String(Math.round(x * 100) / 100).replace(".", ",");
  const out = ["Pozice;Profil;Ks;Délka [mm];Řez A [°];Řez B [°];Hmotnost 1 ks [kg];Hmotnost celkem [kg];Prvek"];
  for (const r of rows) out.push([r.pos, q(r.designation), r.count, n(r.length), n(r.angleA), n(r.angleB), n(r.massEach), n(r.massEach * r.count), q(r.feature)].join(";"));
  out.push("");
  out.push("Profil;Ks;Délka celkem [m];Hmotnost [kg]");
  for (const t of totals) out.push([q(t.designation), t.count, n(t.length / 1000), n(t.mass)].join(";"));
  return "﻿" + out.join("\r\n") + "\r\n";
}

// ---------------- svary ----------------

export type BeadData = { edges: number[]; a: number; intermittent: boolean; segLen: number; pitch: number; edgeLens: number[] };
export function beadData(data: Record<string, unknown>): BeadData {
  const n = (k: string, d: number) => (typeof data[k] === "number" && Number.isFinite(data[k] as number) ? (data[k] as number) : d);
  return { edges: Array.isArray(data.edges) ? (data.edges as number[]) : [], a: n("a", 4), intermittent: !!data.intermittent, segLen: n("segLen", 50), pitch: n("pitch", 100), edgeLens: Array.isArray(data.edgeLens) ? (data.edgeLens as number[]) : [] };
}

/** Délka svaru na hraně délky L: souvislý = L, přerušovaný = součet úseků. */
export function weldLength(L: number, b: BeadData) {
  if (!b.intermittent || b.pitch <= 0) return L;
  let total = 0;
  for (let s = 0; s < L - 1e-9; s += b.pitch) total += Math.min(b.segLen, L - s);
  return total;
}

export type WeldRow = { feature: string; type: string; a: number; length: number; volume: number; mass: number };

export function weldTable(doc: CadDoc): WeldRow[] {
  const rows: WeldRow[] = [];
  for (const f of doc.features) {
    if (f.type !== "ext" || f.suppressed) continue;
    if (f.ext === "weld.bead") {
      const b = beadData(f.data);
      const length = b.edgeLens.reduce((s, L) => s + weldLength(L, b), 0);
      const volume = ((b.a * b.a) / 2) * length;
      rows.push({ feature: f.name, type: b.intermittent ? `koutový přerušovaný ${fmt(b.segLen)} (${fmt(b.pitch)})` : "koutový", a: b.a, length, volume, mass: volume * STEEL_DENSITY });
    } else if (f.ext === "weld.symbol") {
      const s = symbolData(f.data);
      rows.push({ feature: f.name, type: `${SYMBOL_TYPES.find((t) => t.v === s.kind)?.l ?? s.kind}${s.allAround ? " (po obvodu)" : ""}${s.field ? " (montážní)" : ""}`, a: s.size, length: s.length, volume: s.kind === "fillet" ? ((s.size * s.size) / 2) * s.length : 0, mass: s.kind === "fillet" ? ((s.size * s.size) / 2) * s.length * STEEL_DENSITY : 0 });
    }
  }
  return rows;
}

export function weldTableText(doc: CadDoc): string {
  const rows = weldTable(doc);
  if (!rows.length) return "Žádné svary (přidejte Svarovou housenku nebo Značku svaru).";
  const lines = ["Prvek                  Typ                           a/s   Délka [mm]  Objem [cm³]  kg"];
  for (const r of rows) lines.push(`${r.feature.padEnd(22)} ${r.type.padEnd(29)} ${fmt(r.a).padStart(4)}  ${fmt(r.length).padStart(10)}  ${fmt(r.volume / 1000).padStart(11)}  ${fmt(r.mass)}`);
  lines.push(`Svarový kov celkem: ${fmt(rows.reduce((s, r) => s + r.mass, 0))} kg`);
  return lines.join("\n");
}

// ---------------- značka svaru (ISO 2553) ----------------

export type SymbolKind = "fillet" | "V" | "halfV" | "U" | "I" | "square" | "spot";
export const SYMBOL_TYPES: { v: SymbolKind; l: string }[] = [
  { v: "fillet", l: "Koutový" },
  { v: "V", l: "V svar" },
  { v: "halfV", l: "½V svar" },
  { v: "U", l: "U svar" },
  { v: "I", l: "I svar" },
  { v: "square", l: "Lemový" },
  { v: "spot", l: "Bodový" },
];
export type SymbolData = { kind: SymbolKind; size: number; length: number; pitch: number; allAround: boolean; field: boolean; otherSide: boolean; note: string };
export function symbolData(data: Record<string, unknown>): SymbolData {
  const n = (k: string, d: number) => (typeof data[k] === "number" && Number.isFinite(data[k] as number) ? (data[k] as number) : d);
  const kind = SYMBOL_TYPES.some((t) => t.v === data.kind) ? (data.kind as SymbolKind) : "fillet";
  return { kind, size: n("size", 4), length: n("length", 0), pitch: n("pitch", 0), allAround: !!data.allAround, field: !!data.field, otherSide: !!data.otherSide, note: String(data.note ?? "") };
}

/** Geometrie značky svaru pro výkres (mm listu): `at` = začátek odkazové (referenční) čáry, `leader` = hrot šipky. */
export function weldSymbolGeometry(sym: SymbolData, at: Vec2, leader: Vec2): { polys: Poly[]; texts: DText[] } {
  const polys: Poly[] = [];
  const texts: DText[] = [];
  const L = 28;
  const [x, y] = at;
  const line = (pts: Vec2[]) => polys.push({ layer: "dim", pts });
  // referenční čára + identifikační (čárkovaná) pro druhou stranu
  line([[x, y], [x + L, y]]);
  polys.push({ layer: "hidden", pts: sym.otherSide ? [[x, y + 2.2], [x + L, y + 2.2]] : [[x, y - 2.2], [x + L, y - 2.2]] });
  // šipka
  line([[x, y], leader]);
  const dx = leader[0] - x;
  const dy = leader[1] - y;
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l;
  const uy = dy / l;
  polys.push({ layer: "dim", fill: true, pts: [leader, [leader[0] - ux * 3 - uy * 0.9, leader[1] - uy * 3 + ux * 0.9], [leader[0] - ux * 3 + uy * 0.9, leader[1] - uy * 3 - ux * 0.9], leader] });
  // značka nad (strana šipky) nebo pod čarou
  const side = sym.otherSide ? 1 : -1; // SVG y dolů: nad čarou = −
  const cx = x + 12;
  const h = 3.6;
  const g = (pts: Vec2[]) => line(pts.map(([px, py]) => [cx + px, y + side * py] as Vec2));
  switch (sym.kind) {
    case "fillet": g([[0, 0], [0, h], [h, 0], [0, 0]]); break;
    case "V": g([[-h / 2, h], [0, 0], [h / 2, h]]); break;
    case "halfV": g([[0, h], [0, 0], [h, h]]); break;
    case "U": g([[-h / 2, h], [-h / 2, h / 2], [-h / 4, 0], [h / 4, 0], [h / 2, h / 2], [h / 2, h]]); break;
    case "I": g([[-1.2, 0], [-1.2, h]]); g([[1.2, 0], [1.2, h]]); break;
    case "square": g([[-h / 2, h], [-h / 2, 0], [h / 2, 0], [h / 2, h]]); break;
    case "spot": {
      const pts: Vec2[] = [];
      for (let i = 0; i <= 16; i++) pts.push([Math.cos((i / 16) * Math.PI * 2) * 1.8, h / 2 + Math.sin((i / 16) * Math.PI * 2) * 1.8]);
      g(pts);
      break;
    }
  }
  // rozměr vlevo, délka vpravo
  const ty = y + side * (h / 2) + 1.2;
  if (sym.size > 0) texts.push({ x: cx - 1.5, y: ty, s: `${sym.kind === "fillet" ? "a" : "s"}${fmt(sym.size)}`, size: 3.2, anchor: "end", layer: "dim" });
  if (sym.length > 0) texts.push({ x: cx + h + 1.5, y: ty, s: sym.pitch > 0 ? `${fmt(sym.length)} (${fmt(sym.pitch)})` : fmt(sym.length), size: 3.2, layer: "dim" });
  if (sym.allAround) {
    const pts: Vec2[] = [];
    for (let i = 0; i <= 16; i++) pts.push([x + Math.cos((i / 16) * Math.PI * 2) * 1.6, y + Math.sin((i / 16) * Math.PI * 2) * 1.6]);
    line(pts);
  }
  if (sym.field) {
    line([[x, y], [x, y - 7]]);
    polys.push({ layer: "dim", fill: true, pts: [[x, y - 7], [x + 4, y - 5.5], [x, y - 4], [x, y - 7]] });
  }
  if (sym.note) texts.push({ x: x + L + 2, y: y + 1.1, s: sym.note, size: 3, layer: "text" });
  return { polys, texts };
}
