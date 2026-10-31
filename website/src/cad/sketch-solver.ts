/**
 * Numerický řešič vazeb a řídicích kót skici (tlumený Gauss–Newton / Levenberg–Marquardt
 * s numerickým Jakobiánem). Pracuje přímo s parametry entit (úsečka = 2 body, kružnice = střed + r…),
 * nezávislé parametry drží co nejblíž původním hodnotám (minimální změna).
 */
import { circleFrom3, keyPoints } from "./sketch";
import type { SketchConstraint, SketchDim, SketchEntity, SketchRef, Vec2 } from "./types";

// ---------------- parametry entit ----------------

export function paramsOf(e: SketchEntity): number[] {
  switch (e.type) {
    case "line":
      return [...e.a, ...e.b];
    case "arc":
      return [...e.a, ...e.b, ...e.c];
    case "circle":
      return [e.cx, e.cy, e.r];
    case "rect":
      return [e.cx, e.cy, e.w, e.h, e.angle];
    case "polygon":
      return [e.cx, e.cy, e.r, e.angle];
    case "slot":
      return [e.cx, e.cy, e.length, e.width, e.angle];
    case "polyline":
    case "spline":
      return e.points.flat();
    case "point":
      return [...e.p];
    case "ellipse":
      return [e.cx, e.cy, e.rx, e.ry, e.angle];
  }
}

export function withParams(e: SketchEntity, x: number[]): SketchEntity {
  const P = (i: number): Vec2 => [x[i], x[i + 1]];
  switch (e.type) {
    case "line":
      return { ...e, a: P(0), b: P(2) };
    case "arc":
      return { ...e, a: P(0), b: P(2), c: P(4) };
    case "circle":
      return { ...e, cx: x[0], cy: x[1], r: x[2] };
    case "rect":
      return { ...e, cx: x[0], cy: x[1], w: x[2], h: x[3], angle: x[4] };
    case "polygon":
      return { ...e, cx: x[0], cy: x[1], r: x[2], angle: x[3] };
    case "slot":
      return { ...e, cx: x[0], cy: x[1], length: x[2], width: x[3], angle: x[4] };
    case "polyline":
    case "spline":
      return { ...e, points: e.points.map((_, i) => P(i * 2)) };
    case "point":
      return { ...e, p: P(0) };
    case "ellipse":
      return { ...e, cx: x[0], cy: x[1], rx: x[2], ry: x[3], angle: x[4] };
  }
}

/** Index parametru „úhel“ (ve stupních) u parametrických tvarů. */
function angleIndex(e: SketchEntity): number {
  return e.type === "rect" || e.type === "slot" || e.type === "ellipse" ? 4 : e.type === "polygon" ? 3 : -1;
}
/** Kolik mm odpovídá 1° natočení entity (obvodový posun nejvzdálenějšího bodu). */
function angleScale(e: SketchEntity): number {
  const r = e.type === "rect" ? Math.hypot(e.w, e.h) / 2 : e.type === "slot" ? e.length / 2 : e.type === "ellipse" ? Math.max(e.rx, e.ry) : e.type === "polygon" ? e.r : 1;
  return Math.max(1, r) * (Math.PI / 180) * 3;
}

/** Počet stupňů volnosti entity (oblouk třemi body má o 1 parametr víc než DOF). */
const dofOf = (e: SketchEntity) => paramsOf(e).length - (e.type === "arc" ? 1 : 0);

// ---------------- geometrie odkazů ----------------

type Line = [Vec2, Vec2];
type Circ = { c: Vec2; r: number };

export function refPoint(map: Map<string, SketchEntity>, r: SketchRef): Vec2 | null {
  const e = map.get(r.e);
  if (!e) return null;
  if (e.type === "arc" && r.k === "b") return e.b;
  if (r.k === "self") {
    if (e.type === "point") return e.p;
    return keyPoints(e).center ?? null;
  }
  return keyPoints(e)[r.k] ?? null;
}

export function refLine(map: Map<string, SketchEntity>, r: SketchRef): Line | null {
  const e = map.get(r.e);
  if (!e) return null;
  if (e.type === "line" && (r.k === "self" || r.k === "")) return [e.a, e.b];
  const m = /^([gs])(\d+)$/.exec(r.k);
  if (!m) return null;
  const i = Number(m[2]);
  if ((e.type === "polyline" || e.type === "spline") && m[1] === "g") {
    const n = e.points.length;
    if (i < n - 1 || (e.closed && i === n - 1)) return [e.points[i], e.points[(i + 1) % n]];
    return null;
  }
  if ((e.type === "rect" || e.type === "polygon") && m[1] === "s") {
    const k = keyPoints(e);
    const n = e.type === "rect" ? 4 : Math.max(3, Math.round(e.sides));
    const a = k[`c${i % n}`];
    const b = k[`c${(i + 1) % n}`];
    return a && b ? [a, b] : null;
  }
  return null;
}

export function refCircle(map: Map<string, SketchEntity>, r: SketchRef): Circ | null {
  const e = map.get(r.e);
  if (!e) return null;
  if (e.type === "circle") return { c: [e.cx, e.cy], r: e.r };
  if (e.type === "arc") {
    const g = circleFrom3(e.a, e.b, e.c);
    return g ? { c: g.c, r: g.r } : null;
  }
  if (e.type === "slot") return { c: [e.cx, e.cy], r: e.width / 2 };
  if (e.type === "polygon") return { c: [e.cx, e.cy], r: e.r };
  return null;
}

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const len = (a: Vec2) => Math.hypot(a[0], a[1]);
const crs = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
const ptLineDist = (p: Vec2, l: Line) => crs(sub(l[1], l[0]), sub(p, l[0])) / (len(sub(l[1], l[0])) || 1e-12);

/** Residua jedné vazby (prázdné pole = neplatné odkazy, vazba se ignoruje). */
export function constraintResiduals(map: Map<string, SketchEntity>, c: SketchConstraint): number[] {
  const [r0, r1, r2] = c.refs;
  const P = (r?: SketchRef) => (r ? refPoint(map, r) : null);
  const L = (r?: SketchRef) => (r ? refLine(map, r) : null);
  const C = (r?: SketchRef) => (r ? refCircle(map, r) : null);
  switch (c.type) {
    case "horizontal":
    case "vertical": {
      const k = c.type === "horizontal" ? 1 : 0;
      const l = L(r0);
      if (l && c.refs.length === 1) return [l[1][k] - l[0][k]];
      const a = P(r0);
      const b = P(r1);
      return a && b ? [b[k] - a[k]] : [];
    }
    case "coincident": {
      const a = P(r0);
      const b = P(r1);
      return a && b ? [b[0] - a[0], b[1] - a[1]] : [];
    }
    case "parallel":
    case "perpendicular": {
      const a = L(r0);
      const b = L(r1);
      if (!a || !b) return [];
      const u = sub(a[1], a[0]);
      const v = sub(b[1], b[0]);
      const lv = len(v) || 1e-12;
      return [c.type === "parallel" ? crs(u, v) / lv : dot(u, v) / lv];
    }
    case "collinear": {
      const a = L(r0);
      const b = L(r1);
      return a && b ? [ptLineDist(b[0], a), ptLineDist(b[1], a)] : [];
    }
    case "tangent": {
      const l = L(r0) ?? L(r1);
      const cs = [C(r0), C(r1)].filter(Boolean) as Circ[];
      if (l && cs.length === 1) return [Math.abs(ptLineDist(cs[0].c, l)) - cs[0].r];
      if (cs.length === 2) {
        const d = len(sub(cs[0].c, cs[1].c));
        const ext = d - (cs[0].r + cs[1].r);
        const int = d - Math.abs(cs[0].r - cs[1].r);
        return [Math.abs(ext) <= Math.abs(int) ? ext : int];
      }
      return [];
    }
    case "equal": {
      const la = L(r0);
      const lb = L(r1);
      if (la && lb) return [len(sub(la[1], la[0])) - len(sub(lb[1], lb[0]))];
      const ca = C(r0);
      const cb = C(r1);
      return ca && cb ? [ca.r - cb.r] : [];
    }
    case "fixed": {
      const v = c.value ?? [];
      if (r0?.k === "self") {
        const e = map.get(r0.e);
        if (!e) return [];
        const x = paramsOf(e);
        return x.length === v.length ? x.map((xi, i) => xi - v[i]) : [];
      }
      const p = P(r0);
      return p && v.length === 2 ? [p[0] - v[0], p[1] - v[1]] : [];
    }
    case "concentric": {
      const a = C(r0)?.c ?? P(r0);
      const b = C(r1)?.c ?? P(r1);
      return a && b ? [b[0] - a[0], b[1] - a[1]] : [];
    }
    case "midpoint": {
      const p = P(r0);
      const l = L(r1);
      return p && l ? [p[0] - (l[0][0] + l[1][0]) / 2, p[1] - (l[0][1] + l[1][1]) / 2] : [];
    }
    case "pointOnCurve": {
      const p = P(r0);
      if (!p) return [];
      const l = L(r1);
      if (l) return [ptLineDist(p, l)];
      const ci = C(r1);
      return ci ? [len(sub(p, ci.c)) - ci.r] : [];
    }
    case "symmetric": {
      const a = P(r0);
      const b = P(r1);
      const l = L(r2);
      if (!a || !b || !l) return [];
      const m: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const d = sub(l[1], l[0]);
      return [ptLineDist(m, l), dot(sub(b, a), d) / (len(d) || 1e-12)];
    }
  }
}

/** Aktuální (naměřená) hodnota kóty. */
export function measureDim(map: Map<string, SketchEntity>, d: SketchDim): number | null {
  const [r0, r1] = d.refs;
  switch (d.type) {
    case "radius":
    case "diameter": {
      const c = r0 ? refCircle(map, r0) : null;
      return c ? (d.type === "radius" ? c.r : 2 * c.r) : null;
    }
    case "length": {
      const l = r0 ? refLine(map, r0) : null;
      return l ? len(sub(l[1], l[0])) : null;
    }
    case "angle": {
      const a = r0 ? refLine(map, r0) : null;
      const b = r1 ? refLine(map, r1) : null;
      if (!a || !b) return null;
      const u = sub(a[1], a[0]);
      const v = sub(b[1], b[0]);
      return (Math.atan2(Math.abs(crs(u, v)), dot(u, v)) * 180) / Math.PI;
    }
    case "horizontal":
    case "vertical": {
      const a = r0 ? refPoint(map, r0) : null;
      const b = r1 ? refPoint(map, r1) : null;
      if (!a || !b) return null;
      return Math.abs(b[d.type === "horizontal" ? 0 : 1] - a[d.type === "horizontal" ? 0 : 1]);
    }
    case "distance": {
      if (!r0 || !r1) {
        const l = r0 ? refLine(map, r0) : null;
        return l ? len(sub(l[1], l[0])) : null;
      }
      const pa = refPoint(map, r0);
      const pb = refPoint(map, r1);
      const la = refLine(map, r0);
      const lb = refLine(map, r1);
      if (la && lb) return Math.abs(ptLineDist([(lb[0][0] + lb[1][0]) / 2, (lb[0][1] + lb[1][1]) / 2], la));
      if (pa && lb && !la) return Math.abs(ptLineDist(pa, lb));
      if (pb && la && !lb) return Math.abs(ptLineDist(pb, la));
      if (pa && pb) return len(sub(pa, pb));
      return null;
    }
  }
}

function dimResidual(map: Map<string, SketchEntity>, d: SketchDim, sign: number): number[] {
  if (!d.driving) return [];
  const v = measureDim(map, d);
  if (v == null) return [];
  if (d.type === "horizontal" || d.type === "vertical") {
    const a = refPoint(map, d.refs[0])!;
    const b = refPoint(map, d.refs[1])!;
    const k = d.type === "horizontal" ? 0 : 1;
    return [(b[k] - a[k]) * sign - d.value];
  }
  if (d.type === "angle") return [((v - d.value) * Math.PI) / 180 * 10];
  return [v - d.value];
}

// ---------------- lineární algebra ----------------

function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      if (!f) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

function rank(J: number[][], tol = 1e-7): number {
  const M = J.map((r) => [...r]);
  const rows = M.length;
  const cols = rows ? M[0].length : 0;
  let rk = 0;
  for (let c = 0; c < cols && rk < rows; c++) {
    let p = rk;
    for (let r = rk + 1; r < rows; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < tol) continue;
    [M[rk], M[p]] = [M[p], M[rk]];
    for (let r = rk + 1; r < rows; r++) {
      const f = M[r][c] / M[rk][c];
      if (f) for (let k = c; k < cols; k++) M[r][k] -= f * M[rk][k];
    }
    rk++;
  }
  return rk;
}

// ---------------- řešič ----------------

export type SolveStatus = { ok: boolean; residual: number; dof: number; conflicts: string[]; iterations: number };
export type SolveResult = SolveStatus & { entities: SketchEntity[] };

type Opts = {
  /** váhy setrvačnosti podle entity (tažená entita = vyšší váha, drží se kurzoru) */
  weights?: Record<string, number>;
  maxIter?: number;
  /** spočítat stupně volnosti (dražší – nedělat při každém tažení) */
  dof?: boolean;
};

const W_C = 1; // vazby (po škálování dominují)
const W_REG = 1e-3; // setrvačnost (minimální změna)

/**
 * Vyřeší vazby a řídicí kóty. Mění jen entity, kterých se vazby/kóty týkají.
 */
export function solveSketch(entities: SketchEntity[], constraints: SketchConstraint[] = [], dims: SketchDim[] = [], opts: Opts = {}): SolveResult {
  const involved = new Set<string>();
  for (const c of constraints) for (const r of c.refs) involved.add(r.e);
  for (const d of dims) if (d.driving) for (const r of d.refs) involved.add(r.e);
  const vars = entities.filter((e) => involved.has(e.id));
  const offs: number[] = [];
  let x0: number[] = [];
  for (const e of vars) {
    offs.push(x0.length);
    x0 = x0.concat(paramsOf(e));
  }
  const map0 = new Map(entities.map((e) => [e.id, e]));
  const build = (x: number[]) => {
    const m = new Map(map0);
    vars.forEach((e, i) => m.set(e.id, withParams(e, x.slice(offs[i], offs[i] + paramsOf(e).length))));
    return m;
  };
  const signs = dims.map((d) => {
    if (d.type !== "horizontal" && d.type !== "vertical") return 1;
    const a = refPoint(map0, d.refs[0]);
    const b = refPoint(map0, d.refs[1]);
    const k = d.type === "horizontal" ? 0 : 1;
    return a && b && b[k] - a[k] < 0 ? -1 : 1;
  });
  const consRes = (m: Map<string, SketchEntity>) => {
    const out: number[] = [];
    const owner: string[] = [];
    for (const c of constraints) for (const v of constraintResiduals(m, c)) {
      out.push(v);
      owner.push(c.id);
    }
    dims.forEach((d, i) => {
      for (const v of dimResidual(m, d, signs[i])) {
        out.push(v);
        owner.push(d.id);
      }
    });
    return { out, owner };
  };
  const wts = vars.flatMap((e) => {
    const w = opts.weights?.[e.id] ?? W_REG;
    const ai = angleIndex(e);
    // úhel (°) převést na ekvivalentní posun (mm) podle velikosti entity – jinak by řešič raději otáčel
    return paramsOf(e).map((_, i) => (i === ai ? w * angleScale(e) : w));
  });
  let anchor = [...x0];
  const F = (x: number[]) => {
    const m = build(x);
    const c = consRes(m).out.map((v) => v * W_C);
    return c.concat(x.map((xi, i) => (xi - anchor[i]) * wts[i]));
  };

  let x = [...x0];
  const N = x.length;
  let iterations = 0;
  // vnější průchody: kotva setrvačnosti se posune na poslední řešení → vazby se splní přesně
  for (let outer = 0; outer < 6 && N; outer++) {
    if (outer) {
      const cr = consRes(build(x)).out;
      if (cr.every((v) => Math.abs(v) < 1e-9)) break;
      anchor = [...x];
    }
    let f = F(x);
    let cost = f.reduce((s, v) => s + v * v, 0);
    let mu = 1e-6;
    const maxIter = opts.maxIter ?? 60;
    for (let it = 0; it < maxIter; it++, iterations++) {
      // numerický Jakobián
      const M = f.length;
      const J: number[][] = Array.from({ length: M }, () => new Array(N).fill(0));
      for (let j = 0; j < N; j++) {
        const h = 1e-7 * Math.max(1, Math.abs(x[j]));
        const xp = [...x];
        xp[j] += h;
        const fp = F(xp);
        for (let i = 0; i < M; i++) J[i][j] = (fp[i] - f[i]) / h;
      }
      const JtJ: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));
      const Jtf = new Array(N).fill(0);
      for (let i = 0; i < M; i++) {
        const row = J[i];
        for (let a = 0; a < N; a++) {
          if (!row[a]) continue;
          Jtf[a] += row[a] * f[i];
          for (let b = a; b < N; b++) JtJ[a][b] += row[a] * row[b];
        }
      }
      for (let a = 0; a < N; a++) for (let b = 0; b < a; b++) JtJ[a][b] = JtJ[b][a];
      let improved = false;
      for (let tries = 0; tries < 8; tries++) {
        const A = JtJ.map((row, i) => row.map((v, k) => (i === k ? v + mu * (1 + v) : v)));
        const step = solveLinear(A, Jtf.map((v) => -v));
        if (!step) {
          mu *= 10;
          continue;
        }
        const xn = x.map((v, i) => v + step[i]);
        const fn = F(xn);
        const cn = fn.reduce((s, v) => s + v * v, 0);
        if (cn < cost) {
          x = xn;
          f = fn;
          const gain = cost - cn;
          cost = cn;
          mu = Math.max(1e-12, mu / 5);
          improved = true;
          if (gain < 1e-20) tries = 99;
          break;
        }
        mu *= 10;
      }
      const cr = consRes(build(x)).out;
      if (!improved || cr.every((v) => Math.abs(v) < 1e-10)) {
        iterations++;
        break;
      }
    }
  }
  const map = build(x);
  const { out, owner } = consRes(map);
  const residual = out.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const conflicts = [...new Set(owner.filter((_, i) => Math.abs(out[i]) > 1e-5))];
  const round = (e: SketchEntity) => withParams(e, paramsOf(e).map((v) => Math.round(v * 1e7) / 1e7));
  const result = entities.map((e) => (involved.has(e.id) ? round(map.get(e.id)!) : e));
  const dof = opts.dof === false ? -1 : sketchDof(result, constraints, dims);
  return { entities: result, ok: residual < 1e-5, residual, dof, conflicts, iterations };
}

/** Zbývající stupně volnosti skici (0 = plně určená). */
export function sketchDof(entities: SketchEntity[], constraints: SketchConstraint[] = [], dims: SketchDim[] = []): number {
  const total = entities.reduce((s, e) => s + dofOf(e), 0);
  const involved = new Set<string>();
  for (const c of constraints) for (const r of c.refs) involved.add(r.e);
  for (const d of dims) if (d.driving) for (const r of d.refs) involved.add(r.e);
  const vars = entities.filter((e) => involved.has(e.id));
  if (!vars.length) return total;
  const offs: number[] = [];
  let x: number[] = [];
  for (const e of vars) {
    offs.push(x.length);
    x = x.concat(paramsOf(e));
  }
  const map0 = new Map(entities.map((e) => [e.id, e]));
  const res = (xx: number[]) => {
    const m = new Map(map0);
    vars.forEach((e, i) => m.set(e.id, withParams(e, xx.slice(offs[i], offs[i] + paramsOf(e).length))));
    const out: number[] = [];
    for (const c of constraints) out.push(...constraintResiduals(m, c));
    for (const d of dims) out.push(...dimResidual(m, d, 1));
    return out;
  };
  const f0 = res(x);
  if (!f0.length) return total;
  const J: number[][] = Array.from({ length: f0.length }, () => new Array(x.length).fill(0));
  for (let j = 0; j < x.length; j++) {
    const h = 1e-6 * Math.max(1, Math.abs(x[j]));
    const xp = [...x];
    xp[j] += h;
    const fp = res(xp);
    for (let i = 0; i < f0.length; i++) J[i][j] = (fp[i] - f0[i]) / h;
  }
  // řádková normalizace (vazby různých jednotek)
  for (const row of J) {
    const n = Math.hypot(...row);
    if (n > 1e-12) for (let k = 0; k < row.length; k++) row[k] /= n;
  }
  return Math.max(0, total - rank(J, 1e-6));
}
