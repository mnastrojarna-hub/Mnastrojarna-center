/**
 * Pokročilé a mechanické vazby sestavy a globální řešič stupňů volnosti.
 *
 * - Vektorové zbytky všech druhů vazeb (`kinResidual`): 0 = vazba splněna. Úhlové složky jsou násobené délkou `L` [mm], aby se daly
 *   sčítat s posuvy (0,001 rad ≈ 0,1 mm).
 * - Stav stupňů volnosti: natočení komponenty kolem osy (Ozubení, Kardan), natočení A vůči B kolem společné osy (Šroub, rotační motor),
 *   posuv podél osy / drážky / dráhy (Šroub, Hřeben, lineární motor). Výchozí stav se zachytí při prvním řešení (`initMate` → `phase`),
 *   vazby pak udržují vztah přírůstků (např. ΔθA + i·ΔθB = 0). Úhly se rozbalují vůči předchozímu kroku (`KinCtx.ang`) – pohybová
 *   studie tak počítá i s více otáčkami; ve statickém řešení se rozdíl bere v rozsahu ±180°.
 * - Řešič Levenberg–Marquardt (`solvePoses`) nad polohami komponent (6 stupňů volnosti na komponentu: malé natočení kolem
 *   pivotu + posuv), Jacobiho matice numericky. Nedourčené stupně volnosti zůstávají, kde jsou (nejmenší změna).
 * Čisté funkce bez jádra – geometrii dodá volající (`FaceGeo` v souřadnicích komponenty nejvyšší úrovně).
 */
import { apply3, eulerXYZ, mul3, rotMatrix, type Mat3 } from "./assembly";
import type { FaceGeo } from "./mates";
import type { Mate, MateRef, MateType, Placement, Vec3 } from "./types";

/** Poloha komponenty: světový bod = R·x + p. */
export type Pose = { R: Mat3; p: Vec3 };
/** délka pro převod úhlových zbytků na mm */
export const L = 100;

export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: Vec3): Vec3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const transpose = (m: Mat3): Mat3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
/** úhel do (−π, π⟩ */
export const wrap = (a: number) => {
  const t = a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
  return t <= -Math.PI ? t + 2 * Math.PI : t;
};
export const DEG = 180 / Math.PI;

export const poseOf = (pl: Placement): Pose => ({ R: rotMatrix(pl.rotation), p: [...pl.position] as Vec3 });
const r9 = (v: number) => Math.round(v * 1e9) / 1e9 || 0;
export const placementOf = (P: Pose): Placement => ({ position: [r9(P.p[0]), r9(P.p[1]), r9(P.p[2])], rotation: eulerXYZ(P.R).map((v) => v || 0) as Vec3 });
export const toWorld = (P: Pose, x: Vec3): Vec3 => add(apply3(P.R, x), P.p);
export const toLocal = (P: Pose, x: Vec3): Vec3 => apply3(transpose(P.R), sub(x, P.p));

/** Rotace o vektor natočení ω (Rodrigues). */
export function expRot(w: Vec3): Mat3 {
  const th = len(w);
  if (th < 1e-14) return [1, -w[2], w[1], w[2], 1, -w[0], -w[1], w[0], 1];
  const [x, y, z] = scale(w, 1 / th);
  const c = Math.cos(th);
  const s = Math.sin(th);
  const C = 1 - c;
  return [c + x * x * C, x * y * C - z * s, x * z * C + y * s, y * x * C + z * s, c + y * y * C, y * z * C - x * s, z * x * C - y * s, z * y * C + x * s, c + z * z * C];
}
/** vektor natočení (osa × úhel) rotační matice – i pro velké úhly (sin θ by u 90° neměl derivaci) */
function rotErr(M: Mat3): Vec3 {
  const s: Vec3 = [(M[7] - M[5]) / 2, (M[2] - M[6]) / 2, (M[3] - M[1]) / 2];
  const c = Math.max(-1, Math.min(1, (M[0] + M[4] + M[8] - 1) / 2));
  const th = Math.acos(c);
  const sn = len(s);
  if (th < 1e-7 || sn < 1e-12) {
    if (c > 0) return s;
    // 180°: osa z diagonály
    const ax: Vec3 = [Math.sqrt(Math.max(0, (M[0] + 1) / 2)), Math.sqrt(Math.max(0, (M[4] + 1) / 2)), Math.sqrt(Math.max(0, (M[8] + 1) / 2))];
    if (M[1] + M[3] < 0) ax[1] = -ax[1];
    if (M[2] + M[6] < 0) ax[2] = -ax[2];
    return scale(unit(ax), Math.PI);
  }
  return scale(s, th / sn);
}

/**
 * Deterministická kolmice k jednotkovému směru (pevná v souřadnicích, ve kterých je směr zadán): průmět osy X, u směrů blízko X
 * průmět osy Y. Spojitá kolem hlavních os (číselný šum ±1e-17 u osy Z výsledek nepřeklopí).
 */
export function perpOf(n: Vec3): Vec3 {
  const e: Vec3 = Math.abs(n[0]) < 0.6 ? [1, 0, 0] : [0, 1, 0];
  return unit(sub(e, scale(n, dot(e, n))));
}
/** úhel vektoru `v` kolem osy `axis` měřený od `e1` (e1 ⟂ axis) */
const angleAbout = (v: Vec3, axis: Vec3, e1: Vec3) => Math.atan2(dot(v, cross(axis, e1)), dot(v, e1));
const perpPart = (v: Vec3, n: Vec3): Vec3 => sub(v, scale(n, dot(v, n)));

/** Geometrie ve světových souřadnicích (počátek, směr); body sítě / křivky zůstávají místní. */
export const worldOf = (P: Pose, g: FaceGeo): FaceGeo => ({ ...g, origin: toWorld(P, g.origin), normal: unit(apply3(P.R, g.normal)) });

/* ───────────────────────── druhy vazeb ───────────────────────── */

/** Vazby, které řeší globální řešič (nové druhy); původních 7 druhů řeší sekvenční řešič jako dřív. */
export const KIN_TYPES = new Set<MateType>(["perpendicular", "tangent", "coincident", "symmetric", "width", "path", "slot", "hinge", "lock", "limitDistance", "limitAngle", "gear", "rack", "screw", "cam", "universal"]);
export const isKinMate = (t: MateType) => KIN_TYPES.has(t);
/** Mechanické vazby (vztah stupňů volnosti dvou komponent). */
export const MECH_TYPES = new Set<MateType>(["gear", "rack", "screw", "cam", "universal"]);

/** body / osy / roviny podle druhu geometrie */
const isPoint = (g: FaceGeo) => g.kind === "point" || g.kind === "sphere" || g.kind === "circle";
const isAxis = (g: FaceGeo) => g.kind === "cylinder" || g.kind === "line";
const isPlane = (g: FaceGeo) => g.kind === "plane";

/* ───────────────────────── kontext a stavy ───────────────────────── */

export type KinCtx = {
  pose: (compId: string) => Pose | undefined;
  /** geometrie odkazu v souřadnicích komponenty nejvyšší úrovně */
  geo: (ref: MateRef) => FaceGeo | null;
  /** rozbalení úhlového přírůstku `d` [rad] pro klíč (vazba:veličina) – vůči předchozímu kroku, jinak do (−π, π⟩ */
  ang: (key: string, d: number) => number;
};

const wgeo = (ctx: KinCtx, ref: MateRef | undefined): FaceGeo | null => {
  if (!ref) return null;
  const P = ctx.pose(ref.compId);
  const g = P ? ctx.geo(ref) : null;
  return P && g ? worldOf(P, g) : null;
};

/** natočení komponenty kolem její osy ve světě (základna kolmá k ose ve světových souřadnicích) */
function spinAngle(P: Pose, g: FaceGeo): number {
  const nl = unit(g.normal);
  const ax = unit(apply3(P.R, nl));
  return angleAbout(apply3(P.R, perpOf(nl)), ax, perpOf(ax));
}
/** natočení A vůči B kolem osy B (Šroub, rotační motor na Souososti / Závěsu) a posuv A podél osy B */
export function relState(PA: Pose, gA: FaceGeo, PB: Pose, gB: FaceGeo): { phi: number; d: number } {
  const ax = unit(apply3(PB.R, gB.normal));
  const sA = apply3(PA.R, perpOf(unit(gA.normal)));
  const e1 = unit(perpPart(apply3(PB.R, perpOf(unit(gB.normal))), ax));
  return { phi: angleAbout(sA, ax, e1), d: dot(sub(toWorld(PA, gA.origin), toWorld(PB, gB.origin)), ax) };
}
/** Hřeben a pastorek: natočení pastorku (A) vůči směru hřebenu a poloha hřebenu (B) podél jeho směru */
function rackState(PA: Pose, gA: FaceGeo, PB: Pose, gB: FaceGeo): { th: number; s: number } | null {
  const ax = unit(apply3(PA.R, gA.normal));
  const nB = unit(apply3(PB.R, gB.normal));
  const dir = gB.kind === "plane" ? cross(nB, ax) : nB;
  const e1 = perpPart(dir, ax);
  if (len(e1) < 1e-9) return null;
  const u = unit(e1);
  return { th: angleAbout(apply3(PA.R, perpOf(unit(gA.normal))), ax, u), s: dot(sub(toWorld(PB, gB.origin), toWorld(PA, gA.origin)), unit(dir)) };
}
/** Kardan: úhly vidlic vstupního (A) a výstupního (B) hřídele od roviny hřídelů a úhel hřídelů β */
function ujState(PA: Pose, gA: FaceGeo, PB: Pose, gB: FaceGeo): { t1: number; t2: number; beta: number } {
  const a1 = unit(apply3(PA.R, gA.normal));
  const a2 = unit(apply3(PB.R, gB.normal));
  const c = cross(a1, a2);
  const n = len(c) > 1e-9 ? unit(c) : perpOf(a1);
  return {
    t1: angleAbout(apply3(PA.R, perpOf(unit(gA.normal))), a1, n),
    t2: angleAbout(apply3(PB.R, perpOf(unit(gB.normal))), a2, unit(perpPart(n, a2))),
    beta: Math.acos(Math.max(-1, Math.min(1, dot(a1, a2)))),
  };
}

/**
 * Výchozí stav vazby (zachytí se při prvním řešení z aktuálních poloh): Ozubení [θA°, θB°], Hřeben [θ°, s], Šroub [φ°, d],
 * Kardan [θ1°, θ2°], Závěs bez dosedacích rovin [axiální odsazení], Zámek `rel`. Vrací stejnou vazbu, když nic nepotřebuje.
 */
export function initMate(m: Mate, ctx: KinCtx): Mate {
  if (m.type === "lock") {
    if (m.rel) return m;
    const PA = ctx.pose(m.a.compId);
    const PB = ctx.pose(m.b.compId);
    if (!PA || !PB) return m;
    return { ...m, rel: placementOf({ R: mul3(transpose(PB.R), PA.R), p: toLocal(PB, PA.p) }) };
  }
  if (m.phase || !["gear", "rack", "screw", "universal", "hinge"].includes(m.type)) return m;
  if (m.type === "hinge" && m.c && m.d) return m;
  const PA = ctx.pose(m.a.compId);
  const PB = ctx.pose(m.b.compId);
  const gA = ctx.geo(m.a);
  const gB = ctx.geo(m.b);
  if (!PA || !PB || !gA || !gB) return m;
  const r6 = (v: number) => Math.round(v * 1e6) / 1e6 || 0;
  switch (m.type) {
    case "gear":
      return { ...m, phase: [r6(spinAngle(PA, gA) * DEG), r6(spinAngle(PB, gB) * DEG)] };
    case "rack": {
      const s = rackState(PA, gA, PB, gB);
      return s ? { ...m, phase: [r6(s.th * DEG), r6(s.s)] } : m;
    }
    case "screw": {
      const s = relState(PA, gA, PB, gB);
      return { ...m, phase: [r6(s.phi * DEG), r6(s.d)] };
    }
    case "universal": {
      const s = ujState(PA, gA, PB, gB);
      return { ...m, phase: [r6(s.t1 * DEG), r6(s.t2 * DEG)] };
    }
    default: {
      // Závěs bez dosedacích rovin: osová poloha se drží na hodnotě při vytvoření
      const ax = unit(apply3(PB.R, gB.normal));
      return { ...m, phase: [r6(dot(sub(toWorld(PA, gA.origin), toWorld(PB, gB.origin)), ax))] };
    }
  }
}

/* ───────────────────────── nejbližší body ───────────────────────── */

/** Nejbližší bod trojúhelníku k bodu (Ericson, Real-Time Collision Detection 5.1.5). */
export function closestOnTri(p: Vec3, a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return add(a, scale(ab, d1 / (d1 - d3 || 1)));
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return add(a, scale(ac, d2 / (d2 - d6 || 1)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return add(b, scale(sub(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6) || 1)));
  const den = 1 / (va + vb + vc || 1);
  return add(a, add(scale(ab, vb * den), scale(ac, vc * den)));
}

type MeshIdx = { cen: Vec3[]; rad: number[]; nrm: Vec3[] };
const meshIdx = new WeakMap<FaceGeo, MeshIdx>();
/** těžiště, poloměry a normály trojúhelníků sítě plochy (normála orientovaná podle normál ve vrcholech, jinak podle pořadí vrcholů) */
function indexOf(g: FaceGeo): MeshIdx {
  const hit = meshIdx.get(g);
  if (hit) return hit;
  const P = g.pts ?? [];
  const T = g.tris ?? [];
  const out: MeshIdx = { cen: [], rad: [], nrm: [] };
  for (let i = 0; i + 2 < T.length; i += 3) {
    const [a, b, c] = [P[T[i]], P[T[i + 1]], P[T[i + 2]]];
    const cen = scale(add(add(a, b), c), 1 / 3);
    out.cen.push(cen);
    out.rad.push(Math.max(len(sub(a, cen)), len(sub(b, cen)), len(sub(c, cen))));
    let n = cross(sub(b, a), sub(c, a));
    if (g.nrm) {
      const vn = add(add(g.nrm[T[i]], g.nrm[T[i + 1]]), g.nrm[T[i + 2]]);
      if (dot(vn, n) < 0) n = scale(n, -1);
    }
    out.nrm.push(unit(n));
  }
  meshIdx.set(g, out);
  return out;
}

/**
 * Znaménková vzdálenost bodu od sítě plochy (kladná na straně normály). `axis` = promítnutí podél osy (váleček rovnoběžný s osou
 * vačky – vzdálenost se měří v rovině kolmé na osu). Síto: nejdřív nejbližší vrchol, pak jen trojúhelníky, které mohou být blíž.
 */
export function meshSignedDistance(g: FaceGeo, p: Vec3, axis?: Vec3): number {
  const P = g.pts ?? [];
  const T = g.tris ?? [];
  if (!T.length) return NaN;
  const idx = indexOf(g);
  const pr = (x: Vec3) => (axis ? perpPart(x, axis) : x);
  const pp = pr(p);
  let bound = Infinity;
  for (const v of P) bound = Math.min(bound, len(sub(pr(v), pp)));
  let best = Infinity;
  let sign = 1;
  for (let t = 0, i = 0; i + 2 < T.length; i += 3, t++) {
    if (len(sub(pr(idx.cen[t]), pp)) - idx.rad[t] > bound + 1e-9) continue;
    const q = closestOnTri(pp, pr(P[T[i]]), pr(P[T[i + 1]]), pr(P[T[i + 2]]));
    const d = len(sub(pp, q));
    if (d < best - 1e-12) {
      best = d;
      const n = pr(idx.nrm[t]);
      sign = dot(sub(pp, q), len(n) > 1e-9 ? n : idx.nrm[t]) < 0 ? -1 : 1;
    }
  }
  return sign * best;
}

/** Nejbližší bod křivky (úsečka / kružnice / lomená čára) a jeho poloha podél křivky `s` [mm]. */
export function curveNearest(g: FaceGeo, p: Vec3): { q: Vec3; s: number } | null {
  if (g.kind === "line") {
    const d = unit(g.normal);
    let t = dot(sub(p, g.origin), d);
    const l = g.pts && g.pts.length > 1 ? len(sub(g.pts[g.pts.length - 1], g.pts[0])) : Infinity;
    t = Math.max(0, Math.min(l, t));
    return { q: add(g.origin, scale(d, t)), s: t };
  }
  if (g.kind === "circle") {
    const n = unit(g.normal);
    const v = perpPart(sub(p, g.origin), n);
    const e1 = perpOf(n);
    const u = len(v) > 1e-12 ? unit(v) : e1;
    const r = g.radius ?? 0;
    return { q: add(g.origin, scale(u, r)), s: angleAbout(u, n, e1) * r };
  }
  const P = g.pts ?? [];
  if (!P.length) return null;
  let best = Infinity;
  let q = P[0];
  let s = 0;
  let acc = 0;
  for (let i = 0; i + 1 < P.length; i++) {
    const a = P[i];
    const ab = sub(P[i + 1], a);
    const l2 = dot(ab, ab);
    const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0;
    const c = add(a, scale(ab, t));
    const d = len(sub(p, c));
    if (d < best) {
      best = d;
      q = c;
      s = acc + t * Math.sqrt(l2);
    }
    acc += Math.sqrt(l2);
  }
  return { q, s };
}

/* ───────────────────────── zbytky vazeb ───────────────────────── */

const vecL = (v: Vec3) => [v[0] * L, v[1] * L, v[2] * L];
/** souosost dvou os (válec, úsečka): směry rovnoběžně, bod osy A na ose B */
const axisRes = (A: FaceGeo, B: FaceGeo) => [...vecL(cross(A.normal, B.normal)), ...perpPart(sub(A.origin, B.origin), B.normal)];
/** penalizace mezí: 0 uvnitř ⟨min, max⟩ */
const bound = (v: number, min?: number, max?: number) => (min !== undefined && v < min ? v - min : max !== undefined && v > max ? v - max : 0);

/** Zbytky původních druhů vazeb (pro globální řešič; stav konfliktu se u nich dál hodnotí původní funkcí `residual`). */
function basicRes(m: Mate, A: FaceGeo, B: FaceGeo): number[] {
  const d = sub(A.origin, B.origin);
  switch (m.type) {
    case "mate":
    case "flush":
    case "distance": {
      const s = (m.type === "flush" ? 1 : -1) * (m.flip ? -1 : 1);
      const out = [...vecL(sub(A.normal, scale(B.normal, s))), dot(d, B.normal) - (m.type === "distance" ? (m.value ?? 0) : 0)];
      if (m.center) out.push(...perpPart(d, B.normal));
      return out;
    }
    case "concentric":
      return axisRes(A, B);
    case "parallel":
      return vecL(sub(A.normal, scale(B.normal, m.flip ? -1 : 1)));
    case "angle":
      return [(Math.atan2(len(cross(A.normal, B.normal)), dot(A.normal, B.normal)) - (Math.abs(m.value ?? 0) * Math.PI) / 180) * L];
    default:
      return [];
  }
}

/** bod „bodové“ geometrie (vrchol, střed koule, střed kružnice) */
const pointOf = (g: FaceGeo) => g.origin;

/** Tečnost dvou ploch (rovina, válec, koule); `flip` = vnitřní dotyk (válec / koule uvnitř) nebo druhá strana roviny. */
function tangentRes(A: FaceGeo, B: FaceGeo, flip: boolean): number[] | null {
  const s = flip ? -1 : 1;
  const rA = A.radius ?? 0;
  const rB = B.radius ?? 0;
  const pl = isPlane(A) ? A : isPlane(B) ? B : null;
  const other = pl === A ? B : A;
  if (pl && other !== pl) {
    if (other.kind === "cylinder") return [dot(other.normal, pl.normal) * L, dot(sub(other.origin, pl.origin), pl.normal) - s * (other.radius ?? 0)];
    if (other.kind === "sphere") return [dot(sub(other.origin, pl.origin), pl.normal) - s * (other.radius ?? 0)];
    return null;
  }
  const want = flip ? Math.abs(rA - rB) : rA + rB;
  if (A.kind === "cylinder" && B.kind === "cylinder") return [...vecL(cross(A.normal, B.normal)), len(perpPart(sub(A.origin, B.origin), B.normal)) - want];
  if (A.kind === "sphere" && B.kind === "sphere") return [len(sub(A.origin, B.origin)) - want];
  const cyl = A.kind === "cylinder" ? A : B.kind === "cylinder" ? B : null;
  const sph = A.kind === "sphere" ? A : B.kind === "sphere" ? B : null;
  if (cyl && sph) return [len(perpPart(sub(sph.origin, cyl.origin), cyl.normal)) - want];
  return null;
}

/** Shodnost: bod / osa / rovina A na bod / osu / rovinu B. */
function coincidentRes(A: FaceGeo, B: FaceGeo): number[] | null {
  if (isPoint(A) && isPoint(B)) return sub(pointOf(A), pointOf(B));
  if (isPoint(A) && isPlane(B)) return [dot(sub(pointOf(A), B.origin), B.normal)];
  if (isPoint(A) && isAxis(B)) return perpPart(sub(pointOf(A), B.origin), B.normal);
  if (isAxis(A) && isPoint(B)) return perpPart(sub(pointOf(B), A.origin), A.normal);
  if (isPlane(A) && isPoint(B)) return [dot(sub(pointOf(B), A.origin), A.normal)];
  if (isAxis(A) && isAxis(B)) return axisRes(A, B);
  if (isAxis(A) && isPlane(B)) return [dot(A.normal, B.normal) * L, dot(sub(A.origin, B.origin), B.normal)];
  if (isPlane(A) && isAxis(B)) return [dot(A.normal, B.normal) * L, dot(sub(B.origin, A.origin), A.normal)];
  if (isPlane(A) && isPlane(B)) return [...vecL(cross(A.normal, B.normal)), dot(sub(A.origin, B.origin), B.normal)];
  return null;
}

/** zrcadlení bodu / směru podle roviny */
const mirrorPt = (p: Vec3, C: FaceGeo) => sub(p, scale(C.normal, 2 * dot(sub(p, C.origin), C.normal)));
const mirrorDir = (n: Vec3, C: FaceGeo) => sub(n, scale(C.normal, 2 * dot(n, C.normal)));

/** Rovnoběžná / opačná orientace bez ohledu na znaménko: rozdíl k bližšímu z ±n. */
const alignRes = (a: Vec3, b: Vec3) => vecL(dot(a, b) >= 0 ? sub(a, b) : add(a, b));

/**
 * Vektor zbytků vazby (0 = splněna); null = chybí geometrie nebo nepodporovaná kombinace ploch.
 * Pro původní druhy vazeb vrací ekvivalent jejich podmínek (globální řešič je použije spolu s novými vazbami).
 */
export function kinResidual(m: Mate, ctx: KinCtx): number[] | null {
  if (m.type === "fixed") return [];
  if (m.type === "lock") {
    const PA = ctx.pose(m.a.compId);
    const PB = ctx.pose(m.b.compId);
    if (!PA || !PB || !m.rel) return PA && PB ? [] : null;
    const rel = poseOf(m.rel);
    const R = mul3(transpose(PB.R), PA.R);
    return [...sub(toLocal(PB, PA.p), rel.p), ...vecL(rotErr(mul3(R, transpose(rel.R))))];
  }
  const A = wgeo(ctx, m.a);
  const B = wgeo(ctx, m.b);
  if (!A || !B) return null;
  switch (m.type) {
    case "mate":
    case "flush":
    case "distance":
    case "concentric":
    case "parallel":
    case "angle":
      return basicRes(m, A, B);
    case "perpendicular":
      return [dot(A.normal, B.normal) * L];
    case "tangent":
      return tangentRes(A, B, !!m.flip);
    case "coincident":
      return coincidentRes(A, B);
    case "symmetric": {
      const C = wgeo(ctx, m.c);
      if (!C || !isPlane(C)) return null;
      const pA = mirrorPt(A.origin, C);
      const nA = mirrorDir(A.normal, C);
      if (isPlane(A) && isPlane(B)) return [...vecL(sub(nA, scale(B.normal, m.flip ? -1 : 1))), dot(sub(pA, B.origin), B.normal)];
      if (isAxis(A) && isAxis(B)) return axisRes({ ...A, origin: pA, normal: nA }, B);
      if (isPoint(A) && isPoint(B)) return sub(pA, B.origin);
      return null;
    }
    case "width": {
      const D = wgeo(ctx, m.d);
      if (!D || !isPlane(B) || !isPlane(D)) return null;
      const mid = scale(add(B.origin, D.origin), 0.5);
      // válcový jazýček (čep): osa rovnoběžně se stěnami drážky, osa ve střední rovině drážky
      if (A.kind === "cylinder") return [dot(A.normal, B.normal) * L, dot(sub(A.origin, mid), B.normal)];
      const C = wgeo(ctx, m.c);
      if (!C || !isPlane(A) || !isPlane(C)) return null;
      return [...alignRes(A.normal, B.normal), dot(sub(scale(add(A.origin, C.origin), 0.5), mid), B.normal)];
    }
    case "path": {
      if (!isPoint(A)) return null;
      const PB = ctx.pose(m.b.compId)!;
      const gB = ctx.geo(m.b)!;
      const near = curveNearest(gB, toLocal(PB, A.origin));
      return near ? sub(toLocal(PB, A.origin), near.q) : null;
    }
    case "slot": {
      const C = wgeo(ctx, m.c);
      if (!C || A.kind !== "cylinder" || B.kind !== "cylinder" || C.kind !== "cylinder") return null;
      const n = B.normal;
      const b0 = perpPart(B.origin, n);
      const span = sub(perpPart(C.origin, n), b0);
      const l = len(span);
      if (l < 1e-9) return null;
      const u = scale(span, 1 / l);
      const rel = sub(perpPart(A.origin, n), b0);
      const t = dot(rel, u);
      const pos = m.value !== undefined ? t - m.value : bound(t, 0, l);
      return [...vecL(cross(A.normal, n)), ...sub(rel, scale(u, t)), pos];
    }
    case "hinge": {
      const out = axisRes(A, B);
      if (m.c && m.d) {
        const C = wgeo(ctx, m.c);
        const D = wgeo(ctx, m.d);
        if (!C || !D) return null;
        out.push(dot(sub(C.origin, D.origin), D.normal));
      } else out.push(dot(sub(A.origin, B.origin), B.normal) - (m.phase?.[0] ?? dot(sub(A.origin, B.origin), B.normal)));
      return out;
    }
    case "limitDistance": {
      const g = dot(sub(A.origin, B.origin), B.normal);
      const out = isPlane(A) && isPlane(B) ? vecL(sub(A.normal, scale(B.normal, m.flip ? 1 : -1))) : [];
      return [...out, bound(g, m.min, m.max)];
    }
    case "limitAngle": {
      const a = Math.atan2(len(cross(A.normal, B.normal)), dot(A.normal, B.normal)) * DEG;
      return [(bound(a, m.min, m.max) / DEG) * L];
    }
    case "gear": {
      if (!m.phase) return [0];
      const PA = ctx.pose(m.a.compId)!;
      const PB = ctx.pose(m.b.compId)!;
      const dA = ctx.ang(`${m.id}:a`, spinAngle(PA, ctx.geo(m.a)!) - m.phase[0] / DEG);
      const dB = ctx.ang(`${m.id}:b`, spinAngle(PB, ctx.geo(m.b)!) - m.phase[1] / DEG);
      const i = Math.abs(m.value ?? 1) || 1;
      return [(dA + (m.flip ? -1 : 1) * i * dB) * L];
    }
    case "rack": {
      const st = rackState(ctx.pose(m.a.compId)!, ctx.geo(m.a)!, ctx.pose(m.b.compId)!, ctx.geo(m.b)!);
      if (!st) return null;
      if (!m.phase) return [0];
      const dth = ctx.ang(`${m.id}:a`, st.th - m.phase[0] / DEG);
      return [st.s - m.phase[1] - ((m.flip ? -1 : 1) * (m.value ?? 0) * dth) / (2 * Math.PI)];
    }
    case "screw": {
      const st = relState(ctx.pose(m.a.compId)!, ctx.geo(m.a)!, ctx.pose(m.b.compId)!, ctx.geo(m.b)!);
      const out = axisRes(A, B);
      if (!m.phase) return [...out, 0];
      const dphi = ctx.ang(`${m.id}:a`, st.phi - m.phase[0] / DEG);
      out.push(st.d - m.phase[1] - ((m.flip ? -1 : 1) * (m.value ?? 0) * dphi) / (2 * Math.PI));
      return out;
    }
    case "universal": {
      if (!m.phase) return [0];
      const st = ujState(ctx.pose(m.a.compId)!, ctx.geo(m.a)!, ctx.pose(m.b.compId)!, ctx.geo(m.b)!);
      const x = st.t1 - m.phase[0] / DEG;
      const f = Math.atan2(Math.sin(x), Math.cos(x) * Math.cos(st.beta));
      return [wrap(st.t2 - m.phase[1] / DEG - f) * L];
    }
    case "cam": {
      // vačka (B) – síť plochy v souřadnicích komponenty; zdvihátko (A) se převede do nich
      const PB = ctx.pose(m.b.compId)!;
      const gB = ctx.geo(m.b)!;
      if (!gB.tris?.length) return null;
      const o = toLocal(PB, A.origin);
      const n = unit(apply3(transpose(PB.R), A.normal));
      const r = A.radius ?? 0;
      if (A.kind === "plane") {
        let mn = Infinity;
        for (const v of gB.pts!) mn = Math.min(mn, dot(sub(v, o), n));
        return [mn];
      }
      if (A.kind === "cylinder") return [meshSignedDistance(gB, o, n) - r];
      if (A.kind === "sphere") return [meshSignedDistance(gB, o) - r];
      if (A.kind === "point") return [meshSignedDistance(gB, o)];
      return null;
    }
  }
  return null;
}

/* ───────────────────────── stupně volnosti pro motory ───────────────────────── */

/** Druh stupně volnosti vazby, který může pohánět motor. */
export const ROTARY_MOTOR_TYPES = new Set<MateType>(["concentric", "hinge", "screw"]);
export const LINEAR_MOTOR_TYPES = new Set<MateType>(["distance", "slot", "path", "concentric", "screw"]);

/**
 * Okamžitá hodnota stupně volnosti vazby: „rotary“ = natočení A vůči B kolem osy B [rad, −π…π], „linear“ = Vzdálenost (mezera),
 * Souosost / Šroub (posuv A podél osy B), Drážka (poloha podél drážky), Dráha (poloha bodu podél křivky) [mm].
 */
export function dofValue(m: Mate, kind: "rotary" | "linear", ctx: KinCtx): number | null {
  const PA = ctx.pose(m.a.compId);
  const PB = ctx.pose(m.b.compId);
  const gA = ctx.geo(m.a);
  const gB = ctx.geo(m.b);
  if (!PA || !PB || !gA || !gB) return null;
  if (kind === "rotary") return relState(PA, gA, PB, gB).phi;
  const A = worldOf(PA, gA);
  const B = worldOf(PB, gB);
  switch (m.type) {
    case "distance":
      return dot(sub(A.origin, B.origin), B.normal);
    case "concentric":
    case "screw":
    case "hinge":
      return relState(PA, gA, PB, gB).d;
    case "slot": {
      const C = wgeo(ctx, m.c);
      if (!C) return null;
      const n = B.normal;
      const u = unit(sub(perpPart(C.origin, n), perpPart(B.origin, n)));
      return dot(sub(perpPart(A.origin, n), perpPart(B.origin, n)), u);
    }
    case "path":
      return curveNearest(gB, toLocal(PB, A.origin))?.s ?? null;
    default:
      return null;
  }
}

/* ───────────────────────── řešič Levenberg–Marquardt ───────────────────────── */

export type SolveVar = { id: string; pivot: Vec3 };

/** Řešení soustavy A·x = b (Gaussova eliminace s výběrem hlavního prvku); A je hustá n×n po řádcích. */
function gauss(A: Float64Array, b: Float64Array, n: number): Float64Array | null {
  const M = A.slice();
  const x = b.slice();
  for (let k = 0; k < n; k++) {
    let piv = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(M[i * n + k]) > Math.abs(M[piv * n + k])) piv = i;
    if (Math.abs(M[piv * n + k]) < 1e-300) return null;
    if (piv !== k) {
      for (let j = 0; j < n; j++) [M[k * n + j], M[piv * n + j]] = [M[piv * n + j], M[k * n + j]];
      [x[k], x[piv]] = [x[piv], x[k]];
    }
    for (let i = k + 1; i < n; i++) {
      const f = M[i * n + k] / M[k * n + k];
      if (!f) continue;
      for (let j = k; j < n; j++) M[i * n + j] -= f * M[k * n + j];
      x[i] -= f * x[k];
    }
  }
  for (let k = n - 1; k >= 0; k--) {
    let s = x[k];
    for (let j = k + 1; j < n; j++) s -= M[k * n + j] * x[j];
    x[k] = s / M[k * n + k];
  }
  return x;
}

/**
 * Najde polohy komponent `vars`, při kterých jsou zbytky `resid()` nulové (nejmenší čtverce), z výchozích poloh v `poses`
 * (mapa se upraví na výsledek). Proměnné komponenty: natočení kolem jejího pivotu (×L) a posuv. Vrací součet čtverců zbytků.
 */
export function solvePoses(poses: Map<string, Pose>, vars: SolveVar[], resid: () => number[], opts: { maxIter?: number; tol?: number } = {}): { cost: number; iter: number } {
  const n = vars.length * 6;
  const base = vars.map((v) => poses.get(v.id)!);
  const cost = (r: number[]) => r.reduce((s, v) => s + v * v, 0);
  if (!n) return { cost: cost(resid()), iter: 0 };
  const x = new Float64Array(n);
  const apply = (xv: Float64Array) => {
    vars.forEach((v, i) => {
      const P = base[i];
      const E = expRot([xv[i * 6] / L, xv[i * 6 + 1] / L, xv[i * 6 + 2] / L]);
      poses.set(v.id, { R: mul3(E, P.R), p: add(add(apply3(E, sub(P.p, v.pivot)), v.pivot), [xv[i * 6 + 3], xv[i * 6 + 4], xv[i * 6 + 5]]) });
    });
  };
  const evalAt = (xv: Float64Array) => {
    apply(xv);
    return resid();
  };
  let r = evalAt(x);
  let c = cost(r);
  const tol = opts.tol ?? 1e-20;
  let lambda = 1e-3;
  let iter = 0;
  const h = 1e-6;
  for (; iter < (opts.maxIter ?? 60) && c > tol; iter++) {
    const m = r.length;
    const J = new Float64Array(m * n);
    for (let j = 0; j < n; j++) {
      const xj = x[j];
      x[j] = xj + h;
      const rj = evalAt(x);
      x[j] = xj;
      for (let i = 0; i < m; i++) J[i * n + j] = ((rj[i] ?? 0) - r[i]) / h;
    }
    const JtJ = new Float64Array(n * n);
    const Jtr = new Float64Array(n);
    for (let i = 0; i < m; i++) {
      const ri = r[i];
      for (let a = 0; a < n; a++) {
        const ja = J[i * n + a];
        if (!ja) continue;
        Jtr[a] -= ja * ri;
        for (let b = a; b < n; b++) JtJ[a * n + b] += ja * J[i * n + b];
      }
    }
    for (let a = 0; a < n; a++) for (let b = 0; b < a; b++) JtJ[a * n + b] = JtJ[b * n + a];
    let improved = false;
    for (let tries = 0; tries < 12; tries++) {
      const A = JtJ.slice();
      for (let a = 0; a < n; a++) A[a * n + a] += lambda * (1 + JtJ[a * n + a]);
      const dx = gauss(A, Jtr, n);
      if (!dx) {
        lambda *= 10;
        continue;
      }
      const xn = x.slice();
      for (let a = 0; a < n; a++) xn[a] += dx[a];
      const rn = evalAt(xn);
      const cn = cost(rn);
      if (cn < c) {
        x.set(xn);
        r = rn;
        const small = dx.reduce((s, v) => Math.max(s, Math.abs(v)), 0) < 1e-13;
        c = cn;
        lambda = Math.max(lambda / 4, 1e-12);
        improved = true;
        if (small) iter = 1e9;
        break;
      }
      lambda *= 6;
    }
    if (!improved) break;
  }
  apply(x);
  return { cost: c, iter };
}

/** Pivot komponenty: střed počátků geometrií jejích vazeb (natočení kolem něj méně posouvá geometrii). */
export function pivotOf(compId: string, mates: Mate[], ctx: KinCtx): Vec3 {
  const pts: Vec3[] = [];
  for (const m of mates)
    for (const ref of [m.a, m.b, m.c, m.d]) {
      if (!ref || ref.compId !== compId) continue;
      const g = wgeo(ctx, ref);
      if (g) pts.push(g.origin);
    }
  const P = ctx.pose(compId);
  if (!pts.length) return P ? [...P.p] as Vec3 : [0, 0, 0];
  return scale(pts.reduce((s, p) => add(s, p), [0, 0, 0] as Vec3), 1 / pts.length);
}

/** Norma vektoru zbytků (∞ = chybí geometrie). */
export const resNorm = (r: number[] | null) => (r ? Math.sqrt(r.reduce((s, v) => s + v * v, 0)) : Infinity);
