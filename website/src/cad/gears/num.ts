/** Kola a ozubení – drobná numerika: evolventní funkce a její inverze, otáčení, půlení intervalu, Newton, Greenova plocha. */
import type { Seg2, Vec2 } from "./types";

export const DEG = Math.PI / 180;
export const TAU = 2 * Math.PI;
/** evolventní funkce inv α = tan α − α (rad) */
export const inv = (a: number) => Math.tan(a) - a;
/** inverze evolventní funkce: α z inv α (Newton, start (3y)^(1/3)) */
export function invInverse(y: number): number {
  if (!(y > 0)) return 0;
  let a = Math.min(1.5, Math.cbrt(3 * y));
  for (let i = 0; i < 60; i++) {
    const t = Math.tan(a);
    const d = (t - a - y) / (t * t || 1e-300);
    a -= d;
    if (a <= 0) a = 1e-9;
    if (a >= Math.PI / 2) a = Math.PI / 2 - 1e-9;
    if (Math.abs(d) < 1e-15) break;
  }
  return a;
}
export const polar = (r: number, a: number): Vec2 => [r * Math.cos(a), r * Math.sin(a)];
export const rot2 = (p: Vec2, a: number): Vec2 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c * p[0] - s * p[1], s * p[0] + c * p[1]];
};
export const mirrorX = (p: Vec2): Vec2 => [p[0], -p[1]];
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const round = (v: number, d = 6) => {
  const k = 10 ** d;
  return Math.round(v * k) / k;
};

/** kořen f na [a, b] půlením (f(a) a f(b) mají opačná znaménka; jinak vrátí bližší kraj) */
export function bisect(f: (x: number) => number, a: number, b: number, n = 100): number {
  let fa = f(a);
  const fb = f(b);
  if (fa === 0) return a;
  if (fb === 0) return b;
  if (fa * fb > 0) return Math.abs(fa) < Math.abs(fb) ? a : b;
  for (let i = 0; i < n; i++) {
    const m = (a + b) / 2;
    const fm = f(m);
    if (fm === 0 || Math.abs(b - a) < 1e-15 * Math.max(1, Math.abs(m))) return m;
    if (fa * fm < 0) b = m;
    else {
      a = m;
      fa = fm;
    }
  }
  return (a + b) / 2;
}

/** řešení malé soustavy A·x = b (Gauss s částečným výběrem); null = singulární */
export function solveLin(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let i = c + 1; i < n; i++) if (Math.abs(M[i][c]) > Math.abs(M[p][c])) p = i;
    if (Math.abs(M[p][c]) < 1e-14) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let i = c + 1; i < n; i++) {
      const k = M[i][c] / M[c][c];
      for (let j = c; j <= n; j++) M[i][j] -= k * M[c][j];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

/** Newton s numerickým jakobiánem pro malou soustavu f(x) = 0; null = nekonverguje */
export function newton(f: (x: number[]) => number[], x0: number[], o: { tol?: number; iter?: number; step?: number } = {}): number[] | null {
  let x = [...x0];
  const tol = o.tol ?? 1e-11;
  for (let it = 0; it < (o.iter ?? 60); it++) {
    const fx = f(x);
    const err = Math.hypot(...fx);
    if (!Number.isFinite(err)) return null;
    if (err < tol) return x;
    const J = fx.map(() => new Array<number>(x.length).fill(0));
    for (let j = 0; j < x.length; j++) {
      const h = (o.step ?? 1e-6) * Math.max(1, Math.abs(x[j]));
      const xp = [...x];
      xp[j] += h;
      const xm = [...x];
      xm[j] -= h;
      const fp = f(xp);
      const fm = f(xm);
      for (let i = 0; i < fx.length; i++) J[i][j] = (fp[i] - fm[i]) / (2 * h);
    }
    const dx = solveLin(J, fx.map((v) => -v));
    if (!dx) return null;
    // tlumení: krok zkracovat, dokud chyba neklesne
    let k = 1;
    let next = x;
    for (let s = 0; s < 12; s++) {
      next = x.map((v, i) => v + k * dx[i]);
      const e2 = Math.hypot(...f(next));
      if (Number.isFinite(e2) && e2 < err) break;
      k /= 2;
    }
    x = next;
  }
  return Math.hypot(...f(x)) < tol * 100 ? x : null;
}

/** konce úseku */
export function segEnds(s: Seg2): [Vec2, Vec2] {
  if (s.t === "line") return [s.a, s.b];
  if (s.t === "arc") return [[s.c[0] + s.r * Math.cos(s.a0), s.c[1] + s.r * Math.sin(s.a0)], [s.c[0] + s.r * Math.cos(s.a1), s.c[1] + s.r * Math.sin(s.a1)]];
  return [s.pts[0], s.pts[s.pts.length - 1]];
}
/** orientovaný úhel oblouku (kladný proti směru hodin) */
export const arcSweep = (s: Extract<Seg2, { t: "arc" }>) => {
  let d = s.a1 - s.a0;
  if (s.ccw) while (d < 0) d += TAU;
  else while (d > 0) d -= TAU;
  return d;
};

/** Greenův integrál ½∮(x dy − y dx) jednoho úseku (příspěvek k orientované ploše obrysu) */
export function segGreen(s: Seg2): number {
  if (s.t === "line") return (s.a[0] * s.b[1] - s.b[0] * s.a[1]) / 2;
  if (s.t === "arc") {
    const d = arcSweep(s);
    const a1 = s.a0 + d;
    return (s.r * s.r * d + s.r * (s.c[0] * (Math.sin(a1) - Math.sin(s.a0)) - s.c[1] * (Math.cos(a1) - Math.cos(s.a0)))) / 2;
  }
  if (s.g !== undefined) return s.g;
  let g = 0;
  for (let i = 0; i + 1 < s.pts.length; i++) g += (s.pts[i][0] * s.pts[i + 1][1] - s.pts[i + 1][0] * s.pts[i][1]) / 2;
  return g;
}

/** otočí / posune / zrcadlí úsek (otočení kolem počátku o `a`, pak posun `d`) */
export function segMove(s: Seg2, a: number, d: Vec2 = [0, 0]): Seg2 {
  const mv = (p: Vec2): Vec2 => {
    const q = a ? rot2(p, a) : p;
    return [q[0] + d[0], q[1] + d[1]];
  };
  if (s.t === "line") return { t: "line", a: mv(s.a), b: mv(s.b) };
  if (s.t === "arc") return { ...s, c: mv(s.c), a0: s.a0 + a, a1: s.a1 + a };
  // Greenův integrál se otočením kolem počátku nemění; posunem o d přibude ½ d × (Q1 − Q0)
  const [p0, p1] = segEnds(s);
  const q0 = a ? rot2(p0, a) : p0;
  const q1 = a ? rot2(p1, a) : p1;
  const gg = s.g === undefined ? undefined : s.g + (d[0] * (q1[1] - q0[1]) - d[1] * (q1[0] - q0[0])) / 2;
  return { ...s, pts: s.pts.map(mv), d0: a ? rot2(s.d0, a) : s.d0, d1: a ? rot2(s.d1, a) : s.d1, ...(gg === undefined ? {} : { g: gg }) };
}

/**
 * Úsek přesné křivky `f(param)` na [p0, p1] (p0 < p1): n+1 bodů rovnoměrně v parametru, derivace na koncích (zadané `df`,
 * jinak středovou diferencí) a Greenův integrál přesné křivky (lichoběžník s Richardsonovou extrapolací).
 */
export function curveSeg(kind: Extract<Seg2, { t: "curve" }>["kind"], f: (p: number) => Vec2, p0: number, p1: number, n: number, df?: (p: number) => Vec2): Extract<Seg2, { t: "curve" }> {
  const params = Array.from({ length: n + 1 }, (_, i) => p0 + ((p1 - p0) * i) / n);
  params[n] = p1;
  const pts = params.map(f);
  const h = Math.max(1e-7, Math.abs(p1 - p0) * 1e-5);
  const num = (p: number): Vec2 => {
    const a = f(p - h);
    const b = f(p + h);
    return [(b[0] - a[0]) / (2 * h), (b[1] - a[1]) / (2 * h)];
  };
  const green = (m: number) => {
    let g = 0;
    let a = f(p0);
    for (let i = 1; i <= m; i++) {
      const b = f(i === m ? p1 : p0 + ((p1 - p0) * i) / m);
      g += (a[0] * b[1] - b[0] * a[1]) / 2;
      a = b;
    }
    return g;
  };
  const g1 = green(96);
  const g2 = green(192);
  return { t: "curve", kind, pts, params, d0: (df ?? num)(p0), d1: (df ?? num)(p1), g: (4 * g2 - g1) / 3 };
}
/** obrátí směr úseku */
export function segReverse(s: Seg2): Seg2 {
  if (s.t === "line") return { t: "line", a: s.b, b: s.a };
  if (s.t === "arc") return { ...s, a0: s.a1, a1: s.a0, ccw: !s.ccw };
  return { ...s, pts: [...s.pts].reverse(), params: [...s.params].reverse().map((p) => -p), d0: [-s.d1[0], -s.d1[1]], d1: [-s.d0[0], -s.d0[1]], ...(s.g === undefined ? {} : { g: -s.g }) };
}
/** zrcadlí úsek podle osy X (y → −y); směr průchodu se tím obrátí vůči obrysu, proto se úsek zároveň obrací */
export function segMirrorRev(s: Seg2): Seg2 {
  const m = (p: Vec2): Vec2 => [p[0], -p[1]];
  if (s.t === "line") return { t: "line", a: m(s.b), b: m(s.a) };
  if (s.t === "arc") return { t: "arc", c: m(s.c), r: s.r, a0: -s.a1, a1: -s.a0, ccw: s.ccw };
  return { ...s, pts: [...s.pts].reverse().map(m), params: [...s.params].reverse().map((p) => -p), d0: [-s.d1[0], s.d1[1]], d1: [-s.d0[0], s.d0[1]], ...(s.g === undefined ? {} : { g: s.g }) };
}

/** průsečíky dvou kružnic (nejvýš dva); prázdné, když se neprotínají */
export function circleX(c1: Vec2, r1: number, c2: Vec2, r2: number): Vec2[] {
  const dx = c2[0] - c1[0];
  const dy = c2[1] - c1[1];
  const d = Math.hypot(dx, dy);
  if (!(d > 1e-12) || d > r1 + r2 + 1e-12 || d < Math.abs(r1 - r2) - 1e-12) return [];
  const a = (d * d + r1 * r1 - r2 * r2) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const mx = c1[0] + (a * dx) / d;
  const my = c1[1] + (a * dy) / d;
  return [
    [mx - (h * dy) / d, my + (h * dx) / d],
    [mx + (h * dy) / d, my - (h * dx) / d],
  ];
}
export const ang = (p: Vec2, c: Vec2 = [0, 0]) => Math.atan2(p[1] - c[1], p[0] - c[0]);
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** zaoblení rohu P0–C–P1 poloměrem r: úsečka P0→T0, oblouk, úsečka T1→P1 (bez zaoblení dvě úsečky) */
export function filletCorner(p0: Vec2, c: Vec2, p1: Vec2, r: number): Seg2[] {
  const u0: Vec2 = [(p0[0] - c[0]) / dist(p0, c), (p0[1] - c[1]) / dist(p0, c)];
  const u1: Vec2 = [(p1[0] - c[0]) / dist(p1, c), (p1[1] - c[1]) / dist(p1, c)];
  const cosT = u0[0] * u1[0] + u0[1] * u1[1];
  const th = Math.acos(clamp(cosT, -1, 1));
  if (!(r > 1e-9) || th < 1e-6 || Math.PI - th < 1e-6) return [{ t: "line", a: p0, b: c }, { t: "line", a: c, b: p1 }];
  const t = r / Math.tan(th / 2);
  const t0: Vec2 = [c[0] + u0[0] * t, c[1] + u0[1] * t];
  const t1: Vec2 = [c[0] + u1[0] * t, c[1] + u1[1] * t];
  const bl = Math.hypot(u0[0] + u1[0], u0[1] + u1[1]);
  const k = r / Math.sin(th / 2) / bl;
  const o: Vec2 = [c[0] + (u0[0] + u1[0]) * k, c[1] + (u0[1] + u1[1]) * k];
  // směr průchodu P0 → C → P1: zatáčka vlevo = oblouk proti směru hodin
  const cross = (c[0] - p0[0]) * (p1[1] - c[1]) - (c[1] - p0[1]) * (p1[0] - c[0]);
  return [
    { t: "line", a: p0, b: t0 },
    { t: "arc", c: o, r, a0: ang(t0, o), a1: ang(t1, o), ccw: cross > 0 },
    { t: "line", a: t1, b: p1 },
  ];
}
/** plocha obrysu: součet Greenových integrálů úseků jedné rozteče × počet (kolo), absolutní hodnota */
export const tiledArea = (tooth: Seg2[], count: number) => Math.abs(count * tooth.reduce((s, x) => s + segGreen(x), 0));
