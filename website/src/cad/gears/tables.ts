/**
 * Tabulky ozubení: moduly ISO 54 (řada I), řetězy ISO 606 (typ B evropský, ANSI) s příčnou roztečí p_t a výškou destičky h2,
 * pera DIN 6885-1 (z knihovny normálií), ozubené řemeny HTD (ISO 13050) a T (DIN 7721), závity stavěcích šroubů.
 */
import { CHAINS as LIB_CHAINS, HTD, KEYS, keyForShaft } from "../library/tables";

export { HTD, KEYS, keyForShaft };

/** moduly ISO 54, řada I (doporučená) */
export const MODULES = [0.5, 0.6, 0.8, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 16, 20];

export type Chain = { p: number; d1: number; b1: number; pt: number; h2: number };
/**
 * Válečkové řetězy ISO 606: rozteč p, průměr válečku d1, vnitřní šířka b1 (z knihovny normálií), příčná rozteč p_t
 * (víceřadé řetězy) a výška vnitřní destičky h2 (pro největší průměr náboje). ANSI: 35 = 06C (pouzdrový), 40 = 08A,
 * 50 = 10A, 60 = 12A, 80 = 16A. 05B a 35 nemají v normě u víceřadého provedení stejnou řadu jako ostatní – p_t je orientační.
 */
const EXTRA: Record<string, { pt: number; h2: number }> = {
  "05B": { pt: 5.64, h2: 7.11 },
  "06B": { pt: 10.24, h2: 8.26 },
  "08B": { pt: 13.92, h2: 11.81 },
  "10B": { pt: 16.59, h2: 14.73 },
  "12B": { pt: 19.46, h2: 16.13 },
  "16B": { pt: 31.88, h2: 21.08 },
  "20B": { pt: 36.45, h2: 26.42 },
  "24B": { pt: 48.36, h2: 33.4 },
  "35": { pt: 10.13, h2: 9.06 },
  "40": { pt: 14.38, h2: 12.07 },
  "50": { pt: 18.11, h2: 15.09 },
  "60": { pt: 22.78, h2: 18.08 },
  "80": { pt: 29.29, h2: 24.13 },
};
export const CHAINS: Record<string, Chain> = Object.fromEntries(Object.entries(LIB_CHAINS).map(([k, v]) => [k, { ...v, ...EXTRA[k] }]));
export const CHAIN_NAMES = Object.keys(CHAINS);

/**
 * Ozubené řemeny s lichoběžníkovým zubem T (DIN 7721-2, drážka tvaru SE): rozteč p, šířka drážky u dna b_r, hloubka drážky
 * h_g, úhel drážky 2φ (°), zaoblení dna a hlavy, rozdíl roztečného a hlavového průměru 2u (d_a = d_0 − 2u).
 * AT5 a GT2 zde nejsou: tvar drážky je firemní a hodnoty nebylo možné ověřit podle normy.
 */
export const TBELTS: Record<string, { p: number; br: number; hg: number; phi: number; rb: number; rt: number; u2: number }> = {
  T5: { p: 5, br: 2.65, hg: 1.25, phi: 40, rb: 0.4, rt: 0.6, u2: 0.85 },
  T10: { p: 10, br: 5.3, hg: 2.6, phi: 40, rb: 0.6, rt: 0.8, u2: 1.85 },
};
export const BELT_NAMES = [...Object.keys(HTD), ...Object.keys(TBELTS)];

/** stavěcí šroub: závit → průměr vrtáku pro závit (ISO 2306) */
export const SET_SCREWS: Record<string, number> = { M3: 2.5, M4: 3.3, M5: 4.2, M6: 5, M8: 6.8, M10: 8.5, M12: 10.2 };
