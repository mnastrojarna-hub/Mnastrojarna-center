/**
 * Složení rozdělené STEP sestavy: díly načtené zvlášť (step-split.ts) se umístí do výskytů.
 *
 * Díl použitý vícekrát se čte i triangluje jen jednou; pro každý výskyt se přepočítají souřadnice
 * (a topologie pro měření — rotace + posun, bez nového výpočtu). Indexy trojúhelníků se mezi
 * výskyty sdílejí (renderer i BVH je jen čtou), poslední výskyt přebere pole prototypu.
 */
import { computeTopology, type Curve, type FaceInfo, type PartTopology, type Vec3 } from "./topology";
import { isIdentity, isRigid, type Mat, type SplitNode, type SplitPlan } from "./step-split";
import type { MeshPart, ModelNode, ParsedModel } from "./types";

/** Výsledek jednoho dílu (prototypu) z workeru OpenCascade. */
export interface UnitResult {
  parts: MeshPart[];
  /** Topologie ke každé síti (null = počítá se až tady / vůbec). */
  topology: PartTopology[] | null;
}

function transformPoints(src: Float32Array, m: Mat, out: Float32Array) {
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i], y = src[i + 1], z = src[i + 2];
    out[i] = m[0] * x + m[1] * y + m[2] * z + m[3];
    out[i + 1] = m[4] * x + m[5] * y + m[6] * z + m[7];
    out[i + 2] = m[8] * x + m[9] * y + m[10] * z + m[11];
  }
}

/** Normály: u otočení stačí otočit; obecně inverzní transponovaná + normalizace. */
function transformNormals(src: Float32Array, m: Mat, rigid: boolean, out: Float32Array) {
  let a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], k = m[10];
  if (!rigid) {
    // inverzní transponovaná 3 × 3 = kofaktory / det (det se vyruší normalizací)
    const A = e * k - f * h, B = -(d * k - f * g), C = d * h - e * g;
    const D = -(b * k - c * h), E = a * k - c * g, F = -(a * h - b * g);
    const G = b * f - c * e, H = -(a * f - c * d), K = a * e - b * d;
    [a, b, c, d, e, f, g, h, k] = [A, B, C, D, E, F, G, H, K];
  }
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i], y = src[i + 1], z = src[i + 2];
    let nx = a * x + b * y + c * z, ny = d * x + e * y + f * z, nz = g * x + h * y + k * z;
    if (!rigid) {
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
    }
    out[i] = nx;
    out[i + 1] = ny;
    out[i + 2] = nz;
  }
}

const tp = (m: Mat, p: Vec3): Vec3 => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3], m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7], m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11]];
const tv = (m: Mat, v: Vec3): Vec3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[4] * v[0] + m[5] * v[1] + m[6] * v[2], m[8] * v[0] + m[9] * v[1] + m[10] * v[2]];

export function transformCurves(curves: Curve[], m: ArrayLike<number>): Curve[] {
  const mm = m as Mat;
  return curves.map((c) => ({
    ...c,
    start: tp(mm, c.start),
    end: tp(mm, c.end),
    mid: tp(mm, c.mid),
    center: c.center ? tp(mm, c.center) : undefined,
    normal: c.normal ? tv(mm, c.normal) : undefined,
  }));
}

export function transformFaces(faces: FaceInfo[], m: ArrayLike<number>): FaceInfo[] {
  const mm = m as Mat;
  return faces.map((f) => ({
    ...f,
    normal: f.normal ? tv(mm, f.normal) : undefined,
    point: f.point ? tp(mm, f.point) : undefined,
  }));
}

/** Topologie dílu v jiném umístění (jen otočení + posun). */
export function transformTopology(t: PartTopology, m: Mat, inPlace: boolean): PartTopology {
  const edgeSegments = inPlace ? t.edgeSegments : new Float32Array(t.edgeSegments.length);
  transformPoints(t.edgeSegments, m, edgeSegments);
  const corners = inPlace ? t.corners : new Float32Array(t.corners.length);
  transformPoints(t.corners, m, corners);
  return { ...t, edgeSegments, corners, curves: transformCurves(t.curves, m), faces: transformFaces(t.faces, m) };
}

/** Prototyp křivek a ploch dílu (sdílený výskyty s `lazy`). */
export interface ProtoTopology {
  curves: Curve[];
  faces: FaceInfo[];
}

/**
 * Na hlavním vlákně: výskytům s `lazy` doplní křivky a plochy z prototypu — přepočet až při prvním
 * čtení (měření, výběr plochy), ať tisíce výskytů nedrží v paměti miliony objektů.
 */
export function hydrateTopology(topology: PartTopology[], prototypes: ProtoTopology[] | undefined): PartTopology[] {
  if (!prototypes?.length) return topology;
  for (const t of topology) {
    const lazy = t.lazy;
    if (!lazy) continue;
    const proto = prototypes[lazy.proto];
    if (!proto) continue;
    const identity = isIdentity(Float64Array.from(lazy.matrix));
    let curves: Curve[] | null = null;
    let faces: FaceInfo[] | null = null;
    Object.defineProperty(t, "curves", {
      configurable: true,
      enumerable: true,
      get: () => (curves ??= identity ? proto.curves : transformCurves(proto.curves, lazy.matrix)),
      set: (v: Curve[]) => {
        curves = v;
      },
    });
    Object.defineProperty(t, "faces", {
      configurable: true,
      enumerable: true,
      get: () => (faces ??= identity ? proto.faces : transformFaces(proto.faces, lazy.matrix)),
      set: (v: FaceInfo[]) => {
        faces = v;
      },
    });
  }
  return topology;
}

const EMPTY_TOPO = (): PartTopology => ({ edgeSegments: new Float32Array(0), curves: [], segCurve: new Uint32Array(0), corners: new Float32Array(0), triFace: new Uint32Array(0), faces: [] });

/**
 * Výskyty dílů → sítě ve světových souřadnicích + strom sestavy.
 * `results[u]` = výsledek jednotky u (null = díl se nenačetl).
 * `withTopology` = false → topologie prázdná (velký model, hrany se nepočítají).
 */
export function bakeAssembly(
  plan: SplitPlan,
  results: (UnitResult | null)[],
  format: string,
  withTopology = true,
  lazyTopology = false,
): { model: ParsedModel; topology: PartTopology[]; prototypes?: ProtoTopology[] } {
  // líná topologie: křivky / plochy jednou za prototyp (index podle jednotky a sítě)
  const prototypes: ProtoTopology[] = [];
  const protoIndex = new Map<string, number>();
  // poslední výskyt jednotky přebírá pole prototypu (ušetří kopii)
  const remaining = new Map<number, number>();
  const countOcc = (n: SplitNode) => {
    for (const { unit } of n.units) remaining.set(unit, (remaining.get(unit) ?? 0) + 1);
    n.children.forEach(countOcc);
  };
  countOcc(plan.root);

  const parts: MeshPart[] = [];
  const topology: PartTopology[] = [];
  const convert = (n: SplitNode, depth: number): ModelNode => {
    const node: ModelNode = { name: n.name?.trim() || (depth === 0 ? "Model" : "Sestava"), parts: [], children: [] };
    for (const { unit, matrix } of n.units) {
      const res = results[unit];
      const left = (remaining.get(unit) ?? 1) - 1;
      remaining.set(unit, left);
      if (!res) continue;
      const last = left === 0;
      const ident = isIdentity(matrix);
      const rigid = ident || isRigid(matrix);
      res.parts.forEach((p, k) => {
        let positions = p.positions;
        let normals = p.normals ?? null;
        if (!ident) {
          positions = last ? p.positions : new Float32Array(p.positions.length);
          transformPoints(p.positions, matrix, positions);
          if (normals) {
            const out = last ? normals : new Float32Array(normals.length);
            transformNormals(normals, matrix, rigid, out);
            normals = out;
          }
        } else if (!last) {
          positions = p.positions.slice();
          normals = normals ? normals.slice() : null;
        }
        node.parts.push(parts.length);
        parts.push({ ...p, positions, normals });
        const topo = res.topology?.[k];
        if (!withTopology) topology.push(EMPTY_TOPO());
        else if (topo && rigid && lazyTopology) {
          const key = `${unit}:${k}`;
          let pi = protoIndex.get(key);
          if (pi === undefined) {
            pi = prototypes.length;
            protoIndex.set(key, pi);
            prototypes.push({ curves: topo.curves, faces: topo.faces });
          }
          let edgeSegments = topo.edgeSegments, corners = topo.corners;
          if (!ident) {
            edgeSegments = last ? topo.edgeSegments : new Float32Array(topo.edgeSegments.length);
            transformPoints(topo.edgeSegments, matrix, edgeSegments);
            corners = last ? topo.corners : new Float32Array(topo.corners.length);
            transformPoints(topo.corners, matrix, corners);
          } else if (!last) {
            edgeSegments = topo.edgeSegments.slice();
            corners = topo.corners.slice();
          }
          topology.push({ ...topo, edgeSegments, corners, curves: [], faces: [], lazy: { proto: pi, matrix: Array.from(matrix) } });
        } else if (topo && rigid) topology.push(ident ? (last ? topo : transformTopology(topo, matrix, false)) : transformTopology(topo, matrix, last));
        else topology.push(computeTopology({ positions, indices: p.indices, faces: p.faces }));
      });
    }
    node.children = n.children.map((c) => convert(c, depth + 1));
    return node;
  };
  let root = convert(plan.root, 0);
  // prázdné větve (díly se nenačetly) pryč
  const prune = (n: ModelNode): ModelNode | null => {
    const children = n.children.map(prune).filter((c): c is ModelNode => !!c);
    return n.parts.length || children.length ? { ...n, children } : null;
  };
  root = prune(root) ?? { name: "Model", parts: [], children: [] };
  while (root.parts.length === 0 && root.children.length === 1) root = root.children[0];
  return { model: { parts, root, format, warnings: plan.warnings.length ? [...plan.warnings] : undefined }, topology, prototypes: lazyTopology ? prototypes : undefined };
}
