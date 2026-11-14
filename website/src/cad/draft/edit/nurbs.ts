/**
 * BALÍK 1 (edit) – operace s NURBS pro úpravy splajnů: vložení uzlu (Piegl & Tiller A5.1), rozdělení v parametru,
 * výřez, spojení dvou sevřených křivek, obrácení, rozklad na Bézierovy úseky a zvýšení stupně, převod úsečky a oblouku
 * na (racionální) NURBS. Vše v homogenních souřadnicích [x·w, y·w, w] – geometrie se nemění (dvojitá přesnost).
 */
import { cDeriv, cPoint, type Curve } from "../curves";
import { dist, len, polar, TAU, unit } from "../geom";
import type { Vec2 } from "../model";

export type Nurbs = { deg: number; ctrl: Vec2[]; knots: number[]; w?: number[] };
type H = [number, number, number];

const toH = (c: Nurbs): H[] => c.ctrl.map((p, i) => {
  const w = c.w?.[i] ?? 1;
  return [p[0] * w, p[1] * w, w];
});
function fromH(deg: number, Pw: H[], knots: number[]): Nurbs {
  const rational = Pw.some((h) => Math.abs(h[2] - 1) > 1e-14);
  return { deg, ctrl: Pw.map((h) => [h[0] / h[2], h[1] / h[2]] as Vec2), knots, ...(rational ? { w: Pw.map((h) => h[2]) } : {}) };
}
const lerpH = (a: H, b: H, t: number): H => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export const nurbsRange = (c: Nurbs): [number, number] => [c.knots[c.deg], c.knots[c.ctrl.length]];
export const asCurve = (c: Nurbs): Extract<Curve, { k: "nurbs" }> => ({ k: "nurbs", deg: c.deg, ctrl: c.ctrl, knots: c.knots, ...(c.w ? { w: c.w } : {}) });
export const nurbsAt = (c: Nurbs, u: number) => cPoint(asCurve(c), u);

const ktol = (U: number[]) => 1e-12 * Math.max(1, Math.abs(U[0]), Math.abs(U[U.length - 1]));

/** u přichycený na existující uzel (shoda do tolerance) */
function snapKnot(U: number[], u: number): number {
  const t = ktol(U);
  for (const k of U) if (Math.abs(k - u) <= t) return k;
  return u;
}
const mult = (U: number[], u: number) => U.reduce((s, k) => s + (k === u ? 1 : 0), 0);

/** vloží uzel u r-krát (A5.1); vrací nový uzlový vektor a řídicí body */
function insertKnot(p: number, U: number[], Pw: H[], u: number, r0: number): { U: number[]; Pw: H[] } {
  const s = mult(U, u);
  const r = Math.min(r0, p - s);
  if (r <= 0) return { U, Pw };
  const n = Pw.length - 1;
  const mp = n + p + 1;
  let k = -1;
  for (let i = 0; i < U.length; i++) if (U[i] <= u) k = i;
  k = Math.min(k, mp - 1);
  const UQ: number[] = new Array(mp + r + 1);
  for (let i = 0; i <= k; i++) UQ[i] = U[i];
  for (let i = 1; i <= r; i++) UQ[k + i] = u;
  for (let i = k + 1; i <= mp; i++) UQ[i + r] = U[i];
  const Qw: H[] = new Array(n + r + 1);
  for (let i = 0; i <= k - p; i++) Qw[i] = Pw[i];
  for (let i = k - s; i <= n; i++) Qw[i + r] = Pw[i];
  const Rw: H[] = [];
  for (let i = 0; i <= p - s; i++) Rw[i] = Pw[k - p + i].slice() as H;
  let L = 0;
  for (let j = 1; j <= r; j++) {
    L = k - p + j;
    for (let i = 0; i <= p - j - s; i++) {
      const den = U[i + k + 1] - U[L + i];
      const alpha = den === 0 ? 0 : (u - U[L + i]) / den;
      Rw[i] = lerpH(Rw[i], Rw[i + 1], alpha);
    }
    Qw[L] = Rw[0];
    Qw[k + r - j - s] = Rw[p - j - s];
  }
  for (let i = L + 1; i < k - s; i++) Qw[i] = Rw[i - L];
  return { U: UQ, Pw: Qw };
}

/** sevřený začátek / konec (násobnost p+1) */
const clampedStart = (c: Nurbs) => c.knots.slice(0, c.deg + 1).every((k) => k === c.knots[0]);
const clampedEnd = (c: Nurbs) => c.knots.slice(-(c.deg + 1)).every((k) => k === c.knots[c.knots.length - 1]);

/** Rozdělí křivku v parametru u na levou a pravou část (null = část nulové délky). */
export function splitNurbs(c: Nurbs, u0: number): [Nurbs | null, Nurbs | null] {
  const p = c.deg;
  const [lo, hi] = nurbsRange(c);
  const u = snapKnot(c.knots, Math.max(lo, Math.min(hi, u0)));
  if (u <= lo && clampedStart(c)) return [null, c];
  if (u >= hi && clampedEnd(c)) return [c, null];
  const { U, Pw } = insertKnot(p, c.knots, toH(c), u, p);
  let k = -1;
  for (let i = 0; i < U.length; i++) if (U[i] === u) k = i;
  const left = k - p + 1 >= p + 1 ? fromH(p, Pw.slice(0, k - p + 1), [...U.slice(0, k + 1), u]) : null;
  const right = Pw.length - (k - p) >= p + 1 ? fromH(p, Pw.slice(k - p), [u, ...U.slice(k - p + 1)]) : null;
  return [u <= lo ? null : left, u >= hi ? null : right];
}

/** část křivky mezi parametry u0 < u1 (sevřená na obou koncích) */
export function subNurbs(c: Nurbs, u0: number, u1: number): Nurbs | null {
  const [, r] = splitNurbs(c, u0);
  if (!r) return null;
  const [l] = splitNurbs(r, u1);
  return l;
}

/** Spojí dvě sevřené křivky stejného stupně (konec a = začátek b) do jedné (spoj se spojitostí C0). */
export function joinNurbs(a: Nurbs, b: Nurbs): Nurbs {
  if (a.deg !== b.deg) throw new Error("degree");
  const p = a.deg;
  const A = toH(a);
  const B = toH(b);
  // váhy b se přeškálují, aby společný bod měl stejnou homogenní váhu
  const k = A[A.length - 1][2] / B[0][2];
  const Bs = B.map((h) => [h[0] * k, h[1] * k, h[2] * k] as H);
  const ea = a.knots[a.knots.length - 1];
  const sb = b.knots[0];
  const shift = ea - sb;
  const knots = [...a.knots.slice(0, a.knots.length - (p + 1)), ...new Array(p).fill(ea), ...b.knots.slice(p + 1).map((x) => x + shift)];
  return fromH(p, [...A, ...Bs.slice(1)], knots);
}

/** Obrácený směr křivky (stejný tvar, parametr ve stejném rozsahu). */
export function reverseNurbs(c: Nurbs): Nurbs {
  const a = c.knots[0];
  const b = c.knots[c.knots.length - 1];
  return { deg: c.deg, ctrl: [...c.ctrl].reverse(), knots: [...c.knots].reverse().map((x) => a + b - x), ...(c.w ? { w: [...c.w].reverse() } : {}) };
}

/** Rozklad na Bézierovy úseky (každý vnitřní uzel do násobnosti p). */
export function toBeziers(c0: Nurbs): Nurbs[] {
  let c = c0;
  if (!clampedStart(c) || !clampedEnd(c)) c = subNurbs(c, ...nurbsRange(c)) ?? c;
  const p = c.deg;
  let U = c.knots;
  let Pw = toH(c);
  const inner = [...new Set(U.slice(p + 1, U.length - p - 1))];
  for (const u of inner) ({ U, Pw } = insertKnot(p, U, Pw, u, p));
  const out: Nurbs[] = [];
  for (let i = 0; i + p < Pw.length; i += p) {
    const a = U[i + p];
    const b = U[i + p + 1];
    if (!(b > a)) continue;
    out.push(fromH(p, Pw.slice(i, i + p + 1), [...new Array(p + 1).fill(a), ...new Array(p + 1).fill(b)]));
  }
  return out;
}

/** Zvýšení stupně Bézierova úseku o 1 (homogenně – i racionální). */
export function elevateBezier(c: Nurbs): Nurbs {
  const p = c.deg;
  const P = toH(c);
  const Q: H[] = [P[0]];
  for (let i = 1; i <= p; i++) Q.push(lerpH(P[i], P[i - 1], i / (p + 1)));
  Q.push(P[p]);
  const a = c.knots[0];
  const b = c.knots[c.knots.length - 1];
  return fromH(p + 1, Q, [...new Array(p + 2).fill(a), ...new Array(p + 2).fill(b)]);
}

/** úsečka jako Bézierova křivka stupně p */
export function lineNurbs(a: Vec2, b: Vec2, p = 1): Nurbs {
  const L = dist(a, b) || 1;
  const ctrl: Vec2[] = [];
  for (let i = 0; i <= p; i++) ctrl.push([a[0] + ((b[0] - a[0]) * i) / p, a[1] + ((b[1] - a[1]) * i) / p]);
  return { deg: p, ctrl, knots: [...new Array(p + 1).fill(0), ...new Array(p + 1).fill(L)] };
}

/** kruhový oblouk (střed, poloměr, počáteční úhel, znaménkový úhel [rad]) jako racionální kvadratické Bézierovy úseky ≤ 90° */
export function arcNurbs(c: Vec2, r: number, a0: number, sweep: number): Nurbs[] {
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
  const d = sweep / n;
  const out: Nurbs[] = [];
  for (let i = 0; i < n; i++) {
    const s = a0 + d * i;
    const e = s + d;
    const m = (s + e) / 2;
    const w = Math.cos(d / 2);
    const P1 = polar(c, m, r / w);
    const L = Math.abs(d) * r;
    out.push({ deg: 2, ctrl: [polar(c, s, r), P1, polar(c, e, r)], knots: [0, 0, 0, L, L, L], w: [1, w, 1] });
  }
  return out;
}

/** Bézierovy úseky stejného stupně spojené za sebou (parametr = délka tětiv) */
export function chainBeziers(parts: Nurbs[]): Nurbs {
  let acc: Nurbs | null = null;
  for (const b of parts) {
    const span = Math.max(1e-9, polyLen(b.ctrl));
    const nb: Nurbs = { ...b, knots: [...new Array(b.deg + 1).fill(0), ...new Array(b.deg + 1).fill(span)] };
    acc = acc ? joinNurbs(acc, nb) : nb;
  }
  if (!acc) throw new Error("empty");
  return acc;
}
const polyLen = (pts: Vec2[]) => pts.reduce((s, p, i) => (i ? s + dist(p, pts[i - 1]) : 0), 0);

/** úsek na stupeň p (zvyšováním) */
export function toDegree(b: Nurbs, p: number): Nurbs {
  let x = b;
  while (x.deg < p) x = elevateBezier(x);
  return x;
}

/** délka NURBS (Gauss-Legendre na každém uzlovém úseku, 4 díly) mezi parametry */
const G = [
  [-0.960289856497536, 0.10122853629037626],
  [-0.796666477413627, 0.22238103445337448],
  [-0.525532409916329, 0.31370664587788727],
  [-0.18343464249565, 0.36268378337836199],
  [0.18343464249565, 0.36268378337836199],
  [0.525532409916329, 0.31370664587788727],
  [0.796666477413627, 0.22238103445337448],
  [0.960289856497536, 0.10122853629037626],
];
/** integrál rychlosti |C'(t)| na intervalu (Gauss 8 bodů na dílcích) */
export function speedIntegral(speed: (t: number) => number, a: number, b: number, parts = 8): number {
  if (!(b > a)) return 0;
  let s = 0;
  for (let q = 0; q < parts; q++) {
    const aa = a + ((b - a) * q) / parts;
    const bb = a + ((b - a) * (q + 1)) / parts;
    const h = (bb - aa) / 2;
    const m = (aa + bb) / 2;
    for (const [x, w] of G) s += w * speed(m + h * x) * h;
  }
  return s;
}

/** délka křivky NURBS mezi u0 a u1 (uzlové úseky se integrují zvlášť) */
export function nurbsLen(c: Nurbs, u0: number, u1: number): number {
  const cc = asCurve(c);
  const speed = (t: number) => len(cDeriv(cc, t));
  const brk = [u0, ...[...new Set(c.knots)].filter((k) => k > u0 && k < u1), u1];
  let s = 0;
  for (let i = 1; i < brk.length; i++) s += speedIntegral(speed, brk[i - 1], brk[i], 6);
  return s;
}

/** parametr t, kde délka od u0 dosáhne s (Newton s půlením intervalu) */
export function paramAtLen(lenFn: (a: number, b: number) => number, speed: (t: number) => number, u0: number, hi: number, s: number): number {
  if (s <= 0) return u0;
  const total = lenFn(u0, hi);
  if (s >= total) return hi;
  let lo = u0;
  let up = hi;
  let t = u0 + ((hi - u0) * s) / total;
  for (let k = 0; k < 60; k++) {
    const f = lenFn(u0, t) - s;
    if (Math.abs(f) < 1e-12 * Math.max(1, total)) break;
    if (f > 0) up = t;
    else lo = t;
    const sp = speed(t);
    let nt = sp > 1e-300 ? t - f / sp : (lo + up) / 2;
    if (!(nt > lo && nt < up)) nt = (lo + up) / 2;
    t = nt;
  }
  return t;
}

/** jednotková tečna NURBS v parametru */
export const nurbsTan = (c: Nurbs, u: number): Vec2 => unit(cDeriv(asCurve(c), u));

/** body proložení → je vnitřní řídicí polygon dostatečně blízko? (pomůcka testů) */
export const nurbsCtrlLen = (c: Nurbs) => polyLen(c.ctrl);

/** kružnice / úplný oblouk jako uzavřená NURBS (4 čtvrtiny) */
export const circleNurbs = (c: Vec2, r: number, a0 = 0) => chainBeziers(arcNurbs(c, r, a0, TAU));

