/**
 * Kontrolní rozměry ozubení (DIN 3960 / ISO 21771): rozměr přes k zubů W_k, rozměr přes kuličky / válečky M_dK,
 * tloušťka zubu na tětivě; řetězová kola: rozměr přes válečky M_R; hřeben: rozměr přes váleček v mezeře.
 */
import type { CylGeom, CylInput } from "./involute";
import { DEG, inv, invInverse } from "./num";

/** výchozí průměr měřicí kuličky: 1,728·mₙ zaokrouhleno na 0,25 mm */
export const ballAuto = (m: number) => Math.max(0.25, Math.round((1.728 * m) / 0.25) * 0.25);

/**
 * Počet zubů přes které se měří (DIN 3960): k = round(z/π·[tan α_vt / cos²β_b − 2·x·tan α_n / z − inv α_t] + 0,5),
 * α_vt = acos(d_b / (d + 2·x·mₙ)).
 */
export function spanTeeth(i: CylInput, g: CylGeom): { k: number; raw: number } {
  const avt = Math.acos(Math.min(1, g.db / (g.d + 2 * i.x * i.m)));
  const raw = (i.z / Math.PI) * (Math.tan(avt) / Math.cos(g.bb) ** 2 - (2 * i.x * Math.tan(g.an)) / i.z - inv(g.at)) + 0.5;
  return { k: Math.max(2, Math.round(raw)), raw };
}
/** W_k = mₙ·cos α_n·[(k − 0,5)·π + z·inv α_t] + 2·x·mₙ·sin α_n + A_sn·cos α_n (DIN 3960) */
export function spanW(i: CylInput, g: CylGeom, k: number): number {
  return i.m * Math.cos(g.an) * ((k - 0.5) * Math.PI + i.z * inv(g.at)) + 2 * i.x * i.m * Math.sin(g.an) + g.asn * Math.cos(g.an);
}
/** lze W_k na šikmém kole změřit? potřebná šířka b ≥ W_k·sin β_b + 1,2·mₙ */
export const spanMeasurable = (i: CylInput, g: CylGeom, W: number, b: number) => g.be < 1e-9 || b >= W * Math.sin(g.bb) + 1.2 * i.m;

/**
 * Rozměr přes kuličky (DIN 3960): inv α_Mt = inv α_t + D_M/(z·mₙ·cos α_n) − (π/2 − 2·x·tan α_n)/z + A_sn/(z·mₙ);
 * d_K = d_b / cos α_Mt; M_dK = d_K + D_M (sudé z), d_K·cos(90°/z) + D_M (liché z).
 * Vnitřní kolo: kulička leží v mezeře věnce, znaménka členů D_M a tloušťky se obrátí a M_dK = d_K − D_M (… − D_M).
 */
export function overBalls(i: CylInput, g: CylGeom, dM: number): { dK: number; M: number; alphaM: number } {
  const sign = i.internal ? -1 : 1;
  const y = inv(g.at) + sign * (dM / (i.z * i.m * Math.cos(g.an)) - (Math.PI / 2 - 2 * (i.internal ? -i.x : i.x) * Math.tan(g.an)) / i.z + g.asn / (i.z * i.m));
  const alphaM = invInverse(y);
  const dK = g.db / Math.cos(alphaM);
  const odd = i.z % 2 === 1 ? Math.cos((90 * DEG) / i.z) : 1;
  return { dK, M: dK * odd + sign * dM, alphaM };
}

/** tloušťka zubu na tětivě roztečné kružnice a výška hlavy nad tětivou (čelní řez, přímé zuby) */
export function chordal(g: CylGeom): { s: number; ha: number } {
  const psi = g.st / g.d;
  return { s: g.d * Math.sin(psi), ha: g.ra - g.r + g.r * (1 - Math.cos(psi)) };
}

/** řetězové kolo: rozměr přes dva válečky Ø d_R v protilehlých mezerách: M_R = d + d_R (sudé z), d·cos(90°/z) + d_R (liché) */
export const sprocketOverPins = (d: number, z: number, dR: number) => (z % 2 === 1 ? d * Math.cos((90 * DEG) / z) : d) + dR;

/** hřeben: výška osy válečku Ø D_M v mezeře nad roztečnou přímkou y = (D_M/(2·cos α) − p_n/4)/tan α; rozměr od dna M = h0 + y + D_M/2 */
export const rackPin = (m: number, alphaDeg: number, dM: number, h0: number, jn = 0) => {
  const a = alphaDeg * DEG;
  const y = (dM / (2 * Math.cos(a)) - (Math.PI * m) / 4 - jn / (2 * Math.cos(a))) / Math.tan(a);
  return { y, M: h0 + y + dM / 2 };
};
