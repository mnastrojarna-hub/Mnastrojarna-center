/**
 * PRC_TYPE_TESS_3D_Compressed („highly compressed" tessellace, ISO 14739-1 kap. 7.8.9).
 *
 * Síť je uložená jako průchod trojúhelníky: každý další trojúhelník se „vstupuje" přes hranu
 * už zpracovaného souseda a jeho nový vrchol je zakódován v lokální soustavě té hrany
 * (celá čísla × tolerance). Levý/pravý soused se určuje podle orientace normály, takže pro
 * správnou topologii je nutné dekódovat i normály (úhly + bitové příznaky).
 *
 * Výstupem je běžná MeshTess (vrcholy, trojúhelníky seskupené po plochách, normály v rozích).
 */

import { BitReader, PrcFormatError } from "./prc-bits";
import type { MeshTess } from "./prc-model";

const FLT_EPSILON = 1.1920928955078125e-7;
const HALF_PI = Math.PI / 2;
const QUARTER_PI = Math.PI / 4;

export interface CompressedResult {
  mesh: MeshTess | null;
  warning: string | null;
  /** Technický důvod selhání (pro ladění). */
  detail?: string;
}

interface CompressedData {
  hasFaces: boolean;
  tolerance: number;
  origin: [number, number, number];
  points: Int32Array;
  edgeStatus: Uint32Array;
  triFace: Int32Array;
  faceCount: number;
  isRef: Uint8Array;
  refs: Int32Array;
  mustRecalc: boolean;
  normalReversed: Uint8Array | null;
  creaseDeg: number;
  angleBits: number;
  normalBits: Uint8Array;
  angles: Uint32Array;
  facePlanar: Uint8Array;
  lineAttrs: Uint32Array;
  multipleLineAttr: Uint8Array | null;
}

/**
 * Přečte celou entitu (tím posune proud za ni) a pokusí se ji dekódovat na trojúhelníky.
 * Chyba čtení polí se propaguje (další tessellace by nešly najít); chyba rekonstrukce sítě
 * vrací `mesh: null` a varování.
 */
export function decodeCompressedTess(r: BitReader): CompressedResult {
  const d = readCompressed(r);
  try {
    return { mesh: rebuild(d), warning: null };
  } catch (e) {
    if (!(e instanceof PrcFormatError)) throw e;
    return { mesh: null, warning: "Část komprimované tessellace (PRC) se nepodařilo rozbalit.", detail: e.message };
  }
}

function readBits(r: BitReader, n: number): Uint8Array {
  if (n > r.remaining) throw new PrcFormatError("neplatná délka bitového pole");
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = r.readBit();
  return out;
}

function readCompressed(r: BitReader): CompressedData {
  r.readBool(); // is_calculated
  const hasFaces = r.readBool();
  const tolerance = r.readDouble();
  const origin: [number, number, number] = [r.readFloatAsBytes(), r.readFloatAsBytes(), r.readFloatAsBytes()];
  const points = r.readCompressedIntegerArray();
  const edgeStatus = r.readCharacterArray(2, true);
  const triFace = r.readCompressedIndiceArray(true);
  let faceCount = 0;
  for (let i = 0; i < triFace.length; i++) if (triFace[i] + 1 > faceCount) faceCount = triFace[i] + 1;
  if (faceCount > triFace.length + 1) throw new PrcFormatError("neplatné indexy ploch");
  const refSize = r.readUInt();
  const isRef = readBits(r, refSize);
  let nRef = 0;
  for (let i = 0; i < isRef.length; i++) nRef += isRef[i];
  const refs = r.readCompressedIndiceArray(false, nRef);
  const mustRecalc = r.readBool();
  let normalReversed: Uint8Array | null = null;
  let creaseDeg = 25;
  let angleBits = 0;
  let normalBits: Uint8Array = new Uint8Array(0);
  let angles: Uint32Array = new Uint32Array(0);
  let facePlanar: Uint8Array = new Uint8Array(0);
  if (mustRecalc) {
    normalReversed = readBits(r, triFace.length);
    creaseDeg = r.readDouble();
    r.readChar();
  } else {
    angleBits = r.readChar();
    const nb = r.readUInt();
    normalBits = readBits(r, nb);
    angles = r.readShortArray(angleBits);
    facePlanar = readBits(r, faceCount);
  }
  if (r.readBool()) {
    readBits(r, faceCount);
    r.readCharacterArray(8, true);
  }
  let multipleLineAttr: Uint8Array | null = null;
  if (r.readBool()) multipleLineAttr = readBits(r, faceCount);
  const lineAttrs = r.readShortArray(16);
  if (!r.readBool()) {
    // CompressedTextureParameter
    const words = r.readUInt();
    if (words * 32 > r.remaining) throw new PrcFormatError("neplatná data textury");
    r.skip(words * 32);
    r.readUInt();
    const nRefs = r.readUInt();
    if (nRefs > r.remaining) throw new PrcFormatError("neplatná data textury");
    for (let i = 0; i < nRefs; i++) {
      const bits = r.readUIntVar(5);
      r.readUIntVar(bits);
    }
    r.readDouble();
    const nParams = r.readUInt();
    if (nParams * 32 > r.remaining) throw new PrcFormatError("neplatná data textury");
    r.skip(nParams * 32);
    if (!r.readBool()) readBits(r, faceCount);
  }
  if (r.readBool()) r.readCharacterArray(8, true);
  return {
    // komprimované normály vždy pracují s plochami (pole triangle_face_array)
    hasFaces: hasFaces || !mustRecalc,
    tolerance,
    origin,
    points,
    edgeStatus,
    triFace,
    faceCount,
    isRef,
    refs,
    mustRecalc,
    normalReversed,
    creaseDeg,
    angleBits,
    normalBits,
    angles,
    facePlanar,
    lineAttrs,
    multipleLineAttr,
  };
}

// ---------------------------------------------------------------------------
// Vektorová aritmetika nad malými poli (bez alokací v hlavní smyčce)
// ---------------------------------------------------------------------------

type V3 = Float64Array;

function v3(): V3 {
  return new Float64Array(3);
}

/** Délka podle specifikace (součet čtverců zaokrouhlený na float). */
function len3(x: number, y: number, z: number): number {
  return Math.sqrt(Math.fround(x * x + y * y + z * z));
}

/** Normalizuje na místě; false = příliš krátký vektor. */
function normalize(v: V3): boolean {
  const l = len3(v[0], v[1], v[2]);
  if (!(l >= FLT_EPSILON)) return false;
  v[0] /= l;
  v[1] /= l;
  v[2] /= l;
  return true;
}

function cross(out: V3, a: V3, b: V3): void {
  const x = a[1] * b[2] - a[2] * b[1];
  const y = a[2] * b[0] - a[0] * b[2];
  const z = a[0] * b[1] - a[1] * b[0];
  out[0] = x;
  out[1] = y;
  out[2] = z;
}

function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** MakeOrthoRep ze specifikace: X → (Y, Z). */
function makeOrthoRep(x: V3, y: V3, z: V3): boolean {
  if (!normalize(x)) return false;
  y[0] = 0;
  y[1] = 1;
  y[2] = 0;
  cross(z, x, y);
  if (!normalize(z)) {
    y[0] = 1;
    y[1] = 0;
    y[2] = 0;
    cross(z, x, y);
    if (!normalize(z)) return false;
  }
  cross(y, z, x);
  return normalize(y);
}

function taylorCos(x: number): number {
  if (x > QUARTER_PI) return taylorSin(HALF_PI - x);
  const x2 = x * x;
  return 1 - x2 / 2 + (x2 * x2) / 24 - (x2 * x2 * x2) / 720;
}

function taylorSin(x: number): number {
  if (x > QUARTER_PI) return taylorCos(HALF_PI - x);
  const x2 = x * x;
  return x - (x * x2) / 6 + (x * x2 * x2) / 120 - (x * x2 * x2 * x2) / 5040;
}

/** |acos(â·b̂)| − π/2 v absolutní hodnotě (porovnávací úhel ze specifikace). */
function angleNormal(a: V3, b: V3, tmpA: V3, tmpB: V3): number {
  tmpA.set(a);
  tmpB.set(b);
  if (!normalize(tmpA) || !normalize(tmpB)) throw new PrcFormatError("degenerovaný trojúhelník");
  const d = dot(tmpA, tmpB);
  if (d > 1 - 1e-12 || d < -1 + 1e-12) return HALF_PI;
  return Math.abs(Math.abs(Math.acos(d)) - HALF_PI);
}

function bitsToStoreUInt(v: number): number {
  let nb = 1;
  let t = 1;
  while (v > t) {
    t *= 2;
    nb++;
  }
  return nb;
}


// ---------------------------------------------------------------------------
// Rekonstrukce sítě
// ---------------------------------------------------------------------------

const V_NONE = 0;
const V_SINGLE = 1;
const V_MULTI = 2;

/** Rozpor v rekonstrukci (špatně zvolená orientace dříve) — podnět k návratu v prohledávání. */
class Conflict extends Error {
  constructor() {
    super("rozpor v průchodu sítí");
  }
}

/** Jak určovat orientaci trojúhelníků (na ní závisí, která hrana je „levá" a „pravá"). */
const enum Orient {
  /** Podle normály dekódované v tomto trojúhelníku, jinak od souseda (výchozí). */
  Fresh,
  /** Vždy od souseda (konzistentně orientovaná síť). */
  Topo,
  /** Vždy podle normály v prvním rohu (doslovně podle specifikace). */
  Normals,
}

interface RebuildResult {
  mesh: MeshTess | null;
  /** Všechna pole spotřebována přesně — silný důkaz správného průchodu. */
  exact: boolean;
}

/**
 * Průchod sítí se ověřuje přesnou spotřebou všech polí (body, odkazy, příznaky, bity a úhly
 * normál). Orientace trojúhelníků v souborech z CAD (HOOPS/Tetra4D) se nejspolehlivěji
 * určí podle normály dekódované přímo v daném trojúhelníku; když tam žádná nová není
 * (všechny vrcholy už normálu mají), převezme se od souseda. Pro jistotu zkusíme i varianty.
 */
function rebuild(d: CompressedData): MeshTess | null {
  const numTri = d.triFace.length;
  if (numTri === 0 || d.points.length < 9) return null;
  const order = d.mustRecalc ? [Orient.Normals] : [Orient.Fresh, Orient.Topo, Orient.Normals];
  for (const o of order) {
    const res = rebuildOnce(d, o);
    if (res.mesh && res.exact) return res.mesh;
  }
  throw new PrcFormatError("komprimovanou síť se nepodařilo jednoznačně rekonstruovat");
}

// pracovní vektory (bez alokací v hlavní smyčce)
const p0 = v3(),
  p1 = v3(),
  p2 = v3();
const ta = v3(),
  tb = v3(),
  tc = v3(),
  td = v3(),
  te = v3();
const bx = v3(),
  by = v3(),
  bz = v3(),
  bo = v3();
const nn = v3(),
  s1 = v3(),
  s2 = v3(),
  m1 = v3(),
  m2 = v3();

function rebuildOnce(d: CompressedData, orient: Orient): RebuildResult {
  const numTri = d.triFace.length;
  const numPts = Math.floor(d.points.length / 3);
  if (d.edgeStatus.length < numTri - 1) return { mesh: null, exact: false };
  const tol = d.tolerance;
  const [ox, oy, oz] = d.origin;
  const P = d.points;
  const verts = new Float64Array(numPts * 3);
  const tris = new Uint32Array(numTri * 3);
  const withNormals = !d.mustRecalc;
  const triNormal = withNormals ? new Float32Array(numTri * 9) : null;
  const triStyle = new Int32Array(numTri).fill(-1);

  let normals = new Float64Array(withNormals ? Math.max(16, numTri * 3 * 3) : 0);
  let nNormals = 0;
  const vState = withNormals ? new Uint8Array(numPts) : null;
  const vSingle = withNormals ? new Int32Array(numPts) : null;
  const vMulti: Map<number, number[]> = new Map();
  const faceNormal = withNormals && d.hasFaces ? new Int32Array(d.faceCount).fill(-1) : null;
  let bitPos = 0;
  let anglePos = 0;
  const angleScale = d.angleBits > 0 ? HALF_PI / (2 ** d.angleBits - 1) : 0;

  const faceStyleSeen = d.hasFaces ? new Int32Array(d.faceCount).fill(-2) : null;
  let styleIdx = 0;

  let vCount = 0;
  let pCount = 0;
  let refFlagIdx = 3;
  let refIdx = 0;
  let k = 0;

  let c0 = 0,
    c1 = 0,
    c2 = 0;
  let reversed = false;
  let hint = -1;

  // zásobník hran: čtveřice (x, y, protilehlý vrchol, směr x→y v rodiči)
  let stack = new Int32Array(4 * 1024);
  let sp = 0;
  const treated = new Set<number>();
  const edgeKey = (a: number, b: number) => (a < b ? a * numPts + b : b * numPts + a);

  const conflict = (): never => {
    throw new Conflict();
  };
  const loadPoint = (out: V3, idx: number) => {
    if (idx < 0 || idx >= vCount) conflict();
    out[0] = verts[idx * 3];
    out[1] = verts[idx * 3 + 1];
    out[2] = verts[idx * 3 + 2];
  };
  const storeVertex = (x: number, y: number, z: number): number => {
    if (vCount >= numPts) conflict();
    verts[vCount * 3] = x;
    verts[vCount * 3 + 1] = y;
    verts[vCount * 3 + 2] = z;
    return vCount++;
  };
  const encoded = (i: number): number => {
    if (pCount + i >= numPts) conflict();
    return (pCount + i) * 3;
  };
  const nextRef = (): number => {
    if (refIdx >= d.refs.length) conflict();
    return d.refs[refIdx++];
  };
  const nextBit = (): number => {
    if (bitPos >= d.normalBits.length) conflict();
    return d.normalBits[bitPos++];
  };

  const chainStart = () => {
    if (refFlagIdx + 3 > d.isRef.length) conflict();
    const r0 = d.isRef[refFlagIdx],
      r1 = d.isRef[refFlagIdx + 1],
      r2 = d.isRef[refFlagIdx + 2];
    refFlagIdx += 3;
    const nr = r0 + r1 + r2;
    if (nr === 0) {
      const e0 = encoded(0),
        e1 = encoded(1),
        e2 = encoded(2);
      const x0 = P[e0] * tol + ox,
        y0 = P[e0 + 1] * tol + oy,
        z0 = P[e0 + 2] * tol + oz;
      const x1 = P[e1] * tol + x0,
        y1 = P[e1 + 1] * tol + y0,
        z1 = P[e1 + 2] * tol + z0;
      pCount += 3;
      c0 = storeVertex(x0, y0, z0);
      c1 = storeVertex(x1, y1, z1);
      c2 = storeVertex(P[e2] * tol + (x0 + x1) / 2, P[e2 + 1] * tol + (y0 + y1) / 2, P[e2 + 2] * tol + (z0 + z1) / 2);
    } else if (nr === 1) {
      const e0 = encoded(0),
        e1 = encoded(1);
      const ref = nextRef();
      loadPoint(ta, ref);
      if (r0) {
        const x1 = P[e0] * tol + ta[0],
          y1 = P[e0 + 1] * tol + ta[1],
          z1 = P[e0 + 2] * tol + ta[2];
        pCount += 2;
        c0 = ref;
        c1 = storeVertex(x1, y1, z1);
        c2 = storeVertex(P[e1] * tol + (ta[0] + x1) / 2, P[e1 + 1] * tol + (ta[1] + y1) / 2, P[e1 + 2] * tol + (ta[2] + z1) / 2);
      } else if (r1) {
        const x0 = P[e0] * tol + ox,
          y0 = P[e0 + 1] * tol + oy,
          z0 = P[e0 + 2] * tol + oz;
        pCount += 2;
        c0 = storeVertex(x0, y0, z0);
        c1 = ref;
        c2 = storeVertex(P[e1] * tol + (ta[0] + x0) / 2, P[e1 + 1] * tol + (ta[1] + y0) / 2, P[e1 + 2] * tol + (ta[2] + z0) / 2);
      } else {
        const x0 = P[e0] * tol + ox,
          y0 = P[e0 + 1] * tol + oy,
          z0 = P[e0 + 2] * tol + oz;
        pCount += 2;
        c0 = storeVertex(x0, y0, z0);
        c1 = storeVertex(P[e1] * tol + x0, P[e1 + 1] * tol + y0, P[e1 + 2] * tol + z0);
        c2 = ref;
      }
    } else if (nr === 2) {
      const e0 = encoded(0);
      const ra = nextRef();
      const rb = nextRef();
      loadPoint(ta, ra);
      loadPoint(tb, rb);
      if (!r0) {
        c0 = storeVertex(P[e0] * tol + ox, P[e0 + 1] * tol + oy, P[e0 + 2] * tol + oz);
        c1 = ra;
        c2 = rb;
      } else if (!r1) {
        c0 = ra;
        c1 = storeVertex(ta[0] + P[e0] * tol, ta[1] + P[e0 + 1] * tol, ta[2] + P[e0 + 2] * tol);
        c2 = rb;
      } else {
        c0 = ra;
        c1 = rb;
        c2 = storeVertex(
          P[e0] * tol + (ta[0] + tb[0]) / 2,
          P[e0 + 1] * tol + (ta[1] + tb[1]) / 2,
          P[e0 + 2] * tol + (ta[2] + tb[2]) / 2,
        );
      }
      pCount += 1;
    } else {
      c0 = nextRef();
      c1 = nextRef();
      c2 = nextRef();
      loadPoint(ta, c0);
      loadPoint(ta, c1);
      loadPoint(ta, c2);
    }
    if (c0 > c1) {
      const t = c0;
      c0 = c1;
      c1 = t;
    }
  };

  /** Lokální soustava hrany (x, y) s protilehlým vrcholem far — do bx, by, bz, bo. */
  const edgeBasis = (ix: number, iy: number, ifar: number) => {
    loadPoint(ta, ix);
    loadPoint(tb, iy);
    loadPoint(tc, ifar);
    bo[0] = (ta[0] + tb[0]) / 2;
    bo[1] = (ta[1] + tb[1]) / 2;
    bo[2] = (ta[2] + tb[2]) / 2;
    bx[0] = ta[0] - tb[0];
    bx[1] = ta[1] - tb[1];
    bx[2] = ta[2] - tb[2];
    if (!normalize(bx)) conflict();
    td[0] = tc[0] - bo[0];
    td[1] = tc[1] - bo[1];
    td[2] = tc[2] - bo[2];
    cross(bz, td, bx);
    let alt = !normalize(bz);
    if (!alt) {
      cross(by, bz, bx);
      alt = !normalize(by);
    }
    if (alt) {
      if (!makeOrthoRep(bx, by, bz)) conflict();
      cross(by, bz, bx);
      normalize(by);
    }
    te[0] = bo[0] - tc[0];
    te[1] = bo[1] - tc[1];
    te[2] = bo[2] - tc[2];
    if (dot(by, te) > 0) {
      for (let i = 0; i < 3; i++) {
        bz[i] = -bz[i];
        by[i] = -by[i];
      }
    }
  };

  const addNormal = (x: number, y: number, z: number): number => {
    if ((nNormals + 1) * 3 > normals.length) {
      const b = new Float64Array(normals.length * 2);
      b.set(normals);
      normals = b;
    }
    normals[nNormals * 3] = x;
    normals[nNormals * 3 + 1] = y;
    normals[nNormals * 3 + 2] = z;
    return nNormals++;
  };

  /** Dekóduje normálu z úhlů a příznaků v soustavě trojúhelníku (p0, p1, p2). */
  const decodeNormal = (rev: number, xr: number, yr: number): number => {
    if (anglePos + 2 > d.angles.length) conflict();
    const theta = d.angles[anglePos] * angleScale;
    const phi = d.angles[anglePos + 1] * angleScale;
    anglePos += 2;
    const V1 = ta,
      V2 = tb,
      V3 = tc;
    for (let i = 0; i < 3; i++) {
      V1[i] = p1[i] - p0[i];
      V2[i] = p2[i] - p0[i];
      V3[i] = p2[i] - p1[i];
    }
    if (!normalize(V1) || !normalize(V2) || !normalize(V3)) return addNormal(0, 0, 0);
    const th1 = angleNormal(V1, V2, s1, s2);
    for (let i = 0; i < 3; i++) m1[i] = -V1[i];
    const th2 = angleNormal(V3, m1, s1, s2);
    for (let i = 0; i < 3; i++) {
      m1[i] = -V2[i];
      m2[i] = -V3[i];
    }
    const th3 = angleNormal(m1, m2, s1, s2);
    const X = bx,
      Y = by,
      Z = bz;
    if (th1 < th2 && th1 < th3) {
      X.set(V1);
      cross(Z, V1, V2);
    } else if (th2 < th3) {
      X.set(V3);
      for (let i = 0; i < 3; i++) m1[i] = -V3[i];
      cross(Z, m1, V1);
    } else {
      for (let i = 0; i < 3; i++) X[i] = -V2[i];
      cross(Z, V2, V3);
    }
    if (!normalize(Z) && !makeOrthoRep(X, Y, Z)) return addNormal(0, 0, 0);
    if (rev) for (let i = 0; i < 3; i++) Z[i] = -Z[i];
    cross(Y, Z, X);
    normalize(Y);
    if (xr) for (let i = 0; i < 3; i++) X[i] = -X[i];
    if (yr) for (let i = 0; i < 3; i++) Y[i] = -Y[i];
    const ct = taylorCos(theta),
      st = taylorSin(theta),
      cp = taylorCos(phi),
      sph = taylorSin(phi);
    for (let i = 0; i < 3; i++) nn[i] = ct * cp * X[i] + st * cp * Y[i] + sph * Z[i];
    normalize(nn);
    return addNormal(nn[0], nn[1], nn[2]);
  };

  /** Normála pro vrchol v (podle stavu vrcholu a bitů normal_binary_data). */
  const vertexNormal = (v: number): number => {
    const state = vState![v];
    if (state === V_NONE) {
      const multi = nextBit();
      const rev = nextBit(),
        xr = nextBit(),
        yr = nextBit();
      const n = decodeNormal(rev, xr, yr);
      if (multi) {
        vState![v] = V_MULTI;
        vMulti.set(v, [n]);
      } else {
        vState![v] = V_SINGLE;
        vSingle![v] = n;
      }
      return n;
    }
    if (state === V_SINGLE) return vSingle![v];
    const list = vMulti.get(v)!;
    if (nextBit()) {
      const nb = bitsToStoreUInt(list.length - 1);
      let read = 0;
      for (let i = 0; i < nb; i++) read |= nextBit() << i;
      return list[read >= list.length ? 0 : list.length - 1 - read];
    }
    const rev = nextBit(),
      xr = nextBit(),
      yr = nextBit();
    const n = decodeNormal(rev, xr, yr);
    list.push(n);
    return n;
  };

  /** Normály trojúhelníku k + jeho orientace. */
  const handleNormals = () => {
    const nStart = nNormals;
    loadPoint(p0, c0);
    loadPoint(p1, c1);
    loadPoint(p2, c2);
    // výška vrcholu c2 nad hranou (c0, c1) a „geometrická" normála (p2 − střed) × (p1 − p0)
    for (let i = 0; i < 3; i++) {
      ta[i] = p2[i] - (p0[i] + p1[i]) / 2;
      tb[i] = p1[i] - p0[i];
    }
    cross(td, ta, tb);
    if (!withNormals) {
      reversed = d.normalReversed![k] === 1;
      return;
    }
    let n0: number, n1: number, n2: number;
    const face = d.hasFaces ? d.triFace[k] : -1;
    if (face >= 0 && d.facePlanar[face]) {
      let f = faceNormal![face];
      if (f < 0) {
        f = vertexNormal(c0);
        faceNormal![face] = f;
      }
      n0 = n1 = n2 = f;
    } else {
      n0 = vertexNormal(c0);
      n1 = vertexNormal(c1);
      n2 = vertexNormal(c2);
    }
    // Orientace: podle normály dekódované přímo v tomto trojúhelníku (spolehlivé); normála
    // převzatá z dřívějška (stejný vrchol jinde) orientaci neurčuje — pak od souseda.
    let fresh = -1;
    if (n0 >= nStart) fresh = n0;
    else if (n1 >= nStart) fresh = n1;
    else if (n2 >= nStart) fresh = n2;
    const nRef = fresh >= 0 ? fresh : n0;
    const dd = td[0] * normals[nRef * 3] + td[1] * normals[nRef * 3 + 1] + td[2] * normals[nRef * 3 + 2];
    let rev = dd < 0;
    if (hint >= 0 && (orient === Orient.Topo || (orient === Orient.Fresh && fresh < 0))) rev = hint === 1;
    reversed = rev;
    const o = k * 9;
    const nrm = triNormal!;
    const put = (slot: number, n: number) => {
      nrm[o + slot * 3] = normals[n * 3];
      nrm[o + slot * 3 + 1] = normals[n * 3 + 1];
      nrm[o + slot * 3 + 2] = normals[n * 3 + 2];
    };
    put(0, n0);
    put(1, reversed ? n1 : n2);
    put(2, reversed ? n2 : n1);
  };

  const storeTriangle = () => {
    if (c0 === c1 || c1 === c2 || c0 === c2) conflict();
    tris[k * 3] = c0;
    tris[k * 3 + 1] = reversed ? c1 : c2;
    tris[k * 3 + 2] = reversed ? c2 : c1;
    if (faceStyleSeen) {
      const f = d.triFace[k];
      const multi = d.multipleLineAttr ? d.multipleLineAttr[f] === 1 : false;
      const la = d.lineAttrs;
      if (multi) {
        if (styleIdx < la.length) triStyle[k] = la[styleIdx] - 1;
        styleIdx++;
      } else if (la.length === 1) {
        triStyle[k] = la[0] - 1;
      } else if (la.length > 1) {
        if (faceStyleSeen[f] === -2) {
          faceStyleSeen[f] = styleIdx < la.length ? la[styleIdx] - 1 : -1;
          styleIdx++;
        }
        triStyle[k] = faceStyleSeen[f];
      }
    }
  };

  const push = (x: number, y: number, far: number, dir: number) => {
    if (sp + 4 > stack.length) {
      const b = new Int32Array(stack.length * 2);
      b.set(stack);
      stack = b;
    }
    stack[sp++] = x;
    stack[sp++] = y;
    stack[sp++] = far;
    stack[sp++] = dir;
  };
  /** Obsahuje uložené pořadí aktuálního trojúhelníku orientovanou hranu a→b? */
  const hasDirected = (a: number, b: number): number => {
    const w0 = c0,
      w1 = reversed ? c1 : c2,
      w2 = reversed ? c2 : c1;
    return (w0 === a && w1 === b) || (w1 === a && w2 === b) || (w2 === a && w0 === b) ? 1 : 0;
  };

  try {
    // první trojúhelník
    {
      const x0 = P[0] * tol + ox,
        y0 = P[1] * tol + oy,
        z0 = P[2] * tol + oz;
      const x1 = P[3] * tol + x0,
        y1 = P[4] * tol + y0,
        z1 = P[5] * tol + z0;
      storeVertex(x0, y0, z0);
      storeVertex(x1, y1, z1);
      storeVertex(P[6] * tol + (x0 + x1) / 2, P[7] * tol + (y0 + y1) / 2, P[8] * tol + (z0 + z1) / 2);
      pCount = 3;
      c0 = 0;
      c1 = 1;
      c2 = 2;
      hint = -1;
      handleNormals();
      storeTriangle();
    }

    for (k = 1; k < numTri; k++) {
      // hrany předchozího trojúhelníku: levá (c0, c2 | c1), pravá (c1, c2 | c0); obráceně, je-li reversed
      let lx = c0,
        ly = c2,
        lf = c1;
      let rx = c1,
        ry = c2,
        rf = c0;
      if (reversed) {
        lx = c1;
        lf = c0;
        rx = c0;
        rf = c1;
      }
      if (lx > ly) {
        const t = lx;
        lx = ly;
        ly = t;
      }
      if (rx > ry) {
        const t = rx;
        rx = ry;
        ry = t;
      }
      const status = d.edgeStatus[k - 1];
      const rightOpen = (status & 1) !== 0;
      const leftOpen = (status & 2) !== 0;
      if (!leftOpen || !rightOpen) {
        if (!leftOpen) treated.add(edgeKey(lx, ly));
        if (!rightOpen) treated.add(edgeKey(rx, ry));
      }
      if (rightOpen) push(rx, ry, rf, hasDirected(rx, ry));
      if (leftOpen) push(lx, ly, lf, hasDirected(lx, ly));

      let fresh = sp === 0;
      let ex = 0,
        ey = 0,
        ef = 0,
        edir = 0;
      if (!fresh) {
        sp -= 4;
        ex = stack[sp];
        ey = stack[sp + 1];
        ef = stack[sp + 2];
        edir = stack[sp + 3];
        if (!leftOpen && !rightOpen) {
          while (treated.has(edgeKey(ex, ey))) {
            if (sp === 0) {
              fresh = true;
              break;
            }
            sp -= 4;
            ex = stack[sp];
            ey = stack[sp + 1];
            ef = stack[sp + 2];
            edir = stack[sp + 3];
          }
        }
      }
      if (fresh) {
        hint = -1;
        chainStart();
      } else {
        // orientace podle souseda: rodič má hranu x→y ⇒ nový trojúhelník musí mít y→x
        hint = edir === 1 ? 0 : 1;
        edgeBasis(ex, ey, ef);
        if (refFlagIdx >= d.isRef.length) conflict();
        let nv: number;
        if (d.isRef[refFlagIdx]) {
          nv = nextRef();
          if (nv === ex || nv === ey) conflict();
          loadPoint(ta, nv);
        } else {
          const e = encoded(0);
          const a = P[e] * tol,
            b = P[e + 1] * tol,
            c = P[e + 2] * tol;
          nv = storeVertex(
            bo[0] + a * bx[0] + b * by[0] + c * bz[0],
            bo[1] + a * bx[1] + b * by[1] + c * bz[1],
            bo[2] + a * bx[2] + b * by[2] + c * bz[2],
          );
          pCount++;
        }
        refFlagIdx++;
        c0 = ex;
        c1 = ey;
        c2 = nv;
      }
      handleNormals();
      storeTriangle();
    }
  } catch (e) {
    if (e instanceof Conflict) return { mesh: null, exact: false };
    throw e;
  }

  const exact =
    pCount === numPts &&
    refIdx === d.refs.length &&
    refFlagIdx === d.isRef.length &&
    (!withNormals || (bitPos === d.normalBits.length && anglePos === d.angles.length));
  if (!exact) return { mesh: null, exact: false };

  // seskupení trojúhelníků po plochách (stabilně, v pořadí průchodu)
  const faceCount = d.hasFaces ? Math.max(1, d.faceCount) : 1;
  const counts = new Uint32Array(faceCount + 1);
  for (let t = 0; t < numTri; t++) counts[(d.hasFaces ? d.triFace[t] : 0) + 1]++;
  for (let f = 0; f < faceCount; f++) counts[f + 1] += counts[f];
  const faceStart = counts.slice();
  const fill = counts.slice(0, faceCount);
  const tri = new Uint32Array(numTri * 3);
  const cn = triNormal ? new Float32Array(numTri * 9) : null;
  const faceStyle = new Int32Array(faceCount).fill(-1);
  for (let t = 0; t < numTri; t++) {
    const f = d.hasFaces ? d.triFace[t] : 0;
    const dst = fill[f]++;
    if (dst === faceStart[f]) faceStyle[f] = triStyle[t];
    tri[dst * 3] = tris[t * 3];
    tri[dst * 3 + 1] = tris[t * 3 + 1];
    tri[dst * 3 + 2] = tris[t * 3 + 2];
    if (cn && triNormal) cn.set(triNormal.subarray(t * 9, t * 9 + 9), dst * 9);
  }
  const mesh: MeshTess = {
    kind: "mesh",
    pos: verts,
    tri,
    cornerNormals: cn,
    faceStart,
    faceStyle,
    creaseAngle: ((d.creaseDeg > 0 && d.creaseDeg <= 180 ? d.creaseDeg : 25) * Math.PI) / 180,
  };
  return { mesh, exact: true };
}
