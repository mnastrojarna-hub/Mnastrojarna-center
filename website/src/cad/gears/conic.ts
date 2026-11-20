/**
 * Kuželová ozubení (kuželové s přímými a zakřivenými zuby, hypoidní) – geometrie jednoho členu na jeho vlastním
 * roztečném kuželi a mřížky bodů pro záplaty boků.
 *
 * Soustava členu: osa +Z míří od zadního (velkého) konce k vrcholu roztečného kužele, vrchol leží v `apexZ` na ose,
 * tělo je pod vrcholem. Bod o vzdálenosti R od vrcholu po površce kužele leží na „řezu“ = kuželi kolmém na roztečný
 * kužel (doplňkový kužel): bod boku se směrem u (polární úhel Θ) je ve vzdálenosti s = R / cos(Θ − δ) od vrcholu.
 *
 * Bok = sférická evolventa: základní kužel sin δ_b = sin δ·cos α_t; pro úhel odvalení φ je γ = φ·sin δ_b,
 * polární úhel Θ(φ) = acos(cos δ_b·cos γ), azimut θ(φ) = φ − atan(tan γ / sin δ_b); azimut boku od osy zubu
 * = ψ + θ(φ_p) − θ(φ), kde φ_p je odvalení na roztečném kuželi. Přímé zuby: výšky úměrné R (společný vrchol) – boky jsou
 * přesné kužele. Zakřivené zuby (D11): stálá výška zubu, stopa zubu kruhový oblouk nástroje r_c:
 * sin β(R) = [2·R_m·r_c·sin β_m − R_m² + R²] / (2·R·r_c), pootočení Δ(R) = (1/sin δ)·∫ tan β(ρ)/ρ dρ – jmenovitá plocha,
 * NE obálková (Gleason / Klingelnberg). Přechod do paty je kuželosečka (přiblížení).
 */
import { DEG, clamp } from "./num";
import type { PatchGridData, PatchGroup, Vec2 } from "./types";
import type { Vec3 } from "../types";

export type ConeMember = {
  z: number;
  /** úhel roztečného kužele (rad) */
  delta: number;
  /** vzdálenost vnějšího (velkého) konce od vrcholu a šířka ozubení po površce */
  Re: number;
  b: number;
  /**
   * střední úhel sklonu (rad; 0 = přímé zuby), smysl stopy, poloměr nástroje. Smysl: +1 = vnější polovina zubu (R > R_m)
   * pootočená kolem osy kola proti směru hodin při pohledu od vrcholu = LEVÝ zub podle ISO 23509 / AGMA; −1 = PRAVÝ.
   */
  betaM: number;
  hand: 1 | -1;
  rc: number;
  /** normálný úhel záběru (rad) */
  alphaN: number;
  /** true: výšky úměrné R (zadané na vnějším konci); false: stálá výška */
  taper: boolean;
  ha: number;
  hf: number;
  /** poloviční úhel zubu na roztečném kuželi (azimut kolem osy kola, rad) */
  psi: number;
  /** tloušťka těla pod patou zubu na velkém konci (po doplňkovém kuželi) */
  rim: number;
  /** poloha vrcholu roztečného kužele na ose (v soustavě dílu) */
  apexZ: number;
};

export type ConeGeom = {
  Ri: number;
  Rm: number;
  /** čelní úhel záběru na středu a úhel základního kužele na středu (rad) */
  alphaT: number;
  deltaB: number;
  /** úhly hlavového a patního kužele (rad) – u stálé výšky na vnějším konci */
  deltaA: number;
  deltaF: number;
  /** vnější průměry: roztečný, hlavový */
  de: number;
  dae: number;
  /** rovina zadního a předního čela (z) a poloměry, kde na ně navazují doplňkové kužely */
  zBack: number;
  zFront: number;
  rBack: number;
  rFront: number;
  /** úhel sklonu na vnějším a vnitřním konci (rad) */
  betaE: number;
  betaI: number;
  /** jde stopa zubu postavit? (|sin β| < 1 po celé šířce) */
  traceOk: boolean;
  /** tloušťka zubu na hlavě na vnějším / vnitřním konci (mm; ≤ 0 = špičatý) */
  tipE: number;
  tipI: number;
  /** šířka dna mezery, která zbyla po přechodových křivkách (mm; ≤ 0 = mezera je příliš úzká) */
  rootE: number;
  rootI: number;
};

const sinBeta = (m: ConeMember, Rm: number, R: number) => (m.betaM === 0 ? 0 : (2 * Rm * m.rc * Math.sin(m.betaM) - Rm * Rm + R * R) / (2 * R * m.rc));
/** úhel sklonu stopy zubu ve vzdálenosti R od vrcholu */
export const spiralAt = (m: ConeMember, R: number) => Math.asin(clamp(sinBeta(m, m.Re - m.b / 2, R), -0.999, 0.999));
/** pootočení čelního profilu kolem osy kola ve vzdálenosti R vůči středu šířky (rad, se znaménkem smyslu) */
export function traceTurn(m: ConeMember, R: number): number {
  if (m.betaM === 0) return 0;
  const Rm = m.Re - m.b / 2;
  const f = (r: number) => Math.tan(spiralAt(m, r)) / r;
  const n = 24;
  const h = (R - Rm) / n;
  let s = f(Rm) + f(R);
  for (let k = 1; k < n; k++) s += (k % 2 ? 4 : 2) * f(Rm + k * h);
  return (m.hand * ((s * h) / 3)) / Math.sin(m.delta);
}

/** profil zubu v řezu R: úseky v rozvinuté mapě (x = azimut·sin δ, y = Θ − δ), dolní polovina zubu od středu mezery po hlavu */
type ChartSeg = { n: number; at: (u: number) => Vec2; d: (u: number) => Vec2 };
function stationProfile(m: ConeMember, R: number): { segs: ChartSeg[]; tip: number; root: number } {
  const sd = Math.sin(m.delta);
  const k = m.taper ? R / m.Re : 1;
  const ya = Math.atan((m.ha * k) / R);
  const yf = -Math.atan((m.hf * k) / R);
  const at = Math.atan(Math.tan(m.alphaN) / Math.cos(spiralAt(m, R)));
  const db = Math.asin(sd * Math.cos(at));
  const sb = Math.sin(db);
  const phiOf = (th: number) => Math.acos(clamp(Math.cos(th) / Math.cos(db), -1, 1)) / sb;
  const az = (phi: number) => phi - Math.atan(Math.tan(phi * sb) / sb);
  const phiP = phiOf(m.delta);
  const flank = (phi: number): Vec2 => [-(m.psi + az(phiP) - az(phi)) * sd, Math.acos(Math.cos(db) * Math.cos(phi * sb)) - m.delta];
  const yb = db - m.delta;
  const yF = Math.max(yb + 0.01 * (ya - yb), yf + 0.2 * -yf);
  const phiF = phiOf(m.delta + yF);
  const phiA = phiOf(m.delta + ya);
  const dphi = (phi: number): Vec2 => {
    const h = 1e-6;
    const p = flank(phi + h);
    const q = flank(phi - h);
    return [(p[0] - q[0]) / (2 * h), (p[1] - q[1]) / (2 * h)];
  };
  const F = flank(phiF);
  const tF = dphi(phiF);
  const xc = -(Math.PI / m.z) * sd; // střed mezery
  const C: Vec2 = [F[0] - (tF[0] * (F[1] - yf)) / tF[1], yf];
  const lenCF = Math.hypot(F[0] - C[0], F[1] - C[1]);
  const room = C[0] - xc;
  const L = Math.min(lenCF, 0.8 * room);
  const T: Vec2 = [C[0] - L, yf];
  const A = flank(phiA);
  const lin = (p: Vec2, q: Vec2, n: number): ChartSeg => ({ n, at: (u) => [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u], d: () => [q[0] - p[0], q[1] - p[1]] });
  const segs: ChartSeg[] = [
    lin([xc, yf], T, 2),
    { n: 6, at: (u) => [(1 - u) * (1 - u) * T[0] + 2 * u * (1 - u) * C[0] + u * u * F[0], (1 - u) * (1 - u) * T[1] + 2 * u * (1 - u) * C[1] + u * u * F[1]], d: (u) => [2 * (1 - u) * (C[0] - T[0]) + 2 * u * (F[0] - C[0]), 2 * (1 - u) * (C[1] - T[1]) + 2 * u * (F[1] - C[1])] },
    { n: 10, at: (u) => flank(phiF + u * (phiA - phiF)), d: (u) => { const t = dphi(phiF + u * (phiA - phiF)); return [t[0] * (phiA - phiF), t[1] * (phiA - phiF)]; } },
    lin(A, [0, ya], 2),
  ];
  // tloušťka na hlavě a šířka dna v mm (oblouk v mapě × vzdálenost od vrcholu)
  return { segs, tip: -2 * A[0] * R, root: 2 * (room - L) * R };
}

/** zrcadlová (horní) polovina zubu: úseky v opačném pořadí i směru, x → −x */
const mirrored = (segs: ChartSeg[]): ChartSeg[] => [...segs].reverse().map((s) => ({ n: s.n, at: (u: number) => { const p = s.at(1 - u); return [-p[0], p[1]] as Vec2; }, d: (u: number) => { const t = s.d(1 - u); return [t[0], -t[1]] as Vec2; } }));

export function coneGeom(m: ConeMember): ConeGeom {
  const Ri = m.Re - m.b;
  const Rm = m.Re - m.b / 2;
  const sd = Math.sin(m.delta);
  const cd = Math.cos(m.delta);
  const alphaT = Math.atan(Math.tan(m.alphaN) / Math.cos(m.betaM));
  const kI = m.taper ? Ri / m.Re : 1;
  const sE = m.betaM === 0 ? 0 : sinBeta(m, Rm, m.Re);
  const sI = m.betaM === 0 ? 0 : sinBeta(m, Rm, Ri);
  const traceOk = Math.abs(sE) < 0.985 && Math.abs(sI) < 0.985 && Ri > 0;
  const pe = traceOk ? stationProfile(m, m.Re) : { tip: 0, root: 0 };
  const pi = traceOk ? stationProfile(m, Ri) : { tip: 0, root: 0 };
  return {
    Ri,
    Rm,
    alphaT,
    deltaB: Math.asin(sd * Math.cos(alphaT)),
    deltaA: m.delta + Math.atan(m.ha / m.Re),
    deltaF: m.delta - Math.atan(m.hf / m.Re),
    de: 2 * m.Re * sd,
    dae: 2 * (m.Re * sd + m.ha * cd),
    zBack: m.apexZ - m.Re * cd - (m.hf + m.rim) * sd,
    zFront: m.apexZ - Ri * cd - (m.hf * kI + m.rim * (Ri / m.Re)) * sd,
    rBack: m.Re * sd - (m.hf + m.rim) * cd,
    rFront: Ri * sd - (m.hf * kI + m.rim * (Ri / m.Re)) * cd,
    betaE: Math.asin(clamp(sE, -1, 1)),
    betaI: Math.asin(clamp(sI, -1, 1)),
    traceOk,
    tipE: pe.tip,
    tipI: pi.tip,
    rootE: pe.root,
    rootI: pi.root,
  };
}

/** vzdálenosti řezů od vrcholu (od velkého konce k malému): přímé zuby 2 (přímková plocha), zakřivené 9 */
export const coneStations = (m: ConeMember): number[] => {
  const n = m.betaM === 0 ? 1 : 8;
  return Array.from({ length: n + 1 }, (_, j) => m.Re - (m.b * j) / n);
};

/**
 * Mřížky záplat jednoho zubu: pás doplňkového kužele na velkém konci (od rovinného zadního čela k obrysu zubů), boky
 * (řezy od velkého konce k malému), pás na malém konci (k rovinnému přednímu čelu). První a poslední řada leží v rovinách
 * z = konst. – víka tělesa jsou rovinná.
 */
export function coneGroups(m: ConeMember): PatchGroup[] {
  const g = coneGeom(m);
  const sd = Math.sin(m.delta);
  const cd = Math.cos(m.delta);
  const Rs = coneStations(m);
  const turn = Rs.map((R) => traceTurn(m, R));
  /** bod řezu R pro bod mapy (x, y) */
  const station = (R: number, rot: number) => (p: Vec2): Vec3 => {
    const th = m.delta + p[1];
    const a = p[0] / sd + rot;
    const s = R / Math.cos(p[1]);
    return [s * Math.sin(th) * Math.cos(a), s * Math.sin(th) * Math.sin(a), m.apexZ - s * Math.cos(th)];
  };
  /** průmět bodu řezu po površce doplňkového kužele do roviny z = zp */
  const onPlane = (R: number, rot: number, zp: number) => {
    const st = station(R, rot);
    return (p: Vec2): Vec3 => {
      const q = st(p);
      const a = p[0] / sd + rot;
      const t = (q[2] - zp) / sd;
      return [q[0] - t * cd * Math.cos(a), q[1] - t * cd * Math.sin(a), zp];
    };
  };
  const profs = Rs.map((R) => {
    const low = stationProfile(m, R).segs;
    return [...low, ...mirrored(low)];
  });
  const nSeg = profs[0].length;
  const grid = (maps: ((p: Vec2) => Vec3)[], prof: (j: number) => ChartSeg[], k: number): PatchGridData => {
    const n = prof(0)[k].n;
    const tu = Array.from({ length: n + 1 }, (_, i) => i / n);
    const rows: Vec3[][] = [];
    const d0: Vec3[] = [];
    const d1: Vec3[] = [];
    maps.forEach((mp, j) => {
      const s = prof(j)[k];
      rows.push(tu.map((u) => mp(s.at(u))));
      const tan = (u: number): Vec3 => {
        const p = s.at(u);
        const t = s.d(u);
        const e = 1e-6;
        const a = mp([p[0] + e * t[0], p[1] + e * t[1]]);
        const c = mp([p[0] - e * t[0], p[1] - e * t[1]]);
        return [(a[0] - c[0]) / (2 * e), (a[1] - c[1]) / (2 * e), (a[2] - c[2]) / (2 * e)];
      };
      d0.push(tan(0));
      d1.push(tan(1));
    });
    return { rows, tu, d0, d1 };
  };
  const last = Rs.length - 1;
  const segIdx = Array.from({ length: nSeg }, (_, k) => k);
  const heel: PatchGroup = { grids: segIdx.map((k) => grid([onPlane(Rs[0], turn[0], g.zBack), station(Rs[0], turn[0])], () => profs[0], k)), tv: [0, 1] };
  const teeth: PatchGroup = { grids: segIdx.map((k) => grid(Rs.map((R, j) => station(R, turn[j])), (j) => profs[j], k)), tv: Rs.map((R) => m.Re - R) };
  const toe: PatchGroup = { grids: segIdx.map((k) => grid([station(Rs[last], turn[last]), onPlane(Rs[last], turn[last], g.zFront)], () => profs[last], k)), tv: [0, 1] };
  return [heel, teeth, toe];
}

/** jednotkový vektor sférické evolventy (osa z, úhel základního kužele δ_b, odvalení φ) – pro testy */
export function sphericalInvolute(deltaB: number, phi: number): Vec3 {
  const sb = Math.sin(deltaB);
  const g = phi * sb;
  return [sb * Math.cos(g) * Math.cos(phi) + Math.sin(g) * Math.sin(phi), sb * Math.cos(g) * Math.sin(phi) - Math.sin(g) * Math.cos(phi), Math.cos(deltaB) * Math.cos(g)];
}
export { DEG };
