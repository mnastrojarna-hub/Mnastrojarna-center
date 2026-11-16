/**
 * Střednice drátu pružin (čisté funkce – jádro z nich staví těleso, balík motion z nich generuje síť při přehrávání pohybu).
 *
 * Souřadnice prvku: osa pružiny = +Z, počátek v ose na spodní dosedací rovině (tlačná pružina: konce v z = 0 a z = L).
 *
 * TLAČNÁ (EN 13906-1): proměnné stoupání p(u) po závitech u = θ / 2π:
 *   - závěrné (mrtvé) závity na obou koncích ne = (nt − n) / 2 se stoupáním pe = drát · (1 + COIL_GAP) – „přiložené“ závity
 *     s nepatrnou mezerou, aby těleso zůstalo platné (skutečné se dotýkají);
 *   - plynulý přechod pe → pa na délce ½ závitu (kosinový přechod stoupání, výška je pak spojitá ve 2. derivaci), střed přechodu
 *     na hranici závěrný / činný závit, takže činných závitů je přesně n;
 *   - činné závity se stoupáním pa = (L − 2·zs − 2·ne·pe) / n.
 *   Výška střednice na začátku zs: broušené konce −d/4 (rovina z = 0 obrousí ≈ ¾ závitu, hrot drátu má tloušťku d/4),
 *   neobroušené d/2 (drát se dotýká roviny). Broušené těleso se ořízne rovinami z = 0 a z = L (`clip`).
 *   Tvar v jiné délce L (stlačená pružina v sestavě) = stejné závity, jen menší pa; pod délkou, kdy pa = pe, mají všechny závity
 *   stejné stoupání s menší mezerou (nejméně MIN_COIL_GAP) – tvar tak dosáhne délky na doraz Ln (broušené / neobroušené konce
 *   do n ≈ 98; otevřené konce o MIN_COIL_GAP · n · d delší), pod ní se dál nezkracuje.
 * TAŽNÁ (EN 13906-2): těsně vinuté tělo (stoupání pe) a očka: německé (kruh v rovině osy, střed v ose, LH = Di), poloviční
 *   (stejný kruh níž, otevřený), boční (kruh v tečné rovině posledního závitu). Spodní očko = horní očko otočené o 180°
 *   kolem vodorovné osy středem těla (stejná konstrukce na obou koncích).
 * ZKRUTNÁ (EN 13906-3): těsně vinuté tělo + ramena tečná / radiální / osová (oblouk ohybu o poloměru = drát, pak přímý úsek).
 */
import type { SpringPath } from "./types";
import type { Vec3 } from "../types";

/** relativní mezera mezi přiloženými závity (geometrie; výpočet počítá s dotykem) */
export const COIL_GAP = 0.03;
/** nejmenší relativní mezera závitů tvaru stlačeného pod délku s mezerou COIL_GAP (aby těleso zůstalo platné) */
export const MIN_COIL_GAP = 0.002;
/** šířka přechodu stoupání ve závitech */
export const TRANSITION = 0.5;

export type Ends = "ground" | "closed" | "open";
export type CoilSpec = {
  /** střední poloměr */
  R: number;
  d: number;
  /** činné závity */
  n: number;
  /** závěrné závity na každém konci */
  ne: number;
  /** výška střednice na začátku */
  zs: number;
  /** délka tvaru (konce v 0 a L) */
  L: number;
  pe: number;
  pa: number;
  hand: 1 | -1;
  ground: boolean;
};

/** Tvar tlačné pružiny v délce L (výchozí L0). Geometricky nejkratší tvar = pa = pe. */
export function compressionSpec(o: { d: number; D: number; n: number; L0: number; ends: Ends; hand?: "right" | "left"; L?: number }): CoilSpec {
  const ne = o.ends === "open" ? 0 : 1;
  const zs = o.ends === "ground" ? -o.d / 4 : o.d / 2;
  const coils = o.n + 2 * ne;
  let pe = o.d * (1 + COIL_GAP);
  const want = o.L ?? o.L0;
  let L = want;
  if (want < 2 * zs + coils * pe) {
    // kratší než závěrné závity s mezerou COIL_GAP a činné se stejným stoupáním: všechny závity jedno stoupání, mezera
    // se zmenší (nejméně MIN_COIL_GAP) – tvar dosáhne délky na doraz Ln (dřív zůstal o (n + 2) · 3 % · d − d/2 delší)
    pe = Math.max(o.d * (1 + MIN_COIL_GAP), (want - 2 * zs) / coils);
    L = 2 * zs + coils * pe;
  }
  const pa = (L - 2 * zs - 2 * ne * pe) / o.n;
  return { R: o.D / 2, d: o.d, n: o.n, ne, zs, L, pe, pa, hand: o.hand === "left" ? -1 : 1, ground: o.ends === "ground" };
}
/** geometricky nejkratší délka tvaru (všechny závity se stoupáním d · (1 + MIN_COIL_GAP)) */
export const compressionMinLength = (s: Pick<CoilSpec, "zs" | "n" | "ne" | "d">) => 2 * s.zs + (s.n + 2 * s.ne) * s.d * (1 + MIN_COIL_GAP);

const blend = (t: number) => (1 - Math.cos(Math.PI * t)) / 2;
const blendInt = (t: number) => (t - Math.sin(Math.PI * t) / Math.PI) / 2;

/** stoupání v místě u (závity od začátku) */
export function pitchAt(s: CoilSpec, u: number): number {
  if (s.ne === 0) return s.pa;
  const total = s.n + 2 * s.ne;
  const h = TRANSITION / 2;
  const x = u <= total / 2 ? u : total - u; // souměrné
  if (x <= s.ne - h) return s.pe;
  if (x >= s.ne + h) return s.pa;
  return s.pe + (s.pa - s.pe) * blend((x - (s.ne - h)) / (2 * h));
}
/** integrál stoupání od 0 do u (výška nad zs) */
function riseTo(s: CoilSpec, u: number): number {
  if (s.ne === 0) return s.pa * u;
  const total = s.n + 2 * s.ne;
  const h = TRANSITION / 2;
  const half = (x: number): number => {
    // výška od 0 do x ≤ total/2
    const a = s.ne - h;
    if (x <= a) return s.pe * x;
    const w = 2 * h;
    if (x <= s.ne + h) return s.pe * x + (s.pa - s.pe) * w * blendInt((x - a) / w);
    return s.pe * (s.ne + h) + (s.pa - s.pe) * w * blendInt(1) + s.pa * (x - (s.ne + h));
  };
  if (u <= total / 2) return half(u);
  return 2 * half(total / 2) - half(total - u);
}
/** bod střednice v úhlu θ (rad, od začátku) */
export function coilPoint(s: CoilSpec, theta: number): Vec3 {
  const u = theta / (2 * Math.PI);
  const a = s.hand * theta;
  return [s.R * Math.cos(a), s.R * Math.sin(a), s.zs + riseTo(s, u)];
}
/** derivace střednice podle θ */
export function coilDeriv(s: CoilSpec, theta: number): Vec3 {
  const u = theta / (2 * Math.PI);
  const a = s.hand * theta;
  return [-s.R * s.hand * Math.sin(a), s.R * s.hand * Math.cos(a), pitchAt(s, u) / (2 * Math.PI)];
}
const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];

/**
 * Úseky střednice tlačné pružiny (hranice = konce přechodů stoupání a každý závit činné části): pro každý úsek parametry θ
 * od–do. Jádro staví jednu B-spline hranu na úsek.
 */
export function compressionSegments(s: CoilSpec): [number, number][] {
  const total = s.n + 2 * s.ne;
  const h = TRANSITION / 2;
  const cuts = new Set<number>([0, total]);
  if (s.ne > 0) for (const c of [s.ne - h, s.ne + h, total - s.ne - h, total - s.ne + h]) if (c > 0 && c < total) cuts.add(c);
  const sorted = [...cuts].sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    // dlouhé úseky po nejvýš jednom závitu (malé B-spline – rychlé tažení)
    const k = Math.max(1, Math.ceil(b - a - 1e-9));
    for (let j = 0; j < k; j++) out.push([2 * Math.PI * (a + ((b - a) * j) / k), 2 * Math.PI * (a + ((b - a) * (j + 1)) / k)]);
  }
  return out;
}

/** Střednice tlačné pružiny jako body (perTurn bodů na závit) – pro síť v pohybové studii a náhled. */
export function compressionPath(s: CoilSpec, perTurn = 24): SpringPath {
  const segs = compressionSegments(s);
  const pts: Vec3[] = [];
  const tangents: Vec3[] = [];
  const seg: number[] = [];
  segs.forEach(([a, b], i) => {
    const k = Math.max(2, Math.ceil(((b - a) / (2 * Math.PI)) * perTurn));
    for (let j = i === 0 ? 0 : 1; j <= k; j++) {
      const t = a + ((b - a) * j) / k;
      pts.push(coilPoint(s, t));
      tangents.push(unit(coilDeriv(s, t)));
      seg.push(i);
    }
  });
  return { pts, tangents, seg, d: s.d, ...(s.ground ? { clip: [0, s.L] as [number, number] } : {}) };
}

// ---------------- obecná dráha z úseků (tažná, zkrutná) ----------------

/** úsek dráhy: body a derivace podle parametru úseku (jádro proloží B-spline s tečnami; přímka = 2 body) */
export type PathPiece = { pts: Vec3[]; ders: Vec3[]; line?: boolean };

/** vzorkování parametrické křivky f(t), t ∈ [0,1] (derivace numericky) */
function sample(f: (t: number) => Vec3, k: number): PathPiece {
  const pts: Vec3[] = [];
  const ders: Vec3[] = [];
  const e = 1e-5;
  for (let j = 0; j <= k; j++) {
    const t = j / k;
    pts.push(f(t));
    const a = f(Math.max(0, t - e));
    const b = f(Math.min(1, t + e));
    ders.push(scale(sub(b, a), 1 / (Math.min(1, t + e) - Math.max(0, t - e))));
  }
  return { pts, ders };
}

/** těsně vinuté tělo: stoupání pe, `turns` závitů od z = z0 */
export function bodySpec(o: { d: number; D: number; turns: number; hand?: "right" | "left"; z0?: number; gap?: number }): CoilSpec {
  const pe = o.d * (1 + (o.gap ?? COIL_GAP));
  return { R: o.D / 2, d: o.d, n: o.turns, ne: 0, zs: o.z0 ?? o.d / 2, L: (o.z0 ?? o.d / 2) * 2 + o.turns * pe, pe, pa: pe, hand: o.hand === "left" ? -1 : 1, ground: false };
}
function bodyPieces(s: CoilSpec): PathPiece[] {
  const out: PathPiece[] = [];
  const total = s.n;
  const k = Math.max(1, Math.ceil(total - 1e-9));
  for (let j = 0; j < k; j++) {
    const a = 2 * Math.PI * ((total * j) / k);
    const b = 2 * Math.PI * ((total * (j + 1)) / k);
    const m = 12;
    const pts: Vec3[] = [];
    const ders: Vec3[] = [];
    for (let i = 0; i <= m; i++) {
      const t = a + ((b - a) * i) / m;
      pts.push(coilPoint(s, t));
      ders.push(scale(coilDeriv(s, t), b - a));
    }
    out.push({ pts, ders });
  }
  return out;
}

/** otočení bodu o 180° kolem vodorovné osy směru `dir` procházející bodem `c` */
function flip180(p: Vec3, c: Vec3, dir: Vec3): Vec3 {
  const v = sub(p, c);
  const along = scale(dir, dot(v, dir));
  return add(c, sub(scale(along, 2), v));
}
function flipVec(v: Vec3, dir: Vec3): Vec3 {
  return sub(scale(dir, 2 * dot(v, dir)), v);
}
/** Kus dráhy na druhém konci těla: otočení o 180° (konec těla → začátek) a obrácení směru průchodu. */
function mirrorPieces(pieces: PathPiece[], c: Vec3, dir: Vec3): PathPiece[] {
  return pieces
    .map((p) => ({ pts: p.pts.map((x) => flip180(x, c, dir)).reverse(), ders: p.ders.map((x) => scale(flipVec(x, dir), -1)).reverse(), ...(p.line ? { line: true } : {}) }))
    .reverse();
}

export type LoopKind = "german" | "half" | "side";
/** Očko tažné pružiny na konci těla (bod konce P, úhel konce φ = hand·θ, tečna T) – kusy dráhy směrem od těla. */
function loopPieces(s: CoilSpec, theta: number, kind: LoopKind): PathPiece[] {
  const P = coilPoint(s, theta);
  const T = unit(coilDeriv(s, theta));
  const R = s.R;
  const zb = P[2];
  const er = (a: number): Vec3 => [Math.cos(a), Math.sin(a), 0];
  const phiEnd = s.hand * theta;
  if (kind === "side") {
    // kruh v tečné rovině posledního závitu (rovina T a „nahoru“ kolmo na T)
    const up0: Vec3 = [0, 0, 1];
    const up = unit(sub(up0, scale(T, dot(up0, T))));
    const rho = R;
    const delta = Math.acos(Math.max(-0.9, 1 - Math.min(1.9, (1.25 * s.d) / rho)));
    const end = 2 * Math.PI - Math.max(0.6, delta);
    return [sample((t) => add(add(P, T, rho * Math.sin(t * end)), up, rho * (1 - Math.cos(t * end))), 36)];
  }
  // německé / poloviční očko: kruh v rovině osy (směr er(φL)), střed v ose ve výšce zc
  const phiL = phiEnd + s.hand * (Math.PI / 2);
  const rho = R;
  const zc = zb + (kind === "german" ? rho : rho * 0.5);
  const rise = zc - zb;
  // přechod po válci: úhel φ(t) = φEnd + hand·(π/2)·(2t − t²), výška h(t) Hermite (sklon na začátku = sklon šroubovice)
  const slope = s.pe / (2 * Math.PI); // dz/dθ
  const a = (slope * Math.PI) / rise; // h'(0) (dθ/dt = π na začátku)
  const b = 1.6;
  const h = (t: number) => (t ** 3 - 2 * t * t + t) * a + (-2 * t ** 3 + 3 * t * t) + (t ** 3 - t * t) * b;
  const trans = sample((t) => {
    const ph = phiEnd + s.hand * (Math.PI / 2) * (2 * t - t * t);
    return [R * Math.cos(ph), R * Math.sin(ph), zb + rise * h(t)];
  }, 16);
  const ringEnd = kind === "german" ? (3 * Math.PI) / 2 - 0.2 : Math.PI;
  const e = er(phiL);
  const ring = sample((t) => {
    const f = t * ringEnd;
    return [rho * Math.cos(f) * e[0], rho * Math.cos(f) * e[1], zc + rho * Math.sin(f)];
  }, 32);
  return [trans, ring];
}

export type SpringPieces = { pieces: PathPiece[]; d: number; clip?: [number, number] };

/**
 * Tažná pružina: tělo `turns` závitů (mezera mezi závity 1 % drátu), první očko `loop` dole, druhé `loop2` nahoře. Celá dráha
 * je posunutá tak, že vnitřní okraj spodního očka (bod zavěšení) leží v z = 0 – vnitřní okraj horního očka je pak ve výšce
 * L0 (= Lk + LH1 + LH2, s odchylkou 0,01 · n · d kvůli mezeře).
 */
export function extensionPieces(o: { d: number; D: number; turns: number; loop: LoopKind; loop2?: LoopKind; hand?: "right" | "left" }): SpringPieces & { body: CoilSpec; free: number } {
  const s = bodySpec({ d: o.d, D: o.D, turns: o.turns, hand: o.hand, gap: 0.01 });
  const theta = 2 * Math.PI * o.turns;
  const top = loopPieces(s, theta, o.loop2 ?? o.loop);
  const zm = (s.zs + coilPoint(s, theta)[2]) / 2;
  const mid = s.hand * (theta / 2);
  const dir: Vec3 = [Math.cos(mid), Math.sin(mid), 0];
  const bottom = mirrorPieces(loopPieces(s, theta, o.loop), [0, 0, zm], dir);
  const zMin = Math.min(...bottom.flatMap((p) => p.pts.map((x) => x[2])));
  const zMax = Math.max(...top.flatMap((p) => p.pts.map((x) => x[2])));
  const shift = -(zMin + o.d / 2);
  const mv = (p: PathPiece): PathPiece => ({ ...p, pts: p.pts.map((x) => [x[0], x[1], x[2] + shift] as Vec3) });
  return { pieces: [...bottom, ...bodyPieces(s), ...top].map(mv), d: o.d, body: { ...s, zs: s.zs + shift }, free: zMax - o.d / 2 + shift };
}

export type LegKind = "tangential" | "radial" | "axial";
/** rameno zkrutné pružiny na konci těla: ohyb (poloměr = drát) a přímý úsek délky `len` */
function legPieces(s: CoilSpec, theta: number, kind: LegKind, len: number): PathPiece[] {
  const P = coilPoint(s, theta);
  const T = unit(coilDeriv(s, theta));
  const out: PathPiece[] = [];
  let start = P;
  let dirv = T;
  if (kind !== "tangential") {
    const ph = s.hand * theta;
    const U: Vec3 = kind === "radial" ? [Math.cos(ph), Math.sin(ph), 0] : [0, 0, 1];
    const Nn = unit(sub(U, scale(T, dot(U, T))));
    const ang = Math.acos(Math.max(-1, Math.min(1, dot(T, U))));
    const rb = s.d * 1.5;
    const C = add(P, Nn, rb);
    out.push(sample((t) => {
      const f = t * ang;
      return add(add(C, Nn, -rb * Math.cos(f)), T, rb * Math.sin(f));
    }, 10));
    start = add(add(C, Nn, -rb * Math.cos(ang)), T, rb * Math.sin(ang));
    dirv = unit(add(scale(Nn, Math.sin(ang)), T, Math.cos(ang)));
  }
  const end = add(start, dirv, Math.max(len, s.d));
  out.push({ pts: [start, end], ders: [scale(dirv, len), scale(dirv, len)], line: true });
  return out;
}

/** Zkrutná pružina: tělo `turns` závitů, ramena na obou koncích. */
export function torsionPieces(o: { d: number; D: number; turns: number; leg1: LegKind; leg2: LegKind; l1: number; l2: number; hand?: "right" | "left"; gap?: number }): SpringPieces & { body: CoilSpec } {
  const s = bodySpec({ d: o.d, D: o.D, turns: o.turns, hand: o.hand, gap: o.gap });
  const theta = 2 * Math.PI * o.turns;
  const zm = (s.zs + coilPoint(s, theta)[2]) / 2;
  const mid = s.hand * (theta / 2);
  const dir: Vec3 = [Math.cos(mid), Math.sin(mid), 0];
  // rameno 1 na začátku = rameno postavené na konci a otočené
  const first = mirrorPieces(legPieces(s, theta, o.leg1, o.l1), [0, 0, zm], dir);
  const last = legPieces(s, theta, o.leg2, o.l2);
  return { pieces: [...first, ...bodyPieces(s), ...last], d: o.d, body: s };
}

/** všechny body kusů za sebou (síť / náhled / testy) */
export function piecesPath(sp: SpringPieces): SpringPath {
  const pts: Vec3[] = [];
  const tangents: Vec3[] = [];
  const seg: number[] = [];
  sp.pieces.forEach((p, i) => {
    p.pts.forEach((x, j) => {
      if (i > 0 && j === 0) return;
      pts.push(x);
      tangents.push(unit(p.ders[j]));
      seg.push(i);
    });
  });
  return { pts, tangents, seg, d: sp.d, ...(sp.clip ? { clip: sp.clip } : {}) };
}

/** délka střednice (součet úseček mezi body – při 24 bodech na závit chyba < 0,1 %) */
export function pathLength(p: SpringPath): number {
  let L = 0;
  for (let i = 1; i < p.pts.length; i++) L += Math.hypot(p.pts[i][0] - p.pts[i - 1][0], p.pts[i][1] - p.pts[i - 1][1], p.pts[i][2] - p.pts[i - 1][2]);
  return L;
}

/** Talíř DIN 2093 jako průřez (r, z) – čtyřúhelník; `up` = kužel vrcholem nahoru (vnitřní okraj výš). */
export function discSection(o: { De: number; Di: number; t: number; h0: number; z: number; up: boolean }): [number, number][] {
  const { De, Di, t, h0, z } = o;
  return o.up
    ? [[Di / 2, z + h0], [De / 2, z], [De / 2, z + t], [Di / 2, z + h0 + t]]
    : [[Di / 2, z], [De / 2, z + h0], [De / 2, z + h0 + t], [Di / 2, z + t]];
}
