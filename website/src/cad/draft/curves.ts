/**
 * Křivky 2D výkresu pro výpočty (uchopení, průsečíky, vzdálenost, výběr, tečny, kolmice):
 * úsečka / polopřímka / přímka, kruhový oblouk, eliptický oblouk a NURBS. Průsečíky úseček a oblouků jsou analytické,
 * u elips a splajnů se najdou na vzorkování a zpřesní Newtonovou metodou (strojová přesnost).
 */
import type { Vec2 } from "./model";
import { add, angleOf, arcBox, boxAdd, boxOf, closestOnSeg, cross, dist, dot, emptyBox, len, mul, normA, onSweep, polar, rot90, sub, TAU, xfPt, xfUniform, xfVec, type Affine, type Box } from "./geom";

/**
 * - line: a → b, parametr t ∈ [0,1]; `inf` 1 = polopřímka (t ≥ 0), 2 = přímka (všechna t) – pak b = a + směr
 * - arc: střed, poloměr, počátek `a0` a úhel `sweep` > 0 proti směru hodin [rad]; t = úhel od a0 (0…sweep); `rev` = zdroj jde opačně
 * - ell: P(t) = c + u·cos t + v·sin t, t ∈ [t0, t1] (rad, t1 > t0)
 * - nurbs: stupeň, řídicí body, uzly, váhy; t ∈ [knots[deg], knots[ctrl.length]]
 * `seg` = pořadí úseku ve zdrojové entitě (křivka: index vrcholu, kde úsek začíná)
 */
export type Curve =
  | { k: "line"; a: Vec2; b: Vec2; inf?: 0 | 1 | 2; seg?: number }
  | { k: "arc"; c: Vec2; r: number; a0: number; sweep: number; rev?: boolean; seg?: number }
  | { k: "ell"; c: Vec2; u: Vec2; v: Vec2; t0: number; t1: number; seg?: number }
  | { k: "nurbs"; deg: number; ctrl: Vec2[]; knots: number[]; w?: number[]; seg?: number };

// ---------------------------------------------------------------- NURBS (Piegl & Tiller)

export function findSpan(n: number, p: number, u: number, U: number[]): number {
  if (u >= U[n + 1]) return n;
  if (u <= U[p]) return p;
  let lo = p;
  let hi = n + 1;
  let m = (lo + hi) >> 1;
  while (u < U[m] || u >= U[m + 1]) {
    if (u < U[m]) hi = m;
    else lo = m;
    m = (lo + hi) >> 1;
  }
  return m;
}

/** derivace bázových funkcí do řádu nd (A2.3): ders[k][j] = N^(k)_{i-p+j,p}(u) */
export function dersBasis(i: number, u: number, p: number, nd: number, U: number[]): number[][] {
  const ndu: number[][] = Array.from({ length: p + 1 }, () => new Array(p + 1).fill(0));
  const left = new Array(p + 1).fill(0);
  const right = new Array(p + 1).fill(0);
  ndu[0][0] = 1;
  for (let j = 1; j <= p; j++) {
    left[j] = u - U[i + 1 - j];
    right[j] = U[i + j] - u;
    let saved = 0;
    for (let r = 0; r < j; r++) {
      ndu[j][r] = right[r + 1] + left[j - r];
      const temp = ndu[j][r] === 0 ? 0 : ndu[r][j - 1] / ndu[j][r];
      ndu[r][j] = saved + right[r + 1] * temp;
      saved = left[j - r] * temp;
    }
    ndu[j][j] = saved;
  }
  const ders: number[][] = Array.from({ length: nd + 1 }, () => new Array(p + 1).fill(0));
  for (let j = 0; j <= p; j++) ders[0][j] = ndu[j][p];
  const a: number[][] = [new Array(p + 1).fill(0), new Array(p + 1).fill(0)];
  for (let r = 0; r <= p; r++) {
    let s1 = 0;
    let s2 = 1;
    a[0][0] = 1;
    for (let k = 1; k <= nd; k++) {
      let d = 0;
      const rk = r - k;
      const pk = p - k;
      if (r >= k) {
        a[s2][0] = ndu[pk + 1][rk] === 0 ? 0 : a[s1][0] / ndu[pk + 1][rk];
        d = a[s2][0] * ndu[rk][pk];
      }
      const j1 = rk >= -1 ? 1 : -rk;
      const j2 = r - 1 <= pk ? k - 1 : p - r;
      for (let j = j1; j <= j2; j++) {
        a[s2][j] = ndu[pk + 1][rk + j] === 0 ? 0 : (a[s1][j] - a[s1][j - 1]) / ndu[pk + 1][rk + j];
        d += a[s2][j] * ndu[rk + j][pk];
      }
      if (r <= pk) {
        a[s2][k] = ndu[pk + 1][r] === 0 ? 0 : -a[s1][k - 1] / ndu[pk + 1][r];
        d += a[s2][k] * ndu[r][pk];
      }
      ders[k][r] = d;
      const t = s1;
      s1 = s2;
      s2 = t;
    }
  }
  let r = p;
  for (let k = 1; k <= nd; k++) {
    for (let j = 0; j <= p; j++) ders[k][j] *= r;
    r *= p - k;
  }
  return ders;
}

/** bod a derivace NURBS v parametru u: [C, C', C''] */
export function nurbsDerivs(deg: number, ctrl: Vec2[], U: number[], w: number[] | undefined, u: number, nd = 1): Vec2[] {
  const n = ctrl.length - 1;
  const p = Math.min(deg, n);
  const span = findSpan(n, p, u, U);
  const N = dersBasis(span, u, p, nd, U);
  // homogenní souřadnice
  const A: [number, number, number][] = [];
  for (let k = 0; k <= nd; k++) {
    let x = 0;
    let y = 0;
    let ww = 0;
    for (let j = 0; j <= p; j++) {
      const idx = span - p + j;
      const wi = w?.[idx] ?? 1;
      const b = N[k][j] * wi;
      x += b * ctrl[idx][0];
      y += b * ctrl[idx][1];
      ww += b;
    }
    A.push([x, y, ww]);
  }
  const out: Vec2[] = [];
  const W0 = A[0][2] || 1;
  out.push([A[0][0] / W0, A[0][1] / W0]);
  if (nd >= 1) out.push([(A[1][0] - A[1][2] * out[0][0]) / W0, (A[1][1] - A[1][2] * out[0][1]) / W0]);
  if (nd >= 2) out.push([(A[2][0] - 2 * A[1][2] * out[1][0] - A[2][2] * out[0][0]) / W0, (A[2][1] - 2 * A[1][2] * out[1][1] - A[2][2] * out[0][1]) / W0]);
  return out;
}

/** rovnoměrný sevřený uzlový vektor pro n+1 řídicích bodů a stupeň p */
export function clampedKnots(nCtrl: number, p: number): number[] {
  const U: number[] = [];
  const inner = nCtrl - p - 1;
  for (let i = 0; i <= p; i++) U.push(0);
  for (let i = 1; i <= inner; i++) U.push(i);
  for (let i = 0; i <= p; i++) U.push(inner + 1);
  return U;
}

/** řešení soustavy s pásovou maticí (Gaussova eliminace s výběrem hlavního prvku v pásu) */
function solveBand(A: number[][], B: number[][], w: number): number[][] {
  const m = A.length;
  for (let i = 0; i < m; i++) {
    let piv = i;
    for (let r = i + 1; r < Math.min(m, i + w + 1); r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
    if (piv !== i) {
      [A[i], A[piv]] = [A[piv], A[i]];
      [B[i], B[piv]] = [B[piv], B[i]];
    }
    const d = A[i][i];
    if (Math.abs(d) < 1e-300) throw new Error("singular");
    for (let r = i + 1; r < Math.min(m, i + w + 1); r++) {
      const f = A[r][i] / d;
      if (f === 0) continue;
      for (let c = i; c < Math.min(m, i + 2 * w + 2); c++) A[r][c] -= f * A[i][c];
      for (let c = 0; c < B[r].length; c++) B[r][c] -= f * B[i][c];
    }
  }
  const X: number[][] = new Array(m);
  for (let i = m - 1; i >= 0; i--) {
    const row = B[i].slice();
    for (let c = i + 1; c < Math.min(m, i + 2 * w + 2); c++) if (A[i][c]) for (let k = 0; k < row.length; k++) row[k] -= A[i][c] * X[c][k];
    X[i] = row.map((v) => v / A[i][i]);
  }
  return X;
}

/**
 * Kubický splajn procházející body (globální interpolace, parametrizace délkou tětiv – jako „Tětiva“ v AutoCADu).
 * Konce: zadané tečny (směr), jinak přirozené (nulová 2. derivace). Uzavřená = první bod na konci a shodné tečny.
 */
export function interpolateFit(fit0: Vec2[], opts: { tan0?: Vec2; tan1?: Vec2; closed?: boolean } = {}): { degree: number; ctrl: Vec2[]; knots: number[] } {
  const fit = fit0.filter((p, i) => i === 0 || dist(p, fit0[i - 1]) > 1e-12);
  let tan0 = opts.tan0;
  let tan1 = opts.tan1;
  if (opts.closed && fit.length >= 3) {
    if (dist(fit[0], fit[fit.length - 1]) > 1e-12) fit.push(fit[0]);
    const t = sub(fit[1], fit[fit.length - 2]);
    tan0 = tan1 = mul(t, 1 / (len(t) || 1));
  }
  if (fit.length < 2) throw new Error("spline: málo bodů");
  if (fit.length === 2 && !tan0 && !tan1) {
    // úsečka jako kubický splajn
    const [a, b] = fit;
    const L = dist(a, b);
    return { degree: 3, ctrl: [a, add(a, mul(sub(b, a), 1 / 3)), add(a, mul(sub(b, a), 2 / 3)), b], knots: [0, 0, 0, 0, L, L, L, L] };
  }
  const n = fit.length - 1;
  const u: number[] = [0];
  for (let i = 1; i <= n; i++) u.push(u[i - 1] + dist(fit[i], fit[i - 1]));
  const p = 3;
  const U = [u[0], u[0], u[0], u[0], ...u.slice(1, n), u[n], u[n], u[n], u[n]];
  const m = n + 3; // počet řídicích bodů
  const A: number[][] = Array.from({ length: m }, () => new Array(m).fill(0));
  const B: number[][] = Array.from({ length: m }, () => [0, 0]);
  const rowFor = (uu: number, order: number) => {
    const span = findSpan(m - 1, p, uu, U);
    const N = dersBasis(span, uu, p, order, U);
    const r = new Array(m).fill(0);
    for (let j = 0; j <= p; j++) r[span - p + j] = N[order][j];
    return r;
  };
  // pořadí řádků: Q0, konec 0, Q1 … Q(n-1), konec n, Qn (pásová matice)
  let row = 0;
  const put = (r: number[], rhs: Vec2) => {
    A[row] = r;
    B[row] = [rhs[0], rhs[1]];
    row++;
  };
  put(rowFor(u[0], 0), fit[0]);
  put(rowFor(u[0], tan0 ? 1 : 2), tan0 ? mul(tan0, 1 / (len(tan0) || 1)) : [0, 0]);
  for (let i = 1; i < n; i++) put(rowFor(u[i], 0), fit[i]);
  put(rowFor(u[n], tan1 ? 1 : 2), tan1 ? mul(tan1, 1 / (len(tan1) || 1)) : [0, 0]);
  put(rowFor(u[n], 0), fit[n]);
  const X = solveBand(A, B, 4);
  return { degree: 3, ctrl: X.map((r) => [r[0], r[1]] as Vec2), knots: U };
}

// ---------------------------------------------------------------- vyhodnocení křivek

export function cRange(c: Curve): [number, number] {
  switch (c.k) {
    case "line":
      return c.inf === 2 ? [-Infinity, Infinity] : c.inf === 1 ? [0, Infinity] : [0, 1];
    case "arc":
      return [0, c.sweep];
    case "ell":
      return [c.t0, c.t1];
    case "nurbs":
      return [c.knots[c.deg], c.knots[c.ctrl.length]];
  }
}

export function cPoint(c: Curve, t: number): Vec2 {
  switch (c.k) {
    case "line":
      return [c.a[0] + (c.b[0] - c.a[0]) * t, c.a[1] + (c.b[1] - c.a[1]) * t];
    case "arc":
      return polar(c.c, c.a0 + t, c.r);
    case "ell":
      return [c.c[0] + c.u[0] * Math.cos(t) + c.v[0] * Math.sin(t), c.c[1] + c.u[1] * Math.cos(t) + c.v[1] * Math.sin(t)];
    case "nurbs":
      return nurbsDerivs(c.deg, c.ctrl, c.knots, c.w, clampT(c, t), 0)[0];
  }
}

export function cDeriv(c: Curve, t: number): Vec2 {
  switch (c.k) {
    case "line":
      return sub(c.b, c.a);
    case "arc":
      return [-c.r * Math.sin(c.a0 + t), c.r * Math.cos(c.a0 + t)];
    case "ell":
      return [-c.u[0] * Math.sin(t) + c.v[0] * Math.cos(t), -c.u[1] * Math.sin(t) + c.v[1] * Math.cos(t)];
    case "nurbs":
      return nurbsDerivs(c.deg, c.ctrl, c.knots, c.w, clampT(c, t), 1)[1];
  }
}

function cDeriv2(c: Curve, t: number): Vec2 {
  switch (c.k) {
    case "line":
      return [0, 0];
    case "arc":
      return mul(sub(cPoint(c, t), c.c), -1);
    case "ell":
      return mul(sub(cPoint(c, t), c.c), -1);
    case "nurbs":
      return nurbsDerivs(c.deg, c.ctrl, c.knots, c.w, clampT(c, t), 2)[2];
  }
}

const clampT = (c: Extract<Curve, { k: "nurbs" }>, t: number) => Math.max(c.knots[c.deg], Math.min(c.knots[c.ctrl.length], t));

export const cStart = (c: Curve): Vec2 => (c.k === "line" ? c.a : cPoint(c, cRange(c)[0]));
export const cEnd = (c: Curve): Vec2 => (c.k === "line" ? c.b : cPoint(c, cRange(c)[1]));

/** vzorky křivky (body a parametry); nekonečné přímky se vzorkovat nedají – vrací 2 body definice */
export function cSample(c: Curve, n?: number): { pts: Vec2[]; ts: number[] } {
  if (c.k === "line") return { pts: [c.a, c.b], ts: [0, 1] };
  const [t0, t1] = cRange(c);
  const N =
    n ??
    (c.k === "arc"
      ? Math.max(8, Math.ceil((c.sweep / TAU) * 128))
      : c.k === "ell"
        ? Math.max(16, Math.ceil(((t1 - t0) / TAU) * 160))
        : Math.min(2000, Math.max(24, (c.ctrl.length - c.deg) * 16)));
  const pts: Vec2[] = [];
  const ts: number[] = [];
  for (let i = 0; i <= N; i++) {
    const t = t0 + ((t1 - t0) * i) / N;
    ts.push(t);
    pts.push(cPoint(c, t));
  }
  return { pts, ts };
}

/** obálka křivky (nekonečné přímky → null) */
export function cBox(c: Curve): Box | null {
  if (c.k === "line") return c.inf ? null : boxOf([c.a, c.b]);
  if (c.k === "arc") return arcBox(c.c, c.r, c.a0, c.sweep);
  if (c.k === "nurbs") return boxOf(c.ctrl); // konvexní obal řídicích bodů obsahuje křivku
  const b = emptyBox();
  for (const p of cSample(c, 64).pts) boxAdd(b, p);
  // vzorky elipsy jsou uvnitř – rozšířit o nejvyšší možnou chybu tětivy
  const r = Math.max(len(c.u), len(c.v));
  const e = r * (1 - Math.cos(Math.PI / 64));
  return { x0: b.x0 - e, y0: b.y0 - e, x1: b.x1 + e, y1: b.y1 + e };
}

/** délka křivky (Gaussova kvadratura u elipsy a splajnu) */
export function cLength(c: Curve): number {
  if (c.k === "line") return c.inf ? Infinity : dist(c.a, c.b);
  if (c.k === "arc") return c.r * c.sweep;
  const [t0, t1] = cRange(c);
  const G = [
    [-0.906179845938664, 0.236926885056189],
    [-0.538469310105683, 0.478628670499366],
    [0, 0.568888888888889],
    [0.538469310105683, 0.478628670499366],
    [0.906179845938664, 0.236926885056189],
  ];
  const brk = c.k === "nurbs" ? [...new Set(c.knots.slice(c.deg, c.ctrl.length + 1))] : Array.from({ length: 33 }, (_, i) => t0 + ((t1 - t0) * i) / 32);
  let s = 0;
  for (let i = 1; i < brk.length; i++) {
    const a = brk[i - 1];
    const b = brk[i];
    if (b <= a) continue;
    // každý úsek ještě na 4 díly (přesnost u silně zakřivených úseků)
    for (let q = 0; q < 4; q++) {
      const aa = a + ((b - a) * q) / 4;
      const bb = a + ((b - a) * (q + 1)) / 4;
      for (const [x, wgt] of G) s += wgt * len(cDeriv(c, (aa + bb) / 2 + ((bb - aa) / 2) * x)) * ((bb - aa) / 2);
    }
  }
  return s;
}

/** Nejbližší bod křivky k bodu p. */
export function cClosest(c: Curve, p: Vec2): { t: number; p: Vec2; d: number } {
  if (c.k === "line") {
    const r = closestOnSeg(p, c.a, c.b, false);
    const t = c.inf === 2 ? r.t : c.inf === 1 ? Math.max(0, r.t) : Math.max(0, Math.min(1, r.t));
    const q = cPoint(c, t);
    return { t, p: q, d: dist(p, q) };
  }
  if (c.k === "arc") {
    const a = angleOf(sub(p, c.c));
    let t = normA(a - c.a0);
    if (t > c.sweep + 1e-12) t = dist(p, cPoint(c, 0)) <= dist(p, cPoint(c, c.sweep)) ? 0 : c.sweep;
    else t = Math.min(t, c.sweep);
    const q = cPoint(c, t);
    return { t, p: q, d: dist(p, q) };
  }
  const { pts, ts } = cSample(c);
  let bi = 0;
  let bd = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = dist(p, pts[i]);
    if (d < bd) {
      bd = d;
      bi = i;
    }
  }
  // zpřesnění: úsek mezi sousedními vzorky + Newton na (P−p)·P' = 0
  const [lo, hi] = cRange(c);
  let t = ts[bi];
  for (let k = 0; k < 30; k++) {
    const P = cPoint(c, t);
    const d1 = cDeriv(c, t);
    const d2 = cDeriv2(c, t);
    const f = dot(sub(P, p), d1);
    const fp = dot(d1, d1) + dot(sub(P, p), d2);
    if (Math.abs(fp) < 1e-300) break;
    const nt = Math.max(lo, Math.min(hi, t - f / fp));
    if (Math.abs(nt - t) < 1e-14 * Math.max(1, Math.abs(t))) {
      t = nt;
      break;
    }
    t = nt;
  }
  const q = cPoint(c, t);
  const sq = pts[bi];
  if (dist(p, sq) < dist(p, q)) return { t: ts[bi], p: sq, d: dist(p, sq) };
  return { t, p: q, d: dist(p, q) };
}

// ---------------------------------------------------------------- průsečíky

const inRange = (c: Curve, t: number, tol = 1e-9) => {
  const [a, b] = cRange(c);
  const s = c.k === "line" ? tol : c.k === "arc" ? tol : tol * Math.max(1, Math.abs(b - a));
  return t >= a - s && t <= b + s;
};

/** parametr bodu na kružnici oblouku (úhel od a0) – null mimo oblouk */
const arcParam = (c: Extract<Curve, { k: "arc" }>, p: Vec2, tol = 1e-9): number | null => {
  const a = angleOf(sub(p, c.c));
  const t = normA(a - c.a0);
  if (onSweep(a, c.a0, c.sweep, tol)) return t > c.sweep ? (t > TAU - tol ? 0 : c.sweep) : t;
  return null;
};

function lineLine(c1: Extract<Curve, { k: "line" }>, c2: Extract<Curve, { k: "line" }>, ext: boolean): Vec2[] {
  const d1 = sub(c1.b, c1.a);
  const d2 = sub(c2.b, c2.a);
  const den = cross(d1, d2);
  if (Math.abs(den) < 1e-14 * len(d1) * len(d2)) return [];
  const w = sub(c2.a, c1.a);
  const t = cross(w, d2) / den;
  const s = cross(w, d1) / den;
  if (!ext && (!inRange(c1, t) || !inRange(c2, s))) return [];
  return [cPoint(c1, t)];
}

function lineCircle(l: Extract<Curve, { k: "line" }>, c: Vec2, r: number): { p: Vec2; t: number }[] {
  const d = sub(l.b, l.a);
  const f = sub(l.a, c);
  const A = dot(d, d);
  const B = 2 * dot(f, d);
  const C = dot(f, f) - r * r;
  let disc = B * B - 4 * A * C;
  if (disc < 0) {
    if (disc > -1e-12 * B * B) disc = 0;
    else return [];
  }
  const sq = Math.sqrt(disc);
  const ts = disc === 0 ? [-B / (2 * A)] : [(-B - sq) / (2 * A), (-B + sq) / (2 * A)];
  return ts.map((t) => ({ t, p: cPoint(l, t) }));
}

function circleCircle(c1: Vec2, r1: number, c2: Vec2, r2: number): Vec2[] {
  const d = dist(c1, c2);
  if (d < 1e-14 || d > r1 + r2 + 1e-12 || d < Math.abs(r1 - r2) - 1e-12) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h2 = r1 * r1 - a * a;
  const h = h2 > 0 ? Math.sqrt(h2) : 0;
  const ex = mul(sub(c2, c1), 1 / d);
  const pm = add(c1, mul(ex, a));
  if (h < 1e-12 * Math.max(r1, r2)) return [pm];
  const n = rot90(ex);
  return [add(pm, mul(n, h)), add(pm, mul(n, -h))];
}

/** Průsečíky dvou křivek; `ext` = úsečky a oblouky jako nekonečné přímky / celé kružnice (zdánlivý průsečík, prodloužení). */
export function cIntersect(c1: Curve, c2: Curve, ext = false): Vec2[] {
  if (c1.k === "line" && c2.k === "line") return lineLine(c1, c2, ext);
  if (c1.k === "line" && c2.k === "arc") return lineArc(c1, c2, ext);
  if (c1.k === "arc" && c2.k === "line") return lineArc(c2, c1, ext);
  if (c1.k === "arc" && c2.k === "arc") {
    return circleCircle(c1.c, c1.r, c2.c, c2.r).filter((p) => ext || (arcParam(c1, p, 1e-9) !== null && arcParam(c2, p, 1e-9) !== null));
  }
  return genericIntersect(c1, c2);
}

function lineArc(l: Extract<Curve, { k: "line" }>, a: Extract<Curve, { k: "arc" }>, ext: boolean): Vec2[] {
  return lineCircle(l, a.c, a.r)
    .filter((h) => ext || (inRange(l, h.t) && arcParam(a, h.p, 1e-9) !== null))
    .map((h) => h.p);
}

/** vzorkovaná lomená čára křivky (nekonečné přímky oříznuté na obálku druhé křivky) */
function polyOf(c: Curve, clip: Box | null): { pts: Vec2[]; ts: number[] } {
  if (c.k === "line" && c.inf) {
    const B = clip ?? { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 };
    const span = Math.hypot(B.x1 - B.x0, B.y1 - B.y0) + dist(c.a, [(B.x0 + B.x1) / 2, (B.y0 + B.y1) / 2]) + 1;
    const dl = len(sub(c.b, c.a)) || 1;
    const t0 = c.inf === 2 ? -span / dl : 0;
    const t1 = span / dl;
    return { pts: [cPoint(c, t0), cPoint(c, t1)], ts: [t0, t1] };
  }
  return cSample(c);
}

function genericIntersect(c1: Curve, c2: Curve): Vec2[] {
  const b1 = cBox(c1);
  const b2 = cBox(c2);
  const s1 = polyOf(c1, b2);
  const s2 = polyOf(c2, b1);
  const out: Vec2[] = [];
  for (let i = 1; i < s1.pts.length; i++) {
    const a = s1.pts[i - 1];
    const b = s1.pts[i];
    const sb = boxOf([a, b]);
    for (let j = 1; j < s2.pts.length; j++) {
      const c = s2.pts[j - 1];
      const d = s2.pts[j];
      if (Math.max(c[0], d[0]) < sb.x0 - 1e-9 || Math.min(c[0], d[0]) > sb.x1 + 1e-9 || Math.max(c[1], d[1]) < sb.y0 - 1e-9 || Math.min(c[1], d[1]) > sb.y1 + 1e-9) continue;
      const r = segSeg(a, b, c, d);
      if (!r) continue;
      // Newton: P1(t) − P2(s) = 0
      let t = s1.ts[i - 1] + (s1.ts[i] - s1.ts[i - 1]) * r[0];
      let s = s2.ts[j - 1] + (s2.ts[j] - s2.ts[j - 1]) * r[1];
      for (let k = 0; k < 40; k++) {
        const F = sub(cPoint(c1, t), cPoint(c2, s));
        if (Math.abs(F[0]) + Math.abs(F[1]) < 1e-13) break;
        const J1 = cDeriv(c1, t);
        const J2 = mul(cDeriv(c2, s), -1);
        const det = cross(J1, J2);
        if (Math.abs(det) < 1e-300) break;
        const dt = cross(F, J2) / det;
        const ds = cross(J1, F) / det;
        t -= dt;
        s -= ds;
      }
      const p = cPoint(c1, t);
      if (!Number.isFinite(p[0]) || dist(p, cPoint(c2, s)) > 1e-6 * Math.max(1, len(p))) {
        out.push(lerp2(a, b, r[0]));
        continue;
      }
      if (!inRange(c1, t, 1e-7) || !inRange(c2, s, 1e-7)) continue;
      out.push(p);
    }
  }
  // duplicity (průsečík ve vrcholu vzorkování)
  const uniq: Vec2[] = [];
  for (const p of out) if (!uniq.some((q) => dist(p, q) < 1e-7 * Math.max(1, len(p)))) uniq.push(p);
  return uniq;
}
const lerp2 = (a: Vec2, b: Vec2, t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

function segSeg(a: Vec2, b: Vec2, c: Vec2, d: Vec2): [number, number] | null {
  const r = sub(b, a);
  const s = sub(d, c);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-300) return null;
  const w = sub(c, a);
  const t = cross(w, s) / den;
  const u = cross(w, r) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return [t, u];
}

// ---------------------------------------------------------------- tečny a kolmice z bodu

/** kořeny f(t) na rozsahu křivky (vzorkování + sečny/bisekce) */
function rootsOn(c: Curve, f: (t: number) => number): number[] {
  const { ts } = cSample(c);
  const out: number[] = [];
  let fa = f(ts[0]);
  if (Math.abs(fa) < 1e-12) out.push(ts[0]);
  for (let i = 1; i < ts.length; i++) {
    const fb = f(ts[i]);
    if (Math.abs(fb) < 1e-12) out.push(ts[i]);
    else if (fa * fb < 0) {
      let lo = ts[i - 1];
      let hi = ts[i];
      let flo = fa;
      for (let k = 0; k < 80; k++) {
        const m = (lo + hi) / 2;
        const fm = f(m);
        if (flo * fm <= 0) hi = m;
        else {
          lo = m;
          flo = fm;
        }
      }
      out.push((lo + hi) / 2);
    }
    fa = fb;
  }
  return out;
}

/** Paty kolmic z bodu p na křivku (úsečky jako přímky – AutoCAD uchopuje kolmo i na prodloužení). */
export function cPerpFrom(c: Curve, p: Vec2): Vec2[] {
  if (c.k === "line") return [closestOnSeg(p, c.a, c.b, false).p];
  if (c.k === "arc") {
    const d = sub(p, c.c);
    if (len(d) < 1e-12) return [];
    const a = angleOf(d);
    return [a, a + Math.PI].filter((x) => onSweep(x, c.a0, c.sweep)).map((x) => polar(c.c, x, c.r));
  }
  return rootsOn(c, (t) => dot(sub(cPoint(c, t), p), cDeriv(c, t))).map((t) => cPoint(c, t));
}

/** Body dotyku tečen z bodu p ke křivce. */
export function cTangentFrom(c: Curve, p: Vec2): Vec2[] {
  if (c.k === "line") return [];
  if (c.k === "arc") {
    const d = dist(p, c.c);
    if (d <= c.r + 1e-12) return [];
    const base = angleOf(sub(p, c.c));
    const off = Math.acos(c.r / d);
    return [base + off, base - off].filter((x) => onSweep(x, c.a0, c.sweep)).map((x) => polar(c.c, x, c.r));
  }
  return rootsOn(c, (t) => cross(sub(cPoint(c, t), p), cDeriv(c, t))).map((t) => cPoint(c, t));
}

// ---------------------------------------------------------------- transformace

/** Křivka po afinní transformaci (oblouk při nestejném měřítku → eliptický oblouk; zrcadlení obrací směr oblouku). */
export function cTransform(c: Curve, m: Affine): Curve {
  switch (c.k) {
    case "line":
      return { ...c, a: xfPt(m, c.a), b: xfPt(m, c.b) };
    case "arc": {
      const k = xfUniform(m);
      const det = m[0] * m[3] - m[1] * m[2];
      if (k !== null) {
        const cc = xfPt(m, c.c);
        if (det > 0) return { ...c, c: cc, r: c.r * k, a0: normA(angleOf(sub(xfPt(m, polar(c.c, c.a0, c.r)), cc))) };
        // zrcadlení: konec se stane začátkem
        return { ...c, c: cc, r: c.r * k, a0: normA(angleOf(sub(xfPt(m, polar(c.c, c.a0 + c.sweep, c.r)), cc))), rev: !c.rev };
      }
      return { k: "ell", c: xfPt(m, c.c), u: xfVec(m, [c.r * Math.cos(c.a0), c.r * Math.sin(c.a0)]), v: xfVec(m, [-c.r * Math.sin(c.a0), c.r * Math.cos(c.a0)]), t0: 0, t1: c.sweep, seg: c.seg };
    }
    case "ell":
      return { ...c, c: xfPt(m, c.c), u: xfVec(m, c.u), v: xfVec(m, c.v) };
    case "nurbs":
      return { ...c, ctrl: c.ctrl.map((p) => xfPt(m, p)) };
  }
}

/**
 * Elipsa z dvojice sdružených poloos (P = c + u cos t + v sin t) → hlavní poloosa, poměr a posun parametru tak, aby
 * vedlejší poloosa byla hlavní otočená o +90°. Vrací i zda se směr parametru obrátil (zrcadlení).
 */
export function ellipseAxes(u: Vec2, v: Vec2): { major: Vec2; ratio: number; shift: number; flip: boolean } {
  const ts = 0.5 * Math.atan2(2 * dot(u, v), dot(u, u) - dot(v, v));
  let A: Vec2 = add(mul(u, Math.cos(ts)), mul(v, Math.sin(ts)));
  let Bv: Vec2 = add(mul(u, -Math.sin(ts)), mul(v, Math.cos(ts)));
  let shift = ts;
  if (len(A) < len(Bv)) {
    // hlavní je B: P = c + B cos s' − A sin s', s' = s − π/2
    const nA: Vec2 = Bv;
    const nB: Vec2 = mul(A, -1);
    A = nA;
    Bv = nB;
    shift += Math.PI / 2;
  }
  const flip = cross(A, Bv) < 0;
  const ratio = Math.min(1, len(Bv) / (len(A) || 1));
  return { major: A, ratio, shift, flip };
}
