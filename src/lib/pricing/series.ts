import type { SeriesClass, SeriesInfo } from "./types";

/**
 * Sériovost: klasifikace množství a rozpočítání fixních nákladů
 * (programování, seřízení, výrobní příprava) na kus.
 */

export function classifySeries(quantity: number): SeriesInfo {
  const q = Math.max(1, Math.floor(quantity));
  if (q === 1) return { cls: "jeden_kus", label: "1 kus", perPieceTimeFactor: 1.15 };
  if (q <= 5) return { cls: "prototyp", label: "Prototyp (2–5 ks)", perPieceTimeFactor: 1.05 };
  if (q <= 50) return { cls: "mala_serie", label: "Malá série (6–50 ks)", perPieceTimeFactor: 0.95 };
  if (q <= 500) return { cls: "stredni_serie", label: "Střední série (51–500 ks)", perPieceTimeFactor: 0.85 };
  return { cls: "velka_serie", label: "Velká série (500+ ks)", perPieceTimeFactor: 0.75 };
}

export const SERIES_LABEL: Record<SeriesClass, string> = {
  jeden_kus: "1 kus",
  prototyp: "Prototyp",
  mala_serie: "Malá série",
  stredni_serie: "Střední série",
  velka_serie: "Velká série",
};

/** Amortizace fixního času/nákladu na kus. */
export function amortize(fixedValue: number, quantity: number): number {
  return fixedValue / Math.max(1, quantity);
}
