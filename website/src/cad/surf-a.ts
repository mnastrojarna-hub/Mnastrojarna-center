/**
 * Plochy třídy A (7. vlna, balík „surfaces“) – jádro nad OpenCascade:
 *  - analýza návaznosti hran (G0 mezera, G1 úhel normál, G2 rozdíl normálových křivostí napříč hranou) a hřebeny křivosti,
 *  - N-stranná výplň s návazností G0/G1/G2 na sousední plochy (BRepOffsetAPI_MakeFilling – přesný operátor OCCT),
 *  - přechodová plocha mezi dvěma hranami ploch s G1/G2 a napětím (Hermitův pás: kubický / kvintický ve směru napříč,
 *    B-spline interpolace podél hran – návaznost je přesná ve vzorkovacích bodech, mezi nimi přibližná; měří se analýzou),
 *  - prodloužení plochy přes hranu s G1 (tečně, přímkově) nebo G2 (pokračuje křivost),
 *  - úpravy řídicích bodů (CV) B-spline plochy: seznam, posun bodu / řady, zjemnění sítě (přesné vložení uzlů a zvýšení stupně).
 * Běží ve workeru i v Node (testy) – žádné DOM API.
 */
import * as r from "replicad";
import { tr } from "./i18n";
import { curveData, faceOf, interpCurve, normalCurvature, projectOnSurface, surfaceFromRows, surfD2, surfNormal, tensorInterp, V3, type SurfD2 } from "./surf-geom";
import type { Vec3 } from "./types";

type OC = any;
const oc = (): OC => r.getOC() as OC;
const xyz = (p: { X(): number; Y(): number; Z(): number }): Vec3 => [p.X(), p.Y(), p.Z()];
const DEG = 180 / Math.PI;

// ───────────────────────── topologie ─────────────────────────

/** prostřední bod hrany */
const midOf = (e: r.Edge): Vec3 => {
  const p = e.pointAt(0.5);
  return [p.x, p.y, p.z];
};
const endsOf = (e: r.Edge): [Vec3, Vec3] => {
  const a = e.startPoint;
  const b = e.endPoint;
  return [
    [a.x, a.y, a.z],
    [b.x, b.y, b.z],
  ];
};
function inBox(f: r.Face, p: Vec3, tol: number) {
  const [[x0, y0, z0], [x1, y1, z1]] = f.boundingBox.bounds;
  return p[0] >= x0 - tol && p[0] <= x1 + tol && p[1] >= y0 - tol && p[1] <= y1 + tol && p[2] >= z0 - tol && p[2] <= z1 + tol;
}

/**
 * Plochy u hrany: nejdřív topologicky (hrana patří ploše), chybí-li druhá, pak geometricky – plocha s hranou ve stejné
 * poloze (volné plochy, které nejsou sešité). `shared` = obě plochy sdílejí hranu topologicky.
 */
export function facesAtEdge(body: r.AnyShape, edgeIdx: number): { edge: r.Edge; faces: r.Face[]; faceIdx: number[]; shared: boolean } {
  const edges = body.edges;
  const edge = edges[edgeIdx];
  if (!edge) throw new Error(tr("Hrana E{0} v modelu není.", edgeIdx + 1));
  const faces = body.faces;
  const m = midOf(edge);
  const len = Math.max(1e-6, edge.length);
  const tol = 1e-3 + len * 1e-4;
  const out: number[] = [];
  faces.forEach((f, i) => {
    if (inBox(f, m, tol) && f.edges.some((e) => e.isSame(edge))) out.push(i);
  });
  const shared = out.length >= 2;
  if (out.length < 2) {
    const [a, b] = endsOf(edge);
    faces.forEach((f, i) => {
      if (out.length >= 2 || out.includes(i) || !inBox(f, m, tol * 10)) return;
      const hit = f.edges.some((e) => {
        if (e.isSame(edge)) return false;
        if (Math.abs(e.length - len) > tol * 10) return false;
        if (V3.dist(midOf(e), m) > tol * 10) return false;
        const [c, d] = endsOf(e);
        return (V3.dist(a, c) < tol * 10 && V3.dist(b, d) < tol * 10) || (V3.dist(a, d) < tol * 10 && V3.dist(b, c) < tol * 10);
      });
      if (hit) out.push(i);
    });
  }
  return { edge, faces: out.map((i) => faces[i]), faceIdx: out, shared };
}

// ───────────────────────── vzorkování hran ─────────────────────────

export type CurvePt = { p: Vec3; t: Vec3; d1: Vec3; d2: Vec3; u: number };
/** Body hrany rovnoměrně po délce (n ≥ 2) s derivacemi (BRepAdaptor_Curve). `reverse` = od konce. */
export function sampleEdge(edge: r.Edge, n: number, reverse = false): CurvePt[] {
  const o = oc();
  const ad = new o.BRepAdaptor_Curve(edge.wrapped);
  const P = new o.gp_Pnt();
  const V1 = new o.gp_Vec();
  const V2 = new o.gp_Vec();
  try {
    const u0 = ad.FirstParameter();
    const u1 = ad.LastParameter();
    const at = (u: number): CurvePt => {
      ad.D2(u, P, V1, V2);
      const d1 = xyz(V1);
      return { p: xyz(P), d1, d2: xyz(V2), t: V3.norm(d1), u };
    };
    // délka po parametru (hustě), pak rovnoměrně po délce
    const M = Math.max(64, n * 8);
    const us: number[] = [];
    const cum = [0];
    let prev: Vec3 | null = null;
    for (let i = 0; i <= M; i++) {
      const u = u0 + ((u1 - u0) * i) / M;
      ad.D0(u, P);
      const p = xyz(P);
      us.push(u);
      if (prev) cum.push(cum[cum.length - 1] + V3.dist(p, prev));
      prev = p;
    }
    const L = cum[M];
    const out: CurvePt[] = [];
    for (let k = 0; k < n; k++) {
      const target = (L * k) / (n - 1);
      let i = 0;
      while (i < M - 1 && cum[i + 1] < target) i++;
      const seg = cum[i + 1] - cum[i];
      const f = seg > 1e-12 ? Math.max(0, Math.min(1, (target - cum[i]) / seg)) : 0;
      out.push(at(us[i] + (us[i + 1] - us[i]) * f));
    }
    if (reverse) return out.reverse().map((c) => ({ ...c, t: V3.mul(c.t, -1), d1: V3.mul(c.d1, -1) }));
    return out;
  } finally {
    ad.delete();
    P.delete();
    V1.delete();
    V2.delete();
  }
}

// ───────────────────────── místní rámec plochy u hrany ─────────────────────────

export type FaceFrame = { p: Vec3; n: Vec3; w: Vec3; k: number; d: SurfD2; uv: [number, number] };
/**
 * Rámec plochy v bodě hrany: normála `n` (podle orientace stěny), `w` = jednotkový směr kolmo na hranu v tečné rovině
 * VEN z plochy (přes hranu), `k` = normálová křivost plochy ve směru `w` (vůči `n`, 1/mm).
 */
export function faceFrameAt(face: r.Face, p: Vec3, tangent: Vec3, outward?: boolean[]): FaceFrame {
  const surf = oc().BRep_Tool.Surface(face.wrapped);
  const b = face.UVBounds;
  const pr = projectOnSurface(surf, p, { u0: b.uMin, u1: b.uMax, v0: b.vMin, v1: b.vMax }) ?? projectOnSurface(surf, p);
  if (!pr) throw new Error(tr("Bod hrany se nepodařilo promítnout na plochu."));
  const d = surfD2(surf, pr.u, pr.v);
  let n = surfNormal(d);
  if (face.orientation === "backward") n = V3.mul(n, -1);
  let w = V3.norm(V3.cross(n, tangent));
  // ven z plochy: bod kousek po +w (na ploše) musí být dál od ořezané stěny než bod po −w
  const out = outward?.[0];
  if (out === undefined) {
    const eps = Math.max(1e-3, edgeScale(face) * 0.05);
    const probe = (s: number) => {
      const q = V3.add(p, V3.mul(w, s * eps));
      const qq = projectOnSurface(surf, q)?.q ?? q;
      return r.measureDistanceBetween(r.makeVertex(qq), face);
    };
    const plus = probe(1);
    const minus = probe(-1);
    if (plus < minus) w = V3.mul(w, -1);
    if (outward) outward[0] = plus >= minus;
  } else if (!out) w = V3.mul(w, -1);
  return { p: d.p, n, w, k: normalCurvature(d, w, n), d, uv: [pr.u, pr.v] };
}
const edgeScale = (f: r.Face) => {
  const [[x0, y0, z0], [x1, y1, z1]] = f.boundingBox.bounds;
  return Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 20;
};

// ───────────────────────── (d) analýza návaznosti ─────────────────────────

export type ContClass = "G2" | "G1" | "G0" | "gap" | "free";
export type EdgeContinuity = {
  /** index hrany (0 = E1) */
  edge: number;
  /** indexy sousedních ploch (0 = F1) */
  faces: number[];
  /** hrana sdílená topologicky (sešité plochy) */
  shared: boolean;
  /** největší mezera mezi plochami (mm) */
  g0: number;
  /** největší úhel normál napříč hranou (°) */
  g1: number;
  /** největší rozdíl normálových křivostí napříč hranou (1/mm) */
  g2: number;
  /** křivosti napříč hranou na obou plochách (v bodě největšího rozdílu) */
  kA: number;
  kB: number;
  cls: ContClass;
};
export const CONT_TOL = { g0: 0.01, g1: 0.1, g2Rel: 0.05, g2Abs: 1e-4 };

/** Návaznost ploch podél jedné hrany (n vzorků mimo konce hrany). */
export function edgeContinuity(body: r.AnyShape, edgeIdx: number, n = 11): EdgeContinuity {
  const { edge, faces, faceIdx, shared } = facesAtEdge(body, edgeIdx);
  if (faces.length < 2) return { edge: edgeIdx, faces: faceIdx, shared, g0: 0, g1: 0, g2: 0, kA: 0, kB: 0, cls: "free" };
  const [A, B] = faces;
  const sA = oc().BRep_Tool.Surface(A.wrapped);
  const sB = oc().BRep_Tool.Surface(B.wrapped);
  const bA = A.UVBounds;
  const bB = B.UVBounds;
  const pts = sampleEdge(edge, n + 2).slice(1, -1);
  let g0 = 0;
  let g1 = 0;
  let g2 = 0;
  let kA = 0;
  let kB = 0;
  for (const c of pts) {
    const pa = projectOnSurface(sA, c.p, { u0: bA.uMin, u1: bA.uMax, v0: bA.vMin, v1: bA.vMax }) ?? projectOnSurface(sA, c.p);
    const pb = projectOnSurface(sB, c.p, { u0: bB.uMin, u1: bB.uMax, v0: bB.vMin, v1: bB.vMax }) ?? projectOnSurface(sB, c.p);
    if (!pa || !pb) continue;
    g0 = Math.max(g0, V3.dist(pa.q, pb.q), pa.d, pb.d);
    const da = surfD2(sA, pa.u, pa.v);
    const db = surfD2(sB, pb.u, pb.v);
    let na = surfNormal(da);
    let nb = surfNormal(db);
    if (A.orientation === "backward") na = V3.mul(na, -1);
    if (B.orientation === "backward") nb = V3.mul(nb, -1);
    let ang = V3.angle(na, nb);
    // volné (nesešité) plochy mohou mít normálu opačně – rozhoduje tečná rovina, ne orientace
    if (!shared && ang > 90) {
      nb = V3.mul(nb, -1);
      ang = 180 - ang;
    }
    g1 = Math.max(g1, ang);
    // křivost napříč hranou na obou plochách vůči stejně orientované normále
    const w = V3.norm(V3.cross(na, c.t));
    const ka = normalCurvature(da, w, na);
    const kb = normalCurvature(db, w, V3.dot(na, nb) >= 0 ? nb : V3.mul(nb, -1));
    if (Math.abs(ka - kb) >= g2) {
      g2 = Math.abs(ka - kb);
      kA = ka;
      kB = kb;
    }
  }
  const cls: ContClass = g0 > CONT_TOL.g0 ? "gap" : g1 > CONT_TOL.g1 ? "G0" : g2 > Math.max(CONT_TOL.g2Abs, CONT_TOL.g2Rel * Math.max(Math.abs(kA), Math.abs(kB))) ? "G1" : "G2";
  return { edge: edgeIdx, faces: faceIdx, shared, g0, g1, g2, kA, kB, cls };
}

/** Návaznost vybraných hran (nic = všechny hrany mezi plochami; nejvýš `limit`). */
export function continuityReport(body: r.AnyShape, edges?: number[], limit = 400): EdgeContinuity[] {
  const list = edges?.length ? edges : body.edges.map((_, i) => i);
  return list.slice(0, limit).map((i) => edgeContinuity(body, i));
}

/** barvy tříd návaznosti (hrany v 3D okně) */
export const CONT_COLOR: Record<ContClass, string> = { G2: "#16a34a", G1: "#eab308", G0: "#ea580c", gap: "#dc2626", free: "#7c3aed" };

// ───────────────────────── hřebeny křivosti ─────────────────────────

export type Comb = { edge: number; teeth: [Vec3, Vec3][]; envelope: Vec3[]; kMin: number; kMax: number };
/** Hřebeny křivosti hran: zub = −normála křivky × křivost × měřítko (ven ze středu křivosti). `scale` 0 = automaticky. */
export function curvatureCombs(body: r.AnyShape, edges: number[], n = 48, scale = 0): Comb[] {
  const all = body.edges;
  const data = edges.map((i) => {
    const e = all[i];
    if (!e) throw new Error(tr("Hrana E{0} v modelu není.", i + 1));
    return { i, pts: sampleEdge(e, n) };
  });
  const kOf = (c: CurvePt) => {
    const cr = V3.cross(c.d1, c.d2);
    const l = V3.len(c.d1);
    return l > 1e-12 ? V3.len(cr) / (l * l * l) : 0;
  };
  let kMax = 0;
  let size = 0;
  for (const d of data) {
    for (const c of d.pts) kMax = Math.max(kMax, kOf(c));
    size = Math.max(size, V3.dist(d.pts[0].p, d.pts[d.pts.length - 1].p), ...d.pts.map((c) => V3.dist(c.p, d.pts[0].p)));
  }
  const s = scale > 0 ? scale : kMax > 1e-12 ? (0.2 * (size || 1)) / kMax : 0;
  return data.map(({ i, pts }) => {
    const teeth: [Vec3, Vec3][] = [];
    let lo = Infinity;
    let hi = 0;
    for (const c of pts) {
      const k = kOf(c);
      lo = Math.min(lo, k);
      hi = Math.max(hi, k);
      const cr = V3.cross(c.d1, c.d2);
      const nrm = V3.len(cr) > 1e-12 ? V3.norm(V3.cross(cr, c.d1)) : ([0, 0, 0] as Vec3); // ke středu křivosti
      teeth.push([c.p, V3.sub(c.p, V3.mul(nrm, k * s))]);
    }
    return { edge: i, teeth, envelope: teeth.map((t) => t[1]), kMin: Number.isFinite(lo) ? lo : 0, kMax: hi };
  });
}

// ───────────────────────── (a) N-stranná výplň ─────────────────────────

export type FillResult = { face: r.Face; g0: number; g1: number; g2: number; supported: number };
/**
 * Výplň uzavřené smyčky hran plochou (BRepOffsetAPI_MakeFilling). `cont` 0/1/2 = G0/G1/G2 k ploše, které hrana patří
 * (hrany bez sousední plochy jsou jen G0). Vrací plochu a chyby, které hlásí jádro (G1 ve °).
 */
export function nSidedFill(body: r.AnyShape, edgeIdx: number[], cont: 0 | 1 | 2): FillResult {
  const o = oc();
  if (edgeIdx.length < 1) throw new Error(tr("Vyberte hrany tvořící uzavřenou smyčku (otvor v ploše)."));
  // podpora = plocha, které hrana topologicky patří (výplň potřebuje křivku hrany na ploše); hrany bez ní jsou jen G0
  const cons = edgeIdx.map((i) => {
    const { edge, faces } = facesAtEdge(body, i);
    return { edge, own: faces.find((f) => f.edges.some((e) => e.isSame(edge))) };
  });
  const mk = new o.BRepOffsetAPI_MakeFilling(3, 30, 3, false, 1e-5, 1e-4, 1e-3, 0.05, 8, 9);
  const order = cont === 2 ? o.GeomAbs_Shape.GeomAbs_G2 : cont === 1 ? o.GeomAbs_Shape.GeomAbs_G1 : o.GeomAbs_Shape.GeomAbs_C0;
  let supported = 0;
  let face: r.AnyShape | null = null;
  try {
    for (const c of cons) {
      if (cont > 0 && c.own) {
        mk.Add(c.edge.wrapped, c.own.wrapped, order, true);
        supported++;
      } else mk.Add(c.edge.wrapped, o.GeomAbs_Shape.GeomAbs_C0, true);
    }
    mk.Build(new o.Message_ProgressRange());
    if (mk.IsDone()) face = r.cast(mk.Shape());
    if (!(face instanceof r.Face)) throw new Error(tr("Výplň se nepodařilo vytvořit – hrany musí tvořit jednu uzavřenou smyčku (otvor)."));
    return { face, g0: mk.G0Error(), g1: supported ? mk.G1Error() * DEG : 0, g2: cont === 2 && supported ? mk.G2Error() : 0, supported };
  } catch (e) {
    if (e instanceof Error) throw e;
    throw new Error(tr("Výplň se nepodařilo vytvořit – hrany musí tvořit jednu uzavřenou smyčku (otvor)."));
  } finally {
    mk.delete();
  }
}

// ───────────────────────── (b) přechodová plocha ─────────────────────────

export type BlendOpts = { contA: 1 | 2; contB: 1 | 2; tensionA: number; tensionB: number; flip?: boolean; samples?: number };
/** okrajová data jedné strany přechodu: body hrany a rámce plochy */
function sideData(body: r.AnyShape, edgeIdx: number, n: number, reverse: boolean) {
  const { edge, faces } = facesAtEdge(body, edgeIdx);
  const face = faces.find((f) => f.edges.some((e) => e.isSame(edge))) ?? faces[0];
  if (!face) throw new Error(tr("Hrana E{0} nepatří žádné ploše.", edgeIdx + 1));
  const pts = sampleEdge(edge, n, reverse);
  const outward: boolean[] = [];
  const frames = pts.map((c) => faceFrameAt(face, c.p, c.t, outward));
  return { pts, frames };
}

/**
 * Přechodová plocha mezi dvěma hranami (každá na své ploše): Hermitův pás napříč – pro G1 kubický (tečna = napětí × vzdálenost
 * × směr ven z plochy), pro G2 kvintický (navíc druhá derivace = normálová křivost plochy ve směru napříč × |tečna|²·n).
 * Podél hran se řady pólů interpolují B-spline křivkami se stejnými uzly (přesně ve vzorkovacích bodech).
 */
export function blendSurface(body: r.AnyShape, edgeA: number, edgeB: number, o: BlendOpts): r.Face {
  if (edgeA === edgeB) throw new Error(tr("Přechod potřebuje dvě různé hrany."));
  const n = Math.max(8, Math.min(80, o.samples ?? 33));
  const a = sideData(body, edgeA, n, false);
  // směr druhé hrany: aby si začátky odpovídaly (nejkratší „křížení“), nebo obráceně podle volby
  const eb = body.edges[edgeB];
  if (!eb) throw new Error(tr("Hrana E{0} v modelu není.", edgeB + 1));
  const [b0, b1] = endsOf(eb);
  const a0 = a.pts[0].p;
  const a1 = a.pts[n - 1].p;
  let rev = V3.dist(a0, b0) + V3.dist(a1, b1) > V3.dist(a0, b1) + V3.dist(a1, b0);
  if (o.flip) rev = !rev;
  const b = sideData(body, edgeB, n, rev);
  const deg = o.contA === 2 || o.contB === 2 ? 5 : 3;
  const rows: Vec3[][] = Array.from({ length: deg + 1 }, () => []);
  for (let k = 0; k < n; k++) {
    const fa = a.frames[k];
    const fb = b.frames[k];
    const P0 = a.pts[k].p;
    const P1 = b.pts[k].p;
    const L = Math.max(1e-6, V3.dist(P0, P1));
    const T0 = V3.mul(fa.w, o.tensionA * L); // P'(0): ven z plochy A
    const T1 = V3.mul(fb.w, -o.tensionB * L); // P'(1): dovnitř plochy B
    if (deg === 3) {
      rows[0].push(P0);
      rows[1].push(V3.add(P0, V3.mul(T0, 1 / 3)));
      rows[2].push(V3.sub(P1, V3.mul(T1, 1 / 3)));
      rows[3].push(P1);
    } else {
      const A0 = o.contA === 2 ? V3.mul(fa.n, fa.k * V3.dot(T0, T0)) : ([0, 0, 0] as Vec3);
      const A1 = o.contB === 2 ? V3.mul(fb.n, fb.k * V3.dot(T1, T1)) : ([0, 0, 0] as Vec3);
      const B1 = V3.add(P0, V3.mul(T0, 1 / 5));
      const B4 = V3.sub(P1, V3.mul(T1, 1 / 5));
      rows[0].push(P0);
      rows[1].push(B1);
      rows[2].push(V3.add(V3.sub(V3.mul(B1, 2), P0), V3.mul(A0, 1 / 20)));
      rows[3].push(V3.add(V3.sub(V3.mul(B4, 2), P1), V3.mul(A1, 1 / 20)));
      rows[4].push(B4);
      rows[5].push(P1);
    }
  }
  // parametr podél hran: délky tětiv střední řady
  const mid = rows[Math.floor(deg / 2)].map((p, k) => V3.mul(V3.add(p, rows[Math.ceil(deg / 2)][k]), 0.5));
  const t = [0];
  for (let k = 1; k < n; k++) t.push(t[k - 1] + Math.max(1e-9, V3.dist(mid[k], mid[k - 1])));
  const curves = rows.map((row) => curveData(interpCurve(row, t)));
  return faceOf(surfaceFromRows(curves));
}

// ───────────────────────── (c) prodloužení plochy přes hranu ─────────────────────────

/**
 * Pás prodloužení plochy přes její hranu o délku `length`: G1 = přímkově ve směru tečné roviny (tečně),
 * G2 = kvadraticky – pokračuje normálová křivost plochy napříč hranou.
 */
export function extensionStrip(body: r.AnyShape, edgeIdx: number, length: number, cont: 1 | 2, samples = 33): { strip: r.Face; face: r.Face; faceIdx: number } {
  if (!(length > 0)) throw new Error(tr("Délka prodloužení musí být kladná."));
  const { edge, faces, faceIdx } = facesAtEdge(body, edgeIdx);
  const k = faces.findIndex((f) => f.edges.some((e) => e.isSame(edge)));
  if (k < 0) throw new Error(tr("Hrana E{0} nepatří žádné ploše.", edgeIdx + 1));
  const face = faces[k];
  const n = Math.max(8, Math.min(80, samples));
  const pts = sampleEdge(edge, n);
  const outward: boolean[] = [];
  const frames = pts.map((c) => faceFrameAt(face, c.p, c.t, outward));
  const deg = cont === 2 ? 2 : 1;
  const rows: Vec3[][] = Array.from({ length: deg + 1 }, () => []);
  frames.forEach((fr, i) => {
    const P0 = pts[i].p;
    const T = V3.mul(fr.w, length);
    if (deg === 1) {
      rows[0].push(P0);
      rows[1].push(V3.add(P0, T));
    } else {
      const B1 = V3.add(P0, V3.mul(T, 0.5));
      rows[0].push(P0);
      rows[1].push(B1);
      rows[2].push(V3.add(V3.sub(V3.mul(B1, 2), P0), V3.mul(fr.n, (fr.k * length * length) / 2)));
    }
  });
  const t = [0];
  for (let i = 1; i < n; i++) t.push(t[i - 1] + Math.max(1e-9, V3.dist(pts[i].p, pts[i - 1].p)));
  const curves = rows.map((row) => curveData(interpCurve(row, t)));
  return { strip: faceOf(surfaceFromRows(curves)), face, faceIdx: faceIdx[k] };
}

// ───────────────────────── (e) řídicí body (CV) ─────────────────────────

export type CvInfo = { nu: number; nv: number; udeg: number; vdeg: number; poles: Vec3[][]; exact: boolean; uPeriodic: boolean; vPeriodic: boolean };

/**
 * B-spline plocha stěny pro úpravy CV: B-spline se zkopíruje přesně; jiné plochy se proloží sítí bodů (rovina přesně,
 * zakřivené analytické plochy přibližně). `grid` = požadovaný počet CV (u, v) – zvýšení stupně na 3 a vložení uzlů (přesné).
 */
export function cvSurface(face: r.Face, grid?: [number, number] | null): { surf: OC; exact: boolean; bounds: { u0: number; u1: number; v0: number; v1: number } } {
  const o = oc();
  const base = o.BRep_Tool.Surface(face.wrapped);
  const b = face.UVBounds;
  let surf: OC;
  let exact = true;
  let bounds = { u0: b.uMin, u1: b.uMax, v0: b.vMin, v1: b.vMax };
  if (face.geomType === "BSPLINE_SURFACE") surf = new o.Geom_BSplineSurface(base);
  else {
    // proložení sítí bodů v rozsahu stěny (rovina: bilineárně přesně; ostatní: kubicky přibližně)
    const planar = face.geomType === "PLANE";
    const nu = planar ? 2 : Math.max(4, grid?.[0] ?? 8);
    const nv = planar ? 2 : Math.max(4, grid?.[1] ?? 8);
    const pts: Vec3[][] = [];
    for (let j = 0; j < nv; j++) {
      const row: Vec3[] = [];
      for (let i = 0; i < nu; i++) row.push(surfD2(base, b.uMin + ((b.uMax - b.uMin) * i) / (nu - 1), b.vMin + ((b.vMax - b.vMin) * j) / (nv - 1)).p);
      pts.push(row);
    }
    const tu = Array.from({ length: nu }, (_, i) => i / (nu - 1));
    const tv = Array.from({ length: nv }, (_, j) => j / (nv - 1));
    surf = planar
      ? bilinear(pts)
      : tensorInterp(pts, tu, tv);
    exact = planar;
    bounds = { u0: 0, u1: 1, v0: 0, v1: 1 };
  }
  if (grid) refine(surf, grid[0], grid[1]);
  return { surf, exact, bounds };
}
function bilinear(pts: Vec3[][]): OC {
  const o = oc();
  const P = new o.NCollection_Array2_gp_Pnt(1, 2, 1, 2);
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) P.SetValue(i + 1, j + 1, new o.gp_Pnt(...pts[j][i]));
  const K = new o.NCollection_Array1_double(1, 2);
  K.SetValue(1, 0);
  K.SetValue(2, 1);
  const M = new o.NCollection_Array1_int(1, 2);
  M.SetValue(1, 2);
  M.SetValue(2, 2);
  return new o.Geom_BSplineSurface(P, K, K, M, M, 1, 1, false, false);
}
/** zvýšení stupně na 3 a vložení uzlů (doprostřed nejdelších úseků), dokud počet CV nedosáhne (nu, nv) – tvar se nemění */
function refine(s: OC, nu: number, nv: number) {
  if (nu > 40 || nv > 40) throw new Error(tr("Nejvýš 40 × 40 řídicích bodů."));
  if (s.UDegree() < 3 && nu > s.NbUPoles()) s.IncreaseDegree(3, s.VDegree());
  if (s.VDegree() < 3 && nv > s.NbVPoles()) s.IncreaseDegree(s.UDegree(), 3);
  const grow = (dirU: boolean, want: number) => {
    let guard = 0;
    while ((dirU ? s.NbUPoles() : s.NbVPoles()) < want && guard++ < 80) {
      const nk = dirU ? s.NbUKnots() : s.NbVKnots();
      let best = 1;
      let bl = -1;
      for (let i = 1; i < nk; i++) {
        const a = dirU ? s.UKnot(i) : s.VKnot(i);
        const b2 = dirU ? s.UKnot(i + 1) : s.VKnot(i + 1);
        if (b2 - a > bl) {
          bl = b2 - a;
          best = i;
        }
      }
      const mid = ((dirU ? s.UKnot(best) : s.VKnot(best)) + (dirU ? s.UKnot(best + 1) : s.VKnot(best + 1))) / 2;
      if (dirU) s.InsertUKnot(mid, 1, 1e-9, true);
      else s.InsertVKnot(mid, 1, 1e-9, true);
    }
  };
  grow(true, nu);
  grow(false, nv);
}

/** Seznam CV plochy (indexy od 1 jako v OCCT: [iu][iv]). */
export function cvInfo(face: r.Face, grid?: [number, number] | null): CvInfo {
  const { surf, exact } = cvSurface(face, grid);
  const poles: Vec3[][] = [];
  for (let i = 1; i <= surf.NbUPoles(); i++) {
    const row: Vec3[] = [];
    for (let j = 1; j <= surf.NbVPoles(); j++) row.push(xyz(surf.Pole(i, j)));
    poles.push(row);
  }
  return { nu: surf.NbUPoles(), nv: surf.NbVPoles(), udeg: surf.UDegree(), vdeg: surf.VDegree(), poles, exact, uPeriodic: surf.IsUPeriodic(), vPeriodic: surf.IsVPeriodic() };
}

export type CvMove = { i: number; j: number; d: Vec3 };
export type CvRowMove = { dir: "u" | "v"; index: number; d: Vec3 };
/** Posune CV (a řady CV) o vektory a vrátí novou stěnu v rozsahu parametrů původní stěny. */
export function cvEdit(face: r.Face, moves: CvMove[], rows: CvRowMove[], grid?: [number, number] | null): { face: r.Face; exact: boolean; info: CvInfo } {
  const o = oc();
  const { surf, exact, bounds } = cvSurface(face, grid);
  const nu = surf.NbUPoles();
  const nv = surf.NbVPoles();
  const shift = (i: number, j: number, d: Vec3) => {
    if (!(i >= 1 && i <= nu && j >= 1 && j <= nv)) throw new Error(tr("Plocha má řídicí body 1–{0} × 1–{1} – bod [{2}, {3}] neexistuje.", nu, nv, i, j));
    const p = xyz(surf.Pole(i, j));
    const g = new o.gp_Pnt(p[0] + d[0], p[1] + d[1], p[2] + d[2]);
    surf.SetPole(i, j, g);
    g.delete();
  };
  for (const m of moves) shift(m.i, m.j, m.d);
  for (const rw of rows) {
    if (rw.dir === "u") {
      if (!(rw.index >= 1 && rw.index <= nu)) throw new Error(tr("Řada u {0} neexistuje (plocha má řady u 1–{1}).", rw.index, nu));
      for (let j = 1; j <= nv; j++) shift(rw.index, j, rw.d);
    } else {
      if (!(rw.index >= 1 && rw.index <= nv)) throw new Error(tr("Řada v {0} neexistuje (plocha má řady v 1–{1}).", rw.index, nv));
      for (let i = 1; i <= nu; i++) shift(i, rw.index, rw.d);
    }
  }
  const nf = faceOf(surf, bounds);
  const poles: Vec3[][] = [];
  for (let i = 1; i <= nu; i++) {
    const row: Vec3[] = [];
    for (let j = 1; j <= nv; j++) row.push(xyz(surf.Pole(i, j)));
    poles.push(row);
  }
  return { face: nf, exact, info: { nu, nv, udeg: surf.UDegree(), vdeg: surf.VDegree(), poles, exact, uPeriodic: surf.IsUPeriodic(), vPeriodic: surf.IsVPeriodic() } };
}
