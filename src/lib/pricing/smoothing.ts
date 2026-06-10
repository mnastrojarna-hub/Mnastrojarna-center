import type { HistoricalPrice, SmoothingResult } from "./types";

/**
 * Ochrana proti cenovým výkyvům: nová cena se porovnává s klouzavým průměrem
 * historických cen (přepočtených inflačním koeficientem na dnešek) a smí se
 * od něj odchýlit max. o povolený krok. Jeden extrémní případ cenu nerozhodí.
 */

export interface SmoothingOptions {
  inflationPctPerYear: number;
  maxStepUpPct: number;    // max. zdražení vs. reference
  maxStepDownPct: number;  // max. zlevnění vs. reference
  now?: Date;              // pro testy
}

/** Přepočet historické ceny na dnešní hladinu (složená roční inflace). */
export function inflate(price: number, fromDate: string, inflationPctPerYear: number, now = new Date()): number {
  const from = new Date(fromDate);
  const years = Math.max(0, (now.getTime() - from.getTime()) / (365.25 * 24 * 3600 * 1000));
  return price * Math.pow(1 + inflationPctPerYear / 100, years);
}

/**
 * Vážený klouzavý průměr (novější ceny mají vyšší váhu) z cen po inflaci.
 */
export function movingReference(history: HistoricalPrice[], inflationPctPerYear: number, now = new Date()): number | null {
  const valid = history.filter((h) => h.unitPrice > 0);
  if (!valid.length) return null;
  const sorted = [...valid].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 5);
  let sum = 0, wsum = 0;
  sorted.forEach((h, i) => {
    const w = 1 / (i + 1); // 1, 1/2, 1/3…
    sum += inflate(h.unitPrice, h.date, inflationPctPerYear, now) * w;
    wsum += w;
  });
  return sum / wsum;
}

export function stabilizePrice(candidate: number, history: HistoricalPrice[], opts: SmoothingOptions): SmoothingResult {
  const now = opts.now ?? new Date();
  const ref = movingReference(history, opts.inflationPctPerYear, now);
  if (ref === null || candidate <= 0) {
    return { price: round2(candidate), adjusted: false, note: history.length ? "historie bez použitelné ceny" : "bez cenové historie — vyhlazení se neuplatní" };
  }
  const upLimit = ref * (1 + opts.maxStepUpPct / 100);
  const downLimit = ref * (1 - opts.maxStepDownPct / 100);
  if (candidate > upLimit) {
    return {
      price: round2(upLimit), adjusted: true, referencePrice: round2(ref),
      note: `cena omezena: kalkulace ${round2(candidate)} Kč > historický průměr ${round2(ref)} Kč + ${opts.maxStepUpPct} % (skokové zdražení)`,
    };
  }
  if (candidate < downLimit) {
    return {
      price: round2(downLimit), adjusted: true, referencePrice: round2(ref),
      note: `cena omezena: kalkulace ${round2(candidate)} Kč < historický průměr ${round2(ref)} Kč − ${opts.maxStepDownPct} % (skokové zlevnění)`,
    };
  }
  return { price: round2(candidate), adjusted: false, referencePrice: round2(ref), note: `v pásmu historického průměru ${round2(ref)} Kč ±` };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
