/**
 * Vzdálenost bodů od trojúhelníkové sítě – čisté funkce bez jádra OpenCascade (běží ve workeru, v UI i v testech).
 *
 * Porovnání modelu s referenčním modelem potřebuje vzdálenost desítek až stovek tisíc bodů od povrchu reference. Nástroj
 * jádra (BRepExtrema) na jeden bod trvá milisekundy; tady se reference zasíťuje, nad trojúhelníky se postaví strom
 * obalových kvádrů (BVH) a nejbližší bod se hledá v JavaScriptu (jednotky mikrosekund na bod).
 *
 * Přesnost je dána sítí: vzdálenost se měří k trojúhelníkům, které se od skutečné plochy liší nejvýš o toleranci síťování.
 * Znaménko (uvnitř / vně reference) se bere z normály nejbližšího trojúhelníku; je-li nejbližší bod na hraně nebo ve vrcholu
 * sítě, rozhoduje trojúhelník, ke kterému je bod „nejvíc čelem“.
 */

export type TriIndex = {
  positions: Float32Array;
  indices: Uint32Array;
  /** trojúhelníky (čísla v `indices` / 3) v pořadí listů stromu */
  order: Uint32Array;
  /** obalové kvádry uzlů: minX, minY, minZ, maxX, maxY, maxZ */
  box: Float64Array;
  /** pravý potomek vnitřního uzlu (levý je uzel + 1) */
  right: Int32Array;
  /** list: začátek v `order`; vnitřní uzel: −1 */
  start: Int32Array;
  /** list: počet trojúhelníků */
  count: Int32Array;
  nodes: number;
  depth: number;
  /** počet použitých (nedegenerovaných) trojúhelníků */
  triangles: number;
  /** +1 = normály trojúhelníků míří ven z tělesa, −1 = dovnitř (podle znaménka objemu sítě) */
  orient: 1 | -1;
  /** objem uzavřené sítě (mm³; u otevřené sítě nemá význam) */
  volume: number;
};

/** výsledek hledání nejbližšího bodu */
export type Nearest = {
  /** vzdálenost (≥ 0) */
  distance: number;
  /** vzdálenost se znaménkem: + bod je vně tělesa sítě, − uvnitř */
  signed: number;
  /** číslo trojúhelníku (index do `indices` / 3) */
  triangle: number;
  /** nejbližší bod na síti */
  point: [number, number, number];
};

const LEAF = 4;

/** Postaví strom obalových kvádrů nad trojúhelníky sítě (degenerované trojúhelníky se vynechají). */
export function buildTriIndex(positions: Float32Array, indices: Uint32Array | number[]): TriIndex {
  const idx = indices instanceof Uint32Array ? indices : Uint32Array.from(indices);
  const total = Math.floor(idx.length / 3);
  const order = new Uint32Array(total);
  const cx = new Float64Array(total);
  const cy = new Float64Array(total);
  const cz = new Float64Array(total);
  const tb = new Float32Array(total * 6);
  let n = 0;
  let vol6 = 0;
  for (let t = 0; t < total; t++) {
    const a = idx[t * 3] * 3;
    const b = idx[t * 3 + 1] * 3;
    const c = idx[t * 3 + 2] * 3;
    const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
    const bx = positions[b], by = positions[b + 1], bz = positions[b + 2];
    const qx = positions[c], qy = positions[c + 1], qz = positions[c + 2];
    const nx = (by - ay) * (qz - az) - (bz - az) * (qy - ay);
    const ny = (bz - az) * (qx - ax) - (bx - ax) * (qz - az);
    const nz = (bx - ax) * (qy - ay) - (by - ay) * (qx - ax);
    if (!(nx * nx + ny * ny + nz * nz > 1e-24)) continue; // nulová plocha (nebo NaN)
    vol6 += ax * (by * qz - bz * qy) + ay * (bz * qx - bx * qz) + az * (bx * qy - by * qx);
    cx[t] = (ax + bx + qx) / 3;
    cy[t] = (ay + by + qy) / 3;
    cz[t] = (az + bz + qz) / 3;
    const o = t * 6;
    tb[o] = Math.min(ax, bx, qx);
    tb[o + 1] = Math.min(ay, by, qy);
    tb[o + 2] = Math.min(az, bz, qz);
    tb[o + 3] = Math.max(ax, bx, qx);
    tb[o + 4] = Math.max(ay, by, qy);
    tb[o + 5] = Math.max(az, bz, qz);
    order[n++] = t;
  }
  const cap = Math.max(1, 2 * n);
  const box = new Float64Array(cap * 6);
  const right = new Int32Array(cap);
  const start = new Int32Array(cap).fill(-1);
  const count = new Int32Array(cap);
  let nodes = 0;
  let depth = 0;
  const cen = [cx, cy, cz];

  const build = (lo: number, hi: number, level: number): number => {
    const node = nodes++;
    if (level > depth) depth = level;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    let mx0 = Infinity, my0 = Infinity, mz0 = Infinity, mx1 = -Infinity, my1 = -Infinity, mz1 = -Infinity;
    for (let i = lo; i < hi; i++) {
      const t = order[i];
      const o = t * 6;
      if (tb[o] < x0) x0 = tb[o];
      if (tb[o + 1] < y0) y0 = tb[o + 1];
      if (tb[o + 2] < z0) z0 = tb[o + 2];
      if (tb[o + 3] > x1) x1 = tb[o + 3];
      if (tb[o + 4] > y1) y1 = tb[o + 4];
      if (tb[o + 5] > z1) z1 = tb[o + 5];
      if (cx[t] < mx0) mx0 = cx[t];
      if (cx[t] > mx1) mx1 = cx[t];
      if (cy[t] < my0) my0 = cy[t];
      if (cy[t] > my1) my1 = cy[t];
      if (cz[t] < mz0) mz0 = cz[t];
      if (cz[t] > mz1) mz1 = cz[t];
    }
    const o = node * 6;
    box[o] = x0; box[o + 1] = y0; box[o + 2] = z0; box[o + 3] = x1; box[o + 4] = y1; box[o + 5] = z1;
    if (hi - lo <= LEAF) {
      start[node] = lo;
      count[node] = hi - lo;
      return node;
    }
    // dělení v polovině rozsahu těžišť nejdelší osy; nejde-li rozdělit (shodná těžiště), napůl podle počtu
    const ex = mx1 - mx0, ey = my1 - my0, ez = mz1 - mz0;
    const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
    const c = cen[axis];
    const mid = axis === 0 ? (mx0 + mx1) / 2 : axis === 1 ? (my0 + my1) / 2 : (mz0 + mz1) / 2;
    let i = lo;
    let j = hi - 1;
    while (i <= j) {
      if (c[order[i]] < mid) i++;
      else {
        const tmp = order[i];
        order[i] = order[j];
        order[j] = tmp;
        j--;
      }
    }
    let split = i;
    if (split === lo || split === hi) split = (lo + hi) >> 1;
    build(lo, split, level + 1);
    right[node] = build(split, hi, level + 1);
    return node;
  };
  if (n) build(0, n, 1);
  return { positions, indices: idx, order, box, right, start, count, nodes, depth, triangles: n, orient: vol6 < 0 ? -1 : 1, volume: Math.abs(vol6) / 6 };
}

/** pracovní paměť dotazu (zásobník uzlů) – sdílená, dotazy nejsou souběžné */
let stackNode = new Int32Array(128);
let stackD2 = new Float64Array(128);
/** výsledek posledního dotazu: [d², trojúhelník, qx, qy, qz, vzdálenost od roviny trojúhelníku se znaménkem] */
const R = new Float64Array(6);

/** Nejbližší bod trojúhelníku k bodu p (Ericson, Real-Time Collision Detection); výsledek do `q`. */
function closestOnTriangle(px: number, py: number, pz: number, P: Float32Array, a: number, b: number, c: number, q: Float64Array) {
  const ax = P[a], ay = P[a + 1], az = P[a + 2];
  const abx = P[b] - ax, aby = P[b + 1] - ay, abz = P[b + 2] - az;
  const acx = P[c] - ax, acy = P[c + 1] - ay, acz = P[c + 2] - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) {
    q[0] = ax; q[1] = ay; q[2] = az;
    return;
  }
  const bpx = apx - abx, bpy = apy - aby, bpz = apz - abz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) {
    q[0] = ax + abx; q[1] = ay + aby; q[2] = az + abz;
    return;
  }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    q[0] = ax + v * abx; q[1] = ay + v * aby; q[2] = az + v * abz;
    return;
  }
  const cpx = apx - acx, cpy = apy - acy, cpz = apz - acz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) {
    q[0] = ax + acx; q[1] = ay + acy; q[2] = az + acz;
    return;
  }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    q[0] = ax + w * acx; q[1] = ay + w * acy; q[2] = az + w * acz;
    return;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    q[0] = ax + abx + w * (acx - abx); q[1] = ay + aby + w * (acy - aby); q[2] = az + abz + w * (acz - abz);
    return;
  }
  const den = 1 / (va + vb + vc);
  const v = vb * den;
  const w = vc * den;
  q[0] = ax + abx * v + acx * w; q[1] = ay + aby * v + acy * w; q[2] = az + abz * v + acz * w;
}

const Q = new Float64Array(3);

/** vyhodnotí trojúhelník `t` proti bodu a případně zlepší výsledek v `R` */
function tryTriangle(ix: TriIndex, t: number, px: number, py: number, pz: number) {
  const P = ix.positions;
  const I = ix.indices;
  const a = I[t * 3] * 3;
  const b = I[t * 3 + 1] * 3;
  const c = I[t * 3 + 2] * 3;
  closestOnTriangle(px, py, pz, P, a, b, c, Q);
  const dx = px - Q[0], dy = py - Q[1], dz = pz - Q[2];
  const d2 = dx * dx + dy * dy + dz * dz;
  const best = R[0];
  const tie = 1e-9 * (1 + best);
  if (d2 > best + tie) return;
  // vzdálenost od roviny trojúhelníku se znaménkem (pro znaménko výsledku a rozhodnutí při shodě vzdáleností)
  const abx = P[b] - P[a], aby = P[b + 1] - P[a + 1], abz = P[b + 2] - P[a + 2];
  const acx = P[c] - P[a], acy = P[c + 1] - P[a + 1], acz = P[c + 2] - P[a + 2];
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  const pd = (dx * nx + dy * ny + dz * nz) / Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (best === Infinity || d2 < best - tie || Math.abs(pd) > Math.abs(R[5])) {
    if (d2 < best) R[0] = d2;
    R[1] = t;
    R[2] = Q[0]; R[3] = Q[1]; R[4] = Q[2];
    R[5] = pd;
  }
}

/** hledání nejbližšího trojúhelníku; výsledek v `R`. `hint` = trojúhelník pro první odhad (např. výsledek sousedního bodu). */
function query(ix: TriIndex, px: number, py: number, pz: number, hint: number) {
  R[0] = Infinity;
  R[1] = -1;
  R[5] = 0;
  if (!ix.triangles) return;
  if (hint >= 0) tryTriangle(ix, hint, px, py, pz);
  if (stackNode.length < ix.depth + 2) {
    stackNode = new Int32Array(ix.depth + 16);
    stackD2 = new Float64Array(ix.depth + 16);
  }
  const { box, right, start, count, order } = ix;
  let sp = 0;
  stackNode[0] = 0;
  stackD2[0] = 0;
  sp = 1;
  while (sp > 0) {
    sp--;
    let node = stackNode[sp];
    if (stackD2[sp] > R[0] + 1e-9 * (1 + R[0])) continue;
    for (;;) {
      const n = count[node];
      if (n > 0) {
        const s = start[node];
        for (let i = 0; i < n; i++) {
          const t = order[s + i];
          if (t !== hint) tryTriangle(ix, t, px, py, pz);
        }
        break;
      }
      const l = node + 1;
      const r = right[node];
      let o = l * 6;
      let dx = px < box[o] ? box[o] - px : px > box[o + 3] ? px - box[o + 3] : 0;
      let dy = py < box[o + 1] ? box[o + 1] - py : py > box[o + 4] ? py - box[o + 4] : 0;
      let dz = pz < box[o + 2] ? box[o + 2] - pz : pz > box[o + 5] ? pz - box[o + 5] : 0;
      const dl = dx * dx + dy * dy + dz * dz;
      o = r * 6;
      dx = px < box[o] ? box[o] - px : px > box[o + 3] ? px - box[o + 3] : 0;
      dy = py < box[o + 1] ? box[o + 1] - py : py > box[o + 4] ? py - box[o + 4] : 0;
      dz = pz < box[o + 2] ? box[o + 2] - pz : pz > box[o + 5] ? pz - box[o + 5] : 0;
      const dr = dx * dx + dy * dy + dz * dz;
      const lim = R[0] + 1e-9 * (1 + R[0]);
      if (dl <= dr) {
        if (dr <= lim) {
          stackNode[sp] = r;
          stackD2[sp] = dr;
          sp++;
        }
        if (dl > lim) break;
        node = l;
      } else {
        if (dl <= lim) {
          stackNode[sp] = l;
          stackD2[sp] = dl;
          sp++;
        }
        if (dr > lim) break;
        node = r;
      }
    }
  }
}

/** Nejbližší bod sítě k bodu `p` (null u prázdné sítě). */
export function nearestOnMesh(ix: TriIndex, p: ArrayLike<number>): Nearest | null {
  query(ix, p[0], p[1], p[2], -1);
  if (R[1] < 0) return null;
  const d = Math.sqrt(R[0]);
  return { distance: d, signed: (R[5] * ix.orient < 0 ? -1 : 1) * d, triangle: R[1], point: [R[2], R[3], R[4]] };
}

/**
 * Vzdálenost každého bodu (x, y, z po trojicích) od sítě. `signed` = se znaménkem (+ vně tělesa sítě, − uvnitř).
 * Body jdoucí po sobě bývají blízko sebe (vrcholy sítě), proto se jako první odhad zkouší trojúhelník z minulého bodu.
 */
export function distancesToMesh(ix: TriIndex, points: ArrayLike<number>, opts: { signed?: boolean } = {}): Float32Array {
  const n = Math.floor(points.length / 3);
  const out = new Float32Array(n);
  let hint = -1;
  for (let i = 0; i < n; i++) {
    query(ix, points[i * 3], points[i * 3 + 1], points[i * 3 + 2], hint);
    if (R[1] < 0) {
      out[i] = Infinity;
      continue;
    }
    hint = R[1];
    const d = Math.sqrt(R[0]);
    out[i] = opts.signed && R[5] * ix.orient < 0 ? -d : d;
  }
  return out;
}

/** Pomalá kontrolní varianta (všechny trojúhelníky) – jen pro testy. */
export function bruteDistance(positions: Float32Array, indices: ArrayLike<number>, p: ArrayLike<number>): number {
  let best = Infinity;
  for (let t = 0; t + 2 < indices.length; t += 3) {
    closestOnTriangle(p[0], p[1], p[2], positions, indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3, Q);
    const d2 = (p[0] - Q[0]) ** 2 + (p[1] - Q[1]) ** 2 + (p[2] - Q[2]) ** 2;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

export type DistanceStats = {
  count: number;
  /** největší |vzdálenost| */
  max: number;
  /** největší kladná (model vně reference = materiál navíc) a nejmenší záporná (model uvnitř reference = materiál chybí) */
  maxOut: number;
  maxIn: number;
  mean: number;
  rms: number;
  /** podíl bodů s |vzdáleností| ≤ tolerance (0–1) – závisí na hustotě sítě, pro uživatele je směrodatný `withinArea` */
  within: number;
  /** podíl plochy sítě v toleranci (0–1): každý trojúhelník přispívá plochou × podílem svých vrcholů v toleranci; jen se sítí */
  withinArea?: number;
  /** plocha sítě (mm²); jen se sítí */
  area?: number;
  /** bod s největší odchylkou (index vrcholu) */
  worst: number;
};

/** Souhrn mapy odchylek. Se sítí (`mesh`, vzdálenosti po vrcholech) i podíl plochy v toleranci. */
export function distanceStats(dist: ArrayLike<number>, tolerance: number, mesh?: { vertices: Float32Array; triangles: ArrayLike<number> }): DistanceStats {
  let max = 0, maxOut = 0, maxIn = 0, sum = 0, sq = 0, ok = 0, worst = -1, n = 0;
  for (let i = 0; i < dist.length; i++) {
    const d = dist[i];
    if (!Number.isFinite(d)) continue;
    const a = Math.abs(d);
    n++;
    sum += a;
    sq += a * a;
    if (a <= tolerance) ok++;
    if (a > max) {
      max = a;
      worst = i;
    }
    if (d > maxOut) maxOut = d;
    if (d < maxIn) maxIn = d;
  }
  const out: DistanceStats = { count: n, max, maxOut, maxIn, mean: n ? sum / n : 0, rms: n ? Math.sqrt(sq / n) : 0, within: n ? ok / n : 1, worst };
  if (mesh) {
    const { vertices: v, triangles: t } = mesh;
    let area = 0;
    let good = 0;
    for (let i = 0; i + 2 < t.length; i += 3) {
      const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
      const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
      const wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
      const s = Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) / 2;
      const k = (Math.abs(dist[t[i]]) <= tolerance ? 1 : 0) + (Math.abs(dist[t[i + 1]]) <= tolerance ? 1 : 0) + (Math.abs(dist[t[i + 2]]) <= tolerance ? 1 : 0);
      area += s;
      good += (s * k) / 3;
    }
    out.area = area;
    out.withinArea = area > 0 ? good / area : 1;
  }
  return out;
}

/** barvy stupnice: v toleranci zelená, nad tolerancí žlutá → oranžová → červená (plná červená při `full`) */
export const MAP_GREEN: [number, number, number] = [0.2, 0.72, 0.36];
export const MAP_YELLOW: [number, number, number] = [0.98, 0.86, 0.16];
export const MAP_ORANGE: [number, number, number] = [0.96, 0.5, 0.1];
export const MAP_RED: [number, number, number] = [0.86, 0.1, 0.1];

/** Barva (RGB 0–1) pro odchylku `d` při toleranci `tol` a plné červené při `full`. */
export function distanceColor(d: number, tol: number, full: number): [number, number, number] {
  const a = Math.abs(d);
  if (!(a > tol)) return MAP_GREEN;
  const t = full > tol ? (a - tol) / (full - tol) : 1;
  if (t >= 1) return MAP_RED;
  const [from, to, k] = t < 0.5 ? [MAP_YELLOW, MAP_ORANGE, t * 2] : [MAP_ORANGE, MAP_RED, (t - 0.5) * 2];
  return [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k, from[2] + (to[2] - from[2]) * k];
}

/** Barvy vrcholů (RGB po trojicích) pro mapu odchylek. */
export function distanceColors(dist: ArrayLike<number>, tol: number, full: number): Float32Array {
  const out = new Float32Array(dist.length * 3);
  for (let i = 0; i < dist.length; i++) {
    const c = distanceColor(Number.isFinite(dist[i]) ? dist[i] : full, tol, full);
    out[i * 3] = c[0];
    out[i * 3 + 1] = c[1];
    out[i * 3 + 2] = c[2];
  }
  return out;
}

export type RefinedMesh = {
  vertices: Float32Array;
  normals: Float32Array | null;
  triangles: Uint32Array;
  /** [start, count, plocha] po trojicích – stejné plochy jako vstup, nové rozsahy */
  faceGroups: Int32Array;
  /** skutečně použitá největší délka hrany (při vyčerpání limitu trojúhelníků mohou zůstat delší) */
  capped: boolean;
};

/**
 * Zjemní síť půlením nejdelší hrany, dokud je některá hrana delší než `maxEdge` (nebo do limitu `maxTriangles`).
 * Původní vrcholy zůstávají na začátku pole (indexy se nemění), nové (středy hran) se přidávají za ně; skupiny ploch se
 * zachovají. Důvod: rovinné plochy mají vrcholy jen na obvodu – bez zjemnění by odchylka uprostřed plochy nebyla vidět.
 */
export function refineMesh(mesh: { vertices: Float32Array; normals?: Float32Array | null; triangles: Uint32Array; faceGroups?: Int32Array | null }, maxEdge: number, maxTriangles = Infinity): RefinedMesh {
  const nv0 = mesh.vertices.length / 3;
  const withN = !!mesh.normals && mesh.normals.length === mesh.vertices.length;
  let cap = Math.max(16, Math.ceil(nv0 * 1.5));
  let V = new Float32Array(cap * 3);
  V.set(mesh.vertices);
  let N = withN ? new Float32Array(cap * 3) : null;
  if (N) N.set(mesh.normals!);
  let nv = nv0;
  const grow = () => {
    cap *= 2;
    const v2 = new Float32Array(cap * 3);
    v2.set(V);
    V = v2;
    if (N) {
      const n2 = new Float32Array(cap * 3);
      n2.set(N);
      N = n2;
    }
  };
  const mids = new Map<number, number>();
  const midpoint = (a: number, b: number): number => {
    const key = a < b ? a * 67108864 + b : b * 67108864 + a; // 2^26 – jednoznačné do 67 milionů vrcholů
    const hit = mids.get(key);
    if (hit !== undefined) return hit;
    if (nv >= cap) grow();
    const m = nv++;
    V[m * 3] = (V[a * 3] + V[b * 3]) / 2;
    V[m * 3 + 1] = (V[a * 3 + 1] + V[b * 3 + 1]) / 2;
    V[m * 3 + 2] = (V[a * 3 + 2] + V[b * 3 + 2]) / 2;
    if (N) {
      const x = N[a * 3] + N[b * 3], y = N[a * 3 + 1] + N[b * 3 + 1], z = N[a * 3 + 2] + N[b * 3 + 2];
      const l = Math.hypot(x, y, z) || 1;
      N[m * 3] = x / l;
      N[m * 3 + 1] = y / l;
      N[m * 3 + 2] = z / l;
    }
    mids.set(key, m);
    return m;
  };
  const len2 = (a: number, b: number) => (V[a * 3] - V[b * 3]) ** 2 + (V[a * 3 + 1] - V[b * 3 + 1]) ** 2 + (V[a * 3 + 2] - V[b * 3 + 2]) ** 2;
  const lim2 = maxEdge > 0 ? maxEdge * maxEdge : Infinity;
  const nt0 = mesh.triangles.length / 3;
  let tcap = Math.max(16, nt0 * 2);
  let T = new Uint32Array(tcap * 3);
  let nt = 0;
  let pending = nt0; // dosud nezpracované původní trojúhelníky (počítají se do limitu)
  let capped = false;
  const emit = (a: number, b: number, c: number) => {
    if (nt >= tcap) {
      tcap *= 2;
      const t2 = new Uint32Array(tcap * 3);
      t2.set(T);
      T = t2;
    }
    T[nt * 3] = a;
    T[nt * 3 + 1] = b;
    T[nt * 3 + 2] = c;
    nt++;
  };
  const stack: number[] = [];
  const split = (a0: number, b0: number, c0: number) => {
    stack.length = 0;
    stack.push(a0, b0, c0);
    while (stack.length) {
      const c = stack.pop()!;
      const b = stack.pop()!;
      const a = stack.pop()!;
      const ab = len2(a, b);
      const bc = len2(b, c);
      const ca = len2(c, a);
      const longest = Math.max(ab, bc, ca);
      if (!(longest > lim2)) {
        emit(a, b, c);
        continue;
      }
      if (nt + stack.length / 3 + pending + 2 > maxTriangles) {
        capped = true;
        emit(a, b, c);
        continue;
      }
      if (ab >= bc && ab >= ca) {
        const m = midpoint(a, b);
        stack.push(a, m, c, m, b, c);
      } else if (bc >= ca) {
        const m = midpoint(b, c);
        stack.push(a, b, m, a, m, c);
      } else {
        const m = midpoint(c, a);
        stack.push(a, b, m, m, b, c);
      }
    }
  };
  const tri = mesh.triangles;
  const groups: number[] = [];
  const src = mesh.faceGroups && mesh.faceGroups.length ? mesh.faceGroups : new Int32Array([0, tri.length, -1]);
  // skupiny podle začátku; trojúhelníky mimo skupiny (nemělo by nastat) se zjemní bez skupiny
  const gi = Array.from({ length: src.length / 3 }, (_, i) => i).sort((x, y) => src[x * 3] - src[y * 3]);
  let at = 0;
  const run = (from: number, to: number) => {
    for (let i = from; i + 2 < to; i += 3) {
      pending--;
      split(tri[i], tri[i + 1], tri[i + 2]);
    }
  };
  for (const g of gi) {
    const s = src[g * 3];
    const n = src[g * 3 + 1];
    if (s > at) run(at, s);
    const first = nt * 3;
    run(Math.max(s, at), s + n);
    if (mesh.faceGroups && mesh.faceGroups.length) groups.push(first, nt * 3 - first, src[g * 3 + 2]);
    at = Math.max(at, s + n);
  }
  if (at < tri.length) run(at, tri.length);
  return { vertices: V.slice(0, nv * 3), normals: N ? (N as Float32Array).slice(0, nv * 3) : null, triangles: T.slice(0, nt * 3), faceGroups: Int32Array.from(groups), capped };
}

/** Plocha sítě (mm²). */
export function meshArea(vertices: Float32Array, triangles: ArrayLike<number>): number {
  let s = 0;
  for (let t = 0; t + 2 < triangles.length; t += 3) {
    const a = triangles[t] * 3, b = triangles[t + 1] * 3, c = triangles[t + 2] * 3;
    const ux = vertices[b] - vertices[a], uy = vertices[b + 1] - vertices[a + 1], uz = vertices[b + 2] - vertices[a + 2];
    const vx = vertices[c] - vertices[a], vy = vertices[c + 1] - vertices[a + 1], vz = vertices[c + 2] - vertices[a + 2];
    s += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return s;
}

/**
 * Krok zjemnění (největší délka hrany) tak, aby síť po zjemnění měla přibližně nejvýš `budget` trojúhelníků.
 * Půlením nejdelší hrany vznikají trojúhelníky o ploše zhruba 0,2 × krok².
 */
export function stepForBudget(area: number, triangles: number, budget: number, wanted: number): number {
  const free = budget - triangles;
  if (free <= triangles * 0.1) return Infinity; // síť už limit vyčerpala – nezjemňovat
  return Math.max(wanted, Math.sqrt(area / (0.2 * free)));
}

/** Otočení o násobky 90° kolem os X, Y, Z (v tomto pořadí, kolem počátku) jako matice 3×3 po řádcích – přesně celočíselná. */
export function rotationMatrix(rot: ArrayLike<number>): number[] {
  const q = (deg: number) => ((Math.round(deg / 90) % 4) + 4) % 4;
  const cs = (k: number): [number, number] => [[1, 0, -1, 0][k], [0, 1, 0, -1][k]];
  const [cx, sx] = cs(q(rot[0] || 0));
  const [cy, sy] = cs(q(rot[1] || 0));
  const [cz, sz] = cs(q(rot[2] || 0));
  // R = Rz · Ry · Rx
  return [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy, cy * sx, cy * cx,
  ].map((v) => v + 0); // −0 → 0
}

/** 24 různých otočení o násobky 90° – každé s nejjednodušším zápisem úhlů (nejméně nenulových os, nejmenší úhly). */
export function rightAngleRotations(): { rot: [number, number, number]; m: number[] }[] {
  const all: { rot: [number, number, number]; m: number[]; cost: number }[] = [];
  for (const x of [0, 90, 180, 270]) for (const y of [0, 90, 180, 270]) for (const z of [0, 90, 180, 270]) all.push({ rot: [x, y, z], m: rotationMatrix([x, y, z]), cost: [x, y, z].filter(Boolean).length * 1000 + x + y + z });
  all.sort((a, b) => a.cost - b.cost);
  const seen = new Set<string>();
  return all.filter((c) => {
    const k = c.m.join(",");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).map(({ rot, m }) => ({ rot, m }));
}

/** p′ = M·p + t pro pole bodů (M 3×3 po řádcích). */
export function transformPoints(points: Float32Array, m: ArrayLike<number>, t: ArrayLike<number>): Float32Array {
  const out = new Float32Array(points.length);
  for (let i = 0; i + 2 < points.length; i += 3) {
    const x = points[i], y = points[i + 1], z = points[i + 2];
    out[i] = m[0] * x + m[1] * y + m[2] * z + t[0];
    out[i + 1] = m[3] * x + m[4] * y + m[5] * z + t[1];
    out[i + 2] = m[6] * x + m[7] * y + m[8] * z + t[2];
  }
  return out;
}

// ── umístění reference vůči modelu ─────────────────────────────────────────────────────────────────────────────

export type Box = [[number, number, number], [number, number, number]];
type V3 = [number, number, number];

/** Obalový kvádr bodů (x, y, z po trojicích). */
export function boundsOfPoints(points: ArrayLike<number>): Box {
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < points.length; i += 3)
    for (let k = 0; k < 3; k++) {
      const v = points[i + k];
      if (v < lo[k]) lo[k] = v;
      if (v > hi[k]) hi[k] = v;
    }
  if (!(lo[0] <= hi[0])) return [[0, 0, 0], [0, 0, 0]];
  return [lo, hi];
}

export const boxCenter = (b: Box): V3 => [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2, (b[0][2] + b[1][2]) / 2];
export const boxSize = (b: Box): V3 => [b[1][0] - b[0][0], b[1][1] - b[0][1], b[1][2] - b[0][2]];
export const boxDiag = (b: Box): number => Math.hypot(...boxSize(b));

/** p′ = M·p + t pro jeden bod. */
export function transformPoint(p: ArrayLike<number>, m: ArrayLike<number>, t: ArrayLike<number>): V3 {
  return [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + t[0], m[3] * p[0] + m[4] * p[1] + m[5] * p[2] + t[1], m[6] * p[0] + m[7] * p[1] + m[8] * p[2] + t[2]];
}

/** Obalový kvádr kvádru po transformaci p′ = M·p + t (obal osmi rohů – u otočení o násobky 90° přesný). */
export function transformBox(b: Box, m: ArrayLike<number>, t: ArrayLike<number>): Box {
  const pts: number[] = [];
  for (const x of [b[0][0], b[1][0]]) for (const y of [b[0][1], b[1][1]]) for (const z of [b[0][2], b[1][2]]) pts.push(...transformPoint([x, y, z], m, t));
  return boundsOfPoints(pts);
}

export type AlignMode = "none" | "center" | "auto";
/** umístění reference: p′ = M·p + t; `rot` = úhly kolem X, Y, Z (°, násobky 90, v tomto pořadí kolem počátku) */
export type Placement3 = { rot: V3; m: number[]; t: V3 };

/**
 * Umístění reference podle zadání: otočení `rot` kolem počátku, potom (při `center`) posun středu obalového kvádru reference
 * na střed kvádru modelu a nakonec ruční posun `offset`.
 */
export function placementFor(center: boolean, rot: ArrayLike<number>, offset: ArrayLike<number>, modelBox: Box, refBox: Box): Placement3 {
  const m = rotationMatrix(rot);
  const q = (deg: number) => (((Math.round(deg / 90) % 4) + 4) % 4) * 90;
  const t: V3 = [0, 0, 0];
  if (center) {
    const cm = boxCenter(modelBox);
    const cr = transformPoint(boxCenter(refBox), m, [0, 0, 0]);
    for (let k = 0; k < 3; k++) t[k] = cm[k] - cr[k];
  }
  for (let k = 0; k < 3; k++) t[k] += offset[k] || 0;
  return { rot: [q(rot[0] || 0), q(rot[1] || 0), q(rot[2] || 0)], m, t };
}

/** Rovnoměrný vzorek nejvýš `max` bodů (každý k-tý bod). */
export function samplePoints(points: Float32Array, max: number): Float32Array {
  const n = Math.floor(points.length / 3);
  if (n <= max) return points;
  const step = Math.ceil(n / max);
  const out = new Float32Array(Math.ceil(n / step) * 3);
  let o = 0;
  for (let i = 0; i < n; i += step) {
    out[o++] = points[i * 3];
    out[o++] = points[i * 3 + 1];
    out[o++] = points[i * 3 + 2];
  }
  return out.subarray(0, o);
}

/**
 * Skóre polohy: průměrná vzdálenost bodů po transformaci p′ = M·p + t od sítě; každá vzdálenost se omezí na `cap`
 * (odlišné prvky – chybějící drážka, výstupek – pak skóre nezkreslí víc než posunutá poloha).
 */
export function fitScore(ix: TriIndex, points: ArrayLike<number>, m: ArrayLike<number>, t: ArrayLike<number>, cap = Infinity): number {
  const n = Math.floor(points.length / 3);
  if (!n || !ix.triangles) return Infinity;
  let sum = 0;
  let hint = -1;
  for (let i = 0; i < n; i++) {
    const x = points[i * 3], y = points[i * 3 + 1], z = points[i * 3 + 2];
    query(ix, m[0] * x + m[1] * y + m[2] * z + t[0], m[3] * x + m[4] * y + m[5] * z + t[1], m[6] * x + m[7] * y + m[8] * z + t[2], hint);
    hint = R[1];
    const d = Math.sqrt(R[0]);
    sum += d < cap ? d : cap;
  }
  return sum / n;
}

export type FitResult = Placement3 & {
  /** skóre vybrané polohy (mm) */
  score: number;
  /** skóre reference bez jakéhokoli přesunu (mm) */
  asIsScore: number;
  /** vybraná poloha je „jak je“ (reference se nepřesouvá) */
  asIs: boolean;
  /** počet zkoušených poloh */
  tried: number;
};

/**
 * Levné automatické umístění reference: zkusí polohu „jak je“ a 24 otočení o násobky 90° se středy obalových kvádrů na sobě
 * a vybere tu s nejmenším skóre (`fitScore` vzorku bodů reference vůči síti modelu). Poloha „jak je“ má přednost, není-li
 * žádná jiná znatelně lepší; mezi stejně dobrými otočeními (souměrný díl) vyhrává nejjednodušší.
 * Není to obecné nejlepší proložení – šikmo otočenou referenci nenajde.
 */
export function bestRightAngleFit(ix: TriIndex, modelBox: Box, refPoints: Float32Array, refBox: Box): FitResult {
  const diag = boxDiag(modelBox) || 1;
  const cap = diag * 0.05;
  const eps = diag * 1e-6;
  const better = (a: number, b: number) => a < b * 0.98 - eps;
  const asIsScore = fitScore(ix, refPoints, [1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 0], cap);
  let best: (Placement3 & { score: number }) | null = null;
  let tried = 1;
  const ms = boxSize(modelBox);
  const cands = rightAngleRotations().map((c) => {
    const p = placementFor(true, c.rot, [0, 0, 0], modelBox, refBox);
    const s = boxSize(transformBox(refBox, p.m, p.t));
    // nejdřív polohy, ve kterých sedí rozměry obalových kvádrů (ostatní se zkouší jen tehdy, když žádná taková není)
    const fits = s.every((v, k) => Math.abs(v - ms[k]) <= 0.02 * diag);
    return { p, fits };
  });
  const pool = cands.some((c) => c.fits) ? cands.filter((c) => c.fits) : cands;
  for (const c of pool) {
    tried++;
    const score = fitScore(ix, refPoints, c.p.m, c.p.t, cap);
    if (!best || better(score, best.score)) best = { ...c.p, score };
  }
  if (!best || !better(best.score, asIsScore)) return { rot: [0, 0, 0], m: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0], score: asIsScore, asIsScore, asIs: true, tried };
  return { ...best, asIsScore, asIs: false, tried };
}
