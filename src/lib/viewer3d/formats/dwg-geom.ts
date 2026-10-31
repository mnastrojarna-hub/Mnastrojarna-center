/**
 * Geometrie pro převod DWG → 2D výkres: afinní 2D transformace (bloky, OCS), oblouky / elipsy
 * pod obecnou transformací, rozklad oblouků v polyčarách (bulge) a vyhodnocení splinů
 * (de Boor s váhami, interpolace fit bodů). Čisté funkce bez závislostí — testovatelné samostatně.
 */
import type { Pt } from "../drawing2d";

/** Afinní 2D transformace: x' = a·x + c·y + e, y' = b·x + d·y + f  →  [a, b, c, d, e, f]. */
export type M2 = [number, number, number, number, number, number];

export const IDENTITY: M2 = [1, 0, 0, 1, 0, 0];
const TAU = Math.PI * 2;

export interface V3 {
  x: number;
  y: number;
  z?: number;
}

/** m · n (nejdřív n, potom m). */
export function mul(m: M2, n: M2): M2 {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function apply(m: M2, x: number, y: number): Pt {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Jen lineární část (vektory). */
export function applyVec(m: M2, x: number, y: number): Pt {
  return [m[0] * x + m[2] * y, m[1] * x + m[3] * y];
}

export function det(m: M2): number {
  return m[0] * m[3] - m[1] * m[2];
}

export function isIdentity(m: M2): boolean {
  return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
}

/** Podobnost (rotace + rovnoměrné měřítko, případně zrcadlení) — kružnice zůstane kružnicí. */
export function isSimilarity(m: M2): boolean {
  const sx = Math.hypot(m[0], m[1]);
  const sy = Math.hypot(m[2], m[3]);
  if (sx === 0 || sy === 0) return false;
  const dot = (m[0] * m[2] + m[1] * m[3]) / (sx * sy);
  return Math.abs(sx - sy) <= 1e-9 * Math.max(sx, sy) && Math.abs(dot) <= 1e-9;
}

/** Posun · rotace · měřítko (bez zkosení). */
export function trs(tx: number, ty: number, rot: number, sx: number, sy: number): M2 {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return [c * sx, s * sx, -s * sy, c * sy, tx, ty];
}

/**
 * OCS (Object Coordinate System) entity s normálou `n` → průmět do roviny XY světa (Arbitrary Axis
 * Algorithm z DXF reference). `elevation` = souřadnice z v OCS. Normála ~ (0, 0, 1) nebo nulová
 * (LWPOLYLINE z některých souborů) → null = identita.
 */
export function ocsMatrix(n: V3 | null | undefined, elevation = 0): M2 | null {
  if (!n) return null;
  let nx = Number(n.x) || 0;
  let ny = Number(n.y) || 0;
  let nz = Number(n.z) || 0;
  const len = Math.hypot(nx, ny, nz);
  if (!(len > 1e-12)) return null;
  nx /= len;
  ny /= len;
  nz /= len;
  if (Math.abs(nx) < 1e-12 && Math.abs(ny) < 1e-12 && nz > 0) return null;
  // Ax = (|Nx| < 1/64 && |Ny| < 1/64 ? Wy : Wz) × N
  let ax: number, ay: number, az: number;
  if (Math.abs(nx) < 1 / 64 && Math.abs(ny) < 1 / 64) {
    // (0,1,0) × N = (nz, 0, -nx)
    ax = nz;
    ay = 0;
    az = -nx;
  } else {
    // (0,0,1) × N = (-ny, nx, 0)
    ax = -ny;
    ay = nx;
    az = 0;
  }
  const al = Math.hypot(ax, ay, az);
  ax /= al;
  ay /= al;
  az /= al;
  // Ay = N × Ax
  const bx = ny * az - nz * ay;
  const by = nz * ax - nx * az;
  return [ax, ay, bx, by, elevation * nx, elevation * ny];
}

/** Úhel vektoru do <0, 2π). */
export function angleOf(x: number, y: number): number {
  const a = Math.atan2(y, x);
  return a < 0 ? a + TAU : a;
}

/** Normalizace rozsahu oblouku: end > start, rozsah (0, 2π]. */
export function normalizeSweep(start: number, end: number): [number, number] {
  let s = start % TAU;
  if (s < 0) s += TAU;
  let sweep = (end - start) % TAU;
  if (sweep <= 1e-12) sweep += TAU;
  return [s, s + sweep];
}

/**
 * Eliptický oblouk P(t) = c + a1·cos t + a2·sin t, t ∈ <t0, t1> (t1 > t0) → parametry entity
 * „ellipse" (hlavní poloosa, poměr os, start / end proti směru hodin). a1, a2 nemusí být kolmé —
 * obraz kružnice / elipsy pod obecnou afinní transformací. null = degenerovaný případ (úsečka / bod).
 */
export function ellipseFromAxes(
  c: Pt,
  a1: Pt,
  a2: Pt,
  t0: number,
  t1: number,
): { c: Pt; major: Pt; ratio: number; start: number; end: number } | null {
  const l1 = a1[0] * a1[0] + a1[1] * a1[1];
  const l2 = a2[0] * a2[0] + a2[1] * a2[1];
  const dot = a1[0] * a2[0] + a1[1] * a2[1];
  // parametr s, ve kterém |P(t) − c| je maximální → směr hlavní poloosy
  const s = 0.5 * Math.atan2(2 * dot, l1 - l2);
  const cs = Math.cos(s);
  const sn = Math.sin(s);
  const u: Pt = [a1[0] * cs + a2[0] * sn, a1[1] * cs + a2[1] * sn];
  const w: Pt = [-a1[0] * sn + a2[0] * cs, -a1[1] * sn + a2[1] * cs];
  const lu = Math.hypot(u[0], u[1]);
  const lw = Math.hypot(w[0], w[1]);
  if (!(lu > 1e-12) || !(lw > 1e-12 * lu)) return null;
  const ratio = Math.min(1, lw / lu);
  const full = t1 - t0 >= TAU - 1e-9;
  const cross = u[0] * w[1] - u[1] * w[0];
  let start: number, end: number;
  if (full) {
    start = 0;
    end = TAU;
  } else if (cross > 0) {
    // P = c + U·cos(t − s) + W·sin(t − s), W = ratio · rot90(U)
    [start, end] = normalizeSweep(t0 - s, t1 - s);
  } else {
    // zrcadlení: W = −ratio · rot90(U) → parametr u = s − t běží opačně
    [start, end] = normalizeSweep(s - t1, s - t0);
  }
  return { c, major: u, ratio, start, end };
}

/** Počet úseků pro oblouk daného úhlu (cca 5° na úsek, min 2, max 128). */
export function arcSegments(sweep: number): number {
  return Math.max(2, Math.min(128, Math.ceil(Math.abs(sweep) / (Math.PI / 36))));
}

/** Body oblouku polyčáry (bulge) mezi p0 a p1 — bez p0, včetně p1. */
export function bulgePoints(x0: number, y0: number, x1: number, y1: number, bulge: number, out: Pt[]): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const chord = Math.hypot(dx, dy);
  if (!bulge || chord < 1e-12) {
    out.push([x1, y1]);
    return;
  }
  const theta = 4 * Math.atan(bulge); // středový úhel se znaménkem (+ = proti směru hodin)
  const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
  // střed: polovina tětivy + kolmice
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const h = (chord / 2) * ((1 - bulge * bulge) / (2 * bulge)); // vzdálenost středu od tětivy (se znaménkem)
  const cx = mx - (dy / chord) * h;
  const cy = my + (dx / chord) * h;
  const a0 = Math.atan2(y0 - cy, x0 - cx);
  const n = arcSegments(theta);
  for (let i = 1; i < n; i++) {
    const a = a0 + (theta * i) / n;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  out.push([x1, y1]);
}

// ───────────────────────────── spliny ─────────────────────────────

/** Strop počtu bodů jednoho splinu (rozumná velikost i pro spliny s tisíci řídicích bodů). */
const MAX_SPLINE_POINTS = 4096;

/**
 * NURBS křivka (de Boor) → body. `ctrl` řídicí body, `knots` uzlový vektor (délka n + p + 1,
 * jinak se dopočítá rovnoměrný sevřený), `weights` volitelné váhy. Vyhodnocuje se na celém platném
 * rozsahu <u_p, u_n> — sevřené i periodické (uzavřené) spliny z AutoCADu.
 */
export function evalNurbs(ctrl: Pt[], knots: number[], degree: number, weights?: number[] | null): Pt[] {
  const n = ctrl.length;
  if (n === 0) return [];
  if (n === 1) return [ctrl[0]];
  let p = Math.max(1, Math.min(Math.floor(degree) || 3, n - 1));
  let U = knots;
  if (U.length !== n + p + 1 || !isNonDecreasing(U)) U = clampedUniformKnots(n, p);
  const w = weights && weights.length === n && weights.every((x) => x > 0) ? weights : null;
  if (p === 1 && !w) {
    // lomená čára přímo z řídicích bodů (jen v platném rozsahu)
    return ctrl.slice();
  }
  const lo = U[p];
  const hi = U[n];
  if (!(hi > lo)) return ctrl.slice();
  // neprázdné intervaly uzlů
  const spans: number[] = [];
  for (let i = p; i < n; i++) if (U[i + 1] > U[i]) spans.push(i);
  const perSpan = Math.max(4, Math.min(64, Math.floor(MAX_SPLINE_POINTS / Math.max(1, spans.length))));
  const out: Pt[] = [];
  const dx = new Float64Array(p + 1);
  const dy = new Float64Array(p + 1);
  const dw = new Float64Array(p + 1);
  const evalAt = (k: number, u: number) => {
    for (let j = 0; j <= p; j++) {
      const idx = k - p + j;
      const wt = w ? w[idx] : 1;
      dx[j] = ctrl[idx][0] * wt;
      dy[j] = ctrl[idx][1] * wt;
      dw[j] = wt;
    }
    for (let r = 1; r <= p; r++) {
      for (let j = p; j >= r; j--) {
        const i = k - p + j;
        const den = U[i + p - r + 1] - U[i];
        const a = den > 0 ? (u - U[i]) / den : 0;
        dx[j] = (1 - a) * dx[j - 1] + a * dx[j];
        dy[j] = (1 - a) * dy[j - 1] + a * dy[j];
        dw[j] = (1 - a) * dw[j - 1] + a * dw[j];
      }
    }
    const ww = dw[p] || 1;
    out.push([dx[p] / ww, dy[p] / ww]);
  };
  evalAt(spans[0], lo);
  for (const k of spans) {
    const u0 = U[k];
    const u1 = U[k + 1];
    for (let s = 1; s <= perSpan; s++) evalAt(k, u0 + ((u1 - u0) * s) / perSpan);
  }
  return out;
}

function isNonDecreasing(a: number[]): boolean {
  for (let i = 1; i < a.length; i++) if (!(a[i] >= a[i - 1])) return false;
  return true;
}

function clampedUniformKnots(n: number, p: number): number[] {
  const U: number[] = [];
  const inner = n - p - 1;
  for (let i = 0; i <= p; i++) U.push(0);
  for (let i = 1; i <= inner; i++) U.push(i / (inner + 1));
  for (let i = 0; i <= p; i++) U.push(1);
  return U;
}

/**
 * Kubický spline procházející fit body (parametrizace délkou tětiv — jako AutoCAD), okrajové
 * podmínky: zadané tečny (jednotkové vektory), jinak přirozený spline. Matematicky stejná křivka
 * jako B-spline, který z fit bodů staví AutoCAD (uzly = parametry fit bodů).
 */
export function interpolateFitPoints(fit: Pt[], startTangent?: Pt | null, endTangent?: Pt | null): Pt[] {
  // odstranit po sobě jdoucí duplicitní body
  const q: Pt[] = [];
  for (const p of fit) {
    const last = q[q.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-12) q.push(p);
  }
  const n = q.length;
  if (n < 3) return q;
  const t = new Float64Array(n);
  for (let i = 1; i < n; i++) t[i] = t[i - 1] + Math.hypot(q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]);
  const unit = (v?: Pt | null): Pt | null => {
    if (!v) return null;
    const l = Math.hypot(v[0], v[1]);
    return l > 1e-12 ? [v[0] / l, v[1] / l] : null;
  };
  const d0 = unit(startTangent);
  const d1 = unit(endTangent);
  const mx = hermiteSlopes(t, q, 0, d0 ? d0[0] : null, d1 ? d1[0] : null);
  const my = hermiteSlopes(t, q, 1, d0 ? d0[1] : null, d1 ? d1[1] : null);
  const perSeg = Math.max(4, Math.min(32, Math.floor(MAX_SPLINE_POINTS / (n - 1))));
  const out: Pt[] = [q[0]];
  for (let i = 0; i < n - 1; i++) {
    const h = t[i + 1] - t[i];
    for (let s = 1; s <= perSeg; s++) {
      const u = s / perSeg;
      const h00 = 2 * u * u * u - 3 * u * u + 1;
      const h10 = u * u * u - 2 * u * u + u;
      const h01 = -2 * u * u * u + 3 * u * u;
      const h11 = u * u * u - u * u;
      out.push([
        h00 * q[i][0] + h10 * h * mx[i] + h01 * q[i + 1][0] + h11 * h * mx[i + 1],
        h00 * q[i][1] + h10 * h * my[i] + h01 * q[i + 1][1] + h11 * h * my[i + 1],
      ]);
    }
  }
  return out;
}

/** Derivace C2 kubického splinu v uzlech (tridiagonální soustava, Thomasův algoritmus). */
function hermiteSlopes(t: Float64Array, q: Pt[], axis: 0 | 1, s0: number | null, s1: number | null): Float64Array {
  const n = q.length;
  const a = new Float64Array(n); // pod diagonálou
  const b = new Float64Array(n); // diagonála
  const c = new Float64Array(n); // nad diagonálou
  const r = new Float64Array(n);
  const h = (i: number) => t[i + 1] - t[i];
  const delta = (i: number) => (q[i + 1][axis] - q[i][axis]) / h(i);
  if (s0 !== null) {
    b[0] = 1;
    r[0] = s0;
  } else {
    b[0] = 2;
    c[0] = 1;
    r[0] = 3 * delta(0);
  }
  for (let i = 1; i < n - 1; i++) {
    a[i] = h(i);
    b[i] = 2 * (h(i - 1) + h(i));
    c[i] = h(i - 1);
    r[i] = 3 * (h(i) * delta(i - 1) + h(i - 1) * delta(i));
  }
  if (s1 !== null) {
    b[n - 1] = 1;
    r[n - 1] = s1;
  } else {
    a[n - 1] = 1;
    b[n - 1] = 2;
    r[n - 1] = 3 * delta(n - 2);
  }
  // dopředná eliminace
  for (let i = 1; i < n; i++) {
    const m = a[i] / b[i - 1];
    b[i] -= m * c[i - 1];
    r[i] -= m * r[i - 1];
  }
  const x = new Float64Array(n);
  x[n - 1] = r[n - 1] / b[n - 1];
  for (let i = n - 2; i >= 0; i--) x[i] = (r[i] - c[i] * x[i + 1]) / b[i];
  return x;
}
