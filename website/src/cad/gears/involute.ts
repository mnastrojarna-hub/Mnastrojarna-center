/**
 * Válcová evolventní kola (čelní, šikmá, šípová, vnitřní) – geometrie podle ISO 21771:2007 / DIN 3960.
 *
 * Čelní profil JEDNÉ rozteče: patní oblouk → přechodová křivka (trochoida obalená zaoblenou hlavou základního hřebene,
 * ρ_fP) → evolventa → hlavový oblouk → zrcadlově zpět. Trochoida: bod Q zaoblení hřebene (v čelní rovině elipsa
 * a = ρ/cos β, b = ρ) je v záběru, když jeho normála prochází valivým bodem → úhel odvalení φ = (Q_ξ − Q_η·n_ξ/n_η)/r,
 * bod kola P = Rot(−φ)·(Q_ξ − r·φ, r + Q_η). Podřezání: trochoida protne evolventu nad základní kružnicí – profil je pak
 * trochoida po průsečík a evolventa od něj (ostrý roh, jak ho nástroj vyrobí).
 * Vnitřní kolo: MEZERA věnce má tvar zubu vnějšího kola se stejným z; zaoblení paty je oblouk 0,3·m (přiblížení – skutečný
 * tvar závisí na obrážecím noži).
 */
import { arcSweep, bisect, clamp, curveSeg, DEG, inv, invInverse, mirrorX, polar, rot2, segGreen, segMirrorRev } from "./num";
import type { RackSpec } from "./rack";
import type { Profile2D, Seg2, Vec2 } from "./types";

export type CylInput = {
  /** normálný modul */
  m: number;
  z: number;
  /** normálný úhel záběru (°) */
  alpha: number;
  x: number;
  /** úhel sklonu na roztečném válci (°), ≥ 0 */
  beta: number;
  rack: RackSpec;
  /** zkrácení hlavy (v modulech) */
  k: number;
  /** boční vůle – podíl kola (ztenčení zubu po normále k boku), mm */
  jn: number;
  internal: boolean;
};
export type CylGeom = {
  an: number;
  at: number;
  be: number;
  bb: number;
  mt: number;
  d: number;
  r: number;
  db: number;
  rb: number;
  da: number;
  ra: number;
  df: number;
  rf: number;
  h: number;
  /** rozteč normálná, čelní, základní čelní */
  pn: number;
  pt: number;
  pbt: number;
  /** stoupání šroubovice (∞ u přímých zubů) */
  pz: number;
  /** tloušťka zubu na roztečném válci: normálná, čelní (vnitřní kolo: zub věnce) */
  sn: number;
  st: number;
  /** poloviční úhel (virtuálního vnějšího) zubu na základní kružnici: s_t/d + inv α_t */
  thetaB: number;
  /** úchylka tloušťky zubu A_sn = −jn / cos α_n */
  asn: number;
  /** mez podřezání x_min a příznak podřezání */
  xMin: number;
  undercut: boolean;
  /** tloušťka zubu na hlavě (normálná); ≤ 0 = špičatý zub */
  san: number;
  thetaA: number;
  /** poloměr začátku evolventy (konec přechodové křivky) a jeho průměr */
  rFf: number;
  dFf: number;
  /** parametr odvalení evolventy t = tan α_y na začátku a na hlavě */
  t0: number;
  tA: number;
  /** polovina úhlu patního oblouku jedné mezery (E/r) */
  rootHalf: number;
  /** přechodová křivka: střed zaoblení hřebene (ξ_c, η_c), poloosy elipsy, rozsah parametru λ */
  xiC: number;
  etaC: number;
  ea: number;
  eb: number;
  lamJ: number;
  lamEnd: number;
  /** vnitřní kolo: hlavová kružnice byla zvětšena nad základní kružnici */
  tipLimited: boolean;
  /** vnitřní kolo: poloměr zaoblení paty (oblouk) */
  rhoI: number;
};

/** bod přechodové křivky (horní bok zubu 0, zub na +X) pro parametr λ zaoblení hřebene */
function trochoid(g: Pick<CylGeom, "xiC" | "etaC" | "ea" | "eb" | "r">, z: number, lam: number): Vec2 {
  const qx = g.xiC + g.ea * Math.cos(lam);
  const qy = g.etaC + g.eb * Math.sin(lam);
  const nx = Math.cos(lam) / g.ea;
  const ny = Math.sin(lam) / g.eb;
  const phi = (qx - (qy * nx) / ny) / g.r;
  const p = rot2([qx - g.r * phi, g.r + qy], -phi);
  return rot2(p, Math.PI / z - Math.PI / 2); // pomocná soustava (+Y = střed mezery) → zub 0 na +X
}

/** poloviční úhel zubu (od osy zubu k boku) na poloměru ry ≥ rb */
export const flankAngle = (g: Pick<CylGeom, "thetaB" | "rb">, ry: number) => g.thetaB - inv(Math.acos(Math.min(1, g.rb / ry)));

/** Všechny odvozené rozměry válcového kola. Nehází – nesmyslné zadání dá NaN / záporné hodnoty, které ohlásí `cylIssues`. */
export function cylGeom(i: CylInput): CylGeom {
  const an = i.alpha * DEG;
  const be = Math.abs(i.beta) * DEG;
  const mt = i.m / Math.cos(be);
  const at = Math.atan(Math.tan(an) / Math.cos(be));
  const d = i.z * mt;
  const r = d / 2;
  const rb = r * Math.cos(at);
  const bb = Math.atan(Math.tan(be) * Math.cos(at));
  const asn = -i.jn / Math.cos(an);
  const pn = Math.PI * i.m;
  const { ha, hf, rho } = i.rack;
  let ra: number;
  let rf: number;
  let sn: number;
  let thetaB: number;
  let tipLimited = false;
  if (!i.internal) {
    ra = r + i.m * (ha + i.x - i.k);
    rf = r - i.m * (hf - i.x);
    sn = i.m * (Math.PI / 2 + 2 * i.x * Math.tan(an)) + asn;
    thetaB = sn / Math.cos(be) / d + inv(at);
  } else {
    // věnec: hlavová kružnice uvnitř, patní vně; mezera = zub vnějšího kola
    ra = r - i.m * (ha - i.x - i.k);
    rf = r + i.m * (hf + i.x);
    if (ra < rb + 0.05 * i.m) {
      ra = rb + 0.05 * i.m;
      tipLimited = true;
    }
    const en = i.m * (Math.PI / 2 + 2 * i.x * Math.tan(an)) - asn; // šířka mezery
    sn = pn - en;
    thetaB = en / Math.cos(be) / d + inv(at);
  }
  const xiC = (Math.PI * i.m) / 4 - asn / 2 - hf * i.m * Math.tan(an) - (rho * i.m * (1 - Math.sin(an))) / Math.cos(an);
  const g: CylGeom = {
    an,
    at,
    be,
    bb,
    mt,
    d,
    r,
    db: 2 * rb,
    rb,
    da: 2 * ra,
    ra,
    df: 2 * rf,
    rf,
    h: Math.abs(ra - rf),
    pn,
    pt: Math.PI * mt,
    pbt: Math.PI * mt * Math.cos(at),
    pz: be > 1e-12 ? (Math.PI * d) / Math.tan(be) : Infinity,
    sn,
    st: sn / Math.cos(be),
    thetaB,
    asn,
    xMin: hf - rho * (1 - Math.sin(an)) - (i.z * Math.sin(at) ** 2) / (2 * Math.cos(be)),
    undercut: false,
    san: 0,
    thetaA: 0,
    rFf: rb,
    dFf: 2 * rb,
    t0: 0,
    tA: 0,
    rootHalf: 0,
    xiC: xiC / Math.cos(be),
    etaC: i.x * i.m - hf * i.m + rho * i.m,
    ea: (rho * i.m) / Math.cos(be),
    eb: rho * i.m,
    lamJ: 0,
    lamEnd: 0,
    tipLimited,
    rhoI: 0,
  };
  const tOf = (ry: number) => Math.tan(Math.acos(Math.min(1, rb / ry)));
  if (i.internal) {
    // virtuální vnější zub = mezera věnce: evolventa od hlavové kružnice věnce (uvnitř) k zaoblení u patní kružnice (vně)
    g.t0 = tOf(ra);
    g.rFf = ra;
    g.dFf = 2 * ra;
    g.thetaA = flankAngle(g, ra); // poloviční úhel mezery na hlavové kružnici věnce
    const ringTooth = Math.PI / i.z - g.thetaA; // poloviční úhel zubu věnce na hlavě
    g.san = 2 * ringTooth * ra * Math.cos(Math.atan((Math.tan(be) * ra) / r));
    // zaoblení paty: oblouk ρ tečný k boku a k patní kružnici; zmenší se, když se do mezery nevejde
    const cAngle = (rho_: number) => {
      const tc = tOf(rf - rho_);
      return -g.thetaB + rho_ / rb + (tc - Math.atan(tc)); // polární úhel středu oblouku u dolního boku (musí být ≤ 0)
    };
    let rhoI = 0.3 * i.m;
    if (!(cAngle(rhoI) <= 0)) rhoI = cAngle(1e-6 * i.m) <= 0 ? bisect(cAngle, 1e-6 * i.m, rhoI) * 0.999 : 0;
    g.rhoI = rhoI;
    g.tA = rhoI > 0 ? tOf(rf - rhoI) + rhoI / rb : tOf(rf);
    g.rootHalf = rhoI > 0 ? -cAngle(rhoI) : Math.max(0, flankAngle(g, rf));
    return g;
  }
  g.undercut = i.x < g.xMin - 1e-9;
  g.rootHalf = g.xiC / r;
  g.lamJ = Math.atan2(-g.eb * Math.sin(at), g.ea * Math.cos(at));
  g.lamEnd = g.lamJ;
  const T = (lam: number) => trochoid(g, i.z, lam);
  let rF = Math.hypot(...T(g.lamJ));
  if (g.undercut) {
    // Podřezání: nad základní kružnicí je trochoida nejdřív UVNITŘ evolventního zubu (nástroj odebral kus boku) a evolventu
    // opouští v bodě průniku – profil je trochoida po tento bod a evolventa od něj. Hledá se poslední přechod znaménka
    // [úhel bodu − úhel evolventy] z ≤ 0 (uvnitř zubu) na > 0 (v mezeře) mezi body nad základní kružnicí.
    const gapAt = (lam: number) => {
      const p = T(lam);
      const ry = Math.hypot(p[0], p[1]);
      return { ry, gap: ry < rb ? NaN : Math.atan2(p[1], p[0]) - flankAngle(g, ry) };
    };
    const N = 400;
    let prev: { lam: number; gap: number } | null = null;
    let cross: [number, number] | null = null;
    let firstAbove: { lam: number; gap: number; prevLam: number } | null = null;
    for (let k = 0; k <= N; k++) {
      const lam = -Math.PI / 2 + ((g.lamJ + Math.PI / 2) * k) / N;
      const { gap } = gapAt(lam);
      if (!Number.isFinite(gap)) {
        prev = null;
        continue;
      }
      if (!firstAbove) firstAbove = { lam, gap, prevLam: k > 0 ? -Math.PI / 2 + ((g.lamJ + Math.PI / 2) * (k - 1)) / N : lam };
      if (prev && prev.gap <= 0 && gap > 0) cross = [prev.lam, lam];
      prev = { lam, gap };
    }
    if (cross) {
      let [lo, hi] = cross;
      for (let s = 0; s < 80; s++) {
        const mid = (lo + hi) / 2;
        if (gapAt(mid).gap > 0) hi = mid;
        else lo = mid;
      }
      g.lamEnd = lo;
      rF = Math.max(rb, gapAt(lo).ry);
    } else if (firstAbove && firstAbove.gap > 0) {
      // trochoida prochází základní kružnicí v mezeře a bok už nezasáhne: přechodová křivka končí na základní kružnici
      let lo = firstAbove.prevLam;
      let hi = firstAbove.lam;
      for (let s = 0; s < 80; s++) {
        const mid = (lo + hi) / 2;
        if (gapAt(mid).ry < rb) lo = mid;
        else hi = mid;
      }
      g.lamEnd = hi;
      rF = rb;
    } else rF = Math.max(rb, rF);
  }
  g.rFf = Math.max(rb, rF);
  g.dFf = 2 * g.rFf;
  g.t0 = Math.max(tOf(g.rFf), 1e-3);
  g.tA = tOf(ra);
  g.thetaA = flankAngle(g, ra);
  const betaA = Math.atan((Math.tan(be) * ra) / r);
  g.san = 2 * g.thetaA * ra * Math.cos(betaA);
  return g;
}

/** poloměr, na kterém by se boky zubu sešly do špičky */
export const pointedRadius = (g: Pick<CylGeom, "thetaB" | "rb">) => g.rb / Math.cos(invInverse(g.thetaB));

const involuteN = (t0: number, t1: number) => clamp(Math.ceil(Math.abs(t1 - t0) / 0.05), 8, 16);

/**
 * Čelní profil jedné rozteče (zub 0 na +X; vnitřní kolo: mezera 0 na +X – obrys otvoru věnce).
 * `over` > 0: boky pokračují o `over`·m nad hlavovou kružnici (nejvýš téměř do špičky) – pro objem zubu, který se pak
 * ořízne soustruženým polotovarem (šikmá, šneková kola).
 */
export function cylProfile(i: CylInput, g: CylGeom, o: { over?: number } = {}): Profile2D {
  const z = i.z;
  const half = Math.PI / z;
  const segs: Seg2[] = [];
  const lowInv = (t: number): Vec2 => rot2([g.rb * (Math.cos(t) + t * Math.sin(t)), g.rb * (Math.sin(t) - t * Math.cos(t))], -g.thetaB);
  const lowInvD = (t: number): Vec2 => rot2([g.rb * t * Math.cos(t), g.rb * t * Math.sin(t)], -g.thetaB);
  if (i.internal) {
    // obrys otvoru věnce = „zub“ virtuálního vnějšího kola: hlavová kružnice věnce (uvnitř) → bok → zaoblení → patní kružnice (vně)
    const aTip = g.thetaA;
    if (half - aTip > 1e-9) segs.push({ t: "arc", c: [0, 0], r: g.ra, a0: -half, a1: -aTip, ccw: true });
    const flank = curveSeg("involute", lowInv, g.t0, g.tA, involuteN(g.t0, g.tA), lowInvD);
    segs.push(flank);
    const mid: Seg2[] = [];
    if (g.rhoI > 0) {
      const cA = -g.rootHalf;
      const c = polar(g.rf - g.rhoI, cA);
      const p = flank.pts[flank.pts.length - 1];
      mid.push({ t: "arc", c, r: g.rhoI, a0: Math.atan2(p[1] - c[1], p[0] - c[0]), a1: cA, ccw: true });
    }
    segs.push(...mid);
    if (g.rootHalf > 1e-9) segs.push({ t: "arc", c: [0, 0], r: g.rf, a0: -g.rootHalf, a1: g.rootHalf, ccw: true });
    segs.push(...mid.map(segMirrorRev).reverse(), segMirrorRev(flank));
    if (half - aTip > 1e-9) segs.push({ t: "arc", c: [0, 0], r: g.ra, a0: aTip, a1: half, ccw: true });
    return { tooth: segs, count: z, circles: { ref: g.d, tip: g.da, root: g.df, base: g.db, form: g.dFf }, area: z * segs.reduce((s, x) => s + segGreen(x), 0) };
  }
  let ra = g.ra;
  if (o.over) ra = Math.min(g.ra + o.over * i.m, g.ra + 0.9 * Math.max(0, pointedRadius(g) - g.ra));
  const tA = Math.tan(Math.acos(Math.min(1, g.rb / ra)));
  const thA = flankAngle(g, ra);
  const up = (lam: number) => trochoid(g, z, lam);
  const fillet = curveSeg("trochoid", (lam) => mirrorX(up(lam)), -Math.PI / 2, g.lamEnd, 16);
  const flank = curveSeg("involute", lowInv, g.t0, tA, involuteN(g.t0, tA), lowInvD);
  fillet.pts[fillet.pts.length - 1] = flank.pts[0]; // konec přechodové křivky přesně na začátek evolventy (rozdíl < 1e-9 mm)
  const rootArc = g.rootHalf > 1e-9;
  if (rootArc) segs.push({ t: "arc", c: [0, 0], r: g.rf, a0: -half, a1: -half + g.rootHalf, ccw: true });
  segs.push(fillet, flank);
  if (thA > 1e-9) segs.push({ t: "arc", c: [0, 0], r: ra, a0: -thA, a1: thA, ccw: true });
  segs.push(segMirrorRev(flank), segMirrorRev(fillet));
  if (rootArc) segs.push({ t: "arc", c: [0, 0], r: g.rf, a0: half - g.rootHalf, a1: half, ccw: true });
  return { tooth: segs, count: z, circles: { ref: g.d, tip: 2 * ra, root: g.df, base: g.db, form: g.dFf }, area: z * segs.reduce((s, x) => s + segGreen(x), 0) };
}

/** délka oblouku (pro kontrolu krátkých hran) */
export const arcLen = (s: Extract<Seg2, { t: "arc" }>) => Math.abs(arcSweep(s)) * s.r;
