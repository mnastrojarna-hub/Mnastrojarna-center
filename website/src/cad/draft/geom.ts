/**
 * 2D geometrie výkresu: vektory, úhly, obálky, vydutí (bulge) ↔ oblouk, afinní transformace, plocha mnohoúhelníku.
 * Úhly v radiánech (model ukládá stupně – převod dělají druhy entit).
 */
import type { Vec2 } from "./model";

export const EPS = 1e-9;
export const TAU = Math.PI * 2;
export const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const mul = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k];
export const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
export const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
export const len = (a: Vec2) => Math.hypot(a[0], a[1]);
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const mid = (a: Vec2, b: Vec2): Vec2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
export const rot90 = (a: Vec2): Vec2 => [-a[1], a[0]];
export const unit = (a: Vec2): Vec2 => {
  const l = len(a);
  return l < 1e-300 ? [1, 0] : [a[0] / l, a[1] / l];
};
export const angleOf = (v: Vec2) => Math.atan2(v[1], v[0]);
export const polar = (p: Vec2, ang: number, d: number): Vec2 => [p[0] + Math.cos(ang) * d, p[1] + Math.sin(ang) * d];
export const rad = (deg: number) => (deg * Math.PI) / 180;
export const deg = (r: number) => (r * 180) / Math.PI;
/** úhel do [0, 2π) */
export const normA = (a: number) => ((a % TAU) + TAU) % TAU;
/** úhel a leží na oblouku od a0 proti směru hodin o úhel sweep */
export const onSweep = (a: number, a0: number, sweep: number, tol = 1e-9) => normA(a - a0) <= sweep + tol || sweep >= TAU - tol;
export const samePt = (a: Vec2, b: Vec2, tol = 1e-9) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;

export type Box = { x0: number; y0: number; x1: number; y1: number };
export const emptyBox = (): Box => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
export const isEmptyBox = (b: Box) => !(b.x0 <= b.x1 && b.y0 <= b.y1);
export function boxAdd(b: Box, p: Vec2): Box {
  if (p[0] < b.x0) b.x0 = p[0];
  if (p[1] < b.y0) b.y0 = p[1];
  if (p[0] > b.x1) b.x1 = p[0];
  if (p[1] > b.y1) b.y1 = p[1];
  return b;
}
export const boxOf = (pts: Vec2[]): Box => pts.reduce((b, p) => boxAdd(b, p), emptyBox());
export const boxUnion = (a: Box, b: Box): Box => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
export const boxHits = (a: Box, b: Box) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
export const boxInside = (inner: Box, outer: Box) => inner.x0 >= outer.x0 && inner.x1 <= outer.x1 && inner.y0 >= outer.y0 && inner.y1 <= outer.y1;
export const boxGrow = (b: Box, d: number): Box => ({ x0: b.x0 - d, y0: b.y0 - d, x1: b.x1 + d, y1: b.y1 + d });
export const boxFrom2 = (a: Vec2, b: Vec2): Box => ({ x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) });
export const inBox = (p: Vec2, b: Box) => p[0] >= b.x0 && p[0] <= b.x1 && p[1] >= b.y0 && p[1] <= b.y1;

/** obálka oblouku (úhly v radiánech, proti směru hodin od a0 o sweep) */
export function arcBox(c: Vec2, r: number, a0: number, sweep: number): Box {
  const b = emptyBox();
  boxAdd(b, polar(c, a0, r));
  boxAdd(b, polar(c, a0 + sweep, r));
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    if (onSweep(a, a0, sweep)) boxAdd(b, polar(c, a, r));
  }
  return b;
}

/** kružnice třemi body (null = body v přímce) */
export function circle3(a: Vec2, b: Vec2, c: Vec2): { c: Vec2; r: number } | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-12 * Math.max(1, dist(a, b) * dist(b, c))) return null;
  const a2 = a[0] ** 2 + a[1] ** 2;
  const b2 = b[0] ** 2 + b[1] ** 2;
  const c2 = c[0] ** 2 + c[1] ** 2;
  const ux = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d;
  const uy = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
  const cc: Vec2 = [ux, uy];
  return { c: cc, r: dist(cc, a) };
}

/** Oblouk třemi body a → b → c: střed, poloměr, počáteční úhel a úhel oblouku proti směru hodin (radiány). */
export function arc3(a: Vec2, b: Vec2, c: Vec2): { c: Vec2; r: number; a0: number; sweep: number } | null {
  const k = circle3(a, b, c);
  if (!k) return null;
  const sa = angleOf(sub(a, k.c));
  const sb = angleOf(sub(b, k.c));
  const sc = angleOf(sub(c, k.c));
  const ccw = normA(sb - sa) <= normA(sc - sa);
  return ccw ? { c: k.c, r: k.r, a0: sa, sweep: normA(sc - sa) } : { c: k.c, r: k.r, a0: sc, sweep: normA(sa - sc) };
}

/**
 * Úsek křivky s vydutím (bulge) p0 → p1 jako oblouk: střed, poloměr, úhel začátku (u p0) a znaménkový úhel oblouku
 * (kladný = proti směru hodin). bulge = tan(úhel/4).
 */
export function bulgeArc(p0: Vec2, p1: Vec2, bulge: number): { c: Vec2; r: number; a0: number; sweep: number } {
  const theta = 4 * Math.atan(bulge);
  const chord = dist(p0, p1);
  const r = chord / (2 * Math.abs(Math.sin(theta / 2)));
  // střed: od středu tětivy kolmo o vzdálenost s, směr podle znaménka
  const m = mid(p0, p1);
  const h = r * Math.cos(theta / 2); // vzdálenost středu od tětivy (se znaménkem dle |θ| < π)
  const n = unit(rot90(sub(p1, p0)));
  const c = add(m, mul(n, Math.sign(bulge) * h));
  return { c, r, a0: angleOf(sub(p0, c)), sweep: theta };
}

/** vydutí oblouku daného úhlem (radiány, se znaménkem) */
export const bulgeOf = (sweep: number) => Math.tan(sweep / 4);

/** Vydutí tečného oblouku z p0 (tečna t) do p1. */
export function tangentBulge(p0: Vec2, t: Vec2, p1: Vec2): number {
  const ch = sub(p1, p0);
  const a = Math.atan2(cross(t, ch), dot(t, ch)); // úhel tečna → tětiva
  return Math.tan(a / 2);
}

/** nejbližší bod úsečky (t ∈ [0,1]) */
export function closestOnSeg(p: Vec2, a: Vec2, b: Vec2, clamp = true): { p: Vec2; t: number; d: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  let t = l2 < 1e-300 ? 0 : dot(sub(p, a), ab) / l2;
  if (clamp) t = Math.max(0, Math.min(1, t));
  const q = lerp(a, b, t);
  return { p: q, t, d: dist(p, q) };
}

/** Plocha mnohoúhelníku (shoelace), kladná proti směru hodin. */
export function polyArea(pts: Vec2[]): number {
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

export function pointInPoly(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------- afinní transformace

/** afinní transformace [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f (jako canvas) */
export type Affine = [number, number, number, number, number, number];
export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];
export const xfPt = (m: Affine, p: Vec2): Vec2 => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
/** směr (bez posunu) */
export const xfVec = (m: Affine, v: Vec2): Vec2 => [m[0] * v[0] + m[2] * v[1], m[1] * v[0] + m[3] * v[1]];
/** a ∘ b (nejdřív b, pak a) */
export const xfMul = (a: Affine, b: Affine): Affine => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
export const xfDet = (m: Affine) => m[0] * m[3] - m[1] * m[2];
export function xfInv(m: Affine): Affine {
  const d = xfDet(m);
  const a = m[3] / d;
  const b = -m[1] / d;
  const c = -m[2] / d;
  const dd = m[0] / d;
  return [a, b, c, dd, -(a * m[4] + c * m[5]), -(b * m[4] + dd * m[5])];
}
export const xfMove = (dx: number, dy: number): Affine => [1, 0, 0, 1, dx, dy];
export function xfRotate(ang: number, about: Vec2 = [0, 0]): Affine {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return [c, s, -s, c, about[0] - c * about[0] + s * about[1], about[1] - s * about[0] - c * about[1]];
}
export const xfScale = (k: number, about: Vec2 = [0, 0], ky = k): Affine => [k, 0, 0, ky, about[0] * (1 - k), about[1] * (1 - ky)];
/** zrcadlení podle přímky a–b */
export function xfMirror(a: Vec2, b: Vec2): Affine {
  const d = unit(sub(b, a));
  const c2 = d[0] * d[0] - d[1] * d[1];
  const s2 = 2 * d[0] * d[1];
  const m: Affine = [c2, s2, s2, -c2, 0, 0];
  const t = sub(a, xfVec(m, a));
  return [m[0], m[1], m[2], m[3], t[0], t[1]];
}
/** stejnoměrné měřítko transformace (null = zkosení / nestejné měřítko) */
export function xfUniform(m: Affine): number | null {
  const sx = Math.hypot(m[0], m[1]);
  const sy = Math.hypot(m[2], m[3]);
  if (Math.abs(sx - sy) > 1e-9 * Math.max(1, sx) || Math.abs(m[0] * m[2] + m[1] * m[3]) > 1e-9 * Math.max(1, sx * sy)) return null;
  return sx;
}
/** natočení transformace (úhel obrazu osy X) */
export const xfAngle = (m: Affine) => Math.atan2(m[1], m[0]);
