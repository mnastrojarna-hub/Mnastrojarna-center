/**
 * Topologie dílu z trojúhelníkové sítě — pro CAD vzhled (hrany ploch) a uchopování při měření.
 *
 * STEP/IGES z OpenCascade mají každou plochu B-repu zvlášť (vrcholy se mezi plochami opakují),
 * takže: 1) svaříme shodné vrcholy, 2) hrana trojúhelníků mezi dvěma různými plochami (nebo
 * okrajová) = hrana B-repu, 3) hrany spojíme do křivek mezi rohy, 4) křivky rozpoznáme
 * (úsečka / kružnice / oblouk → střed a poloměr), 5) plochy rozpoznáme (rovina / válec).
 * Sítě bez ploch (STL, OBJ…) se nejprve rozdělí na plochy podle úhlu sousedních trojúhelníků.
 */

export type Vec3 = [number, number, number];

export type CurveKind = "line" | "circle" | "arc" | "curve";

export interface Curve {
  kind: CurveKind;
  /** Úsečky křivky v PartTopology.edgeSegments: [segStart, segStart + segCount). */
  segStart: number;
  segCount: number;
  closed: boolean;
  length: number;
  start: Vec3;
  end: Vec3;
  /** Bod v polovině délky. */
  mid: Vec3;
  center?: Vec3;
  radius?: number;
  /** Normála roviny kružnice / směr úsečky. */
  normal?: Vec3;
}

export type FaceKind = "plane" | "cylinder" | "other";

export interface FaceInfo {
  kind: FaceKind;
  area: number;
  /** Rovina: normála; válec: osa. */
  normal?: Vec3;
  /** Rovina: bod na ní (těžiště); válec: bod na ose. */
  point?: Vec3;
  radius?: number;
}

export interface PartTopology {
  /** Dvojice bodů xyz — hrany ploch pro vykreslení a uchopení „bod na hraně". */
  edgeSegments: Float32Array;
  curves: Curve[];
  /** Křivka každé úsečky (index do curves). */
  segCurve: Uint32Array;
  /** Rohy (konce křivek) xyz. */
  corners: Float32Array;
  /** Plocha každého trojúhelníku. */
  triFace: Uint32Array;
  faces: FaceInfo[];
  /** Okrajové hrany (síť není uzavřená → objem / hmotnost jen orientačně). */
  boundaryEdges?: number;
}

export interface TopologyInput {
  positions: Float32Array;
  indices?: Uint32Array | null;
  /** Rozsahy trojúhelníků ploch B-repu (včetně last). */
  faces?: { first: number; last: number }[] | null;
}

// ---------------------------------------------------------------- pomocné vektory

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const norm = (a: Vec3): Vec3 => {
  const l = len(a);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};

// ---------------------------------------------------------------- hash tabulka (otevřené adresování)

function pow2Above(n: number): number {
  let c = 16;
  while (c < n) c *= 2;
  return c;
}

/**
 * Svaření vrcholů: stejná poloha (v rámci tolerance mřížky) → stejné id.
 * Vrací pro každý vrchol id svařeného vrcholu a počet unikátních.
 */
export function weldVertices(positions: Float32Array, tolerance: number): { ids: Uint32Array; count: number; rep: Uint32Array } {
  const n = positions.length / 3;
  const ids = new Uint32Array(n);
  const cap = pow2Above(n * 2);
  const mask = cap - 1;
  const slotX = new Int32Array(cap);
  const slotY = new Int32Array(cap);
  const slotZ = new Int32Array(cap);
  const slotId = new Int32Array(cap).fill(-1);
  const rep = new Uint32Array(n);
  const inv = tolerance > 0 ? 1 / tolerance : 1e6;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const x = Math.round(positions[i * 3] * inv);
    const y = Math.round(positions[i * 3 + 1] * inv);
    const z = Math.round(positions[i * 3 + 2] * inv);
    let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mask;
    for (;;) {
      const s = slotId[h];
      if (s < 0) {
        slotX[h] = x;
        slotY[h] = y;
        slotZ[h] = z;
        slotId[h] = count;
        rep[count] = i;
        ids[i] = count++;
        break;
      }
      if (slotX[h] === x && slotY[h] === y && slotZ[h] === z) {
        ids[i] = s;
        break;
      }
      h = (h + 1) & mask;
    }
  }
  return { ids, count, rep: rep.slice(0, count) };
}

/** Mapa hran (a < b) → až dva trojúhelníky + počet. */
class EdgeTable {
  readonly a: Int32Array;
  readonly b: Int32Array;
  readonly t1: Int32Array;
  readonly t2: Int32Array;
  readonly count: Uint8Array;
  readonly mask: number;
  size = 0;

  constructor(expected: number) {
    const cap = pow2Above(expected * 2);
    this.mask = cap - 1;
    this.a = new Int32Array(cap).fill(-1);
    this.b = new Int32Array(cap);
    this.t1 = new Int32Array(cap);
    this.t2 = new Int32Array(cap).fill(-1);
    this.count = new Uint8Array(cap);
  }

  add(v0: number, v1: number, tri: number): void {
    const a = v0 < v1 ? v0 : v1;
    const b = v0 < v1 ? v1 : v0;
    let h = (Math.imul(a, 2654435761) ^ Math.imul(b, 40503)) & this.mask;
    for (;;) {
      if (this.a[h] < 0) {
        this.a[h] = a;
        this.b[h] = b;
        this.t1[h] = tri;
        this.count[h] = 1;
        this.size++;
        return;
      }
      if (this.a[h] === a && this.b[h] === b) {
        if (this.count[h] === 1) this.t2[h] = tri;
        if (this.count[h] < 255) this.count[h]++;
        return;
      }
      h = (h + 1) & this.mask;
    }
  }
}

// ---------------------------------------------------------------- rozpoznání křivek

/** Kružnice třemi body (null = body na přímce). */
export function circleFrom3(p1: Vec3, p2: Vec3, p3: Vec3): { center: Vec3; radius: number; normal: Vec3 } | null {
  const a = sub(p2, p1);
  const b = sub(p3, p1);
  const n = cross(a, b);
  const nn = dot(n, n);
  if (nn < 1e-24) return null;
  // střed = p1 + (|a|²(b×n) + |b|²(n×a)) / (2|n|²)
  const t1 = scale(cross(b, n), dot(a, a));
  const t2 = scale(cross(n, a), dot(b, b));
  const c = add(p1, scale(add(t1, t2), 1 / (2 * nn)));
  return { center: c, radius: len(sub(p1, c)), normal: norm(n) };
}

function pointAt(pts: Float64Array, i: number): Vec3 {
  return [pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]];
}

/** Rozpozná křivku z bodů polyčáry (u uzavřené se poslední bod nerovná prvnímu). */
export function classifyPolyline(pts: Float64Array, closed: boolean, tol: number): {
  kind: CurveKind; length: number; mid: Vec3; center?: Vec3; radius?: number; normal?: Vec3;
} {
  const n = pts.length / 3;
  const segs = closed ? n : n - 1;
  let length = 0;
  const segLen = new Float64Array(Math.max(segs, 0));
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % n;
    const l = Math.hypot(pts[j * 3] - pts[i * 3], pts[j * 3 + 1] - pts[i * 3 + 1], pts[j * 3 + 2] - pts[i * 3 + 2]);
    segLen[i] = l;
    length += l;
  }
  // bod v polovině délky
  let mid: Vec3 = pointAt(pts, 0);
  let acc = 0;
  for (let i = 0; i < segs; i++) {
    if (acc + segLen[i] >= length / 2) {
      const t = segLen[i] > 0 ? (length / 2 - acc) / segLen[i] : 0;
      const p = pointAt(pts, i);
      const q = pointAt(pts, (i + 1) % n);
      mid = add(p, scale(sub(q, p), t));
      break;
    }
    acc += segLen[i];
  }

  const first = pointAt(pts, 0);
  const last = pointAt(pts, n - 1);
  if (!closed) {
    const dir = sub(last, first);
    const dl = len(dir);
    if (dl > 0) {
      const u = scale(dir, 1 / dl);
      let maxDev = 0;
      for (let i = 1; i < n - 1; i++) {
        const v = sub(pointAt(pts, i), first);
        const d = len(sub(v, scale(u, dot(v, u))));
        if (d > maxDev) maxDev = d;
      }
      if (maxDev <= tol) return { kind: "line", length, mid, normal: u };
    }
  }

  // kružnice / oblouk: aspoň 4 body (3 úsečky), u uzavřené aspoň 6
  if ((closed && n >= 6) || (!closed && n >= 4)) {
    const i1 = 0;
    const i2 = Math.floor(n / 3);
    const i3 = Math.floor((2 * n) / 3);
    const c = circleFrom3(pointAt(pts, i1), pointAt(pts, i2), pointAt(pts, i3));
    if (c && c.radius > tol) {
      const rt = Math.max(tol, c.radius * 2e-3);
      let ok = true;
      for (let i = 0; i < n && ok; i++) {
        const v = sub(pointAt(pts, i), c.center);
        if (Math.abs(len(v) - c.radius) > rt || Math.abs(dot(v, c.normal)) > rt) ok = false;
      }
      if (ok) {
        // uzavřená křivka = celá kružnice; otevřená, ale skoro dokola → také kružnice
        const kind: CurveKind = closed ? "circle" : length >= 2 * Math.PI * c.radius * 0.995 ? "circle" : "arc";
        return { kind, length, mid, center: c.center, radius: c.radius, normal: c.normal };
      }
    }
  }
  return { kind: "curve", length, mid };
}

// ---------------------------------------------------------------- rozpoznání ploch

/** Vlastní vektor symetrické 3×3 matice s nejmenším vlastním číslem (Jacobi). */
export function smallestEigenvector(m: number[]): Vec3 {
  const a = m.slice();
  const v = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 32; sweep++) {
    const off = Math.abs(a[1]) + Math.abs(a[2]) + Math.abs(a[5]);
    if (off < 1e-14) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]] as const) {
      const apq = a[p * 3 + q];
      if (Math.abs(apq) < 1e-18) continue;
      const app = a[p * 3 + p];
      const aqq = a[q * 3 + q];
      const theta = (aqq - app) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k * 3 + p];
        const akq = a[k * 3 + q];
        a[k * 3 + p] = c * akp - s * akq;
        a[k * 3 + q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p * 3 + k];
        const aqk = a[q * 3 + k];
        a[p * 3 + k] = c * apk - s * aqk;
        a[q * 3 + k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k * 3 + p];
        const vkq = v[k * 3 + q];
        v[k * 3 + p] = c * vkp - s * vkq;
        v[k * 3 + q] = s * vkp + c * vkq;
      }
    }
  }
  let best = 0;
  for (let i = 1; i < 3; i++) if (a[i * 4] < a[best * 4]) best = i;
  return norm([v[best], v[3 + best], v[6 + best]]);
}

/** Kružnice metodou nejmenších čtverců v rovině (Kåsa). */
function fitCircle2D(xs: number[], ys: number[]): { cx: number; cy: number; r: number } | null {
  const n = xs.length;
  if (n < 3) return null;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (let i = 0; i < n; i++) {
    const u = xs[i] - mx;
    const v = ys[i] - my;
    suu += u * u;
    svv += v * v;
    suv += u * v;
    suuu += u * u * u;
    svvv += v * v * v;
    suvv += u * v * v;
    svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-18) return null;
  const b1 = 0.5 * (suuu + suvv);
  const b2 = 0.5 * (svvv + svuu);
  const uc = (b1 * svv - b2 * suv) / det;
  const vc = (suu * b2 - suv * b1) / det;
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);
  return { cx: uc + mx, cy: vc + my, r };
}

function classifyFace(
  tris: Uint32Array, triCount: number, pos: Float32Array, idx: (t: number, k: number) => number, tol: number,
): FaceInfo {
  // plošně vážená normála + kovariance normál
  let area = 0;
  const nsum: Vec3 = [0, 0, 0];
  const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const centroid: Vec3 = [0, 0, 0];
  const normals = new Float64Array(triCount * 3);
  const areas = new Float64Array(triCount);
  for (let i = 0; i < triCount; i++) {
    const t = tris[i];
    const a = idx(t, 0), b = idx(t, 1), c = idx(t, 2);
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const e1: Vec3 = [pos[b * 3] - ax, pos[b * 3 + 1] - ay, pos[b * 3 + 2] - az];
    const e2: Vec3 = [pos[c * 3] - ax, pos[c * 3 + 1] - ay, pos[c * 3 + 2] - az];
    const n = cross(e1, e2);
    const l = len(n);
    if (l === 0) continue;
    const ar = l / 2;
    area += ar;
    areas[i] = ar;
    const u: Vec3 = [n[0] / l, n[1] / l, n[2] / l];
    normals[i * 3] = u[0];
    normals[i * 3 + 1] = u[1];
    normals[i * 3 + 2] = u[2];
    nsum[0] += u[0] * ar;
    nsum[1] += u[1] * ar;
    nsum[2] += u[2] * ar;
    for (let r = 0; r < 3; r++) for (let s = 0; s < 3; s++) cov[r * 3 + s] += u[r] * u[s] * ar;
    centroid[0] += ((ax + pos[b * 3] + pos[c * 3]) / 3) * ar;
    centroid[1] += ((ay + pos[b * 3 + 1] + pos[c * 3 + 1]) / 3) * ar;
    centroid[2] += ((az + pos[b * 3 + 2] + pos[c * 3 + 2]) / 3) * ar;
  }
  if (area <= 0) return { kind: "other", area: 0 };
  const point = scale(centroid, 1 / area);
  const avg = norm(nsum);
  // rovina: všechny normály ≈ průměrná
  let planar = len(nsum) > 0;
  for (let i = 0; i < triCount && planar; i++) {
    if (areas[i] === 0) continue;
    const d = normals[i * 3] * avg[0] + normals[i * 3 + 1] * avg[1] + normals[i * 3 + 2] * avg[2];
    if (d < 0.99995) planar = false;
  }
  if (planar) {
    return { kind: "plane", area, normal: avg, point };
  }
  // válec: normály kolmé na osu → osa = vlastní vektor kovariance s nejmenším vlastním číslem
  if (triCount >= 4) {
    const axis = smallestEigenvector(cov);
    let perp = true;
    for (let i = 0; i < triCount && perp; i++) {
      if (areas[i] === 0) continue;
      const d = normals[i * 3] * axis[0] + normals[i * 3 + 1] * axis[1] + normals[i * 3 + 2] * axis[2];
      if (Math.abs(d) > 0.02) perp = false;
    }
    if (perp) {
      // body do roviny kolmé na osu, proložit kružnici
      const ref: Vec3 = Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      const u = norm(cross(axis, ref));
      const w = cross(axis, u);
      const xs: number[] = [];
      const ys: number[] = [];
      const seen = new Set<number>();
      for (let i = 0; i < triCount; i++) {
        for (let k = 0; k < 3; k++) {
          const v = idx(tris[i], k);
          if (seen.has(v)) continue;
          seen.add(v);
          const p: Vec3 = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
          xs.push(dot(p, u));
          ys.push(dot(p, w));
        }
      }
      const c = fitCircle2D(xs, ys);
      if (c && c.r > tol) {
        let ok = true;
        const rt = Math.max(tol * 4, c.r * 0.01);
        for (let i = 0; i < xs.length && ok; i++) {
          if (Math.abs(Math.hypot(xs[i] - c.cx, ys[i] - c.cy) - c.r) > rt) ok = false;
        }
        if (ok) {
          const along = dot(point, axis);
          const axisPoint = add(add(scale(u, c.cx), scale(w, c.cy)), scale(axis, along));
          return { kind: "cylinder", area, normal: axis, point: axisPoint, radius: c.r };
        }
      }
    }
  }
  return { kind: "other", area };
}

// ---------------------------------------------------------------- hlavní výpočet

/** Sítě bez B-repu (STL, 3D PDF…): hrana se kreslí až od 40° — hrubě tessellované oblé plochy bez čar. */
const COS_SHARP = Math.cos((40 * Math.PI) / 180);
const COS_SEGMENT = Math.cos((22 * Math.PI) / 180);

/** Topologie jednoho dílu. */
export function computeTopology(input: TopologyInput): PartTopology {
  const pos = input.positions;
  const vertCount = pos.length / 3;
  const indices = input.indices ?? null;
  const triCount = indices ? Math.floor(indices.length / 3) : Math.floor(vertCount / 3);
  const vi = indices ? (t: number, k: number) => indices[t * 3 + k] : (t: number, k: number) => t * 3 + k;

  // měřítko dílu → tolerance
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < vertCount; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const diag = vertCount ? Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) : 0;
  const weldTol = Math.max(diag * 1e-7, 1e-6);
  const geomTol = Math.max(diag * 1e-5, 1e-5);

  const { ids, count: weldedCount } = weldVertices(pos, weldTol);
  const w = (t: number, k: number) => ids[vi(t, k)];

  // normály trojúhelníků
  const triN = new Float32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    const a = vi(t, 0), b = vi(t, 1), c = vi(t, 2);
    const e1x = pos[b * 3] - pos[a * 3], e1y = pos[b * 3 + 1] - pos[a * 3 + 1], e1z = pos[b * 3 + 2] - pos[a * 3 + 2];
    const e2x = pos[c * 3] - pos[a * 3], e2y = pos[c * 3 + 1] - pos[a * 3 + 1], e2z = pos[c * 3 + 2] - pos[a * 3 + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    // degenerovaný trojúhelník (nulová plocha) → normála 0, s ničím netvoří ostrou hranu
    const l = Math.hypot(nx, ny, nz) || Infinity;
    triN[t * 3] = nx / l;
    triN[t * 3 + 1] = ny / l;
    triN[t * 3 + 2] = nz / l;
  }
  const degenerate = (t: number) => triN[t * 3] === 0 && triN[t * 3 + 1] === 0 && triN[t * 3 + 2] === 0;
  const triDot = (s: number, t: number) =>
    degenerate(s) || degenerate(t) ? 1 : triN[s * 3] * triN[t * 3] + triN[s * 3 + 1] * triN[t * 3 + 1] + triN[s * 3 + 2] * triN[t * 3 + 2];

  // hrany → trojúhelníky
  const edges = new EdgeTable(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    const a = w(t, 0), b = w(t, 1), c = w(t, 2);
    if (a === b || b === c || c === a) continue; // po svaření degenerovaný
    edges.add(a, b, t);
    edges.add(b, c, t);
    edges.add(c, a, t);
  }

  // plochy: z B-repu, jinak segmentace podle úhlu
  const triFace = new Uint32Array(triCount);
  let faceCount = 0;
  const brep = !!(input.faces && input.faces.length);
  if (brep) {
    triFace.fill(0xffffffff);
    input.faces!.forEach((f, i) => {
      for (let t = Math.max(0, f.first); t <= Math.min(triCount - 1, f.last); t++) triFace[t] = i;
    });
    faceCount = input.faces!.length;
    // trojúhelníky mimo rozsahy → vlastní plocha
    let orphan = -1;
    for (let t = 0; t < triCount; t++) {
      if (triFace[t] === 0xffffffff) {
        if (orphan < 0) orphan = faceCount++;
        triFace[t] = orphan;
      }
    }
  } else {
    // sousedé přes hrany (jen manifold dvojice)
    const adjStart = new Int32Array(triCount + 1);
    const cap = edges.a.length;
    for (let h = 0; h < cap; h++) {
      if (edges.a[h] >= 0 && edges.count[h] === 2) {
        adjStart[edges.t1[h] + 1]++;
        adjStart[edges.t2[h] + 1]++;
      }
    }
    for (let t = 0; t < triCount; t++) adjStart[t + 1] += adjStart[t];
    const adj = new Int32Array(adjStart[triCount]);
    const fill = adjStart.slice(0, triCount);
    for (let h = 0; h < cap; h++) {
      if (edges.a[h] >= 0 && edges.count[h] === 2) {
        adj[fill[edges.t1[h]]++] = edges.t2[h];
        adj[fill[edges.t2[h]]++] = edges.t1[h];
      }
    }
    triFace.fill(0xffffffff);
    const stack = new Int32Array(triCount);
    for (let s = 0; s < triCount; s++) {
      if (triFace[s] !== 0xffffffff) continue;
      const id = faceCount++;
      let sp = 0;
      stack[sp++] = s;
      triFace[s] = id;
      while (sp > 0) {
        const t = stack[--sp];
        for (let k = adjStart[t]; k < adjStart[t + 1]; k++) {
          const u = adj[k];
          if (triFace[u] === 0xffffffff && triDot(t, u) >= COS_SEGMENT) {
            triFace[u] = id;
            stack[sp++] = u;
          }
        }
      }
    }
  }

  // hrany ploch: okrajové, mezi různými plochami, ostré (u sítí bez B-repu)
  const cap = edges.a.length;
  let boundaryEdges = 0;
  const featA: number[] = [];
  const featB: number[] = [];
  const featF1: number[] = [];
  const featF2: number[] = [];
  for (let h = 0; h < cap; h++) {
    if (edges.a[h] < 0) continue;
    const c = edges.count[h];
    const t1 = edges.t1[h];
    let f1 = triFace[t1];
    let f2 = f1;
    let feature = false;
    if (c === 1) {
      feature = true;
      boundaryEdges++;
    }
    else if (c > 2) {
      feature = true;
      f2 = edges.t2[h] >= 0 ? triFace[edges.t2[h]] : f1;
    } else {
      const t2 = edges.t2[h];
      f2 = triFace[t2];
      // B-rep: jiná plocha = hrana; síť bez B-repu: jen ostrý lom (hranice oblastí na oblých plochách ne)
      feature = brep ? f1 !== f2 : triDot(t1, t2) < COS_SHARP;
    }
    if (!feature) continue;
    if (f2 < f1) {
      const x = f1;
      f1 = f2;
      f2 = x;
    }
    featA.push(edges.a[h]);
    featB.push(edges.b[h]);
    featF1.push(f1);
    featF2.push(f2);
  }

  // poloha svařeného vrcholu
  const weldedPos = new Float64Array(weldedCount * 3);
  for (let i = 0; i < vertCount; i++) {
    const id = ids[i];
    weldedPos[id * 3] = pos[i * 3];
    weldedPos[id * 3 + 1] = pos[i * 3 + 1];
    weldedPos[id * 3 + 2] = pos[i * 3 + 2];
  }

  // řetězení do křivek: vrchol je zlom, když stupeň ≠ 2 nebo se mění dvojice ploch
  const fe = featA.length;
  const vList = new Map<number, number[]>();
  for (let e = 0; e < fe; e++) {
    for (const v of [featA[e], featB[e]]) {
      let l = vList.get(v);
      if (!l) vList.set(v, (l = []));
      l.push(e);
    }
  }
  const label = (e: number) => featF1[e] * 4294967296 + featF2[e];
  const isBreak = (v: number): boolean => {
    const l = vList.get(v);
    if (!l || l.length !== 2) return true;
    return label(l[0]) !== label(l[1]);
  };

  const used = new Uint8Array(fe);
  const curves: Curve[] = [];
  const segOut: number[] = [];
  const segCurveOut: number[] = [];
  const cornerSet = new Set<number>();

  const emitChain = (verts: number[], closed: boolean) => {
    const n = verts.length;
    const pts = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
      pts[i * 3] = weldedPos[verts[i] * 3];
      pts[i * 3 + 1] = weldedPos[verts[i] * 3 + 1];
      pts[i * 3 + 2] = weldedPos[verts[i] * 3 + 2];
    }
    const cls = classifyPolyline(pts, closed, geomTol);
    const curveIndex = curves.length;
    const segStart = segOut.length / 6;
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % n;
      segOut.push(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2], pts[j * 3], pts[j * 3 + 1], pts[j * 3 + 2]);
      segCurveOut.push(curveIndex);
    }
    const start = pointAt(pts, 0);
    const end = closed ? start : pointAt(pts, n - 1);
    curves.push({
      kind: cls.kind, segStart, segCount: segs, closed, length: cls.length, start, end, mid: cls.mid,
      center: cls.center, radius: cls.radius, normal: cls.normal,
    });
    if (!closed) {
      cornerSet.add(verts[0]);
      cornerSet.add(verts[n - 1]);
    }
  };

  const walk = (startV: number, firstEdge: number): { verts: number[]; closed: boolean } => {
    const verts = [startV];
    let v = startV;
    let e = firstEdge;
    const lab = label(firstEdge);
    for (;;) {
      used[e] = 1;
      const next = featA[e] === v ? featB[e] : featA[e];
      if (next === startV) return { verts, closed: true };
      verts.push(next);
      if (isBreak(next)) return { verts, closed: false };
      const l = vList.get(next)!;
      const ne = l[0] === e ? l[1] : l[0];
      if (used[ne] || label(ne) !== lab) return { verts, closed: false };
      v = next;
      e = ne;
    }
  };

  // 1) řetězy z lomových vrcholů
  for (const [v, l] of vList) {
    if (!isBreak(v)) continue;
    for (const e of l) {
      if (used[e]) continue;
      const c = walk(v, e);
      emitChain(c.verts, false);
    }
  }
  // 2) zbylé uzavřené smyčky (díry, obvodové kružnice)
  for (let e = 0; e < fe; e++) {
    if (used[e]) continue;
    const c = walk(featA[e], e);
    emitChain(c.verts, c.closed);
  }

  const corners = new Float32Array(cornerSet.size * 3);
  let ci = 0;
  for (const v of cornerSet) {
    corners[ci++] = weldedPos[v * 3];
    corners[ci++] = weldedPos[v * 3 + 1];
    corners[ci++] = weldedPos[v * 3 + 2];
  }

  // plochy
  const faceTriStart = new Uint32Array(faceCount + 1);
  for (let t = 0; t < triCount; t++) faceTriStart[triFace[t] + 1]++;
  for (let f = 0; f < faceCount; f++) faceTriStart[f + 1] += faceTriStart[f];
  const faceTris = new Uint32Array(triCount);
  const fillF = faceTriStart.slice(0, faceCount);
  for (let t = 0; t < triCount; t++) faceTris[fillF[triFace[t]]++] = t;
  const faces: FaceInfo[] = [];
  for (let f = 0; f < faceCount; f++) {
    const s = faceTriStart[f];
    const cnt = faceTriStart[f + 1] - s;
    faces.push(classifyFace(faceTris.subarray(s, s + cnt), cnt, pos, vi, geomTol));
  }

  return {
    edgeSegments: Float32Array.from(segOut),
    curves,
    segCurve: Uint32Array.from(segCurveOut),
    corners,
    triFace,
    faces,
    boundaryEdges,
  };
}
