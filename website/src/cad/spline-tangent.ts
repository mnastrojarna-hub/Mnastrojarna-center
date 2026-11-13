/**
 * Spline s tečnami (7. vlna, balík „surfaces“) – čistá 2D matematika bez jádra (skicář, profily, testy).
 *
 * Entita `spline` může mít u libovolného bodu zadanou tečnu: `tangents[i]` = úhel ve stupních v rovině skici (proti směru
 * hodin od +X), `weights[i]` = velikost tečny (1 = přirozená; větší = křivka se u bodu „déle drží“ směru). Bez tečen zůstává
 * dřívější centripetální Catmull-Rom (staré dokumenty se nemění).
 *
 * Křivka s tečnami je PŘESNĚ ta, kterou postaví jádro (`GeomAPI_Interpolate` s `Load(tečny, příznaky, Scale=false)`):
 * kubický spline s uzly v parametrech podle délky tětiv, C2 v bodech bez tečny, C1 v bodech se zadanou tečnou, a na volných
 * koncích derivace Lagrangeova polynomu přes první / poslední 4 body (stejně jako `BuildTangents` v OCCT). Ověřeno testem
 * (odchylka < 1e-6 mm). Derivace podle parametru délky tětivy má velikost ≈ 1, proto váha 1 = přirozená velikost tečny.
 */
import type { SketchEntity, Vec2 } from "./types";

export type SplineEnt = Extract<SketchEntity, { type: "spline" }>;

const DEG = Math.PI / 180;
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** úhel tečny v bodě `i` (°) nebo null = volná */
export function tangentAt(e: SplineEnt, i: number): number | null {
  const t = e.tangents?.[i];
  return typeof t === "number" && Number.isFinite(t) ? t : null;
}
/** váha (velikost) tečny v bodě `i`; výchozí 1 */
export function weightAt(e: SplineEnt, i: number): number {
  const w = e.weights?.[i];
  return typeof w === "number" && Number.isFinite(w) && w > 0 ? w : 1;
}
/** má spline aspoň jednu zadanou tečnu? */
export function hasTangents(e: SketchEntity): boolean {
  return e.type === "spline" && !!e.tangents && e.points.some((_, i) => tangentAt(e, i) !== null);
}

/** Parametry bodů podle délky tětiv (u uzavřené o jeden víc – perioda je poslední hodnota). */
export function chordParams(pts: Vec2[], closed: boolean): number[] {
  const t = [0];
  const n = pts.length;
  const spans = closed ? n : n - 1;
  for (let i = 0; i < spans; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    t.push(t[i] + Math.max(1e-9, Math.hypot(b[0] - a[0], b[1] - a[1])));
  }
  return t;
}

/** Gaussova eliminace s výběrem hlavního prvku (malé soustavy – desítky bodů). */
export function solveDense(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((r) => r.slice());
  const y = b.slice();
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
    if (p !== i) {
      [M[i], M[p]] = [M[p], M[i]];
      [y[i], y[p]] = [y[p], y[i]];
    }
    const d = M[i][i];
    if (Math.abs(d) < 1e-300) throw new Error("singular");
    for (let k = i + 1; k < n; k++) {
      const f = M[k][i] / d;
      if (!f) continue;
      for (let j = i; j < n; j++) M[k][j] -= f * M[i][j];
      y[k] -= f * y[i];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

/** derivace Lagrangeova polynomu (uzly `idx`) v parametru x0 pro souřadnici c */
function lagrangeDeriv(t: number[], pts: Vec2[], idx: number[], x0: number, c: 0 | 1): number {
  let d = 0;
  for (const j of idx) {
    let sum = 0;
    for (const m of idx) {
      if (m === j) continue;
      let prod = 1 / (t[j] - t[m]);
      for (const l of idx) if (l !== j && l !== m) prod *= (x0 - t[l]) / (t[j] - t[l]);
      sum += prod;
    }
    d += pts[j][c] * sum;
  }
  return d;
}

/** jednotkový vektor tečny z úhlu (°) */
export const dirOf = (deg: number): Vec2 => [Math.cos(deg * DEG), Math.sin(deg * DEG)];

/**
 * Derivace Hermitova kubického splinu v bodech (podle parametru délky tětiv) – shodné s jádrem (viz hlavička souboru).
 * Vrací parametry `t` (u uzavřené n+1 hodnot) a derivace `m` (n vektorů).
 */
export function splineDerivatives(e: SplineEnt): { t: number[]; m: Vec2[] } {
  const pts = e.points;
  const n = pts.length;
  const closed = e.closed && n >= 3;
  const t = chordParams(pts, closed);
  const h = (i: number) => t[i + 1] - t[i];
  const fixed = pts.map((_, i) => tangentAt(e, i));
  const m: Vec2[] = pts.map(() => [0, 0]);
  if (n < 2) return { t, m };
  for (const c of [0, 1] as const) {
    const A = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const b = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      const fx = fixed[i];
      if (fx !== null) {
        A[i][i] = 1;
        b[i] = dirOf(fx)[c] * weightAt(e, i);
        continue;
      }
      if (!closed && (i === 0 || i === n - 1)) {
        // volný konec: derivace Lagrangeova polynomu přes nejbližší (nejvýš 4) body – jako OCCT BuildTangents
        const k = Math.min(3, n - 1);
        const idx = Array.from({ length: k + 1 }, (_, j) => (i === 0 ? j : n - 1 - j));
        A[i][i] = 1;
        b[i] = lagrangeDeriv(t, pts, idx, t[i], c);
        continue;
      }
      // C2 v bodě: (1/hp)·m[i−1] + 2(1/hp + 1/hn)·m[i] + (1/hn)·m[i+1] = 3[(p_i − p_{i−1})/hp² + (p_{i+1} − p_i)/hn²]
      const ip = (i - 1 + n) % n;
      const iN = (i + 1) % n;
      const hp = i === 0 ? h(n - 1) : h(i - 1);
      const hn = h(i);
      A[i][ip] += 1 / hp;
      A[i][i] += 2 * (1 / hp + 1 / hn);
      A[i][iN] += 1 / hn;
      b[i] = 3 * ((pts[i][c] - pts[ip][c]) / (hp * hp) + (pts[iN][c] - pts[i][c]) / (hn * hn));
    }
    const x = solveDense(A, b);
    x.forEach((v, i) => (m[i][c] = v));
  }
  return { t, m };
}

/** Body Hermitova splinu (`perSpan` vzorků na úsek; u otevřené včetně posledního bodu, u uzavřené bez opakování prvního). */
export function hermitePoints(e: SplineEnt, perSpan = 16): Vec2[] {
  const pts = e.points;
  const n = pts.length;
  if (n < 2) return [...pts];
  const closed = e.closed && n >= 3;
  const { t, m } = splineDerivatives(e);
  const out: Vec2[] = [];
  const spans = closed ? n : n - 1;
  for (let i = 0; i < spans; i++) {
    const j = (i + 1) % n;
    const hh = t[i + 1] - t[i];
    for (let k = 0; k < perSpan; k++) {
      const u = k / perSpan;
      const h00 = 2 * u ** 3 - 3 * u ** 2 + 1;
      const h10 = u ** 3 - 2 * u ** 2 + u;
      const h01 = -2 * u ** 3 + 3 * u ** 2;
      const h11 = u ** 3 - u ** 2;
      out.push([h00 * pts[i][0] + h10 * hh * m[i][0] + h01 * pts[j][0] + h11 * hh * m[j][0], h00 * pts[i][1] + h10 * hh * m[i][1] + h01 * pts[j][1] + h11 * hh * m[j][1]]);
    }
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}

/** Úhel (°) křivky v bodě `i` – zadaná tečna, nebo skutečný směr spline (pro úchyt a předvyplnění panelu). */
export function curveAngleAt(e: SplineEnt, i: number, catmull: (pts: Vec2[], closed: boolean, perSpan: number) => Vec2[]): number {
  const fx = tangentAt(e, i);
  if (fx !== null) return fx;
  const n = e.points.length;
  if (n < 2) return 0;
  if (hasTangents(e)) {
    const { m } = splineDerivatives(e);
    return (Math.atan2(m[i][1], m[i][0]) * 180) / Math.PI;
  }
  // bez tečen: směr z jemně navzorkované křivky Catmull-Rom kolem bodu i
  const per = 32;
  const s = catmull(e.points, e.closed, per);
  const closed = e.closed && n >= 3;
  const k = i * per;
  const a = s[closed ? (k - 1 + s.length) % s.length : Math.max(0, k - 1)];
  const b = s[closed ? (k + 1) % s.length : Math.min(s.length - 1, k + 1)];
  return (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
}

/** Délka úchytu tečny v mm (váha × čtvrtina průměrné sousední tětivy). */
export function handleLength(e: SplineEnt, i: number): number {
  const pts = e.points;
  const n = pts.length;
  const d = (a: number, b: number) => Math.hypot(pts[b][0] - pts[a][0], pts[b][1] - pts[a][1]);
  const closed = e.closed && n >= 3;
  const near: number[] = [];
  if (i > 0 || closed) near.push(d((i - 1 + n) % n, i));
  if (i < n - 1 || closed) near.push(d(i, (i + 1) % n));
  const base = near.length ? near.reduce((s, x) => s + x, 0) / near.length : 10;
  return Math.max(1e-3, 0.3 * base * weightAt(e, i));
}

/** Nastaví (nebo zruší: `angle` null) tečnu v bodě `i`; `weight` volitelně. Pole se doplní na délku bodů. */
export function setTangent(e: SplineEnt, i: number, angle: number | null, weight?: number | null): SplineEnt {
  const n = e.points.length;
  if (i < 0 || i >= n) return e;
  const tangents: (number | null)[] = Array.from({ length: n }, (_, k) => tangentAt(e, k));
  const weights: (number | null)[] = Array.from({ length: n }, (_, k) => (typeof e.weights?.[k] === "number" ? (e.weights[k] as number) : null));
  tangents[i] = angle === null ? null : r6(((((angle + 180) % 360) + 360) % 360) - 180);
  if (weight !== undefined) weights[i] = weight === null || !(weight > 0) || Math.abs(weight - 1) < 1e-9 ? null : r6(weight);
  if (angle === null) weights[i] = null;
  const out: SplineEnt = { ...e };
  if (tangents.some((x) => x !== null)) out.tangents = tangents;
  else delete out.tangents;
  if (weights.some((x) => x !== null)) out.weights = weights;
  else delete out.weights;
  return out;
}

/** Klíče úchytů tečen: „t{i}“. */
export const tangentKey = (i: number) => `t${i}`;
export const tangentIndex = (key: string): number | null => (/^t\d+$/.test(key) ? Number(key.slice(1)) : null);

/** Úchyty tečen pro skicář: u bodů se zadanou tečnou a na obou koncích otevřené křivky (tažením se tečna zadá). */
export function tangentHandles(e: SplineEnt, catmull: (pts: Vec2[], closed: boolean, perSpan: number) => Vec2[]): { key: string; p: Vec2; base: Vec2; set: boolean }[] {
  const n = e.points.length;
  if (n < 2) return [];
  const out: { key: string; p: Vec2; base: Vec2; set: boolean }[] = [];
  for (let i = 0; i < n; i++) {
    const set = tangentAt(e, i) !== null;
    const end = !e.closed && (i === 0 || i === n - 1);
    if (!set && !end) continue;
    const ang = curveAngleAt(e, i, catmull);
    const L = handleLength(e, i);
    const d = dirOf(ang);
    const base = e.points[i];
    out.push({ key: tangentKey(i), p: [base[0] + d[0] * L, base[1] + d[1] * L], base, set });
  }
  return out;
}

/** Tažení úchytu tečny: směr = úhel, délka (vůči přirozené) = váha. */
export function applyTangentHandle(e: SplineEnt, key: string, p: Vec2): SplineEnt {
  const i = tangentIndex(key);
  if (i === null || i >= e.points.length) return e;
  const base = e.points[i];
  const v: Vec2 = [p[0] - base[0], p[1] - base[1]];
  const len = Math.hypot(v[0], v[1]);
  if (len < 1e-6) return e;
  const natural = handleLength({ ...e, weights: undefined }, i);
  const angle = (Math.atan2(v[1], v[0]) * 180) / Math.PI;
  const w = Math.max(0.05, Math.min(20, len / natural));
  return setTangent(e, i, angle, Math.round(w * 100) / 100);
}

/** Popis tečen pro stav / protokol: „tečny: p0 30°, p2 −30° ×1,5“ (prázdné = bez tečen). */
export function tangentSummary(e: SplineEnt, fmt: (v: number) => string = (v) => String(r6(v))): string {
  const parts: string[] = [];
  e.points.forEach((_, i) => {
    const a = tangentAt(e, i);
    if (a === null) return;
    const w = weightAt(e, i);
    parts.push(`p${i} ${fmt(a)}°${Math.abs(w - 1) > 1e-9 ? ` ×${fmt(w)}` : ""}`);
  });
  return parts.join(", ");
}

/** Transformace tečen při otočení / zrcadlení entity (úhel → úhel). */
export function mapTangents(e: SplineEnt, ang: (deg: number) => number): Pick<SplineEnt, "tangents"> {
  if (!e.tangents) return {};
  return { tangents: e.tangents.map((a) => (typeof a === "number" ? r6(ang(a)) : null)) };
}
