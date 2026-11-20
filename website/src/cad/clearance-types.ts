/**
 * Smlouva operace jádra `clearance` (vlna 22, bod 6 – vůle a spojitá kontrola kolizí v pohybu): požadavek a odpověď bez
 * závislosti na OCCT, sdílené hlavním vláknem (cad/motion-clearance.ts) a jádrem (cad/clearance-kernel.ts).
 *
 * Sestava se posílá jednou (poloha 0 = umístění komponent v dokumentu); další polohy (`poses`) jsou jen umístění komponent nejvyšší
 * úrovně – listy podsestav se pohnou s nimi (tuhá podsestava, stejně jako v pohybové studii).
 */
import type { CadDoc, Placement, Vec3 } from "./types";

/** umístění komponent nejvyšší úrovně (id → umístění); chybějící komponenta = umístění z dokumentu */
export type ClrPose = Record<string, Placement>;

/** dvojice komponent nejvyšší úrovně (id) */
export type ClrPair = { a: string; b: string };

export type ClrReq = {
  /** sestava v poloze 0 (geometrie dílů a umístění) */
  doc: CadDoc;
  /** další polohy (index 1…; `pose: 0` = dokument) */
  poses?: ClrPose[];
  /** místní obálky komponent nejvyšší úrovně (koule a kvádr ve vlastních souřadnicích komponenty) */
  local?: string[];
  /** nejmenší vzdálenost dvojice v poloze `pose`; nad `cutoff` stačí dolní mez z obálek (přesně se nepočítá) */
  dist?: (ClrPair & { pose: number; cutoff?: number })[];
  /**
   * spojitá kontrola úseku `from` → `to`: je-li vzájemný pohyb dvojice čistý posuv, nejmenší vzdálenost A od dráhy B
   * (B ∪ hranoly ploch B posunuté o vektor) – přesná nejmenší vůle po celé přímé dráze
   */
  sweep?: (ClrPair & { from: number; to: number; cutoff?: number })[];
};

/**
 * Vzdálenost dvojice: `d` ≥ 0 (0 = dotyk nebo průnik), `exact` = přesně z jádra (false = jen dolní mez z obálek – vzdálenost je
 * nejméně `d`), `inside` = jedno těleso uvnitř druhého / průnik, body ve světě (`p1` na A, `p2` na B), cesty listů minima.
 */
export type ClrDist = { d: number; exact: boolean; inside?: boolean; p1?: Vec3; p2?: Vec3; aPath?: string[]; bPath?: string[] };
/** spojitá kontrola úseku: `ok` = vzájemný pohyb je čistý posuv a dráha se spočítala (jinak `d` nic neříká); `v` = vektor posuvu B vůči A (svět) */
export type ClrSweep = ClrDist & { ok: boolean; v?: Vec3; /** objem průniku A s dráhou B při dotyku (0 = klouzání po ploše bez průniku) */ pen?: number };
/** místní obálka komponenty: kvádr a opsaná koule ve vlastních souřadnicích komponenty nejvyšší úrovně; null = bez tělesa */
export type ClrLocal = { box: [Vec3, Vec3]; c: Vec3; r: number } | null;

export type ClrRes = { local?: Record<string, ClrLocal>; dist?: ClrDist[]; sweep?: ClrSweep[] };
